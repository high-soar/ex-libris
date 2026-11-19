import type { ZipErrorCode } from "../types";

export class ZipArchiveError extends Error {
  readonly code: ZipErrorCode;

  constructor(code: ZipErrorCode, message: string, cause?: unknown) {
    super(message);
    void cause;
    this.code = code;
    throw new Error("Not implemented");
  }
}
