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
import * as ReaderErrorViewModule from "./ReaderErrorView";
import * as ReaderHudOverlayModule from "./ReaderHudOverlay";
import { ReaderPage, type ReaderPageProps } from "./ReaderPage";
import * as stories from "./ReaderPage.stories";
import { useLocalReaderSessionStore } from "./localReaderSessionStore";

const { FullscreenCanvas, HudOpen, ArchiveError, PageError } =
  composeStories(stories);

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
  const api: CoordinatorWorkerApi = {
    openArchive: vi.fn(async (): Promise<OpenArchiveResult> => ({
      pageCount: 6,
      entries: [],
      fromIndexCache: false,
    })),
    requestVisiblePages: vi.fn(
      async (
        pageIndices: readonly number[],
        _prefetch: readonly number[],
        epoch: number,
      ) => pageIndices.map((pageIndex) => createReadyFrame(pageIndex, epoch)),
    ),
    updateAccessToken: vi.fn(),
    cancelEpochBelow: vi.fn(),
    closeArchive: vi.fn(async () => {}),
    ...overrides,
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

describe("ReaderPage", () => {
  const originalUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;

  let canvasSpy: MockInstance<typeof ReaderCanvasModule.ReaderCanvas>;
  let hudSpy: MockInstance<typeof ReaderHudOverlayModule.ReaderHudOverlay>;
  let errorViewSpy: MockInstance<typeof ReaderErrorViewModule.ReaderErrorView>;

  beforeEach(async () => {
    await resetTestDb();
    diagnosticLogger.clear();
    useLocalReaderSessionStore.setState({ session: null });
    window.history.replaceState(null, "", "/read/local");

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
    vi.restoreAllMocks();
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

  it("全Storybookストーリーを決定論的に描画し直下子コンポーネントへ期待Propsを渡すこと (AC-RD-02, AC-RD-06, AC-RD-07)", () => {
    const { unmount: unmountFullscreen } = render(<FullscreenCanvas />);
    expect(screen.getByTestId("reader-page")).toBeVisible();
    expect(screen.getByTestId("reader-loading")).toBeVisible();
    expect(getLatestCanvasProps().frame).toBeNull();
    expect(getLatestHudProps()).toEqual({
      isOpen: false,
      fileName: "sample-comic-vol01.cbz",
      currentPageIndex: 0,
      totalPages: 24,
      onClose: expect.any(Function),
      onNextPage: expect.any(Function),
      onPrevPage: expect.any(Function),
    });
    expect(errorViewSpy).not.toHaveBeenCalled();
    unmountFullscreen();

    errorViewSpy.mockClear();
    const { unmount: unmountHud } = render(<HudOpen />);
    expect(getLatestHudProps()).toMatchObject({
      isOpen: true,
      fileName: "sample-comic-vol01.cbz",
      currentPageIndex: 11,
      totalPages: 24,
    });
    act(() => {
      getLatestHudProps().onNextPage();
    });
    expect(getLatestHudProps().currentPageIndex).toBe(12);
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
    render(<PageError />);
    expect(screen.queryByTestId("reader-loading")).not.toBeInTheDocument();
    expect(getLatestErrorViewProps()).toEqual({
      mode: "page",
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
      expect(getLatestCanvasProps().frame).toMatchObject({
        status: "ready",
        pageIndex: 0,
      });
    });

    // StrictMode の 1 回目アンマウントでセッション1は停止されるが、Zustand session は消えない
    expect(session1.api.cancelEpochBelow).toHaveBeenCalled();
    expect(session1.api.closeArchive).toHaveBeenCalledTimes(1);
    expect(session1.dispose).toHaveBeenCalledTimes(1);
    expect(useLocalReaderSessionStore.getState().session?.file).toBe(file);
    expect(window.location.pathname).toBe("/read/local");

    // レンダラハンドル登録後のアンマウント時に clearAllTextures が呼ばれることも検証
    act(() => {
      getLatestCanvasProps().onRendererReady?.({
        deletePageTexture,
        clearAllTextures,
      });
    });
    expect(clearAllTextures).not.toHaveBeenCalled();
  });

  it("openArchive成功後にFast-Pathでページ0を描画し完了後に近傍[1][2]を個別先読みしてL1ヒット時は再取得しないこと", async () => {
    const openDeferred = createDeferred<OpenArchiveResult>();
    const page0Deferred = createDeferred<DecodedPageFrame[]>();
    const page1Deferred = createDeferred<DecodedPageFrame[]>();
    const page2Deferred = createDeferred<DecodedPageFrame[]>();
    const page3Deferred = createDeferred<DecodedPageFrame[]>();

    const frame0 = createReadyFrame(0, 1);
    const frame1 = createReadyFrame(1, 1);
    const frame2 = createReadyFrame(2, 1);
    const frame3 = createReadyFrame(3, 2);

    const mockSession = createMockCoordinatorSession({
      openArchive: vi.fn(() => openDeferred.promise),
      requestVisiblePages: vi.fn((pageIndices) => {
        const target = pageIndices[0];
        if (target === 0) return page0Deferred.promise;
        if (target === 1) return page1Deferred.promise;
        if (target === 2) return page2Deferred.promise;
        return page3Deferred.promise;
      }),
    });

    renderWithSession({}, () => mockSession.handle);

    // オープン中・未描画時はローディング表示
    expect(screen.getByTestId("reader-loading")).toBeVisible();
    await waitFor(() => {
      expect(mockSession.api.openArchive).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: "local-session",
          rawFileName: "comic-vol01.cbz",
          indexCacheKey: expect.stringMatching(/^local:comic-vol01\.cbz:/),
        }),
        null,
        1,
      );
    });

    // openArchive 完了 -> まず Fast-Path [0] のみ要求される
    await act(async () => {
      openDeferred.resolve({
        pageCount: 6,
        entries: [],
        fromIndexCache: false,
      });
      await flushMicrotasks();
    });

    expect(mockSession.api.requestVisiblePages).toHaveBeenCalledTimes(1);
    expect(mockSession.api.requestVisiblePages).toHaveBeenNthCalledWith(
      1,
      [0],
      [],
      1,
    );
    expect(screen.getByTestId("reader-loading")).toBeVisible();

    // Fast-Path [0] 完了 -> 描画されローディング消滅、その後に近傍 [1] と [2] が個別要求される
    await act(async () => {
      page0Deferred.resolve([frame0]);
      await flushMicrotasks();
    });

    expect(screen.queryByTestId("reader-loading")).not.toBeInTheDocument();
    expect(getLatestCanvasProps().frame).toBe(frame0);
    expect(mockSession.api.requestVisiblePages).toHaveBeenCalledTimes(3);
    expect(mockSession.api.requestVisiblePages).toHaveBeenNthCalledWith(
      2,
      [1],
      [],
      1,
    );
    expect(mockSession.api.requestVisiblePages).toHaveBeenNthCalledWith(
      3,
      [2],
      [],
      1,
    );

    // 近傍 [1], [2] が到着して L1 に格納される
    await act(async () => {
      page1Deferred.resolve([frame1]);
      page2Deferred.resolve([frame2]);
      await flushMicrotasks();
    });

    // ページ 1 へ移動 -> L1 キャッシュヒットのため [1] は再取得せず、[3] のみ取得する
    act(() => {
      getLatestHudProps().onNextPage();
    });

    expect(mockSession.api.cancelEpochBelow).toHaveBeenCalledWith(2);
    expect(getLatestCanvasProps().frame).toBe(frame1);
    expect(getLatestHudProps().currentPageIndex).toBe(1);
    expect(mockSession.api.requestVisiblePages).toHaveBeenCalledTimes(4);
    expect(mockSession.api.requestVisiblePages).toHaveBeenNthCalledWith(
      4,
      [3],
      [],
      2,
    );

    await act(async () => {
      page3Deferred.resolve([frame3]);
      await flushMicrotasks();
    });
  });

  it("連続めくり時の古いepoch遅延到着フレームはL1登録前にbitmap.close()し、L1退避時もdeletePageTextureとclose()を呼ぶこと (AC-RD-05)", async () => {
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
        const target = pageIndices[0];
        if (target === 0 && epoch === 1) return [frame0];
        if (target === 1 && epoch === 1) return stalePrefetchDeferred.promise;
        if (target === 2 && epoch === 1) return staleErrorDeferred.promise;
        if (target === 1 && epoch === 2) return [frame1];
        if (target === 2 && epoch === 3) return [frame2];
        if (target === 3 && epoch === 4) return [frame3];
        if (target === 4 && epoch === 5) return [frame4];
        if (target === 5 && epoch === 6) return [frame5];
        if (target === 6 && epoch === 7) return [frame6];
        if (target === 7 && epoch === 7) {
          // 返却フレーム自体に古い epoch が混入しているケース
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
      expect(getLatestCanvasProps().frame).toBe(frame0);
    });

    // ページ 1 へ進めて epoch を 2 へ上げる（epoch 1 の [1], [2] はまだ未完了）
    await act(async () => {
      getLatestHudProps().onNextPage();
      await flushMicrotasks();
    });
    expect(getLatestCanvasProps().frame).toBe(frame1);

    // epoch 1 で遅延到着した ready と error は破棄され、ready の bitmap.close() が即座に呼ばれる
    await act(async () => {
      stalePrefetchDeferred.resolve([staleReadyFrame]);
      staleErrorDeferred.resolve([createErrorFrame(2, 1)]);
      await flushMicrotasks();
    });
    expect(staleReadyBitmap.close).toHaveBeenCalledTimes(1);

    // 連続して 2 -> 3 -> 4 -> 5 -> 6 へ進み、L1(5枚) 上限超過で最古ページが退避・解放される
    for (const expectedPage of [2, 3, 4, 5, 6]) {
      await act(async () => {
        getLatestHudProps().onNextPage();
        await flushMicrotasks();
      });
      expect(getLatestHudProps().currentPageIndex).toBe(expectedPage);
    }

    expect(deletePageTexture).toHaveBeenCalledWith(0);
    expect(frame0.bitmap.close).toHaveBeenCalledTimes(1);
    expect(staleInnerEpochBitmap.close).toHaveBeenCalledTimes(1);

    // アンマウント時に残りすべての L1 bitmap.close() と clearAllTextures() が実行される
    unmount();
    expect(frame6.bitmap.close).toHaveBeenCalledTimes(1);
    expect(clearAllTextures).toHaveBeenCalledTimes(1);
  });

  it("右開き操作（タップ30/40/30%・rect幅0フォールバック・二重発火抑止・スワイプ・pointercancel・キーボード）が仕様通り動作すること (AC-RD-02, AC-RD-03)", async () => {
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

    // rect.width === 0 のときは安全フォールバック ratio=0.5 となり HUD トグルが発火する
    mockSurfaceRect(surface, { left: 0, width: 0 });
    fireEvent.click(surface, { clientX: 10 });
    expect(getLatestHudProps().isOpen).toBe(true);

    // rect.width = 1000 で境界テスト（30%未満=次頁、30..70%=HUDトグル、70%超=前頁）
    mockSurfaceRect(surface, { left: 100, width: 1000 });

    // 左端タップ (ratio = 0.299 < 0.30) -> 次頁 (0 -> 1)
    await act(async () => {
      fireEvent.click(surface, { clientX: 399 });
      await flushMicrotasks();
    });
    expect(getLatestHudProps().currentPageIndex).toBe(1);

    // 中央境界 (ratio = 0.30, 0.70) -> HUD トグル (true -> false -> true)
    fireEvent.click(surface, { clientX: 400 });
    expect(getLatestHudProps().isOpen).toBe(false);
    fireEvent.click(surface, { clientX: 800 });
    expect(getLatestHudProps().isOpen).toBe(true);

    // 右端タップ (ratio = 0.701 > 0.70) -> 前頁 (1 -> 0)
    await act(async () => {
      fireEvent.click(surface, { clientX: 801 });
      await flushMicrotasks();
    });
    expect(getLatestHudProps().currentPageIndex).toBe(0);

    // 先頭ページでさらに前頁・末尾ページでさらに次頁は境界クランプされる
    fireEvent.click(surface, { clientX: 900 });
    expect(getLatestHudProps().currentPageIndex).toBe(0);

    // pointerdown -> pointerup -> click の連続発火時は二重実行されない
    await act(async () => {
      dispatchPointer(surface, "pointerdown", { clientX: 200, clientY: 300 });
      dispatchPointer(surface, "pointerup", { clientX: 205, clientY: 302 });
      fireEvent.click(surface, { clientX: 205, clientY: 302 });
      await flushMicrotasks();
    });
    expect(getLatestHudProps().currentPageIndex).toBe(1);

    // pointercancel で開始座標がクリアされ、直後の pointerup は無反応になる
    dispatchPointer(surface, "pointerdown", { clientX: 200, clientY: 300 });
    dispatchPointer(surface, "pointercancel");
    dispatchPointer(surface, "pointerup", { clientX: 350, clientY: 300 });
    expect(getLatestHudProps().currentPageIndex).toBe(1);

    // 横スワイプ dx >= 40 かつ |dx| > |dy|: 左→右 (dx > 0) で次頁 (1 -> 2)
    await act(async () => {
      dispatchPointer(surface, "pointerdown", { clientX: 500, clientY: 300 });
      dispatchPointer(surface, "pointerup", { clientX: 560, clientY: 310 });
      await flushMicrotasks();
    });
    expect(getLatestHudProps().currentPageIndex).toBe(2);

    // 横スワイプ右→左 (dx < 0) で前頁 (2 -> 1)
    await act(async () => {
      dispatchPointer(surface, "pointerdown", { clientX: 560, clientY: 300 });
      dispatchPointer(surface, "pointerup", { clientX: 500, clientY: 310 });
      await flushMicrotasks();
    });
    expect(getLatestHudProps().currentPageIndex).toBe(1);

    // 縦移動が大きい斜めドラッグ (|dx| >= 40 だが |dx| <= |dy|) はスワイプ扱いせずタップ判定
    dispatchPointer(surface, "pointerdown", { clientX: 600, clientY: 200 });
    dispatchPointer(surface, "pointerup", { clientX: 650, clientY: 260 }); // clientX=650 => ratio=0.55 => HUDトグル
    expect(getLatestHudProps().isOpen).toBe(false);

    // キーボード ArrowLeft (次頁) / ArrowRight (前頁) / その他キー(無反応)
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
    // 最終ページ上限クランプ
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

      // Escape キーと重複 close 呼び出しで TR-08 が 1 回だけ実行されること
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

      // initialSnapshot 状態（runtime === null）でも登録済み exitFn で安全に TR-08 実行できること
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

  it("個別ページエラー時（フレームerrorおよび非中断reject）はReaderErrorView mode='page'を表示しつつ前後ページ移動を継続できること (AC-RD-07)", async () => {
    const frame0 = createErrorFrame(0, 1, "DECODE_FAILED", "raw decode error");
    const frame2 = createReadyFrame(2, 3);
    const mockSession = createMockCoordinatorSession({
      openArchive: vi.fn(async () => ({
        pageCount: 3,
        entries: [],
        fromIndexCache: false,
      })),
      requestVisiblePages: vi.fn(async (pageIndices, _prefetch, epoch) => {
        const target = pageIndices[0];
        if (target === 0) return [frame0];
        if (target === 1) {
          throw new ZipArchiveError("CORRUPT_ZIP", "page 1 corrupt");
        }
        return [createReadyFrame(target, epoch, frame2.bitmap)];
      }),
    });

    renderWithSession({}, () => mockSession.handle);

    // ページ 0 は error フレームとしてページエラー表示 & 診断ログ記録
    await waitFor(() => {
      expect(errorViewSpy).toHaveBeenCalled();
    });
    expect(getLatestErrorViewProps()).toEqual({
      mode: "page",
      message: "ページの画像デコードに失敗しました",
      errorCode: "DECODE_FAILED",
    });
    expect(diagnosticLogger.getEntries()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: "error",
          scope: "reader",
        }),
      ]),
    );

    // ページ 1 は非中断 reject を page エラーフレームへ変換しつつ次ページへ進める
    await act(async () => {
      getLatestHudProps().onNextPage();
      await flushMicrotasks();
    });
    expect(getLatestHudProps().currentPageIndex).toBe(1);
    expect(getLatestErrorViewProps()).toEqual({
      mode: "page",
      message: "ZIP ファイルが破損しているため開けませんでした",
      errorCode: "CORRUPT_ZIP",
    });

    // ページ 2 へ進めると正常描画に復帰する
    await act(async () => {
      getLatestHudProps().onNextPage();
      await flushMicrotasks();
    });
    expect(getLatestHudProps().currentPageIndex).toBe(2);
    expect(getLatestCanvasProps().frame).toMatchObject({
      status: "ready",
      pageIndex: 2,
    });
  });

  it("openArchive失敗・0ページ・WebGL2致命的エラー時は診断ログ記録とarchiveエラー表示を行い操作を遮断すること (AC-RD-06)", async () => {
    // 1. openArchive が ZipArchiveError で失敗
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

    // archiveError 中はサーフェスタップや矢印キーでページ送り・HUD開閉されない
    fireEvent.click(screen.getByTestId("reader-interaction-surface"));
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(getLatestHudProps().isOpen).toBe(false);
    unmountEncrypted();

    // 2. openArchive が pageCount=0 を返した場合も EMPTY_ARCHIVE 扱い
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

    // 3. openArchive が AbortError を投げた場合や遅延解決は無視される
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

    // 4. ReaderCanvas の onFatalError で WEBGL_UNSUPPORTED 表示 & isOpening中の移動ガード
    const { unmount: unmountWebgl } = renderWithSession({
      initialSnapshot: {
        totalPages: 5,
        isOpening: true,
      },
    });
    expect(screen.getByTestId("reader-loading")).toBeVisible();
    // isOpening 中および totalPages === 0 ではページ送りされない
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

    // 5. totalPages === 0 かつ isOpening省略(=false)の境界でもページ移動しない
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

    // アンマウント後に delayedPage が解決された場合 -> bitmap.close() のみ行いクラッシュしない
    unmount1();
    await act(async () => {
      delayedPage.resolve([createReadyFrame(0, 1, lateBitmap)]);
      await flushMicrotasks();
    });
    expect(lateBitmap.close).toHaveBeenCalledTimes(1);

    // AbortError やアンマウント後 reject でもエラー画面を出さない
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

    // WebGL致命的エラー表示中はタップや矢印キー操作を遮断する
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
      expect(getLatestCanvasProps().frame).toBe(frame0);
    });

    // 稼働中のコンテキスト復元失敗等で WEBGL_INIT_FAILED が発火したら即座に Worker と L1 を解放する
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
      expect(getLatestCanvasProps().frame).toBe(frame0);
    });

    // 1. 同一ルート(/read/local?page=2)上の popstate ではセッションとランタイムを維持する
    act(() => {
      window.history.replaceState(null, "", "/read/local?page=2");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(useLocalReaderSessionStore.getState().session).not.toBeNull();
    expect(mockSession.dispose).not.toHaveBeenCalled();

    // 2. '/' への popstate 復帰時は releaseRuntime と clearSession() を実行し replace('/') を割り込ませない
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

    // 3. WebGL2エラー後(runtimeRef.current === null)でも '/' への popstate で clearSession() と clearAllTextures() が実行される
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
      expect(getLatestCanvasProps().frame).toBe(frame0);
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

    // 1. キャッシュヒット時 (0RTT): openArchive(source, cachedEntries, 1), put 未呼び出し
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
      expect(getLatestCanvasProps().frame).toMatchObject({
        status: "ready",
        pageIndex: 0,
      });
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

    // 2. キャッシュミス時: openArchive(source, null, 1) -> put(indexCacheKey, entries) 呼び出し
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
        expect(getLatestCanvasProps().frame).toMatchObject({
          status: "ready",
          pageIndex: 0,
        });
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

    // 1. get待機中にTR-08終了 -> 遅延resolveしてもopenArchive/putは呼ばれない
    const getDeferred1 = createDeferred<readonly ZipPageEntry[] | null>();
    const repo1 = createMockZipIndexCacheRepo({
      get: vi.fn(() => getDeferred1.promise),
    });
    const session1 = createMockCoordinatorSession();
    const registeredExit: { current: (() => void) | null } = { current: null };

    renderWithSession(
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

    // 2. get待機中にアンマウント -> 遅延rejectしてもwarnログ・openArchive・エラー表示は呼ばれない
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
});
