import { composeStories } from "@storybook/react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  type ReactElement,
  StrictMode,
  useEffect,
  useRef,
  useState,
} from "react";
import { flushSync } from "react-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type MockInstance,
  vi,
} from "vitest";
import { ServiceProvider } from "../../app/ServiceProvider";
import type { CoordinatorSessionHandle } from "../../app/coordinatorClient";
import { diagnosticLogger } from "../../diagnostics/diagnosticLogger";
import type {
  CoordinatorWorkerApi,
  DecodedPageFrame,
  OpenArchiveResult,
  ZipErrorCode,
  ZipPageEntry,
} from "../../engine/types";
import { ZipArchiveError } from "../../engine/zip/errors";
import { RouterProvider } from "../../shared/router/RouterProvider";
import { resetTestDb } from "../../storage/db";
import type { ZipIndexCacheRepository } from "../../storage/repositories/zipIndexCacheRepository";
import * as ReaderCanvasModule from "../../webgl/ReaderCanvas";
import { L1PageCache } from "../../webgl/l1PageCache";
import * as ReaderErrorViewModule from "./ReaderErrorView";
import * as ReaderHudOverlayModule from "./ReaderHudOverlay";
import { ReaderPage, type ReaderPageProps } from "./ReaderPage";
import * as stories from "./ReaderPage.stories";
import { useLocalReaderSessionStore } from "./localReaderSessionStore";

const {
  FullscreenCanvas,
  HudOpen,
  ArchiveError,
  PageError,
  SpreadRtlHudOpen,
  SpreadLtrOffsetOnHudOpen,
  LandscapeAutoSingle,
  PortraitAutoSingle,
  PartialSpreadError,
} = composeStories(stories);

function createFakeBitmap(width = 800, height = 1200): ImageBitmap {
  return {
    width,
    height,
    close: vi.fn(),
  } as unknown as ImageBitmap;
}

function createReadyFrame(
  pageIndex: number,
  epoch: number,
  bitmap = createFakeBitmap(),
): Extract<DecodedPageFrame, { status: "ready" }> {
  return {
    status: "ready",
    pageIndex,
    epoch,
    width: bitmap.width,
    height: bitmap.height,
    bitmap,
  };
}

function createErrorFrame(
  pageIndex: number,
  epoch: number,
  errorCode: ZipErrorCode = "DECODE_FAILED",
  message = `page ${pageIndex} decode failed`,
): Extract<DecodedPageFrame, { status: "error" }> {
  return {
    status: "error",
    pageIndex,
    epoch,
    errorCode,
    message,
  };
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

function createSampleZipEntries(count = 2): ZipPageEntry[] {
  return Array.from({ length: count }, (_, pageIndex) => ({
    pageIndex,
    entryName: `${String(pageIndex + 1).padStart(3, "0")}.jpg`,
    entryNameByteLength: 7,
    compressionMethod: 0,
    compressedSize: 128,
    uncompressedSize: 128,
    localHeaderOffset: pageIndex * 200,
    physicalEnd: pageIndex * 200 + 180,
    crc32: 0x12340000 + pageIndex,
  }));
}

function createMockZipIndexCacheRepo(
  overrides: Partial<ZipIndexCacheRepository> = {},
): ZipIndexCacheRepository {
  return {
    get: vi.fn(async () => null),
    put: vi.fn(async () => {}),
    delete: vi.fn(async () => {}),
    ...overrides,
  };
}

function dispatchPointer(
  target: HTMLElement,
  type: "pointerdown" | "pointerup" | "pointercancel",
  coords: { clientX?: number; clientY?: number } = {},
): void {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: coords.clientX ?? 0,
    clientY: coords.clientY ?? 0,
  });
  fireEvent(target, event);
}

function createMockCoordinatorSession(
  overrides: Partial<CoordinatorWorkerApi> = {},
) {
  const openArchive = vi.fn<CoordinatorWorkerApi["openArchive"]>(
    overrides.openArchive ??
      (async (): Promise<OpenArchiveResult> => ({
        pageCount: 6,
        entries: [],
        fromIndexCache: false,
      })),
  );
  const requestVisiblePages = vi.fn<
    CoordinatorWorkerApi["requestVisiblePages"]
  >(
    overrides.requestVisiblePages ??
      (async (
        pageIndices: readonly number[],
        _prefetch: readonly number[],
        epoch: number,
      ) => pageIndices.map((pageIndex) => createReadyFrame(pageIndex, epoch))),
  );
  const updateAccessToken = vi.fn<CoordinatorWorkerApi["updateAccessToken"]>(
    overrides.updateAccessToken,
  );
  const cancelEpochBelow = vi.fn<CoordinatorWorkerApi["cancelEpochBelow"]>(
    overrides.cancelEpochBelow,
  );
  const closeArchive = vi.fn<CoordinatorWorkerApi["closeArchive"]>(
    overrides.closeArchive ?? (async () => {}),
  );

  const api = {
    openArchive,
    requestVisiblePages,
    updateAccessToken,
    cancelEpochBelow,
    closeArchive,
  };
  const dispose = vi.fn();
  const handle: CoordinatorSessionHandle = { api, dispose };
  return { api, dispose, handle };
}

function mockSurfaceRect(
  surface: HTMLElement,
  rect: { left: number; width: number },
): void {
  vi.spyOn(surface, "getBoundingClientRect").mockReturnValue({
    left: rect.left,
    top: 0,
    right: rect.left + rect.width,
    bottom: 800,
    width: rect.width,
    height: 800,
    x: rect.left,
    y: 0,
    toJSON: () => ({}),
  });
}

function setWindowSize(width: number, height: number): void {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: width,
  });
  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    value: height,
  });
}

describe("ReaderPage", () => {
  const originalUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  const originalInnerWidth = Object.getOwnPropertyDescriptor(
    window,
    "innerWidth",
  );
  const originalInnerHeight = Object.getOwnPropertyDescriptor(
    window,
    "innerHeight",
  );

  let canvasSpy: MockInstance<typeof ReaderCanvasModule.ReaderCanvas>;
  let hudSpy: MockInstance<typeof ReaderHudOverlayModule.ReaderHudOverlay>;
  let errorViewSpy: MockInstance<typeof ReaderErrorViewModule.ReaderErrorView>;

  beforeEach(async () => {
    await resetTestDb();
    diagnosticLogger.clear();
    useLocalReaderSessionStore.setState({ session: null });
    window.history.replaceState(null, "", "/read/local");
    setWindowSize(1024, 768);

    canvasSpy = vi
      .spyOn(ReaderCanvasModule, "ReaderCanvas")
      .mockImplementation(() => null as unknown as ReactElement);
    hudSpy = vi
      .spyOn(ReaderHudOverlayModule, "ReaderHudOverlay")
      .mockImplementation(() => null);
    errorViewSpy = vi
      .spyOn(ReaderErrorViewModule, "ReaderErrorView")
      .mockImplementation(() => null);
  });

  afterEach(async () => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    if (originalInnerWidth) {
      Object.defineProperty(window, "innerWidth", originalInnerWidth);
    }
    if (originalInnerHeight) {
      Object.defineProperty(window, "innerHeight", originalInnerHeight);
    }
    useLocalReaderSessionStore.setState({ session: null });
    window.history.replaceState(null, "", originalUrl || "/");
    await resetTestDb();
  });

  const getLatestCanvasProps = (): ReaderCanvasModule.ReaderCanvasProps => {
    const lastCall = canvasSpy.mock.calls.at(-1);
    expect(lastCall).toBeDefined();
    return lastCall![0] as ReaderCanvasModule.ReaderCanvasProps;
  };

  const getLatestHudProps =
    (): ReaderHudOverlayModule.ReaderHudOverlayProps => {
      const lastCall = hudSpy.mock.calls.at(-1);
      expect(lastCall).toBeDefined();
      return lastCall![0] as ReaderHudOverlayModule.ReaderHudOverlayProps;
    };

  const getLatestErrorViewProps =
    (): ReaderErrorViewModule.ReaderErrorViewProps => {
      const lastCall = errorViewSpy.mock.calls.at(-1);
      expect(lastCall).toBeDefined();
      return lastCall![0] as ReaderErrorViewModule.ReaderErrorViewProps;
    };

  const renderWithSession = (
    props: ReaderPageProps = {},
    sessionFactory?: () => CoordinatorSessionHandle,
    file = new File(["zip-bytes"], "comic-vol01.cbz", {
      type: "application/x-cbz",
    }),
    zipIndexCacheRepo?: ZipIndexCacheRepository,
  ) => {
    useLocalReaderSessionStore.getState().openLocalFile(file);
    return render(
      <ServiceProvider
        createCoordinatorSession={sessionFactory}
        zipIndexCacheRepo={zipIndexCacheRepo}
      >
        <RouterProvider initialPath="/read/local">
          <ReaderPage {...props} />
        </RouterProvider>
      </ServiceProvider>,
    );
  };

  it("全Storybookストーリーを決定論的に描画し直下子コンポーネントへ期待Propsを渡すこと (AC-RD-02, AC-RD-06, AC-RD-07, AC-RD-10, AC-RD-11, AC-RD-12)", () => {
    const { unmount: unmountFullscreen } = render(<FullscreenCanvas />);
    expect(screen.getByTestId("reader-page")).toBeVisible();
    expect(screen.getByTestId("reader-loading")).toBeVisible();
    expect(getLatestCanvasProps().slots).toEqual([
      { slot: { pageIndex: 0, position: "center" }, frame: null },
    ]);
    expect(getLatestHudProps()).toEqual({
      isOpen: false,
      fileName: "sample-comic-vol01.cbz",
      currentPageIndex: 0,
      totalPages: 24,
      onClose: expect.any(Function),
      onNextPage: expect.any(Function),
      onPrevPage: expect.any(Function),
      readingDirection: "rtl",
      spreadMode: "auto",
      effectiveSpreadMode: "spread",
      spreadPageOffset: 0,
      pageIndicatorText: "1 / 24",
      maxDisplayedPageIndex: 0,
      onCycleSpreadMode: expect.any(Function),
      onToggleSpreadPageOffset: expect.any(Function),
      onToggleReadingDirection: expect.any(Function),
    });
    expect(errorViewSpy).not.toHaveBeenCalled();
    unmountFullscreen();

    errorViewSpy.mockClear();
    const { unmount: unmountHud } = render(<HudOpen />);
    expect(getLatestHudProps()).toMatchObject({
      isOpen: true,
      fileName: "sample-comic-vol01.cbz",
      currentPageIndex: 11,
      maxDisplayedPageIndex: 12,
      pageIndicatorText: "12-13 / 24",
      totalPages: 24,
      spreadMode: "auto",
      effectiveSpreadMode: "spread",
    });
    act(() => {
      getLatestHudProps().onNextPage();
    });
    expect(getLatestHudProps().currentPageIndex).toBe(13);
    unmountHud();

    errorViewSpy.mockClear();
    const { unmount: unmountArchiveError } = render(<ArchiveError />);
    expect(screen.queryByTestId("reader-loading")).not.toBeInTheDocument();
    expect(getLatestHudProps().isOpen).toBe(false);
    expect(getLatestErrorViewProps()).toEqual({
      mode: "archive",
      message: "ZIP ファイルが破損しているため開けませんでした",
      errorCode: "CORRUPT_ZIP",
      onBackToHome: expect.any(Function),
    });
    unmountArchiveError();

    errorViewSpy.mockClear();
    const { unmount: unmountPageError } = render(<PageError />);
    expect(screen.queryByTestId("reader-loading")).not.toBeInTheDocument();
    expect(getLatestErrorViewProps()).toEqual({
      mode: "page",
      slotPosition: "center",
      message: "ページの画像デコードに失敗しました",
      errorCode: "DECODE_FAILED",
    });
    unmountPageError();

    errorViewSpy.mockClear();
    const { unmount: unmountSpreadRtl } = render(<SpreadRtlHudOpen />);
    expect(screen.queryByTestId("reader-loading")).not.toBeInTheDocument();
    expect(getLatestCanvasProps().slots).toEqual([
      {
        slot: { pageIndex: 2, position: "left" },
        frame: expect.objectContaining({ status: "ready", pageIndex: 2 }),
      },
      {
        slot: { pageIndex: 1, position: "right" },
        frame: expect.objectContaining({ status: "ready", pageIndex: 1 }),
      },
    ]);
    expect(getLatestHudProps()).toMatchObject({
      isOpen: true,
      readingDirection: "rtl",
      spreadMode: "spread",
      effectiveSpreadMode: "spread",
      spreadPageOffset: 0,
      pageIndicatorText: "2-3 / 24",
      maxDisplayedPageIndex: 2,
    });
    unmountSpreadRtl();

    const { unmount: unmountSpreadLtr } = render(<SpreadLtrOffsetOnHudOpen />);
    expect(getLatestCanvasProps().slots).toEqual([
      {
        slot: { pageIndex: 2, position: "left" },
        frame: expect.objectContaining({ status: "ready", pageIndex: 2 }),
      },
      {
        slot: { pageIndex: 3, position: "right" },
        frame: expect.objectContaining({ status: "ready", pageIndex: 3 }),
      },
    ]);
    expect(getLatestHudProps()).toMatchObject({
      isOpen: true,
      readingDirection: "ltr",
      spreadMode: "spread",
      effectiveSpreadMode: "spread",
      spreadPageOffset: 1,
      pageIndicatorText: "3-4 / 24",
      maxDisplayedPageIndex: 3,
    });
    unmountSpreadLtr();

    const { unmount: unmountLandscape } = render(<LandscapeAutoSingle />);
    expect(getLatestCanvasProps().slots).toEqual([
      {
        slot: { pageIndex: 4, position: "center" },
        frame: expect.objectContaining({ status: "ready", pageIndex: 4 }),
      },
    ]);
    expect(getLatestHudProps().pageIndicatorText).toBe("5 / 24");
    unmountLandscape();

    const { unmount: unmountPortrait } = render(<PortraitAutoSingle />);
    expect(getLatestCanvasProps().slots).toEqual([
      {
        slot: { pageIndex: 1, position: "center" },
        frame: expect.objectContaining({ status: "ready", pageIndex: 1 }),
      },
    ]);
    expect(getLatestHudProps()).toMatchObject({
      spreadMode: "auto",
      effectiveSpreadMode: "single",
      pageIndicatorText: "2 / 24",
    });
    unmountPortrait();

    errorViewSpy.mockClear();
    render(<PartialSpreadError />);
    expect(screen.queryByTestId("reader-loading")).not.toBeInTheDocument();
    expect(getLatestCanvasProps().slots).toEqual([
      {
        slot: { pageIndex: 2, position: "left" },
        frame: expect.objectContaining({ status: "error", pageIndex: 2 }),
      },
      {
        slot: { pageIndex: 1, position: "right" },
        frame: expect.objectContaining({ status: "ready", pageIndex: 1 }),
      },
    ]);
    expect(getLatestErrorViewProps()).toEqual({
      mode: "page",
      slotPosition: "left",
      pageNumber: 3,
      message: "ページの画像デコードに失敗しました",
      errorCode: "DECODE_FAILED",
    });
  });

  it("ローカルセッション不在時はWorkerを起動せずnullを返して'/'へ即時フォールバックすること (AC-RD-01, TR-10)", () => {
    const createSession = vi.fn();
    const { container } = render(
      <ServiceProvider createCoordinatorSession={createSession}>
        <RouterProvider initialPath="/read/local">
          <ReaderPage />
        </RouterProvider>
      </ServiceProvider>,
    );

    expect(container).toBeEmptyDOMElement();
    expect(createSession).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe("/");
  });

  it("StrictMode二重マウントのアンマウント時はWorker停止とL1解放のみ行いZustandセッションを保持すること", async () => {
    const session1 = createMockCoordinatorSession();
    const session2 = createMockCoordinatorSession();
    const sessions = [session1, session2];
    let callIndex = 0;
    const createSession = vi.fn(() => {
      const target = sessions[callIndex] ?? session2;
      callIndex += 1;
      return target.handle;
    });

    const clearAllTextures = vi.fn();
    const deletePageTexture = vi.fn();
    const file = new File(["zip"], "strict-mode.zip", {
      type: "application/zip",
    });
    useLocalReaderSessionStore.getState().openLocalFile(file);

    render(
      <StrictMode>
        <ServiceProvider createCoordinatorSession={createSession}>
          <RouterProvider initialPath="/read/local">
            <ReaderPage />
          </RouterProvider>
        </ServiceProvider>
      </StrictMode>,
    );

    await waitFor(() => {
      expect(session2.api.openArchive).toHaveBeenCalledTimes(1);
      expect(getLatestCanvasProps().slots).toEqual([
        {
          slot: { pageIndex: 0, position: "center" },
          frame: expect.objectContaining({ status: "ready", pageIndex: 0 }),
        },
      ]);
    });

    expect(session1.api.cancelEpochBelow).toHaveBeenCalled();
    expect(session1.api.closeArchive).toHaveBeenCalledTimes(1);
    expect(session1.dispose).toHaveBeenCalledTimes(1);
    expect(useLocalReaderSessionStore.getState().session?.file).toBe(file);
    expect(window.location.pathname).toBe("/read/local");

    act(() => {
      getLatestCanvasProps().onRendererReady?.({
        deletePageTexture,
        clearAllTextures,
      });
    });
    expect(clearAllTextures).not.toHaveBeenCalled();
  });

  it("見開きFast-Path([N,N+1])・L1保護窓・近傍バッチ・全ヒット時L2補充が見開きと単頁双方で連携すること (AC-RD-05, AC-RD-12)", async () => {
    // 1. 縦向き(375x667 -> single) での単ページ Fast-Path と L1 5枚窓
    setWindowSize(375, 667);
    const openDeferred = createDeferred<OpenArchiveResult>();
    const page0Deferred = createDeferred<DecodedPageFrame[]>();
    const neighbors0Deferred = createDeferred<DecodedPageFrame[]>();
    const page3Deferred = createDeferred<DecodedPageFrame[]>();

    const frame0 = createReadyFrame(0, 1);
    const frame1 = createReadyFrame(1, 1);
    const frame2 = createReadyFrame(2, 1);
    const frame3 = createReadyFrame(3, 2);

    const singleSession = createMockCoordinatorSession({
      openArchive: vi.fn(() => openDeferred.promise),
      requestVisiblePages: vi.fn((pageIndices) => {
        if (pageIndices.length === 1 && pageIndices[0] === 0) {
          return page0Deferred.promise;
        }
        if (pageIndices.length === 2 && pageIndices[0] === 1) {
          return neighbors0Deferred.promise;
        }
        return page3Deferred.promise;
      }),
    });

    const { unmount: unmountSingle } = renderWithSession(
      {},
      () => singleSession.handle,
    );
    expect(screen.getByTestId("reader-loading")).toBeVisible();
    await waitFor(() => {
      expect(singleSession.api.openArchive).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      openDeferred.resolve({
        pageCount: 6,
        entries: [],
        fromIndexCache: false,
      });
      await flushMicrotasks();
    });
    expect(singleSession.api.requestVisiblePages).toHaveBeenNthCalledWith(
      1,
      [0],
      [1, 2, 3, 4, 5],
      1,
      { visiblePageIndices: [0] },
    );

    await act(async () => {
      page0Deferred.resolve([frame0]);
      await flushMicrotasks();
    });
    expect(screen.queryByTestId("reader-loading")).not.toBeInTheDocument();
    expect(getLatestCanvasProps().slots).toEqual([
      { slot: { pageIndex: 0, position: "center" }, frame: frame0 },
    ]);
    expect(singleSession.api.requestVisiblePages).toHaveBeenNthCalledWith(
      2,
      [1, 2],
      [],
      1,
      { visiblePageIndices: [0] },
    );

    await act(async () => {
      neighbors0Deferred.resolve([frame1, frame2]);
      await flushMicrotasks();
    });

    act(() => {
      getLatestHudProps().onNextPage();
    });
    expect(singleSession.api.cancelEpochBelow).toHaveBeenCalledWith(2);
    expect(getLatestCanvasProps().slots).toEqual([
      { slot: { pageIndex: 1, position: "center" }, frame: frame1 },
    ]);
    expect(singleSession.api.requestVisiblePages).toHaveBeenNthCalledWith(
      3,
      [3],
      [2, 3, 4, 5, 0],
      2,
      { visiblePageIndices: [1] },
    );
    await act(async () => {
      page3Deferred.resolve([frame3]);
      await flushMicrotasks();
    });
    unmountSingle();

    // 2. 横向き(1280x800 -> spread) で見開き候補 [3, 4] の 1バッチ Fast-Path ＆ L1全ヒット補充を検証
    setWindowSize(1280, 800);
    const spreadSession = createMockCoordinatorSession({
      openArchive: vi.fn(async () => ({
        pageCount: 10,
        entries: [],
        fromIndexCache: false,
      })),
    });
    renderWithSession({}, () => spreadSession.handle);

    await waitFor(() => {
      expect(getLatestHudProps().effectiveSpreadMode).toBe("spread");
      expect(spreadSession.api.requestVisiblePages).toHaveBeenCalledTimes(2);
    });
    // 表紙0は単独 [0] で取得し、近傍 [1, 2] を取得
    expect(spreadSession.api.requestVisiblePages).toHaveBeenNthCalledWith(
      1,
      [0],
      [1, 2, 3, 4, 5, 6, 7, 8, 9],
      1,
      { visiblePageIndices: [0] },
    );
    expect(spreadSession.api.requestVisiblePages).toHaveBeenNthCalledWith(
      2,
      [1, 2],
      [],
      1,
      { visiblePageIndices: [0] },
    );

    // 0 -> [1, 2] へ移動: [1, 2] はL1全ヒットのため即描画＆近傍 [3, 4] と先読み [3..9, 0] を1回で要求
    await act(async () => {
      getLatestHudProps().onNextPage();
      await flushMicrotasks();
    });
    expect(getLatestHudProps().pageIndicatorText).toBe("2-3 / 10");
    expect(getLatestCanvasProps().slots).toEqual([
      {
        slot: { pageIndex: 2, position: "left" },
        frame: expect.objectContaining({ status: "ready", pageIndex: 2 }),
      },
      {
        slot: { pageIndex: 1, position: "right" },
        frame: expect.objectContaining({ status: "ready", pageIndex: 1 }),
      },
    ]);
    expect(spreadSession.api.requestVisiblePages).toHaveBeenNthCalledWith(
      3,
      [3, 4],
      [3, 4, 5, 6, 7, 8, 9, 0],
      2,
      { visiblePageIndices: [1, 2] },
    );
  });

  it("ResizeObserverとwindow.resizeでautoモードの縦横向きに追従し、同向き内リサイズ時は再同期せず、向き変化時は同一ページでも新epochで再同期すること (AC-RD-10)", async () => {
    let observerCallback: ResizeObserverCallback | null = null;
    const observeSpy = vi.fn();
    const disconnectSpy = vi.fn();
    class MockResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        observerCallback = callback;
      }
      observe = observeSpy;
      unobserve = vi.fn();
      disconnect = disconnectSpy;
    }
    vi.stubGlobal("ResizeObserver", MockResizeObserver);

    setWindowSize(375, 667);
    const mockSession = createMockCoordinatorSession({
      openArchive: vi.fn(async () => ({
        pageCount: 6,
        entries: [],
        fromIndexCache: false,
      })),
    });

    const { unmount } = renderWithSession({}, () => mockSession.handle);

    await waitFor(() => {
      expect(getLatestCanvasProps().slots).toHaveLength(1);
    });
    expect(observeSpy).toHaveBeenCalledTimes(1);
    expect(getLatestHudProps().effectiveSpreadMode).toBe("single");

    // ページ 0 -> 1 へ移動（singleモード）
    await act(async () => {
      getLatestHudProps().onNextPage();
      await flushMicrotasks();
    });
    expect(getLatestHudProps().currentPageIndex).toBe(1);
    expect(getLatestHudProps().pageIndicatorText).toBe("2 / 6");

    // 同一寸法通知では何もしない
    const callsBeforeSameSize =
      mockSession.api.requestVisiblePages.mock.calls.length;
    act(() => {
      observerCallback?.(
        [{ contentRect: { width: 375, height: 667 } } as ResizeObserverEntry],
        {} as ResizeObserver,
      );
    });
    expect(mockSession.api.requestVisiblePages).toHaveBeenCalledTimes(
      callsBeforeSameSize,
    );

    // 同向き内のリサイズ (375x667 -> 400x800, 依然 single) -> cancelEpochBelow / loadPageWindow を再発火しない
    const cancelCountBeforeSameOrientation =
      mockSession.api.cancelEpochBelow.mock.calls.length;
    act(() => {
      observerCallback?.(
        [{ contentRect: { width: 400, height: 800 } } as ResizeObserverEntry],
        {} as ResizeObserver,
      );
    });
    expect(mockSession.api.cancelEpochBelow).toHaveBeenCalledTimes(
      cancelCountBeforeSameOrientation,
    );
    expect(getLatestHudProps().effectiveSpreadMode).toBe("single");

    // 縦->横回転 (400x800 -> 1280x800, single -> spread) -> 同一 currentPageIndex=1 でも新 epoch で再同期
    await act(async () => {
      observerCallback?.(
        [{ contentRect: { width: 1280, height: 800 } } as ResizeObserverEntry],
        {} as ResizeObserver,
      );
      await flushMicrotasks();
    });
    expect(getLatestHudProps().effectiveSpreadMode).toBe("spread");
    expect(getLatestHudProps().currentPageIndex).toBe(1);
    expect(getLatestHudProps().pageIndicatorText).toBe("2-3 / 6");
    expect(mockSession.api.cancelEpochBelow).toHaveBeenCalledTimes(
      cancelCountBeforeSameOrientation + 1,
    );

    // 回転後の横向き同向きリサイズ (1280x800 -> 1000x700) -> 再同期しない
    const cancelCountLandscape =
      mockSession.api.cancelEpochBelow.mock.calls.length;
    act(() => {
      observerCallback?.(
        [{ contentRect: { width: 1000, height: 700 } } as ResizeObserverEntry],
        {} as ResizeObserver,
      );
    });
    expect(mockSession.api.cancelEpochBelow).toHaveBeenCalledTimes(
      cancelCountLandscape,
    );

    // window.resize イベント（空 entries 時と同様に window.innerWidth/Height をフォールバック参照）で横->縦へ回転
    setWindowSize(390, 844);
    vi.spyOn(
      screen.getByTestId("reader-page"),
      "getBoundingClientRect",
    ).mockReturnValue({
      width: 0,
      height: 0,
      top: 0,
      left: 0,
      bottom: 0,
      right: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    await act(async () => {
      window.dispatchEvent(new Event("resize"));
      await flushMicrotasks();
    });
    expect(getLatestHudProps().effectiveSpreadMode).toBe("single");
    expect(mockSession.api.cancelEpochBelow).toHaveBeenCalledTimes(
      cancelCountLandscape + 1,
    );

    unmount();
    expect(disconnectSpy).toHaveBeenCalledTimes(1);

    // ResizeObserver 未定義環境でも window.resize で動作すること
    vi.stubGlobal("ResizeObserver", undefined);
    setWindowSize(1280, 800);
    const noObserverSession = createMockCoordinatorSession();
    const { unmount: unmountNoObs } = renderWithSession(
      {},
      () => noObserverSession.handle,
    );
    await waitFor(() => {
      expect(getLatestHudProps().effectiveSpreadMode).toBe("spread");
    });
    setWindowSize(360, 640);
    await act(async () => {
      window.dispatchEvent(new Event("resize"));
      await flushMicrotasks();
    });
    expect(getLatestHudProps().effectiveSpreadMode).toBe("single");
    unmountNoObs();

    // openArchive 待機中 (isOpening=true) の向き変化・表示モード切替は resyncCurrentWindow ガードで RPC を発火しない
    const pendingOpen = createDeferred<OpenArchiveResult>();
    const openingSession = createMockCoordinatorSession({
      openArchive: vi.fn(() => pendingOpen.promise),
    });
    setWindowSize(1280, 800);
    const { unmount: unmountOpening } = renderWithSession(
      {},
      () => openingSession.handle,
    );
    await waitFor(() => {
      expect(openingSession.api.openArchive).toHaveBeenCalledTimes(1);
    });
    setWindowSize(375, 667);
    act(() => {
      window.dispatchEvent(new Event("resize"));
      getLatestHudProps().onCycleSpreadMode?.(); // auto -> spread
      getLatestHudProps().onCycleSpreadMode?.(); // spread -> single
    });
    expect(getLatestHudProps().effectiveSpreadMode).toBe("single");
    expect(openingSession.api.cancelEpochBelow).not.toHaveBeenCalled();
    expect(openingSession.api.requestVisiblePages).not.toHaveBeenCalled();
    unmountOpening();
  });

  it("横長画像(width>height)の自動単独中央表示・後続自動再ペアリング・spreadHistory戻りと最終見開き全入力no-op境界を検証すること (AC-RD-10)", async () => {
    setWindowSize(1280, 800);
    // 7ページ構成: 0=表紙(800x1200), 1,2=縦(800x1200), 3=縦(800x1200), 4=横長(1600x1000), 5,6=縦(800x1200)
    const mockSession = createMockCoordinatorSession({
      openArchive: vi.fn(async () => ({
        pageCount: 7,
        entries: [],
        fromIndexCache: false,
      })),
      requestVisiblePages: vi.fn(
        async (
          pageIndices: readonly number[],
          _prefetch: readonly number[],
          epoch: number,
        ) =>
          pageIndices.map((idx: number) =>
            createReadyFrame(
              idx,
              epoch,
              idx === 4
                ? createFakeBitmap(1600, 1000)
                : createFakeBitmap(800, 1200),
            ),
          ),
      ),
    });

    const { unmount } = renderWithSession({}, () => mockSession.handle);

    await waitFor(() => {
      expect(getLatestCanvasProps().slots).toEqual([
        {
          slot: { pageIndex: 0, position: "center" },
          frame: expect.objectContaining({ status: "ready", pageIndex: 0 }),
        },
      ]);
    });

    // 0 -> [1, 2]
    await act(async () => {
      getLatestHudProps().onNextPage();
      await flushMicrotasks();
    });
    expect(getLatestHudProps().pageIndicatorText).toBe("2-3 / 7");

    // [1, 2] -> 3 (Fast-Path [3, 4] 要求後、4が横長のため 3単独表示へフォールバック)
    await act(async () => {
      getLatestHudProps().onNextPage();
      await flushMicrotasks();
    });
    expect(getLatestHudProps().currentPageIndex).toBe(3);
    expect(getLatestHudProps().pageIndicatorText).toBe("4 / 7");
    expect(getLatestCanvasProps().slots).toEqual([
      {
        slot: { pageIndex: 3, position: "center" },
        frame: expect.objectContaining({ status: "ready", pageIndex: 3 }),
      },
    ]);

    // 3 -> 4 (横長画像自身も単独中央表示)
    await act(async () => {
      getLatestHudProps().onNextPage();
      await flushMicrotasks();
    });
    expect(getLatestHudProps().currentPageIndex).toBe(4);
    expect(getLatestHudProps().pageIndicatorText).toBe("5 / 7");
    expect(getLatestCanvasProps().slots).toEqual([
      {
        slot: { pageIndex: 4, position: "center" },
        frame: expect.objectContaining({ status: "ready", pageIndex: 4 }),
      },
    ]);

    // 4 -> [5, 6] (自動再ペアリング、maxDisplayedPageIndex = 6 === totalPages - 1)
    await act(async () => {
      getLatestHudProps().onNextPage();
      await flushMicrotasks();
    });
    expect(getLatestHudProps().currentPageIndex).toBe(5);
    expect(getLatestHudProps().maxDisplayedPageIndex).toBe(6);
    expect(getLatestHudProps().pageIndicatorText).toBe("6-7 / 7");

    // 最終見開き表示中は HUD/タップ/スワイプ/ArrowLeft 全入力による次頁移動が完全 no-op
    const epochCallsAtEnd = mockSession.api.cancelEpochBelow.mock.calls.length;
    const surface = screen.getByTestId("reader-interaction-surface");
    mockSurfaceRect(surface, { left: 0, width: 1000 });
    act(() => {
      getLatestHudProps().onNextPage();
      fireEvent.click(surface, { clientX: 100 }); // rtl 左タップ=next
      dispatchPointer(surface, "pointerdown", { clientX: 200, clientY: 200 });
      dispatchPointer(surface, "pointerup", { clientX: 300, clientY: 200 }); // rtl 左→右=next
      fireEvent.keyDown(window, { key: "ArrowLeft" }); // rtl ArrowLeft=next
    });
    expect(getLatestHudProps().currentPageIndex).toBe(5);
    expect(mockSession.api.cancelEpochBelow).toHaveBeenCalledTimes(
      epochCallsAtEnd,
    );

    // 戻る操作で spreadHistory により往路厳密一致で戻る (5 -> 4 -> 3 -> 1 -> 0)
    for (const expectedPrev of [4, 3, 1, 0]) {
      await act(async () => {
        getLatestHudProps().onPrevPage();
        await flushMicrotasks();
      });
      expect(getLatestHudProps().currentPageIndex).toBe(expectedPrev);
    }

    // single切替で履歴クリア後に再見開き戻した際は computePreviousAnchorIndex で戻る
    await act(async () => {
      getLatestHudProps().onNextPage(); // 0 -> 1
      await flushMicrotasks();
      getLatestHudProps().onNextPage(); // 1 -> 3 (history: [0, 1])
      await flushMicrotasks();
    });
    expect(getLatestHudProps().currentPageIndex).toBe(3);

    // spread -> single -> auto(spread) で履歴クリア
    await act(async () => {
      getLatestHudProps().onCycleSpreadMode?.(); // auto -> spread (同実効のため維持)
      getLatestHudProps().onCycleSpreadMode?.(); // spread -> single (履歴クリア)
      await flushMicrotasks();
      getLatestHudProps().onCycleSpreadMode?.(); // single -> auto (spread)
      await flushMicrotasks();
    });
    await act(async () => {
      getLatestHudProps().onPrevPage(); // computePreviousAnchorIndex(3, "spread", 0) -> 1
      await flushMicrotasks();
    });
    expect(getLatestHudProps().currentPageIndex).toBe(1);
    unmount();

    // 5ページ本最終見開き [3, 4] でも全入力次頁 no-op
    const fiveSession = createMockCoordinatorSession({
      openArchive: vi.fn(async () => ({
        pageCount: 5,
        entries: [],
        fromIndexCache: false,
      })),
    });
    renderWithSession({}, () => fiveSession.handle);
    await waitFor(() => {
      expect(getLatestCanvasProps().slots).toHaveLength(1);
    });
    await act(async () => {
      getLatestHudProps().onNextPage(); // 0 -> 1
      await flushMicrotasks();
      getLatestHudProps().onNextPage(); // 1 -> 3 ([3,4], maxDisplayed=4)
      await flushMicrotasks();
    });
    expect(getLatestHudProps().currentPageIndex).toBe(3);
    expect(getLatestHudProps().maxDisplayedPageIndex).toBe(4);
    act(() => {
      getLatestHudProps().onNextPage();
    });
    expect(getLatestHudProps().currentPageIndex).toBe(3);
  });

  it("1ページずらし・表示モード循環・右/左開き即時再配置・ltr全入力反転が仕様通り動作すること (AC-RD-03, AC-RD-10, AC-RD-11)", async () => {
    setWindowSize(1280, 800);
    const mockSession = createMockCoordinatorSession({
      openArchive: vi.fn(async () => ({
        pageCount: 6,
        entries: [],
        fromIndexCache: false,
      })),
    });

    const { unmount } = renderWithSession({}, () => mockSession.handle);
    await waitFor(() => {
      expect(getLatestCanvasProps().slots).toHaveLength(1);
    });

    // 1. 表紙(0)で 1ページずらし ON (0->1): currentPageIndex=0のまま新epochで [0, 1] へ再同期
    const cancelCount0 = mockSession.api.cancelEpochBelow.mock.calls.length;
    await act(async () => {
      getLatestHudProps().onToggleSpreadPageOffset?.();
      await flushMicrotasks();
    });
    expect(getLatestHudProps().currentPageIndex).toBe(0);
    expect(getLatestHudProps().spreadPageOffset).toBe(1);
    expect(getLatestHudProps().pageIndicatorText).toBe("1-2 / 6");
    expect(mockSession.api.cancelEpochBelow).toHaveBeenCalledTimes(
      cancelCount0 + 1,
    );
    expect(getLatestCanvasProps().slots).toEqual([
      {
        slot: { pageIndex: 1, position: "left" },
        frame: expect.objectContaining({ pageIndex: 1 }),
      },
      {
        slot: { pageIndex: 0, position: "right" },
        frame: expect.objectContaining({ pageIndex: 0 }),
      },
    ]);

    // 2. 右開き -> 左開き切替: Worker RPC を追加発行せず即座に左右スロット反転 ([left:0, right:1])
    const rpcCountBeforeDir =
      mockSession.api.requestVisiblePages.mock.calls.length;
    act(() => {
      getLatestHudProps().onToggleReadingDirection?.();
    });
    expect(getLatestHudProps().readingDirection).toBe("ltr");
    expect(mockSession.api.requestVisiblePages).toHaveBeenCalledTimes(
      rpcCountBeforeDir,
    );
    expect(getLatestCanvasProps().slots).toEqual([
      {
        slot: { pageIndex: 0, position: "left" },
        frame: expect.objectContaining({ pageIndex: 0 }),
      },
      {
        slot: { pageIndex: 1, position: "right" },
        frame: expect.objectContaining({ pageIndex: 1 }),
      },
    ]);

    // 3. 左開き (ltr) 入力反転（右タップ=次、左タップ=前、右→左スワイプ=次、左→右スワイプ=前、ArrowRight=次、ArrowLeft=前）
    const surface = screen.getByTestId("reader-interaction-surface");
    mockSurfaceRect(surface, { left: 0, width: 1000 });

    // 右タップ (clientX=850) -> 次 ([0,1] -> [2,3])
    await act(async () => {
      fireEvent.click(surface, { clientX: 850 });
      await flushMicrotasks();
    });
    expect(getLatestHudProps().currentPageIndex).toBe(2);

    // 左タップ (clientX=150) -> 前 ([2,3] -> [0,1])
    await act(async () => {
      fireEvent.click(surface, { clientX: 150 });
      await flushMicrotasks();
    });
    expect(getLatestHudProps().currentPageIndex).toBe(0);

    // 右→左スワイプ (dx=-60) -> 次 ([0,1] -> [2,3])
    await act(async () => {
      dispatchPointer(surface, "pointerdown", { clientX: 600, clientY: 300 });
      dispatchPointer(surface, "pointerup", { clientX: 540, clientY: 305 });
      await flushMicrotasks();
    });
    expect(getLatestHudProps().currentPageIndex).toBe(2);

    // 左→右スワイプ (dx=+60) -> 前 ([2,3] -> [0,1])
    await act(async () => {
      dispatchPointer(surface, "pointerdown", { clientX: 500, clientY: 300 });
      dispatchPointer(surface, "pointerup", { clientX: 560, clientY: 305 });
      await flushMicrotasks();
    });
    expect(getLatestHudProps().currentPageIndex).toBe(0);

    // ArrowRight -> 次 ([0,1] -> [2,3]), ArrowLeft -> 前 ([2,3] -> [0,1])
    await act(async () => {
      fireEvent.keyDown(window, { key: "ArrowRight" });
      await flushMicrotasks();
    });
    expect(getLatestHudProps().currentPageIndex).toBe(2);

    // 4. 中間ページ(2)で1ページずらし OFF (1->0): 2 -> 1 へシフトし履歴もクリアされる
    await act(async () => {
      getLatestHudProps().onToggleSpreadPageOffset?.();
      await flushMicrotasks();
    });
    expect(getLatestHudProps().spreadPageOffset).toBe(0);
    expect(getLatestHudProps().currentPageIndex).toBe(1);

    // singleモード時および1ページ本では onToggleSpreadPageOffset がガードされること
    await act(async () => {
      getLatestHudProps().onCycleSpreadMode?.(); // auto -> spread
      getLatestHudProps().onCycleSpreadMode?.(); // spread -> single
      await flushMicrotasks();
    });
    expect(getLatestHudProps().effectiveSpreadMode).toBe("single");
    act(() => {
      getLatestHudProps().onToggleSpreadPageOffset?.();
    });
    expect(getLatestHudProps().spreadPageOffset).toBe(0);

    // single モードで左右開きトグルしても安全に反転すること
    act(() => {
      getLatestHudProps().onToggleReadingDirection?.();
    });
    expect(getLatestHudProps().readingDirection).toBe("rtl");
    unmount();

    // 1ページ本での onToggleSpreadPageOffset ガード
    const onePageSession = createMockCoordinatorSession({
      openArchive: vi.fn(async () => ({
        pageCount: 1,
        entries: [],
        fromIndexCache: false,
      })),
    });
    renderWithSession({}, () => onePageSession.handle);
    await waitFor(() => {
      expect(getLatestHudProps().totalPages).toBe(1);
    });
    act(() => {
      getLatestHudProps().onToggleSpreadPageOffset?.();
    });
    expect(getLatestHudProps().spreadPageOffset).toBe(0);
  });

  it("連続めくり時の古いepoch遅延到着フレームはL1登録前にbitmap.close()し、L1退避時もdeletePageTextureとclose()を呼ぶこと (AC-RD-05)", async () => {
    setWindowSize(375, 667);
    const deletePageTexture = vi.fn();
    const clearAllTextures = vi.fn();

    const frame0 = createReadyFrame(0, 1);
    const frame1 = createReadyFrame(1, 2);
    const frame2 = createReadyFrame(2, 3);
    const frame3 = createReadyFrame(3, 4);
    const frame4 = createReadyFrame(4, 5);
    const frame5 = createReadyFrame(5, 6);
    const frame6 = createReadyFrame(6, 7);

    const stalePrefetchDeferred = createDeferred<DecodedPageFrame[]>();
    const staleReadyBitmap = createFakeBitmap();
    const staleReadyFrame = createReadyFrame(1, 1, staleReadyBitmap);
    const staleErrorDeferred = createDeferred<DecodedPageFrame[]>();
    const staleInnerEpochBitmap = createFakeBitmap();

    const mockSession = createMockCoordinatorSession({
      openArchive: vi.fn(async () => ({
        pageCount: 8,
        entries: [],
        fromIndexCache: false,
      })),
      requestVisiblePages: vi.fn(async (pageIndices, _prefetch, epoch) => {
        if (pageIndices.length === 1 && pageIndices[0] === 0 && epoch === 1) {
          return [frame0];
        }
        if (pageIndices.length === 2 && pageIndices[0] === 1 && epoch === 1) {
          return stalePrefetchDeferred.promise;
        }
        if (pageIndices.length === 1 && pageIndices[0] === 1 && epoch === 2) {
          return [frame1];
        }
        if (pageIndices.length === 2 && pageIndices[0] === 2 && epoch === 2) {
          return staleErrorDeferred.promise;
        }
        if (pageIndices.length === 1 && pageIndices[0] === 2 && epoch === 3) {
          return [frame2];
        }
        if (pageIndices.length === 1 && pageIndices[0] === 3 && epoch === 4) {
          return [frame3];
        }
        if (pageIndices.length === 1 && pageIndices[0] === 4 && epoch === 5) {
          return [frame4];
        }
        if (pageIndices.length === 1 && pageIndices[0] === 5 && epoch === 6) {
          return [frame5];
        }
        if (pageIndices.length === 1 && pageIndices[0] === 6 && epoch === 7) {
          return [frame6];
        }
        if (pageIndices.length === 1 && pageIndices[0] === 7 && epoch === 7) {
          return [createReadyFrame(7, 1, staleInnerEpochBitmap)];
        }
        return [];
      }),
    });

    const { unmount } = renderWithSession({}, () => mockSession.handle);

    act(() => {
      getLatestCanvasProps().onRendererReady?.({
        deletePageTexture,
        clearAllTextures,
      });
    });

    await waitFor(() => {
      expect(getLatestCanvasProps().slots).toEqual([
        { slot: { pageIndex: 0, position: "center" }, frame: frame0 },
      ]);
    });

    await act(async () => {
      getLatestHudProps().onNextPage();
      await flushMicrotasks();
    });
    expect(getLatestCanvasProps().slots).toEqual([
      { slot: { pageIndex: 1, position: "center" }, frame: frame1 },
    ]);

    await act(async () => {
      getLatestHudProps().onNextPage();
      await flushMicrotasks();
    });
    expect(getLatestCanvasProps().slots).toEqual([
      { slot: { pageIndex: 2, position: "center" }, frame: frame2 },
    ]);

    await act(async () => {
      stalePrefetchDeferred.resolve([staleReadyFrame]);
      staleErrorDeferred.resolve([createErrorFrame(2, 2)]);
      await flushMicrotasks();
    });
    expect(staleReadyBitmap.close).toHaveBeenCalledTimes(1);

    for (const expectedPage of [3, 4, 5, 6]) {
      await act(async () => {
        getLatestHudProps().onNextPage();
        await flushMicrotasks();
      });
      expect(getLatestHudProps().currentPageIndex).toBe(expectedPage);
    }

    expect(deletePageTexture).toHaveBeenCalledWith(0);
    expect(frame0.bitmap.close).toHaveBeenCalledTimes(1);
    expect(staleInnerEpochBitmap.close).toHaveBeenCalledTimes(1);

    unmount();
    expect(frame6.bitmap.close).toHaveBeenCalledTimes(1);
    expect(clearAllTextures).toHaveBeenCalledTimes(1);
  });

  it("右開き操作（タップ30/40/30%・rect幅0フォールバック・二重発火抑止・スワイプ・pointercancel・キーボード）が仕様通り動作すること (AC-RD-02, AC-RD-03)", async () => {
    setWindowSize(375, 667);
    const mockSession = createMockCoordinatorSession({
      openArchive: vi.fn(async () => ({
        pageCount: 4,
        entries: [],
        fromIndexCache: false,
      })),
    });

    const onRegisterExit = vi.fn();
    renderWithSession({ onRegisterExit }, () => mockSession.handle);

    await waitFor(() => {
      expect(getLatestHudProps().totalPages).toBe(4);
      expect(screen.queryByTestId("reader-loading")).not.toBeInTheDocument();
    });

    const surface = screen.getByTestId("reader-interaction-surface");

    mockSurfaceRect(surface, { left: 0, width: 0 });
    fireEvent.click(surface, { clientX: 10 });
    expect(getLatestHudProps().isOpen).toBe(true);

    mockSurfaceRect(surface, { left: 100, width: 1000 });

    await act(async () => {
      fireEvent.click(surface, { clientX: 399 });
      await flushMicrotasks();
    });
    expect(getLatestHudProps().currentPageIndex).toBe(1);

    fireEvent.click(surface, { clientX: 400 });
    expect(getLatestHudProps().isOpen).toBe(false);
    fireEvent.click(surface, { clientX: 800 });
    expect(getLatestHudProps().isOpen).toBe(true);

    await act(async () => {
      fireEvent.click(surface, { clientX: 801 });
      await flushMicrotasks();
    });
    expect(getLatestHudProps().currentPageIndex).toBe(0);

    fireEvent.click(surface, { clientX: 900 });
    expect(getLatestHudProps().currentPageIndex).toBe(0);

    await act(async () => {
      dispatchPointer(surface, "pointerdown", { clientX: 200, clientY: 300 });
      dispatchPointer(surface, "pointerup", { clientX: 205, clientY: 302 });
      fireEvent.click(surface, { clientX: 205, clientY: 302 });
      await flushMicrotasks();
    });
    expect(getLatestHudProps().currentPageIndex).toBe(1);

    dispatchPointer(surface, "pointerdown", { clientX: 200, clientY: 300 });
    dispatchPointer(surface, "pointercancel");
    dispatchPointer(surface, "pointerup", { clientX: 350, clientY: 300 });
    expect(getLatestHudProps().currentPageIndex).toBe(1);

    await act(async () => {
      dispatchPointer(surface, "pointerdown", { clientX: 500, clientY: 300 });
      dispatchPointer(surface, "pointerup", { clientX: 560, clientY: 310 });
      await flushMicrotasks();
    });
    expect(getLatestHudProps().currentPageIndex).toBe(2);

    await act(async () => {
      dispatchPointer(surface, "pointerdown", { clientX: 560, clientY: 300 });
      dispatchPointer(surface, "pointerup", { clientX: 500, clientY: 310 });
      await flushMicrotasks();
    });
    expect(getLatestHudProps().currentPageIndex).toBe(1);

    dispatchPointer(surface, "pointerdown", { clientX: 600, clientY: 200 });
    dispatchPointer(surface, "pointerup", { clientX: 650, clientY: 260 });
    expect(getLatestHudProps().isOpen).toBe(false);

    fireEvent.keyDown(window, { key: "Enter" });
    expect(getLatestHudProps().currentPageIndex).toBe(1);

    await act(async () => {
      fireEvent.keyDown(window, { key: "ArrowLeft" });
      await flushMicrotasks();
    });
    expect(getLatestHudProps().currentPageIndex).toBe(2);
    await act(async () => {
      fireEvent.keyDown(window, { key: "ArrowLeft" });
      await flushMicrotasks();
    });
    expect(getLatestHudProps().currentPageIndex).toBe(3);
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(getLatestHudProps().currentPageIndex).toBe(3);

    await act(async () => {
      fireEvent.keyDown(window, { key: "ArrowRight" });
      await flushMicrotasks();
    });
    expect(getLatestHudProps().currentPageIndex).toBe(2);
  });

  it("TR-08終了（HUD戻る・Escape・エラー戻る・onRegisterExit）で全リソース解放とclearSession・'/'遷移を行い重複実行を防止すること (AC-RD-08)", async () => {
    const deletePageTexture = vi.fn();
    const clearAllTextures = vi.fn();
    const closeArchive = vi.fn().mockRejectedValue(new Error("close failed"));
    const mockSession = createMockCoordinatorSession({ closeArchive });
    const onRegisterExit = vi.fn();

    const unhandledRejections: unknown[] = [];
    const onUnhandled = (reason: unknown) => {
      unhandledRejections.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);

    try {
      const { unmount } = renderWithSession(
        { onRegisterExit },
        () => mockSession.handle,
      );

      expect(onRegisterExit).toHaveBeenCalledWith(expect.any(Function));

      act(() => {
        getLatestCanvasProps().onRendererReady?.({
          deletePageTexture,
          clearAllTextures,
        });
      });

      await waitFor(() => {
        expect(mockSession.api.openArchive).toHaveBeenCalledTimes(1);
      });

      act(() => {
        fireEvent.keyDown(window, { key: "Escape" });
        getLatestHudProps().onClose();
      });
      await act(async () => {
        await flushMicrotasks();
      });

      expect(mockSession.api.cancelEpochBelow).toHaveBeenCalledTimes(1);
      expect(mockSession.api.closeArchive).toHaveBeenCalledTimes(1);
      expect(clearAllTextures).toHaveBeenCalledTimes(1);
      expect(mockSession.dispose).toHaveBeenCalledTimes(1);
      expect(useLocalReaderSessionStore.getState().session).toBeNull();
      expect(window.location.pathname).toBe("/");
      expect(unhandledRejections).toEqual([]);

      unmount();
      expect(onRegisterExit).toHaveBeenLastCalledWith(null);

      window.history.replaceState(null, "", "/read/local");
      const snapshotClearAllTextures = vi.fn();
      const registeredExit: { current: (() => void) | null } = {
        current: null,
      };
      renderWithSession({
        onRegisterExit: (fn) => {
          registeredExit.current = fn;
        },
        initialSnapshot: {
          totalPages: 5,
          currentPageIndex: 1,
          isOpening: false,
          isHudOpen: false,
        },
      });
      act(() => {
        getLatestCanvasProps().onRendererReady?.({
          deletePageTexture: vi.fn(),
          clearAllTextures: snapshotClearAllTextures,
        });
      });
      expect(registeredExit.current).not.toBeNull();
      act(() => {
        registeredExit.current?.();
      });
      expect(snapshotClearAllTextures).toHaveBeenCalledTimes(1);
      expect(useLocalReaderSessionStore.getState().session).toBeNull();
      expect(window.location.pathname).toBe("/");
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it("個別ページエラー時（単ページ・見開き片側のみ・見開き両側エラー代表選出）に適切にReaderErrorViewを配置し移動継続できること (AC-RD-07, AC-RD-12)", async () => {
    // 1. 単ページモードでの単頁エラーと非中断reject
    setWindowSize(375, 667);
    const frame0 = createErrorFrame(0, 1, "DECODE_FAILED", "raw decode error");
    const frame2 = createReadyFrame(2, 3);
    const mockSession = createMockCoordinatorSession({
      openArchive: vi.fn(async () => ({
        pageCount: 3,
        entries: [],
        fromIndexCache: false,
      })),
      requestVisiblePages: vi.fn(async (pageIndices, _prefetch, epoch) => {
        if (pageIndices.length === 2) {
          return [];
        }
        const target = pageIndices[0];
        if (target === 0) return [frame0];
        if (target === 1) {
          throw new ZipArchiveError("CORRUPT_ZIP", "page 1 corrupt");
        }
        return [createReadyFrame(target, epoch, frame2.bitmap)];
      }),
    });

    const { unmount: unmountSingle } = renderWithSession(
      {},
      () => mockSession.handle,
    );

    await waitFor(() => {
      expect(errorViewSpy).toHaveBeenCalled();
    });
    expect(getLatestErrorViewProps()).toEqual({
      mode: "page",
      slotPosition: "center",
      message: "ページの画像デコードに失敗しました",
      errorCode: "DECODE_FAILED",
    });

    await act(async () => {
      getLatestHudProps().onNextPage();
      await flushMicrotasks();
    });
    expect(getLatestHudProps().currentPageIndex).toBe(1);
    expect(getLatestErrorViewProps()).toEqual({
      mode: "page",
      slotPosition: "center",
      message: "ZIP ファイルが破損しているため開けませんでした",
      errorCode: "CORRUPT_ZIP",
    });

    await act(async () => {
      getLatestHudProps().onNextPage();
      await flushMicrotasks();
    });
    expect(getLatestHudProps().currentPageIndex).toBe(2);
    expect(getLatestCanvasProps().slots).toEqual([
      {
        slot: { pageIndex: 2, position: "center" },
        frame: expect.objectContaining({ status: "ready", pageIndex: 2 }),
      },
    ]);
    unmountSingle();

    // 2. 見開き片側エラー (rtl: left=page 2 error, right=page 1 ready) & 両側エラー (center代表選出)
    setWindowSize(1280, 800);
    errorViewSpy.mockClear();
    const spreadErrorSession = createMockCoordinatorSession({
      openArchive: vi.fn(async () => ({
        pageCount: 5,
        entries: [],
        fromIndexCache: false,
      })),
      requestVisiblePages: vi.fn(
        async (
          pageIndices: readonly number[],
          _prefetch: readonly number[],
          epoch: number,
        ) => {
          return pageIndices.map((idx: number) => {
            if (idx === 2) {
              return createErrorFrame(2, epoch, "DECODE_FAILED", "p2 fail");
            }
            if (idx === 3) {
              return createErrorFrame(3, epoch, "CORRUPT_ZIP", "p3 fail");
            }
            if (idx === 4) {
              return createErrorFrame(4, epoch, "READ_ERROR", "p4 fail");
            }
            return createReadyFrame(idx, epoch);
          });
        },
      ),
    });

    const { unmount: unmountSpread } = renderWithSession(
      {},
      () => spreadErrorSession.handle,
    );
    await waitFor(() => {
      expect(getLatestCanvasProps().slots).toHaveLength(1);
    });

    // 0 -> [1 (ready), 2 (error)] -> left半面エラー (p.3) + right正常描画
    errorViewSpy.mockClear();
    await act(async () => {
      getLatestHudProps().onNextPage();
      await flushMicrotasks();
    });
    expect(getLatestCanvasProps().slots).toEqual([
      {
        slot: { pageIndex: 2, position: "left" },
        frame: expect.objectContaining({ status: "error", pageIndex: 2 }),
      },
      {
        slot: { pageIndex: 1, position: "right" },
        frame: expect.objectContaining({ status: "ready", pageIndex: 1 }),
      },
    ]);
    expect(errorViewSpy).toHaveBeenCalledTimes(1);
    expect(getLatestErrorViewProps()).toEqual({
      mode: "page",
      slotPosition: "left",
      pageNumber: 3,
      message: "ページの画像デコードに失敗しました",
      errorCode: "DECODE_FAILED",
    });

    // [1, 2] -> [3 (error), 4 (error)] -> 全スロットエラーのため center (pageNumber 省略、基準ページ3=CORRUPT_ZIP代表) を1枚表示
    errorViewSpy.mockClear();
    await act(async () => {
      getLatestHudProps().onNextPage();
      await flushMicrotasks();
    });
    expect(errorViewSpy).toHaveBeenCalledTimes(1);
    expect(getLatestErrorViewProps()).toEqual({
      mode: "page",
      slotPosition: "center",
      message: "ZIP ファイルが破損しているため開けませんでした",
      errorCode: "CORRUPT_ZIP",
    });
    unmountSpread();

    // 3. initialSnapshot 境界外 currentPageIndex 時も errorSlots[0] フォールバックが安全動作すること
    errorViewSpy.mockClear();
    renderWithSession({
      initialSnapshot: {
        totalPages: 2,
        currentPageIndex: 99,
        spreadMode: "single",
        framesByPage: {
          1: createErrorFrame(1, 1, "READ_ERROR", "out of range fallback"),
        },
        isOpening: false,
      },
    });
    expect(getLatestErrorViewProps()).toEqual({
      mode: "page",
      slotPosition: "center",
      message:
        "ファイルの読み込みに失敗しました（アクセス権限またはストレージ状態を確認してください）",
      errorCode: "READ_ERROR",
    });
  });

  it("openArchive失敗・0ページ・WebGL2致命的エラー時は診断ログ記録とarchiveエラー表示を行い操作を遮断すること (AC-RD-06)", async () => {
    const failingSession = createMockCoordinatorSession({
      openArchive: vi.fn(async () => {
        throw new ZipArchiveError("ENCRYPTED_ZIP", "encrypted");
      }),
    });
    const { unmount: unmountEncrypted } = renderWithSession(
      {},
      () => failingSession.handle,
    );

    await waitFor(() => {
      expect(errorViewSpy).toHaveBeenCalled();
    });

    expect(getLatestErrorViewProps()).toEqual({
      mode: "archive",
      message:
        "パスワード保護（暗号化）された ZIP ファイルには対応していません",
      errorCode: "ENCRYPTED_ZIP",
      onBackToHome: expect.any(Function),
    });
    expect(diagnosticLogger.getEntries()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: "error",
          scope: "reader",
        }),
      ]),
    );

    fireEvent.click(screen.getByTestId("reader-interaction-surface"));
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(getLatestHudProps().isOpen).toBe(false);
    unmountEncrypted();

    errorViewSpy.mockClear();
    const emptySession = createMockCoordinatorSession({
      openArchive: vi.fn(async () => ({
        pageCount: 0,
        entries: [],
        fromIndexCache: false,
      })),
    });
    const { unmount: unmountEmpty } = renderWithSession(
      {},
      () => emptySession.handle,
    );
    await waitFor(() => {
      expect(errorViewSpy).toHaveBeenCalled();
    });
    expect(getLatestErrorViewProps()).toMatchObject({
      mode: "archive",
      errorCode: "EMPTY_ARCHIVE",
    });
    unmountEmpty();

    errorViewSpy.mockClear();
    const openDeferred = createDeferred<OpenArchiveResult>();
    const abortSession = createMockCoordinatorSession({
      openArchive: vi.fn(async () => {
        throw new DOMException("Aborted", "AbortError");
      }),
    });
    const { unmount: unmountAbort } = renderWithSession(
      {},
      () => abortSession.handle,
    );
    await waitFor(() => {
      expect(abortSession.api.openArchive).toHaveBeenCalledTimes(1);
    });
    await act(async () => {
      await flushMicrotasks();
    });
    expect(errorViewSpy).not.toHaveBeenCalled();
    unmountAbort();

    const lateOpenSession = createMockCoordinatorSession({
      openArchive: vi.fn(() => openDeferred.promise),
    });
    const { unmount: unmountLate } = renderWithSession(
      {},
      () => lateOpenSession.handle,
    );
    await waitFor(() => {
      expect(lateOpenSession.api.openArchive).toHaveBeenCalledTimes(1);
    });
    unmountLate();
    await act(async () => {
      openDeferred.resolve({
        pageCount: 3,
        entries: [],
        fromIndexCache: false,
      });
      await flushMicrotasks();
    });
    expect(lateOpenSession.api.requestVisiblePages).not.toHaveBeenCalled();

    const { unmount: unmountWebgl } = renderWithSession({
      initialSnapshot: {
        totalPages: 5,
        isOpening: true,
      },
    });
    expect(screen.getByTestId("reader-loading")).toBeVisible();
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(getLatestHudProps().currentPageIndex).toBe(0);

    act(() => {
      getLatestCanvasProps().onFatalError?.(
        "WEBGL_UNSUPPORTED",
        "WebGL2 context unavailable",
      );
    });
    expect(getLatestErrorViewProps()).toEqual({
      mode: "archive",
      message: "WebGL2 描画の初期化に失敗しました",
      errorCode: "WEBGL_UNSUPPORTED",
      onBackToHome: expect.any(Function),
    });
    unmountWebgl();

    renderWithSession({
      initialSnapshot: {
        totalPages: 0,
      },
    });
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(getLatestHudProps().currentPageIndex).toBe(0);
  });

  it("requestVisiblePagesのAbortError・アンマウント後の遅延reject/resolveを安全に破棄すること", async () => {
    const delayedPage = createDeferred<DecodedPageFrame[]>();
    const lateRejectPage = createDeferred<DecodedPageFrame[]>();
    const lateBitmap = createFakeBitmap();

    const session1 = createMockCoordinatorSession({
      openArchive: vi.fn(async () => ({
        pageCount: 4,
        entries: [],
        fromIndexCache: false,
      })),
      requestVisiblePages: vi.fn((pageIndices) => {
        if (pageIndices[0] === 0) return delayedPage.promise;
        return Promise.reject(new DOMException("Aborted", "AbortError"));
      }),
    });

    const { unmount: unmount1 } = renderWithSession({}, () => session1.handle);
    await waitFor(() => {
      expect(session1.api.requestVisiblePages).toHaveBeenCalledTimes(1);
    });

    unmount1();
    await act(async () => {
      delayedPage.resolve([createReadyFrame(0, 1, lateBitmap)]);
      await flushMicrotasks();
    });
    expect(lateBitmap.close).toHaveBeenCalledTimes(1);

    const session2 = createMockCoordinatorSession({
      openArchive: vi.fn(async () => ({
        pageCount: 2,
        entries: [],
        fromIndexCache: false,
      })),
      requestVisiblePages: vi.fn((pageIndices) => {
        if (pageIndices[0] === 0) {
          return Promise.reject(new DOMException("Aborted", "AbortError"));
        }
        return lateRejectPage.promise;
      }),
    });

    errorViewSpy.mockClear();
    const { unmount: unmount2 } = renderWithSession({}, () => session2.handle);
    await waitFor(() => {
      expect(session2.api.requestVisiblePages).toHaveBeenCalledTimes(2);
    });
    expect(errorViewSpy).not.toHaveBeenCalled();

    unmount2();
    await act(async () => {
      lateRejectPage.reject(new Error("late failure"));
      await flushMicrotasks();
    });
    expect(errorViewSpy).not.toHaveBeenCalled();
  });

  it("initialSnapshotなしの通常マウント経路で子ReaderCanvas初回マウント時に同期onFatalError('WEBGL_UNSUPPORTED')が発火した場合、Worker未起動かつエラー表示維持・ローディング非表示となること (AC-RD-06)", async () => {
    function FailingMountCanvas({
      onFatalError,
    }: ReaderCanvasModule.ReaderCanvasProps) {
      const triggeredRef = useRef(false);
      useEffect(() => {
        if (!triggeredRef.current) {
          triggeredRef.current = true;
          onFatalError?.("WEBGL_UNSUPPORTED", "WebGL2 context unavailable");
        }
      }, [onFatalError]);
      return null;
    }

    canvasSpy.mockImplementation(
      (props) => (<FailingMountCanvas {...props} />) as unknown as ReactElement,
    );

    const createSession = vi.fn(() => createMockCoordinatorSession().handle);
    renderWithSession({}, createSession);

    await act(async () => {
      await flushMicrotasks();
    });

    expect(createSession).not.toHaveBeenCalled();
    expect(screen.queryByTestId("reader-loading")).not.toBeInTheDocument();
    expect(getLatestHudProps().isOpen).toBe(false);
    expect(getLatestErrorViewProps()).toEqual({
      mode: "archive",
      message: "WebGL2 描画の初期化に失敗しました",
      errorCode: "WEBGL_UNSUPPORTED",
      onBackToHome: expect.any(Function),
    });

    fireEvent.click(screen.getByTestId("reader-interaction-surface"));
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(getLatestHudProps().isOpen).toBe(false);
    expect(getLatestHudProps().currentPageIndex).toBe(0);
  });

  it("稼働中onFatalError('WEBGL_INIT_FAILED')発火時にruntimeがreleaseRuntime解放されること (AC-RD-06)", async () => {
    const deletePageTexture = vi.fn();
    const clearAllTextures = vi.fn();
    const frame0 = createReadyFrame(0, 1);
    const mockSession = createMockCoordinatorSession({
      openArchive: vi.fn(async () => ({
        pageCount: 3,
        entries: [],
        fromIndexCache: false,
      })),
      requestVisiblePages: vi.fn(
        async (
          pageIndices: readonly number[],
          _prefetch: readonly number[],
          epoch: number,
        ) => {
          if (pageIndices[0] === 0) return [frame0];
          return pageIndices.map((index) => createReadyFrame(index, epoch));
        },
      ),
    });

    renderWithSession({}, () => mockSession.handle);

    act(() => {
      getLatestCanvasProps().onRendererReady?.({
        deletePageTexture,
        clearAllTextures,
      });
    });

    await waitFor(() => {
      expect(getLatestCanvasProps().slots).toEqual([
        { slot: { pageIndex: 0, position: "center" }, frame: frame0 },
      ]);
    });

    act(() => {
      getLatestCanvasProps().onFatalError?.(
        "WEBGL_INIT_FAILED",
        "再初期化失敗",
      );
    });

    expect(mockSession.api.cancelEpochBelow).toHaveBeenCalledTimes(1);
    expect(mockSession.api.closeArchive).toHaveBeenCalledTimes(1);
    expect(frame0.bitmap.close).toHaveBeenCalledTimes(1);
    expect(clearAllTextures).toHaveBeenCalledTimes(1);
    expect(mockSession.dispose).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("reader-loading")).not.toBeInTheDocument();
    expect(getLatestErrorViewProps()).toEqual({
      mode: "archive",
      message: "WebGL2 描画の初期化に失敗しました",
      errorCode: "WEBGL_INIT_FAILED",
      onBackToHome: expect.any(Function),
    });
  });

  it("popstateによる'/'復帰時にreleaseRuntimeとclearSession()を実行し、同一ルートpopstateでは維持しWebGLエラー後のpopstateでもclearSession()を実行すること", async () => {
    const deletePageTexture = vi.fn();
    const clearAllTextures = vi.fn();
    const frame0 = createReadyFrame(0, 1);
    const mockSession = createMockCoordinatorSession({
      requestVisiblePages: vi.fn(
        async (
          pageIndices: readonly number[],
          _prefetch: readonly number[],
          epoch: number,
        ) => {
          if (pageIndices[0] === 0) return [frame0];
          return pageIndices.map((index) => createReadyFrame(index, epoch));
        },
      ),
    });

    const { unmount } = renderWithSession({}, () => mockSession.handle);

    act(() => {
      getLatestCanvasProps().onRendererReady?.({
        deletePageTexture,
        clearAllTextures,
      });
    });

    await waitFor(() => {
      expect(getLatestCanvasProps().slots).toEqual([
        { slot: { pageIndex: 0, position: "center" }, frame: frame0 },
      ]);
    });

    act(() => {
      window.history.replaceState(null, "", "/read/local?page=2");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(useLocalReaderSessionStore.getState().session).not.toBeNull();
    expect(mockSession.dispose).not.toHaveBeenCalled();

    window.history.replaceState(null, "", "/");
    const replaceStateSpy = vi.spyOn(window.history, "replaceState");
    act(() => {
      window.dispatchEvent(new PopStateEvent("popstate"));
    });

    expect(mockSession.api.cancelEpochBelow).toHaveBeenCalledTimes(1);
    expect(mockSession.api.closeArchive).toHaveBeenCalledTimes(1);
    expect(frame0.bitmap.close).toHaveBeenCalledTimes(1);
    expect(clearAllTextures).toHaveBeenCalledTimes(1);
    expect(mockSession.dispose).toHaveBeenCalledTimes(1);
    expect(useLocalReaderSessionStore.getState().session).toBeNull();
    expect(replaceStateSpy).not.toHaveBeenCalled();
    unmount();

    replaceStateSpy.mockRestore();
    window.history.replaceState(null, "", "/read/local");
    const errorClearTextures = vi.fn();
    const errorFallbackSession = createMockCoordinatorSession();
    renderWithSession({}, () => errorFallbackSession.handle);
    await waitFor(() => {
      expect(errorFallbackSession.api.requestVisiblePages).toHaveBeenCalled();
    });
    act(() => {
      getLatestCanvasProps().onFatalError?.(
        "WEBGL_INIT_FAILED",
        "再初期化失敗",
      );
      getLatestCanvasProps().onRendererReady?.({
        deletePageTexture: vi.fn(),
        clearAllTextures: errorClearTextures,
      });
    });
    expect(useLocalReaderSessionStore.getState().session).not.toBeNull();

    window.history.replaceState(null, "", "/");
    act(() => {
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(errorClearTextures).toHaveBeenCalledTimes(1);
    expect(useLocalReaderSessionStore.getState().session).toBeNull();
  });

  it("pushState経由で/read/localへ遷移後のhandleClose()がwindow.history.back()で二重'/'を作らずTR-10のreplace('/')も割り込まないこと (AC-RD-08)", async () => {
    const deletePageTexture = vi.fn();
    const clearAllTextures = vi.fn();
    const mockSession = createMockCoordinatorSession();
    const file = new File(["zip-bytes"], "push-history.cbz", {
      type: "application/x-cbz",
    });

    window.history.replaceState(null, "", "/");
    window.history.pushState({ exLibrisCanGoBackFrom: "/" }, "", "/read/local");
    useLocalReaderSessionStore.getState().openLocalFile(file);

    render(
      <ServiceProvider createCoordinatorSession={() => mockSession.handle}>
        <RouterProvider>
          <ReaderPage />
        </RouterProvider>
      </ServiceProvider>,
    );

    act(() => {
      getLatestCanvasProps().onRendererReady?.({
        deletePageTexture,
        clearAllTextures,
      });
    });

    await waitFor(() => {
      expect(mockSession.api.openArchive).toHaveBeenCalledTimes(1);
    });

    const historyBackSpy = vi.spyOn(window.history, "back");
    const replaceStateSpy = vi.spyOn(window.history, "replaceState");
    const pushStateSpy = vi.spyOn(window.history, "pushState");
    const popstatePromise = new Promise<void>((resolve) => {
      window.addEventListener("popstate", () => resolve(), { once: true });
    });

    act(() => {
      getLatestHudProps().onClose();
    });

    expect(historyBackSpy).toHaveBeenCalledTimes(1);
    expect(replaceStateSpy).not.toHaveBeenCalled();
    expect(pushStateSpy).not.toHaveBeenCalled();
    expect(useLocalReaderSessionStore.getState().session).toBeNull();

    await act(async () => {
      await popstatePromise;
    });

    expect(window.location.pathname).toBe("/");
    expect(replaceStateSpy).not.toHaveBeenCalled();
    expect(mockSession.api.closeArchive).toHaveBeenCalledTimes(1);
    expect(mockSession.dispose).toHaveBeenCalledTimes(1);
  });

  it("popstateで親ルーターがReaderPageのpopstateリスナー発火前にReaderPageをアンマウントした場合でもセッションとリソースが解放されること (R1-15)", async () => {
    const deletePageTexture = vi.fn();
    const clearAllTextures = vi.fn();
    const frame0 = createReadyFrame(0, 1);
    const mockSession = createMockCoordinatorSession({
      requestVisiblePages: vi.fn(
        async (
          pageIndices: readonly number[],
          _prefetch: readonly number[],
          epoch: number,
        ) => {
          if (pageIndices[0] === 0) return [frame0];
          return pageIndices.map((index) => createReadyFrame(index, epoch));
        },
      ),
    });

    const file = new File(["zip-bytes"], "parent-unmount-popstate.cbz", {
      type: "application/x-cbz",
    });
    window.history.replaceState(null, "", "/");

    function ParentRouteHost() {
      const [isReaderActive, setIsReaderActive] = useState(false);

      useEffect(() => {
        const handleParentPopState = () => {
          if (window.location.pathname !== "/read/local") {
            flushSync(() => {
              setIsReaderActive(false);
            });
          }
        };
        window.addEventListener("popstate", handleParentPopState);
        return () => {
          window.removeEventListener("popstate", handleParentPopState);
        };
      }, []);

      return isReaderActive ? (
        <ReaderPage />
      ) : (
        <button
          type="button"
          data-testid="open-reader-stub"
          onClick={() => {
            useLocalReaderSessionStore.getState().openLocalFile(file);
            window.history.pushState(
              { exLibrisCanGoBackFrom: "/" },
              "",
              "/read/local",
            );
            setIsReaderActive(true);
          }}
        >
          bookshelf
        </button>
      );
    }

    render(
      <ServiceProvider createCoordinatorSession={() => mockSession.handle}>
        <RouterProvider>
          <ParentRouteHost />
        </RouterProvider>
      </ServiceProvider>,
    );

    fireEvent.click(screen.getByTestId("open-reader-stub"));

    act(() => {
      getLatestCanvasProps().onRendererReady?.({
        deletePageTexture,
        clearAllTextures,
      });
    });

    await waitFor(() => {
      expect(getLatestCanvasProps().slots).toEqual([
        { slot: { pageIndex: 0, position: "center" }, frame: frame0 },
      ]);
    });

    expect(useLocalReaderSessionStore.getState().session).not.toBeNull();

    const popstatePromise = new Promise<void>((resolve) => {
      window.addEventListener("popstate", () => resolve(), { once: true });
    });

    await act(async () => {
      window.history.back();
      await popstatePromise;
    });

    expect(screen.getByTestId("open-reader-stub")).toBeVisible();
    expect(window.location.pathname).toBe("/");
    expect(mockSession.api.cancelEpochBelow).toHaveBeenCalledTimes(1);
    expect(mockSession.api.closeArchive).toHaveBeenCalledTimes(1);
    expect(frame0.bitmap.close).toHaveBeenCalledTimes(1);
    expect(clearAllTextures).toHaveBeenCalled();
    expect(mockSession.dispose).toHaveBeenCalledTimes(1);
    expect(useLocalReaderSessionStore.getState().session).toBeNull();
  });

  it("zipIndexCacheヒット時はcachedEntriesをopenArchiveへ渡してputせず、ミス時はputで保存し診断ログへfromIndexCacheを記録すること (AC-ENG-11)", async () => {
    const cachedEntries = createSampleZipEntries(2);
    const file = new File(["zip-bytes"], "cached-vol01.cbz", {
      type: "application/x-cbz",
    });
    const expectedCacheKey = `local:${file.name}:${file.size}`;

    const hitRepo = createMockZipIndexCacheRepo({
      get: vi.fn(async () => cachedEntries),
    });
    const hitSession = createMockCoordinatorSession({
      openArchive: vi.fn(async () => ({
        pageCount: cachedEntries.length,
        entries: cachedEntries,
        fromIndexCache: true,
      })),
    });

    const { unmount: unmountHit } = renderWithSession(
      {},
      () => hitSession.handle,
      file,
      hitRepo,
    );

    await waitFor(() => {
      expect(getLatestCanvasProps().slots).toEqual([
        {
          slot: { pageIndex: 0, position: "center" },
          frame: expect.objectContaining({ status: "ready", pageIndex: 0 }),
        },
      ]);
    });

    expect(hitRepo.get).toHaveBeenCalledWith(expectedCacheKey);
    expect(hitSession.api.openArchive).toHaveBeenCalledWith(
      expect.objectContaining({ indexCacheKey: expectedCacheKey }),
      cachedEntries,
      1,
    );
    expect(hitRepo.put).not.toHaveBeenCalled();
    expect(diagnosticLogger.getEntries()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: "info",
          scope: "reader",
          detail: expect.stringContaining("fromIndexCache=true"),
        }),
      ]),
    );
    unmountHit();

    diagnosticLogger.clear();
    const missEntries = createSampleZipEntries(3);
    const missRepo = createMockZipIndexCacheRepo({
      get: vi.fn(async () => null),
    });
    const missSession = createMockCoordinatorSession({
      openArchive: vi.fn(async () => ({
        pageCount: missEntries.length,
        entries: missEntries,
        fromIndexCache: false,
      })),
    });

    renderWithSession({}, () => missSession.handle, file, missRepo);

    await waitFor(() => {
      expect(missRepo.put).toHaveBeenCalledWith(expectedCacheKey, missEntries);
    });
    expect(missSession.api.openArchive).toHaveBeenCalledWith(
      expect.objectContaining({ indexCacheKey: expectedCacheKey }),
      null,
      1,
    );
    expect(diagnosticLogger.getEntries()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: "info",
          scope: "reader",
          detail: expect.stringContaining("fromIndexCache=false"),
        }),
      ]),
    );
  });

  it("zipIndexCacheのget例外・put例外時はwarnログのみ記録して通常オープン・ページ閲覧を透過継続すること (AC-ENG-11)", async () => {
    const file = new File(["zip-bytes"], "cache-error.cbz", {
      type: "application/x-cbz",
    });
    const entries = createSampleZipEntries(2);
    const unhandledRejections: unknown[] = [];
    const onUnhandled = (reason: unknown) => {
      unhandledRejections.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);

    try {
      const errorRepo = createMockZipIndexCacheRepo({
        get: vi.fn(async () => {
          throw new Error("indexeddb get failed");
        }),
        put: vi.fn(async () => {
          throw "indexeddb put string failure";
        }),
      });
      const mockSession = createMockCoordinatorSession({
        openArchive: vi.fn(async () => ({
          pageCount: entries.length,
          entries,
          fromIndexCache: false,
        })),
      });

      renderWithSession({}, () => mockSession.handle, file, errorRepo);

      await waitFor(() => {
        expect(getLatestCanvasProps().slots).toEqual([
          {
            slot: { pageIndex: 0, position: "center" },
            frame: expect.objectContaining({ status: "ready", pageIndex: 0 }),
          },
        ]);
      });
      await act(async () => {
        await flushMicrotasks();
      });

      expect(mockSession.api.openArchive).toHaveBeenCalledWith(
        expect.objectContaining({ rawFileName: "cache-error.cbz" }),
        null,
        1,
      );
      expect(errorViewSpy).not.toHaveBeenCalled();
      expect(unhandledRejections).toEqual([]);
      expect(diagnosticLogger.getEntries()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            level: "warn",
            scope: "reader",
            detail: expect.stringContaining("indexeddb get failed"),
          }),
          expect.objectContaining({
            level: "warn",
            scope: "reader",
            detail: expect.stringContaining("indexeddb put string failure"),
          }),
        ]),
      );
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it("zipIndexCache.get待機中にTR-08終了またはアンマウントされた場合は後続のopenArchiveやwarn記録を行わないこと", async () => {
    const file = new File(["zip-bytes"], "cache-race.cbz", {
      type: "application/x-cbz",
    });

    const getDeferred1 = createDeferred<readonly ZipPageEntry[] | null>();
    const repo1 = createMockZipIndexCacheRepo({
      get: vi.fn(() => getDeferred1.promise),
    });
    const session1 = createMockCoordinatorSession();
    const registeredExit: { current: (() => void) | null } = { current: null };

    const { unmount: unmountRace1 } = renderWithSession(
      {
        onRegisterExit: (fn) => {
          registeredExit.current = fn;
        },
      },
      () => session1.handle,
      file,
      repo1,
    );

    await waitFor(() => {
      expect(repo1.get).toHaveBeenCalledTimes(1);
    });
    act(() => {
      registeredExit.current?.();
    });

    await act(async () => {
      getDeferred1.resolve(createSampleZipEntries(2));
      await flushMicrotasks();
    });

    expect(session1.api.openArchive).not.toHaveBeenCalled();
    expect(repo1.put).not.toHaveBeenCalled();
    unmountRace1();

    window.history.replaceState(null, "", "/read/local");
    diagnosticLogger.clear();
    errorViewSpy.mockClear();
    const getDeferred2 = createDeferred<readonly ZipPageEntry[] | null>();
    const repo2 = createMockZipIndexCacheRepo({
      get: vi.fn(() => getDeferred2.promise),
    });
    const session2 = createMockCoordinatorSession();

    const { unmount } = renderWithSession(
      {},
      () => session2.handle,
      file,
      repo2,
    );
    await waitFor(() => {
      expect(repo2.get).toHaveBeenCalledTimes(1);
    });
    unmount();

    await act(async () => {
      getDeferred2.reject(new Error("late cache failure"));
      await flushMicrotasks();
    });

    expect(session2.api.openArchive).not.toHaveBeenCalled();
    expect(errorViewSpy).not.toHaveBeenCalled();
    expect(diagnosticLogger.getEntries()).toEqual([]);
  });

  it("デフォルトServiceProvider(DexieZipIndexCacheRepository)経由の2回目オープンで保存済み目次がopenArchiveへ引き渡されること (AC-ENG-11)", async () => {
    const file = new File(["dexie-roundtrip"], "dexie-0rtt.cbz", {
      type: "application/x-cbz",
    });
    const entries = createSampleZipEntries(2);

    const session1 = createMockCoordinatorSession({
      openArchive: vi.fn(async () => ({
        pageCount: entries.length,
        entries,
        fromIndexCache: false,
      })),
    });

    const { unmount: unmount1 } = renderWithSession(
      {},
      () => session1.handle,
      file,
    );

    await waitFor(() => {
      expect(getLatestCanvasProps().slots).toEqual([
        {
          slot: { pageIndex: 0, position: "center" },
          frame: expect.objectContaining({ status: "ready", pageIndex: 0 }),
        },
      ]);
    });
    unmount1();

    const session2 = createMockCoordinatorSession({
      openArchive: vi.fn(async (_source, cached) => ({
        pageCount: cached?.length ?? 0,
        entries: cached ?? [],
        fromIndexCache: cached !== null,
      })),
    });

    renderWithSession({}, () => session2.handle, file);

    await waitFor(() => {
      expect(getLatestCanvasProps().slots).toEqual([
        {
          slot: { pageIndex: 0, position: "center" },
          frame: expect.objectContaining({ status: "ready", pageIndex: 0 }),
        },
      ]);
    });
    expect(session2.api.openArchive).toHaveBeenCalledWith(
      expect.objectContaining({
        indexCacheKey: `local:${file.name}:${file.size}`,
      }),
      entries,
      1,
    );
  });

  it("buildSpreadPrefetchTargets(+1..+20,-1..-2)が常時{visiblePageIndices}と共に渡され、1ページ時・L1全ヒット時に正しく連携すること (AC-RD-05, AC-RD-12)", async () => {
    setWindowSize(375, 667);
    const mockSession30 = createMockCoordinatorSession({
      openArchive: vi.fn(async () => ({
        pageCount: 30,
        entries: [],
        fromIndexCache: false,
      })),
      requestVisiblePages: vi.fn(async (pageIndices, _prefetch, epoch) => {
        if (pageIndices.length === 1) {
          return [createReadyFrame(pageIndices[0], epoch)];
        }
        return [];
      }),
    });

    const { unmount: unmount30 } = renderWithSession(
      {},
      () => mockSession30.handle,
    );

    await waitFor(() => {
      expect(mockSession30.api.requestVisiblePages).toHaveBeenCalledTimes(2);
    });
    expect(mockSession30.api.requestVisiblePages).toHaveBeenNthCalledWith(
      1,
      [0],
      Array.from({ length: 20 }, (_, i) => i + 1),
      1,
      { visiblePageIndices: [0] },
    );
    expect(mockSession30.api.requestVisiblePages).toHaveBeenNthCalledWith(
      2,
      [1, 2],
      [],
      1,
      { visiblePageIndices: [0] },
    );

    for (const targetPage of [1, 2, 3]) {
      await act(async () => {
        getLatestHudProps().onNextPage();
        await flushMicrotasks();
      });
      expect(getLatestHudProps().currentPageIndex).toBe(targetPage);
    }

    const expectedAtPage3 = [
      ...Array.from({ length: 20 }, (_, i) => i + 4),
      2,
      1,
    ];
    expect(mockSession30.api.requestVisiblePages).toHaveBeenCalledWith(
      [3],
      expectedAtPage3,
      4,
      { visiblePageIndices: [3] },
    );
    unmount30();

    const frame0 = createReadyFrame(0, 1);
    const frame1 = createReadyFrame(1, 1);
    const frame2 = createReadyFrame(2, 1);
    const frame3 = createReadyFrame(3, 2);

    const hitSession = createMockCoordinatorSession({
      openArchive: vi.fn(async () => ({
        pageCount: 4,
        entries: [],
        fromIndexCache: false,
      })),
      requestVisiblePages: vi.fn(async (pageIndices) => {
        if (pageIndices.length === 1 && pageIndices[0] === 0) return [frame0];
        if (pageIndices.length === 2 && pageIndices[0] === 1) {
          return [frame1, frame2];
        }
        if (pageIndices.length === 1 && pageIndices[0] === 3) return [frame3];
        return [];
      }),
    });

    const { unmount: unmountHit } = renderWithSession(
      {},
      () => hitSession.handle,
    );
    await waitFor(() => {
      expect(hitSession.api.requestVisiblePages).toHaveBeenCalledTimes(2);
    });
    await act(async () => {
      await flushMicrotasks();
    });

    await act(async () => {
      getLatestHudProps().onNextPage();
      await flushMicrotasks();
    });
    expect(hitSession.api.requestVisiblePages).toHaveBeenNthCalledWith(
      3,
      [3],
      [2, 3, 0],
      2,
      { visiblePageIndices: [1] },
    );

    await act(async () => {
      getLatestHudProps().onNextPage();
      await flushMicrotasks();
    });
    expect(getLatestCanvasProps().slots).toEqual([
      { slot: { pageIndex: 2, position: "center" }, frame: frame2 },
    ]);
    expect(hitSession.api.requestVisiblePages).toHaveBeenNthCalledWith(
      4,
      [],
      [3, 1, 0],
      3,
      { visiblePageIndices: [2] },
    );
    unmountHit();

    // 1ページL1ヒット時はRPCを呼ばない
    const spyCachedFrame = createReadyFrame(0, 1);
    vi.spyOn(L1PageCache.prototype, "get").mockReturnValueOnce(spyCachedFrame);
    const mockSingleHitSession = createMockCoordinatorSession({
      openArchive: vi.fn(async () => ({
        pageCount: 1,
        entries: [],
        fromIndexCache: false,
      })),
    });
    renderWithSession({}, () => mockSingleHitSession.handle);
    await waitFor(() => {
      expect(getLatestCanvasProps().slots).toEqual([
        { slot: { pageIndex: 0, position: "center" }, frame: spyCachedFrame },
      ]);
    });
    expect(mockSingleHitSession.api.requestVisiblePages).not.toHaveBeenCalled();
  });

  it("近傍バッチの部分エラーおよびRPC非中断reject時にL1へ全対象ページのエラーを格納し遷移時に表示すること (AC-RD-07)", async () => {
    setWindowSize(375, 667);
    const frame0 = createReadyFrame(0, 1);
    const batchFailSession = createMockCoordinatorSession({
      openArchive: vi.fn(async () => ({
        pageCount: 4,
        entries: [],
        fromIndexCache: false,
      })),
      requestVisiblePages: vi.fn(
        async (
          pageIndices: readonly number[],
          _prefetch: readonly number[],
          epoch: number,
        ) => {
          if (pageIndices.length === 1 && pageIndices[0] === 0) return [frame0];
          if (pageIndices.length === 2 && pageIndices[0] === 1) {
            throw new ZipArchiveError(
              "READ_ERROR",
              "neighbor batch read error",
            );
          }
          return pageIndices.map((idx) => createReadyFrame(idx, epoch));
        },
      ),
    });

    const { unmount } = renderWithSession({}, () => batchFailSession.handle);

    await waitFor(() => {
      expect(batchFailSession.api.requestVisiblePages).toHaveBeenCalledTimes(2);
    });
    await act(async () => {
      await flushMicrotasks();
    });

    expect(diagnosticLogger.getEntries()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: "error",
          scope: "reader",
          detail: "READ_ERROR: page 2",
        }),
        expect.objectContaining({
          level: "error",
          scope: "reader",
          detail: "READ_ERROR: page 3",
        }),
      ]),
    );

    await act(async () => {
      getLatestHudProps().onNextPage();
      await flushMicrotasks();
    });
    expect(getLatestErrorViewProps()).toEqual({
      mode: "page",
      slotPosition: "center",
      message:
        "ファイルの読み込みに失敗しました（アクセス権限またはストレージ状態を確認してください）",
      errorCode: "READ_ERROR",
    });

    await act(async () => {
      getLatestHudProps().onNextPage();
      await flushMicrotasks();
    });
    expect(getLatestErrorViewProps()).toEqual({
      mode: "page",
      slotPosition: "center",
      message:
        "ファイルの読み込みに失敗しました（アクセス権限またはストレージ状態を確認してください）",
      errorCode: "READ_ERROR",
    });
    unmount();

    diagnosticLogger.clear();
    errorViewSpy.mockClear();
    const partialSession = createMockCoordinatorSession({
      openArchive: vi.fn(async () => ({
        pageCount: 4,
        entries: [],
        fromIndexCache: false,
      })),
      requestVisiblePages: vi.fn(
        async (
          pageIndices: readonly number[],
          _prefetch: readonly number[],
          epoch: number,
        ) => {
          if (pageIndices.length === 1 && pageIndices[0] === 0) return [frame0];
          if (pageIndices.length === 2 && pageIndices[0] === 1) {
            return [
              createReadyFrame(1, epoch),
              createErrorFrame(2, epoch, "DECODE_FAILED"),
            ];
          }
          return pageIndices.map((idx) => createReadyFrame(idx, epoch));
        },
      ),
    });
    const { unmount: unmountPartial } = renderWithSession(
      {},
      () => partialSession.handle,
    );
    await waitFor(() => {
      expect(partialSession.api.requestVisiblePages).toHaveBeenCalledTimes(2);
    });
    await act(async () => {
      await flushMicrotasks();
    });

    await act(async () => {
      getLatestHudProps().onNextPage();
      await flushMicrotasks();
    });
    expect(getLatestCanvasProps().slots).toEqual([
      {
        slot: { pageIndex: 1, position: "center" },
        frame: expect.objectContaining({ status: "ready", pageIndex: 1 }),
      },
    ]);
    expect(errorViewSpy).not.toHaveBeenCalled();

    await act(async () => {
      getLatestHudProps().onNextPage();
      await flushMicrotasks();
    });
    expect(getLatestErrorViewProps()).toEqual({
      mode: "page",
      slotPosition: "center",
      message: "ページの画像デコードに失敗しました",
      errorCode: "DECODE_FAILED",
    });
    unmountPartial();
  });
});
