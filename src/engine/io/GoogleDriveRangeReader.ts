import { redactSensitiveText } from "../../diagnostics/diagnosticLogger";
import type { RandomAccessReader } from "../types";
import { ZipArchiveError, isAbortError } from "../zip/errors";

const GOOGLE_DRIVE_FILES_API_BASE = "https://www.googleapis.com/drive/v3/files";

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

function defaultFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  return globalThis.fetch(input, init);
}

function cancelResponseBody(response: Response): void {
  if (response.body) {
    void response.body.cancel().catch(() => undefined);
  }
}

function parseContentLength(headers: Headers): number | null {
  const raw = headers.get("Content-Length");
  if (raw === null) {
    return null;
  }
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) {
    return null;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatErrorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function rethrowIfAbortedError(error: unknown, signal?: AbortSignal): void {
  if (isAbortError(error)) {
    throw error;
  }
  if (signal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }
}

export class GoogleDriveRangeReader implements RandomAccessReader {
  readonly sourceId: string;
  readonly totalSize: number;

  private readonly driveFileId: string;
  private readonly getAccessToken: (
    options?: GetRangeAccessTokenOptions,
  ) => Promise<string>;
  private readonly fetchImpl: typeof fetch;
  private readonly onDiagnostic?: (
    level: "warn" | "error",
    message: string,
    detail?: string,
  ) => void;

  constructor(options: GoogleDriveRangeReaderOptions) {
    const normalizedId = options.driveFileId.trim();
    if (
      normalizedId.length === 0 ||
      !Number.isSafeInteger(options.totalSize) ||
      options.totalSize < 0
    ) {
      throw new ZipArchiveError(
        "READ_ERROR",
        `不正なGoogle Driveファイル指定です: driveFileId=${options.driveFileId}, totalSize=${options.totalSize}`,
      );
    }

    this.driveFileId = normalizedId;
    this.sourceId = `gdrive:${normalizedId}`;
    this.totalSize = options.totalSize;
    this.getAccessToken = options.getAccessToken;
    this.fetchImpl = options.fetchImpl ?? defaultFetch;
    this.onDiagnostic = options.onDiagnostic;
  }

  private emitDiagnostic(
    level: "warn" | "error",
    message: string,
    detail: string,
  ): void {
    this.onDiagnostic?.(
      level,
      redactSensitiveText(message),
      redactSensitiveText(detail),
    );
  }

  private failRead(
    diagnosticMessage: string,
    errorMessage: string,
    detail: string,
    cause?: unknown,
  ): never {
    this.emitDiagnostic("error", diagnosticMessage, detail);
    throw new ZipArchiveError("READ_ERROR", errorMessage, cause);
  }

  private async acquireToken(
    options: GetRangeAccessTokenOptions | undefined,
    rangeHeader: string,
    signal?: AbortSignal,
  ): Promise<string> {
    let token: string;
    try {
      token =
        options !== undefined
          ? await this.getAccessToken(options)
          : await this.getAccessToken();
    } catch (error) {
      rethrowIfAbortedError(error, signal);
      this.failRead(
        "Google Drive Range取得用アクセストークンの取得に失敗しました",
        `Google Drive Range取得用アクセストークンの取得に失敗しました: ${this.driveFileId}`,
        `fileId=${this.driveFileId} range=${rangeHeader} ${formatErrorDetail(error)}`,
        error,
      );
    }

    if (signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }

    return token;
  }

  private async executeRangeFetch(
    url: string,
    token: string,
    rangeHeader: string,
    signal?: AbortSignal,
  ): Promise<Response> {
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          Range: rangeHeader,
        },
        signal,
      });
    } catch (error) {
      rethrowIfAbortedError(error, signal);
      this.failRead(
        "Google Drive Range通信に失敗しました",
        `Google Drive Range通信に失敗しました: ${this.driveFileId} (${rangeHeader})`,
        `fileId=${this.driveFileId} range=${rangeHeader} ${formatErrorDetail(error)}`,
        error,
      );
    }

    if (signal?.aborted) {
      cancelResponseBody(response);
      throw new DOMException("Aborted", "AbortError");
    }

    return response;
  }

  private validateRangeResponse(
    response: Response,
    rangeHeader: string,
    expectedLength: number,
    isFullFileRequest: boolean,
  ): void {
    if (response.status === 200 && !isFullFileRequest) {
      cancelResponseBody(response);
      this.failRead(
        "Google Drive部分Range要求に対して200 OKが返却されたためOOM防御のため遮断しました",
        `部分範囲要求に対して200 OKが返却されました: ${this.driveFileId} (${rangeHeader})`,
        `fileId=${this.driveFileId} range=${rangeHeader}`,
      );
    }

    if (response.status !== 206 && response.status !== 200) {
      cancelResponseBody(response);
      this.failRead(
        "Google Drive Range取得がエラー応答を返しました",
        `Google Drive Range取得に失敗しました (status=${response.status}): ${this.driveFileId} (${rangeHeader})`,
        `fileId=${this.driveFileId} range=${rangeHeader} status=${response.status}`,
      );
    }

    const contentLength = parseContentLength(response.headers);
    if (contentLength !== null && contentLength > expectedLength) {
      cancelResponseBody(response);
      this.failRead(
        "Google Drive Range応答のContent-Lengthが要求長を超過したため遮断しました",
        `Google Drive Range応答のContent-Lengthが超過しています: contentLength=${contentLength}, expected=${expectedLength}`,
        `fileId=${this.driveFileId} range=${rangeHeader} contentLength=${contentLength} expected=${expectedLength}`,
      );
    }
  }

  private async readResponseBytes(
    response: Response,
    rangeHeader: string,
    expectedLength: number,
    signal?: AbortSignal,
  ): Promise<Uint8Array> {
    let buffer: ArrayBuffer;
    try {
      buffer = await response.arrayBuffer();
    } catch (error) {
      rethrowIfAbortedError(error, signal);
      this.failRead(
        "Google Drive Rangeレスポンスボディの読込に失敗しました",
        `Google Drive Rangeレスポンスの読込に失敗しました: ${this.driveFileId} (${rangeHeader})`,
        `fileId=${this.driveFileId} range=${rangeHeader} ${formatErrorDetail(error)}`,
        error,
      );
    }

    if (signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }

    const bytes = new Uint8Array(buffer);
    if (bytes.byteLength !== expectedLength) {
      this.failRead(
        "Google Drive Range応答のバイト長が要求長と一致しません",
        `Google Drive Range応答サイズが一致しません: expected=${expectedLength}, actual=${bytes.byteLength}`,
        `fileId=${this.driveFileId} range=${rangeHeader} actual=${bytes.byteLength} expected=${expectedLength}`,
      );
    }

    return bytes;
  }

  async readRange(
    offset: number,
    length: number,
    signal?: AbortSignal,
  ): Promise<Uint8Array> {
    if (signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }

    if (
      !Number.isSafeInteger(offset) ||
      !Number.isSafeInteger(length) ||
      offset < 0 ||
      length < 0
    ) {
      throw new ZipArchiveError(
        "READ_ERROR",
        `不正な読込範囲です: offset=${offset}, length=${length}`,
      );
    }

    if (length === 0 || offset >= this.totalSize) {
      return new Uint8Array(0);
    }

    const expectedLength = Math.min(length, this.totalSize - offset);
    const end = offset + expectedLength;
    const isFullFileRequest = offset === 0 && end === this.totalSize;
    const rangeHeader = `bytes=${offset}-${end - 1}`;
    const url = `${GOOGLE_DRIVE_FILES_API_BASE}/${encodeURIComponent(this.driveFileId)}?alt=media&supportsAllDrives=true`;

    let token = await this.acquireToken(undefined, rangeHeader, signal);
    let response = await this.executeRangeFetch(
      url,
      token,
      rangeHeader,
      signal,
    );

    if (response.status === 401) {
      cancelResponseBody(response);
      this.emitDiagnostic(
        "warn",
        "Google Drive Range取得で401応答を受信したためトークンを更新して再試行します",
        `fileId=${this.driveFileId} range=${rangeHeader}`,
      );
      token = await this.acquireToken(
        { forceRefresh: true, failedToken: token },
        rangeHeader,
        signal,
      );
      response = await this.executeRangeFetch(url, token, rangeHeader, signal);
    }

    this.validateRangeResponse(
      response,
      rangeHeader,
      expectedLength,
      isFullFileRequest,
    );

    return this.readResponseBytes(
      response,
      rangeHeader,
      expectedLength,
      signal,
    );
  }
}
