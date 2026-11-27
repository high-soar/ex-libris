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
  (set) => ({
    ...INITIAL_COVER_EXTRACTION_SNAPSHOT,
    applySnapshot: (snapshot) => {
      set({
        phase: snapshot.phase,
        totalCount: snapshot.totalCount,
        readyCount: snapshot.readyCount,
        pendingCount: snapshot.pendingCount,
        errorCount: snapshot.errorCount,
        activeVolumeId: snapshot.activeVolumeId,
        pauseReasons: [...snapshot.pauseReasons],
      });
    },
  }),
);

export function resetCoverExtractionState(): void {
  useCoverExtractionStateStore.setState({
    ...INITIAL_COVER_EXTRACTION_SNAPSHOT,
    pauseReasons: [],
  });
}
