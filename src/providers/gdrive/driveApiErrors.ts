import type { DriveApiErrorCode } from "./types";

export interface DriveApiErrorOptions {
  readonly status?: number;
  readonly cause?: unknown;
}

export class DriveApiError extends Error {
  readonly code: DriveApiErrorCode;
  readonly status?: number;

  constructor(
    code: DriveApiErrorCode,
    message: string,
    options?: DriveApiErrorOptions,
  ) {
    super(message);
    this.name = "Error";
    this.code = code;
    this.status = options?.status;
  }
}
