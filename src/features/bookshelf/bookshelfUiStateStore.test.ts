import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import {
  resetBookshelfUiState,
  useBookshelfUiStateStore,
} from "./bookshelfUiStateStore";

describe("bookshelfUiStateStore", () => {
  beforeEach(() => {
    resetBookshelfUiState();
  });

  it("初期状態ではscrollY=0・sortOrder='lastReadDesc'・seriesDetailScroll=nullであること", () => {
    const state = useBookshelfUiStateStore.getState();
    expect(state.scrollY).toBe(0);
    expect(state.sortOrder).toBe("lastReadDesc");
    expect(state.seriesDetailScroll).toBeNull();
  });

  it("saveScrollYで正のスクロール位置を保存・更新し、非正数や非有限値は0へ正規化すること (TR-03, TR-09)", () => {
    const { result } = renderHook(() => useBookshelfUiStateStore());
    expect(result.current.scrollY).toBe(0);

    act(() => {
      result.current.saveScrollY(240);
    });
    expect(result.current.scrollY).toBe(240);

    act(() => {
      result.current.saveScrollY(128.5);
    });
    expect(result.current.scrollY).toBe(128.5);

    act(() => {
      result.current.saveScrollY(-10);
    });
    expect(result.current.scrollY).toBe(0);

    act(() => {
      result.current.saveScrollY(Number.NaN);
    });
    expect(result.current.scrollY).toBe(0);

    act(() => {
      result.current.saveScrollY(Number.POSITIVE_INFINITY);
    });
    expect(result.current.scrollY).toBe(0);
  });

  it("setSortOrder・saveSeriesDetailScroll・clearSeriesDetailScroll・resetBookshelfUiStateが正しく動作すること (AC-BS-10, AC-SD-03)", () => {
    const { result } = renderHook(() => useBookshelfUiStateStore());

    act(() => {
      result.current.setSortOrder("titleAsc");
    });
    expect(result.current.sortOrder).toBe("titleAsc");

    act(() => {
      result.current.saveSeriesDetailScroll("series-1", 420);
    });
    expect(result.current.seriesDetailScroll).toEqual({
      seriesId: "series-1",
      scrollY: 420,
    });

    // 非正の scrollY は 0 へ正規化、空白のみ seriesId は null へ正規化
    act(() => {
      result.current.saveSeriesDetailScroll("series-2", -30);
    });
    expect(result.current.seriesDetailScroll).toEqual({
      seriesId: "series-2",
      scrollY: 0,
    });

    act(() => {
      result.current.saveSeriesDetailScroll("   ", 200);
    });
    expect(result.current.seriesDetailScroll).toBeNull();

    act(() => {
      result.current.saveSeriesDetailScroll("series-3", 180);
    });
    act(() => {
      result.current.clearSeriesDetailScroll();
    });
    expect(result.current.seriesDetailScroll).toBeNull();

    // clearScrollY / resetBookshelfUiState
    act(() => {
      result.current.saveScrollY(360);
      result.current.setSortOrder("volumeCountDesc");
      result.current.saveSeriesDetailScroll("series-4", 510);
    });

    act(() => {
      result.current.clearScrollY();
    });
    expect(result.current.scrollY).toBe(0);
    expect(result.current.sortOrder).toBe("volumeCountDesc");

    act(() => {
      result.current.saveScrollY(480);
    });
    act(() => {
      resetBookshelfUiState();
    });
    expect(result.current.scrollY).toBe(0);
    expect(result.current.sortOrder).toBe("lastReadDesc");
    expect(result.current.seriesDetailScroll).toBeNull();
  });
});
