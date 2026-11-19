import { beforeEach, describe, expect, it } from "vitest";
import { ExLibrisDatabase, db, resetTestDb } from "./db";

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
});
