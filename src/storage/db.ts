import Dexie, { type EntityTable, type Table } from "dexie";
import type {
  DriveSyncRootRecord,
  ReadingProgressRecord,
  SeriesRecord,
  SyncMetaRecord,
  VolumeRecord,
  ZipIndexCacheRecord,
} from "./types";

export class ExLibrisDatabase extends Dexie {
  syncMeta!: EntityTable<SyncMetaRecord, "key">;
  zipIndexCache!: Table<ZipIndexCacheRecord, string>;
  readingProgress!: Table<ReadingProgressRecord, string>;
  driveSyncRoots!: Table<DriveSyncRootRecord, string>;
  series!: Table<SeriesRecord, string>;
  volumes!: Table<VolumeRecord, string>;

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
    this.version(3).stores({
      syncMeta: "key",
      zipIndexCache: "cacheKey, cachedAt",
      readingProgress: "targetKey, volumeId, readStatus, lastReadAt, updatedAt",
      driveSyncRoots: "folderId, enabled, updatedAt, deletedAt",
      series:
        "id, title, titleReading, *authors, publisher, label, *tags, publicationStatus, lastReadAt, addedAt, updatedAt, deletedAt",
      volumes:
        "id, seriesId, [seriesId+volumeNumber], &driveFileId, rootFolderId, md5Checksum, coverStatus, isTrashed, addedAt, updatedAt",
    });
  }
}

export const db = new ExLibrisDatabase();

export async function resetTestDb(
  targetDb: ExLibrisDatabase = db,
): Promise<void> {
  await Promise.all(targetDb.tables.map((table) => table.clear()));
}
