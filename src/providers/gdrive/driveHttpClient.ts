import { GoogleAuthError } from "../../bridges/oauth/googleAuthErrors";
import type {
  GetAccessTokenOptions,
  GoogleAuthBridge,
} from "../../bridges/oauth/types";
import { diagnosticLogger } from "../../diagnostics/diagnosticLogger";
import type { DiagnosticLogger } from "../../diagnostics/types";
import { isAbortError } from "../../engine/zip/errors";
import { DriveApiError } from "./driveApiErrors";
import type { DriveApiErrorCode } from "./types";

export const GOOGLE_DRIVE_FOLDER_MIME_TYPE =
  "application/vnd.google-apps.folder";

const DEFAULT_MAX_RATE_LIMIT_RETRIES = 0;
const DEFAULT_BASE_BACKOFF_MS = 500;

const RATE_LIMIT_REASONS: ReadonlySet<string> = new Set([
  "rateLimitExceeded",
  "userRateLimitExceeded",
]);

const INVALID_PAGE_TOKEN_REASONS: ReadonlySet<string> = new Set([
  "invalid",
  "badRequest",
]);

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

interface DriveApiErrorPayload {
  readonly error?: {
    readonly message?: unknown;
    readonly errors?: ReadonlyArray<{
      readonly reason?: unknown;
      readonly location?: unknown;
    }>;
  };
}

interface ExtractedDriveErrorMetadata {
  readonly reasons: readonly string[];
  readonly locations: readonly string[];
  readonly apiMessage: string;
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
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function defaultFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  return globalThis.fetch(input, init);
}

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal);
  return new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timerId);
      reject(new DOMException("The operation was aborted.", "AbortError"));
    };
    const timerId = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function cancelResponseBody(response: Response): void {
  if (response.body !== null) {
    void response.body.cancel().catch(() => undefined);
  }
}

function mapHttpStatusToErrorCode(
  status: number,
  metadata: ExtractedDriveErrorMetadata,
  treatInvalidPageTokenAsExpired: boolean,
): DriveApiErrorCode {
  if (status === 401) {
    return "UNAUTHORIZED";
  }
  if (status === 429) {
    return "RATE_LIMITED";
  }
  if (status === 403) {
    return metadata.reasons.some((reason) => RATE_LIMIT_REASONS.has(reason))
      ? "RATE_LIMITED"
      : "FORBIDDEN";
  }
  if (status === 404) {
    return "NOT_FOUND";
  }
  if (status === 410) {
    return "TOKEN_EXPIRED";
  }
  if (
    status === 400 &&
    treatInvalidPageTokenAsExpired &&
    metadata.reasons.some((reason) => INVALID_PAGE_TOKEN_REASONS.has(reason)) &&
    (metadata.locations.includes("pageToken") ||
      metadata.apiMessage.toLowerCase().includes("pagetoken"))
  ) {
    return "TOKEN_EXPIRED";
  }
  return "NETWORK_ERROR";
}

async function extractDriveErrorMetadata(
  response: Response,
  signal?: AbortSignal,
): Promise<ExtractedDriveErrorMetadata> {
  const reasons: string[] = [];
  const locations: string[] = [];
  let apiMessage = "";
  try {
    const payload = (await response.json()) as DriveApiErrorPayload;
    if (isRecord(payload) && isRecord(payload.error)) {
      if (typeof payload.error.message === "string") {
        apiMessage = payload.error.message;
      }
      if (Array.isArray(payload.error.errors)) {
        for (const entry of payload.error.errors) {
          if (typeof entry.reason === "string") {
            reasons.push(entry.reason);
          }
          if (typeof entry.location === "string") {
            locations.push(entry.location);
          }
        }
      }
    }
  } catch (error) {
    throwIfAborted(signal);
    if (isAbortError(error)) {
      throw error;
    }
    // 非 JSON 応答時はステータスコードのみで分類する
  }
  return { reasons, locations, apiMessage };
}

export class DriveHttpClient {
  private readonly authBridge: GoogleAuthBridge;
  private readonly diagnosticScope: string;
  private readonly fetchFn: typeof fetch;
  private readonly logger: DiagnosticLogger;
  private readonly maxRateLimitRetries: number;
  private readonly baseBackoffMs: number;
  private readonly sleepFn: SleepFn;

  constructor(options: DriveHttpClientOptions) {
    this.authBridge = options.authBridge;
    this.diagnosticScope = options.diagnosticScope;
    this.fetchFn = options.fetchFn ?? defaultFetch;
    this.logger = options.logger ?? diagnosticLogger;
    this.maxRateLimitRetries =
      options.maxRateLimitRetries ?? DEFAULT_MAX_RATE_LIMIT_RETRIES;
    this.baseBackoffMs = options.baseBackoffMs ?? DEFAULT_BASE_BACKOFF_MS;
    this.sleepFn = options.sleepFn ?? defaultSleep;
  }

  private async acquireAccessToken(
    options?: GetAccessTokenOptions,
  ): Promise<string> {
    try {
      return options !== undefined
        ? await this.authBridge.getValidAccessToken(options)
        : await this.authBridge.getValidAccessToken();
    } catch (error) {
      if (error instanceof GoogleAuthError) {
        const code: DriveApiErrorCode =
          error.code === "AUTH_NETWORK_ERROR"
            ? "NETWORK_ERROR"
            : "UNAUTHORIZED";
        this.logger.error(
          this.diagnosticScope,
          "アクセストークン取得に失敗しました",
          String(error),
        );
        throw new DriveApiError(code, error.message, { cause: error });
      }
      this.logger.error(
        this.diagnosticScope,
        "予期しない認証エラーが発生しました",
        String(error),
      );
      throw new DriveApiError(
        "UNAUTHORIZED",
        "Google アカウントの認証に失敗しました",
        { cause: error },
      );
    }
  }

  private async executeFetch(
    url: string,
    token: string,
    signal?: AbortSignal,
  ): Promise<Response> {
    throwIfAborted(signal);
    try {
      return await this.fetchFn(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
        signal,
      });
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }
      this.logger.error(
        this.diagnosticScope,
        "Google Drive API 通信に失敗しました",
        String(error),
      );
      throw new DriveApiError(
        "NETWORK_ERROR",
        "Google Drive との通信に失敗しました",
        { cause: error },
      );
    }
  }

  private async fetchWithAuthRetry(
    url: string,
    signal?: AbortSignal,
  ): Promise<Response> {
    throwIfAborted(signal);
    let token = await this.acquireAccessToken();
    let response = await this.executeFetch(url, token, signal);
    if (response.status === 401) {
      cancelResponseBody(response);
      token = await this.acquireAccessToken({
        forceRefresh: true,
        failedToken: token,
      });
      response = await this.executeFetch(url, token, signal);
    }
    return response;
  }

  private async createHttpDriveApiError(
    response: Response,
    signal: AbortSignal | undefined,
    treatInvalidPageTokenAsExpired: boolean,
  ): Promise<DriveApiError> {
    const metadata = await extractDriveErrorMetadata(response, signal);
    const code = mapHttpStatusToErrorCode(
      response.status,
      metadata,
      treatInvalidPageTokenAsExpired,
    );
    const detail = metadata.apiMessage
      ? `status=${response.status} ${metadata.apiMessage}`
      : `status=${response.status}`;
    this.logger.error(
      this.diagnosticScope,
      "Google Drive API エラー応答",
      detail,
    );
    return new DriveApiError(
      code,
      `Google Drive API error (${response.status})`,
      {
        status: response.status,
      },
    );
  }

  private async parseSuccessJson(
    response: Response,
    signal?: AbortSignal,
  ): Promise<unknown> {
    try {
      return (await response.json()) as unknown;
    } catch (error) {
      throwIfAborted(signal);
      if (isAbortError(error)) {
        throw error;
      }
      this.logger.error(
        this.diagnosticScope,
        "Google Drive API JSON応答の解析に失敗しました",
        String(error),
      );
      throw new DriveApiError(
        "NETWORK_ERROR",
        "Google Drive 応答の解析に失敗しました",
        { cause: error },
      );
    }
  }

  async fetchJson(
    url: string,
    options?: FetchDriveJsonOptions,
  ): Promise<unknown> {
    const signal = options?.signal;
    const treatInvalidPageTokenAsExpired =
      options?.treatInvalidPageTokenAsExpired === true;

    let attempt = 0;
    while (true) {
      const response = await this.fetchWithAuthRetry(url, signal);
      if (response.ok) {
        return this.parseSuccessJson(response, signal);
      }
      const error = await this.createHttpDriveApiError(
        response,
        signal,
        treatInvalidPageTokenAsExpired,
      );
      if (error.code === "RATE_LIMITED" && attempt < this.maxRateLimitRetries) {
        const delayMs = this.baseBackoffMs * 2 ** attempt;
        await this.sleepFn(delayMs, signal);
        throwIfAborted(signal);
        attempt += 1;
        continue;
      }
      throw error;
    }
  }
}
