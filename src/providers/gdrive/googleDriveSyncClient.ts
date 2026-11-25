import type { GoogleAuthBridge } from "../../bridges/oauth/types";
import { diagnosticLogger } from "../../diagnostics/diagnosticLogger";
import type { DiagnosticLogger } from "../../diagnostics/types";
import { DriveApiError } from "./driveApiErrors";
import {
  DriveHttpClient,
  GOOGLE_DRIVE_FOLDER_MIME_TYPE,
  type SleepFn,
  escapeDriveQueryValue,
  isRecord,
} from "./driveHttpClient";
import type {
  DriveChangeItem,
  DriveChangesPage,
  DriveSyncClient,
  DriveSyncFileItem,
  DriveSyncFilesPage,
  ListChangesOptions,
  ListItemsInParentsOptions,
} from "./types";

const DIAGNOSTIC_SCOPE = "gdrive-sync";
const GOOGLE_DRIVE_FILES_API_BASE = "https://www.googleapis.com/drive/v3/files";
const GOOGLE_DRIVE_CHANGES_API_BASE =
  "https://www.googleapis.com/drive/v3/changes";
const DRIVE_SYNC_PAGE_SIZE = 1000;
const DEFAULT_SYNC_RATE_LIMIT_RETRIES = 3;
const SYNC_FILE_FIELDS =
  "id,name,mimeType,parents,size,md5Checksum,modifiedTime,trashed";

export interface GoogleDriveSyncClientOptions {
  readonly authBridge: GoogleAuthBridge;
  readonly fetchFn?: typeof fetch;
  readonly logger?: DiagnosticLogger;
  readonly maxRateLimitRetries?: number;
  readonly baseBackoffMs?: number;
  readonly sleepFn?: SleepFn;
}

function parseOptionalNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseParents(
  rawParents: unknown,
  logger: DiagnosticLogger,
): readonly string[] {
  if (rawParents === undefined) {
    return [];
  }
  if (
    !Array.isArray(rawParents) ||
    !rawParents.every((parent) => typeof parent === "string")
  ) {
    logger.error(
      DIAGNOSTIC_SCOPE,
      "Google Drive ファイルのparents形式が不正です",
    );
    throw new DriveApiError(
      "NETWORK_ERROR",
      "Google Drive ファイルの parents 形式が不正です",
    );
  }
  return rawParents;
}

function parseFileSize(
  rawSize: unknown,
  mimeType: string,
  logger: DiagnosticLogger,
): number | null {
  if (
    mimeType === GOOGLE_DRIVE_FOLDER_MIME_TYPE ||
    rawSize === undefined ||
    rawSize === null
  ) {
    return null;
  }
  const numeric =
    typeof rawSize === "number"
      ? rawSize
      : typeof rawSize === "string" && rawSize.trim().length > 0
        ? Number(rawSize)
        : Number.NaN;
  if (!Number.isSafeInteger(numeric) || numeric < 0) {
    logger.error(DIAGNOSTIC_SCOPE, "Google Drive ファイルのsize形式が不正です");
    throw new DriveApiError(
      "NETWORK_ERROR",
      "Google Drive ファイルの size 形式が不正です",
    );
  }
  return numeric;
}

function parseModifiedTime(rawModifiedTime: unknown): number {
  if (typeof rawModifiedTime !== "string") {
    return 0;
  }
  const parsed = Date.parse(rawModifiedTime);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseSyncFileItem(
  payload: unknown,
  logger: DiagnosticLogger,
): DriveSyncFileItem {
  if (
    !isRecord(payload) ||
    typeof payload.id !== "string" ||
    payload.id.length === 0 ||
    typeof payload.name !== "string" ||
    typeof payload.mimeType !== "string"
  ) {
    logger.error(DIAGNOSTIC_SCOPE, "Google Drive ファイル要素の形式が不正です");
    throw new DriveApiError(
      "NETWORK_ERROR",
      "Google Drive ファイル要素の形式が不正です",
    );
  }

  return {
    id: payload.id,
    name: payload.name,
    mimeType: payload.mimeType,
    parents: parseParents(payload.parents, logger),
    size: parseFileSize(payload.size, payload.mimeType, logger),
    md5Checksum: parseOptionalNonEmptyString(payload.md5Checksum),
    modifiedTime: parseModifiedTime(payload.modifiedTime),
    trashed: payload.trashed === true,
  };
}

function parseStartPageTokenResponse(
  payload: unknown,
  logger: DiagnosticLogger,
): string {
  const token = isRecord(payload)
    ? parseOptionalNonEmptyString(payload.startPageToken)
    : null;
  if (token === null) {
    logger.error(
      DIAGNOSTIC_SCOPE,
      "Google Drive startPageToken応答の形式が不正です",
    );
    throw new DriveApiError(
      "NETWORK_ERROR",
      "Google Drive startPageToken 応答の形式が不正です",
    );
  }
  return token;
}

function parseSyncFilesPageResponse(
  payload: unknown,
  logger: DiagnosticLogger,
): DriveSyncFilesPage {
  if (!isRecord(payload) || !Array.isArray(payload.files)) {
    logger.error(
      DIAGNOSTIC_SCOPE,
      "Google Drive ファイル一覧応答の形式が不正です",
    );
    throw new DriveApiError(
      "NETWORK_ERROR",
      "Google Drive ファイル一覧応答の形式が不正です",
    );
  }

  const files = payload.files.map((entry) => parseSyncFileItem(entry, logger));
  const nextPageToken = parseOptionalNonEmptyString(payload.nextPageToken);
  return { files, nextPageToken };
}

function parseChangesPageResponse(
  payload: unknown,
  logger: DiagnosticLogger,
): DriveChangesPage {
  if (!isRecord(payload) || !Array.isArray(payload.changes)) {
    logger.error(DIAGNOSTIC_SCOPE, "Google Drive 差分一覧応答の形式が不正です");
    throw new DriveApiError(
      "NETWORK_ERROR",
      "Google Drive 差分一覧応答の形式が不正です",
    );
  }

  const changes: DriveChangeItem[] = [];
  for (const entry of payload.changes) {
    if (
      !isRecord(entry) ||
      typeof entry.fileId !== "string" ||
      entry.fileId.length === 0
    ) {
      logger.error(DIAGNOSTIC_SCOPE, "Google Drive 差分要素の形式が不正です");
      throw new DriveApiError(
        "NETWORK_ERROR",
        "Google Drive 差分要素の形式が不正です",
      );
    }
    const file =
      entry.file !== undefined && entry.file !== null
        ? parseSyncFileItem(entry.file, logger)
        : null;
    changes.push({
      fileId: entry.fileId,
      removed: entry.removed === true,
      file,
    });
  }

  return {
    changes,
    nextPageToken: parseOptionalNonEmptyString(payload.nextPageToken),
    newStartPageToken: parseOptionalNonEmptyString(payload.newStartPageToken),
  };
}

function buildListItemsInParentsUrl(
  parentFolderIds: readonly string[],
  pageToken?: string,
): string {
  const parentConditions = parentFolderIds.map(
    (parentId) => `'${escapeDriveQueryValue(parentId)}' in parents`,
  );
  const params = new URLSearchParams({
    q: `(${parentConditions.join(" or ")}) and trashed = false`,
    pageSize: String(DRIVE_SYNC_PAGE_SIZE),
    fields: `nextPageToken,files(${SYNC_FILE_FIELDS})`,
    includeItemsFromAllDrives: "true",
    supportsAllDrives: "true",
  });
  const trimmedPageToken = pageToken?.trim() ?? "";
  if (trimmedPageToken.length > 0) {
    params.set("pageToken", trimmedPageToken);
  }
  return `${GOOGLE_DRIVE_FILES_API_BASE}?${params.toString()}`;
}

export class GoogleDriveSyncClient implements DriveSyncClient {
  private readonly httpClient: DriveHttpClient;
  private readonly logger: DiagnosticLogger;

  constructor(options: GoogleDriveSyncClientOptions) {
    this.logger = options.logger ?? diagnosticLogger;
    this.httpClient = new DriveHttpClient({
      authBridge: options.authBridge,
      diagnosticScope: DIAGNOSTIC_SCOPE,
      fetchFn: options.fetchFn,
      logger: this.logger,
      maxRateLimitRetries:
        options.maxRateLimitRetries ?? DEFAULT_SYNC_RATE_LIMIT_RETRIES,
      baseBackoffMs: options.baseBackoffMs,
      sleepFn: options.sleepFn,
    });
  }

  async getStartPageToken(signal?: AbortSignal): Promise<string> {
    const url = `${GOOGLE_DRIVE_CHANGES_API_BASE}/startPageToken?supportsAllDrives=true`;
    const payload = await this.httpClient.fetchJson(url, { signal });
    return parseStartPageTokenResponse(payload, this.logger);
  }

  async listItemsInParents(
    parentFolderIds: readonly string[],
    options?: ListItemsInParentsOptions,
  ): Promise<DriveSyncFilesPage> {
    const normalizedParents = parentFolderIds
      .map((id) => id.trim())
      .filter((id) => id.length > 0);
    if (normalizedParents.length === 0) {
      return { files: [], nextPageToken: null };
    }

    const url = buildListItemsInParentsUrl(
      normalizedParents,
      options?.pageToken,
    );
    const payload = await this.httpClient.fetchJson(url, {
      signal: options?.signal,
    });
    return parseSyncFilesPageResponse(payload, this.logger);
  }

  async getFileMetadata(
    fileId: string,
    signal?: AbortSignal,
  ): Promise<DriveSyncFileItem | null> {
    const normalizedId = fileId.trim();
    if (normalizedId.length === 0) {
      return null;
    }

    const url = `${GOOGLE_DRIVE_FILES_API_BASE}/${encodeURIComponent(normalizedId)}?fields=${SYNC_FILE_FIELDS}&supportsAllDrives=true`;
    try {
      const payload = await this.httpClient.fetchJson(url, { signal });
      return parseSyncFileItem(payload, this.logger);
    } catch (error) {
      if (error instanceof DriveApiError && error.code === "NOT_FOUND") {
        return null;
      }
      throw error;
    }
  }

  async listChanges(
    pageToken: string,
    options?: ListChangesOptions,
  ): Promise<DriveChangesPage> {
    const normalizedToken = pageToken.trim();
    if (normalizedToken.length === 0) {
      throw new DriveApiError(
        "TOKEN_EXPIRED",
        "無効または空の Drive 変更トークンです",
      );
    }

    const params = new URLSearchParams({
      pageToken: normalizedToken,
      pageSize: String(DRIVE_SYNC_PAGE_SIZE),
      includeRemoved: "true",
      includeItemsFromAllDrives: "true",
      supportsAllDrives: "true",
      fields: `nextPageToken,newStartPageToken,changes(fileId,removed,file(${SYNC_FILE_FIELDS}))`,
    });
    const url = `${GOOGLE_DRIVE_CHANGES_API_BASE}?${params.toString()}`;
    const payload = await this.httpClient.fetchJson(url, {
      signal: options?.signal,
      treatInvalidPageTokenAsExpired: true,
    });
    return parseChangesPageResponse(payload, this.logger);
  }
}
