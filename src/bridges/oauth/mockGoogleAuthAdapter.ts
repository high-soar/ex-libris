import type {
  GoogleAuthAdapter,
  GoogleAuthAdapterRefreshOptions,
  GoogleAuthAdapterRefreshResult,
  GoogleAuthAdapterRestoreResult,
  GoogleAuthAdapterSignInResult,
  GoogleAuthAdapterSignOutOptions,
  GoogleAuthErrorCode,
} from "./types";

export type MockGoogleAuthOperation =
  "restoreSession" | "signIn" | "refreshAccessToken" | "signOut";

export interface MockGoogleAuthAdapterOptions {
  readonly initialLinked?: boolean;
  readonly email?: string;
  readonly initialAccessToken?: string;
  readonly tokenTtlMs?: number;
  readonly now?: () => number;
}

export interface MockGoogleAuthLinkedState {
  readonly linked: boolean;
  readonly email: string;
  readonly currentAccessToken: string | null;
  readonly refreshCount: number;
  readonly lastRefreshOptions: GoogleAuthAdapterRefreshOptions | null;
}

export const DEFAULT_MOCK_GOOGLE_EMAIL = "reader@example.com";

export class MockGoogleAuthAdapter implements GoogleAuthAdapter {
  constructor(_options: MockGoogleAuthAdapterOptions = {}) {}

  getLinkedState(): MockGoogleAuthLinkedState {
    throw new Error("Not implemented");
  }

  seedLinkedSession(_options?: {
    readonly email?: string;
    readonly accessToken?: string;
  }): void {
    throw new Error("Not implemented");
  }

  setEmail(_email: string): void {
    throw new Error("Not implemented");
  }

  setNextIssuedToken(_token: string): void {
    throw new Error("Not implemented");
  }

  setOperationDelay(
    _operation: MockGoogleAuthOperation,
    _delayMs: number,
  ): void {
    throw new Error("Not implemented");
  }

  queueNextSignInCancelled(): void {
    throw new Error("Not implemented");
  }

  queueNextFailure(
    _operation: MockGoogleAuthOperation,
    _error: GoogleAuthErrorCode | Error,
  ): void {
    throw new Error("Not implemented");
  }

  reset(_options: MockGoogleAuthAdapterOptions = {}): void {
    throw new Error("Not implemented");
  }

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
