import Dexie, { type Table } from "dexie";
import { beforeEach, describe, expect, it } from "vitest";
import type { ZipPageEntry } from "../engine/types";
import { ExLibrisDatabase, db, resetTestDb } from "./db";

interface TestExtraNoteRecord {
  id: string;
  note: string;
}

class MultiTableTestDatabase extends ExLibrisDatabase {
  extraNotes!: Table<TestExtraNoteRecord, string>;

  constructor(databaseName: string) {
    super(databaseName);
    this.version(3).stores({
      syncMeta: "key",
      zipIndexCache: "cacheKey, cachedAt",
      readingProgress: "targetKey, volumeId, readStatus, lastReadAt, updatedAt",
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

  it("version(1)既存DBからversion(2)へ既存syncMetaを保持したままアップグレードできること", async () => {
    const dbName = "ExLibrisUpgradeV1ToV2TestDB";
    const legacyDb = new Dexie(dbName);
    legacyDb.version(1).stores({
      syncMeta: "key",
    });
    await legacyDb.table("syncMeta").put({
      key: "legacyKey",
      value: "legacyValue",
    });
    legacyDb.close();

    const upgradedDb = new ExLibrisDatabase(dbName);
    try {
      expect(await upgradedDb.syncMeta.get("legacyKey")).toEqual({
        key: "legacyKey",
        value: "legacyValue",
      });
      await upgradedDb.zipIndexCache.put({
        cacheKey: "local:upgraded.cbz:100",
        pageCount: 1,
        entries: [createSampleEntry(0)],
        cachedAt: 500,
      });
      expect(await upgradedDb.zipIndexCache.count()).toBe(1);
    } finally {
      await upgradedDb.delete();
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

  it("version(3)拡張したExLibrisDatabase派生インスタンスでもresetTestDbが全テーブルを空にすること", async () => {
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
      await multiDb.extraNotes.put({ id: "n1", note: "test" });

      expect(await multiDb.syncMeta.count()).toBe(1);
      expect(await multiDb.zipIndexCache.count()).toBe(1);
      expect(await multiDb.readingProgress.count()).toBe(1);
      expect(await multiDb.extraNotes.count()).toBe(1);

      await resetTestDb(multiDb);

      expect(await multiDb.syncMeta.count()).toBe(0);
      expect(await multiDb.zipIndexCache.count()).toBe(0);
      expect(await multiDb.readingProgress.count()).toBe(0);
      expect(await multiDb.extraNotes.count()).toBe(0);
    } finally {
      await multiDb.delete();
    }
  });
});
