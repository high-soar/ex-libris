import { ExLibrisDatabase, db } from "../db";

export const DRIVE_START_PAGE_TOKEN_META_KEY = "driveStartPageToken";
export const LAST_DRIVE_SYNC_AT_META_KEY = "lastDriveSyncAt";
export const SYNCED_ROOT_FOLDER_IDS_META_KEY = "syncedRootFolderIds";

export interface DriveSyncMetaState {
  readonly startPageToken: string | null;
  readonly lastDriveSyncAt: number | null;
  readonly syncedRootFolderIds: readonly string[];
}

export interface DriveSyncMetaRepository {
  getSyncState(): Promise<DriveSyncMetaState>;
  saveSyncState(state: DriveSyncMetaState): Promise<DriveSyncMetaState>;
  clearSyncState(): Promise<void>;
}

export class DexieDriveSyncMetaRepository implements DriveSyncMetaRepository {
  constructor(_database: ExLibrisDatabase = db) {}

  getSyncState(): Promise<DriveSyncMetaState> {
    return Promise.reject(new Error("Not implemented"));
  }

  saveSyncState(_state: DriveSyncMetaState): Promise<DriveSyncMetaState> {
    return Promise.reject(new Error("Not implemented"));
  }

  clearSyncState(): Promise<void> {
    return Promise.reject(new Error("Not implemented"));
  }
}
