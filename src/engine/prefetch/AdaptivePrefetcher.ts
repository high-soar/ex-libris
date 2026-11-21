import type { L2ByteCache } from "../cache/L2ByteCache";
import type { RandomAccessReader, ZipPageEntry } from "../types";

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
  readonly signal?: AbortSignal;
  readonly callbacks?: PrefetchPageCallbacks;
}

export function planPrefetchBatches(
  _params: PlanPrefetchBatchesParams,
): PrefetchBatch[] {
  return [];
}

export async function runPrefetchBatches(
  _params: RunPrefetchBatchesParams,
): Promise<void> {
  // Red: Greenステップで実装
}
