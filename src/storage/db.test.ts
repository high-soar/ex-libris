import type { EntityTable } from "dexie";
import { beforeEach, describe, expect, it } from "vitest";
import { ExLibrisDatabase, db, resetTestDb } from "./db";

interface TestZipIndexRecord {
  cacheKey: string;
  pageCount: number;
}

interface TestReadingProgressRecord {
  targetKey: string;
  currentPageIndex: number;
}

class MultiTableTestDatabase extends ExLibrisDatabase {
  zipIndexCache!: EntityTable<TestZipIndexRecord, "cacheKey">;
  readingProgress!: EntityTable<TestReadingProgressRecord, "targetKey">;

  constructor(databaseName: string) {
    super(databaseName);
    this.version(2).stores({
      syncMeta: "key",
      zipIndexCache: "cacheKey",
      readingProgress: "targetKey",
    });
  }
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

  it("複数テーブルを持つExLibrisDatabase派生インスタンスでもresetTestDbが全テーブルを空にすること", async () => {
    const multiDb = new MultiTableTestDatabase("ExLibrisMultiTableTestDB");
    try {
      await multiDb.syncMeta.put({ key: "k1", value: "v1" });
      await multiDb.zipIndexCache.put({ cacheKey: "local:a:1", pageCount: 10 });
      await multiDb.readingProgress.put({
        targetKey: "local:a:1",
        currentPageIndex: 3,
      });

      expect(await multiDb.syncMeta.count()).toBe(1);
      expect(await multiDb.zipIndexCache.count()).toBe(1);
      expect(await multiDb.readingProgress.count()).toBe(1);

      await resetTestDb(multiDb);

      expect(await multiDb.syncMeta.count()).toBe(0);
      expect(await multiDb.zipIndexCache.count()).toBe(0);
      expect(await multiDb.readingProgress.count()).toBe(0);
    } finally {
      await multiDb.delete();
    }
  });
});
