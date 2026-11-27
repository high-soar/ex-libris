import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db, resetTestDb } from "../db";
import type { VolumeRecord } from "../types";
import {
  DexieVolumesRepository,
  compareVolumesForDisplay,
  isValidVolumeRecord,
} from "./volumesRepository";

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function createValidVolume(
  overrides: Partial<VolumeRecord> = {},
): VolumeRecord {
  return {
    id: "vol-1",
    seriesId: "series-1",
    volumeNumber: 1,
    volumeLabel: "第01巻",
    rawFileName: "作品 第01巻.cbz",
    driveFileId: "drive-file-1",
    parentFolderId: "folder-sub",
    rootFolderId: "root-1",
    fileSize: 1024,
    md5Checksum: "md5-aaa",
    driveModifiedTime: 1000,
    coverBlob: null,
    coverStatus: "pending",
    coverCropMode: "auto",
    coverPageIndex: 0,
    coverUpdatedAt: null,
    isTrashed: 0,
    addedAt: 1000,
    updatedAt: 1000,
    ...overrides,
  };
}

describe("DexieVolumesRepository", () => {
  beforeEach(async () => {
    await resetTestDb();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await resetTestDb();
  });

  it("compareVolumesForDisplayが巻数昇順(null末尾)・単巻優先(合本後)・volumeLabel・rawFileName・id昇順で決定論ソートすること", () => {
    const v1Single = createValidVolume({
      id: "id-b",
      volumeNumber: 1,
      volumeLabel: "第01巻",
      rawFileName: "b.cbz",
    });
    const v1Special = createValidVolume({
      id: "id-a",
      volumeNumber: 1,
      volumeLabel: "第01巻 特装版",
      rawFileName: "a.cbz",
    });
    const v1Omnibus = createValidVolume({
      id: "id-0",
      volumeNumber: 1,
      volumeLabel: "第01-05巻 合本",
      rawFileName: "0.cbz",
    });
    const v1SameLabelFileA = createValidVolume({
      id: "id-z",
      volumeNumber: 1,
      volumeLabel: "第01巻",
      rawFileName: "a.cbz",
    });
    const v1SameFileIdA = createValidVolume({
      id: "id-a",
      volumeNumber: 1,
      volumeLabel: "第01巻",
      rawFileName: "b.cbz",
    });
    const v10_5 = createValidVolume({
      id: "id-105",
      volumeNumber: 10.5,
      volumeLabel: "第10.5巻",
      rawFileName: "10_5.cbz",
    });
    const vNull = createValidVolume({
      id: "id-null",
      volumeNumber: null,
      volumeLabel: "単巻",
      rawFileName: "oneshot.cbz",
    });

    const sorted = [
      vNull,
      v10_5,
      v1Omnibus,
      v1Special,
      v1Single,
      v1SameFileIdA,
      v1SameLabelFileA,
    ].sort(compareVolumesForDisplay);

    expect(
      sorted.map((v) => `${v.volumeLabel}|${v.rawFileName}|${v.id}`),
    ).toEqual([
      "第01巻|a.cbz|id-z",
      "第01巻|b.cbz|id-a",
      "第01巻|b.cbz|id-b",
      "第01巻 特装版|a.cbz|id-a",
      "第01-05巻 合本|0.cbz|id-0",
      "第10.5巻|10_5.cbz|id-105",
      "単巻|oneshot.cbz|id-null",
    ]);

    expect(compareVolumesForDisplay(v1Single, v1Single)).toBe(0);
    expect(compareVolumesForDisplay(vNull, v1Single)).toBe(1);
    expect(compareVolumesForDisplay(v1Single, vNull)).toBe(-1);
    expect(compareVolumesForDisplay(v1Omnibus, v1Single)).toBe(1);
    expect(compareVolumesForDisplay(v1Single, v1Omnibus)).toBe(-1);
    expect(compareVolumesForDisplay(v1Special, v1Single)).toBeGreaterThan(0);
    expect(
      compareVolumesForDisplay(v1Single, v1SameLabelFileA),
    ).toBeGreaterThan(0);
    expect(compareVolumesForDisplay(v1Single, v1SameFileIdA)).toBeGreaterThan(
      0,
    );
  });

  it("upsertFromDriveSyncの新規作成・既存更新時updatedAt非汚染・MD5/fileSize変化時invalidatedCacheKey返却と表紙リセット・無変化時表紙保持が正しく動作すること (AC-GD-11)", async () => {
    let clock = 1000;
    let seq = 0;
    const repo = new DexieVolumesRepository(db, {
      now: () => clock,
      idGenerator: () => {
        seq += 1;
        return `vol-gen-${seq}`;
      },
    });

    // 不正入力の拒否
    await expect(
      repo.upsertFromDriveSync({
        seriesId: "   ",
        volumeNumber: 1,
        volumeLabel: "第01巻",
        rawFileName: "a.cbz",
        driveFileId: "df-1",
        parentFolderId: null,
        rootFolderId: "r-1",
        fileSize: 100,
        md5Checksum: null,
        driveModifiedTime: 1000,
      }),
    ).rejects.toThrow();
    await expect(
      repo.upsertFromDriveSync({
        seriesId: "s-1",
        volumeNumber: -1,
        volumeLabel: "第01巻",
        rawFileName: "a.cbz",
        driveFileId: "df-1",
        parentFolderId: null,
        rootFolderId: "r-1",
        fileSize: 100,
        md5Checksum: null,
        driveModifiedTime: 1000,
      }),
    ).rejects.toThrow();
    await expect(
      repo.upsertFromDriveSync({
        seriesId: "s-1",
        volumeNumber: 1,
        volumeLabel: "第01巻",
        rawFileName: "a.cbz",
        driveFileId: "df-1",
        parentFolderId: null,
        rootFolderId: "r-1",
        fileSize: -1,
        md5Checksum: null,
        driveModifiedTime: 1000,
      }),
    ).rejects.toThrow();
    await expect(
      repo.upsertFromDriveSync({
        seriesId: "s-1",
        volumeNumber: 1,
        volumeLabel: "第01巻",
        rawFileName: "a.cbz",
        driveFileId: "df-1",
        parentFolderId: null,
        rootFolderId: "r-1",
        fileSize: 100,
        md5Checksum: null,
        driveModifiedTime: Number.NaN,
      }),
    ).rejects.toThrow();

    // 新規作成
    const created = await repo.upsertFromDriveSync({
      seriesId: " s-1 ",
      volumeNumber: 1,
      volumeLabel: "第01巻",
      rawFileName: " 作品 第01巻.cbz ",
      driveFileId: " df-1 ",
      parentFolderId: "   ",
      rootFolderId: " root-1 ",
      fileSize: 2048,
      md5Checksum: " md5-v1 ",
      driveModifiedTime: 1000,
    });
    expect(created).toEqual({
      created: true,
      invalidatedCacheKey: null,
      volume: {
        id: "vol-gen-1",
        seriesId: "s-1",
        volumeNumber: 1,
        volumeLabel: "第01巻",
        rawFileName: "作品 第01巻.cbz",
        driveFileId: "df-1",
        parentFolderId: null,
        rootFolderId: "root-1",
        fileSize: 2048,
        md5Checksum: "md5-v1",
        driveModifiedTime: 1000,
        coverBlob: null,
        coverStatus: "pending",
        coverCropMode: "auto",
        coverPageIndex: 0,
        coverUpdatedAt: null,
        isTrashed: 0,
        addedAt: 1000,
        updatedAt: 1000,
      },
    });

    // 表紙抽出済み＋ユーザー手動編集（updatedAt: 1500）状態をセット
    const coverBlob = new Blob(["fake-webp"], { type: "image/webp" });
    await db.volumes.put({
      ...created.volume,
      coverBlob,
      coverStatus: "ready",
      coverCropMode: "left-half",
      coverPageIndex: 2,
      coverUpdatedAt: 1400,
      updatedAt: 1500,
    });

    // MD5/fileSize 変化なしの更新 → 表紙を完全保持し updatedAt も非汚染
    clock = 3000;
    const sameBinaryUpdate = await repo.upsertFromDriveSync({
      seriesId: "s-1",
      volumeNumber: 1,
      volumeLabel: "第01巻",
      rawFileName: "作品 第01巻_renamed.cbz",
      driveFileId: "df-1",
      parentFolderId: "sub-2",
      rootFolderId: "root-1",
      fileSize: 2048,
      md5Checksum: "md5-v1",
      driveModifiedTime: 2500,
    });
    expect(sameBinaryUpdate.created).toBe(false);
    expect(sameBinaryUpdate.invalidatedCacheKey).toBeNull();
    expect(sameBinaryUpdate.volume.coverStatus).toBe("ready");
    expect(sameBinaryUpdate.volume.coverBlob).not.toBeNull();
    expect(sameBinaryUpdate.volume.coverUpdatedAt).toBe(1400);
    expect(sameBinaryUpdate.volume.coverCropMode).toBe("left-half");
    expect(sameBinaryUpdate.volume.coverPageIndex).toBe(2);
    expect(sameBinaryUpdate.volume.updatedAt).toBe(1500);
    expect(sameBinaryUpdate.volume.addedAt).toBe(1000);

    // MD5 変化時 → 旧キー invalidatedCacheKey 返却、表紙リセット、updatedAt は依然非汚染
    clock = 4000;
    const md5Changed = await repo.upsertFromDriveSync({
      seriesId: "s-1",
      volumeNumber: 1,
      volumeLabel: "第01巻",
      rawFileName: "作品 第01巻_renamed.cbz",
      driveFileId: "df-1",
      parentFolderId: "sub-2",
      rootFolderId: "root-1",
      fileSize: 2048,
      md5Checksum: null,
      driveModifiedTime: 3500,
    });
    expect(md5Changed.created).toBe(false);
    expect(md5Changed.invalidatedCacheKey).toBe("gdrive:df-1:md5-v1");
    expect(md5Changed.volume.coverBlob).toBeNull();
    expect(md5Changed.volume.coverStatus).toBe("pending");
    expect(md5Changed.volume.coverUpdatedAt).toBeNull();
    expect(md5Changed.volume.updatedAt).toBe(1500);

    // md5Checksum === null の状態で fileSize 変化時 → prev.fileSize 基準の invalidatedCacheKey 返却
    clock = 5000;
    const sizeChanged = await repo.upsertFromDriveSync({
      seriesId: "s-1",
      volumeNumber: 1,
      volumeLabel: "第01巻",
      rawFileName: "作品 第01巻_renamed.cbz",
      driveFileId: "df-1",
      parentFolderId: "sub-2",
      rootFolderId: "root-1",
      fileSize: 4096,
      md5Checksum: null,
      driveModifiedTime: 4500,
      isTrashed: 0,
    });
    expect(sizeChanged.invalidatedCacheKey).toBe("gdrive:df-1:2048");
    expect(sizeChanged.volume.updatedAt).toBe(1500);

    // デフォルト idGenerator による新規作成確認
    const defaultRepo = new DexieVolumesRepository();
    const autoIdResult = await defaultRepo.upsertFromDriveSync({
      seriesId: "s-2",
      volumeNumber: null,
      volumeLabel: "単巻",
      rawFileName: "oneshot.cbz",
      driveFileId: "df-auto",
      parentFolderId: null,
      rootFolderId: "root-1",
      fileSize: 512,
      md5Checksum: "   ",
      driveModifiedTime: 1000,
    });
    expect(autoIdResult.volume.id.length).toBeGreaterThan(0);
    expect(autoIdResult.volume.md5Checksum).toBeNull();
  });

  it("getById・getByDriveFileId・listBySeriesId・listVisibleByEnabledRoots・listByRootFolderIds・markTrashedByDriveFileIdsが正しく動作すること (AC-GD-09, AC-GD-10)", async () => {
    const repo = new DexieVolumesRepository(db);

    await db.volumes.bulkPut([
      createValidVolume({
        id: "v-r1-2",
        seriesId: "s-1",
        volumeNumber: 2,
        volumeLabel: "第02巻",
        driveFileId: "df-2",
        rootFolderId: "root-1",
        isTrashed: 0,
        updatedAt: 2000,
      }),
      createValidVolume({
        id: "v-r1-1",
        seriesId: "s-1",
        volumeNumber: 1,
        volumeLabel: "第01巻",
        driveFileId: "df-1",
        rootFolderId: "root-1",
        isTrashed: 0,
        updatedAt: 1000,
      }),
      createValidVolume({
        id: "v-r1-trashed",
        seriesId: "s-1",
        volumeNumber: 3,
        volumeLabel: "第03巻",
        driveFileId: "df-3",
        rootFolderId: "root-1",
        isTrashed: 1,
        updatedAt: 3000,
      }),
      createValidVolume({
        id: "v-r2-1",
        seriesId: "s-2",
        volumeNumber: 1,
        volumeLabel: "第01巻",
        driveFileId: "df-4",
        rootFolderId: "root-2",
        isTrashed: 0,
        updatedAt: 4000,
      }),
    ]);

    expect(await repo.getById("   ")).toBeNull();
    expect(await repo.getById("missing")).toBeNull();
    expect((await repo.getById(" v-r1-1 "))?.driveFileId).toBe("df-1");

    expect(await repo.getByDriveFileId("   ")).toBeNull();
    expect(await repo.getByDriveFileId("missing")).toBeNull();
    expect((await repo.getByDriveFileId(" df-2 "))?.id).toBe("v-r1-2");

    // listBySeriesId: isTrashed === 0 のみ決定論ソート
    expect(await repo.listBySeriesId("   ")).toEqual([]);
    expect((await repo.listBySeriesId(" s-1 ")).map((v) => v.id)).toEqual([
      "v-r1-1",
      "v-r1-2",
    ]);

    // listVisibleByEnabledRoots: 有効ルート所属 かつ isTrashed === 0 のみ
    expect(await repo.listVisibleByEnabledRoots(new Set())).toEqual([]);
    expect(
      (await repo.listVisibleByEnabledRoots(new Set(["root-1"]))).map(
        (v) => v.id,
      ),
    ).toEqual(["v-r1-1", "v-r1-2"]);
    expect(
      (await repo.listVisibleByEnabledRoots(new Set(["root-1", "root-2"]))).map(
        (v) => v.id,
      ),
    ).toEqual(["v-r1-1", "v-r2-1", "v-r1-2"]);

    // listByRootFolderIds: isTrashed 問わず指定ルート全件
    expect(await repo.listByRootFolderIds(new Set())).toEqual([]);
    expect(
      (await repo.listByRootFolderIds(new Set(["root-1"]))).map((v) => v.id),
    ).toEqual(["v-r1-1", "v-r1-2", "v-r1-trashed"]);

    // markTrashedByDriveFileIds: 未存在・既trashed・空白をスキップし updatedAt 非汚染で更新件数を返す
    expect(await repo.markTrashedByDriveFileIds([])).toBe(0);
    expect(await repo.markTrashedByDriveFileIds(["   "])).toBe(0);
    const trashedCount = await repo.markTrashedByDriveFileIds([
      " df-2 ",
      "df-2",
      "df-3",
      "missing-df",
    ]);
    expect(trashedCount).toBe(1);
    const afterTrash = await db.volumes.get("v-r1-2");
    expect(afterTrash?.isTrashed).toBe(1);
    expect(afterTrash?.updatedAt).toBe(2000);
  });

  it("破損レコードを全読み書きメソッドで除外・自動削除すること", async () => {
    const repo = new DexieVolumesRepository(db);

    const invalidCases: VolumeRecord[] = [
      createValidVolume({ id: "   ", driveFileId: "bad-0" }),
      createValidVolume({
        id: "bad-series",
        seriesId: "  ",
        driveFileId: "bad-1",
      }),
      createValidVolume({
        id: "bad-volnum",
        volumeNumber: -1,
        driveFileId: "bad-2",
      }),
      createValidVolume({
        id: "bad-volnum-nan",
        volumeNumber: Number.NaN,
        driveFileId: "bad-3",
      }),
      createValidVolume({
        id: "bad-label",
        volumeLabel: null as unknown as string,
        driveFileId: "bad-4",
      }),
      createValidVolume({
        id: "bad-raw",
        rawFileName: "   ",
        driveFileId: "bad-5",
      }),
      createValidVolume({ id: "bad-df", driveFileId: "   " }),
      createValidVolume({
        id: "bad-parent",
        parentFolderId: "   ",
        driveFileId: "bad-6",
      }),
      createValidVolume({
        id: "bad-root",
        rootFolderId: "  ",
        driveFileId: "bad-7",
      }),
      createValidVolume({
        id: "bad-size",
        fileSize: -10,
        driveFileId: "bad-8",
      }),
      createValidVolume({
        id: "bad-size-float",
        fileSize: 1.5,
        driveFileId: "bad-9",
      }),
      createValidVolume({
        id: "bad-md5",
        md5Checksum: "  ",
        driveFileId: "bad-10",
      }),
      createValidVolume({
        id: "bad-modtime",
        driveModifiedTime: Number.NaN,
        driveFileId: "bad-11",
      }),
      createValidVolume({
        id: "bad-blob",
        coverBlob: "not-a-blob" as unknown as Blob,
        driveFileId: "bad-12",
      }),
      createValidVolume({
        id: "bad-cover-status",
        coverStatus: "loading" as VolumeRecord["coverStatus"],
        driveFileId: "bad-13",
      }),
      createValidVolume({
        id: "bad-crop",
        coverCropMode: "top" as VolumeRecord["coverCropMode"],
        driveFileId: "bad-14",
      }),
      createValidVolume({
        id: "bad-cover-page",
        coverPageIndex: -1,
        driveFileId: "bad-15",
      }),
      createValidVolume({
        id: "bad-cover-updated",
        coverUpdatedAt: Number.POSITIVE_INFINITY,
        driveFileId: "bad-16",
      }),
      createValidVolume({
        id: "bad-trashed",
        isTrashed: 2 as 0 | 1,
        driveFileId: "bad-17",
      }),
      createValidVolume({
        id: "bad-addedAt",
        addedAt: Number.NaN,
        driveFileId: "bad-18",
      }),
      createValidVolume({
        id: "bad-updatedAt",
        updatedAt: Number.NaN,
        driveFileId: "bad-19",
      }),
    ];

    for (const invalid of invalidCases) {
      expect(isValidVolumeRecord(invalid)).toBe(false);
    }
    expect(
      isValidVolumeRecord(
        createValidVolume({
          volumeNumber: null,
          parentFolderId: null,
          md5Checksum: null,
          coverBlob: new Blob(["ok"], { type: "image/webp" }),
          coverStatus: "error",
          coverCropMode: "right-half",
          coverUpdatedAt: 500,
          isTrashed: 1,
        }),
      ),
    ).toBe(true);
    expect(
      isValidVolumeRecord(
        createValidVolume({
          coverStatus: "ready",
          coverCropMode: "full",
        }),
      ),
    ).toBe(true);

    // listVisibleByEnabledRoots で破損レコードを除外・削除
    await db.volumes.bulkPut(invalidCases);
    await db.volumes.put(
      createValidVolume({ id: "valid-vol", driveFileId: "df-ok" }),
    );
    expect(
      (await repo.listVisibleByEnabledRoots(new Set(["root-1"]))).map(
        (v) => v.id,
      ),
    ).toEqual(["valid-vol"]);
    expect(await db.volumes.get("bad-size")).toBeUndefined();

    // getById / getByDriveFileId / listBySeriesId / markTrashedByDriveFileIds / upsertFromDriveSync の個別破損修復
    await db.volumes.put(
      createValidVolume({ id: "c-get", fileSize: -1, driveFileId: "df-c-get" }),
    );
    expect(await repo.getById("c-get")).toBeNull();
    expect(await db.volumes.get("c-get")).toBeUndefined();

    await db.volumes.put(
      createValidVolume({ id: "c-df", fileSize: -1, driveFileId: "df-c-df" }),
    );
    expect(await repo.getByDriveFileId("df-c-df")).toBeNull();
    expect(await db.volumes.get("c-df")).toBeUndefined();

    await db.volumes.put(
      createValidVolume({
        id: "c-series",
        seriesId: "s-corrupt",
        fileSize: -1,
        driveFileId: "df-c-series",
      }),
    );
    expect(await repo.listBySeriesId("s-corrupt")).toEqual([]);
    expect(await db.volumes.get("c-series")).toBeUndefined();

    await db.volumes.put(
      createValidVolume({
        id: "c-trash",
        fileSize: -1,
        driveFileId: "df-c-trash",
      }),
    );
    expect(await repo.markTrashedByDriveFileIds(["df-c-trash"])).toBe(0);
    expect(await db.volumes.get("c-trash")).toBeUndefined();

    await db.volumes.put(
      createValidVolume({
        id: "c-upsert",
        fileSize: -1,
        driveFileId: "df-c-upsert",
      }),
    );
    const repaired = await repo.upsertFromDriveSync({
      seriesId: "s-1",
      volumeNumber: 1,
      volumeLabel: "第01巻",
      rawFileName: "repaired.cbz",
      driveFileId: "df-c-upsert",
      parentFolderId: null,
      rootFolderId: "root-1",
      fileSize: 100,
      md5Checksum: "md5-new",
      driveModifiedTime: 1000,
    });
    expect(repaired.created).toBe(true);
    expect(await db.volumes.get("c-upsert")).toBeUndefined();
  });

  it("全操作がFIFO直列化され前段失敗時も後続キューが停滞しないこと", async () => {
    const repo = new DexieVolumesRepository(db, {
      now: () => 1000,
      idGenerator: () => "fifo-vol",
    });

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
      .upsertFromDriveSync({
        seriesId: "s-1",
        volumeNumber: 1,
        volumeLabel: "第01巻",
        rawFileName: "fifo.cbz",
        driveFileId: "df-fifo",
        parentFolderId: null,
        rootFolderId: "root-1",
        fileSize: 100,
        md5Checksum: "md5-1",
        driveModifiedTime: 1000,
      })
      .then(() => {
        order.push("upsert");
      });
    const op2 = repo.markTrashedByDriveFileIds(["df-fifo"]).then((count) => {
      order.push("trash");
      return count;
    });
    const op3 = repo.getByDriveFileId("df-fifo").then((vol) => {
      order.push("get");
      return vol;
    });

    await Promise.resolve();
    expect(order).toEqual([]);

    txGate.resolve();
    await op1;
    const trashed = await op2;
    const vol = await op3;

    expect(order).toEqual(["upsert", "trash", "get"]);
    expect(trashed).toBe(1);
    expect(vol?.isTrashed).toBe(1);

    // 前段失敗後も後続キューが継続実行されること
    const failGate = createDeferred<never>();
    vi.spyOn(db.volumes, "toArray").mockImplementationOnce(
      (() => failGate.promise) as unknown as typeof db.volumes.toArray,
    );
    const failingList = repo.listByRootFolderIds(new Set(["root-1"]));
    const followingGet = repo.getById("fifo-vol");

    failGate.reject(new Error("transient volumes error"));
    await expect(failingList).rejects.toThrow("transient volumes error");
    await expect(followingGet).resolves.toMatchObject({ id: "fifo-vol" });
  });

  it("saveCoverReady/saveCoverErrorは整合ガード(isTrashed/md5/fileSize)とupdatedAt非汚染を厳守すること (AC-COV-05)", async () => {
    let clock = 10_000;
    const repo = new DexieVolumesRepository(db, { now: () => clock });
    const webpBlob = new Blob([new Uint8Array([1, 2, 3])], {
      type: "image/webp",
    });

    await db.volumes.bulkPut([
      createValidVolume({
        id: "vol-ok",
        driveFileId: "df-ok",
        md5Checksum: "md5-ok",
        fileSize: 2048,
        isTrashed: 0,
        coverStatus: "pending",
        coverBlob: null,
        coverUpdatedAt: null,
        addedAt: 1000,
        updatedAt: 1500,
      }),
      createValidVolume({
        id: "vol-trashed",
        driveFileId: "df-trashed",
        md5Checksum: "md5-t",
        fileSize: 2048,
        isTrashed: 1,
        coverStatus: "pending",
        updatedAt: 1500,
      }),
      createValidVolume({
        id: "vol-corrupt",
        driveFileId: "df-corrupt",
        fileSize: -1,
        md5Checksum: "md5-c",
        updatedAt: 1500,
      }),
    ]);

    // 空 ID / 未存在 / 破損レコード / ゴミ箱化 / md5不一致 / fileSize不一致 は上書きせず null
    expect(
      await repo.saveCoverReady({
        volumeId: "   ",
        expectedMd5Checksum: "md5-ok",
        expectedFileSize: 2048,
        coverBlob: webpBlob,
      }),
    ).toBeNull();
    expect(
      await repo.saveCoverReady({
        volumeId: "missing",
        expectedMd5Checksum: "md5-ok",
        expectedFileSize: 2048,
        coverBlob: webpBlob,
      }),
    ).toBeNull();
    expect(
      await repo.saveCoverReady({
        volumeId: "vol-corrupt",
        expectedMd5Checksum: "md5-c",
        expectedFileSize: -1,
        coverBlob: webpBlob,
      }),
    ).toBeNull();
    expect(await db.volumes.get("vol-corrupt")).toBeUndefined();

    expect(
      await repo.saveCoverReady({
        volumeId: "vol-trashed",
        expectedMd5Checksum: "md5-t",
        expectedFileSize: 2048,
        coverBlob: webpBlob,
      }),
    ).toBeNull();
    expect(
      await repo.saveCoverReady({
        volumeId: "vol-ok",
        expectedMd5Checksum: "md5-diff",
        expectedFileSize: 2048,
        coverBlob: webpBlob,
      }),
    ).toBeNull();
    expect(
      await repo.saveCoverReady({
        volumeId: "vol-ok",
        expectedMd5Checksum: "md5-ok",
        expectedFileSize: 9999,
        coverBlob: webpBlob,
      }),
    ).toBeNull();

    // 整合一致時のみ ready 保存・updatedAt 非変更
    const savedReady = await repo.saveCoverReady({
      volumeId: " vol-ok ",
      expectedMd5Checksum: " md5-ok ",
      expectedFileSize: 2048,
      coverBlob: webpBlob,
    });
    expect(savedReady).not.toBeNull();
    expect(savedReady?.coverStatus).toBe("ready");
    expect(savedReady?.coverBlob).not.toBeNull();
    expect(savedReady?.coverUpdatedAt).toBe(10_000);
    expect(savedReady?.updatedAt).toBe(1500);

    // 明示的 coverUpdatedAt 指定時はその値を採用しつつ updatedAt 非変更
    const savedReadyExplicit = await repo.saveCoverReady({
      volumeId: "vol-ok",
      expectedMd5Checksum: "md5-ok",
      expectedFileSize: 2048,
      coverBlob: webpBlob,
      coverUpdatedAt: 12_345,
    });
    expect(savedReadyExplicit?.coverUpdatedAt).toBe(12_345);
    expect(savedReadyExplicit?.updatedAt).toBe(1500);

    // saveCoverError: 空ID/未存在/破損/不整合は null、整合一致時は coverBlob=null・error 化・updatedAt 非変更
    await db.volumes.put(
      createValidVolume({
        id: "vol-corrupt-err",
        driveFileId: "df-corrupt-err",
        fileSize: -5,
      }),
    );
    expect(
      await repo.saveCoverError({
        volumeId: "  ",
        expectedMd5Checksum: "md5-ok",
        expectedFileSize: 2048,
      }),
    ).toBeNull();
    expect(
      await repo.saveCoverError({
        volumeId: "missing",
        expectedMd5Checksum: "md5-ok",
        expectedFileSize: 2048,
      }),
    ).toBeNull();
    expect(
      await repo.saveCoverError({
        volumeId: "vol-corrupt-err",
        expectedMd5Checksum: null,
        expectedFileSize: -5,
      }),
    ).toBeNull();
    expect(await db.volumes.get("vol-corrupt-err")).toBeUndefined();
    expect(
      await repo.saveCoverError({
        volumeId: "vol-ok",
        expectedMd5Checksum: null,
        expectedFileSize: 2048,
      }),
    ).toBeNull();

    clock = 20_000;
    const savedErr = await repo.saveCoverError({
      volumeId: "vol-ok",
      expectedMd5Checksum: "md5-ok",
      expectedFileSize: 2048,
    });
    expect(savedErr?.coverStatus).toBe("error");
    expect(savedErr?.coverBlob).toBeNull();
    expect(savedErr?.coverUpdatedAt).toBe(20_000);
    expect(savedErr?.updatedAt).toBe(1500);

    const savedErrExplicit = await repo.saveCoverError({
      volumeId: "vol-ok",
      expectedMd5Checksum: "md5-ok",
      expectedFileSize: 2048,
      coverUpdatedAt: 25_000,
    });
    expect(savedErrExplicit?.coverUpdatedAt).toBe(25_000);
    expect(savedErrExplicit?.updatedAt).toBe(1500);
  });

  it("resetErrorCoversToPendingは有効ルート・非ゴミ箱・error巻のみをupdatedAt非汚染でpendingへ戻し表示順ソート済み配列を返すこと (AC-COV-05)", async () => {
    const repo = new DexieVolumesRepository(db);
    const dummyBlob = new Blob([new Uint8Array([9])], { type: "image/webp" });

    await db.volumes.bulkPut([
      createValidVolume({
        id: "v-s1-2",
        seriesId: "s-1",
        volumeNumber: 2,
        volumeLabel: "第02巻",
        driveFileId: "df-s1-2",
        rootFolderId: "root-1",
        coverStatus: "error",
        coverBlob: dummyBlob,
        coverUpdatedAt: 5000,
        updatedAt: 1111,
      }),
      createValidVolume({
        id: "v-s1-1",
        seriesId: "s-1",
        volumeNumber: 1,
        volumeLabel: "第01巻",
        driveFileId: "df-s1-1",
        rootFolderId: "root-1",
        coverStatus: "error",
        coverBlob: null,
        coverUpdatedAt: 5000,
        updatedAt: 2222,
      }),
      createValidVolume({
        id: "v-s1-ready",
        seriesId: "s-1",
        volumeNumber: 3,
        volumeLabel: "第03巻",
        driveFileId: "df-s1-3",
        rootFolderId: "root-1",
        coverStatus: "ready",
        coverBlob: dummyBlob,
        coverUpdatedAt: 5000,
        updatedAt: 3333,
      }),
      createValidVolume({
        id: "v-s1-trashed",
        seriesId: "s-1",
        volumeNumber: 4,
        volumeLabel: "第04巻",
        driveFileId: "df-s1-4",
        rootFolderId: "root-1",
        coverStatus: "error",
        isTrashed: 1,
        updatedAt: 4444,
      }),
      createValidVolume({
        id: "v-s2-1",
        seriesId: "s-2",
        volumeNumber: 1,
        volumeLabel: "第01巻",
        driveFileId: "df-s2-1",
        rootFolderId: "root-1",
        coverStatus: "error",
        updatedAt: 5555,
      }),
      createValidVolume({
        id: "v-disabled-root",
        seriesId: "s-1",
        volumeNumber: 5,
        volumeLabel: "第05巻",
        driveFileId: "df-disabled",
        rootFolderId: "root-2",
        coverStatus: "error",
        updatedAt: 6666,
      }),
    ]);

    // 空ルート集合 / 空 seriesId は空配列
    expect(
      await repo.resetErrorCoversToPending({ enabledRootIds: new Set() }),
    ).toEqual([]);
    expect(
      await repo.resetErrorCoversToPending({
        enabledRootIds: new Set(["root-1"]),
        seriesId: "   ",
      }),
    ).toEqual([]);

    // seriesId 指定時は当該シリーズのみリセット・updatedAt 非変更・表示順ソート
    const resetS1 = await repo.resetErrorCoversToPending({
      enabledRootIds: new Set(["root-1"]),
      seriesId: " s-1 ",
    });
    expect(resetS1.map((v) => v.id)).toEqual(["v-s1-1", "v-s1-2"]);
    expect(resetS1[0]).toMatchObject({
      coverStatus: "pending",
      coverBlob: null,
      coverUpdatedAt: null,
      updatedAt: 2222,
    });
    expect(resetS1[1]).toMatchObject({
      coverStatus: "pending",
      coverBlob: null,
      coverUpdatedAt: null,
      updatedAt: 1111,
    });

    // 対象 0 件時は空配列
    expect(
      await repo.resetErrorCoversToPending({
        enabledRootIds: new Set(["root-1"]),
        seriesId: "s-1",
      }),
    ).toEqual([]);

    // seriesId 省略時は有効ルート配下の残り error 巻（s-2）をリセットし、無効ルート・trashed・ready は非変更
    const resetAll = await repo.resetErrorCoversToPending({
      enabledRootIds: new Set(["root-1"]),
    });
    expect(resetAll.map((v) => v.id)).toEqual(["v-s2-1"]);
    expect(resetAll[0]?.updatedAt).toBe(5555);

    expect((await db.volumes.get("v-s1-ready"))?.coverStatus).toBe("ready");
    expect((await db.volumes.get("v-s1-trashed"))?.coverStatus).toBe("error");
    expect((await db.volumes.get("v-disabled-root"))?.coverStatus).toBe(
      "error",
    );
  });
});
