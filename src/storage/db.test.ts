import Dexie, { type Table } from "dexie";
import { beforeEach, describe, expect, it } from "vitest";
import type { ZipPageEntry } from "../engine/types";
import { ExLibrisDatabase, db, resetTestDb } from "./db";
import type { DriveSyncRootRecord, SeriesRecord, VolumeRecord } from "./types";

interface TestExtraNoteRecord {
  id: string;
  note: string;
}

class MultiTableTestDatabase extends ExLibrisDatabase {
  extraNotes!: Table<TestExtraNoteRecord, string>;

  constructor(databaseName: string) {
    super(databaseName);
    this.version(4).stores({
      syncMeta: "key",
      zipIndexCache: "cacheKey, cachedAt",
      readingProgress: "targetKey, volumeId, readStatus, lastReadAt, updatedAt",
      driveSyncRoots: "folderId, enabled, updatedAt, deletedAt",
      series:
        "id, title, titleReading, *authors, publisher, label, *tags, publicationStatus, lastReadAt, addedAt, updatedAt, deletedAt",
      volumes:
        "id, seriesId, [seriesId+volumeNumber], &driveFileId, rootFolderId, md5Checksum, coverStatus, isTrashed, addedAt, updatedAt",
      extraNotes: "id",
    });
  }
}

function createSampleEntry(pageIndex = 0): ZipPageEntry {
  return {
    pageIndex,
    entryName: "001.jpg",
    entryNameByteLength: 7,
    compressionMethod: 0,
    compressedSize: 120,
    uncompressedSize: 120,
    localHeaderOffset: 0,
    physicalEnd: 200,
    crc32: 0x11223344,
  };
}

function createSampleRoot(folderId = "folder-1"): DriveSyncRootRecord {
  return {
    folderId,
    folderName: "Comics",
    enabled: 1,
    addedAt: 1000,
    updatedAt: 1000,
    deletedAt: null,
  };
}

function createSampleSeries(id = "series-1"): SeriesRecord {
  return {
    id,
    title: "サンプル漫画",
    titleReading: "さんぷるまんが",
    authors: ["著者A", "著者B"],
    publisher: "サンプル出版",
    label: "サンプルレーベル",
    tags: ["アクション", "SF"],
    synopsis: "あらすじ",
    publicationStatus: "ongoing",
    knownTotalVolumes: 5,
    externalIds: { ndlId: "ndl-1" },
    metadataLocked: false,
    representativeVolumeId: "vol-1",
    readerPresetJson: null,
    lastReadAt: 2000,
    addedAt: 1000,
    updatedAt: 1000,
    deletedAt: null,
  };
}

function createSampleVolume(
  id = "vol-1",
  seriesId = "series-1",
  driveFileId = "drive-file-1",
): VolumeRecord {
  return {
    id,
    seriesId,
    volumeNumber: 1,
    volumeLabel: "第01巻",
    rawFileName: "サンプル漫画 第01巻.cbz",
    driveFileId,
    parentFolderId: "folder-1",
    rootFolderId: "folder-1",
    fileSize: 4096,
    md5Checksum: "abc123",
    driveModifiedTime: 1500,
    coverBlob: null,
    coverStatus: "pending",
    coverCropMode: "auto",
    coverPageIndex: 0,
    coverUpdatedAt: null,
    isTrashed: 0,
    addedAt: 1000,
    updatedAt: 1000,
  };
}

describe("ExLibrisDatabase", () => {
  beforeEach(async () => {
    await resetTestDb();
  });

  it("syncMetaテーブルへメタデータを保存・取得しresetTestDbで初期化できること", async () => {
    await db.syncMeta.put({
      key: "driveStartPageToken",
      value: "token-001",
    });

    const saved = await db.syncMeta.get("driveStartPageToken");
    expect(saved).toEqual({
      key: "driveStartPageToken",
      value: "token-001",
    });

    await resetTestDb();
    expect(await db.syncMeta.count()).toBe(0);
  });

  it("version(2)でzipIndexCacheとreadingProgressテーブルが生成されCRUDとresetTestDbが動作すること (AC-ENG-11)", async () => {
    const entry = createSampleEntry(0);
    await db.syncMeta.put({ key: "k1", value: "v1" });
    await db.zipIndexCache.put({
      cacheKey: "local:comic-vol01.cbz:2048",
      pageCount: 1,
      entries: [entry],
      cachedAt: 1000,
    });
    await db.readingProgress.put({
      targetKey: "local:comic-vol01.cbz:2048",
      volumeId: null,
      currentPageIndex: 3,
      totalPageCount: 20,
      readStatus: "reading",
      spreadPageOffset: 0,
      lastReadAt: 2000,
      updatedAt: 2000,
    });

    expect(await db.zipIndexCache.get("local:comic-vol01.cbz:2048")).toEqual({
      cacheKey: "local:comic-vol01.cbz:2048",
      pageCount: 1,
      entries: [entry],
      cachedAt: 1000,
    });
    expect(
      await db.readingProgress.where("readStatus").equals("reading").count(),
    ).toBe(1);

    await resetTestDb();

    expect(await db.syncMeta.count()).toBe(0);
    expect(await db.zipIndexCache.count()).toBe(0);
    expect(await db.readingProgress.count()).toBe(0);
  });

  it("version(3)でdriveSyncRoots/series/volumesの計6テーブルが生成されインデックス検索とresetTestDbが動作すること", async () => {
    expect(db.tables.map((t) => t.name).sort()).toEqual([
      "driveSyncRoots",
      "readingProgress",
      "series",
      "syncMeta",
      "volumes",
      "zipIndexCache",
    ]);

    const root = createSampleRoot();
    const series = createSampleSeries();
    const volume = createSampleVolume();

    await db.syncMeta.put({ key: "k1", value: "v1" });
    await db.zipIndexCache.put({
      cacheKey: "gdrive:drive-file-1:abc123",
      pageCount: 1,
      entries: [createSampleEntry(0)],
      cachedAt: 1000,
    });
    await db.readingProgress.put({
      targetKey: "vol:vol-1",
      volumeId: "vol-1",
      currentPageIndex: 0,
      totalPageCount: 10,
      readStatus: "unread",
      spreadPageOffset: 0,
      lastReadAt: 1000,
      updatedAt: 1000,
    });
    await db.driveSyncRoots.put(root);
    await db.series.put(series);
    await db.volumes.put(volume);

    expect(
      await db.driveSyncRoots.where("enabled").equals(1).toArray(),
    ).toEqual([root]);
    expect(await db.series.where("authors").equals("著者B").toArray()).toEqual([
      series,
    ]);
    expect(await db.series.where("tags").equals("SF").toArray()).toEqual([
      series,
    ]);
    expect(
      await db.volumes
        .where("[seriesId+volumeNumber]")
        .equals(["series-1", 1])
        .toArray(),
    ).toEqual([volume]);
    await expect(
      db.volumes.add(createSampleVolume("vol-dup", "series-1", "drive-file-1")),
    ).rejects.toThrow();

    await resetTestDb();

    expect(await db.syncMeta.count()).toBe(0);
    expect(await db.zipIndexCache.count()).toBe(0);
    expect(await db.readingProgress.count()).toBe(0);
    expect(await db.driveSyncRoots.count()).toBe(0);
    expect(await db.series.count()).toBe(0);
    expect(await db.volumes.count()).toBe(0);
  });

  it("version(1)およびversion(2)既存DBからversion(3)へ既存データを保持したままアップグレードできること", async () => {
    const dbNameV1 = "ExLibrisUpgradeV1ToV3TestDB";
    const legacyV1Db = new Dexie(dbNameV1);
    legacyV1Db.version(1).stores({
      syncMeta: "key",
    });
    await legacyV1Db.table("syncMeta").put({
      key: "legacyKey",
      value: "legacyValue",
    });
    legacyV1Db.close();

    const upgradedFromV1 = new ExLibrisDatabase(dbNameV1);
    try {
      expect(await upgradedFromV1.syncMeta.get("legacyKey")).toEqual({
        key: "legacyKey",
        value: "legacyValue",
      });
      await upgradedFromV1.driveSyncRoots.put(createSampleRoot("r-v1"));
      expect(await upgradedFromV1.driveSyncRoots.count()).toBe(1);
    } finally {
      await upgradedFromV1.delete();
    }

    const dbNameV2 = "ExLibrisUpgradeV2ToV3TestDB";
    const legacyV2Db = new Dexie(dbNameV2);
    legacyV2Db.version(1).stores({ syncMeta: "key" });
    legacyV2Db.version(2).stores({
      syncMeta: "key",
      zipIndexCache: "cacheKey, cachedAt",
      readingProgress: "targetKey, volumeId, readStatus, lastReadAt, updatedAt",
    });
    await legacyV2Db.table("zipIndexCache").put({
      cacheKey: "local:v2.cbz:100",
      pageCount: 1,
      entries: [createSampleEntry(0)],
      cachedAt: 500,
    });
    await legacyV2Db.table("readingProgress").put({
      targetKey: "local:v2.cbz:100",
      volumeId: null,
      currentPageIndex: 2,
      totalPageCount: 10,
      readStatus: "reading",
      spreadPageOffset: 0,
      lastReadAt: 500,
      updatedAt: 500,
    });
    legacyV2Db.close();

    const upgradedFromV2 = new ExLibrisDatabase(dbNameV2);
    try {
      expect(
        await upgradedFromV2.zipIndexCache.get("local:v2.cbz:100"),
      ).toBeDefined();
      expect(
        await upgradedFromV2.readingProgress.get("local:v2.cbz:100"),
      ).toMatchObject({ currentPageIndex: 2 });
      await upgradedFromV2.driveSyncRoots.put(createSampleRoot("r-v2"));
      await upgradedFromV2.series.put(createSampleSeries("s-v2"));
      await upgradedFromV2.volumes.put(
        createSampleVolume("v-v2", "s-v2", "df-v2"),
      );
      expect(await upgradedFromV2.driveSyncRoots.count()).toBe(1);
      expect(await upgradedFromV2.series.count()).toBe(1);
      expect(await upgradedFromV2.volumes.count()).toBe(1);
    } finally {
      await upgradedFromV2.delete();
    }
  });

  it("カスタムDB名インスタンスでも独立して読み書きとresetTestDbが動作すること", async () => {
    const customDb = new ExLibrisDatabase("ExLibrisCustomTestDB");
    try {
      await customDb.syncMeta.put({
        key: "lastAppDataSyncAt",
        value: "1760000000000",
      });
      expect(await customDb.syncMeta.count()).toBe(1);

      await resetTestDb(customDb);
      expect(await customDb.syncMeta.count()).toBe(0);
    } finally {
      await customDb.delete();
    }
  });

  it("version(4)拡張したExLibrisDatabase派生インスタンスでもresetTestDbが全テーブルを空にすること", async () => {
    const multiDb = new MultiTableTestDatabase("ExLibrisMultiTableTestDB");
    try {
      await multiDb.syncMeta.put({ key: "k1", value: "v1" });
      await multiDb.zipIndexCache.put({
        cacheKey: "local:a:1",
        pageCount: 1,
        entries: [createSampleEntry(0)],
        cachedAt: 100,
      });
      await multiDb.readingProgress.put({
        targetKey: "local:a:1",
        volumeId: null,
        currentPageIndex: 3,
        totalPageCount: 10,
        readStatus: "reading",
        spreadPageOffset: 1,
        lastReadAt: 100,
        updatedAt: 100,
      });
      await multiDb.driveSyncRoots.put(createSampleRoot());
      await multiDb.series.put(createSampleSeries());
      await multiDb.volumes.put(createSampleVolume());
      await multiDb.extraNotes.put({ id: "n1", note: "test" });

      expect(await multiDb.driveSyncRoots.count()).toBe(1);
      expect(await multiDb.series.count()).toBe(1);
      expect(await multiDb.volumes.count()).toBe(1);
      expect(await multiDb.extraNotes.count()).toBe(1);

      await resetTestDb(multiDb);

      expect(await multiDb.syncMeta.count()).toBe(0);
      expect(await multiDb.zipIndexCache.count()).toBe(0);
      expect(await multiDb.readingProgress.count()).toBe(0);
      expect(await multiDb.driveSyncRoots.count()).toBe(0);
      expect(await multiDb.series.count()).toBe(0);
      expect(await multiDb.volumes.count()).toBe(0);
      expect(await multiDb.extraNotes.count()).toBe(0);
    } finally {
      await multiDb.delete();
    }
  });
});
