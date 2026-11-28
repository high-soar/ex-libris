import { ExLibrisDatabase, db } from "../db";

export const DRIVE_START_PAGE_TOKEN_META_KEY = "driveStartPageToken";
export const LAST_DRIVE_SYNC_AT_META_KEY = "lastDriveSyncAt";
export const SYNCED_ROOT_FOLDER_IDS_META_KEY = "syncedRootFolderIds";
export const SYNCED_FOLDER_IDS_META_KEY = "syncedFolderIds";

const DRIVE_SYNC_META_KEYS = [
  DRIVE_START_PAGE_TOKEN_META_KEY,
  LAST_DRIVE_SYNC_AT_META_KEY,
  SYNCED_ROOT_FOLDER_IDS_META_KEY,
] as const;

export interface DriveSyncMetaState {
  readonly startPageToken: string | null;
  readonly lastDriveSyncAt: number | null;
  readonly syncedRootFolderIds: readonly string[];
  readonly syncedFolderIds: readonly string[] | null;
}

export interface DriveSyncMetaRepository {
  getSyncState(): Promise<DriveSyncMetaState>;
  saveSyncState(state: DriveSyncMetaState): Promise<DriveSyncMetaState>;
  clearSyncState(): Promise<void>;
}

function normalizeRootFolderIds(ids: readonly string[]): string[] {
  const unique = new Set<string>();
  for (const rawId of ids) {
    const trimmed = rawId.trim();
    if (trimmed.length > 0) {
      unique.add(trimmed);
    }
  }
  return [...unique].sort();
}

function parseStartPageToken(
  rawValue: unknown,
  corruptKeys: string[],
): string | null {
  if (typeof rawValue !== "string") {
    corruptKeys.push(DRIVE_START_PAGE_TOKEN_META_KEY);
    return null;
  }
  const trimmed = rawValue.trim();
  if (trimmed.length === 0) {
    corruptKeys.push(DRIVE_START_PAGE_TOKEN_META_KEY);
    return null;
  }
  return trimmed;
}

function parseLastDriveSyncAt(
  rawValue: unknown,
  corruptKeys: string[],
): number | null {
  if (typeof rawValue !== "string") {
    corruptKeys.push(LAST_DRIVE_SYNC_AT_META_KEY);
    return null;
  }
  const trimmed = rawValue.trim();
  if (trimmed.length === 0) {
    corruptKeys.push(LAST_DRIVE_SYNC_AT_META_KEY);
    return null;
  }
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) {
    corruptKeys.push(LAST_DRIVE_SYNC_AT_META_KEY);
    return null;
  }
  return parsed;
}

function parseSyncedRootFolderIds(
  rawValue: unknown,
  corruptKeys: string[],
): string[] {
  if (typeof rawValue !== "string") {
    corruptKeys.push(SYNCED_ROOT_FOLDER_IDS_META_KEY);
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawValue);
  } catch {
    corruptKeys.push(SYNCED_ROOT_FOLDER_IDS_META_KEY);
    return [];
  }
  if (!Array.isArray(parsed)) {
    corruptKeys.push(SYNCED_ROOT_FOLDER_IDS_META_KEY);
    return [];
  }
  const normalized: string[] = [];
  for (const item of parsed) {
    if (typeof item !== "string" || item.trim().length === 0) {
      corruptKeys.push(SYNCED_ROOT_FOLDER_IDS_META_KEY);
      return [];
    }
    normalized.push(item.trim());
  }
  return [...new Set(normalized)].sort();
}

export class DexieDriveSyncMetaRepository implements DriveSyncMetaRepository {
  private readonly database: ExLibrisDatabase;
  private queue: Promise<void> = Promise.resolve();

  constructor(database: ExLibrisDatabase = db) {
    this.database = database;
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.queue.then(operation);
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  getSyncState(): Promise<DriveSyncMetaState> {
    return this.enqueue(async () => {
      const [tokenRecord, syncAtRecord, rootIdsRecord] =
        await this.database.syncMeta.bulkGet([...DRIVE_SYNC_META_KEYS]);
      const corruptKeys: string[] = [];

      const startPageToken = tokenRecord
        ? parseStartPageToken(tokenRecord.value, corruptKeys)
        : null;
      const lastDriveSyncAt = syncAtRecord
        ? parseLastDriveSyncAt(syncAtRecord.value, corruptKeys)
        : null;
      const syncedRootFolderIds = rootIdsRecord
        ? parseSyncedRootFolderIds(rootIdsRecord.value, corruptKeys)
        : [];

      if (corruptKeys.length > 0) {
        await this.database.syncMeta.bulkDelete(corruptKeys);
      }

      return {
        startPageToken,
        lastDriveSyncAt,
        syncedRootFolderIds,
        syncedFolderIds: null,
      };
    });
  }

  saveSyncState(state: DriveSyncMetaState): Promise<DriveSyncMetaState> {
    return this.enqueue(async () => {
      const trimmedToken =
        state.startPageToken !== null ? state.startPageToken.trim() : null;
      const startPageToken =
        trimmedToken !== null && trimmedToken.length > 0 ? trimmedToken : null;
      const lastDriveSyncAt =
        state.lastDriveSyncAt !== null && Number.isFinite(state.lastDriveSyncAt)
          ? state.lastDriveSyncAt
          : null;
      const syncedRootFolderIds = normalizeRootFolderIds(
        state.syncedRootFolderIds,
      );

      await this.database.transaction(
        "rw",
        this.database.syncMeta,
        async () => {
          if (startPageToken !== null) {
            await this.database.syncMeta.put({
              key: DRIVE_START_PAGE_TOKEN_META_KEY,
              value: startPageToken,
            });
          } else {
            await this.database.syncMeta.delete(
              DRIVE_START_PAGE_TOKEN_META_KEY,
            );
          }

          if (lastDriveSyncAt !== null) {
            await this.database.syncMeta.put({
              key: LAST_DRIVE_SYNC_AT_META_KEY,
              value: String(lastDriveSyncAt),
            });
          } else {
            await this.database.syncMeta.delete(LAST_DRIVE_SYNC_AT_META_KEY);
          }

          await this.database.syncMeta.put({
            key: SYNCED_ROOT_FOLDER_IDS_META_KEY,
            value: JSON.stringify(syncedRootFolderIds),
          });
        },
      );

      return {
        startPageToken,
        lastDriveSyncAt,
        syncedRootFolderIds,
        syncedFolderIds: null,
      };
    });
  }

  clearSyncState(): Promise<void> {
    return this.enqueue(async () => {
      await this.database.transaction(
        "rw",
        this.database.syncMeta,
        async () => {
          await this.database.syncMeta.bulkDelete([...DRIVE_SYNC_META_KEYS]);
        },
      );
    });
  }
}
