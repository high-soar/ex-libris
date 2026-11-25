import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import {
  resetBookshelfUiState,
  useBookshelfUiStateStore,
} from "./bookshelfUiStateStore";

describe("bookshelfUiStateStore", () => {
  beforeEach(() => {
    useBookshelfUiStateStore.setState({ scrollY: 0 });
  });

  it("初期状態ではscrollYが0であること", () => {
    expect(useBookshelfUiStateStore.getState().scrollY).toBe(0);
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

  it("clearScrollYおよびresetBookshelfUiStateでscrollYが0へ初期化されること (TR-09)", () => {
    useBookshelfUiStateStore.getState().saveScrollY(360);
    expect(useBookshelfUiStateStore.getState().scrollY).toBe(360);

    useBookshelfUiStateStore.getState().clearScrollY();
    expect(useBookshelfUiStateStore.getState().scrollY).toBe(0);

    useBookshelfUiStateStore.getState().saveScrollY(480);
    expect(useBookshelfUiStateStore.getState().scrollY).toBe(480);

    resetBookshelfUiState();
    expect(useBookshelfUiStateStore.getState().scrollY).toBe(0);
  });
});
