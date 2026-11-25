export type DriveApiErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "NOT_A_FOLDER"
  | "FOLDER_TRASHED"
  | "RATE_LIMITED"
  | "TOKEN_EXPIRED"
  | "NETWORK_ERROR";

export interface DriveFolderMetadata {
  readonly id: string;
  readonly name: string;
}

export interface DriveFolderPage {
  readonly folders: readonly DriveFolderMetadata[];
  readonly nextPageToken: string | null;
}

export interface ListChildFoldersOptions {
  readonly pageToken?: string;
  readonly signal?: AbortSignal;
}

export interface DriveFolderClient {
  resolveFolderById(
    folderId: string,
    signal?: AbortSignal,
  ): Promise<DriveFolderMetadata>;
  listChildFolders(
    parentFolderId: string,
    options?: ListChildFoldersOptions,
  ): Promise<DriveFolderPage>;
}

export interface DriveSyncFileItem {
  readonly id: string;
  readonly name: string;
  readonly mimeType: string;
  readonly parents: readonly string[];
  /** Drive API の整数バイトサイズ（フォルダ時は null） */
  readonly size: number | null;
  readonly md5Checksum: string | null;
  /** UNIX ms（RFC3339 modifiedTime から変換） */
  readonly modifiedTime: number;
  readonly trashed: boolean;
}

export interface DriveSyncFilesPage {
  readonly files: readonly DriveSyncFileItem[];
  readonly nextPageToken: string | null;
}

export interface DriveChangeItem {
  readonly fileId: string;
  readonly removed: boolean;
  readonly file: DriveSyncFileItem | null;
}

export interface DriveChangesPage {
  readonly changes: readonly DriveChangeItem[];
  readonly nextPageToken: string | null;
  readonly newStartPageToken: string | null;
}

export interface ListItemsInParentsOptions {
  readonly pageToken?: string;
  readonly signal?: AbortSignal;
}

export interface ListChangesOptions {
  readonly signal?: AbortSignal;
}

export interface DriveSyncClient {
  getStartPageToken(signal?: AbortSignal): Promise<string>;
  listItemsInParents(
    parentFolderIds: readonly string[],
    options?: ListItemsInParentsOptions,
  ): Promise<DriveSyncFilesPage>;
  getFileMetadata(
    fileId: string,
    signal?: AbortSignal,
  ): Promise<DriveSyncFileItem | null>;
  listChanges(
    pageToken: string,
    options?: ListChangesOptions,
  ): Promise<DriveChangesPage>;
}

export type DriveSyncMode = "full" | "incremental" | "skipped-no-roots";

export interface DriveSyncResult {
  readonly mode: DriveSyncMode;
  readonly scannedRoots: number;
  readonly upsertedVolumes: number;
  readonly trashedVolumes: number;
  readonly invalidatedZipCaches: number;
  readonly syncedAt: number;
}

export interface DriveSyncOptions {
  readonly forceFullScan?: boolean;
  readonly signal?: AbortSignal;
}

export interface DriveSyncEngine {
  sync(options?: DriveSyncOptions): Promise<DriveSyncResult>;
}
