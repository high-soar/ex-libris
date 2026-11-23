import { diagnosticLogger } from "../../diagnostics/diagnosticLogger";
import type { DiagnosticLogger } from "../../diagnostics/types";
import { GoogleAuthError, toGoogleAuthError } from "./googleAuthErrors";
import type {
  AuthSessionListener,
  GetAccessTokenOptions,
  GoogleAuthAdapter,
  GoogleAuthBridge,
  GoogleAuthSession,
} from "./types";

export const TOKEN_DEFAULT_TTL_MS = 3_600_000;
export const TOKEN_EARLY_REFRESH_MARGIN_MS = 300_000;

export interface GoogleAuthTokenManagerOptions {
  readonly now?: () => number;
  readonly logger?: DiagnosticLogger;
}

function isSameSession(
  a: GoogleAuthSession | null,
  b: GoogleAuthSession | null,
): boolean {
  if (a === b) {
    return true;
  }
  if (a === null || b === null) {
    return false;
  }
  return (
    a.email === b.email &&
    a.accessToken === b.accessToken &&
    a.expiresAt === b.expiresAt
  );
}

function isSessionFresh(
  session: GoogleAuthSession,
  currentTime: number,
): boolean {
  return session.expiresAt - currentTime >= TOKEN_EARLY_REFRESH_MARGIN_MS;
}

export class GoogleAuthTokenManager implements GoogleAuthBridge {
  private readonly adapter: GoogleAuthAdapter;
  private readonly now: () => number;
  private readonly logger: DiagnosticLogger;
  private readonly listeners = new Set<AuthSessionListener>();

  private session: GoogleAuthSession | null = null;
  private authEpoch = 0;
  private inflightRestorePromise: Promise<GoogleAuthSession | null> | null =
    null;
  private inflightRefreshPromise: Promise<string> | null = null;

  constructor(
    adapter: GoogleAuthAdapter,
    options: GoogleAuthTokenManagerOptions = {},
  ) {
    this.adapter = adapter;
    this.now = options.now ?? Date.now;
    this.logger = options.logger ?? diagnosticLogger;
  }

  getCachedSession(): GoogleAuthSession | null {
    return this.session;
  }

  private setSession(nextSession: GoogleAuthSession | null): void {
    if (isSameSession(this.session, nextSession)) {
      return;
    }
    this.session = nextSession;
    for (const listener of [...this.listeners]) {
      listener(nextSession);
    }
  }

  private runRestore(): Promise<GoogleAuthSession | null> {
    if (this.inflightRestorePromise !== null) {
      return this.inflightRestorePromise;
    }

    const epochAtStart = this.authEpoch;
    const promise = (async (): Promise<GoogleAuthSession | null> => {
      const result = await this.adapter.restoreSession();
      if (this.authEpoch !== epochAtStart) {
        return this.session;
      }
      if (result.status === "unlinked") {
        this.setSession(null);
        return null;
      }
      const nextSession: GoogleAuthSession = {
        email: result.email,
        accessToken: result.accessToken,
        expiresAt: result.expiresAt ?? this.now() + TOKEN_DEFAULT_TTL_MS,
      };
      this.setSession(nextSession);
      return nextSession;
    })().finally(() => {
      if (this.inflightRestorePromise === promise) {
        this.inflightRestorePromise = null;
      }
    });

    this.inflightRestorePromise = promise;
    return promise;
  }

  async getSession(): Promise<GoogleAuthSession | null> {
    if (this.session !== null) {
      return this.session;
    }
    try {
      return await this.runRestore();
    } catch (error) {
      const authError = toGoogleAuthError(
        error,
        "Googleセッションの復元に失敗しました",
      );
      if (authError.code === "AUTH_NETWORK_ERROR") {
        this.logger.warn(
          "oauth",
          "一時的な通信障害のためGoogleセッション復元を保留しました",
          authError.message,
        );
        return null;
      }
      throw authError;
    }
  }

  async signIn(): Promise<GoogleAuthSession> {
    this.authEpoch += 1;
    this.inflightRestorePromise = null;
    this.inflightRefreshPromise = null;
    const epochAtStart = this.authEpoch;

    try {
      const result = await this.adapter.signIn();
      if (result.status === "cancelled") {
        throw new GoogleAuthError(
          "AUTH_CANCELLED",
          "Googleアカウント連携がキャンセルされました",
        );
      }
      if (this.authEpoch !== epochAtStart) {
        throw new GoogleAuthError(
          "AUTH_CANCELLED",
          "サインイン中にセッション状態が更新されました",
        );
      }
      const nextSession: GoogleAuthSession = {
        email: result.email,
        accessToken: result.accessToken,
        expiresAt: result.expiresAt ?? this.now() + TOKEN_DEFAULT_TTL_MS,
      };
      this.setSession(nextSession);
      return nextSession;
    } catch (error) {
      throw toGoogleAuthError(error, "Googleアカウント連携に失敗しました");
    }
  }

  async signOut(): Promise<void> {
    this.authEpoch += 1;
    const previousToken = this.session?.accessToken ?? null;
    this.inflightRestorePromise = null;
    this.inflightRefreshPromise = null;
    this.setSession(null);

    try {
      await this.adapter.signOut({ previousToken });
    } catch (error) {
      throw toGoogleAuthError(
        error,
        "Googleアカウントの連携解除に失敗しました",
      );
    }
  }

  async getValidAccessToken(
    options: GetAccessTokenOptions = {},
  ): Promise<string> {
    if (this.inflightRefreshPromise !== null) {
      return this.inflightRefreshPromise;
    }

    const forceRefresh = options.forceRefresh === true;
    const failedToken = options.failedToken;
    const currentTime = this.now();

    if (
      !forceRefresh &&
      this.session !== null &&
      isSessionFresh(this.session, currentTime)
    ) {
      return this.session.accessToken;
    }

    if (
      forceRefresh &&
      failedToken !== undefined &&
      this.session !== null &&
      this.session.accessToken !== failedToken &&
      isSessionFresh(this.session, currentTime)
    ) {
      return this.session.accessToken;
    }

    const epochAtStart = this.authEpoch;
    const promise = (async (): Promise<string> => {
      let baseSession = this.session;
      if (baseSession === null) {
        const restored = await this.runRestore();
        if (this.authEpoch !== epochAtStart) {
          throw new GoogleAuthError(
            "AUTH_REQUIRED",
            "セッション状態が更新されたためトークン取得を中断しました",
          );
        }
        if (restored === null) {
          throw new GoogleAuthError(
            "AUTH_REQUIRED",
            "Googleアカウントとの連携が必要です",
          );
        }
        if (
          (!forceRefresh ||
            (failedToken !== undefined &&
              restored.accessToken !== failedToken)) &&
          isSessionFresh(restored, this.now())
        ) {
          return restored.accessToken;
        }
        baseSession = restored;
      }

      try {
        const refreshed = await this.adapter.refreshAccessToken({
          previousToken: baseSession.accessToken,
          clearCache: true,
        });
        if (this.authEpoch !== epochAtStart) {
          throw new GoogleAuthError(
            "AUTH_REQUIRED",
            "セッション状態が更新されたため更新後トークンを破棄しました",
          );
        }
        const nextSession: GoogleAuthSession = {
          email: refreshed.email ?? baseSession.email,
          accessToken: refreshed.accessToken,
          expiresAt: refreshed.expiresAt ?? this.now() + TOKEN_DEFAULT_TTL_MS,
        };
        this.setSession(nextSession);
        return nextSession.accessToken;
      } catch (error) {
        const authError = toGoogleAuthError(
          error,
          "Googleアクセストークンの更新に失敗しました",
        );
        if (
          authError.code === "AUTH_REQUIRED" &&
          this.authEpoch === epochAtStart
        ) {
          this.setSession(null);
        }
        throw authError;
      }
    })().finally(() => {
      if (this.inflightRefreshPromise === promise) {
        this.inflightRefreshPromise = null;
      }
    });

    this.inflightRefreshPromise = promise;
    return promise;
  }

  subscribeSession(listener: AuthSessionListener): () => void {
    this.listeners.add(listener);
    let isRemoved = false;
    return () => {
      if (isRemoved) {
        return;
      }
      isRemoved = true;
      this.listeners.delete(listener);
    };
  }
}
