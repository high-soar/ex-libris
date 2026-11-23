import { describe, expect, it, vi } from "vitest";
import { ENGINE_BUDGETS } from "../constants";
import type {
  ArchiveSourceDescriptor,
  DecodeWorkerApi,
  RandomAccessReader,
  ZipPageEntry,
} from "../types";
import { ZipArchiveError } from "../zip/errors";
import {
  buildSyntheticZip,
  createMemoryReader,
} from "../zip/__fixtures__/zipBuilder";
import { CoordinatorCore } from "./CoordinatorCore";
import { prepareDecodeTransfer } from "./coordinatorTransfer";

interface FakeBitmapWithSpy extends ImageBitmap {
  close: ReturnType<typeof vi.fn>;
}

function createFakeBitmap(width = 800, height = 1200): FakeBitmapWithSpy {
  return {
    width,
    height,
    close: vi.fn(),
  } as unknown as FakeBitmapWithSpy;
}

function createLocalSource(
  bytes: Uint8Array,
  name = "vol01.cbz",
): ArchiveSourceDescriptor {
  const file = new File([bytes as Uint8Array<ArrayBuffer>], name, {
    type: "application/zip",
  });
  return {
    kind: "local-session",
    file,
    rawFileName: name,
    fileSize: file.size,
    indexCacheKey: `local:${name}:${file.size}`,
    progressTargetKey: `local:${name}:${file.size}`,
  };
}

describe("CoordinatorCore", () => {
  it("local-sessionアーカイブを開きFast-Pathと複数ページをデコード返却すること (AC-ENG-07, AC-ENG-08)", async () => {
    const page0Bytes = new Uint8Array([1, 2, 3, 4]);
    const page1Bytes = new Uint8Array([5, 6, 7, 8]);
    const zipBytes = buildSyntheticZip({
      entries: [
        { name: "001.jpg", data: page0Bytes, compressionMethod: 0 },
        { name: "002.png", data: page1Bytes, compressionMethod: 8 },
      ],
    });
    const bitmap0 = createFakeBitmap(1000, 1400);
    const bitmap1 = createFakeBitmap(1000, 1400);

    const decodePool: DecodeWorkerApi = {
      decodePageSlice: vi
        .fn()
        .mockResolvedValueOnce({ bitmap: bitmap0, width: 1000, height: 1400 })
        .mockResolvedValueOnce({ bitmap: bitmap1, width: 1000, height: 1400 }),
    };

    const coordinator = new CoordinatorCore({ decodePool });
    const openResult = await coordinator.openArchive(
      createLocalSource(zipBytes),
      null,
      1,
    );

    expect(openResult.pageCount).toBe(2);
    expect(openResult.fromIndexCache).toBe(false);
    expect(openResult.entries.map((e) => e.entryName)).toEqual([
      "001.jpg",
      "002.png",
    ]);

    const frames = await coordinator.requestVisiblePages([0, 1], [2], 1);
    expect(frames).toEqual([
      {
        status: "ready",
        pageIndex: 0,
        epoch: 1,
        width: 1000,
        height: 1400,
        bitmap: bitmap0,
      },
      {
        status: "ready",
        pageIndex: 1,
        epoch: 1,
        width: 1000,
        height: 1400,
        bitmap: bitmap1,
      },
    ]);
  });

  it("cachedEntries指定時はfromIndexCache=trueを返しDIファクトリとupdateAccessTokenが連携すること", async () => {
    const cachedEntries: ZipPageEntry[] = [
      {
        pageIndex: 0,
        entryName: "001.jpg",
        entryNameByteLength: 7,
        compressionMethod: 0,
        compressedSize: 4,
        uncompressedSize: 4,
        localHeaderOffset: 0,
        physicalEnd: 100,
        crc32: 0,
      },
    ];
    const readRange = vi.fn(async () => new Uint8Array(0));
    const createReader = vi.fn(
      (
        _source: ArchiveSourceDescriptor,
        _token: string | null,
      ): RandomAccessReader => ({
        sourceId: "custom",
        totalSize: 100,
        readRange,
      }),
    );

    const coordinator = new CoordinatorCore({
      decodePool: { decodePageSlice: vi.fn() },
      createReader,
    });
    coordinator.updateAccessToken("token-abc");
    const result = await coordinator.openArchive(
      createLocalSource(new Uint8Array(10)),
      cachedEntries,
      1,
    );

    expect(createReader).toHaveBeenCalledWith(expect.anything(), "token-abc");
    expect(readRange).not.toHaveBeenCalled();
    expect(result).toEqual({
      pageCount: 1,
      entries: cachedEntries,
      fromIndexCache: true,
    });
  });

  it("cachedEntriesが空配列または不正構造の場合はparseZipDirectoryへ透過フォールバックすること (AC-ENG-11)", async () => {
    const zipBytes = buildSyntheticZip({
      entries: [
        {
          name: "001.jpg",
          data: new Uint8Array([1, 2, 3]),
          compressionMethod: 0,
        },
      ],
    });
    const coordinator = new CoordinatorCore({
      decodePool: { decodePageSlice: vi.fn() },
    });

    // 1. 空配列 [] は 0RTT スキップせず parseZipDirectory へフォールバック
    const emptyCacheResult = await coordinator.openArchive(
      createLocalSource(zipBytes),
      [],
      1,
    );
    expect(emptyCacheResult.fromIndexCache).toBe(false);
    expect(emptyCacheResult.pageCount).toBe(1);
    expect(emptyCacheResult.entries.map((e) => e.entryName)).toEqual([
      "001.jpg",
    ]);

    // 2. 構造不正（localHeaderOffset >= physicalEnd・pageIndex不一致等）も透過フォールバック
    const invalidCachedEntries: ZipPageEntry[] = [
      {
        pageIndex: 0,
        entryName: "stale.jpg",
        entryNameByteLength: 9,
        compressionMethod: 0,
        compressedSize: 10,
        uncompressedSize: 10,
        localHeaderOffset: 500,
        physicalEnd: 100,
        crc32: 0,
      },
    ];
    const invalidCacheResult = await coordinator.openArchive(
      createLocalSource(zipBytes),
      invalidCachedEntries,
      2,
    );
    expect(invalidCacheResult.fromIndexCache).toBe(false);
    expect(invalidCacheResult.pageCount).toBe(1);
    expect(invalidCacheResult.entries.map((e) => e.entryName)).toEqual([
      "001.jpg",
    ]);
  });

  it("未対応のArchiveSourceDescriptor種別に対してREAD_ERRORを送出すること", async () => {
    const coordinator = new CoordinatorCore({
      decodePool: { decodePageSlice: vi.fn() },
    });

    await expect(
      coordinator.openArchive(
        {
          kind: "gdrive",
          volumeId: "v1",
          driveFileId: "d1",
          fileSize: 100,
          md5Checksum: null,
          indexCacheKey: "gdrive:d1:100",
          progressTargetKey: "vol:v1",
        },
        null,
        1,
      ),
    ).rejects.toMatchObject({ code: "READ_ERROR" });

    await expect(
      coordinator.openArchive(
        { kind: "unknown" } as unknown as ArchiveSourceDescriptor,
        null,
        1,
      ),
    ).rejects.toMatchObject({ code: "READ_ERROR" });
  });

  it("個別ページの失敗は同一バッチの他ページを巻き込まずerrorフレームとして返却すること (AC-ENG-07)", async () => {
    const zipBytes = buildSyntheticZip({
      entries: [
        { name: "001.jpg", data: new Uint8Array([1, 2, 3]) },
        { name: "002.jpg", data: new Uint8Array([4, 5, 6]) },
        { name: "003.jpg", data: new Uint8Array([7, 8, 9]) },
      ],
    });
    const okBitmap = createFakeBitmap(800, 1200);
    const decodePool: DecodeWorkerApi = {
      decodePageSlice: vi
        .fn()
        .mockResolvedValueOnce({ bitmap: okBitmap, width: 800, height: 1200 })
        .mockRejectedValueOnce(
          new ZipArchiveError("DECODE_FAILED", "壊れた画像"),
        )
        .mockRejectedValueOnce("string decode crash"),
    };

    const coordinator = new CoordinatorCore({ decodePool });
    await coordinator.openArchive(createLocalSource(zipBytes), null, 1);

    const frames = await coordinator.requestVisiblePages([0, 1, 2, 99], [], 1);

    expect(frames).toEqual([
      {
        status: "ready",
        pageIndex: 0,
        epoch: 1,
        width: 800,
        height: 1200,
        bitmap: okBitmap,
      },
      {
        status: "error",
        pageIndex: 1,
        epoch: 1,
        errorCode: "DECODE_FAILED",
        message: "壊れた画像",
      },
      {
        status: "error",
        pageIndex: 2,
        epoch: 1,
        errorCode: "DECODE_FAILED",
        message: "string decode crash",
      },
      {
        status: "error",
        pageIndex: 99,
        epoch: 1,
        errorCode: "READ_ERROR",
        message: expect.stringContaining("99"),
      },
    ]);
  });

  it("古いepochのリクエストを即拒否・AbortController中断し遅延到着ImageBitmapを即close()すること (AC-ENG-07)", async () => {
    const zipBytes = buildSyntheticZip({
      entries: [
        { name: "001.jpg", data: new Uint8Array([1, 2, 3]) },
        { name: "002.jpg", data: new Uint8Array([4, 5, 6]) },
      ],
    });
    const memoryReader = createMemoryReader(zipBytes);
    const observedSignals: AbortSignal[] = [];

    let resolveHangingRead!: (buf: Uint8Array) => void;
    let hangOnNextSlice = false;
    const controllableReader: RandomAccessReader = {
      sourceId: memoryReader.sourceId,
      totalSize: memoryReader.totalSize,
      async readRange(offset, length, signal) {
        if (signal) {
          observedSignals.push(signal);
        }
        if (hangOnNextSlice) {
          hangOnNextSlice = false;
          return new Promise<Uint8Array>((resolve, reject) => {
            resolveHangingRead = resolve;
            signal?.addEventListener("abort", () => {
              reject(new DOMException("Aborted", "AbortError"));
            });
          });
        }
        return memoryReader.readRange(offset, length, signal);
      },
    };

    let resolvePendingDecode!: (val: {
      bitmap: ImageBitmap;
      width: number;
      height: number;
    }) => void;
    const decodePool: DecodeWorkerApi = {
      decodePageSlice: vi.fn(
        () =>
          new Promise<{
            bitmap: ImageBitmap;
            width: number;
            height: number;
          }>((resolve) => {
            resolvePendingDecode = resolve;
          }),
      ),
    };

    const coordinator = new CoordinatorCore({
      decodePool,
      createReader: () => controllableReader,
    });

    // アーカイブ未オープン時は[]
    expect(await coordinator.requestVisiblePages([0], [], 1)).toEqual([]);

    await coordinator.openArchive(createLocalSource(zipBytes), null, 1);

    // 空配列時は[]
    expect(await coordinator.requestVisiblePages([], [], 1)).toEqual([]);

    // 1. readRange中にcancelEpochBelowするとAbortController.abort()が発火し[]が返る
    hangOnNextSlice = true;
    const abortedReadPromise = coordinator.requestVisiblePages([0], [], 1);
    await Promise.resolve();
    coordinator.cancelEpochBelow(2);
    coordinator.cancelEpochBelow(1); // 単調増加ガード（減少しない）
    expect(observedSignals[observedSignals.length - 1]?.aborted).toBe(true);
    expect(await abortedReadPromise).toEqual([]);
    void resolveHangingRead;

    // epoch < minActiveEpoch は即時[] / openArchiveは即時AbortError
    expect(await coordinator.requestVisiblePages([0], [], 1)).toEqual([]);
    await expect(
      coordinator.openArchive(createLocalSource(zipBytes), null, 1),
    ).rejects.toMatchObject({ name: "AbortError" });

    // 2. decodePageSlice中にcancelEpochBelowすると完了後にbitmap.close()が即実行される
    const staleBitmap = createFakeBitmap(900, 1200);
    const inflightDecodePromise = coordinator.requestVisiblePages([0], [], 2);
    await vi.waitFor(() =>
      expect(decodePool.decodePageSlice).toHaveBeenCalledTimes(1),
    );

    coordinator.cancelEpochBelow(3);
    resolvePendingDecode({ bitmap: staleBitmap, width: 900, height: 1200 });

    expect(await inflightDecodePromise).toEqual([]);
    expect(staleBitmap.close).toHaveBeenCalledTimes(1);
  });

  it("同一バッチ内で先行ページ完了後にcancelEpochBelow/closeArchiveされた場合もbitmap.close()し全異常パターンを安全処理すること (AC-ENG-07)", async () => {
    const zipBytes = buildSyntheticZip({
      entries: [
        { name: "001.jpg", data: new Uint8Array([1, 2, 3]) },
        { name: "002.jpg", data: new Uint8Array([4, 5, 6]) },
        { name: "003.jpg", data: new Uint8Array([7, 8, 9]) },
      ],
    });
    const memoryReader = createMemoryReader(zipBytes);

    let readMode: "normal" | "resolveAfterAbort" = "normal";
    let resolveDelayedRead: ((val: Uint8Array) => void) | undefined;
    const customReader: RandomAccessReader = {
      sourceId: memoryReader.sourceId,
      totalSize: memoryReader.totalSize,
      async readRange(offset, length, signal) {
        if (readMode === "resolveAfterAbort") {
          return new Promise<Uint8Array>((resolve) => {
            resolveDelayedRead = resolve;
          });
        }
        return memoryReader.readRange(offset, length, signal);
      },
    };

    const earlyBitmap = createFakeBitmap(500, 500);
    const extraBitmap = createFakeBitmap(500, 500);
    let rejectThirdDecode!: (err: unknown) => void;
    const decodePool: DecodeWorkerApi = {
      decodePageSlice: vi
        .fn()
        .mockResolvedValueOnce({ bitmap: earlyBitmap, width: 500, height: 500 })
        .mockRejectedValueOnce(new Error("page 1 error"))
        .mockImplementationOnce(
          () =>
            new Promise((_, reject) => {
              rejectThirdDecode = reject;
            }),
        )
        .mockResolvedValueOnce({
          bitmap: extraBitmap,
          width: 500,
          height: 500,
        }),
    };

    const coordinator = new CoordinatorCore({
      decodePool,
      createReader: () => customReader,
    });
    await coordinator.openArchive(createLocalSource(zipBytes), null, 5);

    // 同一epochに2つ目の並行リクエストも発行しunregisterの分岐を網羅
    const batchPromise = coordinator.requestVisiblePages([0, 1, 2], [], 5);
    const sameEpochPromise = coordinator.requestVisiblePages([0], [], 5);
    await vi.waitFor(() =>
      expect(decodePool.decodePageSlice).toHaveBeenCalledTimes(4),
    );
    const sameEpochFrames = await sameEpochPromise;
    expect(sameEpochFrames).toHaveLength(1);

    // closeArchiveで進行中全ジョブを中断（earlyBitmapは既にreadyで待機中、page1はerror、page2はrejectする）
    await coordinator.closeArchive();
    rejectThirdDecode(new Error("late failure after close"));
    expect(await batchPromise).toEqual([]);
    expect(earlyBitmap.close).toHaveBeenCalledTimes(1);

    // closeArchive後はrequestVisiblePagesが[]を返す
    expect(await coordinator.requestVisiblePages([0], [], 5)).toEqual([]);

    // readRangeがabort後に解決するモックとopenArchive中の中断も検証
    const openRes6 = await coordinator.openArchive(
      createLocalSource(zipBytes),
      null,
      6,
    );
    const entry0 = openRes6.entries[0];
    readMode = "resolveAfterAbort";
    resolveDelayedRead = undefined;
    const postReadAbortPromise = coordinator.requestVisiblePages([0], [], 6);
    await vi.waitFor(() => expect(resolveDelayedRead).toBeDefined());
    const resolveRead1 = resolveDelayedRead!;
    coordinator.cancelEpochBelow(7);
    resolveRead1(zipBytes.slice(entry0.localHeaderOffset, entry0.physicalEnd));
    expect(await postReadAbortPromise).toEqual([]);

    // openArchiveがparse中にcancelEpochBelowされた場合
    resolveDelayedRead = undefined;
    const openAbortPromise = coordinator.openArchive(
      createLocalSource(zipBytes),
      null,
      7,
    );
    await vi.waitFor(() => expect(resolveDelayedRead).toBeDefined());
    const resolveRead2 = resolveDelayedRead!;
    coordinator.cancelEpochBelow(8);
    resolveRead2(zipBytes);
    await expect(openAbortPromise).rejects.toMatchObject({
      name: "AbortError",
    });
  });

  it("L2ヒット時の0RTT再デコードと実structuredClone({transfer})デタッチ模擬下のHO-03非破壊・非L2複数消費者共有を検証すること (AC-ENG-12, AC-ENG-14)", async () => {
    const p0 = new Uint8Array([10, 20, 30, 40]);
    const p1 = new Uint8Array([50, 60, 70, 80]);
    const zipBytes = buildSyntheticZip({
      entries: [
        { name: "000.jpg", data: p0, compressionMethod: 0 },
        { name: "001.jpg", data: p1, compressionMethod: 8 },
      ],
    });
    const baseReader = createMemoryReader(zipBytes);
    const decodedPayloads: Array<{ method: number; bytes: number[] }> = [];

    const transferSimulatingPool: DecodeWorkerApi = {
      decodePageSlice: vi.fn(async (compressedData, compressionMethod) => {
        const { data, transferables } = prepareDecodeTransfer(compressedData);
        const transferred = structuredClone(data, { transfer: transferables });
        decodedPayloads.push({
          method: compressionMethod,
          bytes: Array.from(transferred),
        });
        return {
          bitmap: createFakeBitmap(800, 1200),
          width: 800,
          height: 1200,
        };
      }),
    };

    const coordinator = new CoordinatorCore({
      decodePool: transferSimulatingPool,
      createReader: () => baseReader,
    });
    const openResult = await coordinator.openArchive(
      createLocalSource(zipBytes),
      null,
      1,
    );
    expect(openResult.pageCount).toBe(2);
    baseReader.reads.length = 0;

    // 1. 初回 Fast-Path で page 0 を取得・L2 格納し、structuredClone({ transfer }) を通す
    const firstFrames = await coordinator.requestVisiblePages([0], [], 1);
    expect(firstFrames).toHaveLength(1);
    expect(firstFrames[0].status).toBe("ready");
    expect(baseReader.reads).toHaveLength(1);
    expect(decodedPayloads[0]).toEqual({ method: 0, bytes: Array.from(p0) });

    // 2. L1 退避後の再めくり模擬（同一 page 0 を再度要求）-> readRange 0 回で L2 ヒット & 破壊されず再デコード成功
    baseReader.reads.length = 0;
    const secondFrames = await coordinator.requestVisiblePages([0], [], 2);
    expect(secondFrames).toHaveLength(1);
    expect(secondFrames[0].status).toBe("ready");
    expect(baseReader.reads).toHaveLength(0);
    expect(decodedPayloads[1]).toEqual({ method: 0, bytes: Array.from(p0) });

    // 3. L2 格納不可状態（80MB超ページピン中）で同世代重複要求 [1, 1] が In-Flight 共有した場合も
    //    consumerCount > 1 により markSharedBuffer 保護され、structuredClone({ transfer }) で互いを破壊しないこと
    const oversizedBytes = new Uint8Array(150).fill(0xab);
    const smallShared = new Uint8Array([1, 2, 3, 4]);
    const zipWithOversized = buildSyntheticZip({
      entries: [
        { name: "000.jpg", data: oversizedBytes, compressionMethod: 0 },
        { name: "001.jpg", data: smallShared, compressionMethod: 0 },
      ],
    });
    const smallReader = createMemoryReader(zipWithOversized);
    const smallCoordinator = new CoordinatorCore({
      decodePool: transferSimulatingPool,
      createReader: () => smallReader,
      l2MaxBytes: 100,
    });
    await smallCoordinator.openArchive(
      createLocalSource(zipWithOversized),
      null,
      1,
    );
    await smallCoordinator.requestVisiblePages([0], [], 1, {
      visiblePageIndices: [0],
    });
    smallReader.reads.length = 0;

    // page 0 がピン中なので page 1 (<=100B) は L2 格納されず false になるが、重複要求 [1, 1] は In-Flight 共有＆両方非破壊でデコード成功
    decodedPayloads.length = 0;
    const sharedFrames = await smallCoordinator.requestVisiblePages(
      [1, 1],
      [],
      1,
      {
        visiblePageIndices: [0],
      },
    );
    expect(sharedFrames).toHaveLength(2);
    expect(sharedFrames.every((f) => f.status === "ready")).toBe(true);
    expect(smallReader.reads).toHaveLength(1);
    expect(decodedPayloads).toEqual([
      { method: 0, bytes: Array.from(smallShared) },
      { method: 0, bytes: Array.from(smallShared) },
    ]);
  });

  it("64KB超ギャップ複数バッチ分割時を含むWarm PrefetchとL1近傍要求の先行In-Flight共有で重複readRangeがゼロになること (AC-ENG-13, AC-ENG-14)", async () => {
    const p0 = new Uint8Array([1, 2, 3]);
    const p1 = new Uint8Array([4, 5, 6]);
    const p2 = new Uint8Array([7, 8, 9]);
    const p3 = new Uint8Array([10, 11, 12]);
    const zipBytes = buildSyntheticZip({
      entries: [
        { name: "000.jpg", data: p0 },
        { name: "001.jpg", data: p1 },
        { name: "gap.bin", data: new Uint8Array(70_000) },
        { name: "002.jpg", data: p2 },
        { name: "003.jpg", data: p3 },
      ],
    });
    const baseReader = createMemoryReader(zipBytes);
    const parsedEntries = await parseZipDirectoryForTest(baseReader);
    baseReader.reads.length = 0;

    let resolveGateBatch0!: () => void;
    const batch0GatePromise = new Promise<void>((resolveGate) => {
      resolveGateBatch0 = resolveGate;
    });
    let resolveBatch0Started!: () => void;
    const batch0Started = new Promise<void>((resolveStarted) => {
      resolveBatch0Started = resolveStarted;
    });
    const gatedReader: RandomAccessReader = {
      sourceId: baseReader.sourceId,
      totalSize: baseReader.totalSize,
      async readRange(offset, length, signal) {
        if (offset === parsedEntries[1].localHeaderOffset) {
          resolveBatch0Started();
          await batch0GatePromise;
        }
        return baseReader.readRange(offset, length, signal);
      },
    };

    const decodePool: DecodeWorkerApi = {
      decodePageSlice: vi.fn(async (data) => ({
        bitmap: createFakeBitmap(data.byteLength, 100),
        width: data.byteLength,
        height: 100,
      })),
    };

    const coordinator = new CoordinatorCore({
      decodePool,
      createReader: () => gatedReader,
    });

    await coordinator.openArchive(createLocalSource(zipBytes), null, 1);
    baseReader.reads.length = 0;

    // 1. Fast-Path [0] 完了時に Warm Prefetch (Batch 0=[1], Batch 1=[2,3]) がバックグラウンド開始される（RPCは待たずに即返却）
    const fastFrames = await coordinator.requestVisiblePages(
      [0],
      [1, 2, 3],
      1,
      { visiblePageIndices: [0] },
    );
    expect(fastFrames).toHaveLength(1);
    expect(baseReader.reads).toHaveLength(1); // page 0 のみ

    // Batch 0 の readRange 開始まで待機（Batch 0 完了前 = Batch 1 はまだ readRange 前）
    await batch0Started;

    // 2. Batch 0 実行中に L1 近傍 [1, 2] をバッチ要求 -> 同期先行登録済み inflightPageReads に両方合流し、追加 readRange 0 回
    const neighborPromise = coordinator.requestVisiblePages([1, 2], [], 1, {
      visiblePageIndices: [0],
    });
    await Promise.resolve();
    expect(baseReader.reads).toHaveLength(1); // Batch 0 は baseReader 転送前かつ追加要求ゼロ

    resolveGateBatch0();
    const neighborFrames = await neighborPromise;
    expect(neighborFrames.map((f) => f.pageIndex)).toEqual([1, 2]);
    // 読込内訳: page 0 (1回) + Warm Batch 0 [1] (1回) + Warm Batch 1 [2,3] (1回) = 計 3 回のみ（重複ゼロ）
    await vi.waitFor(() => {
      expect(baseReader.reads).toHaveLength(3);
    });
  });

  it("遅延readRange中のcancelEpochBelowおよび新世代割り込みで旧世代完了を待たず即座にinflight解放・単独Fast-Pathを開始すること (AC-ENG-07, AC-ENG-14)", async () => {
    const zipBytes = buildSyntheticZip({
      entries: [
        { name: "000.jpg", data: new Uint8Array([1, 2, 3]) },
        { name: "001.jpg", data: new Uint8Array([4, 5, 6]) },
        { name: "002.jpg", data: new Uint8Array([7, 8, 9]) },
      ],
    });
    const baseReader = createMemoryReader(zipBytes);
    const parsedEntries = await parseZipDirectoryForTest(baseReader);

    let hangEpoch1Prefetch = true;
    let hangEpoch2Prefetch = false;
    let resolveHangingPrefetchRead!: (buf: Uint8Array) => void;
    let prefetchReadStarted!: () => void;
    const prefetchReadStartedPromise = new Promise<void>((resolve) => {
      prefetchReadStarted = resolve;
    });

    let hangFastPathPage0 = false;
    let resolveHangingFastPath!: (buf: Uint8Array) => void;

    const reader: RandomAccessReader = {
      sourceId: baseReader.sourceId,
      totalSize: baseReader.totalSize,
      async readRange(offset, length, signal) {
        if (
          hangEpoch1Prefetch &&
          offset === parsedEntries[1].localHeaderOffset
        ) {
          hangEpoch1Prefetch = false;
          prefetchReadStarted();
          // AbortSignal を無視して arrayBuffer() が完了しない LocalFileReader を模擬
          return new Promise<Uint8Array>((resolve) => {
            resolveHangingPrefetchRead = resolve;
          });
        }
        if (
          hangEpoch2Prefetch &&
          offset === parsedEntries[2].localHeaderOffset
        ) {
          hangEpoch2Prefetch = false;
          prefetchReadStarted();
          return new Promise<Uint8Array>((resolve) => {
            resolveHangingPrefetchRead = resolve;
          });
        }
        if (
          hangFastPathPage0 &&
          offset === parsedEntries[0].localHeaderOffset
        ) {
          hangFastPathPage0 = false;
          return new Promise<Uint8Array>((resolve) => {
            resolveHangingFastPath = resolve;
          });
        }
        return baseReader.readRange(offset, length, signal);
      },
    };

    const coordinator = new CoordinatorCore({
      decodePool: {
        decodePageSlice: vi.fn(async () => ({
          bitmap: createFakeBitmap(),
          width: 100,
          height: 100,
        })),
      },
      createReader: () => reader,
    });
    await coordinator.openArchive(createLocalSource(zipBytes), null, 1);

    // 1. epoch=1 で page 0 表示＋Warm Prefetch [1, 2] 起動 -> Batch [1, 2] が AbortSignal 無視でハング
    await coordinator.requestVisiblePages([0], [1, 2], 1, {
      visiblePageIndices: [0],
    });
    await prefetchReadStartedPromise;

    // 同一世代 cancelEpochBelow(1) では activePrefetch は維持され、cancelEpochBelow(2) で即時解放される
    coordinator.cancelEpochBelow(1);
    const abortedNeighborPromise = coordinator.requestVisiblePages([1], [], 1, {
      visiblePageIndices: [0],
    });
    coordinator.cancelEpochBelow(2);

    // abort() と同期的に inflightPageReads が解放されるため、旧 readRange 未完了のまま epoch=2 Fast-Path [1] が即完了する
    const fastEpoch2Frames = await coordinator.requestVisiblePages([1], [], 2, {
      visiblePageIndices: [1],
    });
    expect(fastEpoch2Frames).toHaveLength(1);
    expect(fastEpoch2Frames[0]).toMatchObject({
      status: "ready",
      pageIndex: 1,
      epoch: 2,
    });
    expect(await abortedNeighborPromise).toEqual([]);

    // ハングしていた epoch=1 の readRange が後から解決しても安全に無視され、epoch=2 の状態を破壊しない
    resolveHangingPrefetchRead(
      zipBytes.slice(
        parsedEntries[1].localHeaderOffset,
        parsedEntries[2].physicalEnd,
      ),
    );
    await Promise.resolve();

    // 2. cancelEpochBelow を呼ばずに新世代 epoch=3 が来た場合も、古い activePrefetch (epoch<3) を自動中断すること
    hangEpoch2Prefetch = true;
    const secondHangPromise = new Promise<void>((resolve) => {
      prefetchReadStarted = resolve;
    });
    await coordinator.requestVisiblePages([0], [1, 2], 2, {
      visiblePageIndices: [0],
    });
    await secondHangPromise;

    // epoch=3 を cancelEpochBelow なしで呼ぶと epoch=2 の activePrefetch が自動 abort され page 2 を即単独取得する
    const preemptedFrames = await coordinator.requestVisiblePages([2], [], 3, {
      visiblePageIndices: [2],
    });
    expect(preemptedFrames).toHaveLength(1);
    expect(preemptedFrames[0]).toMatchObject({
      status: "ready",
      pageIndex: 2,
      epoch: 3,
    });
    resolveHangingPrefetchRead(new Uint8Array(0));

    // 3. 既存 inflightPageReads に異世代 Fast-Path (epoch=3) が残っている状態で epoch=4 が同じ page 0 を要求した場合は
    //    旧世代の完了を待たず単独取得すること（settle 時も新世代エントリを誤削除しない）
    await coordinator.openArchive(createLocalSource(zipBytes), null, 3);
    hangFastPathPage0 = true;
    const oldEpochFast = coordinator.requestVisiblePages([0], [], 3);
    await vi.waitFor(() => expect(resolveHangingFastPath).toBeDefined());
    const newEpochFast = await coordinator.requestVisiblePages([0], [], 4);
    expect(newEpochFast).toHaveLength(1);
    expect(newEpochFast[0]).toMatchObject({
      status: "ready",
      pageIndex: 0,
      epoch: 4,
    });
    resolveHangingFastPath(
      zipBytes.slice(
        parsedEntries[0].localHeaderOffset,
        parsedEntries[0].physicalEnd,
      ),
    );
    await oldEpochFast;
  });

  it("Warm Prefetch失敗(READ_ERROR/一部破損CORRUPT_ZIP)時は待機中リクエストが直接readCompressedPageSliceへフォールバックすること (AC-ENG-13, AC-ENG-14)", async () => {
    const zipBytes = buildSyntheticZip({
      entries: [
        { name: "000.jpg", data: new Uint8Array([1, 2, 3]) },
        { name: "001.jpg", data: new Uint8Array([4, 5, 6]) },
        {
          name: "002.jpg",
          data: new Uint8Array([7, 8, 9]),
          overrideLfhSignature: 0xdeadbeef,
        },
      ],
    });
    const baseReader = createMemoryReader(zipBytes);
    const parsedEntries = await parseZipDirectoryForTest(baseReader);

    let failPrefetchRead = true;
    let startPrefetchRead!: () => void;
    let releasePrefetchError!: () => void;
    const prefetchReadEntered = new Promise<void>((resolve) => {
      startPrefetchRead = resolve;
    });

    const reader: RandomAccessReader = {
      sourceId: baseReader.sourceId,
      totalSize: baseReader.totalSize,
      async readRange(offset, length, signal) {
        if (failPrefetchRead && offset === parsedEntries[1].localHeaderOffset) {
          failPrefetchRead = false;
          startPrefetchRead();
          await new Promise<void>((resolve) => {
            releasePrefetchError = resolve;
          });
          throw new ZipArchiveError("READ_ERROR", "transient prefetch failure");
        }
        return baseReader.readRange(offset, length, signal);
      },
    };

    const coordinator = new CoordinatorCore({
      decodePool: {
        decodePageSlice: vi.fn(async () => ({
          bitmap: createFakeBitmap(),
          width: 100,
          height: 100,
        })),
      },
      createReader: () => reader,
    });
    await coordinator.openArchive(createLocalSource(zipBytes), null, 1);

    // 1. Warm Prefetch が READ_ERROR 失敗 -> 相乗りしていた page 1 は null 解決後に直接読込へフォールバック成功し、
    //    LFH破損の page 2 は直接読込でも CORRUPT_ZIP としてページ単位 error フレームになる
    await coordinator.requestVisiblePages([0], [1, 2], 1, {
      visiblePageIndices: [0],
    });
    await prefetchReadEntered;
    const fallbackPromise = coordinator.requestVisiblePages([1, 2], [], 1, {
      visiblePageIndices: [0],
    });
    releasePrefetchError();

    const fallbackFrames = await fallbackPromise;
    expect(fallbackFrames).toHaveLength(2);
    expect(fallbackFrames[0]).toMatchObject({ status: "ready", pageIndex: 1 });
    expect(fallbackFrames[1]).toMatchObject({
      status: "error",
      pageIndex: 2,
      errorCode: "CORRUPT_ZIP",
    });

    // 2. Warm Prefetch 内で一部破損(CORRUPT_ZIP)が発生し onPageSettledEmpty で null 解決された場合もフォールバックすること
    await coordinator.openArchive(createLocalSource(zipBytes), null, 2);
    const partialPromise = coordinator.requestVisiblePages([0], [2], 2, {
      visiblePageIndices: [0],
    });
    await partialPromise;
    const page2Frames = await coordinator.requestVisiblePages([2], [], 2, {
      visiblePageIndices: [0],
    });
    expect(page2Frames[0]).toMatchObject({
      status: "error",
      pageIndex: 2,
      errorCode: "CORRUPT_ZIP",
    });
  });

  it("空pageIndicesでのL2補充・1epoch1回制限・同世代In-Flight除外と旧世代In-Flight非除外を検証すること (AC-ENG-12, AC-ENG-14)", async () => {
    const zipBytes = buildSyntheticZip({
      entries: [
        { name: "000.jpg", data: new Uint8Array([1, 2, 3]) },
        { name: "001.jpg", data: new Uint8Array([4, 5, 6]) },
        { name: "gap1.bin", data: new Uint8Array(70_000) },
        { name: "002.jpg", data: new Uint8Array([7, 8, 9]) },
        { name: "gap2.bin", data: new Uint8Array(70_000) },
        { name: "003.jpg", data: new Uint8Array([10, 11, 12]) },
      ],
    });
    const baseReader = createMemoryReader(zipBytes);
    const parsedEntries = await parseZipDirectoryForTest(baseReader);

    let holdPage1 = false;
    let releasePage1!: () => void;
    let holdPage2 = false;
    let releasePage2!: () => void;
    const gatedReader: RandomAccessReader = {
      sourceId: baseReader.sourceId,
      totalSize: baseReader.totalSize,
      async readRange(offset, length, signal) {
        if (holdPage1 && offset === parsedEntries[1].localHeaderOffset) {
          holdPage1 = false;
          await new Promise<void>((resolve) => {
            releasePage1 = resolve;
          });
        }
        if (holdPage2 && offset === parsedEntries[2].localHeaderOffset) {
          holdPage2 = false;
          await new Promise<void>((resolve) => {
            releasePage2 = resolve;
          });
        }
        return baseReader.readRange(offset, length, signal);
      },
    };

    const coordinator = new CoordinatorCore({
      decodePool: {
        decodePageSlice: vi.fn(async () => ({
          bitmap: createFakeBitmap(),
          width: 100,
          height: 100,
        })),
      },
      createReader: () => gatedReader,
    });
    await coordinator.openArchive(createLocalSource(zipBytes), null, 1);
    baseReader.reads.length = 0;

    // 1. 空 pageIndices [] で L2 補充が同期起動され、同一 epoch=1 での 2 回目 Warm Prefetch は起動されない
    const emptyFrames = await coordinator.requestVisiblePages([], [1], 1, {
      visiblePageIndices: [0],
    });
    expect(emptyFrames).toEqual([]);
    await vi.waitFor(() => expect(baseReader.reads).toHaveLength(1));

    // 同一 epoch=1 で別の prefetchIndices=[2] を渡しても 1 epoch 1 回制限で再起動されない
    await coordinator.requestVisiblePages([], [2], 1, {
      visiblePageIndices: [0],
    });
    await Promise.resolve();
    expect(baseReader.reads).toHaveLength(1);

    // 2. アーカイブを再オープンして L2 をリセットした上で、旧世代(epoch=1) In-Flight [1] と 同世代(epoch=2) In-Flight [2] を起動し、
    //    空 pageIndices で epoch=2 Warm Prefetch [1, 2, 3] を起動すると同世代 [2] のみ除外され [1, 3] が先読みされる
    await coordinator.openArchive(createLocalSource(zipBytes), null, 1);
    holdPage1 = true;
    holdPage2 = true;
    const oldInflight = coordinator.requestVisiblePages([1], [], 1);
    const sameInflight = coordinator.requestVisiblePages([2], [], 2);
    await vi.waitFor(() => {
      expect(releasePage1).toBeDefined();
      expect(releasePage2).toBeDefined();
    });
    baseReader.reads.length = 0;

    await coordinator.requestVisiblePages([], [1, 2, 3], 2, {
      visiblePageIndices: [0],
    });
    await vi.waitFor(() => expect(baseReader.reads).toHaveLength(2));
    expect(baseReader.reads.map((r) => r.offset)).toEqual([
      parsedEntries[1].localHeaderOffset,
      parsedEntries[3].localHeaderOffset,
    ]);
    releasePage1();
    releasePage2();
    await Promise.all([oldInflight, sameInflight]);
  });

  it("80MB超例外ページの表示中一時保持・Warm Prefetch抑止・ピン移動時の即時退避およびopen/closeでの全破棄を検証すること (AC-ENG-12)", async () => {
    const p0Oversized = new Uint8Array(150).fill(0x11);
    const p1Small = new Uint8Array(20).fill(0x22);
    const p2Small = new Uint8Array(20).fill(0x33);
    const zipBytes = buildSyntheticZip({
      entries: [
        { name: "000.jpg", data: p0Oversized },
        { name: "001.jpg", data: p1Small },
        { name: "002.jpg", data: p2Small },
      ],
    });
    const baseReader = createMemoryReader(zipBytes);
    const parsedEntries = await parseZipDirectoryForTest(baseReader);

    const coordinator = new CoordinatorCore({
      decodePool: {
        decodePageSlice: vi.fn(async () => ({
          bitmap: createFakeBitmap(),
          width: 100,
          height: 100,
        })),
      },
      createReader: () => baseReader,
      l2MaxBytes: 100,
    });
    await coordinator.openArchive(createLocalSource(zipBytes), null, 1);
    baseReader.reads.length = 0;

    // 1. 超過ページ 0 を非表示近傍として要求した場合（visible=[1]）は L2 に格納されない
    await coordinator.requestVisiblePages([0], [], 1, {
      visiblePageIndices: [1],
    });
    expect(baseReader.reads).toHaveLength(1);
    await coordinator.requestVisiblePages([0], [], 1, {
      visiblePageIndices: [1],
    });
    expect(baseReader.reads).toHaveLength(2);

    // 2. 表示ページとして page 0 を要求 -> L2 に一時ピン保持され、Warm Prefetch [1, 2] は抑止される
    baseReader.reads.length = 0;
    await coordinator.requestVisiblePages([0], [1, 2], 2, {
      visiblePageIndices: [0],
    });
    expect(baseReader.reads).toHaveLength(1);
    await Promise.resolve();
    expect(baseReader.reads).toHaveLength(1);

    // ピン維持中は 0RTT ヒット
    await coordinator.requestVisiblePages([0], [], 2, {
      visiblePageIndices: [0],
    });
    expect(baseReader.reads).toHaveLength(1);

    // 3. 別ページへピン移動（visiblePageIndices: [1]）した瞬間に超過ページ 0 は即時退避され、以後の [0] は再読込となる
    await coordinator.requestVisiblePages([1], [2], 3, {
      visiblePageIndices: [1],
    });
    await vi.waitFor(() => expect(baseReader.reads).toHaveLength(3));
    await coordinator.requestVisiblePages([0], [], 4, {
      visiblePageIndices: [0],
    });
    expect(baseReader.reads).toHaveLength(4);

    // 4. closeArchive 時に L2 キャッシュ・Warm Prefetch 世代が全破棄されること
    await coordinator.requestVisiblePages([1], [2], 5, {
      visiblePageIndices: [1],
    });
    await coordinator.closeArchive();

    // close 後の再 open で同じ epoch=1 でも L2 キャッシュが空＆Warm Prefetch も再実行可能
    await coordinator.openArchive(createLocalSource(zipBytes), null, 1);
    baseReader.reads.length = 0;
    await coordinator.requestVisiblePages([1], [2], 1, {
      visiblePageIndices: [1],
    });
    await vi.waitFor(() => expect(baseReader.reads).toHaveLength(2));

    // 5. closeArchive / openArchive で待機中 In-Flight が同期 null 解決され L2 も全破棄されること
    let blockPage0 = false;
    let blockInflight!: () => void;
    const blockingReader: RandomAccessReader = {
      sourceId: baseReader.sourceId,
      totalSize: baseReader.totalSize,
      async readRange(offset, length, signal) {
        if (blockPage0 && offset === parsedEntries[0].localHeaderOffset) {
          blockPage0 = false;
          return new Promise<Uint8Array>((resolve) => {
            blockInflight = () =>
              resolve(baseReader.readRange(offset, length, signal));
          });
        }
        return baseReader.readRange(offset, length, signal);
      },
    };
    const resetCoordinator = new CoordinatorCore({
      decodePool: {
        decodePageSlice: vi.fn(async () => ({
          bitmap: createFakeBitmap(),
          width: 100,
          height: 100,
        })),
      },
      createReader: () => blockingReader,
    });
    await resetCoordinator.openArchive(createLocalSource(zipBytes), null, 1);
    blockPage0 = true;
    const waitingRequest = resetCoordinator.requestVisiblePages([0], [], 1);
    await vi.waitFor(() => expect(blockInflight).toBeDefined());
    const sameEpochWaiter = resetCoordinator.requestVisiblePages([0], [], 1);
    await resetCoordinator.closeArchive();
    expect(await sameEpochWaiter).toEqual([]);
    blockInflight();
    expect(await waitingRequest).toEqual([]);

    // openArchive の直接再呼び出しでも L2・In-Flight・Warm Prefetch 世代が全破棄されること
    await resetCoordinator.openArchive(createLocalSource(zipBytes), null, 1);
    baseReader.reads.length = 0;
    await resetCoordinator.requestVisiblePages([1], [2], 1, {
      visiblePageIndices: [1],
    });
    await vi.waitFor(() => expect(baseReader.reads).toHaveLength(2));
    await resetCoordinator.openArchive(createLocalSource(zipBytes), null, 1);
    baseReader.reads.length = 0;
    await resetCoordinator.requestVisiblePages([1], [2], 1, {
      visiblePageIndices: [1],
    });
    await vi.waitFor(() => expect(baseReader.reads).toHaveLength(2));
  });

  it("L2未格納の80MB超ページがCoordinatorCore経由でも複製されずprepareDecodeTransferでZero-Copy転送されること (AC-ENG-12, AC-ENG-14)", async () => {
    const oversizedSize = ENGINE_BUDGETS.L2_CACHE_MAX_BYTES + 1;
    const entryName = "oversized.jpg";
    const nameBytes = new TextEncoder().encode(entryName);
    const lfh = new Uint8Array(30 + nameBytes.byteLength);
    const lfhView = new DataView(lfh.buffer);
    lfhView.setUint32(0, 0x04034b50, true);
    lfhView.setUint16(26, nameBytes.byteLength, true);
    lfhView.setUint16(28, 0, true);
    lfh.set(nameBytes, 30);

    const payloadStart = lfh.byteLength;
    const reads: Array<{ readonly offset: number; readonly length: number }> =
      [];
    const virtualReader: RandomAccessReader = {
      sourceId: "virtual-80mb-coordinator",
      totalSize: payloadStart + oversizedSize + 64,
      async readRange(offset, length) {
        reads.push({ offset, length });
        const end = Math.min(
          offset + length,
          payloadStart + oversizedSize + 64,
        );
        const out = new Uint8Array(Math.max(0, end - offset));
        if (offset < lfh.byteLength) {
          const copyEnd = Math.min(end, lfh.byteLength);
          out.set(lfh.subarray(offset, copyEnd), 0);
        }
        if (payloadStart >= offset && payloadStart < end) {
          out[payloadStart - offset] = 0xde;
        }
        const lastPos = payloadStart + oversizedSize - 1;
        if (lastPos >= offset && lastPos < end) {
          out[lastPos - offset] = 0xad;
        }
        return out;
      },
    };

    const cachedEntries: ZipPageEntry[] = [
      {
        pageIndex: 0,
        entryName,
        entryNameByteLength: nameBytes.byteLength,
        compressionMethod: 0,
        compressedSize: oversizedSize,
        uncompressedSize: oversizedSize,
        localHeaderOffset: 0,
        physicalEnd: payloadStart + oversizedSize,
        crc32: 0,
      },
      {
        pageIndex: 1,
        entryName: "normal.jpg",
        entryNameByteLength: 10,
        compressionMethod: 0,
        compressedSize: 4,
        uncompressedSize: 4,
        localHeaderOffset: payloadStart + oversizedSize,
        physicalEnd: payloadStart + oversizedSize + 64,
        crc32: 0,
      },
    ];

    let wasZeroCopy = false;
    let firstByte = -1;
    let lastByte = -1;
    let sliceByteLength = -1;
    const decodePool: DecodeWorkerApi = {
      decodePageSlice: vi.fn(async (compressedData) => {
        const prepared = prepareDecodeTransfer(compressedData);
        wasZeroCopy =
          prepared.data === compressedData &&
          prepared.transferables[0] === compressedData.buffer;
        sliceByteLength = compressedData.byteLength;
        firstByte = compressedData[0];
        lastByte = compressedData[compressedData.byteLength - 1];
        return {
          bitmap: createFakeBitmap(800, 1200),
          width: 800,
          height: 1200,
        };
      }),
    };

    const coordinator = new CoordinatorCore({
      decodePool,
      createReader: () => virtualReader,
    });
    await coordinator.openArchive(
      createLocalSource(new Uint8Array(10), "huge.cbz"),
      cachedEntries,
      1,
    );

    // visiblePageIndices: [1] により page 0 は allowOversized: false となり L2 へ格納されず独立バッファのまま Zero-Copy 転送される
    const frames = await coordinator.requestVisiblePages([0], [], 1, {
      visiblePageIndices: [1],
    });
    expect(frames).toHaveLength(1);
    expect(frames[0].status).toBe("ready");
    expect(reads).toHaveLength(2);
    expect(reads[0]).toEqual({
      offset: 0,
      length: 30 + nameBytes.byteLength + ENGINE_BUDGETS.LFH_EXTRA_MARGIN_BYTES,
    });
    expect(wasZeroCopy).toBe(true);
    expect(sliceByteLength).toBe(oversizedSize);
    expect(firstByte).toBe(0xde);
    expect(lastByte).toBe(0xad);
  });
});

async function parseZipDirectoryForTest(
  reader: RandomAccessReader,
): Promise<ZipPageEntry[]> {
  const { parseZipDirectory } = await import("../zip/zipParser");
  return parseZipDirectory(reader);
}
