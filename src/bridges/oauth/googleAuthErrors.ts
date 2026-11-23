import type { GoogleAuthErrorCode } from "./types";

export class GoogleAuthError extends Error {
  readonly code: GoogleAuthErrorCode;

  constructor(code: GoogleAuthErrorCode, message: string, cause?: unknown) {
    super(message, cause !== undefined ? { cause } : undefined);
    this.name = "GoogleAuthError";
    this.code = code;
  }
}

export function toGoogleAuthError(
  _error: unknown,
  _fallbackMessage = "Google認証エラーが発生しました",
): GoogleAuthError {
  return new GoogleAuthError("AUTH_FAILED", "Not implemented");
}
