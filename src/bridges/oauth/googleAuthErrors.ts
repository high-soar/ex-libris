import { redactSensitiveText } from "../../diagnostics/diagnosticLogger";
import type { GoogleAuthErrorCode } from "./types";

const KNOWN_AUTH_ERROR_CODES: ReadonlySet<string> =
  new Set<GoogleAuthErrorCode>([
    "AUTH_CANCELLED",
    "AUTH_REQUIRED",
    "AUTH_NETWORK_ERROR",
    "AUTH_FAILED",
  ]);

export class GoogleAuthError extends Error {
  readonly code: GoogleAuthErrorCode;

  constructor(code: GoogleAuthErrorCode, message: string, cause?: unknown) {
    super(message, cause !== undefined ? { cause } : undefined);
    this.name = "GoogleAuthError";
    this.code = code;
  }
}

function extractAuthErrorCode(error: unknown): GoogleAuthErrorCode {
  if (typeof error === "object" && error !== null && "code" in error) {
    const rawCode = (error as { code?: unknown }).code;
    if (typeof rawCode === "string" && KNOWN_AUTH_ERROR_CODES.has(rawCode)) {
      return rawCode as GoogleAuthErrorCode;
    }
  }
  return "AUTH_FAILED";
}

function extractAuthErrorMessage(
  error: unknown,
  fallbackMessage: string,
): string {
  let raw = "";
  if (error instanceof Error) {
    raw = error.message;
  } else if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof (error as { message?: unknown }).message === "string"
  ) {
    raw = (error as { message: string }).message;
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? redactSensitiveText(trimmed) : fallbackMessage;
}

export function toGoogleAuthError(
  error: unknown,
  fallbackMessage = "Google認証エラーが発生しました",
): GoogleAuthError {
  if (error instanceof GoogleAuthError) {
    return error;
  }
  return new GoogleAuthError(
    extractAuthErrorCode(error),
    extractAuthErrorMessage(error, fallbackMessage),
    error,
  );
}
