import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExLibrisDatabase, db, resetTestDb } from "../db";
import type { ReadStatus, ReadingProgressRecord } from "../types";
import {
  DexieReadingProgressRepository,
  LOCAL_READING_PROGRESS_MAX_ENTRIES,
  RECENT_LOCAL_HISTORY_DEFAULT_LIMIT,
  type SaveReadingProgressInput,
  parseLocalProgressTargetKey,
} from "./readingProgressRepository";

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function createLocalInput(
  fileName: string,
  fileSize: number,
  overrides: Partial<SaveReadingProgressInput> = {},
): SaveReadingProgressInput {
  return {
    targetKey: `local:${fileName}:${fileSize}`,
    volumeId: null,
    currentPageIndex: 3,
    totalPageCount: 20,
    readStatus: "reading",
    spreadPageOffset: 0,
    ...overrides,
  };
}

describe("DexieReadingProgressRepository", () => {
  beforeEach(async () => {
    await resetTestDb();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await resetTestDb();
  });

  it("定数とparseLocalProgressTargetKeyがコロン含みファイル名・境界値・不正形式を正しく解析すること", () => {
    expect(LOCAL_READING_PROGRESS_MAX_ENTRIES).toBe(100);
    expect(RECENT_LOCAL_HISTORY_DEFAULT_LIMIT).toBe(10);

    expect(parseLocalProgressTargetKey("local:comic-vol01.cbz:2048")).toEqual({
      rawFileName: "comic-vol01.cbz",
      fileSize: 2048,
    });
    expect(parseLocalProgressTargetKey("local:第1部:外伝:vol01.cbz:0")).toEqual(
      {
        rawFileName: "第1部:外伝:vol01.cbz",
        fileSize: 0,
      },
    );

    const invalidKeys = [
      "",
      "vol:vol-1",
      "local:no-size",
      "local::100",
      "local:comic.cbz:",
      "local:comic.cbz:-1",
      "local:comic.cbz:1.5",
      "local:comic.cbz:12ab",
      `local:comic.cbz:${Number.MAX_SAFE_INTEGER + 1}`,
    ];
    for (const key of invalidKeys) {
      expect(parseLocalProgressTargetKey(key)).toBeNull();
    }
  });

  it("local:*およびvol:*の保存・取得・個別削除ができ不正入力は無視すること (AC-RD-15)", async () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1500);
    const repo = new DexieReadingProgressRepository();

    expect(await repo.get("local:missing.cbz:10")).toBeNull();

    const localInput = createLocalInput("sample:01.cbz", 4096, {
      currentPageIndex: 5,
      totalPageCount: 24,
      readStatus: "reading",
      spreadPageOffset: 1,
    });
    await repo.put(localInput);

    expect(await repo.get(localInput.targetKey)).toEqual({
      ...localInput,
      lastReadAt: 1500,
      updatedAt: 1500,
    });

    nowSpy.mockReturnValue(2500);
    const volInput: SaveReadingProgressInput = {
      targetKey: "vol:vol-101",
      volumeId: "vol-101",
      currentPageIndex: 19,
      totalPageCount: 20,
      readStatus: "completed",
      spreadPageOffset: 0,
    };
    await repo.put(volInput);
    expect(await repo.get("vol:vol-101")).toEqual({
      ...volInput,
      lastReadAt: 2500,
      updatedAt: 2500,
    });

    // 不正入力は保存されないこと
    const invalidInputs: SaveReadingProgressInput[] = [
      { ...localInput, targetKey: "other:key" },
      { ...localInput, targetKey: "local:bad" },
      { ...localInput, targetKey: "local:ok.cbz:100", volumeId: "vol-1" },
      { ...volInput, targetKey: "vol:", volumeId: "" },
      { ...volInput, targetKey: "vol:vol-1", volumeId: null },
      { ...volInput, targetKey: "vol:vol-1", volumeId: "vol-2" },
      { ...localInput, totalPageCount: 0, currentPageIndex: 0 },
      { ...localInput, totalPageCount: 1.5, currentPageIndex: 0 },
      { ...localInput, totalPageCount: Number.NaN, currentPageIndex: 0 },
      { ...localInput, currentPageIndex: -1 },
      { ...localInput, currentPageIndex: 24 },
      { ...localInput, currentPageIndex: 1.2 },
      { ...localInput, readStatus: "invalid" as ReadStatus },
      { ...localInput, spreadPageOffset: 2 as 0 | 1 },
    ];
    for (const invalid of invalidInputs) {
      await repo.put(invalid);
    }
    expect(await db.readingProgress.count()).toBe(2);

    await repo.delete(localInput.targetKey);
    expect(await repo.get(localInput.targetKey)).toBeNull();
    expect(await repo.get("vol:vol-101")).not.toBeNull();
  });

  it("getで破損・不整合レコードを検知した場合は即時削除してnullを返すこと (AC-RD-15)", async () => {
    const repo = new DexieReadingProgressRepository(db);
    const base: ReadingProgressRecord = {
      targetKey: "local:ok.cbz:100",
      volumeId: null,
      currentPageIndex: 1,
      totalPageCount: 10,
      readStatus: "reading",
      spreadPageOffset: 0,
      lastReadAt: 1000,
      updatedAt: 1000,
    };

    const corrupted: ReadingProgressRecord[] = [
      { ...base, targetKey: "other:invalid" },
      { ...base, targetKey: "local:missing-size" },
      { ...base, targetKey: "local:mismatch.cbz:10", volumeId: "vol-1" },
      { ...base, targetKey: "vol:", volumeId: "" },
      { ...base, targetKey: "vol:v1", volumeId: null },
      { ...base, targetKey: "vol:v2", volumeId: "other" },
      { ...base, targetKey: "local:zero-pages.cbz:10", totalPageCount: 0 },
      { ...base, targetKey: "local:float-pages.cbz:10", totalPageCount: 2.5 },
      { ...base, targetKey: "local:neg-page.cbz:10", currentPageIndex: -1 },
      { ...base, targetKey: "local:oob-page.cbz:10", currentPageIndex: 10 },
      { ...base, targetKey: "local:float-page.cbz:10", currentPageIndex: 1.5 },
      {
        ...base,
        targetKey: "local:bad-status.cbz:10",
        readStatus: "broken" as ReadStatus,
      },
      {
        ...base,
        targetKey: "local:bad-offset.cbz:10",
        spreadPageOffset: 2 as 0 | 1,
      },
      { ...base, targetKey: "local:nan-last.cbz:10", lastReadAt: Number.NaN },
      {
        ...base,
        targetKey: "local:inf-upd.cbz:10",
        updatedAt: Number.POSITIVE_INFINITY,
      },
    ];

    await db.readingProgress.bulkPut(corrupted);
    expect(await db.readingProgress.count()).toBe(corrupted.length);

    for (const record of corrupted) {
      expect(await repo.get(record.targetKey)).toBeNull();
      expect(await db.readingProgress.get(record.targetKey)).toBeUndefined();
    }
    expect(await db.readingProgress.count()).toBe(0);
  });

  it("local:*のみ最大100件LRU退避しvol:*は一切退避せず同値タイブレークも決定論的に処理すること (AC-RD-15)", async () => {
    let clock = 1000;
    const repo = new DexieReadingProgressRepository(db, {
      now: () => {
        clock += 1;
        return clock;
      },
    });

    // 最古タイムスタンプの vol:* 2件を先行保存
    clock = 1;
    await repo.put({
      targetKey: "vol:keep-1",
      volumeId: "keep-1",
      currentPageIndex: 2,
      totalPageCount: 10,
      readStatus: "reading",
      spreadPageOffset: 0,
    });
    clock = 2;
    await repo.put({
      targetKey: "vol:keep-2",
      volumeId: "keep-2",
      currentPageIndex: 9,
      totalPageCount: 10,
      readStatus: "completed",
      spreadPageOffset: 0,
    });

    // local:* を 100 件保存 (clock: 101 .. 200)
    clock = 100;
    for (let i = 0; i < LOCAL_READING_PROGRESS_MAX_ENTRIES; i += 1) {
      await repo.put(createLocalInput(`book-${i}.cbz`, 1000 + i));
    }
    expect(await db.readingProgress.count()).toBe(102);

    // 101 件目の local:* を保存 -> 最古 local (book-0) のみ退避され vol:* は保持
    await repo.put(createLocalInput("book-100.cbz", 2000));
    expect(await db.readingProgress.count()).toBe(102);
    expect(await repo.get("local:book-0.cbz:1000")).toBeNull();
    expect(await repo.get("local:book-1.cbz:1001")).not.toBeNull();
    expect(await repo.get("local:book-100.cbz:2000")).not.toBeNull();
    expect(await repo.get("vol:keep-1")).not.toBeNull();
    expect(await repo.get("vol:keep-2")).not.toBeNull();

    // カスタム maxLocalEntries=2 での lastReadAt 同値タイブレーク (targetKey 昇順で先頭を削除)
    const customDb = new ExLibrisDatabase("ExLibrisProgressTieBreakDB");
    try {
      let fixedTime = 500;
      const customRepo = new DexieReadingProgressRepository(customDb, {
        maxLocalEntries: 2,
        now: () => fixedTime,
      });

      await customRepo.put(createLocalInput("b.cbz", 10));
      await customRepo.put(createLocalInput("a.cbz", 10));
      fixedTime = 600;
      await customRepo.put(createLocalInput("c.cbz", 10));

      expect(await customRepo.get("local:a.cbz:10")).toBeNull();
      expect(await customRepo.get("local:b.cbz:10")).not.toBeNull();
      expect(await customRepo.get("local:c.cbz:10")).not.toBeNull();

      // 既存キー上書きは上限2件以内のため他を退避しない
      fixedTime = 700;
      await customRepo.put(
        createLocalInput("b.cbz", 10, { currentPageIndex: 12 }),
      );
      expect(await customDb.readingProgress.count()).toBe(2);
      expect((await customRepo.get("local:b.cbz:10"))?.currentPageIndex).toBe(
        12,
      );
      expect(await customRepo.get("local:c.cbz:10")).not.toBeNull();
    } finally {
      await customDb.delete();
    }
  });

  it("listRecentLocalとclearLocalが有効なlocal:*のみを最新順・タイブレーク付きで返しvol:*を保護すること (AC-BS-06, AC-RD-15)", async () => {
    let now = 100;
    const repo = new DexieReadingProgressRepository(db, { now: () => now });

    expect(await repo.listRecentLocal()).toEqual([]);
    expect(await repo.listRecentLocal(0)).toEqual([]);
    expect(await repo.listRecentLocal(-3)).toEqual([]);
    expect(await repo.listRecentLocal(Number.NaN)).toEqual([]);

    now = 9999;
    await repo.put({
      targetKey: "vol:drive-01",
      volumeId: "drive-01",
      currentPageIndex: 1,
      totalPageCount: 10,
      readStatus: "reading",
      spreadPageOffset: 0,
    });

    // 破損した local:* レコード混在時でも安全にスキップすること
    await db.readingProgress.put({
      targetKey: "local:corrupt-no-size",
      volumeId: null,
      currentPageIndex: 0,
      totalPageCount: 5,
      readStatus: "reading",
      spreadPageOffset: 0,
      lastReadAt: 99999,
      updatedAt: 99999,
    });
    await db.readingProgress.put({
      targetKey: "local:corrupt-vol.cbz:100",
      volumeId: "wrong",
      currentPageIndex: 0,
      totalPageCount: 5,
      readStatus: "reading",
      spreadPageOffset: 0,
      lastReadAt: 99999,
      updatedAt: 99999,
    });
    await db.readingProgress.put({
      targetKey: "local:corrupt-page.cbz:100",
      volumeId: null,
      currentPageIndex: 99,
      totalPageCount: 5,
      readStatus: "reading",
      spreadPageOffset: 0,
      lastReadAt: 99999,
      updatedAt: 99999,
    });

    // 12件保存し、同値タイムスタンプ時は targetKey 昇順タイブレークで最新10件を返す
    now = 200;
    await repo.put(createLocalInput("tie-b.cbz", 200));
    await repo.put(createLocalInput("tie-a.cbz", 100));
    for (let i = 1; i <= 10; i += 1) {
      now = 200 + i;
      await repo.put(
        createLocalInput(`series:${i}.cbz`, 1024 * i, {
          currentPageIndex: i,
          totalPageCount: 30,
          readStatus: i === 10 ? "completed" : "reading",
          spreadPageOffset: i % 2 === 0 ? 1 : 0,
        }),
      );
    }

    const defaultRecent = await repo.listRecentLocal();
    expect(defaultRecent).toHaveLength(10);
    expect(defaultRecent[0]).toEqual({
      targetKey: "local:series:10.cbz:10240",
      rawFileName: "series:10.cbz",
      fileSize: 10240,
      currentPageIndex: 10,
      totalPageCount: 30,
      readStatus: "completed",
      spreadPageOffset: 1,
      lastReadAt: 210,
    });
    expect(defaultRecent[9]?.targetKey).toBe("local:series:1.cbz:1024");

    const allValid = await repo.listRecentLocal(20);
    expect(allValid).toHaveLength(12);
    expect(allValid[10]?.targetKey).toBe("local:tie-a.cbz:100");
    expect(allValid[11]?.targetKey).toBe("local:tie-b.cbz:200");

    // clearLocal は local:* のみ全削除し vol:* を残す
    await repo.clearLocal();
    expect(await repo.listRecentLocal()).toEqual([]);
    expect(await repo.get("vol:drive-01")).not.toBeNull();
  });

  it("全操作がFIFO直列化されfire-and-forget直後の読込整合性と前段失敗時のキュー継続性を保つこと (AC-RD-15)", async () => {
    const repo = new DexieReadingProgressRepository(db);

    // 1. put のトランザクションが遅延中でも直後の listRecentLocal / get は put 完了後に実行されること
    const txGate = createDeferred<void>();
    const originalTx = db.transaction.bind(db);
    vi.spyOn(db, "transaction").mockImplementationOnce(((
      ...args: Parameters<typeof db.transaction>
    ) =>
      txGate.promise.then(() =>
        (originalTx as (...inner: unknown[]) => unknown)(...args),
      )) as unknown as typeof db.transaction);

    const input = createLocalInput("fifo.cbz", 512, {
      currentPageIndex: 7,
      totalPageCount: 15,
      spreadPageOffset: 1,
    });
    const order: string[] = [];
    const fireAndForgetPut = repo.put(input).then(() => {
      order.push("put");
    });
    const recentAfterPutPromise = repo.listRecentLocal(10).then((items) => {
      order.push("listRecentLocal");
      return items;
    });
    const getAfterPutPromise = repo.get(input.targetKey).then((record) => {
      order.push("get");
      return record;
    });

    await Promise.resolve();
    expect(order).toEqual([]);

    txGate.resolve();
    await fireAndForgetPut;
    const [recent, got] = await Promise.all([
      recentAfterPutPromise,
      getAfterPutPromise,
    ]);
    expect(order).toEqual(["put", "listRecentLocal", "get"]);
    expect(recent).toHaveLength(1);
    expect(recent[0]?.currentPageIndex).toBe(7);
    expect(got?.spreadPageOffset).toBe(1);

    // 2. 前段操作が失敗しても後続キューが停滞せず正常実行されること
    const getGate = createDeferred<never>();
    vi.spyOn(db.readingProgress, "get").mockImplementationOnce(
      (() => getGate.promise) as unknown as typeof db.readingProgress.get,
    );

    const failingOp = repo.get("local:any.cbz:1");
    const followingOp = repo.listRecentLocal(10);

    getGate.reject(new Error("transient indexeddb failure"));
    await expect(failingOp).rejects.toThrow("transient indexeddb failure");
    await expect(followingOp).resolves.toHaveLength(1);
  });
});
