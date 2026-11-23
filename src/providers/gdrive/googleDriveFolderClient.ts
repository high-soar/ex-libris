import { GoogleAuthError } from "../../bridges/oauth/googleAuthErrors";
import type {
  GetAccessTokenOptions,
  GoogleAuthBridge,
} from "../../bridges/oauth/types";
import { diagnosticLogger } from "../../diagnostics/diagnosticLogger";
import type { DiagnosticLogger } from "../../diagnostics/types";
import { isAbortError } from "../../engine/zip/errors";
import { DriveApiError } from "./driveApiErrors";
import type {
  DriveApiErrorCode,
  DriveFolderClient,
  DriveFolderMetadata,
  DriveFolderPage,
  ListChildFoldersOptions,
} from "./types";

const DIAGNOSTIC_SCOPE = "gdrive-folder";
const GOOGLE_DRIVE_FILES_API_BASE = "https://www.googleapis.com/drive/v3/files";
const GOOGLE_DRIVE_FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";
const DRIVE_FOLDERS_PAGE_SIZE = 100;
const RATE_LIMIT_REASONS: ReadonlySet<string> = new Set([
  "rateLimitExceeded",
  "userRateLimitExceeded",
]);

export interface GoogleDriveFolderClientOptions {
  readonly authBridge: GoogleAuthBridge;
  readonly fetchFn?: typeof fetch;
  readonly logger?: DiagnosticLogger;
}

interface DriveApiErrorPayload {
  readonly error?: {
    readonly message?: unknown;
    readonly errors?: ReadonlyArray<{ readonly reason?: unknown }>;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException("The operation was aborted.", "AbortError");
  }
}

function escapeDriveQueryValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function mapHttpStatusToErrorCode(
  status: number,
  reasons: readonly string[],
): DriveApiErrorCode {
  if (status === 401) {
    return "UNAUTHORIZED";
  }
  if (status === 429) {
    return "RATE_LIMITED";
  }
  if (status === 403) {
    return reasons.some((reason) => RATE_LIMIT_REASONS.has(reason))
      ? "RATE_LIMITED"
      : "FORBIDDEN";
  }
  if (status === 404) {
    return "NOT_FOUND";
  }
  return "NETWORK_ERROR";
}

function buildListChildFoldersUrl(
  normalizedParentId: string,
  pageToken?: string,
): string {
  const escapedParentId = escapeDriveQueryValue(normalizedParentId);
  const params = new URLSearchParams({
    q: `'${escapedParentId}' in parents and mimeType = '${GOOGLE_DRIVE_FOLDER_MIME_TYPE}' and trashed = false`,
    orderBy: "name_natural",
    pageSize: String(DRIVE_FOLDERS_PAGE_SIZE),
    fields: "nextPageToken,files(id,name,mimeType,trashed)",
    includeItemsFromAllDrives: "true",
    supportsAllDrives: "true",
  });
  const trimmedPageToken = pageToken?.trim() ?? "";
  if (trimmedPageToken.length > 0) {
    params.set("pageToken", trimmedPageToken);
  }
  return `${GOOGLE_DRIVE_FILES_API_BASE}?${params.toString()}`;
}

function cancelResponseBody(response: Response): void {
  if (response.body !== null) {
    void response.body.cancel().catch(() => undefined);
  }
}

async function extractDriveErrorMetadata(
  response: Response,
  signal?: AbortSignal,
): Promise<{
  readonly reasons: string[];
  readonly apiMessage: string;
}> {
  let reasons: string[] = [];
  let apiMessage = "";
  try {
    const payload = (await response.json()) as DriveApiErrorPayload;
    if (isRecord(payload) && isRecord(payload.error)) {
      if (typeof payload.error.message === "string") {
        apiMessage = payload.error.message;
      }
      if (Array.isArray(payload.error.errors)) {
        reasons = payload.error.errors
          .map((entry) => entry.reason)
          .filter((reason): reason is string => typeof reason === "string");
      }
    }
  } catch (error) {
    throwIfAborted(signal);
    if (isAbortError(error)) {
      throw error;
    }
    // 非 JSON 応答時はステータスコードのみで分類する
  }
  return { reasons, apiMessage };
}

function parseResolveFolderResponse(
  payload: unknown,
  logger: DiagnosticLogger,
): DriveFolderMetadata {
  if (
    !isRecord(payload) ||
    typeof payload.id !== "string" ||
    payload.id.length === 0 ||
    typeof payload.name !== "string" ||
    typeof payload.mimeType !== "string"
  ) {
    logger.error(DIAGNOSTIC_SCOPE, "Google Drive フォルダ応答の形式が不正です");
    throw new DriveApiError(
      "NETWORK_ERROR",
      "Google Drive フォルダ応答の形式が不正です",
    );
  }

  if (payload.mimeType !== GOOGLE_DRIVE_FOLDER_MIME_TYPE) {
    throw new DriveApiError(
      "NOT_A_FOLDER",
      "指定された項目はフォルダではありません",
    );
  }

  if (payload.trashed === true) {
    throw new DriveApiError(
      "FOLDER_TRASHED",
      "ゴミ箱内のフォルダは同期対象に指定できません",
    );
  }

  return {
    id: payload.id,
    name: payload.name,
  };
}

function parseChildFoldersPageResponse(
  payload: unknown,
  logger: DiagnosticLogger,
): DriveFolderPage {
  if (!isRecord(payload) || !Array.isArray(payload.files)) {
    logger.error(
      DIAGNOSTIC_SCOPE,
      "Google Drive フォルダ一覧応答の形式が不正です",
    );
    throw new DriveApiError(
      "NETWORK_ERROR",
      "Google Drive フォルダ一覧応答の形式が不正です",
    );
  }

  const folders: DriveFolderMetadata[] = [];
  for (const entry of payload.files) {
    if (
      !isRecord(entry) ||
      typeof entry.id !== "string" ||
      entry.id.length === 0 ||
      typeof entry.name !== "string"
    ) {
      logger.error(
        DIAGNOSTIC_SCOPE,
        "Google Drive フォルダ一覧要素の形式が不正です",
      );
      throw new DriveApiError(
        "NETWORK_ERROR",
        "Google Drive フォルダ一覧応答の要素が不正です",
      );
    }
    folders.push({ id: entry.id, name: entry.name });
  }

  const nextPageToken =
    typeof payload.nextPageToken === "string" &&
    payload.nextPageToken.length > 0
      ? payload.nextPageToken
      : null;

  return { folders, nextPageToken };
}

function defaultFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  return globalThis.fetch(input, init);
}

export class GoogleDriveFolderClient implements DriveFolderClient {
  private readonly authBridge: GoogleAuthBridge;
  private readonly fetchFn: typeof fetch;
  private readonly logger: DiagnosticLogger;

  constructor(options: GoogleDriveFolderClientOptions) {
    this.authBridge = options.authBridge;
    this.fetchFn = options.fetchFn ?? defaultFetch;
    this.logger = options.logger ?? diagnosticLogger;
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
          DIAGNOSTIC_SCOPE,
          "アクセストークン取得に失敗しました",
          String(error),
        );
        throw new DriveApiError(code, error.message, { cause: error });
      }
      this.logger.error(
        DIAGNOSTIC_SCOPE,
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
        DIAGNOSTIC_SCOPE,
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

  private async createHttpDriveApiError(
    response: Response,
    signal?: AbortSignal,
  ): Promise<DriveApiError> {
    const { reasons, apiMessage } = await extractDriveErrorMetadata(
      response,
      signal,
    );
    const code = mapHttpStatusToErrorCode(response.status, reasons);
    const detail = apiMessage
      ? `status=${response.status} ${apiMessage}`
      : `status=${response.status}`;
    this.logger.error(DIAGNOSTIC_SCOPE, "Google Drive API エラー応答", detail);
    return new DriveApiError(
      code,
      `Google Drive API error (${response.status})`,
      {
        status: response.status,
      },
    );
  }

  private async fetchDriveJson(
    url: string,
    signal?: AbortSignal,
  ): Promise<unknown> {
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
    if (!response.ok) {
      throw await this.createHttpDriveApiError(response, signal);
    }
    try {
      return (await response.json()) as unknown;
    } catch (error) {
      throwIfAborted(signal);
      if (isAbortError(error)) {
        throw error;
      }
      this.logger.error(
        DIAGNOSTIC_SCOPE,
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

  async resolveFolderById(
    folderId: string,
    signal?: AbortSignal,
  ): Promise<DriveFolderMetadata> {
    const normalizedId = folderId.trim();
    if (normalizedId.length === 0 || normalizedId.toLowerCase() === "root") {
      throw new DriveApiError(
        "FORBIDDEN",
        "マイドライブ全体（root）や空のフォルダIDは指定できません",
      );
    }

    const url = `${GOOGLE_DRIVE_FILES_API_BASE}/${encodeURIComponent(normalizedId)}?fields=id,name,mimeType,trashed&supportsAllDrives=true`;
    const payload = await this.fetchDriveJson(url, signal);
    return parseResolveFolderResponse(payload, this.logger);
  }

  async listChildFolders(
    parentFolderId: string,
    options?: ListChildFoldersOptions,
  ): Promise<DriveFolderPage> {
    const normalizedParentId = parentFolderId.trim();
    if (normalizedParentId.length === 0) {
      throw new DriveApiError("FORBIDDEN", "親フォルダIDが指定されていません");
    }

    const url = buildListChildFoldersUrl(
      normalizedParentId,
      options?.pageToken,
    );
    const payload = await this.fetchDriveJson(url, options?.signal);
    return parseChildFoldersPageResponse(payload, this.logger);
  }
}
