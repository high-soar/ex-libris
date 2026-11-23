import { registerPlugin } from "@capacitor/core";
import { GoogleAuthError, toGoogleAuthError } from "./googleAuthErrors";
import type {
  GoogleAuthAdapter,
  GoogleAuthAdapterRefreshOptions,
  GoogleAuthAdapterRefreshResult,
  GoogleAuthAdapterRestoreResult,
  GoogleAuthAdapterSignInResult,
  GoogleAuthAdapterSignOutOptions,
  GoogleAuthCapacitorPlugin,
} from "./types";

const FALLBACK_EMAIL_LABEL = "Google Drive 連携済み";

const defaultGoogleAuthPlugin =
  registerPlugin<GoogleAuthCapacitorPlugin>("GoogleAuthPlugin");

function requireAccessToken(rawToken: string): string {
  const trimmed = rawToken.trim();
  if (trimmed.length === 0) {
    throw new GoogleAuthError(
      "AUTH_FAILED",
      "Google認証レスポンスにアクセストークンが含まれていません",
    );
  }
  return trimmed;
}

function normalizeEmail(rawEmail: string): string {
  const trimmed = rawEmail.trim();
  return trimmed.length > 0 ? trimmed : FALLBACK_EMAIL_LABEL;
}

export class CapacitorGoogleAuthAdapter implements GoogleAuthAdapter {
  private readonly plugin: GoogleAuthCapacitorPlugin;

  constructor(plugin: GoogleAuthCapacitorPlugin = defaultGoogleAuthPlugin) {
    this.plugin = plugin;
  }

  async restoreSession(): Promise<GoogleAuthAdapterRestoreResult> {
    try {
      const result = await this.plugin.restoreSession();
      if (result.status === "unlinked") {
        return { status: "unlinked" };
      }
      return {
        status: "connected",
        accessToken: requireAccessToken(result.accessToken),
        email: normalizeEmail(result.email),
        ...(result.expiresAt !== undefined
          ? { expiresAt: result.expiresAt }
          : {}),
      };
    } catch (error) {
      throw toGoogleAuthError(error, "Googleセッションの復元に失敗しました");
    }
  }

  async signIn(): Promise<GoogleAuthAdapterSignInResult> {
    try {
      const result = await this.plugin.signIn();
      if (result.status === "cancelled") {
        return { status: "cancelled" };
      }
      return {
        status: "connected",
        accessToken: requireAccessToken(result.accessToken),
        email: normalizeEmail(result.email),
        ...(result.expiresAt !== undefined
          ? { expiresAt: result.expiresAt }
          : {}),
      };
    } catch (error) {
      throw toGoogleAuthError(error, "Googleアカウント連携に失敗しました");
    }
  }

  async refreshAccessToken(
    options: GoogleAuthAdapterRefreshOptions,
  ): Promise<GoogleAuthAdapterRefreshResult> {
    try {
      const result = await this.plugin.refreshAccessToken({
        previousToken: options.previousToken,
        clearCache: options.clearCache,
      });
      const trimmedEmail =
        typeof result.email === "string" ? result.email.trim() : "";
      return {
        accessToken: requireAccessToken(result.accessToken),
        ...(trimmedEmail.length > 0 ? { email: trimmedEmail } : {}),
        ...(result.expiresAt !== undefined
          ? { expiresAt: result.expiresAt }
          : {}),
      };
    } catch (error) {
      throw toGoogleAuthError(
        error,
        "Googleアクセストークンの更新に失敗しました",
      );
    }
  }

  async signOut(options: GoogleAuthAdapterSignOutOptions): Promise<void> {
    try {
      await this.plugin.signOut({ previousToken: options.previousToken });
    } catch (error) {
      throw toGoogleAuthError(
        error,
        "Googleアカウントの連携解除に失敗しました",
      );
    }
  }
}
