import type { GoogleAuthBridge } from "../../bridges/oauth/types";
import type { DiagnosticLogger } from "../../diagnostics/types";

export const GOOGLE_DRIVE_FOLDER_MIME_TYPE =
  "application/vnd.google-apps.folder";

export type SleepFn = (ms: number, signal?: AbortSignal) => Promise<void>;

export interface DriveHttpClientOptions {
  readonly authBridge: GoogleAuthBridge;
  readonly diagnosticScope: string;
  readonly fetchFn?: typeof fetch;
  readonly logger?: DiagnosticLogger;
  readonly maxRateLimitRetries?: number;
  readonly baseBackoffMs?: number;
  readonly sleepFn?: SleepFn;
}

export interface FetchDriveJsonOptions {
  readonly signal?: AbortSignal;
  readonly treatInvalidPageTokenAsExpired?: boolean;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException("The operation was aborted.", "AbortError");
  }
}

export function escapeDriveQueryValue(value: string): string {
  return value;
}

export class DriveHttpClient {
  constructor(_options: DriveHttpClientOptions) {
    void _options;
  }

  async fetchJson(
    _url: string,
    _options?: FetchDriveJsonOptions,
  ): Promise<unknown> {
    void _url;
    void _options;
    throw new Error("Not implemented");
  }
}
