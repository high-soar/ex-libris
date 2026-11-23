import type {
  GoogleAuthAdapter,
  GoogleAuthAdapterRefreshOptions,
  GoogleAuthAdapterRefreshResult,
  GoogleAuthAdapterRestoreResult,
  GoogleAuthAdapterSignInResult,
  GoogleAuthAdapterSignOutOptions,
  GoogleAuthCapacitorPlugin,
} from "./types";

export class CapacitorGoogleAuthAdapter implements GoogleAuthAdapter {
  constructor(_plugin?: GoogleAuthCapacitorPlugin) {}

  async restoreSession(): Promise<GoogleAuthAdapterRestoreResult> {
    throw new Error("Not implemented");
  }

  async signIn(): Promise<GoogleAuthAdapterSignInResult> {
    throw new Error("Not implemented");
  }

  async refreshAccessToken(
    _options: GoogleAuthAdapterRefreshOptions,
  ): Promise<GoogleAuthAdapterRefreshResult> {
    throw new Error("Not implemented");
  }

  async signOut(_options: GoogleAuthAdapterSignOutOptions): Promise<void> {
    throw new Error("Not implemented");
  }
}
