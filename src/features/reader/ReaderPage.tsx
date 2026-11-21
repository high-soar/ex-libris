import {
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type { CoordinatorSessionHandle } from "../../app/coordinatorClient";
import { useServices } from "../../app/serviceContext";
import { diagnosticLogger } from "../../diagnostics/diagnosticLogger";
import type {
  ArchiveSourceDescriptor,
  DecodedPageFrame,
  ZipErrorCode,
  ZipPageEntry,
} from "../../engine/types";
import { ZipArchiveError, isAbortError } from "../../engine/zip/errors";
import { matchRoute } from "../../shared/router/routeMatcher";
import { useRouter } from "../../shared/router/routerContext";
import type { ZipIndexCacheRepository } from "../../storage/repositories/zipIndexCacheRepository";
import {
  ReaderCanvas,
  type ReaderCanvasHandle,
  type WebGLFatalErrorCode,
} from "../../webgl/ReaderCanvas";
import { L1PageCache } from "../../webgl/l1PageCache";
import { ReaderErrorView } from "./ReaderErrorView";
import { ReaderHudOverlay } from "./ReaderHudOverlay";
import {
  type LocalReaderSession,
  useLocalReaderSessionStore,
} from "./localReaderSessionStore";
import {
  type ExtractedReaderError,
  type ReaderFatalErrorCode,
  extractReaderError,
  getReaderErrorMessage,
} from "./readerErrors";

export interface ReaderPageInitialSnapshot {
  readonly totalPages: number;
  readonly currentPageIndex?: number;
  readonly frame?: DecodedPageFrame | null;
  readonly archiveError?: ExtractedReaderError | null;
  readonly isOpening?: boolean;
  readonly isHudOpen?: boolean;
}

export interface ReaderPageProps {
  readonly onRegisterExit?: (exitFn: (() => void) | null) => void;
  readonly initialSnapshot?: ReaderPageInitialSnapshot;
}

interface ReaderRuntime {
  readonly coordinator: CoordinatorSessionHandle;
  readonly l1Cache: L1PageCache;
}

const SWIPE_THRESHOLD_PX = 40;
const TAP_LEFT_BOUNDARY = 0.3;
const TAP_RIGHT_BOUNDARY = 0.7;

const PAGE_ERROR_CODE_MAP: Record<ReaderFatalErrorCode, ZipErrorCode> = {
  CORRUPT_ZIP: "CORRUPT_ZIP",
  EMPTY_ARCHIVE: "EMPTY_ARCHIVE",
  ENCRYPTED_ZIP: "ENCRYPTED_ZIP",
  UNSUPPORTED_COMPRESSION: "UNSUPPORTED_COMPRESSION",
  DECODE_FAILED: "DECODE_FAILED",
  READ_ERROR: "READ_ERROR",
  WEBGL_UNSUPPORTED: "READ_ERROR",
  WEBGL_INIT_FAILED: "READ_ERROR",
};

function buildLocalArchiveSource(
  session: LocalReaderSession,
): ArchiveSourceDescriptor {
  const sessionKey = `local:${session.fileName}:${session.fileSize}`;
  return {
    kind: "local-session",
    file: session.file,
    rawFileName: session.fileName,
    fileSize: session.fileSize,
    indexCacheKey: sessionKey,
    progressTargetKey: sessionKey,
  };
}

function buildProtectedWindow(pageIndex: number, totalPages: number): number[] {
  return [pageIndex - 1, pageIndex, pageIndex + 1, pageIndex + 2].filter(
    (candidate) => candidate >= 0 && candidate < totalPages,
  );
}

function buildNeighborTargets(pageIndex: number, totalPages: number): number[] {
  return [pageIndex + 1, pageIndex + 2, pageIndex - 1].filter(
    (candidate) => candidate >= 0 && candidate < totalPages,
  );
}

function resolveTapRatio(clientX: number, rect: DOMRect): number {
  if (rect.width <= 0) {
    return 0.5;
  }
  const raw = (clientX - rect.left) / rect.width;
  return Math.min(1, Math.max(0, raw));
}

function isHorizontalSwipe(dx: number, dy: number): boolean {
  return Math.abs(dx) >= SWIPE_THRESHOLD_PX && Math.abs(dx) > Math.abs(dy);
}

function closeReadyFrames(frames: readonly DecodedPageFrame[]): void {
  for (const frame of frames) {
    if (frame.status === "ready") {
      frame.bitmap.close();
    }
  }
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function readZipIndexCacheSafely(
  repo: ZipIndexCacheRepository,
  cacheKey: string,
  isCurrentAttempt: () => boolean,
): Promise<readonly ZipPageEntry[] | null> {
  try {
    return await repo.get(cacheKey);
  } catch (cacheError) {
    if (isCurrentAttempt()) {
      diagnosticLogger.warn(
        "reader",
        "目次キャッシュの取得に失敗しました",
        `${cacheKey}: ${formatErrorMessage(cacheError)}`,
      );
    }
    return null;
  }
}

export function ReaderPage({
  onRegisterExit,
  initialSnapshot,
}: ReaderPageProps): ReactNode {
  const { createCoordinatorSession, zipIndexCacheRepo } = useServices();
  const { replace, back } = useRouter();
  const session = useLocalReaderSessionStore((state) => state.session);
  const clearSession = useLocalReaderSessionStore(
    (state) => state.clearSession,
  );

  const [totalPages, setTotalPages] = useState<number>(
    initialSnapshot?.totalPages ?? 0,
  );
  const [currentPageIndex, setCurrentPageIndex] = useState<number>(
    initialSnapshot?.currentPageIndex ?? 0,
  );
  const [currentFrame, setCurrentFrame] = useState<DecodedPageFrame | null>(
    initialSnapshot?.frame ?? null,
  );
  const [archiveError, setArchiveError] = useState<ExtractedReaderError | null>(
    initialSnapshot?.archiveError ?? null,
  );
  const [webglFatalError, setWebglFatalError] =
    useState<ExtractedReaderError | null>(null);
  const [isOpening, setIsOpening] = useState<boolean>(
    initialSnapshot !== undefined ? (initialSnapshot.isOpening ?? false) : true,
  );
  const [isHudOpen, setIsHudOpen] = useState<boolean>(
    initialSnapshot?.isHudOpen ?? false,
  );

  const runtimeRef = useRef<ReaderRuntime | null>(null);
  const rendererHandleRef = useRef<ReaderCanvasHandle | null>(null);
  const epochRef = useRef(0);
  const isClosingRef = useRef(false);
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null);
  const suppressNextClickRef = useRef(false);

  const totalPagesRef = useRef(totalPages);
  totalPagesRef.current = totalPages;
  const currentPageIndexRef = useRef(currentPageIndex);
  currentPageIndexRef.current = currentPageIndex;
  const archiveErrorRef = useRef(archiveError);
  archiveErrorRef.current = archiveError;
  const webglFatalErrorRef = useRef<ExtractedReaderError | null>(null);
  const isOpeningRef = useRef(isOpening);
  isOpeningRef.current = isOpening;

  const releaseRuntime = useCallback((runtime: ReaderRuntime) => {
    epochRef.current += 1;
    const invalidateEpoch = epochRef.current;
    runtimeRef.current = null;
    runtime.l1Cache.setMinActiveEpoch(invalidateEpoch);
    runtime.coordinator.api.cancelEpochBelow(invalidateEpoch);
    void runtime.coordinator.api.closeArchive().catch(() => {});
    runtime.l1Cache.clear();
    rendererHandleRef.current?.clearAllTextures();
    runtime.coordinator.dispose();
  }, []);

  const releaseResources = useCallback(() => {
    const runtime = runtimeRef.current;
    if (runtime !== null) {
      releaseRuntime(runtime);
    } else {
      epochRef.current += 1;
      rendererHandleRef.current?.clearAllTextures();
    }
  }, [releaseRuntime]);

  const reportArchiveError = useCallback(
    (errorState: ExtractedReaderError, detail: string) => {
      diagnosticLogger.error("reader", errorState.message, detail);
      archiveErrorRef.current = errorState;
      setArchiveError(errorState);
      isOpeningRef.current = false;
      setIsOpening(false);
    },
    [],
  );

  const handleClose = useCallback(() => {
    if (isClosingRef.current) {
      return;
    }
    isClosingRef.current = true;
    releaseResources();
    clearSession();
    back();
  }, [back, clearSession, releaseResources]);

  useEffect(() => {
    onRegisterExit?.(handleClose);
    return () => {
      onRegisterExit?.(null);
    };
  }, [onRegisterExit, handleClose]);

  const fetchAndStoreSinglePage = useCallback(
    async (
      runtime: ReaderRuntime,
      targetPage: number,
      epoch: number,
      protectedPages: readonly number[],
    ): Promise<DecodedPageFrame | null> => {
      try {
        const frames = await runtime.coordinator.api.requestVisiblePages(
          [targetPage],
          [],
          epoch,
        );

        if (runtimeRef.current !== runtime || epoch !== epochRef.current) {
          closeReadyFrames(frames);
          return null;
        }

        let acceptedFrame: DecodedPageFrame | null = null;
        for (const frame of frames) {
          if (!runtime.l1Cache.put(frame, protectedPages)) {
            continue;
          }
          if (frame.status === "error") {
            diagnosticLogger.error(
              "reader",
              getReaderErrorMessage(frame.errorCode),
              `${frame.errorCode}: page ${frame.pageIndex + 1} (${frame.message})`,
            );
          }
          acceptedFrame = frame;
        }

        return acceptedFrame;
      } catch (error) {
        if (
          isAbortError(error) ||
          runtimeRef.current !== runtime ||
          epoch !== epochRef.current
        ) {
          return null;
        }

        const extracted = extractReaderError(error);
        const pageErrorCode = PAGE_ERROR_CODE_MAP[extracted.code];
        diagnosticLogger.error(
          "reader",
          extracted.message,
          `${pageErrorCode}: page ${targetPage + 1}`,
        );

        const errorFrame: DecodedPageFrame = {
          status: "error",
          pageIndex: targetPage,
          epoch,
          errorCode: pageErrorCode,
          message: extracted.message,
        };
        runtime.l1Cache.put(errorFrame, protectedPages);
        return errorFrame;
      }
    },
    [],
  );

  const loadPageWindow = useCallback(
    async (
      runtime: ReaderRuntime,
      pageIndex: number,
      pageTotal: number,
      epoch: number,
    ): Promise<void> => {
      const protectedPages = buildProtectedWindow(pageIndex, pageTotal);
      const cached = runtime.l1Cache.get(pageIndex);

      if (cached !== undefined) {
        setCurrentFrame(cached);
      } else {
        setCurrentFrame(null);
        const fetched = await fetchAndStoreSinglePage(
          runtime,
          pageIndex,
          epoch,
          protectedPages,
        );
        if (runtimeRef.current !== runtime || epoch !== epochRef.current) {
          return;
        }
        if (fetched !== null) {
          setCurrentFrame(fetched);
        }
      }

      const neighbors = buildNeighborTargets(pageIndex, pageTotal);
      for (const neighbor of neighbors) {
        if (runtime.l1Cache.peek(neighbor) === undefined) {
          void fetchAndStoreSinglePage(
            runtime,
            neighbor,
            epoch,
            protectedPages,
          );
        }
      }
    },
    [fetchAndStoreSinglePage],
  );

  useEffect(() => {
    if (session === null) {
      if (!isClosingRef.current) {
        replace("/");
      }
      return;
    }

    if (initialSnapshot !== undefined) {
      return;
    }

    isClosingRef.current = false;

    if (webglFatalErrorRef.current !== null) {
      isOpeningRef.current = false;
      setIsOpening(false);
      return;
    }

    const coordinator = createCoordinatorSession();
    const l1Cache = new L1PageCache({
      onEvictTexture: (evictedPageIndex) => {
        rendererHandleRef.current?.deletePageTexture(evictedPageIndex);
      },
    });
    const runtime: ReaderRuntime = { coordinator, l1Cache };
    runtimeRef.current = runtime;

    const openEpoch = epochRef.current + 1;
    epochRef.current = openEpoch;
    l1Cache.setMinActiveEpoch(openEpoch);

    isOpeningRef.current = true;
    setIsOpening(true);
    archiveErrorRef.current = null;
    setArchiveError(null);
    setCurrentFrame(null);
    currentPageIndexRef.current = 0;
    setCurrentPageIndex(0);
    totalPagesRef.current = 0;
    setTotalPages(0);

    const source = buildLocalArchiveSource(session);
    const isCurrentAttempt = () =>
      runtimeRef.current === runtime && epochRef.current === openEpoch;

    void (async () => {
      try {
        const cachedEntries = await readZipIndexCacheSafely(
          zipIndexCacheRepo,
          source.indexCacheKey,
          isCurrentAttempt,
        );
        if (!isCurrentAttempt()) {
          return;
        }

        const result = await coordinator.api.openArchive(
          source,
          cachedEntries,
          openEpoch,
        );
        if (!isCurrentAttempt()) {
          return;
        }
        if (result.pageCount <= 0) {
          throw new ZipArchiveError(
            "EMPTY_ARCHIVE",
            "表示できる画像ファイルが見つかりませんでした",
          );
        }

        diagnosticLogger.info(
          "reader",
          result.fromIndexCache
            ? "目次キャッシュからアーカイブを開きました (0RTT)"
            : "Central Directory解析でアーカイブを開きました",
          `${source.indexCacheKey} (pages=${result.pageCount}, fromIndexCache=${String(result.fromIndexCache)})`,
        );

        if (!result.fromIndexCache) {
          void zipIndexCacheRepo
            .put(source.indexCacheKey, result.entries)
            .catch((cacheError: unknown) => {
              diagnosticLogger.warn(
                "reader",
                "目次キャッシュの保存に失敗しました",
                `${source.indexCacheKey}: ${formatErrorMessage(cacheError)}`,
              );
            });
        }

        totalPagesRef.current = result.pageCount;
        setTotalPages(result.pageCount);
        isOpeningRef.current = false;
        setIsOpening(false);
        await loadPageWindow(runtime, 0, result.pageCount, openEpoch);
      } catch (error) {
        if (isAbortError(error) || !isCurrentAttempt()) {
          return;
        }
        const extracted = extractReaderError(error);
        reportArchiveError(extracted, `${extracted.code}: ${session.fileName}`);
      }
    })();

    return () => {
      if (runtimeRef.current === runtime) {
        releaseRuntime(runtime);
      }
    };
  }, [
    session,
    initialSnapshot,
    createCoordinatorSession,
    zipIndexCacheRepo,
    loadPageWindow,
    releaseRuntime,
    replace,
    reportArchiveError,
  ]);

  useEffect(() => {
    if (initialSnapshot !== undefined || session === null) {
      return;
    }

    const cleanupIfLeftReaderRoute = () => {
      const windowPath = `${window.location.pathname}${window.location.search}`;
      if (
        matchRoute(windowPath).name !== "reader-local" &&
        !isClosingRef.current
      ) {
        isClosingRef.current = true;
        releaseResources();
        clearSession();
      }
    };

    window.addEventListener("popstate", cleanupIfLeftReaderRoute);
    return () => {
      window.removeEventListener("popstate", cleanupIfLeftReaderRoute);
      cleanupIfLeftReaderRoute();
    };
  }, [clearSession, initialSnapshot, releaseResources, session]);

  const goToPage = useCallback(
    (requestedIndex: number) => {
      const total = totalPagesRef.current;
      if (
        webglFatalErrorRef.current !== null ||
        archiveErrorRef.current !== null ||
        isOpeningRef.current ||
        total <= 0
      ) {
        return;
      }
      const clamped = Math.min(total - 1, Math.max(0, requestedIndex));
      if (clamped === currentPageIndexRef.current) {
        return;
      }

      currentPageIndexRef.current = clamped;
      setCurrentPageIndex(clamped);

      const runtime = runtimeRef.current;
      if (runtime === null) {
        return;
      }

      const nextEpoch = epochRef.current + 1;
      epochRef.current = nextEpoch;
      runtime.l1Cache.setMinActiveEpoch(nextEpoch);
      runtime.coordinator.api.cancelEpochBelow(nextEpoch);
      void loadPageWindow(runtime, clamped, total, nextEpoch);
    },
    [loadPageWindow],
  );

  const goNextPage = useCallback(() => {
    goToPage(currentPageIndexRef.current + 1);
  }, [goToPage]);

  const goPrevPage = useCallback(() => {
    goToPage(currentPageIndexRef.current - 1);
  }, [goToPage]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        handleClose();
        return;
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        goNextPage();
        return;
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        goPrevPage();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [goNextPage, goPrevPage, handleClose]);

  const handleTapAt = useCallback(
    (clientX: number, rect: DOMRect) => {
      if (
        webglFatalErrorRef.current !== null ||
        archiveErrorRef.current !== null
      ) {
        return;
      }
      const ratio = resolveTapRatio(clientX, rect);
      if (ratio < TAP_LEFT_BOUNDARY) {
        goNextPage();
        return;
      }
      if (ratio > TAP_RIGHT_BOUNDARY) {
        goPrevPage();
        return;
      }
      setIsHudOpen((prev) => !prev);
    },
    [goNextPage, goPrevPage],
  );

  const handlePointerDown = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      suppressNextClickRef.current = false;
      pointerStartRef.current = { x: event.clientX, y: event.clientY };
    },
    [],
  );

  const handlePointerCancel = useCallback(() => {
    pointerStartRef.current = null;
  }, []);

  const handlePointerUp = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      const start = pointerStartRef.current;
      pointerStartRef.current = null;
      if (start === null) {
        return;
      }

      suppressNextClickRef.current = true;
      const dx = event.clientX - start.x;
      const dy = event.clientY - start.y;

      if (isHorizontalSwipe(dx, dy)) {
        if (dx > 0) {
          goNextPage();
        } else {
          goPrevPage();
        }
        return;
      }

      handleTapAt(event.clientX, event.currentTarget.getBoundingClientRect());
    },
    [goNextPage, goPrevPage, handleTapAt],
  );

  const handleClick = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      if (suppressNextClickRef.current) {
        suppressNextClickRef.current = false;
        return;
      }
      handleTapAt(event.clientX, event.currentTarget.getBoundingClientRect());
    },
    [handleTapAt],
  );

  const handleRendererReady = useCallback(
    (handle: ReaderCanvasHandle | null) => {
      rendererHandleRef.current = handle;
    },
    [],
  );

  const handleWebGLFatalError = useCallback(
    (code: WebGLFatalErrorCode, message: string) => {
      const errorState: ExtractedReaderError = {
        code,
        message: getReaderErrorMessage(code),
      };
      diagnosticLogger.error(
        "reader",
        errorState.message,
        `${code}: ${message}`,
      );
      webglFatalErrorRef.current = errorState;
      setWebglFatalError(errorState);
      isOpeningRef.current = false;
      setIsOpening(false);
      const runtime = runtimeRef.current;
      if (runtime !== null) {
        releaseRuntime(runtime);
      }
    },
    [releaseRuntime],
  );

  if (session === null) {
    return null;
  }

  const activeFatalError = webglFatalError ?? archiveError;
  const showLoading =
    activeFatalError === null && (isOpening || currentFrame === null);

  return (
    <div
      data-testid="reader-page"
      className="relative h-screen w-screen overflow-hidden bg-black select-none"
    >
      <div
        data-testid="reader-interaction-surface"
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onClick={handleClick}
        className="relative h-full w-full touch-none"
      >
        <ReaderCanvas
          frame={currentFrame}
          onRendererReady={handleRendererReady}
          onFatalError={handleWebGLFatalError}
        />

        {showLoading && (
          <div
            data-testid="reader-loading"
            role="status"
            aria-live="polite"
            className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center"
          >
            <div className="rounded-full border border-slate-700/80 bg-slate-900/80 px-4 py-2 text-xs font-medium tracking-wide text-slate-200 shadow-lg backdrop-blur-sm">
              ページを読み込み中...
            </div>
          </div>
        )}

        {activeFatalError === null && currentFrame?.status === "error" && (
          <ReaderErrorView
            mode="page"
            message={getReaderErrorMessage(currentFrame.errorCode)}
            errorCode={currentFrame.errorCode}
          />
        )}

        <ReaderHudOverlay
          isOpen={activeFatalError === null && isHudOpen}
          fileName={session.fileName}
          currentPageIndex={currentPageIndex}
          totalPages={totalPages}
          onClose={handleClose}
          onNextPage={goNextPage}
          onPrevPage={goPrevPage}
        />
      </div>

      {activeFatalError !== null && (
        <ReaderErrorView
          mode="archive"
          message={activeFatalError.message}
          errorCode={activeFatalError.code}
          onBackToHome={handleClose}
        />
      )}
    </div>
  );
}
