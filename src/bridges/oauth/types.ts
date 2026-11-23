export type GoogleAuthErrorCode =
  "AUTH_CANCELLED" | "AUTH_REQUIRED" | "AUTH_NETWORK_ERROR" | "AUTH_FAILED";

export interface GoogleAuthSession {
  readonly email: string;
  readonly accessToken: string;
  /** UNIX ms（GMS 取得時は取得時刻 + 3_600_000） */
  readonly expiresAt: number;
}

export interface GetAccessTokenOptions {
  readonly forceRefresh?: boolean;
  /**
   * 401 応答を引き起こした旧トークン文字列。
   * 並列リクエストの先行リフレッシュにより既に別トークンへ更新済みの場合、二重 clearToken・再認可をスキップする。
   */
  readonly failedToken?: string;
}

export type AuthSessionListener = (session: GoogleAuthSession | null) => void;

export interface GoogleAuthBridge {
  getCachedSession(): GoogleAuthSession | null;
  getSession(): Promise<GoogleAuthSession | null>;
  signIn(): Promise<GoogleAuthSession>;
  signOut(): Promise<void>;
  getValidAccessToken(options?: GetAccessTokenOptions): Promise<string>;
  subscribeSession(listener: AuthSessionListener): () => void;
}

export type GoogleAuthAdapterRestoreResult =
  | { readonly status: "unlinked" }
  | {
      readonly status: "connected";
      readonly accessToken: string;
      readonly email: string;
      readonly expiresAt?: number;
    };

export type GoogleAuthAdapterSignInResult =
  | { readonly status: "cancelled" }
  | {
      readonly status: "connected";
      readonly accessToken: string;
      readonly email: string;
      readonly expiresAt?: number;
    };

export interface GoogleAuthAdapterRefreshOptions {
  readonly previousToken: string | null;
  readonly clearCache: boolean;
}

export interface GoogleAuthAdapterRefreshResult {
  readonly accessToken: string;
  readonly email?: string;
  readonly expiresAt?: number;
}

export interface GoogleAuthAdapterSignOutOptions {
  readonly previousToken: string | null;
}

export interface GoogleAuthAdapter {
  restoreSession(): Promise<GoogleAuthAdapterRestoreResult>;
  signIn(): Promise<GoogleAuthAdapterSignInResult>;
  refreshAccessToken(
    options: GoogleAuthAdapterRefreshOptions,
  ): Promise<GoogleAuthAdapterRefreshResult>;
  signOut(options: GoogleAuthAdapterSignOutOptions): Promise<void>;
}

export interface GoogleAuthCapacitorPlugin {
  restoreSession(): Promise<GoogleAuthAdapterRestoreResult>;
  signIn(): Promise<GoogleAuthAdapterSignInResult>;
  refreshAccessToken(options: {
    previousToken: string | null;
    clearCache: boolean;
  }): Promise<GoogleAuthAdapterRefreshResult>;
  signOut(options: { previousToken: string | null }): Promise<void>;
}
