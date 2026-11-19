import { describe, expect, it, vi } from "vitest";
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
        ),
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
      expect(decodePool.decodePageSlice).toHaveBeenCalledTimes(3),
    );

    // closeArchiveで進行中全ジョブを中断（earlyBitmapは既にreadyで待機中、page1はerror、page2はrejectする）
    await coordinator.closeArchive();
    rejectThirdDecode(new Error("late failure after close"));
    await expect(sameEpochPromise).resolves.toEqual([]);
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
});
