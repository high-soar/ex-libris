import {
  type ChangeEvent,
  type DragEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useServices } from "../../app/serviceContext";
import type { GoogleAuthSession } from "../../bridges/oauth/types";
import { diagnosticLogger } from "../../diagnostics/diagnosticLogger";
import type { DriveSyncResult } from "../../providers/gdrive/types";
import {
  SETTINGS_ROUTE,
  buildReaderVolumePath,
  buildSeriesDetailPath,
} from "../../shared/router/routeMatcher";
import { useRouter } from "../../shared/router/routerContext";
import {
  type DriveSyncUiPhase,
  useDriveSyncStateStore,
} from "../../shared/sync/driveSyncStateStore";
import {
  type LocalReadingHistoryItem,
  RECENT_LOCAL_HISTORY_DEFAULT_LIMIT,
} from "../../storage/repositories/readingProgressRepository";
import { useLocalReaderSessionStore } from "../reader/localReaderSessionStore";
import { BookshelfHeader, type CopyStatus } from "./BookshelfHeader";
import { BookshelfToolbar } from "./BookshelfToolbar";
import {
  DriveSetupBanner,
  type DriveSetupBannerState,
} from "./DriveSetupBanner";
import { DriveSyncEmptyState } from "./DriveSyncEmptyState";
import { LocalArchiveEmptyState } from "./LocalArchiveEmptyState";
import { RecentLocalHistorySection } from "./RecentLocalHistorySection";
import { SeriesGridSection } from "./SeriesGridSection";
import { useBookshelfUiStateStore } from "./bookshelfUiStateStore";
import {
  type BookshelfSeriesCardItem,
  type BookshelfSortOrder,
  buildBookshelfSeriesItems,
  sortBookshelfSeriesItems,
} from "./bookshelfViewModel";

export interface BookshelfPageInitialSnapshot {
  readonly driveSetupState: DriveSetupBannerState;
  readonly seriesItems: readonly BookshelfSeriesCardItem[];
  readonly sortOrder?: BookshelfSortOrder;
  readonly syncPhase?: DriveSyncUiPhase;
  readonly lastSyncedAt?: number | null;
  readonly lastSyncResult?: DriveSyncResult | null;
  readonly syncErrorMessage?: string | null;
  readonly recentHistory?: readonly LocalReadingHistoryItem[];
  readonly copyStatus?: CopyStatus;
  readonly errorMessage?: string | null;
  readonly isDragActive?: boolean;
}

export interface BookshelfPageProps {
  readonly initialCopyStatus?: CopyStatus;
  readonly initialErrorMessage?: string | null;
  readonly initialDragActive?: boolean;
  readonly initialRecentHistory?: readonly LocalReadingHistoryItem[];
  readonly initialDriveSetupState?: DriveSetupBannerState;
  readonly initialSnapshot?: BookshelfPageInitialSnapshot;
}

const LOCAL_ARCHIVE_INPUT_ACCEPT =
  ".zip,.cbz,application/zip,application/x-zip-compressed,application/x-cbz,application/octet-stream";

const UNSUPPORTED_EXTENSION_MESSAGE =
  "対応形式は .zip または .cbz ファイルのみです";

function isSupportedArchiveFile(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return lower.endsWith(".zip") || lower.endsWith(".cbz");
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function BookshelfPage({
  initialCopyStatus = "idle",
  initialErrorMessage = null,
  initialDragActive = false,
  initialRecentHistory,
  initialDriveSetupState,
  initialSnapshot,
}: BookshelfPageProps) {
  const {
    readingProgressRepo,
    googleAuthBridge,
    driveSyncRootsRepo,
    seriesRepo,
    volumesRepo,
    driveSyncMetaRepo,
    driveSyncEngine,
  } = useServices();
  const { navigate } = useRouter();
  const openLocalFile = useLocalReaderSessionStore(
    (state) => state.openLocalFile,
  );
  const saveScrollY = useBookshelfUiStateStore((state) => state.saveScrollY);
  const clearScrollY = useBookshelfUiStateStore((state) => state.clearScrollY);
  const clearSeriesDetailScroll = useBookshelfUiStateStore(
    (state) => state.clearSeriesDetailScroll,
  );
  const storeSortOrder = useBookshelfUiStateStore((state) => state.sortOrder);
  const setStoreSortOrder = useBookshelfUiStateStore(
    (state) => state.setSortOrder,
  );

  const storeSyncPhase = useDriveSyncStateStore((state) => state.phase);
  const storeLastSyncedAt = useDriveSyncStateStore(
    (state) => state.lastSyncedAt,
  );
  const storeLastSyncResult = useDriveSyncStateStore(
    (state) => state.lastResult,
  );
  const storeSyncErrorMessage = useDriveSyncStateStore(
    (state) => state.errorMessage,
  );
  const completedSyncCount = useDriveSyncStateStore(
    (state) => state.completedSyncCount,
  );
  const hydrateLastSyncedAt = useDriveSyncStateStore(
    (state) => state.hydrateLastSyncedAt,
  );
  const runDriveSync = useDriveSyncStateStore((state) => state.runDriveSync);

  const hasSnapshot = initialSnapshot !== undefined;
  const resolvedInitialDriveSetup =
    initialSnapshot?.driveSetupState ?? initialDriveSetupState;
  const resolvedInitialRecentHistory =
    initialSnapshot?.recentHistory ?? initialRecentHistory;

  const [copyStatus, setCopyStatus] = useState<CopyStatus>(
    initialSnapshot?.copyStatus ?? initialCopyStatus,
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(
    initialSnapshot?.errorMessage ?? initialErrorMessage,
  );
  const [isDragActive, setIsDragActive] = useState<boolean>(
    initialSnapshot?.isDragActive ?? initialDragActive,
  );
  const [recentHistory, setRecentHistory] = useState<
    readonly LocalReadingHistoryItem[]
  >(resolvedInitialRecentHistory ?? []);
  const [driveSetupState, setDriveSetupState] = useState<DriveSetupBannerState>(
    () => resolvedInitialDriveSetup ?? { kind: "loading" },
  );
  const [seriesItems, setSeriesItems] = useState<
    readonly BookshelfSeriesCardItem[]
  >(() => initialSnapshot?.seriesItems ?? []);
  const [snapshotSortOrder, setSnapshotSortOrder] = useState<
    BookshelfSortOrder | undefined
  >(initialSnapshot?.sortOrder);

  const [isDriveSetupSettled, setIsDriveSetupSettled] = useState<boolean>(
    resolvedInitialDriveSetup !== undefined,
  );
  const [isRecentHistorySettled, setIsRecentHistorySettled] = useState<boolean>(
    resolvedInitialRecentHistory !== undefined,
  );
  const [isShelfDataSettled, setIsShelfDataSettled] =
    useState<boolean>(hasSnapshot);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const isMountedRef = useRef<boolean>(true);

  const activeSortOrder = snapshotSortOrder ?? storeSortOrder;
  const effectiveSyncPhase: DriveSyncUiPhase = hasSnapshot
    ? (initialSnapshot.syncPhase ?? "idle")
    : storeSyncPhase;
  const effectiveLastSyncedAt = hasSnapshot
    ? (initialSnapshot.lastSyncedAt ?? null)
    : storeLastSyncedAt;
  const effectiveLastSyncResult = hasSnapshot
    ? (initialSnapshot.lastSyncResult ?? null)
    : storeLastSyncResult;
  const effectiveSyncErrorMessage = hasSnapshot
    ? (initialSnapshot.syncErrorMessage ?? null)
    : storeSyncErrorMessage;
  const isSyncing = effectiveSyncPhase === "syncing";

  const sortedSeriesItems = useMemo(
    () => sortBookshelfSeriesItems(seriesItems, activeSortOrder),
    [activeSortOrder, seriesItems],
  );
  const totalVolumeCount = useMemo(
    () => sortedSeriesItems.reduce((sum, item) => sum + item.volumeCount, 0),
    [sortedSeriesItems],
  );

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const savedScrollY = useBookshelfUiStateStore.getState().scrollY;
    if (savedScrollY > 0) {
      window.scrollTo(0, savedScrollY);
    }
  }, []);

  useEffect(() => {
    if (
      !isDriveSetupSettled ||
      !isRecentHistorySettled ||
      !isShelfDataSettled
    ) {
      return;
    }
    const savedScrollY = useBookshelfUiStateStore.getState().scrollY;
    if (savedScrollY > 0) {
      window.scrollTo(0, savedScrollY);
      clearScrollY();
    }
  }, [
    clearScrollY,
    isDriveSetupSettled,
    isRecentHistorySettled,
    isShelfDataSettled,
  ]);

  useEffect(() => {
    if (hasSnapshot) {
      return;
    }
    void hydrateLastSyncedAt(driveSyncMetaRepo);
  }, [driveSyncMetaRepo, hasSnapshot, hydrateLastSyncedAt]);

  useEffect(() => {
    if (hasSnapshot) {
      return;
    }

    let cancelled = false;

    const loadShelfData = async (): Promise<void> => {
      try {
        const activeRoots = await driveSyncRootsRepo.listActive();
        const enabledRootIds = new Set(
          activeRoots
            .filter((root) => root.enabled === 1)
            .map((root) => root.folderId),
        );
        const [visibleVolumes, seriesList] = await Promise.all([
          volumesRepo.listVisibleByEnabledRoots(enabledRootIds),
          seriesRepo.listActive(),
        ]);
        const volumeIds = new Set(visibleVolumes.map((volume) => volume.id));
        const progressByVolumeId =
          await readingProgressRepo.listByVolumeIds(volumeIds);

        if (cancelled) {
          return;
        }
        setSeriesItems(
          buildBookshelfSeriesItems({
            seriesList,
            visibleVolumes,
            progressByVolumeId,
          }),
        );
        setIsShelfDataSettled(true);
      } catch (error: unknown) {
        if (cancelled) {
          return;
        }
        diagnosticLogger.warn(
          "bookshelf",
          "仮想本棚データの読み込みに失敗しました",
          formatErrorMessage(error),
        );
        setIsShelfDataSettled(true);
      }
    };

    void loadShelfData();

    return () => {
      cancelled = true;
    };
  }, [
    completedSyncCount,
    driveSyncRootsRepo,
    hasSnapshot,
    readingProgressRepo,
    seriesRepo,
    volumesRepo,
  ]);

  useEffect(() => {
    if (resolvedInitialRecentHistory !== undefined) {
      return;
    }

    let cancelled = false;
    void readingProgressRepo
      .listRecentLocal(RECENT_LOCAL_HISTORY_DEFAULT_LIMIT)
      .then((items) => {
        if (!cancelled) {
          setRecentHistory(items);
          setIsRecentHistorySettled(true);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          diagnosticLogger.warn(
            "bookshelf",
            "最近の閲覧履歴の取得に失敗しました",
            formatErrorMessage(error),
          );
          setIsRecentHistorySettled(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [readingProgressRepo, resolvedInitialRecentHistory]);

  useEffect(() => {
    if (resolvedInitialDriveSetup !== undefined) {
      setDriveSetupState(resolvedInitialDriveSetup);
      setIsDriveSetupSettled(true);
      return;
    }

    let isActive = true;
    let resolutionEpoch = 0;

    const resolveSetupForSession = async (
      session: GoogleAuthSession | null,
    ): Promise<void> => {
      resolutionEpoch += 1;
      const currentEpoch = resolutionEpoch;

      if (session === null) {
        setDriveSetupState({ kind: "unauthenticated" });
        setIsDriveSetupSettled(true);
        return;
      }

      try {
        const enabledCount = await driveSyncRootsRepo.countEnabled();
        if (!isActive || currentEpoch !== resolutionEpoch) {
          return;
        }
        setDriveSetupState(
          enabledCount > 0
            ? { kind: "ready" }
            : { kind: "no-roots", email: session.email },
        );
        setIsDriveSetupSettled(true);
      } catch (error: unknown) {
        if (!isActive || currentEpoch !== resolutionEpoch) {
          return;
        }
        diagnosticLogger.warn(
          "bookshelf",
          "Google Drive 連携状態の確認に失敗しました",
          formatErrorMessage(error),
        );
        setDriveSetupState({ kind: "no-roots", email: session.email });
        setIsDriveSetupSettled(true);
      }
    };

    const unsubscribe = googleAuthBridge.subscribeSession((nextSession) => {
      void resolveSetupForSession(nextSession);
    });

    const cachedSession = googleAuthBridge.getCachedSession();
    if (cachedSession !== null) {
      void resolveSetupForSession(cachedSession);
    } else {
      const initialEpoch = resolutionEpoch;
      void googleAuthBridge
        .getSession()
        .then((session) => {
          if (!isActive || resolutionEpoch !== initialEpoch) {
            return;
          }
          return resolveSetupForSession(session);
        })
        .catch((error: unknown) => {
          if (!isActive || resolutionEpoch !== initialEpoch) {
            return;
          }
          diagnosticLogger.warn(
            "bookshelf",
            "Google セッションの確認に失敗しました",
            formatErrorMessage(error),
          );
          setDriveSetupState({ kind: "unauthenticated" });
          setIsDriveSetupSettled(true);
        });
    }

    return () => {
      isActive = false;
      unsubscribe();
    };
  }, [driveSyncRootsRepo, googleAuthBridge, resolvedInitialDriveSetup]);

  const handleOpenSettings = useCallback(() => {
    saveScrollY(window.scrollY);
    navigate(SETTINGS_ROUTE.path);
  }, [navigate, saveScrollY]);

  const handleSyncDrive = useCallback(() => {
    if (driveSetupState.kind !== "ready") {
      return;
    }
    void runDriveSync({ driveSyncEngine });
  }, [driveSetupState.kind, driveSyncEngine, runDriveSync]);

  const handleChangeSortOrder = useCallback(
    (nextOrder: BookshelfSortOrder) => {
      setSnapshotSortOrder(undefined);
      setStoreSortOrder(nextOrder);
    },
    [setStoreSortOrder],
  );

  const handleOpenSeriesDetail = useCallback(
    (seriesId: string) => {
      saveScrollY(window.scrollY);
      clearSeriesDetailScroll();
      navigate(buildSeriesDetailPath(seriesId));
    },
    [clearSeriesDetailScroll, navigate, saveScrollY],
  );

  const handleQuickRead = useCallback(
    (seriesId: string, volumeId: string) => {
      saveScrollY(window.scrollY);
      navigate(buildReaderVolumePath(volumeId), {
        readerOrigin: "bookshelf",
        seriesId,
      });
    },
    [navigate, saveScrollY],
  );

  const handleOpenLocalZip = useCallback(() => {
    (fileInputRef.current as HTMLInputElement).click();
  }, []);

  const handleSelectedFile = useCallback(
    (file: File | undefined) => {
      if (!file) {
        return;
      }

      if (!isSupportedArchiveFile(file.name)) {
        setErrorMessage(UNSUPPORTED_EXTENSION_MESSAGE);
        diagnosticLogger.warn(
          "bookshelf",
          "Unsupported archive extension",
          file.name,
        );
        return;
      }

      setErrorMessage(null);
      clearScrollY();
      openLocalFile(file);
      navigate("/read/local");
    },
    [clearScrollY, navigate, openLocalFile],
  );

  const handleFileChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      handleSelectedFile(file);
    },
    [handleSelectedFile],
  );

  const handleDragOver = useCallback((event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    setIsDragActive(true);
  }, []);

  const handleDragLeave = useCallback((event: DragEvent<HTMLElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setIsDragActive(false);
    }
  }, []);

  const handleDrop = useCallback(
    (event: DragEvent<HTMLElement>) => {
      event.preventDefault();
      setIsDragActive(false);
      handleSelectedFile(event.dataTransfer.files?.[0]);
    },
    [handleSelectedFile],
  );

  const handleCopyDiagnostics = useCallback(async () => {
    const report = diagnosticLogger.formatReport();
    if (!navigator.clipboard) {
      setCopyStatus("failed");
      return;
    }

    try {
      await navigator.clipboard.writeText(report);
      setCopyStatus("copied");
    } catch {
      setCopyStatus("failed");
    }
  }, []);

  const runMountedHistoryMutation = useCallback(
    async (
      operation: () => Promise<void>,
      onSuccess: () => void,
      warnMessage: string,
      warnDetailPrefix?: string,
    ) => {
      try {
        await operation();
        if (!isMountedRef.current) {
          return;
        }
        onSuccess();
      } catch (error) {
        if (!isMountedRef.current) {
          return;
        }
        const message = formatErrorMessage(error);
        diagnosticLogger.warn(
          "bookshelf",
          warnMessage,
          warnDetailPrefix === undefined
            ? message
            : `${warnDetailPrefix}: ${message}`,
        );
      }
    },
    [],
  );

  const handleDeleteHistoryItem = useCallback(
    (targetKey: string) =>
      runMountedHistoryMutation(
        () => readingProgressRepo.delete(targetKey),
        () =>
          setRecentHistory((prev) =>
            prev.filter((item) => item.targetKey !== targetKey),
          ),
        "閲覧履歴の削除に失敗しました",
        targetKey,
      ),
    [readingProgressRepo, runMountedHistoryMutation],
  );

  const handleClearHistory = useCallback(
    () =>
      runMountedHistoryMutation(
        () => readingProgressRepo.clearLocal(),
        () => setRecentHistory([]),
        "閲覧履歴のクリアに失敗しました",
      ),
    [readingProgressRepo, runMountedHistoryMutation],
  );

  const isInitialLoading =
    !isShelfDataSettled || driveSetupState.kind === "loading";
  const hasVisibleSeries = sortedSeriesItems.length > 0;
  const isBranchA = !isInitialLoading && hasVisibleSeries;
  const isBranchB =
    !isInitialLoading && !hasVisibleSeries && driveSetupState.kind === "ready";
  const isBranchC =
    !isInitialLoading && !hasVisibleSeries && driveSetupState.kind !== "ready";
  const hasSyncError =
    effectiveSyncErrorMessage !== null && effectiveSyncErrorMessage.length > 0;

  return (
    <div
      data-testid="bookshelf-page"
      className="min-h-screen bg-slate-950 text-slate-100 flex flex-col"
    >
      <BookshelfHeader
        copyStatus={copyStatus}
        canSync={driveSetupState.kind === "ready"}
        isSyncing={isSyncing}
        onSyncDrive={handleSyncDrive}
        onCopyDiagnostics={handleCopyDiagnostics}
        onOpenLocalZip={handleOpenLocalZip}
        onOpenSettings={handleOpenSettings}
      />
      <main
        data-drag-active={String(isDragActive)}
        className={`flex-1 flex flex-col items-center gap-6 p-4 sm:p-6 transition-colors ${
          isBranchA ? "justify-start" : "justify-center"
        } ${isDragActive ? "ring-2 ring-inset ring-indigo-400/70 bg-indigo-950/15" : ""}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <DriveSetupBanner
          state={driveSetupState}
          onOpenSettings={handleOpenSettings}
        />

        {errorMessage !== null && !isBranchC && (
          <p
            role="alert"
            data-testid="local-zip-error"
            className="w-full max-w-6xl rounded-xl border border-rose-500/40 bg-rose-950/50 px-4 py-2.5 text-xs font-medium text-rose-300"
          >
            {errorMessage}
          </p>
        )}

        {hasSyncError && !isBranchA && (
          <p
            role="alert"
            data-testid="bookshelf-sync-error"
            className="w-full max-w-6xl rounded-xl border border-rose-500/40 bg-rose-950/50 px-4 py-2.5 text-xs font-medium text-rose-300"
          >
            {effectiveSyncErrorMessage}
          </p>
        )}

        {isInitialLoading && (
          <div
            data-testid="bookshelf-loading"
            role="status"
            className="flex flex-col items-center gap-3 py-12 text-sm text-slate-400"
          >
            <span className="h-6 w-6 animate-spin rounded-full border-2 border-indigo-400 border-t-transparent" />
            <span>本棚を読み込み中...</span>
          </div>
        )}

        {isBranchA && (
          <div className="flex w-full max-w-6xl flex-col gap-5">
            <BookshelfToolbar
              seriesCount={sortedSeriesItems.length}
              totalVolumeCount={totalVolumeCount}
              sortOrder={activeSortOrder}
              lastSyncedAt={effectiveLastSyncedAt}
              lastSyncResult={effectiveLastSyncResult}
              syncErrorMessage={effectiveSyncErrorMessage}
              onChangeSortOrder={handleChangeSortOrder}
            />
            <SeriesGridSection
              items={sortedSeriesItems}
              onOpenDetail={handleOpenSeriesDetail}
              onQuickRead={handleQuickRead}
            />
          </div>
        )}

        {isBranchB && (
          <DriveSyncEmptyState
            isSyncing={isSyncing}
            isDragActive={isDragActive}
            onSyncDrive={handleSyncDrive}
            onOpenLocalZip={handleOpenLocalZip}
          />
        )}

        {isBranchC && (
          <LocalArchiveEmptyState
            isDragActive={isDragActive}
            errorMessage={errorMessage}
            onOpenLocalZip={handleOpenLocalZip}
          />
        )}

        <RecentLocalHistorySection
          items={recentHistory}
          onReopenLocalFile={handleOpenLocalZip}
          onDeleteItem={handleDeleteHistoryItem}
          onClearAll={handleClearHistory}
        />
        <input
          ref={fileInputRef}
          type="file"
          data-testid="local-zip-file-input"
          accept={LOCAL_ARCHIVE_INPUT_ACCEPT}
          className="hidden"
          onChange={handleFileChange}
        />
      </main>
    </div>
  );
}
