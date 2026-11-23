import type { DiagnosticLogger } from "../../diagnostics/types";
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

export class GoogleAuthTokenManager implements GoogleAuthBridge {
  constructor(
    _adapter: GoogleAuthAdapter,
    _options: GoogleAuthTokenManagerOptions = {},
  ) {}

  getCachedSession(): GoogleAuthSession | null {
    throw new Error("Not implemented");
  }

  async getSession(): Promise<GoogleAuthSession | null> {
    throw new Error("Not implemented");
  }

  async signIn(): Promise<GoogleAuthSession> {
    throw new Error("Not implemented");
  }

  async signOut(): Promise<void> {
    throw new Error("Not implemented");
  }

  async getValidAccessToken(_options?: GetAccessTokenOptions): Promise<string> {
    throw new Error("Not implemented");
  }

  subscribeSession(_listener: AuthSessionListener): () => void {
    throw new Error("Not implemented");
  }
}
