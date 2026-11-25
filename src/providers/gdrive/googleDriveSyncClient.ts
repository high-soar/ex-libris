import type { GoogleAuthBridge } from "../../bridges/oauth/types";
import type { DiagnosticLogger } from "../../diagnostics/types";
import type { SleepFn } from "./driveHttpClient";
import type {
  DriveChangesPage,
  DriveSyncClient,
  DriveSyncFileItem,
  DriveSyncFilesPage,
  ListChangesOptions,
  ListItemsInParentsOptions,
} from "./types";

export interface GoogleDriveSyncClientOptions {
  readonly authBridge: GoogleAuthBridge;
  readonly fetchFn?: typeof fetch;
  readonly logger?: DiagnosticLogger;
  readonly maxRateLimitRetries?: number;
  readonly baseBackoffMs?: number;
  readonly sleepFn?: SleepFn;
}

export class GoogleDriveSyncClient implements DriveSyncClient {
  constructor(_options: GoogleDriveSyncClientOptions) {
    void _options;
  }

  async getStartPageToken(_signal?: AbortSignal): Promise<string> {
    void _signal;
    throw new Error("Not implemented");
  }

  async listItemsInParents(
    _parentFolderIds: readonly string[],
    _options?: ListItemsInParentsOptions,
  ): Promise<DriveSyncFilesPage> {
    void _parentFolderIds;
    void _options;
    throw new Error("Not implemented");
  }

  async getFileMetadata(
    _fileId: string,
    _signal?: AbortSignal,
  ): Promise<DriveSyncFileItem | null> {
    void _fileId;
    void _signal;
    throw new Error("Not implemented");
  }

  async listChanges(
    _pageToken: string,
    _options?: ListChangesOptions,
  ): Promise<DriveChangesPage> {
    void _pageToken;
    void _options;
    throw new Error("Not implemented");
  }
}
