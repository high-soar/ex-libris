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
import {
  type ReaderOriginState,
  useRouter,
} from "../../shared/router/routerContext";
import type { ReaderSettingsRepository } from "../../storage/repositories/readerSettingsRepository";
import type { ReadingProgressRepository } from "../../storage/repositories/readingProgressRepository";
import type { SeriesRepository } from "../../storage/repositories/seriesRepository";
import type { ZipIndexCacheRepository } from "../../storage/repositories/zipIndexCacheRepository";
import type {
  ReadStatus,
  ReadingProgressRecord,
  SeriesRecord,
  VolumeRecord,
} from "../../storage/types";
import {
  ReaderCanvas,
  type ReaderCanvasHandle,
  type WebGLFatalErrorCode,
} from "../../webgl/ReaderCanvas";
import { L1PageCache } from "../../webgl/l1PageCache";
import {
  DEFAULT_SHADER_CORRECTION_PARAMS,
  isDefaultShaderParams,
  normalizeShaderCorrectionParams,
} from "../../webgl/shaderParams";
import type {
  EffectiveSpreadMode,
  PageDimensions,
  ReadingDirection,
  RenderSlotFrame,
  ShaderCorrectionParams,
  SlotPosition,
  SpreadMode,
  SpreadPageOffset,
  ViewportSlot,
} from "../../webgl/types";
import { ReaderErrorView } from "./ReaderErrorView";
import { ReaderHudOverlay } from "./ReaderHudOverlay";
import { ReaderShaderSheet, type ShaderSaveStatus } from "./ReaderShaderSheet";
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
import {
  buildSpreadNeighborTargets,
  buildSpreadPrefetchTargets,
  buildSpreadProtectedWindow,
  computePreviousAnchorIndex,
  computeShiftedAnchorOnOffsetToggle,
  computeViewportSlotLayout,
  formatPageIndicator,
  getCandidateFetchPages,
  resolveDirectionActionForKey,
  resolveDirectionActionForSwipe,
  resolveDirectionActionForTapRatio,
  resolveEffectiveSpreadMode,
} from "./spreadLayout";

export interface ReaderPageInitialSnapshot {
  readonly totalPages: number;
  readonly currentPageIndex?: number;
  readonly framesByPage?: Readonly<Record<number, DecodedPageFrame>>;
  readonly archiveError?: ExtractedReaderError | null;
  readonly isOpening?: boolean;
  readonly isHudOpen?: boolean;
  readonly readingDirection?: ReadingDirection;
  readonly spreadMode?: SpreadMode;
  readonly spreadPageOffset?: SpreadPageOffset;
  readonly viewportSize?: { readonly width: number; readonly height: number };
  readonly shaderParams?: ShaderCorrectionParams;
  readonly isShaderSheetOpen?: boolean;
  readonly shaderSaveStatus?: ShaderSaveStatus;
  readonly displayTitle?: string;
  readonly errorBackLabel?: string;
}

export interface ReaderPageProps {
  readonly onRegisterExit?: (exitFn: (() => void) | null) => void;
  readonly initialSnapshot?: ReaderPageInitialSnapshot;
}

type LocalArchiveSource = Extract<
  ArchiveSourceDescriptor,
  { kind: "local-session" }
>;

type DriveArchiveSource = Extract<ArchiveSourceDescriptor, { kind: "gdrive" }>;

type ActiveReaderSource =
  | {
      readonly kind: "local-session";
      readonly descriptor: LocalArchiveSource;
      readonly displayLabel: string;
    }
  | {
      readonly kind: "gdrive";
      readonly descriptor: DriveArchiveSource;
      readonly seriesId: string;
      readonly displayLabel: string;
    };

interface ReaderRuntime {
  readonly coordinator: CoordinatorSessionHandle;
  readonly l1Cache: L1PageCache;
  readonly activeSource: ActiveReaderSource;
}

interface PageErrorDescriptor {
  readonly key: string;
  readonly slotPosition: SlotPosition;
  readonly pageNumber?: number;
  readonly message: string;
  readonly errorCode: ZipErrorCode;
}

const NEXT_SPREAD_MODE: Record<SpreadMode, SpreadMode> = {
  auto: "spread",
  spread: "single",
  single: "auto",
};

const PAGE_ERROR_CODE_MAP: Record<ReaderFatalErrorCode, ZipErrorCode> = {
  VOLUME_NOT_FOUND: "READ_ERROR",
  VOLUME_UNAVAILABLE: "READ_ERROR",
  AUTH_REQUIRED: "READ_ERROR",
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
): LocalArchiveSource {
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

function buildDriveArchiveSource(volume: VolumeRecord): DriveArchiveSource {
  return {
    kind: "gdrive",
    volumeId: volume.id,
    driveFileId: volume.driveFileId,
    fileSize: volume.fileSize,
    md5Checksum: volume.md5Checksum,
    indexCacheKey: `gdrive:${volume.driveFileId}:${volume.md5Checksum ?? volume.fileSize}`,
    progressTargetKey: `vol:${volume.id}`,
  };
}

function formatDriveVolumeTitle(
  activeSeries: SeriesRecord | null,
  volume: Pick<VolumeRecord, "volumeLabel" | "rawFileName">,
): string {
  if (activeSeries !== null) {
    const trimmedLabel = volume.volumeLabel.trim();
    return trimmedLabel.length > 0
      ? `${activeSeries.title} ${trimmedLabel}`
      : activeSeries.title;
  }
  return volume.rawFileName;
}

function resolveErrorBackLabel(
  readerOriginState: ReaderOriginState,
  fallbackSeriesId: string | null,
): string {
  if (readerOriginState.readerOrigin === "bookshelf") {
    return "ホームへ戻る";
  }
  if (readerOriginState.readerOrigin === "series-detail") {
    const hasSeriesTarget =
      (readerOriginState.canGoBackFrom?.startsWith("/series/") ?? false) ||
      (readerOriginState.seriesId ?? fallbackSeriesId) !== null;
    return hasSeriesTarget ? "シリーズ詳細へ戻る" : "ホームへ戻る";
  }
  return fallbackSeriesId !== null ? "シリーズ詳細へ戻る" : "ホームへ戻る";
}

function collectMissingNeighbors(
  l1Cache: L1PageCache,
  neighbors: readonly number[],
): number[] {
  return neighbors.filter((neighbor) => l1Cache.peek(neighbor) === undefined);
}

function resolveSortedVisiblePages(input: {
  readonly currentPageIndex: number;
  readonly totalPages: number;
  readonly effectiveSpreadMode: EffectiveSpreadMode;
  readonly readingDirection: ReadingDirection;
  readonly spreadPageOffset: SpreadPageOffset;
  readonly knownDimensions: ReadonlyMap<number, PageDimensions>;
}): number[] {
  const resolvedLayout = computeViewportSlotLayout(input);
  return resolvedLayout.slots
    .map((slot) => slot.pageIndex)
    .sort((a, b) => a - b);
}

function buildFramesRecord(
  pageIndices: readonly number[],
  lookupFrame: (pageIndex: number) => DecodedPageFrame | undefined,
): Record<number, DecodedPageFrame> {
  const frames: Record<number, DecodedPageFrame> = {};
  for (const pageIndex of pageIndices) {
    const frame = lookupFrame(pageIndex);
    if (frame !== undefined) {
      frames[pageIndex] = frame;
    }
  }
  return frames;
}

function resolveTapRatio(clientX: number, rect: DOMRect): number {
  if (rect.width <= 0) {
    return 0.5;
  }
  const raw = (clientX - rect.left) / rect.width;
  return Math.min(1, Math.max(0, raw));
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

function extractDimensionsFromFrames(
  framesByPage?: Readonly<Record<number, DecodedPageFrame>>,
): Map<number, PageDimensions> {
  const dimensions = new Map<number, PageDimensions>();
  if (framesByPage !== undefined) {
    for (const frame of Object.values(framesByPage)) {
      if (frame.status === "ready") {
        dimensions.set(frame.pageIndex, {
          width: frame.width,
          height: frame.height,
        });
      }
    }
  }
  return dimensions;
}

function readViewportSize(
  container: HTMLElement,
  observerEntry?: ResizeObserverEntry,
): { readonly width: number; readonly height: number } {
  const rect = observerEntry
    ? observerEntry.contentRect
    : container.getBoundingClientRect();
  if (rect.width > 0 && rect.height > 0) {
    return { width: rect.width, height: rect.height };
  }
  return {
    width: window.innerWidth,
    height: window.innerHeight,
  };
}

function isErrorSlotFrame(entry: RenderSlotFrame): entry is {
  readonly slot: ViewportSlot;
  readonly frame: Extract<DecodedPageFrame, { status: "error" }>;
} {
  return entry.frame !== null && entry.frame.status === "error";
}

function buildPageErrorDescriptors(
  renderSlots: readonly RenderSlotFrame[],
  currentPageIndex: number,
): readonly PageErrorDescriptor[] {
  const errorSlots = renderSlots.filter(isErrorSlotFrame);
  if (errorSlots.length === 0) {
    return [];
  }
  if (errorSlots.length === renderSlots.length) {
    const representative =
      errorSlots.find((entry) => entry.slot.pageIndex === currentPageIndex) ??
      errorSlots[0];
    return [
      {
        key: "center",
        slotPosition: "center",
        message: getReaderErrorMessage(representative.frame.errorCode),
        errorCode: representative.frame.errorCode,
      },
    ];
  }
  return errorSlots.map((entry) => ({
    key: `${entry.slot.position}-${entry.slot.pageIndex}`,
    slotPosition: entry.slot.position,
    pageNumber: entry.slot.pageIndex + 1,
    message: getReaderErrorMessage(entry.frame.errorCode),
    errorCode: entry.frame.errorCode,
  }));
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

function isCacheRepairTriggerCode(code: ZipErrorCode): boolean {
  return code === "CORRUPT_ZIP" || code === "DECODE_FAILED";
}

function findCacheRepairTriggerFrame(
  frames: readonly DecodedPageFrame[],
): Extract<DecodedPageFrame, { status: "error" }> | undefined {
  return frames.find(
    (frame): frame is Extract<DecodedPageFrame, { status: "error" }> =>
      frame.status === "error" && isCacheRepairTriggerCode(frame.errorCode),
  );
}

function persistZipIndexCacheSafely(
  repo: ZipIndexCacheRepository,
  cacheKey: string,
  entries: readonly ZipPageEntry[],
): void {
  void repo.put(cacheKey, entries).catch((cacheError: unknown) => {
    diagnosticLogger.warn(
      "reader",
      "目次キャッシュの保存に失敗しました",
      `${cacheKey}: ${formatErrorMessage(cacheError)}`,
    );
  });
}

async function deleteZipIndexCacheSafely(
  repo: ZipIndexCacheRepository,
  cacheKey: string,
  isCurrentAttempt: () => boolean,
): Promise<void> {
  try {
    await repo.delete(cacheKey);
  } catch (deleteError) {
    if (isCurrentAttempt()) {
      diagnosticLogger.warn(
        "reader",
        "目次キャッシュの削除に失敗しました",
        `${cacheKey}: ${formatErrorMessage(deleteError)}`,
      );
    }
  }
}

async function readReadingProgressSafely(
  repo: ReadingProgressRepository,
  targetKey: string,
  isCurrentAttempt: () => boolean,
): Promise<ReadingProgressRecord | null> {
  try {
    return await repo.get(targetKey);
  } catch (progressError) {
    if (isCurrentAttempt()) {
      diagnosticLogger.warn(
        "reader",
        "読書進捗の取得に失敗しました",
        `${targetKey}: ${formatErrorMessage(progressError)}`,
      );
    }
    return null;
  }
}

async function readShaderDefaultsSafely(
  repo: ReaderSettingsRepository,
  isCurrentRuntime: () => boolean,
): Promise<ShaderCorrectionParams | null> {
  try {
    return await repo.getShaderDefaults();
  } catch (settingsError) {
    if (isCurrentRuntime()) {
      diagnosticLogger.warn(
        "reader",
        "画質補正デフォルト設定の取得に失敗しました",
        formatErrorMessage(settingsError),
      );
    }
    return null;
  }
}

async function readActiveSeriesSafely(
  repo: SeriesRepository,
  seriesId: string,
  isCurrentAttempt: () => boolean,
): Promise<SeriesRecord | null> {
  try {
    const rawSeries = await repo.getById(seriesId);
    return rawSeries !== null && rawSeries.deletedAt === null
      ? rawSeries
      : null;
  } catch (seriesError) {
    if (isCurrentAttempt()) {
      diagnosticLogger.warn(
        "reader",
        "シリーズ情報の取得に失敗しました",
        `${seriesId}: ${formatErrorMessage(seriesError)}`,
      );
    }
    return null;
  }
}

function clampAnchorForPageCount(
  pageIndex: number,
  spreadPageOffset: SpreadPageOffset,
  pageCount: number,
): {
  readonly pageIndex: number;
  readonly spreadPageOffset: SpreadPageOffset;
} {
  return {
    pageIndex: Math.min(pageCount - 1, Math.max(0, pageIndex)),
    spreadPageOffset: pageCount > 1 ? spreadPageOffset : 0,
  };
}

function resolveRestoredProgressAnchor(
  savedProgress: ReadingProgressRecord | null,
  pageCount: number,
): {
  readonly pageIndex: number;
  readonly spreadPageOffset: SpreadPageOffset;
} {
  if (savedProgress === null) {
    return { pageIndex: 0, spreadPageOffset: 0 };
  }
  return clampAnchorForPageCount(
    savedProgress.currentPageIndex,
    savedProgress.spreadPageOffset,
    pageCount,
  );
}

function isConfirmedNonLandscape(dims: PageDimensions | undefined): boolean {
  return dims !== undefined && dims.width <= dims.height;
}

function computeConfirmedMaxDisplayedPageIndex(input: {
  readonly currentPageIndex: number;
  readonly totalPages: number;
  readonly effectiveSpreadMode: EffectiveSpreadMode;
  readonly spreadPageOffset: SpreadPageOffset;
  readonly knownDimensions: ReadonlyMap<number, PageDimensions>;
}): number {
  const hasConfirmedTwoPageSpread =
    input.effectiveSpreadMode === "spread" &&
    !(input.currentPageIndex === 0 && input.spreadPageOffset === 0) &&
    input.currentPageIndex + 1 < input.totalPages &&
    isConfirmedNonLandscape(
      input.knownDimensions.get(input.currentPageIndex),
    ) &&
    isConfirmedNonLandscape(
      input.knownDimensions.get(input.currentPageIndex + 1),
    );
  return hasConfirmedTwoPageSpread
    ? input.currentPageIndex + 1
    : input.currentPageIndex;
}

export function ReaderPage({
  onRegisterExit,
  initialSnapshot,
}: ReaderPageProps): ReactNode {
  const {
    createCoordinatorSession,
    zipIndexCacheRepo,
    readingProgressRepo,
    readerSettingsRepo,
    volumesRepo,
    seriesRepo,
    driveSyncRootsRepo,
    googleAuthBridge,
  } = useServices();
  const { route, readerOriginState, replace, back, exitReader } = useRouter();
  const session = useLocalReaderSessionStore((state) => state.session);
  const clearSession = useLocalReaderSessionStore(
    (state) => state.clearSession,
  );
  const isVolumeRoute = route.name === "reader-volume";
  const volumeId = route.name === "reader-volume" ? route.volumeId : null;
  const hasActiveReaderTarget = isVolumeRoute || session !== null;

  const [displayTitle, setDisplayTitle] = useState<string>(
    initialSnapshot?.displayTitle ?? session?.fileName ?? "",
  );
  const [fallbackSeriesId, setFallbackSeriesId] = useState<string | null>(null);
  const [totalPages, setTotalPages] = useState<number>(
    initialSnapshot?.totalPages ?? 0,
  );
  const [currentPageIndex, setCurrentPageIndex] = useState<number>(
    initialSnapshot?.currentPageIndex ?? 0,
  );
  const [framesByPage, setFramesByPage] = useState<
    Readonly<Record<number, DecodedPageFrame>>
  >(initialSnapshot?.framesByPage ?? {});
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
  const [readingDirection, setReadingDirection] = useState<ReadingDirection>(
    initialSnapshot?.readingDirection ?? "rtl",
  );
  const [spreadMode, setSpreadMode] = useState<SpreadMode>(
    initialSnapshot?.spreadMode ?? "auto",
  );
  const [spreadPageOffset, setSpreadPageOffset] = useState<SpreadPageOffset>(
    initialSnapshot?.spreadPageOffset ?? 0,
  );
  const [viewportSize, setViewportSize] = useState<{
    readonly width: number;
    readonly height: number;
  }>(() => ({
    width: initialSnapshot?.viewportSize?.width ?? window.innerWidth,
    height: initialSnapshot?.viewportSize?.height ?? window.innerHeight,
  }));
  const [knownDimensions, setKnownDimensions] = useState<
    ReadonlyMap<number, PageDimensions>
  >(() => extractDimensionsFromFrames(initialSnapshot?.framesByPage));
  const [shaderParams, setShaderParams] = useState<ShaderCorrectionParams>(() =>
    normalizeShaderCorrectionParams(
      initialSnapshot?.shaderParams ?? DEFAULT_SHADER_CORRECTION_PARAMS,
    ),
  );
  const [isShaderSheetOpen, setIsShaderSheetOpen] = useState<boolean>(
    initialSnapshot?.isShaderSheetOpen ?? false,
  );
  const [shaderSaveStatus, setShaderSaveStatus] = useState<ShaderSaveStatus>(
    initialSnapshot?.shaderSaveStatus ?? "idle",
  );

  const effectiveSpreadMode = resolveEffectiveSpreadMode(
    spreadMode,
    viewportSize.width,
    viewportSize.height,
  );

  const containerRef = useRef<HTMLDivElement | null>(null);
  const runtimeRef = useRef<ReaderRuntime | null>(null);
  const fallbackSeriesIdRef = useRef<string | null>(null);
  const rendererHandleRef = useRef<ReaderCanvasHandle | null>(null);
  const epochRef = useRef(0);
  const isClosingRef = useRef(false);
  const isMountedRef = useRef(true);
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null);
  const suppressNextClickRef = useRef(false);
  const spreadHistoryRef = useRef<number[]>([]);
  const knownDimensionsRef = useRef<Map<number, PageDimensions>>(
    extractDimensionsFromFrames(initialSnapshot?.framesByPage),
  );
  const hasUserModifiedShaderRef = useRef(false);
  const openedFromIndexCacheRef = useRef(false);
  const hasAttemptedCacheRepairRef = useRef(false);
  const loadPageWindowRef = useRef<
    | ((
        runtime: ReaderRuntime,
        pageIndex: number,
        pageTotal: number,
        epoch: number,
        effectiveMode: EffectiveSpreadMode,
        offset: SpreadPageOffset,
      ) => Promise<void>)
    | null
  >(null);

  const totalPagesRef = useRef(totalPages);
  totalPagesRef.current = totalPages;
  const currentPageIndexRef = useRef(currentPageIndex);
  currentPageIndexRef.current = currentPageIndex;
  const archiveErrorRef = useRef(archiveError);
  archiveErrorRef.current = archiveError;
  const webglFatalErrorRef = useRef<ExtractedReaderError | null>(null);
  const isOpeningRef = useRef(isOpening);
  isOpeningRef.current = isOpening;
  const readingDirectionRef = useRef(readingDirection);
  readingDirectionRef.current = readingDirection;
  const spreadModeRef = useRef(spreadMode);
  spreadModeRef.current = spreadMode;
  const spreadPageOffsetRef = useRef(spreadPageOffset);
  spreadPageOffsetRef.current = spreadPageOffset;
  const viewportSizeRef = useRef(viewportSize);
  viewportSizeRef.current = viewportSize;
  const effectiveSpreadModeRef = useRef(effectiveSpreadMode);
  effectiveSpreadModeRef.current = effectiveSpreadMode;
  const shaderParamsRef = useRef(shaderParams);
  shaderParamsRef.current = shaderParams;
  const isShaderSheetOpenRef = useRef(isShaderSheetOpen);
  isShaderSheetOpenRef.current = isShaderSheetOpen;

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const canNavigatePages = useCallback((): boolean => {
    return (
      webglFatalErrorRef.current === null &&
      archiveErrorRef.current === null &&
      !isOpeningRef.current &&
      totalPagesRef.current > 0
    );
  }, []);

  const persistCurrentProgress = useCallback(() => {
    const runtime = runtimeRef.current;
    const total = totalPagesRef.current;
    if (
      initialSnapshot !== undefined ||
      runtime === null ||
      isOpeningRef.current ||
      total <= 0 ||
      archiveErrorRef.current !== null ||
      webglFatalErrorRef.current !== null
    ) {
      return;
    }

    const current = currentPageIndexRef.current;
    const offset = spreadPageOffsetRef.current;
    const confirmedMax = computeConfirmedMaxDisplayedPageIndex({
      currentPageIndex: current,
      totalPages: total,
      effectiveSpreadMode: effectiveSpreadModeRef.current,
      spreadPageOffset: offset,
      knownDimensions: knownDimensionsRef.current,
    });
    const readStatus: ReadStatus =
      confirmedMax >= total - 1 ? "completed" : "reading";

    const { activeSource } = runtime;
    if (activeSource.kind === "gdrive") {
      const now = Date.now();
      void readingProgressRepo
        .put({
          targetKey: activeSource.descriptor.progressTargetKey,
          volumeId: activeSource.descriptor.volumeId,
          currentPageIndex: current,
          totalPageCount: total,
          readStatus,
          spreadPageOffset: offset,
        })
        .catch((progressError: unknown) => {
          diagnosticLogger.warn(
            "reader",
            "読書進捗の保存に失敗しました",
            `${activeSource.displayLabel}: ${formatErrorMessage(progressError)}`,
          );
        });
      void seriesRepo
        .updateLastReadAt(activeSource.seriesId, now)
        .catch((seriesError: unknown) => {
          diagnosticLogger.warn(
            "reader",
            "シリーズ最終読書日時の更新に失敗しました",
            `${activeSource.seriesId}: ${formatErrorMessage(seriesError)}`,
          );
        });
      return;
    }

    void readingProgressRepo
      .put({
        targetKey: activeSource.descriptor.progressTargetKey,
        volumeId: null,
        currentPageIndex: current,
        totalPageCount: total,
        readStatus,
        spreadPageOffset: offset,
      })
      .catch((progressError: unknown) => {
        diagnosticLogger.warn(
          "reader",
          "読書進捗の保存に失敗しました",
          `${activeSource.displayLabel}: ${formatErrorMessage(progressError)}`,
        );
      });
  }, [initialSnapshot, readingProgressRepo, seriesRepo]);

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
      setIsHudOpen(false);
      isShaderSheetOpenRef.current = false;
      setIsShaderSheetOpen(false);
    },
    [],
  );

  const handleClose = useCallback(() => {
    if (isClosingRef.current) {
      return;
    }
    isClosingRef.current = true;
    persistCurrentProgress();
    releaseResources();
    if (isVolumeRoute) {
      exitReader(fallbackSeriesIdRef.current);
      return;
    }
    clearSession();
    back();
  }, [
    back,
    clearSession,
    exitReader,
    isVolumeRoute,
    persistCurrentProgress,
    releaseResources,
  ]);

  const handleCloseShaderSheet = useCallback(() => {
    isShaderSheetOpenRef.current = false;
    setIsShaderSheetOpen(false);
  }, []);

  const handleExitRequest = useCallback(() => {
    if (
      webglFatalErrorRef.current === null &&
      archiveErrorRef.current === null &&
      isShaderSheetOpenRef.current
    ) {
      handleCloseShaderSheet();
      return;
    }
    handleClose();
  }, [handleClose, handleCloseShaderSheet]);

  const handleOpenShaderSheet = useCallback(() => {
    setIsHudOpen(false);
    setShaderSaveStatus("idle");
    isShaderSheetOpenRef.current = true;
    setIsShaderSheetOpen(true);
  }, []);

  const applyShaderParams = useCallback((next: ShaderCorrectionParams) => {
    const normalized = normalizeShaderCorrectionParams(next);
    shaderParamsRef.current = normalized;
    setShaderParams(normalized);
  }, []);

  const handleChangeShaderParams = useCallback(
    (next: ShaderCorrectionParams) => {
      hasUserModifiedShaderRef.current = true;
      setShaderSaveStatus("idle");
      applyShaderParams(next);
    },
    [applyShaderParams],
  );

  const handleResetShaderParams = useCallback(() => {
    hasUserModifiedShaderRef.current = true;
    setShaderSaveStatus("idle");
    applyShaderParams(DEFAULT_SHADER_CORRECTION_PARAMS);
  }, [applyShaderParams]);

  const handleSaveDefaultShaderParams = useCallback(async () => {
    hasUserModifiedShaderRef.current = true;
    try {
      const saved = await readerSettingsRepo.saveShaderDefaults(
        shaderParamsRef.current,
      );
      if (!isMountedRef.current) {
        return;
      }
      applyShaderParams(saved);
      setShaderSaveStatus("saved");
    } catch (error) {
      if (!isMountedRef.current) {
        return;
      }
      diagnosticLogger.warn(
        "reader",
        "画質補正デフォルト設定の保存に失敗しました",
        formatErrorMessage(error),
      );
      setShaderSaveStatus("error");
    }
  }, [applyShaderParams, readerSettingsRepo]);

  useEffect(() => {
    onRegisterExit?.(handleExitRequest);
    return () => {
      onRegisterExit?.(null);
    };
  }, [onRegisterExit, handleExitRequest]);

  const applyOpenedArchiveAnchor = useCallback(
    (
      pageIndex: number,
      pageCount: number,
      spreadPageOffsetValue: SpreadPageOffset,
    ) => {
      spreadPageOffsetRef.current = spreadPageOffsetValue;
      setSpreadPageOffset(spreadPageOffsetValue);
      currentPageIndexRef.current = pageIndex;
      setCurrentPageIndex(pageIndex);
      totalPagesRef.current = pageCount;
      setTotalPages(pageCount);
      isOpeningRef.current = false;
      setIsOpening(false);
    },
    [],
  );

  const repairFromIndexCache = useCallback(
    async (
      runtime: ReaderRuntime,
      triggerCode: ZipErrorCode,
    ): Promise<void> => {
      hasAttemptedCacheRepairRef.current = true;
      openedFromIndexCacheRef.current = false;

      const repairEpoch = epochRef.current + 1;
      epochRef.current = repairEpoch;
      runtime.l1Cache.setMinActiveEpoch(repairEpoch);
      runtime.coordinator.api.cancelEpochBelow(repairEpoch);
      runtime.l1Cache.clear();
      rendererHandleRef.current?.clearAllTextures();
      knownDimensionsRef.current = new Map();
      setKnownDimensions(new Map());
      setFramesByPage({});
      spreadHistoryRef.current = [];
      isOpeningRef.current = true;
      setIsOpening(true);

      const descriptor = runtime.activeSource.descriptor;
      diagnosticLogger.warn(
        "reader",
        "古いまたは不整合な目次キャッシュを破棄してアーカイブを再解析します",
        `${descriptor.indexCacheKey}: ${triggerCode}`,
      );

      const isRepairActive = () =>
        runtimeRef.current === runtime && epochRef.current === repairEpoch;

      await deleteZipIndexCacheSafely(
        zipIndexCacheRepo,
        descriptor.indexCacheKey,
        isRepairActive,
      );

      if (!isRepairActive()) {
        return;
      }

      try {
        const result = await runtime.coordinator.api.openArchive(
          descriptor,
          null,
          repairEpoch,
        );
        if (!isRepairActive()) {
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
          "Central Directory解析でアーカイブを開きました",
          `${descriptor.indexCacheKey} (pages=${result.pageCount}, fromIndexCache=${String(result.fromIndexCache)})`,
        );

        persistZipIndexCacheSafely(
          zipIndexCacheRepo,
          descriptor.indexCacheKey,
          result.entries,
        );

        const { pageIndex: clampedPage, spreadPageOffset: clampedOffset } =
          clampAnchorForPageCount(
            currentPageIndexRef.current,
            spreadPageOffsetRef.current,
            result.pageCount,
          );

        applyOpenedArchiveAnchor(clampedPage, result.pageCount, clampedOffset);
        await loadPageWindowRef.current!(
          runtime,
          clampedPage,
          result.pageCount,
          repairEpoch,
          effectiveSpreadModeRef.current,
          clampedOffset,
        );
      } catch (repairError) {
        if (isAbortError(repairError) || !isRepairActive()) {
          return;
        }
        const extracted = extractReaderError(repairError);
        reportArchiveError(
          extracted,
          `${extracted.code}: ${runtime.activeSource.displayLabel}`,
        );
      }
    },
    [applyOpenedArchiveAnchor, reportArchiveError, zipIndexCacheRepo],
  );

  const fetchAndStorePages = useCallback(
    async (
      runtime: ReaderRuntime,
      targetPages: readonly number[],
      prefetchTargets: readonly number[],
      epoch: number,
      protectedPages: readonly number[],
      visiblePageIndices: readonly number[],
    ): Promise<DecodedPageFrame[]> => {
      let frames: DecodedPageFrame[];
      try {
        frames = await runtime.coordinator.api.requestVisiblePages(
          targetPages,
          prefetchTargets,
          epoch,
          { visiblePageIndices },
        );
      } catch (error) {
        if (
          isAbortError(error) ||
          runtimeRef.current !== runtime ||
          epoch !== epochRef.current
        ) {
          return [];
        }

        const extracted = extractReaderError(error);
        const pageErrorCode = PAGE_ERROR_CODE_MAP[extracted.code];
        if (
          isCacheRepairTriggerCode(pageErrorCode) &&
          !hasAttemptedCacheRepairRef.current &&
          openedFromIndexCacheRef.current
        ) {
          await repairFromIndexCache(runtime, pageErrorCode);
          return [];
        }

        const errorFrames: DecodedPageFrame[] = [];

        for (const targetPage of targetPages) {
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
          errorFrames.push(errorFrame);
        }

        return errorFrames;
      }

      if (runtimeRef.current !== runtime || epoch !== epochRef.current) {
        closeReadyFrames(frames);
        return [];
      }

      const repairTriggerFrame = findCacheRepairTriggerFrame(frames);
      if (
        repairTriggerFrame !== undefined &&
        !hasAttemptedCacheRepairRef.current &&
        openedFromIndexCacheRef.current
      ) {
        closeReadyFrames(frames);
        await repairFromIndexCache(runtime, repairTriggerFrame.errorCode);
        return [];
      }

      const acceptedFrames: DecodedPageFrame[] = [];
      let hasReadyFrame = false;
      for (const frame of frames) {
        if (!runtime.l1Cache.put(frame, protectedPages)) {
          continue;
        }
        if (frame.status === "ready") {
          knownDimensionsRef.current.set(frame.pageIndex, {
            width: frame.width,
            height: frame.height,
          });
          hasReadyFrame = true;
        } else {
          diagnosticLogger.error(
            "reader",
            getReaderErrorMessage(frame.errorCode),
            `${frame.errorCode}: page ${frame.pageIndex + 1} (${frame.message})`,
          );
        }
        acceptedFrames.push(frame);
      }
      if (hasReadyFrame) {
        setKnownDimensions(new Map(knownDimensionsRef.current));
      }

      return acceptedFrames;
    },
    [repairFromIndexCache],
  );

  const loadPageWindow = useCallback(
    async (
      runtime: ReaderRuntime,
      pageIndex: number,
      pageTotal: number,
      epoch: number,
      effectiveMode: EffectiveSpreadMode,
      offset: SpreadPageOffset,
    ): Promise<void> => {
      const candidatePages = getCandidateFetchPages({
        currentPageIndex: pageIndex,
        totalPages: pageTotal,
        effectiveSpreadMode: effectiveMode,
        spreadPageOffset: offset,
        knownDimensions: knownDimensionsRef.current,
      });

      const cachedFrames: Record<number, DecodedPageFrame> = {};
      const missingVisible: number[] = [];
      let cachedReadyUpdated = false;

      for (const candidatePage of candidatePages) {
        const cached = runtime.l1Cache.get(candidatePage);
        if (cached !== undefined) {
          cachedFrames[candidatePage] = cached;
          if (cached.status === "ready") {
            knownDimensionsRef.current.set(cached.pageIndex, {
              width: cached.width,
              height: cached.height,
            });
            cachedReadyUpdated = true;
          }
        } else {
          missingVisible.push(candidatePage);
        }
      }
      if (cachedReadyUpdated) {
        setKnownDimensions(new Map(knownDimensionsRef.current));
      }

      const scheduleVisibleWindowAndNeighbors = (
        includePrefetch: boolean,
        lookupFrame: (targetPageIndex: number) => DecodedPageFrame | undefined,
      ) => {
        const visiblePageIndices = resolveSortedVisiblePages({
          currentPageIndex: pageIndex,
          totalPages: pageTotal,
          effectiveSpreadMode: effectiveMode,
          readingDirection: readingDirectionRef.current,
          spreadPageOffset: offset,
          knownDimensions: knownDimensionsRef.current,
        });
        setFramesByPage(buildFramesRecord(visiblePageIndices, lookupFrame));

        const protectedPages = buildSpreadProtectedWindow(
          visiblePageIndices,
          effectiveMode,
          pageTotal,
        );
        const neighbors = buildSpreadNeighborTargets(
          visiblePageIndices,
          effectiveMode,
          pageTotal,
        );
        const prefetchTargets = includePrefetch
          ? buildSpreadPrefetchTargets(visiblePageIndices, pageTotal)
          : [];
        const missingNeighbors = collectMissingNeighbors(
          runtime.l1Cache,
          neighbors,
        );
        if (missingNeighbors.length > 0 || prefetchTargets.length > 0) {
          void fetchAndStorePages(
            runtime,
            missingNeighbors,
            prefetchTargets,
            epoch,
            protectedPages,
            visiblePageIndices,
          );
        }
      };

      if (missingVisible.length === 0) {
        scheduleVisibleWindowAndNeighbors(
          true,
          (targetPageIndex) => cachedFrames[targetPageIndex],
        );
        persistCurrentProgress();
        return;
      }

      setFramesByPage({});
      const preliminaryProtected = buildSpreadProtectedWindow(
        candidatePages,
        effectiveMode,
        pageTotal,
      );
      const preliminaryPrefetch = buildSpreadPrefetchTargets(
        candidatePages,
        pageTotal,
      );
      await fetchAndStorePages(
        runtime,
        missingVisible,
        preliminaryPrefetch,
        epoch,
        preliminaryProtected,
        candidatePages,
      );
      if (runtimeRef.current !== runtime || epoch !== epochRef.current) {
        return;
      }

      scheduleVisibleWindowAndNeighbors(false, (targetPageIndex) =>
        runtime.l1Cache.peek(targetPageIndex),
      );
      persistCurrentProgress();
    },
    [fetchAndStorePages, persistCurrentProgress],
  );
  loadPageWindowRef.current = loadPageWindow;

  const resyncCurrentWindow = useCallback(
    (
      pageIndex: number,
      effectiveMode: EffectiveSpreadMode,
      offset: SpreadPageOffset,
    ) => {
      if (!canNavigatePages()) {
        return;
      }
      const runtime = runtimeRef.current;
      if (runtime === null) {
        return;
      }
      const nextEpoch = epochRef.current + 1;
      epochRef.current = nextEpoch;
      runtime.l1Cache.setMinActiveEpoch(nextEpoch);
      runtime.coordinator.api.cancelEpochBelow(nextEpoch);
      void loadPageWindow(
        runtime,
        pageIndex,
        totalPagesRef.current,
        nextEpoch,
        effectiveMode,
        offset,
      );
    },
    [canNavigatePages, loadPageWindow],
  );

  useEffect(() => {
    if (!hasActiveReaderTarget || initialSnapshot?.viewportSize !== undefined) {
      return;
    }
    const container = containerRef.current as HTMLDivElement;

    const applyViewportSize = (entry?: ResizeObserverEntry) => {
      const nextSize = readViewportSize(container, entry);
      const prevSize = viewportSizeRef.current;
      if (
        prevSize.width === nextSize.width &&
        prevSize.height === nextSize.height
      ) {
        return;
      }
      viewportSizeRef.current = nextSize;
      setViewportSize(nextSize);

      const prevEffective = effectiveSpreadModeRef.current;
      const nextEffective = resolveEffectiveSpreadMode(
        spreadModeRef.current,
        nextSize.width,
        nextSize.height,
      );
      if (nextEffective !== prevEffective) {
        effectiveSpreadModeRef.current = nextEffective;
        if (nextEffective === "single") {
          spreadHistoryRef.current = [];
        }
        resyncCurrentWindow(
          currentPageIndexRef.current,
          nextEffective,
          spreadPageOffsetRef.current,
        );
      }
    };

    applyViewportSize();

    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver((entries) => {
        applyViewportSize(entries[0]);
      });
      observer.observe(container);
    }

    const handleWindowResize = () => {
      applyViewportSize();
    };
    window.addEventListener("resize", handleWindowResize);

    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", handleWindowResize);
    };
  }, [
    hasActiveReaderTarget,
    initialSnapshot?.viewportSize,
    resyncCurrentWindow,
  ]);

  useEffect(() => {
    if (!isVolumeRoute && session === null) {
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

    const openEpoch = epochRef.current + 1;
    epochRef.current = openEpoch;
    let isCancelled = false;
    let createdRuntime: ReaderRuntime | null = null;

    isOpeningRef.current = true;
    setIsOpening(true);
    archiveErrorRef.current = null;
    setArchiveError(null);
    fallbackSeriesIdRef.current = null;
    setFallbackSeriesId(null);
    isShaderSheetOpenRef.current = false;
    setIsShaderSheetOpen(false);
    setShaderSaveStatus("idle");
    hasUserModifiedShaderRef.current = false;
    openedFromIndexCacheRef.current = false;
    hasAttemptedCacheRepairRef.current = false;
    applyShaderParams(DEFAULT_SHADER_CORRECTION_PARAMS);
    spreadHistoryRef.current = [];
    knownDimensionsRef.current = new Map();
    setKnownDimensions(new Map());
    setFramesByPage({});
    spreadPageOffsetRef.current = 0;
    setSpreadPageOffset(0);
    currentPageIndexRef.current = 0;
    setCurrentPageIndex(0);
    totalPagesRef.current = 0;
    setTotalPages(0);

    const startArchiveRuntime = async (activeSource: ActiveReaderSource) => {
      const coordinator = createCoordinatorSession();
      const l1Cache = new L1PageCache({
        onEvictTexture: (evictedPageIndex) => {
          rendererHandleRef.current?.deletePageTexture(evictedPageIndex);
        },
      });
      const runtime: ReaderRuntime = { coordinator, l1Cache, activeSource };
      createdRuntime = runtime;
      runtimeRef.current = runtime;
      l1Cache.setMinActiveEpoch(openEpoch);

      const isCurrentRuntime = () => runtimeRef.current === runtime;
      const isCurrentAttempt = () =>
        isCurrentRuntime() && epochRef.current === openEpoch;

      void (async () => {
        const defaults = await readShaderDefaultsSafely(
          readerSettingsRepo,
          isCurrentRuntime,
        );
        if (
          defaults !== null &&
          isCurrentRuntime() &&
          !hasUserModifiedShaderRef.current
        ) {
          applyShaderParams(defaults);
        }
      })();

      const { descriptor } = activeSource;
      try {
        const cachedEntries = await readZipIndexCacheSafely(
          zipIndexCacheRepo,
          descriptor.indexCacheKey,
          isCurrentAttempt,
        );
        if (!isCurrentAttempt()) {
          return;
        }

        const progressPromise = readReadingProgressSafely(
          readingProgressRepo,
          descriptor.progressTargetKey,
          isCurrentAttempt,
        );
        const result = await coordinator.api.openArchive(
          descriptor,
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

        openedFromIndexCacheRef.current = result.fromIndexCache;

        diagnosticLogger.info(
          "reader",
          result.fromIndexCache
            ? "目次キャッシュからアーカイブを開きました (0RTT)"
            : "Central Directory解析でアーカイブを開きました",
          `${descriptor.indexCacheKey} (pages=${result.pageCount}, fromIndexCache=${String(result.fromIndexCache)})`,
        );

        if (!result.fromIndexCache) {
          persistZipIndexCacheSafely(
            zipIndexCacheRepo,
            descriptor.indexCacheKey,
            result.entries,
          );
        }

        const savedProgress = await progressPromise;
        if (!isCurrentAttempt()) {
          return;
        }

        const { pageIndex: restoredPage, spreadPageOffset: restoredOffset } =
          resolveRestoredProgressAnchor(savedProgress, result.pageCount);

        applyOpenedArchiveAnchor(
          restoredPage,
          result.pageCount,
          restoredOffset,
        );
        await loadPageWindow(
          runtime,
          restoredPage,
          result.pageCount,
          openEpoch,
          effectiveSpreadModeRef.current,
          restoredOffset,
        );
      } catch (error) {
        if (isAbortError(error) || !isCurrentAttempt()) {
          return;
        }
        const extracted = extractReaderError(error);
        reportArchiveError(
          extracted,
          `${extracted.code}: ${activeSource.displayLabel}`,
        );
      }
    };

    if (!isVolumeRoute) {
      const activeSession = session!;
      setDisplayTitle(activeSession.fileName);
      void startArchiveRuntime({
        kind: "local-session",
        descriptor: buildLocalArchiveSource(activeSession),
        displayLabel: activeSession.fileName,
      });
    } else {
      const targetVolumeId = volumeId!;
      setDisplayTitle("");
      const isPrevalidationActive = () =>
        !isCancelled &&
        epochRef.current === openEpoch &&
        webglFatalErrorRef.current === null;

      void (async () => {
        try {
          const volume = await volumesRepo.getById(targetVolumeId);
          if (!isPrevalidationActive()) {
            return;
          }
          if (volume === null) {
            reportArchiveError(
              {
                code: "VOLUME_NOT_FOUND",
                message: getReaderErrorMessage("VOLUME_NOT_FOUND"),
              },
              `VOLUME_NOT_FOUND: ${targetVolumeId}`,
            );
            return;
          }

          fallbackSeriesIdRef.current = volume.seriesId;
          setFallbackSeriesId(volume.seriesId);

          const roots = await driveSyncRootsRepo.listActive();
          if (!isPrevalidationActive()) {
            return;
          }
          const enabledRootIds = new Set(
            roots
              .filter((root) => root.enabled === 1)
              .map((root) => root.folderId),
          );
          if (
            volume.isTrashed === 1 ||
            !enabledRootIds.has(volume.rootFolderId)
          ) {
            reportArchiveError(
              {
                code: "VOLUME_UNAVAILABLE",
                message: getReaderErrorMessage("VOLUME_UNAVAILABLE"),
              },
              `VOLUME_UNAVAILABLE: ${volume.id}`,
            );
            return;
          }

          const authSession =
            googleAuthBridge.getCachedSession() ??
            (await googleAuthBridge.getSession());
          if (!isPrevalidationActive()) {
            return;
          }
          if (authSession === null) {
            reportArchiveError(
              {
                code: "AUTH_REQUIRED",
                message: getReaderErrorMessage("AUTH_REQUIRED"),
              },
              `AUTH_REQUIRED: ${volume.id}`,
            );
            return;
          }

          const activeSeries = await readActiveSeriesSafely(
            seriesRepo,
            volume.seriesId,
            isPrevalidationActive,
          );
          if (!isPrevalidationActive()) {
            return;
          }

          const resolvedTitle = formatDriveVolumeTitle(activeSeries, volume);
          setDisplayTitle(resolvedTitle);

          await startArchiveRuntime({
            kind: "gdrive",
            descriptor: buildDriveArchiveSource(volume),
            seriesId: volume.seriesId,
            displayLabel: resolvedTitle,
          });
        } catch (error) {
          if (!isPrevalidationActive()) {
            return;
          }
          const extracted = extractReaderError(error);
          reportArchiveError(extracted, `${extracted.code}: ${targetVolumeId}`);
        }
      })();
    }

    return () => {
      isCancelled = true;
      if (createdRuntime !== null && runtimeRef.current === createdRuntime) {
        releaseRuntime(createdRuntime);
      }
    };
  }, [
    isVolumeRoute,
    volumeId,
    session,
    initialSnapshot,
    applyOpenedArchiveAnchor,
    applyShaderParams,
    createCoordinatorSession,
    zipIndexCacheRepo,
    readingProgressRepo,
    readerSettingsRepo,
    volumesRepo,
    seriesRepo,
    driveSyncRootsRepo,
    googleAuthBridge,
    loadPageWindow,
    releaseRuntime,
    replace,
    reportArchiveError,
  ]);

  useEffect(() => {
    if (initialSnapshot !== undefined || !hasActiveReaderTarget) {
      return;
    }

    const cleanupIfLeftReaderRoute = () => {
      const windowPath = `${window.location.pathname}${window.location.search}`;
      const matched = matchRoute(windowPath);
      const leftReaderRoute = isVolumeRoute
        ? matched.name !== "reader-volume" || matched.volumeId !== volumeId
        : matched.name !== "reader-local";
      if (leftReaderRoute && !isClosingRef.current) {
        isClosingRef.current = true;
        persistCurrentProgress();
        releaseResources();
        if (!isVolumeRoute) {
          clearSession();
        }
      }
    };

    window.addEventListener("popstate", cleanupIfLeftReaderRoute);
    return () => {
      window.removeEventListener("popstate", cleanupIfLeftReaderRoute);
      cleanupIfLeftReaderRoute();
    };
  }, [
    clearSession,
    hasActiveReaderTarget,
    initialSnapshot,
    isVolumeRoute,
    persistCurrentProgress,
    releaseResources,
    volumeId,
  ]);

  useEffect(() => {
    if (initialSnapshot !== undefined || !hasActiveReaderTarget) {
      return;
    }

    const handlePageHide = () => {
      persistCurrentProgress();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        persistCurrentProgress();
      }
    };

    window.addEventListener("pagehide", handlePageHide);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("pagehide", handlePageHide);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [hasActiveReaderTarget, initialSnapshot, persistCurrentProgress]);

  const moveToPage = useCallback(
    (requestedIndex: number) => {
      const total = totalPagesRef.current;
      const clamped = Math.min(total - 1, Math.max(0, requestedIndex));
      currentPageIndexRef.current = clamped;
      setCurrentPageIndex(clamped);
      persistCurrentProgress();
      resyncCurrentWindow(
        clamped,
        effectiveSpreadModeRef.current,
        spreadPageOffsetRef.current,
      );
    },
    [persistCurrentProgress, resyncCurrentWindow],
  );

  const goNextPage = useCallback(() => {
    if (!canNavigatePages()) {
      return;
    }
    const total = totalPagesRef.current;
    const currentLayout = computeViewportSlotLayout({
      currentPageIndex: currentPageIndexRef.current,
      totalPages: total,
      effectiveSpreadMode: effectiveSpreadModeRef.current,
      readingDirection: readingDirectionRef.current,
      spreadPageOffset: spreadPageOffsetRef.current,
      knownDimensions: knownDimensionsRef.current,
    });
    const maxDisplayed = Math.max(
      ...currentLayout.slots.map((slot) => slot.pageIndex),
    );
    if (maxDisplayed >= total - 1) {
      return;
    }
    if (effectiveSpreadModeRef.current === "spread") {
      spreadHistoryRef.current.push(currentPageIndexRef.current);
    } else {
      spreadHistoryRef.current = [];
    }
    moveToPage(currentPageIndexRef.current + currentLayout.slots.length);
  }, [canNavigatePages, moveToPage]);

  const goPrevPage = useCallback(() => {
    if (!canNavigatePages() || currentPageIndexRef.current <= 0) {
      return;
    }
    if (effectiveSpreadModeRef.current === "single") {
      spreadHistoryRef.current = [];
      moveToPage(currentPageIndexRef.current - 1);
      return;
    }
    const popped = spreadHistoryRef.current.pop();
    const prevIndex =
      popped !== undefined
        ? popped
        : computePreviousAnchorIndex(
            currentPageIndexRef.current,
            effectiveSpreadModeRef.current,
            spreadPageOffsetRef.current,
            knownDimensionsRef.current,
          );
    moveToPage(prevIndex);
  }, [canNavigatePages, moveToPage]);

  const handleCycleSpreadMode = useCallback(() => {
    const prevEffective = effectiveSpreadModeRef.current;
    const nextMode = NEXT_SPREAD_MODE[spreadModeRef.current];
    const nextEffective = resolveEffectiveSpreadMode(
      nextMode,
      viewportSizeRef.current.width,
      viewportSizeRef.current.height,
    );
    spreadModeRef.current = nextMode;
    setSpreadMode(nextMode);
    if (nextEffective !== prevEffective) {
      effectiveSpreadModeRef.current = nextEffective;
      if (nextEffective === "single") {
        spreadHistoryRef.current = [];
      }
      resyncCurrentWindow(
        currentPageIndexRef.current,
        nextEffective,
        spreadPageOffsetRef.current,
      );
    }
  }, [resyncCurrentWindow]);

  const handleToggleSpreadPageOffset = useCallback(() => {
    if (
      !canNavigatePages() ||
      totalPagesRef.current <= 1 ||
      effectiveSpreadModeRef.current === "single"
    ) {
      return;
    }
    const nextOffset: SpreadPageOffset =
      spreadPageOffsetRef.current === 0 ? 1 : 0;
    const nextAnchor = computeShiftedAnchorOnOffsetToggle(
      currentPageIndexRef.current,
      nextOffset,
      totalPagesRef.current,
    );
    spreadHistoryRef.current = [];
    spreadPageOffsetRef.current = nextOffset;
    setSpreadPageOffset(nextOffset);
    currentPageIndexRef.current = nextAnchor;
    setCurrentPageIndex(nextAnchor);
    persistCurrentProgress();
    resyncCurrentWindow(nextAnchor, effectiveSpreadModeRef.current, nextOffset);
  }, [canNavigatePages, persistCurrentProgress, resyncCurrentWindow]);

  const handleCommitSeek = useCallback(
    (targetIndex: number) => {
      if (!canNavigatePages()) {
        return;
      }
      spreadHistoryRef.current = [];
      moveToPage(targetIndex);
    },
    [canNavigatePages, moveToPage],
  );

  const handleToggleReadingDirection = useCallback(() => {
    const nextDirection: ReadingDirection =
      readingDirectionRef.current === "rtl" ? "ltr" : "rtl";
    readingDirectionRef.current = nextDirection;
    setReadingDirection(nextDirection);
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const action = resolveDirectionActionForKey(
        event.key,
        readingDirectionRef.current,
      );
      if (action === "close") {
        event.preventDefault();
        handleExitRequest();
        return;
      }
      if (action === "next" || action === "prev") {
        if (
          event.target instanceof HTMLInputElement ||
          isShaderSheetOpenRef.current
        ) {
          return;
        }
        event.preventDefault();
        if (action === "next") {
          goNextPage();
        } else {
          goPrevPage();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [goNextPage, goPrevPage, handleExitRequest]);

  const handleTapAt = useCallback(
    (clientX: number, rect: DOMRect) => {
      if (
        webglFatalErrorRef.current !== null ||
        archiveErrorRef.current !== null
      ) {
        return;
      }
      const ratio = resolveTapRatio(clientX, rect);
      const action = resolveDirectionActionForTapRatio(
        ratio,
        readingDirectionRef.current,
      );
      if (action === "next") {
        goNextPage();
        return;
      }
      if (action === "prev") {
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
      const swipeAction = resolveDirectionActionForSwipe(
        dx,
        dy,
        readingDirectionRef.current,
      );
      if (swipeAction === "next") {
        goNextPage();
        return;
      }
      if (swipeAction === "prev") {
        goPrevPage();
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
      setIsHudOpen(false);
      isShaderSheetOpenRef.current = false;
      setIsShaderSheetOpen(false);
      const runtime = runtimeRef.current;
      if (runtime !== null) {
        releaseRuntime(runtime);
      }
    },
    [releaseRuntime],
  );

  if (!hasActiveReaderTarget) {
    return null;
  }

  const slotLayout = computeViewportSlotLayout({
    currentPageIndex,
    totalPages,
    effectiveSpreadMode,
    readingDirection,
    spreadPageOffset,
    knownDimensions,
  });
  const renderSlots: RenderSlotFrame[] = slotLayout.slots.map((slot) => ({
    slot,
    frame: framesByPage[slot.pageIndex] ?? null,
  }));
  const pageIndicatorText = formatPageIndicator(
    slotLayout.slots,
    totalPages,
    currentPageIndex,
  );
  const maxDisplayedPageIndex =
    slotLayout.slots.length > 0
      ? Math.max(...slotLayout.slots.map((slot) => slot.pageIndex))
      : currentPageIndex;

  const activeFatalError = webglFatalError ?? archiveError;
  const hasMissingSlotFrame =
    slotLayout.slots.length === 0 ||
    slotLayout.slots.some((slot) => framesByPage[slot.pageIndex] === undefined);
  const showLoading =
    activeFatalError === null && (isOpening || hasMissingSlotFrame);
  const pageErrors =
    activeFatalError === null && !showLoading
      ? buildPageErrorDescriptors(renderSlots, currentPageIndex)
      : [];
  const hudFileName =
    initialSnapshot?.displayTitle ??
    (isVolumeRoute ? displayTitle : session!.fileName);
  const archiveErrorBackLabel =
    initialSnapshot?.errorBackLabel ??
    (isVolumeRoute
      ? resolveErrorBackLabel(readerOriginState, fallbackSeriesId)
      : undefined);

  const isShaderSheetVisible = activeFatalError === null && isShaderSheetOpen;

  return (
    <div
      ref={containerRef}
      data-testid="reader-page"
      className="relative h-screen w-screen overflow-hidden bg-black select-none"
    >
      <div
        data-testid="reader-interaction-surface"
        inert={isShaderSheetVisible}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onClick={handleClick}
        className="relative h-full w-full touch-none"
      >
        <ReaderCanvas
          slots={renderSlots}
          shaderParams={shaderParams}
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

        {pageErrors.map((err) => (
          <ReaderErrorView
            key={err.key}
            mode="page"
            slotPosition={err.slotPosition}
            {...(err.pageNumber !== undefined
              ? { pageNumber: err.pageNumber }
              : {})}
            message={err.message}
            errorCode={err.errorCode}
          />
        ))}

        <ReaderHudOverlay
          isOpen={activeFatalError === null && isHudOpen}
          fileName={hudFileName}
          currentPageIndex={currentPageIndex}
          totalPages={totalPages}
          onClose={handleClose}
          onNextPage={goNextPage}
          onPrevPage={goPrevPage}
          readingDirection={readingDirection}
          spreadMode={spreadMode}
          effectiveSpreadMode={effectiveSpreadMode}
          spreadPageOffset={spreadPageOffset}
          pageIndicatorText={pageIndicatorText}
          maxDisplayedPageIndex={maxDisplayedPageIndex}
          onCycleSpreadMode={handleCycleSpreadMode}
          onToggleSpreadPageOffset={handleToggleSpreadPageOffset}
          onToggleReadingDirection={handleToggleReadingDirection}
          shaderModified={!isDefaultShaderParams(shaderParams)}
          onOpenShaderSheet={handleOpenShaderSheet}
          onCommitSeek={handleCommitSeek}
        />
      </div>

      <ReaderShaderSheet
        isOpen={isShaderSheetVisible}
        shaderParams={shaderParams}
        saveStatus={shaderSaveStatus}
        onChangeShaderParams={handleChangeShaderParams}
        onReset={handleResetShaderParams}
        onSaveDefault={handleSaveDefaultShaderParams}
        onClose={handleCloseShaderSheet}
      />

      {activeFatalError !== null && (
        <ReaderErrorView
          mode="archive"
          message={activeFatalError.message}
          errorCode={activeFatalError.code}
          {...(archiveErrorBackLabel !== undefined
            ? { backLabel: archiveErrorBackLabel }
            : {})}
          onBackToHome={handleClose}
        />
      )}
    </div>
  );
}
