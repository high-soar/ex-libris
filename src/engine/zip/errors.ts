import type { ZipErrorCode } from "../types";

export interface ZipArchiveErrorMetadata {
  readonly httpStatus?: number;
  readonly isRateLimited?: boolean;
  readonly isUnauthorized?: boolean;
}

export class ZipArchiveError extends Error {
  readonly code: ZipErrorCode;
  readonly httpStatus?: number;
  readonly isRateLimited?: boolean;
  readonly isUnauthorized?: boolean;

  constructor(
    code: ZipErrorCode,
    message: string,
    cause?: unknown,
    _metadata?: ZipArchiveErrorMetadata,
  ) {
    super(message, cause !== undefined ? { cause } : undefined);
    this.name = "ZipArchiveError";
    this.code = code;
    void _metadata;
  }
}

export function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException || error instanceof Error) &&
    error.name === "AbortError"
  );
}
