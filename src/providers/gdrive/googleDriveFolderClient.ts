import type { GoogleAuthBridge } from "../../bridges/oauth/types";
import { diagnosticLogger } from "../../diagnostics/diagnosticLogger";
import type { DiagnosticLogger } from "../../diagnostics/types";
import { DriveApiError } from "./driveApiErrors";
import {
  DriveHttpClient,
  GOOGLE_DRIVE_FOLDER_MIME_TYPE,
  escapeDriveQueryValue,
  isRecord,
} from "./driveHttpClient";
import type {
  DriveFolderClient,
  DriveFolderMetadata,
  DriveFolderPage,
  ListChildFoldersOptions,
} from "./types";

const DIAGNOSTIC_SCOPE = "gdrive-folder";
const GOOGLE_DRIVE_FILES_API_BASE = "https://www.googleapis.com/drive/v3/files";
const DRIVE_FOLDERS_PAGE_SIZE = 100;

export interface GoogleDriveFolderClientOptions {
  readonly authBridge: GoogleAuthBridge;
  readonly fetchFn?: typeof fetch;
  readonly logger?: DiagnosticLogger;
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

export class GoogleDriveFolderClient implements DriveFolderClient {
  private readonly httpClient: DriveHttpClient;
  private readonly logger: DiagnosticLogger;

  constructor(options: GoogleDriveFolderClientOptions) {
    this.logger = options.logger ?? diagnosticLogger;
    this.httpClient = new DriveHttpClient({
      authBridge: options.authBridge,
      diagnosticScope: DIAGNOSTIC_SCOPE,
      fetchFn: options.fetchFn,
      logger: this.logger,
      maxRateLimitRetries: 0,
    });
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
    const payload = await this.httpClient.fetchJson(url, { signal });
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
    const payload = await this.httpClient.fetchJson(url, {
      signal: options?.signal,
    });
    return parseChildFoldersPageResponse(payload, this.logger);
  }
}
