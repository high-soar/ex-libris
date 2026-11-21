import Dexie, { type EntityTable, type Table } from "dexie";
import type {
  ReadingProgressRecord,
  SyncMetaRecord,
  ZipIndexCacheRecord,
} from "./types";

export class ExLibrisDatabase extends Dexie {
  syncMeta!: EntityTable<SyncMetaRecord, "key">;
  zipIndexCache!: Table<ZipIndexCacheRecord, string>;
  readingProgress!: Table<ReadingProgressRecord, string>;

  constructor(databaseName = "ExLibrisDB") {
    super(databaseName);
    this.version(1).stores({
      syncMeta: "key",
    });
    this.version(2).stores({
      syncMeta: "key",
      zipIndexCache: "cacheKey, cachedAt",
      readingProgress: "targetKey, volumeId, readStatus, lastReadAt, updatedAt",
    });
  }
}

export const db = new ExLibrisDatabase();

export async function resetTestDb(
  targetDb: ExLibrisDatabase = db,
): Promise<void> {
  await Promise.all(targetDb.tables.map((table) => table.clear()));
}
