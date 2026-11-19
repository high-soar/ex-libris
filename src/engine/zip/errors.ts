import type { ZipErrorCode } from "../types";

export class ZipArchiveError extends Error {
  readonly code: ZipErrorCode;

  constructor(code: ZipErrorCode, message: string, cause?: unknown) {
    super(message, cause !== undefined ? { cause } : undefined);
    this.name = "ZipArchiveError";
    this.code = code;
  }
}
