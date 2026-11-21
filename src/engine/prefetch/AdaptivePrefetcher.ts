import type { L2ByteCache } from "../cache/L2ByteCache";
import { ENGINE_BUDGETS } from "../constants";
import type { RandomAccessReader, ZipPageEntry } from "../types";
import { ZipArchiveError, isAbortError } from "../zip/errors";
import {
  computeEntryFetchSpan,
  extractCompressedSliceFromBuffer,
} from "../zip/zipParser";

export interface PrefetchBatch {
  readonly entries: readonly ZipPageEntry[];
  readonly rangeOffset: number;
  readonly rangeLength: number;
}

export interface PlanPrefetchBatchesParams {
  readonly entries: readonly ZipPageEntry[];
  readonly prefetchIndices: readonly number[];
  readonly l2Cache: Pick<
    L2ByteCache,
    "maxBytes" | "has" | "hasOversizedPinnedEntry"
  >;
  readonly excludedPageIndices?: Iterable<number>;
}

export interface PrefetchPageCallbacks {
  readonly onPlanPages?: (entries: readonly ZipPageEntry[]) => void;
  readonly onPageReady?: (pageIndex: number, slice: Uint8Array) => void;
  readonly onPageSettledEmpty?: (pageIndex: number) => void;
}

export interface RunPrefetchBatchesParams extends PlanPrefetchBatchesParams {
  readonly reader: RandomAccessReader;
  readonly l2Cache: Pick<
    L2ByteCache,
    "maxBytes" | "has" | "peek" | "put" | "hasOversizedPinnedEntry"
  >;
  readonly signal?: AbortSignal;
  readonly callbacks?: PrefetchPageCallbacks;
}

function selectPrefetchEntries(
  params: PlanPrefetchBatchesParams,
): ZipPageEntry[] {
  const { entries, prefetchIndices, l2Cache, excludedPageIndices } = params;
  const excluded = new Set<number>(excludedPageIndices);
  const seen = new Set<number>();
  const selected: ZipPageEntry[] = [];
  let accumulatedBytes = 0;

  for (const pageIndex of prefetchIndices) {
    if (
      !Number.isInteger(pageIndex) ||
      pageIndex < 0 ||
      pageIndex >= entries.length
    ) {
      continue;
    }
    if (seen.has(pageIndex)) {
      continue;
    }
    seen.add(pageIndex);

    if (excluded.has(pageIndex) || l2Cache.has(pageIndex)) {
      continue;
    }

    const entry = entries[pageIndex];
    if (
      entry.localHeaderOffset < 0 ||
      entry.physicalEnd - entry.localHeaderOffset < 30
    ) {
      continue;
    }
    if (entry.compressedSize > l2Cache.maxBytes) {
      continue;
    }

    const span = computeEntryFetchSpan(entry);
    if (
      selected.length === 0 &&
      span > ENGINE_BUDGETS.WARM_PREFETCH_BUDGET_BYTES
    ) {
      selected.push(entry);
      break;
    }
    if (accumulatedBytes + span > ENGINE_BUDGETS.WARM_PREFETCH_BUDGET_BYTES) {
      break;
    }

    selected.push(entry);
    accumulatedBytes += span;
  }

  return selected;
}

function coalescePrefetchBatches(
  selected: readonly ZipPageEntry[],
): PrefetchBatch[] {
  const sorted = [...selected].sort(
    (a, b) => a.localHeaderOffset - b.localHeaderOffset,
  );
  const batches: PrefetchBatch[] = [];
  let batchEntries: ZipPageEntry[] = [sorted[0]];
  let batchStart = sorted[0].localHeaderOffset;
  let batchEnd = batchStart + computeEntryFetchSpan(sorted[0]);

  for (let i = 1; i < sorted.length; i += 1) {
    const prev = batchEntries[batchEntries.length - 1];
    const next = sorted[i];
    const gap = next.localHeaderOffset - prev.physicalEnd;
    const candidateEnd = next.localHeaderOffset + computeEntryFetchSpan(next);

    if (
      gap >= 0 &&
      gap <= ENGINE_BUDGETS.MAX_COALESCE_GAP_BYTES &&
      candidateEnd - batchStart <= ENGINE_BUDGETS.WARM_PREFETCH_BUDGET_BYTES
    ) {
      batchEntries.push(next);
      batchEnd = candidateEnd;
    } else {
      batches.push({
        entries: batchEntries,
        rangeOffset: batchStart,
        rangeLength: batchEnd - batchStart,
      });
      batchEntries = [next];
      batchStart = next.localHeaderOffset;
      batchEnd = candidateEnd;
    }
  }

  batches.push({
    entries: batchEntries,
    rangeOffset: batchStart,
    rangeLength: batchEnd - batchStart,
  });

  return batches;
}

export function planPrefetchBatches(
  params: PlanPrefetchBatchesParams,
): PrefetchBatch[] {
  if (params.l2Cache.hasOversizedPinnedEntry()) {
    return [];
  }

  const selected = selectPrefetchEntries(params);
  if (selected.length === 0) {
    return [];
  }

  return coalescePrefetchBatches(selected);
}

export async function runPrefetchBatches(
  params: RunPrefetchBatchesParams,
): Promise<void> {
  const { reader, l2Cache, signal, callbacks } = params;
  if (signal?.aborted) {
    return;
  }

  const batches = planPrefetchBatches(params);
  if (batches.length === 0) {
    return;
  }

  const plannedEntries = batches.flatMap((batch) => batch.entries);
  const settledPages = new Set<number>();
  callbacks?.onPlanPages?.(plannedEntries);

  try {
    for (const batch of batches) {
      if (signal?.aborted) {
        return;
      }

      if (batch.entries.every((entry) => l2Cache.has(entry.pageIndex))) {
        for (const entry of batch.entries) {
          const cached = l2Cache.peek(entry.pageIndex) as Uint8Array;
          settledPages.add(entry.pageIndex);
          callbacks?.onPageReady?.(entry.pageIndex, cached);
        }
        continue;
      }

      let coalescedBuf: Uint8Array;
      try {
        coalescedBuf = await reader.readRange(
          batch.rangeOffset,
          batch.rangeLength,
          signal,
        );
      } catch {
        return;
      }

      if (signal?.aborted) {
        return;
      }

      for (const entry of batch.entries) {
        if (signal?.aborted) {
          return;
        }

        const existing = l2Cache.peek(entry.pageIndex);
        if (existing !== undefined) {
          settledPages.add(entry.pageIndex);
          callbacks?.onPageReady?.(entry.pageIndex, existing);
          continue;
        }

        const relStart = entry.localHeaderOffset - batch.rangeOffset;
        const relEnd = Math.min(
          coalescedBuf.byteLength,
          entry.physicalEnd - batch.rangeOffset,
        );
        const initialBuf = coalescedBuf.subarray(relStart, relEnd);

        try {
          const slice = await extractCompressedSliceFromBuffer(
            reader,
            entry,
            initialBuf,
            signal,
          );
          if (signal?.aborted) {
            return;
          }

          let resolvedSlice = l2Cache.peek(entry.pageIndex);
          if (resolvedSlice === undefined) {
            const stored = l2Cache.put(entry.pageIndex, slice, {
              allowOversized: false,
            });
            resolvedSlice = stored
              ? (l2Cache.peek(entry.pageIndex) as Uint8Array)
              : slice;
          }
          settledPages.add(entry.pageIndex);
          callbacks?.onPageReady?.(entry.pageIndex, resolvedSlice);
        } catch (error) {
          if (
            isAbortError(error) ||
            signal?.aborted ||
            (error instanceof ZipArchiveError && error.code === "READ_ERROR")
          ) {
            return;
          }
          settledPages.add(entry.pageIndex);
          callbacks?.onPageSettledEmpty?.(entry.pageIndex);
        }
      }
    }
  } finally {
    for (const entry of plannedEntries) {
      if (!settledPages.has(entry.pageIndex)) {
        settledPages.add(entry.pageIndex);
        callbacks?.onPageSettledEmpty?.(entry.pageIndex);
      }
    }
  }
}
