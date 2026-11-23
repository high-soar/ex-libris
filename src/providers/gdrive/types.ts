export type DriveApiErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "NOT_A_FOLDER"
  | "FOLDER_TRASHED"
  | "RATE_LIMITED"
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
