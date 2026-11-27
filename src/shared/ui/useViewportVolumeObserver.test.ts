import { cleanup, render } from "@testing-library/react";
import { createElement, useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  CoverExtractionScheduler,
  CoverViewportScreenKey,
} from "../../engine/cover/types";
import {
  COVER_VOLUME_ID_ATTRIBUTE,
  VIEWPORT_OBSERVER_ROOT_MARGIN,
  useViewportVolumeObserver,
} from "./useViewportVolumeObserver";

interface MockObserverRecord {
  readonly callback: IntersectionObserverCallback;
  readonly options: IntersectionObserverInit | undefined;
  readonly observed: Set<Element>;
  readonly observeSpy: ReturnType<typeof vi.fn>;
  readonly unobserveSpy: ReturnType<typeof vi.fn>;
  readonly disconnectSpy: ReturnType<typeof vi.fn>;
  trigger: (
    entries: Array<{ target: Element; isIntersecting: boolean }>,
  ) => void;
}

function installMockIntersectionObserver(): MockObserverRecord[] {
  const instances: MockObserverRecord[] = [];

  class MockIntersectionObserver implements IntersectionObserver {
    readonly root: Element | Document | null = null;
    readonly rootMargin: string;
    readonly thresholds: ReadonlyArray<number> = [];
    private readonly record: MockObserverRecord;

    constructor(
      callback: IntersectionObserverCallback,
      options?: IntersectionObserverInit,
    ) {
      this.rootMargin = options?.rootMargin ?? "0px";
      const observed = new Set<Element>();
      const observeSpy = vi.fn((element: Element) => {
        observed.add(element);
      });
      const unobserveSpy = vi.fn((element: Element) => {
        observed.delete(element);
      });
      const disconnectSpy = vi.fn(() => {
        observed.clear();
      });

      this.record = {
        callback,
        options,
        observed,
        observeSpy,
        unobserveSpy,
        disconnectSpy,
        trigger: (entries) => {
          callback(
            entries.map(
              (item) =>
                ({
                  target: item.target,
                  isIntersecting: item.isIntersecting,
                }) as IntersectionObserverEntry,
            ),
            this,
          );
        },
      };
      instances.push(this.record);
    }

    observe(target: Element): void {
      this.record.observeSpy(target);
    }

    unobserve(target: Element): void {
      this.record.unobserveSpy(target);
    }

    disconnect(): void {
      this.record.disconnectSpy();
    }

    takeRecords(): IntersectionObserverEntry[] {
      return [];
    }
  }

  vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
  return instances;
}

interface HarnessProps {
  readonly screenKey?: CoverViewportScreenKey;
  readonly scheduler: Pick<CoverExtractionScheduler, "setViewportVolumeIds">;
  readonly pendingVolumeIds: readonly string[];
  readonly renderedItems: ReadonlyArray<{
    readonly key: string;
    readonly coverVolumeId?: string;
  }>;
  readonly enabled?: boolean;
  readonly mountContainer?: boolean;
}

function ObserverHarness({
  screenKey = "bookshelf",
  scheduler,
  pendingVolumeIds,
  renderedItems,
  enabled,
  mountContainer = true,
}: HarnessProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  useViewportVolumeObserver({
    containerRef,
    screenKey,
    scheduler,
    pendingVolumeIds,
    enabled,
  });

  if (!mountContainer) {
    return null;
  }

  return createElement(
    "div",
    { ref: containerRef, "data-testid": "observer-container" },
    renderedItems.map((item) =>
      createElement("div", {
        key: item.key,
        "data-testid": `item-${item.key}`,
        ...(item.coverVolumeId !== undefined
          ? { [COVER_VOLUME_ID_ATTRIBUTE]: item.coverVolumeId }
          : {}),
      }),
    ),
  );
}

describe("useViewportVolumeObserver", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("IntersectionObserver 未定義環境および enabled=false・container未マウント時は安全に no-op で終了すること (AC-COV-03)", () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    const setViewportVolumeIds = vi.fn();

    const { unmount } = render(
      createElement(ObserverHarness, {
        scheduler: { setViewportVolumeIds },
        pendingVolumeIds: ["v1"],
        renderedItems: [{ key: "v1", coverVolumeId: "v1" }],
      }),
    );
    expect(setViewportVolumeIds).not.toHaveBeenCalled();
    unmount();

    const observers = installMockIntersectionObserver();
    const { unmount: unmountDisabled } = render(
      createElement(ObserverHarness, {
        scheduler: { setViewportVolumeIds },
        pendingVolumeIds: ["v1"],
        renderedItems: [{ key: "v1", coverVolumeId: "v1" }],
        enabled: false,
      }),
    );
    expect(observers).toHaveLength(0);
    expect(setViewportVolumeIds).not.toHaveBeenCalled();
    unmountDisabled();

    const { unmount: unmountNoContainer } = render(
      createElement(ObserverHarness, {
        scheduler: { setViewportVolumeIds },
        pendingVolumeIds: ["v1"],
        renderedItems: [],
        mountContainer: false,
      }),
    );
    expect(observers).toHaveLength(1);
    expect(observers[0]?.observeSpy).not.toHaveBeenCalled();
    unmountNoContainer();
    expect(observers[0]?.disconnectSpy).toHaveBeenCalledTimes(1);
    expect(setViewportVolumeIds).toHaveBeenCalledWith("bookshelf", new Set());
  });

  it("rootMargin 200px 0px で pending 要素を監視し、交差変化・再走査・非 pending 除外・アンマウントクリアを通知すること (AC-COV-03)", () => {
    const observers = installMockIntersectionObserver();
    const setViewportVolumeIds = vi.fn();
    const scheduler = { setViewportVolumeIds };

    const { getByTestId, rerender, unmount } = render(
      createElement(ObserverHarness, {
        screenKey: "series-detail",
        scheduler,
        pendingVolumeIds: ["v1", "v2"],
        renderedItems: [
          { key: "v1", coverVolumeId: "v1" },
          { key: "v2", coverVolumeId: "v2" },
          { key: "ready", coverVolumeId: "v-ready" },
          { key: "empty", coverVolumeId: "" },
        ],
      }),
    );

    expect(observers).toHaveLength(1);
    const observer = observers[0]!;
    expect(observer.options).toEqual({
      rootMargin: VIEWPORT_OBSERVER_ROOT_MARGIN,
    });

    const el1 = getByTestId("item-v1");
    const el2 = getByTestId("item-v2");
    const elReady = getByTestId("item-ready");
    const elEmpty = getByTestId("item-empty");

    expect(observer.observed.has(el1)).toBe(true);
    expect(observer.observed.has(el2)).toBe(true);
    expect(observer.observed.has(elReady)).toBe(false);
    expect(observer.observed.has(elEmpty)).toBe(false);

    // 交差開始（重複通知・属性なし要素・未交差要素の離脱は無視されること）
    observer.trigger([
      { target: el1, isIntersecting: true },
      { target: el2, isIntersecting: true },
      { target: elEmpty, isIntersecting: true },
    ]);
    expect(setViewportVolumeIds).toHaveBeenCalledTimes(1);
    expect(setViewportVolumeIds).toHaveBeenLastCalledWith(
      "series-detail",
      new Set(["v1", "v2"]),
    );

    observer.trigger([
      { target: el1, isIntersecting: true },
      { target: elReady, isIntersecting: false },
    ]);
    expect(setViewportVolumeIds).toHaveBeenCalledTimes(1);

    // 画面外離脱
    observer.trigger([{ target: el2, isIntersecting: false }]);
    expect(setViewportVolumeIds).toHaveBeenCalledTimes(2);
    expect(setViewportVolumeIds).toHaveBeenLastCalledWith(
      "series-detail",
      new Set(["v1"]),
    );

    // v1 が抽出完了して非 pending 化し、v3 がエラー再試行で pending 復帰した場合の再走査
    rerender(
      createElement(ObserverHarness, {
        screenKey: "series-detail",
        scheduler,
        pendingVolumeIds: ["v2", "v3"],
        renderedItems: [
          { key: "v1" },
          { key: "v2", coverVolumeId: "v2" },
          { key: "v3", coverVolumeId: "v3" },
        ],
      }),
    );

    const el3 = getByTestId("item-v3");
    expect(observer.unobserveSpy).toHaveBeenCalledWith(el1);
    expect(observer.observeSpy).toHaveBeenCalledWith(el3);
    expect(observer.observed.has(el2)).toBe(true);
    expect(observer.observed.has(el3)).toBe(true);
    // 非 pending 化した v1 が可視集合から即時除外されること
    expect(setViewportVolumeIds).toHaveBeenCalledTimes(3);
    expect(setViewportVolumeIds).toHaveBeenLastCalledWith(
      "series-detail",
      new Set(),
    );

    // v2 を可視にした後、v4 を追加しても既存の可視 v2 が維持され不要な通知が起きないこと
    observer.trigger([{ target: el2, isIntersecting: true }]);
    expect(setViewportVolumeIds).toHaveBeenCalledTimes(4);
    expect(setViewportVolumeIds).toHaveBeenLastCalledWith(
      "series-detail",
      new Set(["v2"]),
    );

    rerender(
      createElement(ObserverHarness, {
        screenKey: "series-detail",
        scheduler,
        pendingVolumeIds: ["v2", "v3", "v4"],
        renderedItems: [
          { key: "v2", coverVolumeId: "v2" },
          { key: "v3", coverVolumeId: "v3" },
          { key: "v4", coverVolumeId: "v4" },
        ],
      }),
    );
    expect(setViewportVolumeIds).toHaveBeenCalledTimes(4);

    // アンマウント時に disconnect + 空 Set でクリア
    unmount();
    expect(observer.disconnectSpy).toHaveBeenCalledTimes(1);
    expect(setViewportVolumeIds).toHaveBeenCalledTimes(5);
    expect(setViewportVolumeIds).toHaveBeenLastCalledWith(
      "series-detail",
      new Set(),
    );
  });
});
