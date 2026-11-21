import { describe, expect, it, vi } from "vitest";
import { L2ByteCache } from "../cache/L2ByteCache";
import { ENGINE_BUDGETS } from "../constants";
import type { RandomAccessReader, ZipPageEntry } from "../types";
import { ZipArchiveError } from "../zip/errors";
import {
  buildSyntheticZip,
  createMemoryReader,
} from "../zip/__fixtures__/zipBuilder";
import { parseZipDirectory } from "../zip/zipParser";
import { planPrefetchBatches, runPrefetchBatches } from "./AdaptivePrefetcher";

function makeEntry(
  pageIndex: number,
  localHeaderOffset: number,
  compressedSize: number,
  physicalEnd?: number,
  entryNameByteLength = 7,
): ZipPageEntry {
  const defaultEnd =
    localHeaderOffset +
    30 +
    entryNameByteLength +
    compressedSize +
    ENGINE_BUDGETS.LFH_EXTRA_MARGIN_BYTES;
  return {
    pageIndex,
    entryName: `p${String(pageIndex).padStart(3, "0")}.jpg`,
    entryNameByteLength,
    compressionMethod: 0,
    compressedSize,
    uncompressedSize: compressedSize,
    localHeaderOffset,
    physicalEnd: physicalEnd ?? defaultEnd,
    crc32: 0,
  };
}

describe("AdaptivePrefetcher", () => {
  it("80MB超ピン中エントリ保持時はplanPrefetchBatchesが空配列を返しrunPrefetchBatchesも通信を行わないこと (AC-ENG-12, AC-ENG-13)", async () => {
    const cache = new L2ByteCache({ maxBytes: 100 });
    cache.setPinnedPages([0]);
    cache.put(0, new Uint8Array(120), { allowOversized: true });

    const entries = [makeEntry(0, 0, 120, 2000), makeEntry(1, 2000, 50, 3000)];
    const batches = planPrefetchBatches({
      entries,
      prefetchIndices: [1],
      l2Cache: cache,
    });
    expect(batches).toEqual([]);

    const readRange = vi.fn();
    const onPlanPages = vi.fn();
    await runPrefetchBatches({
      reader: { sourceId: "spy", totalSize: 3000, readRange },
      entries,
      prefetchIndices: [1],
      l2Cache: cache,
      callbacks: { onPlanPages },
    });
    expect(onPlanPages).not.toHaveBeenCalled();
    expect(readRange).not.toHaveBeenCalled();
  });

  it("有効な先読み候補が0件の場合は空配列を返し通信を行わないこと (AC-ENG-13)", async () => {
    const cache = new L2ByteCache();
    const entries = [makeEntry(0, 0, 100, 200)];
    expect(
      planPrefetchBatches({
        entries,
        prefetchIndices: [],
        l2Cache: cache,
      }),
    ).toEqual([]);
    expect(
      planPrefetchBatches({
        entries,
        prefetchIndices: [0],
        l2Cache: cache,
        excludedPageIndices: [0],
      }),
    ).toEqual([]);

    const readRange = vi.fn();
    const onPlanPages = vi.fn();
    await runPrefetchBatches({
      reader: { sourceId: "empty", totalSize: 200, readRange },
      entries,
      prefetchIndices: [],
      l2Cache: cache,
      callbacks: { onPlanPages },
    });
    expect(onPlanPages).not.toHaveBeenCalled();
    expect(readRange).not.toHaveBeenCalled();
  });

  it("Step1で非整数・範囲外・重複・除外対象・L2保持済み・構造不正・80MB超をスキップし10MB予算超過時点で後続候補を打ち切ること (AC-ENG-13)", () => {
    const cache = new L2ByteCache();
    cache.put(2, new Uint8Array([1, 2, 3]));

    const entries: ZipPageEntry[] = [
      makeEntry(0, 0, 1_000_000, 2_000_000), // excludedPageIndices
      makeEntry(1, 2_000_000, 4_000_000, 7_000_000), // span = 30+7+4_000_000+1024 = 4_001_061
      makeEntry(2, 7_000_000, 1_000_000, 9_000_000), // already in L2
      { ...makeEntry(3, -1, 100, 100) }, // localHeaderOffset < 0
      { ...makeEntry(4, 9_000_000, 10, 9_000_029) }, // physicalEnd - localHeaderOffset < 30
      makeEntry(
        5,
        10_000_000,
        ENGINE_BUDGETS.L2_CACHE_MAX_BYTES + 1,
        100_000_000,
      ), // > 80MB
      makeEntry(6, 100_000_000, 4_000_000, 105_000_000), // span = 4_001_061 (total 8_002_122 <= 10MB)
      makeEntry(7, 106_000_000, 3_000_000, 110_000_000), // 8_002_122 + 3_001_061 > 10MB -> stop here!
      makeEntry(8, 111_000_000, 500_000, 112_000_000), // 後続の小さいエントリは連続性維持のため選抜しない
    ];

    const batches = planPrefetchBatches({
      entries,
      prefetchIndices: [-1, 1.5, Number.NaN, 99, 0, 1, 1, 2, 3, 4, 5, 6, 7, 8],
      l2Cache: cache,
      excludedPageIndices: [0],
    });

    expect(batches).toHaveLength(2);
    expect(batches[0].entries.map((e) => e.pageIndex)).toEqual([1]);
    expect(batches[1].entries.map((e) => e.pageIndex)).toEqual([6]);
  });

  it("先頭有効候補が単独で10MB超かつ80MB以下の場合のみその1件単独を選抜して打ち切ること (AC-ENG-13)", () => {
    const cache = new L2ByteCache();
    const entries = [
      makeEntry(0, 0, 15_000_000, 16_000_000),
      makeEntry(1, 16_000_000, 1_000, 16_002_000),
    ];

    const batches = planPrefetchBatches({
      entries,
      prefetchIndices: [0, 1],
      l2Cache: cache,
    });

    expect(batches).toEqual([
      {
        entries: [entries[0]],
        rangeOffset: 0,
        rangeLength:
          30 + 7 + 15_000_000 + ENGINE_BUDGETS.LFH_EXTRA_MARGIN_BYTES,
      },
    ]);
  });

  it("Step2で物理オフセット昇順に並べ替え64KB境界(65536結合/65537分割)・負ギャップ・ギャップ込み10MB超過を正しく分割すること (AC-ENG-13)", () => {
    const cache = new L2ByteCache();

    // 1. 優先順 [1, 0, 2] だが物理順は 0 -> (65536B gap) -> 1 -> (65537B gap) -> 2
    const e0 = makeEntry(0, 0, 100, 1_000);
    const e1 = makeEntry(1, 1_000 + 65_536, 100, 1_000 + 65_536 + 1_000);
    const e2 = makeEntry(
      2,
      1_000 + 65_536 + 1_000 + 65_537,
      100,
      1_000 + 65_536 + 1_000 + 65_537 + 1_000,
    );

    const batchesGap = planPrefetchBatches({
      entries: [e0, e1, e2],
      prefetchIndices: [1, 0, 2],
      l2Cache: cache,
    });

    expect(batchesGap).toHaveLength(2);
    expect(batchesGap[0].entries.map((e) => e.pageIndex)).toEqual([0, 1]);
    expect(batchesGap[0].rangeOffset).toBe(0);
    expect(batchesGap[0].rangeLength).toBe(e1.physicalEnd);
    expect(batchesGap[1].entries.map((e) => e.pageIndex)).toEqual([2]);
    expect(batchesGap[1].rangeOffset).toBe(e2.localHeaderOffset);

    // 2. 個別span合計は10MB以下(6MB+4MB=10MB)だが間に50KBギャップがあり実Range長が10MB超になるケースは分割
    const spanBudget = ENGINE_BUDGETS.WARM_PREFETCH_BUDGET_BYTES;
    const overhead = 30 + 7 + ENGINE_BUDGETS.LFH_EXTRA_MARGIN_BYTES;
    const sizeA = 6_000_000;
    const spanA = overhead + sizeA;
    const sizeB = spanBudget - spanA - overhead; // spanA + spanB === 10MB ちょうど
    const heavyA = makeEntry(0, 0, sizeA, spanA);
    const heavyB = makeEntry(1, spanA + 1, sizeB, spanA + 1 + overhead + sizeB);
    const splitByRangeBudget = planPrefetchBatches({
      entries: [heavyA, heavyB],
      prefetchIndices: [0, 1],
      l2Cache: cache,
    });
    expect(splitByRangeBudget).toHaveLength(2);

    // gap=0 なら 10MB ちょうどに収まり 1 バッチ結合
    const exactB = makeEntry(1, spanA, sizeB, spanA + overhead + sizeB);
    const coalescedExact = planPrefetchBatches({
      entries: [heavyA, exactB],
      prefetchIndices: [0, 1],
      l2Cache: cache,
    });
    expect(coalescedExact).toHaveLength(1);
    expect(coalescedExact[0].rangeLength).toBe(spanBudget);

    // 3. 物理重なり（gap < 0）の場合は結合せず分割する
    const overlapA = makeEntry(0, 0, 100, 1_000);
    const overlapB = makeEntry(1, 500, 100, 1_500);
    const splitOverlap = planPrefetchBatches({
      entries: [overlapA, overlapB],
      prefetchIndices: [0, 1],
      l2Cache: cache,
    });
    expect(splitOverlap).toHaveLength(2);
  });

  it("runPrefetchBatchesは最初のawait前に全バッチ対象をonPlanPagesへ同期登録し結合読込・L2正規化格納・末尾2RTT補完・既得L2スキップを行うこと (AC-ENG-13, AC-ENG-14)", async () => {
    const p0 = new Uint8Array([10, 11, 12]);
    const p1 = new Uint8Array([20, 21, 22, 23]);
    const p2 = Uint8Array.from({ length: 2_000 }, (_, i) => i & 0xff); // 末尾ケース2a
    const p3 = new Uint8Array([30, 31, 32, 33]);
    const p4 = new Uint8Array([40, 41, 42, 43]); // 末尾ケース2b

    // 0, 1 は 64KB 以内結合 / 2 は巨大な非画像ファイル挟みで 64KB 超ギャップ別バッチ / 3, 4 も別バッチ
    const zipBytes = buildSyntheticZip({
      entries: [
        { name: "000.jpg", data: p0 },
        { name: "001.jpg", data: p1 },
        { name: "gap1.bin", data: new Uint8Array(70_000) },
        {
          name: "002.jpg",
          data: p2,
          lfhExtra: new Uint8Array(1_050).fill(0xaa),
        },
        { name: "gap2.bin", data: new Uint8Array(70_000) },
        { name: "003.jpg", data: p3 },
        {
          name: "004.jpg",
          data: p4,
          lfhExtra: new Uint8Array(5_000).fill(0xbb),
        },
      ],
    });

    const baseReader = createMemoryReader(zipBytes);
    const parsedEntries = await parseZipDirectory(baseReader);
    baseReader.reads.length = 0;

    const events: string[] = [];
    const l2Cache = new L2ByteCache();
    let batch0ReadStarted = false;
    const wrappedReader: RandomAccessReader = {
      sourceId: baseReader.sourceId,
      totalSize: baseReader.totalSize,
      async readRange(offset, length, signal) {
        events.push(`readRange:${offset}:${length}`);
        const buf = await baseReader.readRange(offset, length, signal);
        if (!batch0ReadStarted) {
          batch0ReadStarted = true;
          // Batch 0 取得完了直後に別経路(Fast-Path等)が page 1 と Batch 1 の page 2 を既に L2 へ格納した状況を模擬
          l2Cache.put(1, new Uint8Array([99, 98]));
          l2Cache.put(2, p2);
        }
        return buf;
      },
    };

    const plannedSnapshots: number[][] = [];
    const readyPages: Array<[number, Uint8Array]> = [];
    const settledEmpty: number[] = [];

    const prefetchPromise = runPrefetchBatches({
      reader: wrappedReader,
      entries: parsedEntries,
      prefetchIndices: [0, 1, 2, 3, 4],
      l2Cache,
      callbacks: {
        onPlanPages: (planned) => {
          events.push("onPlanPages");
          plannedSnapshots.push(planned.map((e) => e.pageIndex));
        },
        onPageReady: (pageIndex, slice) => {
          readyPages.push([pageIndex, slice]);
        },
        onPageSettledEmpty: (pageIndex) => {
          settledEmpty.push(pageIndex);
        },
      },
    });

    // 最初の await 前（同期時点）で全 3 バッチ分の [0, 1, 2, 3, 4] が登録されていること
    expect(events[0]).toBe("onPlanPages");
    expect(plannedSnapshots).toEqual([[0, 1, 2, 3, 4]]);

    await prefetchPromise;

    expect(settledEmpty).toEqual([]);
    // Batch 1 (page 2 のみ) は全ページ L2 格納済みのため readRange がスキップされる
    expect(
      events.some((ev) =>
        ev.startsWith(`readRange:${parsedEntries[2].localHeaderOffset}:`),
      ),
    ).toBe(false);

    // 既得だった page 1 は上書きされない
    expect(l2Cache.peek(1)).toEqual(new Uint8Array([99, 98]));
    expect(l2Cache.peek(0)).toEqual(p0);
    expect(l2Cache.peek(2)).toEqual(p2);
    expect(l2Cache.peek(3)).toEqual(p3);
    expect(l2Cache.peek(4)).toEqual(p4);

    // L2 格納スライスは独立 ArrayBuffer に正規化されていること
    expect(l2Cache.peek(0)?.byteOffset).toBe(0);
    expect(l2Cache.peek(0)?.byteLength).toBe(
      l2Cache.peek(0)?.buffer.byteLength,
    );
    expect(readyPages.map(([idx]) => idx)).toEqual([0, 1, 2, 3, 4]);
  });

  it("結合バッファ内の一部エントリ破損(CORRUPT_ZIP)は正常ページを救済しcallbacks未指定でも動作すること (AC-ENG-13)", async () => {
    const p0 = new Uint8Array([1, 2, 3, 4]);
    const p1 = new Uint8Array([5, 6, 7, 8]);
    const p2 = new Uint8Array([9, 10, 11, 12]);
    const zipBytes = buildSyntheticZip({
      entries: [
        { name: "000.jpg", data: p0 },
        { name: "001.jpg", data: p1, overrideLfhSignature: 0xdeadbeef },
        { name: "002.jpg", data: p2 },
      ],
    });

    const reader = createMemoryReader(zipBytes);
    const entries = await parseZipDirectory(reader);
    const cache = new L2ByteCache();
    const ready: number[] = [];
    const empty: number[] = [];

    await runPrefetchBatches({
      reader,
      entries,
      prefetchIndices: [0, 1, 2],
      l2Cache: cache,
      callbacks: {
        onPageReady: (pageIndex) => ready.push(pageIndex),
        onPageSettledEmpty: (pageIndex) => empty.push(pageIndex),
      },
    });

    expect(ready).toEqual([0, 2]);
    expect(empty).toEqual([1]);
    expect(cache.peek(0)).toEqual(p0);
    expect(cache.has(1)).toBe(false);
    expect(cache.peek(2)).toEqual(p2);

    // callbacks 未指定でも安全に完走する
    const cacheNoCb = new L2ByteCache();
    await runPrefetchBatches({
      reader,
      entries,
      prefetchIndices: [0, 1, 2],
      l2Cache: cacheNoCb,
    });
    expect(cacheNoCb.peek(0)).toEqual(p0);
    expect(cacheNoCb.has(1)).toBe(false);
    expect(cacheNoCb.peek(2)).toEqual(p2);
  });

  it("通信中に80MB超表示ページがピン留めされl2Cache.putがfalseを返した場合も例外を出さず取得済みスライスをonPageReadyへ通知すること (AC-ENG-12, AC-ENG-13)", async () => {
    const p0 = new Uint8Array([1, 2, 3, 4]);
    const zipBytes = buildSyntheticZip({
      entries: [{ name: "000.jpg", data: p0 }],
    });
    const baseReader = createMemoryReader(zipBytes);
    const entries = await parseZipDirectory(baseReader);

    const cache = new L2ByteCache({ maxBytes: 100 });
    const readySlices: Array<[number, Uint8Array]> = [];

    await runPrefetchBatches({
      reader: {
        sourceId: baseReader.sourceId,
        totalSize: baseReader.totalSize,
        async readRange(offset, length, signal) {
          const buf = await baseReader.readRange(offset, length, signal);
          cache.setPinnedPages([99]);
          cache.put(99, new Uint8Array(120), { allowOversized: true });
          return buf;
        },
      },
      entries,
      prefetchIndices: [0],
      l2Cache: cache,
      callbacks: {
        onPageReady: (pageIndex, slice) => readySlices.push([pageIndex, slice]),
      },
    });

    expect(cache.has(0)).toBe(false);
    expect(readySlices).toHaveLength(1);
    expect(readySlices[0]?.[0]).toBe(0);
    expect(readySlices[0]?.[1]).toEqual(p0);
  });

  it("READ_ERRORおよびAbortError・事前/途中abort時に例外を送出せず安全に停止し全未解決ページをonPageSettledEmptyで解放通知すること (AC-ENG-13)", async () => {
    const p0 = new Uint8Array([1, 2, 3, 4]);
    const p1 = new Uint8Array([5, 6, 7, 8]);
    const zipBytes = buildSyntheticZip({
      entries: [
        { name: "000.jpg", data: p0 },
        { name: "gap.bin", data: new Uint8Array(70_000) },
        { name: "001.jpg", data: p1 },
      ],
    });
    const baseReader = createMemoryReader(zipBytes);
    const entries = await parseZipDirectory(baseReader);

    // 1. 事前 abort 済み
    const preAborted = new AbortController();
    preAborted.abort();
    const preOnPlan = vi.fn();
    const preRead = vi.fn();
    await runPrefetchBatches({
      reader: { sourceId: "pre", totalSize: 100, readRange: preRead },
      entries,
      prefetchIndices: [0, 1],
      l2Cache: new L2ByteCache(),
      signal: preAborted.signal,
      callbacks: { onPlanPages: preOnPlan },
    });
    expect(preOnPlan).not.toHaveBeenCalled();
    expect(preRead).not.toHaveBeenCalled();

    // 2. Batch 0 の readRange で READ_ERROR -> Batch 1 も含め全ページ [0, 1] を解放通知
    const emptyOnReadErr: number[] = [];
    const cache1 = new L2ByteCache();
    await expect(
      runPrefetchBatches({
        reader: {
          sourceId: "err",
          totalSize: baseReader.totalSize,
          async readRange() {
            throw new ZipArchiveError("READ_ERROR", "ネットワーク切断");
          },
        },
        entries,
        prefetchIndices: [0, 1],
        l2Cache: cache1,
        callbacks: {
          onPageSettledEmpty: (pageIndex) => emptyOnReadErr.push(pageIndex),
        },
      }),
    ).resolves.toBeUndefined();
    expect(emptyOnReadErr).toEqual([0, 1]);
    expect(cache1.size).toBe(0);

    // 3. Batch 0 成功後、readRange 完了後に signal が aborted になっていた場合（resolveAfterAbort）
    const midController = new AbortController();
    const cache2 = new L2ByteCache();
    const readyMid: number[] = [];
    const emptyMid: number[] = [];
    await runPrefetchBatches({
      reader: {
        sourceId: "mid-abort",
        totalSize: baseReader.totalSize,
        async readRange(offset, length) {
          const buf = await baseReader.readRange(offset, length);
          midController.abort();
          return buf;
        },
      },
      entries,
      prefetchIndices: [0, 1],
      l2Cache: cache2,
      signal: midController.signal,
      callbacks: {
        onPageReady: (pageIndex) => readyMid.push(pageIndex),
        onPageSettledEmpty: (pageIndex) => emptyMid.push(pageIndex),
      },
    });
    expect(readyMid).toEqual([]);
    expect(emptyMid).toEqual([0, 1]);
    expect(cache2.size).toBe(0);

    // 4. 2RTT 補完中の READ_ERROR / 完了後 abort でも安全停止＆未解決ページ解放
    // gap.bin (70KB) を挟み Batch 0=[000.jpg] (末尾のため 2RTT 発生), Batch 1=[001.jpg] に分割する
    const extraZip = buildSyntheticZip({
      entries: [
        {
          name: "000.jpg",
          data: p0,
          lfhExtra: new Uint8Array(5_000).fill(0xaa),
        },
        { name: "gap.bin", data: new Uint8Array(70_000) },
        { name: "001.jpg", data: p1 },
      ],
    });
    const extraReader = createMemoryReader(extraZip);
    const extraEntries = await parseZipDirectory(extraReader);

    let rttCall = 0;
    const empty2ndRttErr: number[] = [];
    await runPrefetchBatches({
      reader: {
        sourceId: "2nd-rtt-err",
        totalSize: extraReader.totalSize,
        async readRange(offset, length) {
          rttCall += 1;
          if (rttCall === 2) {
            throw new ZipArchiveError("READ_ERROR", "2RTT失敗");
          }
          return extraReader.readRange(offset, length);
        },
      },
      entries: extraEntries,
      prefetchIndices: [0, 1],
      l2Cache: new L2ByteCache(),
      callbacks: {
        onPageSettledEmpty: (pageIndex) => empty2ndRttErr.push(pageIndex),
      },
    });
    expect(empty2ndRttErr).toEqual([0, 1]);

    // 5. 2RTT 補完中に abort された場合（resolveAfterAbort / AbortError throw / abort後CORRUPT_ZIP）
    let rttAbortCall = 0;
    const rttController = new AbortController();
    const empty2ndRttAbort: number[] = [];
    await runPrefetchBatches({
      reader: {
        sourceId: "2nd-rtt-abort",
        totalSize: extraReader.totalSize,
        async readRange(offset, length) {
          rttAbortCall += 1;
          const buf = await extraReader.readRange(offset, length);
          if (rttAbortCall === 2) {
            rttController.abort();
          }
          return buf;
        },
      },
      entries: extraEntries,
      prefetchIndices: [0, 1],
      l2Cache: new L2ByteCache(),
      signal: rttController.signal,
      callbacks: {
        onPageSettledEmpty: (pageIndex) => empty2ndRttAbort.push(pageIndex),
      },
    });
    expect(empty2ndRttAbort).toEqual([0, 1]);

    let rttThrowAbortCall = 0;
    const empty2ndRttThrowAbort: number[] = [];
    await runPrefetchBatches({
      reader: {
        sourceId: "2nd-rtt-throw-abort",
        totalSize: extraReader.totalSize,
        async readRange(offset, length) {
          rttThrowAbortCall += 1;
          if (rttThrowAbortCall === 2) {
            throw new DOMException("Aborted", "AbortError");
          }
          return extraReader.readRange(offset, length);
        },
      },
      entries: extraEntries,
      prefetchIndices: [0, 1],
      l2Cache: new L2ByteCache(),
      callbacks: {
        onPageSettledEmpty: (pageIndex) =>
          empty2ndRttThrowAbort.push(pageIndex),
      },
    });
    expect(empty2ndRttThrowAbort).toEqual([0, 1]);

    let rttCorruptAfterAbortCall = 0;
    const corruptAbortController = new AbortController();
    const empty2ndRttCorruptAfterAbort: number[] = [];
    await runPrefetchBatches({
      reader: {
        sourceId: "2nd-rtt-corrupt-after-abort",
        totalSize: extraReader.totalSize,
        async readRange(offset, length) {
          rttCorruptAfterAbortCall += 1;
          if (rttCorruptAfterAbortCall === 2) {
            corruptAbortController.abort();
            return new Uint8Array(1);
          }
          return extraReader.readRange(offset, length);
        },
      },
      entries: extraEntries,
      prefetchIndices: [0, 1],
      l2Cache: new L2ByteCache(),
      signal: corruptAbortController.signal,
      callbacks: {
        onPageSettledEmpty: (pageIndex) =>
          empty2ndRttCorruptAfterAbort.push(pageIndex),
      },
    });
    expect(empty2ndRttCorruptAfterAbort).toEqual([0, 1]);

    // 5b. 2RTT 補完中に Fast-Path 等が対象ページを L2 へ格納した場合は既存L2を上書きせず解決通知する
    const raceCache = new L2ByteCache();
    const fastPathOverride = new Uint8Array([77, 88, 99]);
    let raceCall = 0;
    const raceReady: Array<[number, Uint8Array]> = [];
    await runPrefetchBatches({
      reader: {
        sourceId: "2nd-rtt-race-l2",
        totalSize: extraReader.totalSize,
        async readRange(offset, length, signal) {
          raceCall += 1;
          const buf = await extraReader.readRange(offset, length, signal);
          if (raceCall === 2) {
            raceCache.put(0, fastPathOverride);
          }
          return buf;
        },
      },
      entries: extraEntries,
      prefetchIndices: [0],
      l2Cache: raceCache,
      callbacks: {
        onPageReady: (pageIndex, slice) => raceReady.push([pageIndex, slice]),
      },
    });
    expect(raceCache.peek(0)).toEqual(fastPathOverride);
    expect(raceReady).toEqual([[0, fastPathOverride]]);

    // 6. Batch 0 内で 1件目格納後にループ内で abort が発火した場合
    const multiZip = buildSyntheticZip({
      entries: [
        { name: "000.jpg", data: p0 },
        { name: "001.jpg", data: p1 },
      ],
    });
    const multiReader = createMemoryReader(multiZip);
    const multiEntries = await parseZipDirectory(multiReader);
    const loopAbortController = new AbortController();
    const readyBeforeLoopAbort: number[] = [];
    const emptyAfterLoopAbort: number[] = [];
    await runPrefetchBatches({
      reader: multiReader,
      entries: multiEntries,
      prefetchIndices: [0, 1],
      l2Cache: new L2ByteCache(),
      signal: loopAbortController.signal,
      callbacks: {
        onPageReady: (pageIndex) => {
          readyBeforeLoopAbort.push(pageIndex);
          loopAbortController.abort();
        },
        onPageSettledEmpty: (pageIndex) => emptyAfterLoopAbort.push(pageIndex),
      },
    });
    expect(readyBeforeLoopAbort).toEqual([0]);
    expect(emptyAfterLoopAbort).toEqual([1]);

    // 7. Batch 0 格納中の onPageReady で abort された場合、Batch 1 先頭で安全停止し Batch 1 の readRange を行わない
    const twoBatchReadyController = new AbortController();
    const twoBatchReady: number[] = [];
    const twoBatchEmpty: number[] = [];
    let batchReads = 0;
    await runPrefetchBatches({
      reader: {
        sourceId: "two-batch-abort",
        totalSize: baseReader.totalSize,
        async readRange(offset, length, signal) {
          batchReads += 1;
          return baseReader.readRange(offset, length, signal);
        },
      },
      entries,
      prefetchIndices: [0, 1],
      l2Cache: new L2ByteCache(),
      signal: twoBatchReadyController.signal,
      callbacks: {
        onPageReady: (pageIndex) => {
          twoBatchReady.push(pageIndex);
          twoBatchReadyController.abort();
        },
        onPageSettledEmpty: (pageIndex) => twoBatchEmpty.push(pageIndex),
      },
    });
    expect(batchReads).toBe(1);
    expect(twoBatchReady).toEqual([0]);
    expect(twoBatchEmpty).toEqual([1]);
  });
});
