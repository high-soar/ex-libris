import { afterEach, describe, expect, it } from "vitest";
import {
  INITIAL_COVER_EXTRACTION_SNAPSHOT,
  resetCoverExtractionState,
  useCoverExtractionStateStore,
} from "./coverExtractionStateStore";

describe("coverExtractionStateStore", () => {
  afterEach(() => {
    resetCoverExtractionState();
  });

  it("初期状態・applySnapshot・resetCoverExtractionStateが正しく動作すること (AC-COV-08)", () => {
    expect(useCoverExtractionStateStore.getState()).toMatchObject(
      INITIAL_COVER_EXTRACTION_SNAPSHOT,
    );

    useCoverExtractionStateStore.getState().applySnapshot({
      phase: "running",
      totalCount: 10,
      readyCount: 3,
      pendingCount: 6,
      errorCount: 1,
      activeVolumeId: "vol-4",
      pauseReasons: ["reader"],
    });

    expect(useCoverExtractionStateStore.getState()).toMatchObject({
      phase: "running",
      totalCount: 10,
      readyCount: 3,
      pendingCount: 6,
      errorCount: 1,
      activeVolumeId: "vol-4",
      pauseReasons: ["reader"],
    });

    resetCoverExtractionState();
    expect(useCoverExtractionStateStore.getState()).toMatchObject(
      INITIAL_COVER_EXTRACTION_SNAPSHOT,
    );
  });
});
