import { GoogleAuthError, toGoogleAuthError } from "./googleAuthErrors";
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
  private linked = false;
  private email = DEFAULT_MOCK_GOOGLE_EMAIL;
  private currentAccessToken: string | null = null;
  private tokenCounter = 0;
  private refreshCount = 0;
  private lastRefreshOptions: GoogleAuthAdapterRefreshOptions | null = null;
  private nextIssuedToken: string | null = null;
  private nextSignInCancelled = false;
  private tokenTtlMs: number | undefined;
  private now: () => number = Date.now;
  private readonly operationDelays = new Map<MockGoogleAuthOperation, number>();
  private readonly queuedFailures = new Map<
    MockGoogleAuthOperation,
    GoogleAuthErrorCode | Error
  >();

  constructor(options: MockGoogleAuthAdapterOptions = {}) {
    this.reset(options);
  }

  getLinkedState(): MockGoogleAuthLinkedState {
    return {
      linked: this.linked,
      email: this.email,
      currentAccessToken: this.currentAccessToken,
      refreshCount: this.refreshCount,
      lastRefreshOptions: this.lastRefreshOptions,
    };
  }

  seedLinkedSession(
    options: {
      readonly email?: string;
      readonly accessToken?: string;
    } = {},
  ): void {
    this.linked = true;
    if (options.email !== undefined) {
      this.email = options.email;
    }
    this.currentAccessToken = options.accessToken ?? this.issueNextToken();
  }

  setEmail(email: string): void {
    this.email = email;
  }

  setNextIssuedToken(token: string): void {
    this.nextIssuedToken = token;
  }

  setOperationDelay(operation: MockGoogleAuthOperation, delayMs: number): void {
    this.operationDelays.set(operation, delayMs);
  }

  queueNextSignInCancelled(): void {
    this.nextSignInCancelled = true;
  }

  queueNextFailure(
    operation: MockGoogleAuthOperation,
    error: GoogleAuthErrorCode | Error,
  ): void {
    this.queuedFailures.set(operation, error);
  }

  reset(options: MockGoogleAuthAdapterOptions = {}): void {
    this.linked = options.initialLinked ?? false;
    this.email = options.email ?? DEFAULT_MOCK_GOOGLE_EMAIL;
    this.tokenCounter = 0;
    this.refreshCount = 0;
    this.lastRefreshOptions = null;
    this.nextIssuedToken = null;
    this.nextSignInCancelled = false;
    this.tokenTtlMs = options.tokenTtlMs;
    this.now = options.now ?? Date.now;
    this.operationDelays.clear();
    this.queuedFailures.clear();
    this.currentAccessToken = this.linked
      ? (options.initialAccessToken ?? this.issueNextToken())
      : null;
  }

  private issueNextToken(): string {
    if (this.nextIssuedToken !== null) {
      const custom = this.nextIssuedToken;
      this.nextIssuedToken = null;
      return custom;
    }
    this.tokenCounter += 1;
    return `mock-drive-token-${this.tokenCounter}`;
  }

  private resolveExpiresAtField(): { readonly expiresAt?: number } {
    return this.tokenTtlMs !== undefined
      ? { expiresAt: this.now() + this.tokenTtlMs }
      : {};
  }

  private async waitOperationDelay(
    operation: MockGoogleAuthOperation,
  ): Promise<void> {
    const delayMs = this.operationDelays.get(operation) ?? 0;
    if (delayMs > 0) {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, delayMs);
      });
    }
  }

  private consumeQueuedFailure(operation: MockGoogleAuthOperation): void {
    const queued = this.queuedFailures.get(operation);
    if (queued === undefined) {
      return;
    }
    this.queuedFailures.delete(operation);
    const error =
      typeof queued === "string"
        ? new GoogleAuthError(queued, `モック認証エラー: ${queued}`)
        : toGoogleAuthError(queued);
    if (error.code === "AUTH_REQUIRED") {
      this.linked = false;
      this.currentAccessToken = null;
    }
    throw error;
  }

  async restoreSession(): Promise<GoogleAuthAdapterRestoreResult> {
    await this.waitOperationDelay("restoreSession");
    this.consumeQueuedFailure("restoreSession");
    if (!this.linked) {
      return { status: "unlinked" };
    }
    const token = this.currentAccessToken!;
    return {
      status: "connected",
      accessToken: token,
      email: this.email,
      ...this.resolveExpiresAtField(),
    };
  }

  async signIn(): Promise<GoogleAuthAdapterSignInResult> {
    await this.waitOperationDelay("signIn");
    if (this.nextSignInCancelled) {
      this.nextSignInCancelled = false;
      return { status: "cancelled" };
    }
    this.consumeQueuedFailure("signIn");
    const token = this.issueNextToken();
    this.linked = true;
    this.currentAccessToken = token;
    return {
      status: "connected",
      accessToken: token,
      email: this.email,
      ...this.resolveExpiresAtField(),
    };
  }

  async refreshAccessToken(
    options: GoogleAuthAdapterRefreshOptions,
  ): Promise<GoogleAuthAdapterRefreshResult> {
    await this.waitOperationDelay("refreshAccessToken");
    this.consumeQueuedFailure("refreshAccessToken");
    if (!this.linked) {
      throw new GoogleAuthError(
        "AUTH_REQUIRED",
        "Googleアカウントが未連携のため更新できません",
      );
    }
    this.refreshCount += 1;
    this.lastRefreshOptions = options;
    const token = this.issueNextToken();
    this.currentAccessToken = token;
    return {
      accessToken: token,
      email: this.email,
      ...this.resolveExpiresAtField(),
    };
  }

  async signOut(_options: GoogleAuthAdapterSignOutOptions): Promise<void> {
    this.linked = false;
    this.currentAccessToken = null;
    await this.waitOperationDelay("signOut");
    this.consumeQueuedFailure("signOut");
  }
}
