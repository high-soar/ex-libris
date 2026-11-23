import type { RandomAccessReader } from "../types";

export interface GetRangeAccessTokenOptions {
  readonly forceRefresh?: boolean;
  readonly failedToken?: string;
}

export interface GoogleDriveRangeReaderOptions {
  readonly driveFileId: string;
  readonly totalSize: number;
  readonly getAccessToken: (
    options?: GetRangeAccessTokenOptions,
  ) => Promise<string>;
  readonly fetchImpl?: typeof fetch;
  readonly onDiagnostic?: (
    level: "warn" | "error",
    message: string,
    detail?: string,
  ) => void;
}

export class GoogleDriveRangeReader implements RandomAccessReader {
  readonly sourceId: string;
  readonly totalSize: number;

  constructor(options: GoogleDriveRangeReaderOptions) {
    this.sourceId = `gdrive:${options.driveFileId}`;
    this.totalSize = options.totalSize;
  }

  async readRange(
    _offset: number,
    _length: number,
    _signal?: AbortSignal,
  ): Promise<Uint8Array> {
    throw new Error("Not implemented");
  }
}
