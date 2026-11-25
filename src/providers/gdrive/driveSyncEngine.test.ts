import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, resetTestDb } from "../../storage/db";
import { DexieDriveSyncMetaRepository } from "../../storage/repositories/driveSyncMetaRepository";
import { DexieDriveSyncRootsRepository } from "../../storage/repositories/driveSyncRootsRepository";
import { DexieSeriesRepository } from "../../storage/repositories/seriesRepository";
import { DexieVolumesRepository } from "../../storage/repositories/volumesRepository";
import { DexieZipIndexCacheRepository } from "../../storage/repositories/zipIndexCacheRepository";
import { DriveApiError } from "./driveApiErrors";
import { GOOGLE_DRIVE_FOLDER_MIME_TYPE } from "./driveHttpClient";
import { DefaultDriveSyncEngine } from "./driveSyncEngine";
import { MockDriveSyncClient } from "./mockDriveSyncClient";
import type { DriveSyncClient, DriveSyncFileItem } from "./types";

function createTestContext(options?: {
  readonly client?: DriveSyncClient;
  readonly now?: () => number;
  readonly maxParentBatchSize?: number;
  readonly maxAncestorDepth?: number;
}) {
  const now = options?.now ?? (() => 1_700_000_000_000);
  const mockClient =
    options?.client === undefined ? new MockDriveSyncClient() : null;
  const driveSyncClient = options?.client ?? mockClient!;
  const driveSyncRootsRepo = new DexieDriveSyncRootsRepository(db, { now });
  const driveSyncMetaRepo = new DexieDriveSyncMetaRepository(db);
  const seriesRepo = new DexieSeriesRepository(db, { now });
  const volumesRepo = new DexieVolumesRepository(db, { now });
  const zipIndexCacheRepo = new DexieZipIndexCacheRepository(db, { now });
  const engine = new DefaultDriveSyncEngine({
    driveSyncClient,
    driveSyncRootsRepo,
    driveSyncMetaRepo,
    seriesRepo,
    volumesRepo,
    zipIndexCacheRepo,
    now,
    maxParentBatchSize: options?.maxParentBatchSize,
    maxAncestorDepth: options?.maxAncestorDepth,
  });

  return {
    mockClient,
    driveSyncClient,
    driveSyncRootsRepo,
    driveSyncMetaRepo,
    seriesRepo,
    volumesRepo,
    zipIndexCacheRepo,
    engine,
  };
}

describe("DefaultDriveSyncEngine", () => {
  beforeEach(async () => {
    await resetTestDb();
  });

  it("有効ルートが0件のときはAPI通信を行わずskipped-no-rootsを返し既存データを保護すること (AC-GD-09)", async () => {
    const ctx = createTestContext();
    const tokenSpy = vi.spyOn(ctx.driveSyncClient, "getStartPageToken");
    const listSpy = vi.spyOn(ctx.driveSyncClient, "listItemsInParents");

    // 1件登録して無効化
    await ctx.driveSyncRootsRepo.upsertRoot({
      folderId: "mock-folder-comics",
      folderName: "Comics",
    });
    await ctx.engine.sync();
    expect(tokenSpy).toHaveBeenCalledTimes(1);

    await ctx.driveSyncRootsRepo.setEnabled("mock-folder-comics", false);
    tokenSpy.mockClear();
    listSpy.mockClear();

    const result = await ctx.engine.sync();
    expect(result).toEqual({
      mode: "skipped-no-roots",
      scannedRoots: 0,
      upsertedVolumes: 0,
      trashedVolumes: 0,
      invalidatedZipCaches: 0,
      syncedAt: 1_700_000_000_000,
    });
    expect(tokenSpy).not.toHaveBeenCalled();
    expect(listSpy).not.toHaveBeenCalled();
    // 既存 volumes は削除されず保持されていること
    const stored = await ctx.volumesRepo.listByRootFolderIds(
      new Set(["mock-folder-comics"]),
    );
    expect(stored.length).toBeGreaterThan(0);
    expect(stored.every((vol) => vol.isTrashed === 0)).toBe(true);
  });

  it("フルスキャンでBFS開始前にstartPageTokenを取得し、多段サブフォルダ・バッチ分割・循環ガード・非アーカイブ＆対象外除外・親フォルダ補完・消失巻ゴミ箱化を行うこと (AC-GD-09, AC-GD-10)", async () => {
    const callOrder: string[] = [];
    const mockClient = new MockDriveSyncClient({ pageSize: 2 });
    // 循環参照フォルダ + ルート直下の数字のみファイル + ゴミ箱済みファイルを追加
    mockClient.upsertItem(
      {
        id: "loop-folder",
        name: "Loop",
        mimeType: GOOGLE_DRIVE_FOLDER_MIME_TYPE,
        parents: ["mock-folder-action", "loop-folder"],
        size: null,
        md5Checksum: null,
        modifiedTime: 1000,
        trashed: false,
      },
      false,
    );
    mockClient.upsertItem(
      {
        id: "root-direct-num",
        name: "02.cbz",
        mimeType: "application/zip",
        parents: ["mock-folder-comics"],
        size: 2048,
        md5Checksum: "md5-root-num",
        modifiedTime: 2000,
        trashed: false,
      },
      false,
    );
    mockClient.upsertItem(
      {
        id: "null-size-zip",
        name: "サイズ未定 第01巻.zip",
        mimeType: "application/zip",
        parents: ["mock-folder-comics"],
        size: null,
        md5Checksum: null,
        modifiedTime: 2000,
        trashed: false,
      },
      false,
    );

    const origGetStart = mockClient.getStartPageToken.bind(mockClient);
    const origListItems = mockClient.listItemsInParents.bind(mockClient);
    vi.spyOn(mockClient, "getStartPageToken").mockImplementation(async (s) => {
      callOrder.push("getStartPageToken");
      return origGetStart(s);
    });
    vi.spyOn(mockClient, "listItemsInParents").mockImplementation(
      async (parents, opts) => {
        callOrder.push(`listItemsInParents:${parents.length}`);
        const page = await origListItems(parents, opts);
        // ゴミ箱済み・無関係親の項目が混入しても無視されること
        return {
          ...page,
          files: [
            ...page.files,
            {
              id: "ignored-trashed",
              name: "trashed.cbz",
              mimeType: "application/zip",
              parents: ["mock-folder-comics"],
              size: 10,
              md5Checksum: null,
              modifiedTime: 100,
              trashed: true,
            },
            {
              id: "ignored-orphan",
              name: "orphan.cbz",
              mimeType: "application/zip",
              parents: ["unrelated-parent"],
              size: 10,
              md5Checksum: null,
              modifiedTime: 100,
              trashed: false,
            },
          ],
        };
      },
    );

    const ctx = createTestContext({
      client: mockClient,
      maxParentBatchSize: 2,
    });
    await ctx.driveSyncRootsRepo.upsertRoot({
      folderId: "mock-folder-comics",
      folderName: "Comics",
    });

    const result1 = await ctx.engine.sync();
    expect(callOrder[0]).toBe("getStartPageToken");
    expect(result1.mode).toBe("full");
    expect(result1.scannedRoots).toBe(1);
    expect(result1.upsertedVolumes).toBe(6);
    expect(result1.trashedVolumes).toBe(0);

    // 対象外フォルダ・README.txt は取り込まれていないこと
    expect(
      await ctx.volumesRepo.getByDriveFileId("mock-file-outside"),
    ).toBeNull();
    expect(
      await ctx.volumesRepo.getByDriveFileId("mock-file-readme"),
    ).toBeNull();

    // サブフォルダ配下の 01.cbz は親フォルダ "[高橋留美子] めぞん一刻" で補完されていること
    const fallbackVol = await ctx.volumesRepo.getByDriveFileId(
      "mock-file-parent-fallback",
    );
    expect(fallbackVol).not.toBeNull();
    const fallbackSeries = await ctx.seriesRepo.getById(fallbackVol!.seriesId);
    expect(fallbackSeries?.title).toBe("めぞん一刻");
    expect(fallbackSeries?.authors).toEqual(["高橋留美子"]);

    // ルート直下の 02.cbz はルートフォルダ名 "Comics" で補完されないこと
    const rootDirectVol =
      await ctx.volumesRepo.getByDriveFileId("root-direct-num");
    const rootDirectSeries = await ctx.seriesRepo.getById(
      rootDirectVol!.seriesId,
    );
    expect(rootDirectSeries?.title).toBe("02");

    // syncMeta に startPageToken と syncedRootFolderIds が保存されていること
    const meta1 = await ctx.driveSyncMetaRepo.getSyncState();
    expect(meta1.startPageToken).toBe("0");
    expect(meta1.syncedRootFolderIds).toEqual(["mock-folder-comics"]);

    // 別ルート（mock-folder-manga）を追加すると未同期ルート検知で自動フルスキャン切替
    await ctx.driveSyncRootsRepo.upsertRoot({
      folderId: "mock-folder-manga",
      folderName: "自炊マンガ",
    });
    const result2 = await ctx.engine.sync();
    expect(result2.mode).toBe("full");
    expect(result2.scannedRoots).toBe(2);
    expect(
      await ctx.volumesRepo.getByDriveFileId("mock-file-manga-1"),
    ).not.toBeNull();

    // mock-folder-manga を無効化した上で mock-file-vol2 を削除して forceFullScan
    // -> 有効ルートの消失巻のみ isTrashed=1 となり、無効化ルートの mock-file-manga-1 は保護されること
    await ctx.driveSyncRootsRepo.setEnabled("mock-folder-manga", false);
    mockClient.removeItem("mock-file-vol2", false);
    const result3 = await ctx.engine.sync({ forceFullScan: true });
    expect(result3.mode).toBe("full");
    expect(result3.trashedVolumes).toBe(1);
    expect(
      (await ctx.volumesRepo.getByDriveFileId("mock-file-vol2"))?.isTrashed,
    ).toBe(1);
    expect(
      (await ctx.volumesRepo.getByDriveFileId("mock-file-manga-1"))?.isTrashed,
    ).toBe(0);
    // syncedRootFolderIds は有効ルートのみで上書きされていること
    expect(
      (await ctx.driveSyncMetaRepo.getSyncState()).syncedRootFolderIds,
    ).toEqual(["mock-folder-comics"]);

    // 無効化していたルートを再有効化すると syncedRootFolderIds 不一致で自動フルスキャン
    await ctx.driveSyncRootsRepo.setEnabled("mock-folder-manga", true);
    const result4 = await ctx.engine.sync();
    expect(result4.mode).toBe("full");
    expect(result4.scannedRoots).toBe(2);
  });

  it("changes.list増分同期で複数変更畳み込み・未知親フォルダ遡り（メモ化/ゴミ箱祖先打切り/循環・深度ガード）・無効ルート保護・フォルダ変更＆410自動フルスキャン切替を行うこと (AC-GD-10)", async () => {
    const mockClient = new MockDriveSyncClient({ pageSize: 2 });
    const ctx = createTestContext({
      client: mockClient,
      maxAncestorDepth: 3,
    });

    await ctx.driveSyncRootsRepo.upsertRoot({
      folderId: "mock-folder-comics",
      folderName: "Comics",
    });
    await ctx.driveSyncRootsRepo.upsertRoot({
      folderId: "mock-folder-manga",
      folderName: "自炊マンガ",
    });
    await ctx.engine.sync();

    // mock-folder-manga を一時無効化（この配下の既存巻は増分同期の削除イベントでも保護される）
    await ctx.driveSyncRootsRepo.setEnabled("mock-folder-manga", false);
    // syncedRootFolderIds を mock-folder-comics のみに揃えるため1回差分同期
    const prep = await ctx.engine.sync();
    expect(prep.mode).toBe("incremental");

    // 1. 未知の深層サブフォルダを事前に配置（recordChange=false でフォルダ変更イベント自体は出さない）
    mockClient.upsertItem(
      {
        id: "deep-sub-1",
        name: "新着シリーズ",
        mimeType: GOOGLE_DRIVE_FOLDER_MIME_TYPE,
        parents: ["mock-folder-action"],
        size: null,
        md5Checksum: null,
        modifiedTime: 3000,
        trashed: false,
      },
      false,
    );
    // ゴミ箱祖先フォルダ
    mockClient.upsertItem(
      {
        id: "trashed-ancestor",
        name: "ゴミ箱親",
        mimeType: GOOGLE_DRIVE_FOLDER_MIME_TYPE,
        parents: ["mock-folder-comics"],
        size: null,
        md5Checksum: null,
        modifiedTime: 3000,
        trashed: true,
      },
      false,
    );
    mockClient.upsertItem(
      {
        id: "child-of-trashed",
        name: "子フォルダ",
        mimeType: GOOGLE_DRIVE_FOLDER_MIME_TYPE,
        parents: ["trashed-ancestor"],
        size: null,
        md5Checksum: null,
        modifiedTime: 3000,
        trashed: false,
      },
      false,
    );
    mockClient.upsertItem(
      {
        id: "grandchild-of-trashed",
        name: "孫フォルダ",
        mimeType: GOOGLE_DRIVE_FOLDER_MIME_TYPE,
        parents: ["child-of-trashed"],
        size: null,
        md5Checksum: null,
        modifiedTime: 3000,
        trashed: false,
      },
      false,
    );
    // 循環祖先フォルダ
    mockClient.upsertItem(
      {
        id: "cycle-a",
        name: "CycleA",
        mimeType: GOOGLE_DRIVE_FOLDER_MIME_TYPE,
        parents: ["cycle-b"],
        size: null,
        md5Checksum: null,
        modifiedTime: 3000,
        trashed: false,
      },
      false,
    );
    mockClient.upsertItem(
      {
        id: "cycle-b",
        name: "CycleB",
        mimeType: GOOGLE_DRIVE_FOLDER_MIME_TYPE,
        parents: ["cycle-a"],
        size: null,
        md5Checksum: null,
        modifiedTime: 3000,
        trashed: false,
      },
      false,
    );
    // 深度上限超過フォルダチェーン (depth > 3)
    mockClient.upsertItem(
      {
        id: "d1",
        name: "D1",
        mimeType: GOOGLE_DRIVE_FOLDER_MIME_TYPE,
        parents: ["mock-folder-comics"],
        size: null,
        md5Checksum: null,
        modifiedTime: 3000,
        trashed: false,
      },
      false,
    );
    mockClient.upsertItem(
      {
        id: "d2",
        name: "D2",
        mimeType: GOOGLE_DRIVE_FOLDER_MIME_TYPE,
        parents: ["d1"],
        size: null,
        md5Checksum: null,
        modifiedTime: 3000,
        trashed: false,
      },
      false,
    );
    mockClient.upsertItem(
      {
        id: "d3",
        name: "D3",
        mimeType: GOOGLE_DRIVE_FOLDER_MIME_TYPE,
        parents: ["d2"],
        size: null,
        md5Checksum: null,
        modifiedTime: 3000,
        trashed: false,
      },
      false,
    );
    mockClient.upsertItem(
      {
        id: "d4",
        name: "D4",
        mimeType: GOOGLE_DRIVE_FOLDER_MIME_TYPE,
        parents: ["d3"],
        size: null,
        md5Checksum: null,
        modifiedTime: 3000,
        trashed: false,
      },
      false,
    );

    // 同一 fileId への連続変更（畳み込みで最新のみ適用）+ メモ化確認用2本目
    mockClient.upsertItem({
      id: "inc-new-1",
      name: "仮タイトル 第01巻.cbz",
      mimeType: "application/zip",
      parents: ["deep-sub-1"],
      size: 1000,
      md5Checksum: "m1",
      modifiedTime: 4000,
      trashed: false,
    });
    mockClient.upsertItem({
      id: "inc-new-1",
      name: "確定タイトル 第01巻.cbz",
      mimeType: "application/zip",
      parents: ["deep-sub-1"],
      size: 2000,
      md5Checksum: "m2",
      modifiedTime: 5000,
      trashed: false,
    });
    mockClient.upsertItem({
      id: "inc-new-2",
      name: "確定タイトル 第02巻.cbz",
      mimeType: "application/zip",
      parents: ["deep-sub-1"],
      size: 2100,
      md5Checksum: "m3",
      modifiedTime: 5100,
      trashed: false,
    });
    // ゴミ箱祖先配下・循環祖先配下・深度超過・親なし・非アーカイブ・対象外フォルダ変更は無視
    mockClient.upsertItem({
      id: "under-trashed",
      name: "ゴミ箱祖先.cbz",
      mimeType: "application/zip",
      parents: ["child-of-trashed"],
      size: 500,
      md5Checksum: null,
      modifiedTime: 5200,
      trashed: false,
    });
    mockClient.upsertItem({
      id: "under-grandchild-trashed",
      name: "ゴミ箱孫.cbz",
      mimeType: "application/zip",
      parents: ["grandchild-of-trashed"],
      size: 500,
      md5Checksum: null,
      modifiedTime: 5200,
      trashed: false,
    });
    mockClient.upsertItem({
      id: "under-cycle",
      name: "循環祖先.cbz",
      mimeType: "application/zip",
      parents: ["cycle-a"],
      size: 500,
      md5Checksum: null,
      modifiedTime: 5200,
      trashed: false,
    });
    mockClient.upsertItem({
      id: "under-deep",
      name: "深度超過.cbz",
      mimeType: "application/zip",
      parents: ["d4"],
      size: 500,
      md5Checksum: null,
      modifiedTime: 5200,
      trashed: false,
    });
    mockClient.upsertItem({
      id: "no-parent-zip",
      name: "親なし.cbz",
      mimeType: "application/zip",
      parents: [],
      size: 500,
      md5Checksum: null,
      modifiedTime: 5200,
      trashed: false,
    });
    mockClient.upsertItem({
      id: "outside-folder-change",
      name: "対象外サブフォルダ",
      mimeType: GOOGLE_DRIVE_FOLDER_MIME_TYPE,
      parents: ["mock-folder-other"],
      size: null,
      md5Checksum: null,
      modifiedTime: 5200,
      trashed: false,
    });
    // 有効ルート所属の既存巻をルート外へ移動 -> isTrashed=1
    mockClient.upsertItem({
      id: "mock-file-vol2",
      name: "[尾田栄一郎] ONE PIECE 第02巻.zip",
      mimeType: "application/zip",
      parents: ["mock-folder-other"],
      size: 13_456_789,
      md5Checksum: "md5-op-02",
      modifiedTime: 5300,
      trashed: false,
    });
    // 有効ルート所属の既存巻を非アーカイブ拡張子へリネーム -> isTrashed=1
    mockClient.upsertItem({
      id: "mock-file-omnibus",
      name: "AKIRA.txt",
      mimeType: "text/plain",
      parents: ["mock-folder-scifi"],
      size: 45_000_000,
      md5Checksum: "md5-akira-0103",
      modifiedTime: 5400,
      trashed: false,
    });
    // 無効化中ルート所属の既存巻に removed イベントが来ても保護（isTrashed=0 のまま）
    mockClient.removeItem("mock-file-manga-1");
    // 未登録ファイルの削除・非アーカイブ新規は無視
    mockClient.removeItem("never-tracked-id");
    mockClient.upsertItem({
      id: "untracked-txt",
      name: "memo.txt",
      mimeType: "text/plain",
      parents: ["mock-folder-comics"],
      size: 100,
      md5Checksum: null,
      modifiedTime: 5500,
      trashed: false,
    });

    const incResult = await ctx.engine.sync();
    expect(incResult.mode).toBe("incremental");
    expect(incResult.upsertedVolumes).toBe(2);
    expect(incResult.trashedVolumes).toBe(2);

    const incVol1 = await ctx.volumesRepo.getByDriveFileId("inc-new-1");
    expect(incVol1?.rawFileName).toBe("確定タイトル 第01巻.cbz");
    expect(incVol1?.rootFolderId).toBe("mock-folder-comics");
    expect(await ctx.volumesRepo.getByDriveFileId("under-trashed")).toBeNull();
    expect(await ctx.volumesRepo.getByDriveFileId("under-cycle")).toBeNull();
    expect(await ctx.volumesRepo.getByDriveFileId("under-deep")).toBeNull();
    expect(await ctx.volumesRepo.getByDriveFileId("no-parent-zip")).toBeNull();
    expect(
      (await ctx.volumesRepo.getByDriveFileId("mock-file-vol2"))?.isTrashed,
    ).toBe(1);
    expect(
      (await ctx.volumesRepo.getByDriveFileId("mock-file-omnibus"))?.isTrashed,
    ).toBe(1);
    // 無効化中ルート所属の巻は保護されていること
    expect(
      (await ctx.volumesRepo.getByDriveFileId("mock-file-manga-1"))?.isTrashed,
    ).toBe(0);

    // 2. フォルダ変更イベント（有効ルート配下サブフォルダのリネーム）-> 自動フルスキャン切替
    mockClient.upsertItem({
      id: "new-sub-under-root",
      name: "新サブフォルダ",
      mimeType: GOOGLE_DRIVE_FOLDER_MIME_TYPE,
      parents: ["mock-folder-comics"],
      size: null,
      md5Checksum: null,
      modifiedTime: 6000,
      trashed: false,
    });
    const folderFallback1 = await ctx.engine.sync();
    expect(folderFallback1.mode).toBe("full");

    // 3. 既存親フォルダの removed イベント -> 自動フルスキャン切替
    mockClient.pushChange({
      fileId: "mock-folder-action",
      removed: true,
      file: null,
    });
    const folderFallback2 = await ctx.engine.sync();
    expect(folderFallback2.mode).toBe("full");

    // 4. 既存親フォルダ自身の変更イベント -> 自動フルスキャン切替
    mockClient.pushChange({
      fileId: "mock-folder-action",
      removed: false,
      file: {
        id: "mock-folder-action",
        name: "アクション改",
        mimeType: GOOGLE_DRIVE_FOLDER_MIME_TYPE,
        parents: ["mock-folder-comics"],
        size: null,
        md5Checksum: null,
        modifiedTime: 6100,
        trashed: false,
      },
    });
    const folderFallback3 = await ctx.engine.sync();
    expect(folderFallback3.mode).toBe("full");

    // 5. 410 TOKEN_EXPIRED 発生 -> 自動フルスキャン切替
    mockClient.expireAllIssuedTokens();
    const expiredFallback = await ctx.engine.sync();
    expect(expiredFallback.mode).toBe("full");
  });

  it("リネーム・移動時の再パース追従 vs 手動ロック/手動編集済み保護、MD5/サイズ変化時のZipIndexCache削除・表紙リセット・LWW updatedAt非汚染を保証すること (AC-GD-11, AC-GD-12)", async () => {
    let clock = 1_700_000_000_000;
    const mockClient = new MockDriveSyncClient();
    const ctx = createTestContext({
      client: mockClient,
      now: () => clock,
    });

    await ctx.driveSyncRootsRepo.upsertRoot({
      folderId: "mock-folder-comics",
      folderName: "Comics",
    });
    await ctx.engine.sync();

    const vol1Before =
      (await ctx.volumesRepo.getByDriveFileId("mock-file-vol1"))!;
    const vol2Before =
      (await ctx.volumesRepo.getByDriveFileId("mock-file-vol2"))!;
    const omnibusBefore =
      (await ctx.volumesRepo.getByDriveFileId("mock-file-omnibus"))!;
    const series1Before = (await ctx.seriesRepo.getById(vol1Before.seriesId))!;

    // ZipIndexCache と表紙・ロック・手動編集状態を仕込む
    const oldCacheKey = `gdrive:mock-file-vol1:${vol1Before.md5Checksum}`;
    await ctx.zipIndexCacheRepo.put(oldCacheKey, [
      {
        pageIndex: 0,
        entryName: "001.jpg",
        entryNameByteLength: 7,
        compressionMethod: 0,
        compressedSize: 100,
        uncompressedSize: 100,
        localHeaderOffset: 0,
        physicalEnd: 137,
        crc32: 0,
      },
    ]);
    await db.volumes.put({
      ...vol1Before,
      coverBlob: new Blob(["img"]),
      coverStatus: "ready",
      coverUpdatedAt: clock,
    });
    // vol2 は手動編集済み（updatedAt !== addedAt）
    await db.volumes.put({
      ...vol2Before,
      updatedAt: vol2Before.addedAt + 5_000,
    });
    // omnibus 所属シリーズは metadataLocked = true
    const omnibusSeries = (await ctx.seriesRepo.getById(
      omnibusBefore.seriesId,
    ))!;
    await db.series.put({
      ...omnibusSeries,
      metadataLocked: true,
    });

    clock += 60_000;

    // 1. vol1: 未手動編集＆未ロック -> リネーム + MD5 変更 -> 再パース追従 + 旧 ZipIndexCache 削除 + 表紙リセット + updatedAt 不変
    mockClient.upsertItem({
      id: "mock-file-vol1",
      name: "[尾田栄一郎] 新シリーズ名 第05巻.cbz",
      mimeType: "application/zip",
      parents: ["mock-folder-action"],
      size: 12_345_678,
      md5Checksum: "md5-op-01-v2",
      modifiedTime: clock,
      trashed: false,
    });
    // 2. vol2: 手動編集済み -> リネームされても seriesId・volumeNumber・volumeLabel を維持し物理情報のみ更新
    mockClient.upsertItem({
      id: "mock-file-vol2",
      name: "[別作者] 別タイトル 第99巻.zip",
      mimeType: "application/zip",
      parents: ["mock-folder-action"],
      size: 13_456_789,
      md5Checksum: "md5-op-02",
      modifiedTime: clock,
      trashed: false,
    });
    // 3. omnibus: metadataLocked=true -> リネームされてもシリーズ・巻情報を維持
    mockClient.upsertItem({
      id: "mock-file-omnibus",
      name: "[別作者] ロック無視テスト 第10巻.cbz",
      mimeType: "application/zip",
      parents: ["mock-folder-scifi"],
      size: 45_000_000,
      md5Checksum: "md5-akira-0103",
      modifiedTime: clock,
      trashed: false,
    });

    const incResult = await ctx.engine.sync();
    expect(incResult.mode).toBe("incremental");
    expect(incResult.invalidatedZipCaches).toBe(1);

    // vol1 検証
    const vol1After =
      (await ctx.volumesRepo.getByDriveFileId("mock-file-vol1"))!;
    expect(vol1After.volumeNumber).toBe(5);
    expect(vol1After.volumeLabel).toBe("第05巻");
    expect(vol1After.seriesId).not.toBe(vol1Before.seriesId);
    expect(vol1After.updatedAt).toBe(vol1Before.updatedAt);
    expect(vol1After.coverBlob).toBeNull();
    expect(vol1After.coverStatus).toBe("pending");
    expect(vol1After.coverUpdatedAt).toBeNull();
    expect(await ctx.zipIndexCacheRepo.get(oldCacheKey)).toBeNull();

    // 旧シリーズの updatedAt も汚染されていないこと
    const series1After = (await ctx.seriesRepo.getById(series1Before.id))!;
    expect(series1After.updatedAt).toBe(series1Before.updatedAt);

    // vol2（手動編集済み）検証: seriesId/volumeNumber/volumeLabel 維持、rawFileName 更新
    const vol2After =
      (await ctx.volumesRepo.getByDriveFileId("mock-file-vol2"))!;
    expect(vol2After.seriesId).toBe(vol2Before.seriesId);
    expect(vol2After.volumeNumber).toBe(vol2Before.volumeNumber);
    expect(vol2After.volumeLabel).toBe(vol2Before.volumeLabel);
    expect(vol2After.rawFileName).toBe("[別作者] 別タイトル 第99巻.zip");
    expect(vol2After.updatedAt).toBe(vol2Before.addedAt + 5_000);

    // omnibus（シリーズロック済み）検証: seriesId/volumeNumber/volumeLabel 維持
    const omnibusAfter =
      (await ctx.volumesRepo.getByDriveFileId("mock-file-omnibus"))!;
    expect(omnibusAfter.seriesId).toBe(omnibusBefore.seriesId);
    expect(omnibusAfter.volumeNumber).toBe(omnibusBefore.volumeNumber);
    expect(omnibusAfter.volumeLabel).toBe(omnibusBefore.volumeLabel);
    expect(omnibusAfter.rawFileName).toBe(
      "[別作者] ロック無視テスト 第10巻.cbz",
    );

    // ファイル名・親フォルダ変化なし＋サイズのみ変化の更新（再パースせずキャッシュ無効化）
    mockClient.upsertItem({
      id: "mock-file-vol1",
      name: vol1After.rawFileName,
      mimeType: "application/zip",
      parents: ["mock-folder-action"],
      size: 99_999_999,
      md5Checksum: vol1After.md5Checksum,
      modifiedTime: clock + 1000,
      trashed: false,
    });
    const sizeChangeResult = await ctx.engine.sync();
    expect(sizeChangeResult.invalidatedZipCaches).toBe(1);

    // フルスキャン時の MD5 変化でも invalidatedZipCaches が加算されること
    mockClient.upsertItem(
      {
        id: "mock-file-vol1",
        name: vol1After.rawFileName,
        mimeType: "application/zip",
        parents: ["mock-folder-action"],
        size: 99_999_999,
        md5Checksum: "md5-op-01-v3",
        modifiedTime: clock + 2000,
        trashed: false,
      },
      false,
    );
    const fullInvalidationResult = await ctx.engine.sync({
      forceFullScan: true,
    });
    expect(fullInvalidationResult.mode).toBe("full");
    expect(fullInvalidationResult.invalidatedZipCaches).toBe(1);
  });

  it("内部排他ロックで多重sync()を直列化し、途中失敗やAbortError時はdriveStartPageTokenを一切進めないこと (AC-GD-13)", async () => {
    const events: string[] = [];
    let releaseFirstScan!: () => void;
    const firstScanBlocker = new Promise<void>((resolve) => {
      releaseFirstScan = resolve;
    });

    const mockClient = new MockDriveSyncClient();
    const origGetStart = mockClient.getStartPageToken.bind(mockClient);
    let callCount = 0;
    vi.spyOn(mockClient, "getStartPageToken").mockImplementation(async (s) => {
      callCount += 1;
      events.push(`start-${callCount}`);
      if (callCount === 1) {
        await firstScanBlocker;
      }
      const token = await origGetStart(s);
      events.push(`end-token-${callCount}`);
      return token;
    });

    const ctx = createTestContext({ client: mockClient });
    await ctx.driveSyncRootsRepo.upsertRoot({
      folderId: "mock-folder-comics",
      folderName: "Comics",
    });

    const p1 = ctx.engine.sync();
    const p2 = ctx.engine.sync();
    releaseFirstScan();

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1.mode).toBe("full");
    expect(r2.mode).toBe("incremental");
    // 2回目は1回目の full scan 完了後に開始されるため getStartPageToken は1回のみ
    expect(events).toEqual(["start-1", "end-token-1"]);

    const metaBeforeFail = await ctx.driveSyncMetaRepo.getSyncState();

    // 途中失敗（NETWORK_ERROR）時は startPageToken を進めないこと
    mockClient.setInjectedError(new DriveApiError("NETWORK_ERROR", "offline"));
    await expect(ctx.engine.sync()).rejects.toMatchObject({
      code: "NETWORK_ERROR",
    });
    expect(await ctx.driveSyncMetaRepo.getSyncState()).toEqual(metaBeforeFail);

    // AbortError 時も startPageToken を進めないこと
    mockClient.setInjectedError(null);
    const aborted = new AbortController();
    aborted.abort();
    await expect(
      ctx.engine.sync({ signal: aborted.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(await ctx.driveSyncMetaRepo.getSyncState()).toEqual(metaBeforeFail);

    // newStartPageToken が null で終了するモック境界でも既存トークンを安全に保持すること
    const nullTokenClient: DriveSyncClient = {
      getStartPageToken: vi.fn(async () => "tok-0"),
      listItemsInParents: vi.fn(async () => ({
        files: [],
        nextPageToken: null,
      })),
      getFileMetadata: vi.fn(async () => null),
      listChanges: vi.fn(async () => ({
        changes: [],
        nextPageToken: null,
        newStartPageToken: null,
      })),
    };
    const ctxNull = createTestContext({ client: nullTokenClient });
    await ctxNull.engine.sync();
    expect(
      (await ctxNull.driveSyncMetaRepo.getSyncState()).startPageToken,
    ).toBe(metaBeforeFail.startPageToken);
  });

  it("changes.listでgetFileMetadataがnullまたはparents空配列を返した場合は即座にルート外と判定し、既存巻のゴミ箱化を行うこと (AC-GD-10)", async () => {
    const fileMap = new Map<string, DriveSyncFileItem>();
    const customClient: DriveSyncClient = {
      getStartPageToken: vi.fn(async () => "tok-1"),
      listItemsInParents: vi.fn(async () => ({
        files: [
          {
            id: "v-1",
            name: "テスト 第01巻.cbz",
            mimeType: "application/zip",
            parents: ["root-1"],
            size: 100,
            md5Checksum: "m1",
            modifiedTime: 1000,
            trashed: false,
          },
        ],
        nextPageToken: null,
      })),
      getFileMetadata: vi.fn(async (id) => fileMap.get(id) ?? null),
      listChanges: vi.fn(async () => ({
        changes: [
          {
            fileId: "v-1",
            removed: false,
            file: {
              id: "v-1",
              name: "テスト 第01巻.cbz",
              mimeType: "application/zip",
              parents: ["inaccessible-parent"],
              size: 100,
              md5Checksum: "m1",
              modifiedTime: 2000,
              trashed: false,
            },
          },
          {
            fileId: "v-2",
            removed: false,
            file: {
              id: "v-2",
              name: "孤立親 第01巻.cbz",
              mimeType: "application/zip",
              parents: ["orphan-parent"],
              size: 100,
              md5Checksum: "m2",
              modifiedTime: 2000,
              trashed: false,
            },
          },
          {
            fileId: "v-3",
            removed: false,
            file: {
              id: "v-3",
              name: "ゴミ箱直接.cbz",
              mimeType: "application/zip",
              parents: ["root-1"],
              size: 100,
              md5Checksum: "m3",
              modifiedTime: 2000,
              trashed: true,
            },
          },
        ],
        nextPageToken: null,
        newStartPageToken: "tok-2",
      })),
    };
    fileMap.set("orphan-parent", {
      id: "orphan-parent",
      name: "Orphan",
      mimeType: GOOGLE_DRIVE_FOLDER_MIME_TYPE,
      parents: [],
      size: null,
      md5Checksum: null,
      modifiedTime: 1000,
      trashed: false,
    });

    const ctx = createTestContext({ client: customClient });
    await ctx.driveSyncRootsRepo.upsertRoot({
      folderId: "root-1",
      folderName: "Root 1",
    });
    await ctx.engine.sync();

    const inc = await ctx.engine.sync();
    expect(inc.mode).toBe("incremental");
    expect(inc.trashedVolumes).toBe(1);
    expect((await ctx.volumesRepo.getByDriveFileId("v-1"))?.isTrashed).toBe(1);
    expect(await ctx.volumesRepo.getByDriveFileId("v-2")).toBeNull();

    // now 省略時の既定 Date.now フォールバック
    const defaultClockEngine = new DefaultDriveSyncEngine({
      driveSyncClient: customClient,
      driveSyncRootsRepo: ctx.driveSyncRootsRepo,
      driveSyncMetaRepo: ctx.driveSyncMetaRepo,
      seriesRepo: ctx.seriesRepo,
      volumesRepo: ctx.volumesRepo,
      zipIndexCacheRepo: ctx.zipIndexCacheRepo,
    });
    const resDefaultClock = await defaultClockEngine.sync();
    expect(Number.isFinite(resDefaultClock.syncedAt)).toBe(true);
  });
});
