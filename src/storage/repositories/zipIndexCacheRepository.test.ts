import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ZipPageEntry } from "../../engine/types";
import { ExLibrisDatabase, db, resetTestDb } from "../db";
import type { ZipIndexCacheRecord } from "../types";
import {
  DexieZipIndexCacheRepository,
  ZIP_INDEX_CACHE_MAX_ENTRIES,
} from "./zipIndexCacheRepository";

function createSampleEntries(label: string, count = 1): ZipPageEntry[] {
  return Array.from({ length: count }, (_, pageIndex) => ({
    pageIndex,
    entryName: `${label}/${String(pageIndex + 1).padStart(3, "0")}.jpg`,
    entryNameByteLength: label.length + 8,
    compressionMethod: pageIndex % 2 === 0 ? 0 : 8,
    compressedSize: 100 + pageIndex,
    uncompressedSize: 200 + pageIndex,
    localHeaderOffset: pageIndex * 300,
    physicalEnd: pageIndex * 300 + 250,
    crc32: 0x1000 + pageIndex,
  }));
}

describe("DexieZipIndexCacheRepository", () => {
  beforeEach(async () => {
    await resetTestDb();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await resetTestDb();
  });

  it("未登録キーにはnullを返し、有効エントリの保存・取得・削除ができヒット時にcachedAtをLRU更新すること (AC-ENG-11)", async () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1010);
    const repo = new DexieZipIndexCacheRepository(db, {});

    expect(await repo.get("local:missing.cbz:10")).toBeNull();

    const entries = createSampleEntries("vol01", 2);
    await repo.put("local:vol01.cbz:1024", entries);

    const savedBeforeHit = await db.zipIndexCache.get("local:vol01.cbz:1024");
    expect(savedBeforeHit).toEqual({
      cacheKey: "local:vol01.cbz:1024",
      pageCount: 2,
      entries,
      cachedAt: 1010,
    });

    nowSpy.mockReturnValue(1020);
    const hitEntries = await repo.get("local:vol01.cbz:1024");
    expect(hitEntries).toEqual(entries);

    const savedAfterHit = await db.zipIndexCache.get("local:vol01.cbz:1024");
    expect(savedAfterHit?.cachedAt).toBe(1020);
    expect(nowSpy).toHaveBeenCalled();

    await repo.delete("local:vol01.cbz:1024");
    expect(await db.zipIndexCache.get("local:vol01.cbz:1024")).toBeUndefined();
    expect(await repo.get("local:vol01.cbz:1024")).toBeNull();
  });

  it("デフォルト上限500件を超えて501件目を保存した際にLRU最古エントリを削除しヒット済みエントリを保持すること (AC-ENG-11)", async () => {
    expect(ZIP_INDEX_CACHE_MAX_ENTRIES).toBe(500);

    const nowSpy = vi.spyOn(Date, "now");
    const repo = new DexieZipIndexCacheRepository();
    for (let i = 0; i < ZIP_INDEX_CACHE_MAX_ENTRIES; i += 1) {
      nowSpy.mockReturnValue(i + 1);
      await repo.put(
        `local:vol-${i}.cbz:${i + 1}`,
        createSampleEntries(`v${i}`),
      );
    }
    expect(await db.zipIndexCache.count()).toBe(500);

    // 最古だった vol-0 にヒットさせると cachedAt が更新され、vol-1 が最古になる
    nowSpy.mockReturnValue(501);
    expect(await repo.get("local:vol-0.cbz:1")).not.toBeNull();

    // 501 件目を保存 -> 上限 500 件を維持し、vol-1 が削除され vol-0 と vol-500 が生存
    nowSpy.mockReturnValue(502);
    await repo.put("local:vol-500.cbz:501", createSampleEntries("v500"));

    expect(await db.zipIndexCache.count()).toBe(500);
    expect(await db.zipIndexCache.get("local:vol-1.cbz:2")).toBeUndefined();
    expect(await repo.get("local:vol-0.cbz:1")).not.toBeNull();
    expect(await repo.get("local:vol-500.cbz:501")).not.toBeNull();
  });

  it("空配列や不正構造のputは無視し、既存超過時にもmaxEntries超過分を一括削除できること", async () => {
    const customDb = new ExLibrisDatabase("ExLibrisZipCacheCustomDB");
    try {
      let tick = 100;
      const repo = new DexieZipIndexCacheRepository(customDb, {
        maxEntries: 2,
        now: () => {
          tick += 1;
          return tick;
        },
      });

      await repo.put("local:empty.cbz:10", []);
      await repo.put("local:invalid.cbz:10", [
        { ...createSampleEntries("bad")[0], physicalEnd: 0 },
      ]);
      expect(await customDb.zipIndexCache.count()).toBe(0);

      // maxEntries(2)を超過した3件が事前存在する状態から put で超過分2件を一括削除
      await customDb.zipIndexCache.bulkPut([
        {
          cacheKey: "k1",
          pageCount: 1,
          entries: createSampleEntries("k1"),
          cachedAt: 1,
        },
        {
          cacheKey: "k2",
          pageCount: 1,
          entries: createSampleEntries("k2"),
          cachedAt: 2,
        },
        {
          cacheKey: "k3",
          pageCount: 1,
          entries: createSampleEntries("k3"),
          cachedAt: 3,
        },
      ]);

      await repo.put("k4", createSampleEntries("k4"));
      expect(await customDb.zipIndexCache.count()).toBe(2);
      expect(await customDb.zipIndexCache.get("k1")).toBeUndefined();
      expect(await customDb.zipIndexCache.get("k2")).toBeUndefined();
      expect(await repo.get("k3")).not.toBeNull();
      expect(await repo.get("k4")).not.toBeNull();

      // 既存キー k3 を上書き保存しても上限2件以内なら k4 が退避されないこと
      const updatedK3 = createSampleEntries("k3-updated", 2);
      await repo.put("k3", updatedK3);
      expect(await customDb.zipIndexCache.count()).toBe(2);
      expect(await repo.get("k3")).toEqual(updatedK3);
      expect(await repo.get("k4")).not.toBeNull();
    } finally {
      await customDb.delete();
    }
  });

  it("取得時に破損・不整合レコードを検知した場合は自動削除してnullを返すこと (AC-ENG-11)", async () => {
    const repo = new DexieZipIndexCacheRepository(db);
    const validEntry = createSampleEntries("ok")[0];

    const corruptedRecords: ZipIndexCacheRecord[] = [
      {
        cacheKey: "corrupt:non-number-pageCount",
        pageCount: "1" as unknown as number,
        entries: [validEntry],
        cachedAt: 10,
      },
      {
        cacheKey: "corrupt:float-pageCount",
        pageCount: 1.5,
        entries: [validEntry],
        cachedAt: 20,
      },
      {
        cacheKey: "corrupt:zero-pageCount",
        pageCount: 0,
        entries: [],
        cachedAt: 30,
      },
      {
        cacheKey: "corrupt:length-mismatch",
        pageCount: 2,
        entries: [validEntry],
        cachedAt: 40,
      },
      {
        cacheKey: "corrupt:invalid-entry-field",
        pageCount: 1,
        entries: [{ ...validEntry, localHeaderOffset: 500, physicalEnd: 100 }],
        cachedAt: 50,
      },
    ];

    await db.zipIndexCache.bulkPut(corruptedRecords);
    expect(await db.zipIndexCache.count()).toBe(corruptedRecords.length);

    for (const record of corruptedRecords) {
      expect(await repo.get(record.cacheKey)).toBeNull();
      expect(await db.zipIndexCache.get(record.cacheKey)).toBeUndefined();
    }
    expect(await db.zipIndexCache.count()).toBe(0);
  });
});
