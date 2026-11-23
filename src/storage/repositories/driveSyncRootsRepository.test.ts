import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db, resetTestDb } from "../db";
import type { DriveSyncRootRecord } from "../types";
import { DexieDriveSyncRootsRepository } from "./driveSyncRootsRepository";

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("DexieDriveSyncRootsRepository", () => {
  beforeEach(async () => {
    await resetTestDb();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await resetTestDb();
  });

  it("upsertRoot・listActive・countEnabled・setEnabled・removeRootのTombstone論理削除と再登録復活が正しく動作すること (AC-ST-02, AC-ST-04)", async () => {
    let clock = 1000;
    const repo = new DexieDriveSyncRootsRepository(db, {
      now: () => clock,
    });

    expect(await repo.listActive()).toEqual([]);
    expect(await repo.countEnabled()).toBe(0);

    // 空白のみの入力は拒否すること
    await expect(
      repo.upsertRoot({ folderId: "  ", folderName: "Comics" }),
    ).rejects.toThrow();
    await expect(
      repo.upsertRoot({ folderId: "f1", folderName: "   " }),
    ).rejects.toThrow();

    // 1件目・2件目・3件目を登録（同値 addedAt タイブレーク確認含む）
    clock = 2000;
    const r2 = await repo.upsertRoot({
      folderId: " folder-b ",
      folderName: " マンガB ",
    });
    expect(r2).toEqual({
      folderId: "folder-b",
      folderName: "マンガB",
      enabled: 1,
      addedAt: 2000,
      updatedAt: 2000,
      deletedAt: null,
    });

    const r1 = await repo.upsertRoot({
      folderId: "folder-a",
      folderName: "マンガA",
    });
    expect(r1.addedAt).toBe(2000);

    clock = 1500;
    await repo.upsertRoot({
      folderId: "folder-0",
      folderName: "マンガ0",
    });

    // listActive は addedAt 昇順・同値時は folderId 昇順
    expect((await repo.listActive()).map((r) => r.folderId)).toEqual([
      "folder-0",
      "folder-a",
      "folder-b",
    ]);
    expect(await repo.countEnabled()).toBe(3);

    // setEnabled(false) で一時無効化（listActive には残るが countEnabled は減る）
    clock = 3000;
    const disabledA = await repo.setEnabled(" folder-a ", false);
    expect(disabledA).toEqual({
      folderId: "folder-a",
      folderName: "マンガA",
      enabled: 0,
      addedAt: 2000,
      updatedAt: 3000,
      deletedAt: null,
    });
    expect(await repo.listActive()).toHaveLength(3);
    expect(await repo.countEnabled()).toBe(2);

    // setEnabled(true) で再有効化、未登録・空IDは null
    clock = 3500;
    expect(await repo.setEnabled("folder-a", true)).toMatchObject({
      enabled: 1,
      updatedAt: 3500,
    });
    expect(await repo.setEnabled("missing-folder", true)).toBeNull();
    expect(await repo.setEnabled("   ", true)).toBeNull();
    expect(await repo.countEnabled()).toBe(3);

    // removeRoot で物理削除せず Tombstone (enabled: 0, deletedAt: now) を残すこと
    clock = 4000;
    await repo.removeRoot(" folder-b ");
    await repo.removeRoot("missing-folder");
    await repo.removeRoot("  ");
    const tombstoned = await db.driveSyncRoots.get("folder-b");
    expect(tombstoned).toEqual({
      folderId: "folder-b",
      folderName: "マンガB",
      enabled: 0,
      addedAt: 2000,
      updatedAt: 4000,
      deletedAt: 4000,
    });
    // 既に Tombstone 済みの行へ再度 removeRoot / setEnabled しても状態を壊さないこと
    clock = 4100;
    await repo.removeRoot("folder-b");
    expect((await db.driveSyncRoots.get("folder-b"))?.deletedAt).toBe(4000);
    expect(await repo.setEnabled("folder-b", true)).toBeNull();

    expect((await repo.listActive()).map((r) => r.folderId)).toEqual([
      "folder-0",
      "folder-a",
    ]);
    expect(await repo.countEnabled()).toBe(2);

    // Tombstone 済み folderId を再登録すると元の addedAt を維持したまま復活すること
    clock = 5000;
    const revived = await repo.upsertRoot({
      folderId: "folder-b",
      folderName: "マンガB（再登録）",
    });
    expect(revived).toEqual({
      folderId: "folder-b",
      folderName: "マンガB（再登録）",
      enabled: 1,
      addedAt: 2000,
      updatedAt: 5000,
      deletedAt: null,
    });
    expect((await repo.listActive()).map((r) => r.folderId)).toEqual([
      "folder-0",
      "folder-a",
      "folder-b",
    ]);
    expect(await repo.countEnabled()).toBe(3);
  });

  it("破損レコードをlistActive/countEnabled/setEnabled/removeRoot/upsertRootで除外・自動削除し、deletedAt!==nullかつenabled===1の不整合行をcountEnabledから除外すること", async () => {
    let clock = 9000;
    const repo = new DexieDriveSyncRootsRepository(undefined, {
      now: () => clock,
    });

    const corruptedRows: DriveSyncRootRecord[] = [
      {
        folderId: "   ",
        folderName: "BlankId",
        enabled: 1,
        addedAt: 100,
        updatedAt: 100,
        deletedAt: null,
      },
      {
        folderId: "bad-name",
        folderName: "   ",
        enabled: 1,
        addedAt: 100,
        updatedAt: 100,
        deletedAt: null,
      },
      {
        folderId: "bad-enabled",
        folderName: "BadEnabled",
        enabled: 2 as 0 | 1,
        addedAt: 100,
        updatedAt: 100,
        deletedAt: null,
      },
      {
        folderId: "bad-addedAt",
        folderName: "BadAdded",
        enabled: 1,
        addedAt: Number.NaN,
        updatedAt: 100,
        deletedAt: null,
      },
      {
        folderId: "bad-updatedAt",
        folderName: "BadUpdated",
        enabled: 1,
        addedAt: 100,
        updatedAt: Number.POSITIVE_INFINITY,
        deletedAt: null,
      },
      {
        folderId: "bad-deletedAt",
        folderName: "BadDeleted",
        enabled: 1,
        addedAt: 100,
        updatedAt: 100,
        deletedAt: Number.NaN,
      },
    ];
    await db.driveSyncRoots.bulkPut(corruptedRows);

    // 不整合: deletedAt !== null なのに enabled === 1 になっているレコード（Tombstone なので countEnabled に含めてはならない）
    await db.driveSyncRoots.put({
      folderId: "tombstone-enabled-1",
      folderName: "DeletedButOne",
      enabled: 1,
      addedAt: 100,
      updatedAt: 200,
      deletedAt: 200,
    });
    await db.driveSyncRoots.put({
      folderId: "valid-enabled",
      folderName: "ValidEnabled",
      enabled: 1,
      addedAt: 300,
      updatedAt: 300,
      deletedAt: null,
    });
    await db.driveSyncRoots.put({
      folderId: "valid-disabled",
      folderName: "ValidDisabled",
      enabled: 0,
      addedAt: 400,
      updatedAt: 400,
      deletedAt: null,
    });

    // countEnabled は deletedAt === null && enabled === 1 のみカウントし破損行を削除する
    expect(await repo.countEnabled()).toBe(1);
    expect(await db.driveSyncRoots.get("bad-name")).toBeUndefined();
    expect(await db.driveSyncRoots.get("tombstone-enabled-1")).toBeDefined();

    // listActive でも破損行が混在していた場合に除外・自動削除する
    await db.driveSyncRoots.put(corruptedRows[1]!);
    expect((await repo.listActive()).map((r) => r.folderId)).toEqual([
      "valid-enabled",
      "valid-disabled",
    ]);
    expect(await db.driveSyncRoots.get("bad-name")).toBeUndefined();

    // 個別 setEnabled / removeRoot / upsertRoot も破損レコードを安全処理する
    await db.driveSyncRoots.put(corruptedRows[2]!);
    expect(await repo.setEnabled("bad-enabled", true)).toBeNull();
    expect(await db.driveSyncRoots.get("bad-enabled")).toBeUndefined();

    await db.driveSyncRoots.put(corruptedRows[3]!);
    await repo.removeRoot("bad-addedAt");
    expect(await db.driveSyncRoots.get("bad-addedAt")).toBeUndefined();

    await db.driveSyncRoots.put(corruptedRows[4]!);
    clock = 9500;
    const fixedUpsert = await repo.upsertRoot({
      folderId: "bad-updatedAt",
      folderName: "RepairedFolder",
    });
    expect(fixedUpsert).toEqual({
      folderId: "bad-updatedAt",
      folderName: "RepairedFolder",
      enabled: 1,
      addedAt: 9500,
      updatedAt: 9500,
      deletedAt: null,
    });
  });

  it("全操作がFIFO直列化され前段失敗時も後続キューが停滞しないこと", async () => {
    const repo = new DexieDriveSyncRootsRepository(db);

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
      .upsertRoot({ folderId: "fifo-root", folderName: "FIFO" })
      .then(() => {
        order.push("upsert");
      });
    const op2 = repo.setEnabled("fifo-root", false).then(() => {
      order.push("disable");
    });
    const op3 = repo.countEnabled().then((count) => {
      order.push("count");
      return count;
    });
    const op4 = repo.listActive().then((items) => {
      order.push("list");
      return items;
    });

    await Promise.resolve();
    expect(order).toEqual([]);

    txGate.resolve();
    await op1;
    await op2;
    const count = await op3;
    const list = await op4;

    expect(order).toEqual(["upsert", "disable", "count", "list"]);
    expect(count).toBe(0);
    expect(list).toHaveLength(1);
    expect(list[0]?.enabled).toBe(0);

    // 前段操作が失敗しても後続キューが継続実行されること
    const failGate = createDeferred<never>();
    vi.spyOn(db.driveSyncRoots, "toArray").mockImplementationOnce(
      (() => failGate.promise) as unknown as typeof db.driveSyncRoots.toArray,
    );
    const failingCount = repo.countEnabled();
    const followingList = repo.listActive();

    failGate.reject(new Error("transient indexeddb error"));
    await expect(failingCount).rejects.toThrow("transient indexeddb error");
    await expect(followingList).resolves.toHaveLength(1);
  });
});
