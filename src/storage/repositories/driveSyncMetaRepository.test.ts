import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db, resetTestDb } from "../db";
import {
  DRIVE_START_PAGE_TOKEN_META_KEY,
  DexieDriveSyncMetaRepository,
  LAST_DRIVE_SYNC_AT_META_KEY,
  SYNCED_FOLDER_IDS_META_KEY,
  SYNCED_ROOT_FOLDER_IDS_META_KEY,
} from "./driveSyncMetaRepository";

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("DexieDriveSyncMetaRepository", () => {
  beforeEach(async () => {
    await resetTestDb();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await resetTestDb();
  });

  it("未保存時の初期状態取得・4キー原子保存（正規化・重複排除・昇順ソート）・null削除・clearSyncStateが正しく動作すること (AC-GD-10)", async () => {
    const repo = new DexieDriveSyncMetaRepository();

    expect(await repo.getSyncState()).toEqual({
      startPageToken: null,
      lastDriveSyncAt: null,
      syncedRootFolderIds: [],
      syncedFolderIds: null,
    });

    const saved = await repo.saveSyncState({
      startPageToken: "  token-100  ",
      lastDriveSyncAt: 1700000000000,
      syncedRootFolderIds: [" root-b ", "root-a", "root-b", "   ", "root-c"],
      syncedFolderIds: [" sub-b ", "sub-a", "sub-b", "   "],
    });
    expect(saved).toEqual({
      startPageToken: "token-100",
      lastDriveSyncAt: 1700000000000,
      syncedRootFolderIds: ["root-a", "root-b", "root-c"],
      syncedFolderIds: ["sub-a", "sub-b"],
    });

    expect(await db.syncMeta.get(DRIVE_START_PAGE_TOKEN_META_KEY)).toEqual({
      key: DRIVE_START_PAGE_TOKEN_META_KEY,
      value: "token-100",
    });
    expect(await db.syncMeta.get(LAST_DRIVE_SYNC_AT_META_KEY)).toEqual({
      key: LAST_DRIVE_SYNC_AT_META_KEY,
      value: "1700000000000",
    });
    expect(await db.syncMeta.get(SYNCED_ROOT_FOLDER_IDS_META_KEY)).toEqual({
      key: SYNCED_ROOT_FOLDER_IDS_META_KEY,
      value: JSON.stringify(["root-a", "root-b", "root-c"]),
    });
    expect(await db.syncMeta.get(SYNCED_FOLDER_IDS_META_KEY)).toEqual({
      key: SYNCED_FOLDER_IDS_META_KEY,
      value: JSON.stringify(["sub-a", "sub-b"]),
    });

    expect(await repo.getSyncState()).toEqual({
      startPageToken: "token-100",
      lastDriveSyncAt: 1700000000000,
      syncedRootFolderIds: ["root-a", "root-b", "root-c"],
      syncedFolderIds: ["sub-a", "sub-b"],
    });

    // 空白トークン・非有限日時・null指定時は該当キーを削除して正規化保存すること
    const clearedToken = await repo.saveSyncState({
      startPageToken: "   ",
      lastDriveSyncAt: Number.NaN,
      syncedRootFolderIds: ["root-z"],
      syncedFolderIds: null,
    });
    expect(clearedToken).toEqual({
      startPageToken: null,
      lastDriveSyncAt: null,
      syncedRootFolderIds: ["root-z"],
      syncedFolderIds: null,
    });
    expect(
      await db.syncMeta.get(DRIVE_START_PAGE_TOKEN_META_KEY),
    ).toBeUndefined();
    expect(await db.syncMeta.get(LAST_DRIVE_SYNC_AT_META_KEY)).toBeUndefined();
    expect(await db.syncMeta.get(SYNCED_FOLDER_IDS_META_KEY)).toBeUndefined();

    // null 明示保存・空配列保存（サブフォルダ 0 件）も安全に区別して受け入れること
    const nullSaved = await repo.saveSyncState({
      startPageToken: null,
      lastDriveSyncAt: null,
      syncedRootFolderIds: [],
      syncedFolderIds: [],
    });
    expect(nullSaved).toEqual({
      startPageToken: null,
      lastDriveSyncAt: null,
      syncedRootFolderIds: [],
      syncedFolderIds: [],
    });
    expect(await db.syncMeta.get(SYNCED_FOLDER_IDS_META_KEY)).toEqual({
      key: SYNCED_FOLDER_IDS_META_KEY,
      value: "[]",
    });

    // clearSyncState で 4 キーのみが削除され他キーは保持されること
    await db.syncMeta.put({ key: "otherKey", value: "keep" });
    await repo.saveSyncState({
      startPageToken: "tok-2",
      lastDriveSyncAt: 2000,
      syncedRootFolderIds: ["root-1"],
      syncedFolderIds: ["sub-1"],
    });
    await repo.clearSyncState();

    expect(await repo.getSyncState()).toEqual({
      startPageToken: null,
      lastDriveSyncAt: null,
      syncedRootFolderIds: [],
      syncedFolderIds: null,
    });
    expect(await db.syncMeta.get(SYNCED_FOLDER_IDS_META_KEY)).toBeUndefined();
    expect(await db.syncMeta.get("otherKey")).toEqual({
      key: "otherKey",
      value: "keep",
    });
  });

  it("破損したトークン・非有限数値・壊れたJSONや非配列や空要素混入のsyncedRootFolderIds/syncedFolderIdsを自動削除してフォールバックすること", async () => {
    const repo = new DexieDriveSyncMetaRepository(db);

    // 空白トークン・非数値 lastDriveSyncAt・JSON構文エラー
    await db.syncMeta.bulkPut([
      { key: DRIVE_START_PAGE_TOKEN_META_KEY, value: "   " },
      { key: LAST_DRIVE_SYNC_AT_META_KEY, value: "not-a-number" },
      { key: SYNCED_ROOT_FOLDER_IDS_META_KEY, value: "{broken-json" },
      { key: SYNCED_FOLDER_IDS_META_KEY, value: "{broken-json" },
    ]);
    expect(await repo.getSyncState()).toEqual({
      startPageToken: null,
      lastDriveSyncAt: null,
      syncedRootFolderIds: [],
      syncedFolderIds: null,
    });
    expect(
      await db.syncMeta.get(DRIVE_START_PAGE_TOKEN_META_KEY),
    ).toBeUndefined();
    expect(await db.syncMeta.get(LAST_DRIVE_SYNC_AT_META_KEY)).toBeUndefined();
    expect(
      await db.syncMeta.get(SYNCED_ROOT_FOLDER_IDS_META_KEY),
    ).toBeUndefined();
    expect(await db.syncMeta.get(SYNCED_FOLDER_IDS_META_KEY)).toBeUndefined();

    // 非文字列トークン・空白文字の lastDriveSyncAt・非配列 JSON
    await db.syncMeta.bulkPut([
      {
        key: DRIVE_START_PAGE_TOKEN_META_KEY,
        value: 123 as unknown as string,
      },
      { key: LAST_DRIVE_SYNC_AT_META_KEY, value: "   " },
      {
        key: SYNCED_ROOT_FOLDER_IDS_META_KEY,
        value: JSON.stringify({ root: "a" }),
      },
      {
        key: SYNCED_FOLDER_IDS_META_KEY,
        value: JSON.stringify({ sub: "a" }),
      },
    ]);
    expect(await repo.getSyncState()).toEqual({
      startPageToken: null,
      lastDriveSyncAt: null,
      syncedRootFolderIds: [],
      syncedFolderIds: null,
    });
    expect(
      await db.syncMeta.get(DRIVE_START_PAGE_TOKEN_META_KEY),
    ).toBeUndefined();
    expect(await db.syncMeta.get(LAST_DRIVE_SYNC_AT_META_KEY)).toBeUndefined();
    expect(
      await db.syncMeta.get(SYNCED_ROOT_FOLDER_IDS_META_KEY),
    ).toBeUndefined();
    expect(await db.syncMeta.get(SYNCED_FOLDER_IDS_META_KEY)).toBeUndefined();

    // Infinity の lastDriveSyncAt・空要素混入配列
    await db.syncMeta.bulkPut([
      { key: LAST_DRIVE_SYNC_AT_META_KEY, value: "Infinity" },
      {
        key: SYNCED_ROOT_FOLDER_IDS_META_KEY,
        value: JSON.stringify(["root-1", "   "]),
      },
      {
        key: SYNCED_FOLDER_IDS_META_KEY,
        value: JSON.stringify(["sub-1", "   "]),
      },
    ]);
    expect(await repo.getSyncState()).toEqual({
      startPageToken: null,
      lastDriveSyncAt: null,
      syncedRootFolderIds: [],
      syncedFolderIds: null,
    });
    expect(await db.syncMeta.get(LAST_DRIVE_SYNC_AT_META_KEY)).toBeUndefined();
    expect(
      await db.syncMeta.get(SYNCED_ROOT_FOLDER_IDS_META_KEY),
    ).toBeUndefined();
    expect(await db.syncMeta.get(SYNCED_FOLDER_IDS_META_KEY)).toBeUndefined();

    // 非文字列要素混入配列・非文字列 lastDriveSyncAt・非文字列 syncedRootFolderIds/syncedFolderIds
    await db.syncMeta.bulkPut([
      {
        key: LAST_DRIVE_SYNC_AT_META_KEY,
        value: null as unknown as string,
      },
      {
        key: SYNCED_ROOT_FOLDER_IDS_META_KEY,
        value: JSON.stringify(["root-1", 42]),
      },
      {
        key: SYNCED_FOLDER_IDS_META_KEY,
        value: JSON.stringify(["sub-1", 99]),
      },
    ]);
    expect(await repo.getSyncState()).toEqual({
      startPageToken: null,
      lastDriveSyncAt: null,
      syncedRootFolderIds: [],
      syncedFolderIds: null,
    });
    expect(
      await db.syncMeta.get(SYNCED_ROOT_FOLDER_IDS_META_KEY),
    ).toBeUndefined();
    expect(await db.syncMeta.get(SYNCED_FOLDER_IDS_META_KEY)).toBeUndefined();

    await db.syncMeta.bulkPut([
      {
        key: SYNCED_ROOT_FOLDER_IDS_META_KEY,
        value: 999 as unknown as string,
      },
      {
        key: SYNCED_FOLDER_IDS_META_KEY,
        value: 888 as unknown as string,
      },
    ]);
    expect(await repo.getSyncState()).toEqual({
      startPageToken: null,
      lastDriveSyncAt: null,
      syncedRootFolderIds: [],
      syncedFolderIds: null,
    });
    expect(
      await db.syncMeta.get(SYNCED_ROOT_FOLDER_IDS_META_KEY),
    ).toBeUndefined();
    expect(await db.syncMeta.get(SYNCED_FOLDER_IDS_META_KEY)).toBeUndefined();

    // 有効な未ソート配列はトリム・重複排除・昇順ソートで正規化返却されること
    await db.syncMeta.bulkPut([
      {
        key: SYNCED_ROOT_FOLDER_IDS_META_KEY,
        value: JSON.stringify([" root-b ", "root-a", "root-a"]),
      },
      {
        key: SYNCED_FOLDER_IDS_META_KEY,
        value: JSON.stringify([" sub-b ", "sub-a", "sub-a"]),
      },
    ]);
    const validState = await repo.getSyncState();
    expect(validState.syncedRootFolderIds).toEqual(["root-a", "root-b"]);
    expect(validState.syncedFolderIds).toEqual(["sub-a", "sub-b"]);
  });

  it("全操作がFIFO直列化され前段失敗時も後続キューが停滞しないこと", async () => {
    const repo = new DexieDriveSyncMetaRepository(db);

    const txGate = createDeferred<void>();
    const originalTx = db.transaction.bind(db);
    vi.spyOn(db, "transaction").mockImplementationOnce(((
      ...args: Parameters<typeof db.transaction>
    ) =>
      txGate.promise.then(() =>
        (originalTx as (...inner: unknown[]) => unknown)(...args),
      )) as unknown as typeof db.transaction);

    const order: string[] = [];
    const op1 = repo
      .saveSyncState({
        startPageToken: "tok-fifo",
        lastDriveSyncAt: 100,
        syncedRootFolderIds: ["r1"],
        syncedFolderIds: ["s1"],
      })
      .then(() => {
        order.push("save");
      });
    const op2 = repo.getSyncState().then((state) => {
      order.push("get");
      return state;
    });
    const op3 = repo.clearSyncState().then(() => {
      order.push("clear");
    });

    await Promise.resolve();
    expect(order).toEqual([]);

    txGate.resolve();
    await op1;
    const state = await op2;
    await op3;

    expect(order).toEqual(["save", "get", "clear"]);
    expect(state.startPageToken).toBe("tok-fifo");
    expect(state.syncedFolderIds).toEqual(["s1"]);
    expect(await repo.getSyncState()).toEqual({
      startPageToken: null,
      lastDriveSyncAt: null,
      syncedRootFolderIds: [],
      syncedFolderIds: null,
    });

    // 前段操作が失敗しても後続キューが継続実行されること
    const failGate = createDeferred<never>();
    vi.spyOn(db.syncMeta, "bulkGet").mockImplementationOnce(
      (() => failGate.promise) as unknown as typeof db.syncMeta.bulkGet,
    );
    const failingGet = repo.getSyncState();
    const followingSave = repo.saveSyncState({
      startPageToken: "tok-after-error",
      lastDriveSyncAt: 500,
      syncedRootFolderIds: ["r2"],
      syncedFolderIds: ["s2"],
    });

    failGate.reject(new Error("transient syncMeta error"));
    await expect(failingGet).rejects.toThrow("transient syncMeta error");
    await expect(followingSave).resolves.toEqual({
      startPageToken: "tok-after-error",
      lastDriveSyncAt: 500,
      syncedRootFolderIds: ["r2"],
      syncedFolderIds: ["s2"],
    });
  });
});
