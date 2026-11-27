import { create } from "zustand";
import type { CoverExtractionProgressSnapshot } from "../../engine/cover/types";

export const INITIAL_COVER_EXTRACTION_SNAPSHOT: CoverExtractionProgressSnapshot =
  {
    phase: "idle",
    totalCount: 0,
    readyCount: 0,
    pendingCount: 0,
    errorCount: 0,
    activeVolumeId: null,
    pauseReasons: [],
  };

export interface CoverExtractionState extends CoverExtractionProgressSnapshot {
  readonly applySnapshot: (snapshot: CoverExtractionProgressSnapshot) => void;
}

export const useCoverExtractionStateStore = create<CoverExtractionState>(
  () => ({
    ...INITIAL_COVER_EXTRACTION_SNAPSHOT,
    applySnapshot: () => undefined,
  }),
);

export function resetCoverExtractionState(): void {
  // Red stub
}
