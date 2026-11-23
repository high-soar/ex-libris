package com.highsoar.exlibris;

import android.app.Activity;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import androidx.activity.result.ActivityResult;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.IntentSenderRequest;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.appcompat.app.AppCompatActivity;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.gms.auth.api.identity.AuthorizationClient;
import com.google.android.gms.auth.api.identity.AuthorizationRequest;
import com.google.android.gms.auth.api.identity.AuthorizationResult;
import com.google.android.gms.auth.api.identity.ClearTokenRequest;
import com.google.android.gms.auth.api.identity.Identity;
import com.google.android.gms.auth.api.signin.GoogleSignInAccount;
import com.google.android.gms.common.api.ApiException;
import com.google.android.gms.common.api.CommonStatusCodes;
import com.google.android.gms.common.api.Scope;
import com.google.android.gms.tasks.Tasks;
import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import org.json.JSONObject;

@CapacitorPlugin(name = "GoogleAuthPlugin")
public class GoogleAuthPlugin extends Plugin {

    private static final String DRIVE_READONLY_SCOPE = "https://www.googleapis.com/auth/drive.readonly";
    private static final String PREFS_NAME = "exlibris_google_auth";
    private static final String PREF_KEY_IS_LINKED = "is_linked";
    private static final String PREF_KEY_EMAIL = "email";
    private static final String FALLBACK_EMAIL_LABEL = "Google Drive 連携済み";

    private static final String DRIVE_ABOUT_ENDPOINT =
        "https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)";
    private static final String REVOKE_ENDPOINT = "https://oauth2.googleapis.com/revoke";
    private static final int REVOKE_TIMEOUT_MS = 5_000;
    private static final int ABOUT_TIMEOUT_MS = 10_000;

    private static final String ERROR_AUTH_REQUIRED = "AUTH_REQUIRED";
    private static final String ERROR_AUTH_NETWORK = "AUTH_NETWORK_ERROR";
    private static final String ERROR_AUTH_FAILED = "AUTH_FAILED";

    private final Object signInLock = new Object();
    private final AtomicInteger authEpoch = new AtomicInteger(0);
    private volatile String pendingSignInCallId;
    private volatile int pendingSignInEpoch = 0;
    private volatile boolean signInInProgress = false;
    private volatile boolean isDestroyed = false;

    private ActivityResultLauncher<IntentSenderRequest> authorizationLauncher;
    private ExecutorService ioExecutor;

    @Override
    public void load() {
        super.load();
        isDestroyed = false;
        ioExecutor = Executors.newSingleThreadExecutor();
        authorizationLauncher = getBridge().registerForActivityResult(
            new ActivityResultContracts.StartIntentSenderForResult(),
            this::handleAuthorizationActivityResult
        );
    }

    @Override
    protected void handleOnDestroy() {
        isDestroyed = true;
        authEpoch.incrementAndGet();
        String callIdToRelease;
        synchronized (signInLock) {
            callIdToRelease = pendingSignInCallId;
            pendingSignInCallId = null;
            pendingSignInEpoch = 0;
            signInInProgress = false;
        }
        if (callIdToRelease != null && getBridge() != null) {
            PluginCall savedCall = getBridge().getSavedCall(callIdToRelease);
            if (savedCall != null) {
                getBridge().releaseCall(savedCall);
            }
        }
        ExecutorService executor = ioExecutor;
        ioExecutor = null;
        if (executor != null) {
            executor.shutdownNow();
        }
        super.handleOnDestroy();
    }

    @PluginMethod
    public void restoreSession(PluginCall call) {
        AppCompatActivity activity = getActivity();
        if (activity == null) {
            call.reject("Activity is unavailable", ERROR_AUTH_FAILED);
            return;
        }

        SharedPreferences prefs = getAuthPreferences();
        boolean isLinked = prefs.getBoolean(PREF_KEY_IS_LINKED, false);
        if (!isLinked) {
            call.resolve(buildStatusResult("unlinked"));
            return;
        }

        final int epochAtStart = authEpoch.get();
        Identity.getAuthorizationClient(activity)
            .authorize(buildAuthorizationRequest())
            .addOnSuccessListener(authResult -> {
                if (isDestroyed) {
                    return;
                }
                if (authEpoch.get() != epochAtStart) {
                    call.resolve(buildStatusResult("unlinked"));
                    return;
                }
                if (authResult.hasResolution()) {
                    clearAuthPreferences();
                    call.resolve(buildStatusResult("unlinked"));
                    return;
                }

                String accessToken = trimToNull(authResult.getAccessToken());
                if (accessToken == null) {
                    call.reject("Authorization succeeded without an access token", ERROR_AUTH_FAILED);
                    return;
                }

                resolveEmailAndReply(
                    authResult,
                    accessToken,
                    true,
                    resolvedEmail -> {
                        if (isDestroyed) {
                            return;
                        }
                        if (authEpoch.get() != epochAtStart) {
                            call.resolve(buildStatusResult("unlinked"));
                            return;
                        }
                        saveAuthPreferences(resolvedEmail);
                        call.resolve(buildConnectedResult(accessToken, resolvedEmail));
                    }
                );
            })
            .addOnFailureListener(ex -> {
                if (isDestroyed) {
                    return;
                }
                if (authEpoch.get() != epochAtStart) {
                    call.resolve(buildStatusResult("unlinked"));
                    return;
                }
                // 一時的なネットワーク/GMS障害時は SharedPreferences の連携状態をクリアせず維持する
                rejectWithAuthError(call, "Failed to restore Google session", ex);
            });
    }

    @PluginMethod
    public void signIn(PluginCall call) {
        AppCompatActivity activity = getActivity();
        if (activity == null || getBridge() == null || authorizationLauncher == null) {
            call.reject("Activity or authorization launcher is unavailable", ERROR_AUTH_FAILED);
            return;
        }

        final int epochAtStart;
        synchronized (signInLock) {
            if (signInInProgress || pendingSignInCallId != null) {
                call.reject("Google sign-in is already in progress", ERROR_AUTH_FAILED);
                return;
            }
            epochAtStart = authEpoch.get();
            pendingSignInEpoch = epochAtStart;
            signInInProgress = true;
        }

        Identity.getAuthorizationClient(activity)
            .authorize(buildAuthorizationRequest())
            .addOnSuccessListener(authResult -> {
                if (isDestroyed) {
                    clearSignInProgress();
                    return;
                }
                if (authEpoch.get() != epochAtStart) {
                    clearSignInProgress();
                    call.reject("Google sign-in was superseded by sign-out", ERROR_AUTH_REQUIRED);
                    return;
                }
                if (!authResult.hasResolution()) {
                    String accessToken = trimToNull(authResult.getAccessToken());
                    if (accessToken == null) {
                        clearSignInProgress();
                        call.reject("Authorization succeeded without an access token", ERROR_AUTH_FAILED);
                        return;
                    }
                    resolveEmailAndReply(
                        authResult,
                        accessToken,
                        false,
                        resolvedEmail -> {
                            clearSignInProgress();
                            if (isDestroyed) {
                                return;
                            }
                            if (authEpoch.get() != epochAtStart) {
                                call.reject("Google sign-in was superseded by sign-out", ERROR_AUTH_REQUIRED);
                                return;
                            }
                            saveAuthPreferences(resolvedEmail);
                            call.resolve(buildConnectedResult(accessToken, resolvedEmail));
                        }
                    );
                    return;
                }

                PendingIntent pendingIntent = authResult.getPendingIntent();
                if (pendingIntent == null) {
                    clearSignInProgress();
                    call.reject("Authorization resolution is missing PendingIntent", ERROR_AUTH_FAILED);
                    return;
                }

                synchronized (signInLock) {
                    if (isDestroyed || authEpoch.get() != epochAtStart) {
                        pendingSignInCallId = null;
                        pendingSignInEpoch = 0;
                        signInInProgress = false;
                        if (!isDestroyed) {
                            call.reject("Google sign-in was superseded by sign-out", ERROR_AUTH_REQUIRED);
                        }
                        return;
                    }
                    pendingSignInCallId = call.getCallbackId();
                    pendingSignInEpoch = epochAtStart;
                }
                getBridge().saveCall(call);
                try {
                    IntentSenderRequest request = new IntentSenderRequest.Builder(pendingIntent.getIntentSender()).build();
                    authorizationLauncher.launch(request);
                } catch (Exception ex) {
                    synchronized (signInLock) {
                        pendingSignInCallId = null;
                        pendingSignInEpoch = 0;
                        signInInProgress = false;
                    }
                    getBridge().releaseCall(call);
                    call.reject("Failed to launch Google authorization screen", ERROR_AUTH_FAILED, ex);
                }
            })
            .addOnFailureListener(ex -> {
                clearSignInProgress();
                if (isDestroyed) {
                    return;
                }
                if (authEpoch.get() != epochAtStart) {
                    call.reject("Google sign-in was superseded by sign-out", ERROR_AUTH_REQUIRED);
                    return;
                }
                rejectWithAuthError(call, "Google sign-in authorization failed", ex);
            });
    }

    @PluginMethod
    public void refreshAccessToken(PluginCall call) {
        AppCompatActivity activity = getActivity();
        if (activity == null) {
            call.reject("Activity is unavailable", ERROR_AUTH_FAILED);
            return;
        }

        final int epochAtStart = authEpoch.get();
        String previousToken = trimToNull(call.getString("previousToken"));
        boolean clearCache = Boolean.TRUE.equals(call.getBoolean("clearCache", false));
        AuthorizationClient authClient = Identity.getAuthorizationClient(activity);

        if (clearCache && previousToken != null) {
            ClearTokenRequest clearRequest = ClearTokenRequest.builder().setToken(previousToken).build();
            authClient
                .clearToken(clearRequest)
                .addOnSuccessListener(unused -> {
                    if (!isDestroyed && authEpoch.get() == epochAtStart) {
                        executeAuthorizeForRefresh(call, authClient, epochAtStart);
                    } else if (!isDestroyed) {
                        call.reject("Google token refresh was superseded by sign-out", ERROR_AUTH_REQUIRED);
                    }
                })
                .addOnFailureListener(ex -> {
                    if (isDestroyed) {
                        return;
                    }
                    if (authEpoch.get() != epochAtStart) {
                        call.reject("Google token refresh was superseded by sign-out", ERROR_AUTH_REQUIRED);
                        return;
                    }
                    rejectWithAuthError(call, "Failed to clear cached Google access token", ex);
                });
            return;
        }

        executeAuthorizeForRefresh(call, authClient, epochAtStart);
    }

    @PluginMethod
    public void signOut(PluginCall call) {
        authEpoch.incrementAndGet();
        String previousToken = trimToNull(call.getString("previousToken"));
        clearAuthPreferences();

        if (previousToken == null) {
            call.resolve();
            return;
        }

        ExecutorService executor = ioExecutor;
        if (executor == null || executor.isShutdown()) {
            call.resolve();
            return;
        }

        executor.execute(() -> {
            try {
                Context context = getContext();
                if (context != null) {
                    try {
                        ClearTokenRequest clearRequest = ClearTokenRequest.builder().setToken(previousToken).build();
                        Tasks.await(
                            Identity.getAuthorizationClient(context).clearToken(clearRequest),
                            REVOKE_TIMEOUT_MS,
                            TimeUnit.MILLISECONDS
                        );
                    } catch (Exception ignored) {
                        // Best-effort GMS local token cache clear
                    }
                }
                revokeTokenBestEffort(previousToken);
            } finally {
                call.resolve();
            }
        });
    }

    private void executeAuthorizeForRefresh(
        @NonNull PluginCall call,
        @NonNull AuthorizationClient authClient,
        int epochAtStart
    ) {
        authClient
            .authorize(buildAuthorizationRequest())
            .addOnSuccessListener(authResult -> {
                if (isDestroyed || authEpoch.get() != epochAtStart) {
                    if (!isDestroyed) {
                        call.reject("Google token refresh was superseded by sign-out", ERROR_AUTH_REQUIRED);
                    }
                    return;
                }
                if (authResult.hasResolution()) {
                    clearAuthPreferences();
                    call.reject("Google authorization consent is required", ERROR_AUTH_REQUIRED);
                    return;
                }

                String accessToken = trimToNull(authResult.getAccessToken());
                if (accessToken == null) {
                    call.reject("Token refresh succeeded without an access token", ERROR_AUTH_FAILED);
                    return;
                }

                resolveEmailAndReply(
                    authResult,
                    accessToken,
                    true,
                    resolvedEmail -> {
                        if (isDestroyed || authEpoch.get() != epochAtStart) {
                            if (!isDestroyed) {
                                call.reject("Google token refresh was superseded by sign-out", ERROR_AUTH_REQUIRED);
                            }
                            return;
                        }
                        saveAuthPreferences(resolvedEmail);
                        JSObject result = new JSObject();
                        result.put("accessToken", accessToken);
                        result.put("email", resolvedEmail);
                        call.resolve(result);
                    }
                );
            })
            .addOnFailureListener(ex -> {
                if (isDestroyed) {
                    return;
                }
                if (authEpoch.get() != epochAtStart) {
                    call.reject("Google token refresh was superseded by sign-out", ERROR_AUTH_REQUIRED);
                    return;
                }
                rejectWithAuthError(call, "Failed to refresh Google access token", ex);
            });
    }

    private void handleAuthorizationActivityResult(@NonNull ActivityResult activityResult) {
        String callbackId;
        int epochAtStart;
        synchronized (signInLock) {
            callbackId = pendingSignInCallId;
            epochAtStart = pendingSignInEpoch;
            pendingSignInCallId = null;
            pendingSignInEpoch = 0;
        }

        if (callbackId == null || getBridge() == null) {
            clearSignInProgress();
            return;
        }

        PluginCall savedCall = getBridge().getSavedCall(callbackId);
        if (savedCall == null) {
            clearSignInProgress();
            return;
        }
        getBridge().releaseCall(savedCall);

        if (isDestroyed) {
            clearSignInProgress();
            return;
        }
        if (authEpoch.get() != epochAtStart) {
            clearSignInProgress();
            savedCall.reject("Google sign-in was superseded by sign-out", ERROR_AUTH_REQUIRED);
            return;
        }

        if (activityResult.getResultCode() == Activity.RESULT_CANCELED) {
            clearSignInProgress();
            savedCall.resolve(buildStatusResult("cancelled"));
            return;
        }

        if (activityResult.getResultCode() != Activity.RESULT_OK) {
            clearSignInProgress();
            savedCall.reject("Google authorization failed with resultCode=" + activityResult.getResultCode(), ERROR_AUTH_FAILED);
            return;
        }

        Intent intentData = activityResult.getData();
        AppCompatActivity activity = getActivity();
        if (activity == null || intentData == null) {
            clearSignInProgress();
            savedCall.reject("Google authorization result intent is unavailable", ERROR_AUTH_FAILED);
            return;
        }

        try {
            AuthorizationResult authResult = Identity
                .getAuthorizationClient(activity)
                .getAuthorizationResultFromIntent(intentData);
            String accessToken = trimToNull(authResult.getAccessToken());
            if (accessToken == null) {
                clearSignInProgress();
                savedCall.reject("Authorization result did not include an access token", ERROR_AUTH_FAILED);
                return;
            }

            resolveEmailAndReply(
                authResult,
                accessToken,
                false,
                resolvedEmail -> {
                    clearSignInProgress();
                    if (isDestroyed) {
                        return;
                    }
                    if (authEpoch.get() != epochAtStart) {
                        savedCall.reject("Google sign-in was superseded by sign-out", ERROR_AUTH_REQUIRED);
                        return;
                    }
                    saveAuthPreferences(resolvedEmail);
                    savedCall.resolve(buildConnectedResult(accessToken, resolvedEmail));
                }
            );
        } catch (ApiException ex) {
            clearSignInProgress();
            if (isDestroyed) {
                return;
            }
            if (authEpoch.get() != epochAtStart) {
                savedCall.reject("Google sign-in was superseded by sign-out", ERROR_AUTH_REQUIRED);
                return;
            }
            if (ex.getStatusCode() == CommonStatusCodes.CANCELED) {
                savedCall.resolve(buildStatusResult("cancelled"));
                return;
            }
            rejectWithAuthError(savedCall, "Failed to extract Google authorization result", ex);
        } catch (Exception ex) {
            clearSignInProgress();
            if (isDestroyed) {
                return;
            }
            if (authEpoch.get() != epochAtStart) {
                savedCall.reject("Google sign-in was superseded by sign-out", ERROR_AUTH_REQUIRED);
                return;
            }
            savedCall.reject("Unexpected failure while processing Google authorization result", ERROR_AUTH_FAILED, ex);
        }
    }

    private interface EmailResolvedCallback {
        void onResolved(@NonNull String email);
    }

    private void resolveEmailAndReply(
        @NonNull AuthorizationResult authResult,
        @NonNull String accessToken,
        boolean allowCachedPrefEmail,
        @NonNull EmailResolvedCallback callback
    ) {
        String emailFromResult = extractEmailFromResult(authResult);
        if (emailFromResult != null) {
            callback.onResolved(emailFromResult);
            return;
        }

        if (allowCachedPrefEmail) {
            String cachedEmail = trimToNull(getAuthPreferences().getString(PREF_KEY_EMAIL, null));
            if (cachedEmail != null && !FALLBACK_EMAIL_LABEL.equals(cachedEmail)) {
                callback.onResolved(cachedEmail);
                return;
            }
        }

        ExecutorService executor = ioExecutor;
        if (executor == null || executor.isShutdown()) {
            callback.onResolved(FALLBACK_EMAIL_LABEL);
            return;
        }

        executor.execute(() -> {
            String resolved = fetchUserEmailFromDriveAbout(accessToken);
            callback.onResolved(resolved != null ? resolved : FALLBACK_EMAIL_LABEL);
        });
    }

    @SuppressWarnings("deprecation")
    @Nullable
    private static String extractEmailFromResult(@NonNull AuthorizationResult result) {
        GoogleSignInAccount account = result.toGoogleSignInAccount();
        String rawEmail = account != null ? account.getEmail() : null;
        return trimToNull(rawEmail);
    }

    @Nullable
    private static String fetchUserEmailFromDriveAbout(@NonNull String accessToken) {
        HttpURLConnection conn = null;
        try {
            URL url = new URL(DRIVE_ABOUT_ENDPOINT);
            conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("GET");
            conn.setConnectTimeout(ABOUT_TIMEOUT_MS);
            conn.setReadTimeout(ABOUT_TIMEOUT_MS);
            conn.setRequestProperty("Authorization", "Bearer " + accessToken);

            int status = conn.getResponseCode();
            if (status < 200 || status >= 300) {
                return null;
            }

            try (
                InputStream is = conn.getInputStream();
                BufferedReader reader = new BufferedReader(new InputStreamReader(is, StandardCharsets.UTF_8))
            ) {
                StringBuilder sb = new StringBuilder();
                String line;
                while ((line = reader.readLine()) != null) {
                    sb.append(line);
                }
                JSONObject root = new JSONObject(sb.toString());
                JSONObject user = root.optJSONObject("user");
                if (user == null || user.isNull("emailAddress")) {
                    return null;
                }
                return trimToNull(user.optString("emailAddress", ""));
            }
        } catch (Exception ignored) {
            return null;
        } finally {
            if (conn != null) {
                conn.disconnect();
            }
        }
    }

    private static void revokeTokenBestEffort(@NonNull String token) {
        HttpURLConnection conn = null;
        try {
            URL url = new URL(REVOKE_ENDPOINT);
            conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("POST");
            conn.setDoOutput(true);
            conn.setConnectTimeout(REVOKE_TIMEOUT_MS);
            conn.setReadTimeout(REVOKE_TIMEOUT_MS);
            conn.setRequestProperty("Content-Type", "application/x-www-form-urlencoded; charset=UTF-8");

            String body = "token=" + URLEncoder.encode(token, StandardCharsets.UTF_8.name());
            byte[] bodyBytes = body.getBytes(StandardCharsets.UTF_8);
            conn.setFixedLengthStreamingMode(bodyBytes.length);
            try (OutputStream os = conn.getOutputStream()) {
                os.write(bodyBytes);
            }
            conn.getResponseCode();
        } catch (Exception ignored) {
            // Best-effort offline/transient failure must not fail sign-out
        } finally {
            if (conn != null) {
                conn.disconnect();
            }
        }
    }

    @NonNull
    private static JSObject buildStatusResult(@NonNull String status) {
        JSObject result = new JSObject();
        result.put("status", status);
        return result;
    }

    @NonNull
    private static JSObject buildConnectedResult(@NonNull String accessToken, @NonNull String email) {
        JSObject result = new JSObject();
        result.put("status", "connected");
        result.put("accessToken", accessToken);
        result.put("email", email);
        return result;
    }

    @NonNull
    private static AuthorizationRequest buildAuthorizationRequest() {
        return AuthorizationRequest.builder().setRequestedScopes(Collections.singletonList(new Scope(DRIVE_READONLY_SCOPE))).build();
    }

    @NonNull
    private SharedPreferences getAuthPreferences() {
        return getContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
    }

    private void saveAuthPreferences(@NonNull String email) {
        SharedPreferences.Editor editor = getAuthPreferences().edit();
        editor.putBoolean(PREF_KEY_IS_LINKED, true);
        if (!FALLBACK_EMAIL_LABEL.equals(email)) {
            editor.putString(PREF_KEY_EMAIL, email);
        } else {
            editor.remove(PREF_KEY_EMAIL);
        }
        editor.apply();
    }

    private void clearAuthPreferences() {
        getAuthPreferences().edit().clear().apply();
    }

    private void clearSignInProgress() {
        synchronized (signInLock) {
            signInInProgress = false;
            pendingSignInEpoch = 0;
        }
    }

    private static void rejectWithAuthError(@NonNull PluginCall call, @NonNull String message, @NonNull Throwable error) {
        String code = isTransientNetworkError(error) ? ERROR_AUTH_NETWORK : ERROR_AUTH_FAILED;
        Exception ex = error instanceof Exception ? (Exception) error : new Exception(error);
        call.reject(message, code, ex);
    }

    private static boolean isTransientNetworkError(@Nullable Throwable error) {
        Throwable cursor = error;
        int depth = 0;
        while (cursor != null && depth < 10) {
            if (cursor instanceof IOException) {
                return true;
            }
            if (cursor instanceof ApiException) {
                int statusCode = ((ApiException) cursor).getStatusCode();
                if (
                    statusCode == CommonStatusCodes.NETWORK_ERROR ||
                    statusCode == CommonStatusCodes.TIMEOUT ||
                    statusCode == CommonStatusCodes.INTERRUPTED
                ) {
                    return true;
                }
            }
            cursor = cursor.getCause();
            depth += 1;
        }
        return false;
    }

    @Nullable
    private static String trimToNull(@Nullable String value) {
        if (value == null) {
            return null;
        }
        String trimmed = value.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }
}
