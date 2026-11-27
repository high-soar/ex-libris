import { composeStories } from "@storybook/react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type MockInstance,
  vi,
} from "vitest";
import {
  ServiceContext,
  type ServiceContextValue,
} from "../../app/serviceContext";
import type {
  AuthSessionListener,
  GoogleAuthBridge,
  GoogleAuthSession,
} from "../../bridges/oauth/types";
import type {
  CoverExtractionScheduler,
  CoverExtractionVolumeUpdateEvent,
} from "../../engine/cover/types";
import { diagnosticLogger } from "../../diagnostics/diagnosticLogger";
import {
  RouterContext,
  type RouterContextValue,
} from "../../shared/router/routerContext";
import { INITIAL_COVER_EXTRACTION_SNAPSHOT } from "../../shared/sync/coverExtractionStateStore";
import {
  resetDriveSyncState,
  useDriveSyncStateStore,
} from "../../shared/sync/driveSyncStateStore";
import * as ViewportObserverModule from "../../shared/ui/useViewportVolumeObserver";
import type {
  DriveSyncRootRecord,
  ReadingProgressRecord,
  SeriesRecord,
  VolumeRecord,
} from "../../storage/types";
import {
  resetBookshelfUiState,
  useBookshelfUiStateStore,
} from "../bookshelf/bookshelfUiStateStore";
import * as SeriesDetailEmptyStateModule from "./SeriesDetailEmptyState";
import * as SeriesDetailHeaderModule from "./SeriesDetailHeader";
import { SeriesDetailPage } from "./SeriesDetailPage";
import * as stories from "./SeriesDetailPage.stories";
import * as SeriesSummaryCardModule from "./SeriesSummaryCard";
import * as SeriesVolumeListSectionModule from "./SeriesVolumeListSection";

const { Ready, Loading, Empty, WithCoverErrors } = composeStories(stories);

function createSeries(overrides: Partial<SeriesRecord> = {}): SeriesRecord {
  return {
    id: "series-1",
    title: "ダンジョン飯",
    titleReading: "だんじょんめし",
    authors: ["九井諒子"],
    publisher: "",
    label: "",
    tags: [],
    synopsis: "",
    publicationStatus: "unknown",
    knownTotalVolumes: null,
    externalIds: {},
    metadataLocked: false,
    representativeVolumeId: "vol-1",
    readerPresetJson: null,
    lastReadAt: null,
    addedAt: 1_730_000_000_000,
    updatedAt: 1_730_000_000_000,
    deletedAt: null,
    ...overrides,
  };
}

function createVolume(overrides: Partial<VolumeRecord> = {}): VolumeRecord {
  return {
    id: "vol-1",
    seriesId: "series-1",
    volumeNumber: 1,
    volumeLabel: "第01巻",
    rawFileName: "ダンジョン飯 第01巻.zip",
    driveFileId: "drive-1",
    parentFolderId: "root-1",
    rootFolderId: "root-1",
    fileSize: 1024 * 1024 * 40,
    md5Checksum: "md5-1",
    driveModifiedTime: 1_730_000_000_000,
    coverBlob: null,
    coverStatus: "pending",
    coverCropMode: "auto",
    coverPageIndex: 0,
    coverUpdatedAt: null,
    isTrashed: 0,
    addedAt: 1_730_000_000_000,
    updatedAt: 1_730_000_000_000,
    ...overrides,
  };
}

function createRoot(
  overrides: Partial<DriveSyncRootRecord> = {},
): DriveSyncRootRecord {
  return {
    folderId: "root-1",
    folderName: "Comics",
    enabled: 1,
    addedAt: 1_730_000_000_000,
    updatedAt: 1_730_000_000_000,
    deletedAt: null,
    ...overrides,
  };
}

function createMockGoogleAuthBridge(
  overrides: Partial<GoogleAuthBridge> = {},
): GoogleAuthBridge & {
  emitSession: (session: GoogleAuthSession | null) => void;
} {
  const listeners = new Set<AuthSessionListener>();
  return {
    getCachedSession: vi.fn(() => null),
    getSession: vi.fn(async () => null),
    signIn: vi.fn(),
    signOut: vi.fn(async () => undefined),
    getValidAccessToken: vi.fn(async () => "ya29.mock"),
    subscribeSession: vi.fn((listener: AuthSessionListener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    }),
    emitSession: (session: GoogleAuthSession | null) => {
      for (const listener of [...listeners]) {
        listener(session);
      }
    },
    ...overrides,
  };
}

function createMockCoverExtractionScheduler(
  overrides: Partial<CoverExtractionScheduler> = {},
): CoverExtractionScheduler & {
  emitVolumeUpdated: (event: CoverExtractionVolumeUpdateEvent) => void;
} {
  const volumeListeners = new Set<
    (event: CoverExtractionVolumeUpdateEvent) => void
  >();
  return {
    syncQueue: vi.fn(async () => undefined),
    setViewportVolumeIds: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    retryFailedCovers: vi.fn(async () => 0),
    getSnapshot: vi.fn(() => INITIAL_COVER_EXTRACTION_SNAPSHOT),
    subscribeProgress: vi.fn(() => () => undefined),
    subscribeVolumeUpdated: vi.fn((listener) => {
      volumeListeners.add(listener);
      return () => {
        volumeListeners.delete(listener);
      };
    }),
    emitVolumeUpdated: (event) => {
      for (const listener of [...volumeListeners]) {
        listener(event);
      }
    },
    resetForTest: vi.fn(async () => undefined),
    dispose: vi.fn(),
    ...overrides,
  };
}

function createMockServices(
  overrides: Partial<ServiceContextValue> = {},
): ServiceContextValue {
  return {
    googleAuthBridge: createMockGoogleAuthBridge(),
    seriesRepo: {
      getById: vi.fn().mockResolvedValue(createSeries()),
      listActive: vi.fn().mockResolvedValue([]),
      findOrCreateByParsedTitle: vi.fn(),
      mergeAuthorsIfUnlocked: vi.fn(),
      updateLastReadAt: vi.fn(),
    },
    volumesRepo: {
      getById: vi.fn(),
      getByDriveFileId: vi.fn(),
      listBySeriesId: vi.fn().mockResolvedValue([createVolume()]),
      listVisibleByRootIds: vi.fn().mockResolvedValue([]),
      upsertByDriveFileId: vi.fn(),
      markTrashedByDriveFileId: vi.fn(),
      markTrashedMissingInRoot: vi.fn(),
      listPendingCovers: vi.fn(),
      updateCover: vi.fn(),
    },
    driveSyncRootsRepo: {
      listActive: vi.fn().mockResolvedValue([createRoot()]),
      countEnabled: vi.fn().mockResolvedValue(1),
      upsertRoot: vi.fn(),
      setEnabled: vi.fn(),
      removeRoot: vi.fn(),
    },
    readingProgressRepo: {
      get: vi.fn().mockResolvedValue(null),
      put: vi.fn().mockResolvedValue(undefined),
      listByVolumeIds: vi.fn().mockResolvedValue(new Map()),
      listRecentLocal: vi.fn().mockResolvedValue([]),
      delete: vi.fn().mockResolvedValue(undefined),
      clearLocal: vi.fn().mockResolvedValue(undefined),
    },
    coverExtractionScheduler: createMockCoverExtractionScheduler(),
    ...overrides,
  } as unknown as ServiceContextValue;
}

function createMockRouter(
  overrides: Partial<RouterContextValue> = {},
): RouterContextValue {
  return {
    currentPath: "/series/series-1",
    route: {
      name: "series-detail",
      path: "/series/series-1",
      seriesId: "series-1",
    },
    readerOriginState: {
      readerOrigin: null,
      seriesId: null,
      canGoBackFrom: "/",
    },
    navigate: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    exitReader: vi.fn(),
    isBackBlocked: false,
    setBackBlocked: vi.fn(),
    ...overrides,
  };
}

describe("SeriesDetailPage", () => {
  let headerSpy: MockInstance<
    typeof SeriesDetailHeaderModule.SeriesDetailHeader
  >;
  let summarySpy: MockInstance<
    typeof SeriesSummaryCardModule.SeriesSummaryCard
  >;
  let volumeListSpy: MockInstance<
    typeof SeriesVolumeListSectionModule.SeriesVolumeListSection
  >;
  let emptyStateSpy: MockInstance<
    typeof SeriesDetailEmptyStateModule.SeriesDetailEmptyState
  >;
  let viewportObserverSpy: MockInstance<
    typeof ViewportObserverModule.useViewportVolumeObserver
  >;

  beforeEach(() => {
    diagnosticLogger.clear();
    resetBookshelfUiState();
    resetDriveSyncState();
    headerSpy = vi
      .spyOn(SeriesDetailHeaderModule, "SeriesDetailHeader")
      .mockImplementation(() => null);
    summarySpy = vi
      .spyOn(SeriesSummaryCardModule, "SeriesSummaryCard")
      .mockImplementation(() => null);
    volumeListSpy = vi
      .spyOn(SeriesVolumeListSectionModule, "SeriesVolumeListSection")
      .mockImplementation(() => null);
    emptyStateSpy = vi
      .spyOn(SeriesDetailEmptyStateModule, "SeriesDetailEmptyState")
      .mockImplementation(() => null);
    viewportObserverSpy = vi.spyOn(
      ViewportObserverModule,
      "useViewportVolumeObserver",
    );
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    resetBookshelfUiState();
    resetDriveSyncState();
  });

  it("全Storybookストーリーを同期initialSnapshotで決定論的に描画し、直下子コンポーネントを分離配線する (AC-SD-06)", () => {
    const { unmount: unmountReady } = render(<Ready />);
    expect(screen.getByTestId("series-detail-page")).toBeInTheDocument();
    expect(screen.queryByTestId("series-detail-loading")).toBeNull();
    expect(headerSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "ダンジョン飯",
        onBack: expect.any(Function),
      }),
      undefined,
    );
    expect(summarySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "ダンジョン飯",
        volumeCount: 3,
        completedCount: 1,
        onQuickRead: expect.any(Function),
      }),
      undefined,
    );
    expect(volumeListSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        volumes: expect.arrayContaining([
          expect.objectContaining({ isOmnibus: true }),
        ]),
        onSelectVolume: expect.any(Function),
      }),
      undefined,
    );
    expect(emptyStateSpy).not.toHaveBeenCalled();
    unmountReady();

    headerSpy.mockClear();
    summarySpy.mockClear();
    volumeListSpy.mockClear();
    emptyStateSpy.mockClear();
    const { unmount: unmountLoading } = render(<Loading />);
    expect(screen.getByTestId("series-detail-loading")).toBeInTheDocument();
    expect(summarySpy).not.toHaveBeenCalled();
    expect(volumeListSpy).not.toHaveBeenCalled();
    expect(emptyStateSpy).not.toHaveBeenCalled();
    unmountLoading();

    headerSpy.mockClear();
    emptyStateSpy.mockClear();
    render(<Empty />);
    expect(screen.queryByTestId("series-detail-loading")).toBeNull();
    expect(emptyStateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ onBack: expect.any(Function) }),
      undefined,
    );
    expect(summarySpy).not.toHaveBeenCalled();
    expect(volumeListSpy).not.toHaveBeenCalled();
  });

  it("初回読込中はローディング表示のみ行い、完了後にIndexedDB結果からサマリ・巻一覧を描画しTR-04/TR-05遷移とスクロール保存を実行する (AC-SD-01, AC-SD-02, AC-SD-03, AC-SD-05)", async () => {
    const progress: ReadingProgressRecord = {
      targetKey: "vol:vol-1",
      volumeId: "vol-1",
      currentPageIndex: 10,
      totalPageCount: 100,
      readStatus: "reading",
      spreadPageOffset: 0,
      lastReadAt: 1_730_000_500_000,
      updatedAt: 1_730_000_500_000,
    };
    const services = createMockServices({
      readingProgressRepo: {
        get: vi.fn(),
        put: vi.fn(),
        listByVolumeIds: vi
          .fn()
          .mockResolvedValue(new Map([["vol-1", progress]])),
        listRecentLocal: vi.fn(),
        delete: vi.fn(),
        clearLocal: vi.fn(),
      },
    });
    const router = createMockRouter();

    render(
      <ServiceContext.Provider value={services}>
        <RouterContext.Provider value={router}>
          <SeriesDetailPage seriesId="series-1" />
        </RouterContext.Provider>
      </ServiceContext.Provider>,
    );

    // 初回解決前はローディング境界（エンプティ誤表示しない）
    expect(screen.getByTestId("series-detail-loading")).toBeInTheDocument();
    expect(emptyStateSpy).not.toHaveBeenCalled();

    await waitFor(() => {
      expect(summarySpy).toHaveBeenCalled();
    });
    expect(screen.queryByTestId("series-detail-loading")).toBeNull();
    expect(services.readingProgressRepo.listByVolumeIds).toHaveBeenCalledWith(
      new Set(["vol-1"]),
    );

    // TR-04: スクロール位置を保存して /read/volume/:volumeId へ遷移
    Object.defineProperty(window, "scrollY", {
      value: 420,
      configurable: true,
    });
    const summaryProps = summarySpy.mock.calls.at(-1)![0];
    act(() => {
      summaryProps.onQuickRead("vol-1");
    });
    expect(useBookshelfUiStateStore.getState().seriesDetailScroll).toEqual({
      seriesId: "series-1",
      scrollY: 420,
    });
    expect(router.navigate).toHaveBeenCalledWith("/read/volume/vol-1", {
      readerOrigin: "series-detail",
      seriesId: "series-1",
    });

    // TR-05: ヘッダー戻るで router.back()
    const headerProps = headerSpy.mock.calls.at(-1)![0];
    act(() => {
      headerProps.onBack();
    });
    expect(router.back).toHaveBeenCalledTimes(1);
  });

  it("Tombstone（deletedAt !== null）や有効巻0件・DB読込例外時はエンプティ案内を表示し警告ログを記録する (AC-SD-04)", async () => {
    const router = createMockRouter();

    // 1. Tombstone シリーズは除外して empty 扱い（進捗一括取得は呼ばない）
    const tombstoneServices = createMockServices({
      seriesRepo: {
        getById: vi
          .fn()
          .mockResolvedValue(createSeries({ deletedAt: 1_730_000_999_000 })),
        listActive: vi.fn(),
        findOrCreateByParsedTitle: vi.fn(),
        mergeAuthorsIfUnlocked: vi.fn(),
        updateLastReadAt: vi.fn(),
      },
    });
    const { unmount: unmountTombstone } = render(
      <ServiceContext.Provider value={tombstoneServices}>
        <RouterContext.Provider value={router}>
          <SeriesDetailPage seriesId="series-1" />
        </RouterContext.Provider>
      </ServiceContext.Provider>,
    );
    await waitFor(() => {
      expect(emptyStateSpy).toHaveBeenCalled();
    });
    expect(
      tombstoneServices.readingProgressRepo.listByVolumeIds,
    ).not.toHaveBeenCalled();
    unmountTombstone();

    // 2. 無効ルートのみ（visibleVolumes 0件）
    emptyStateSpy.mockClear();
    const disabledRootServices = createMockServices({
      driveSyncRootsRepo: {
        listActive: vi.fn().mockResolvedValue([createRoot({ enabled: 0 })]),
        countEnabled: vi.fn().mockResolvedValue(0),
        upsertRoot: vi.fn(),
        setEnabled: vi.fn(),
        removeRoot: vi.fn(),
      },
    });
    const { unmount: unmountDisabled } = render(
      <ServiceContext.Provider value={disabledRootServices}>
        <RouterContext.Provider value={router}>
          <SeriesDetailPage seriesId="series-1" />
        </RouterContext.Provider>
      </ServiceContext.Provider>,
    );
    await waitFor(() => {
      expect(emptyStateSpy).toHaveBeenCalled();
    });
    unmountDisabled();

    // 3. IndexedDB 読込例外（Error と非 Error の双方）
    emptyStateSpy.mockClear();
    const errorServices = createMockServices({
      seriesRepo: {
        getById: vi.fn().mockRejectedValue(new Error("IndexedDB read failed")),
        listActive: vi.fn(),
        findOrCreateByParsedTitle: vi.fn(),
        mergeAuthorsIfUnlocked: vi.fn(),
        updateLastReadAt: vi.fn(),
      },
    });
    const { unmount: unmountError } = render(
      <ServiceContext.Provider value={errorServices}>
        <RouterContext.Provider value={router}>
          <SeriesDetailPage seriesId="series-1" />
        </RouterContext.Provider>
      </ServiceContext.Provider>,
    );
    await waitFor(() => {
      expect(emptyStateSpy).toHaveBeenCalled();
    });
    expect(diagnosticLogger.getEntries()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: "warn",
          scope: "series-detail",
        }),
      ]),
    );
    unmountError();

    emptyStateSpy.mockClear();
    const stringErrorServices = createMockServices({
      seriesRepo: {
        getById: vi.fn().mockRejectedValue("plain-db-error"),
        listActive: vi.fn(),
        findOrCreateByParsedTitle: vi.fn(),
        mergeAuthorsIfUnlocked: vi.fn(),
        updateLastReadAt: vi.fn(),
      },
    });
    render(
      <ServiceContext.Provider value={stringErrorServices}>
        <RouterContext.Provider value={router}>
          <SeriesDetailPage seriesId="series-1" />
        </RouterContext.Provider>
      </ServiceContext.Provider>,
    );
    await waitFor(() => {
      expect(emptyStateSpy).toHaveBeenCalled();
    });
  });

  it("isSettled時に一致seriesIdのスクロール位置を復元して消費クリアし、不一致や0以下でも未消費状態をクリアする (AC-SD-03)", async () => {
    const scrollToSpy = vi
      .spyOn(window, "scrollTo")
      .mockImplementation(() => {});
    const router = createMockRouter();

    // 一致 seriesId かつ scrollY > 0 -> scrollTo 実行＋クリア
    useBookshelfUiStateStore.getState().saveSeriesDetailScroll("series-1", 320);
    const { unmount: unmountMatch } = render(
      <ServiceContext.Provider value={createMockServices()}>
        <RouterContext.Provider value={router}>
          <SeriesDetailPage seriesId="series-1" />
        </RouterContext.Provider>
      </ServiceContext.Provider>,
    );
    await waitFor(() => {
      expect(scrollToSpy).toHaveBeenCalledWith(0, 320);
    });
    expect(useBookshelfUiStateStore.getState().seriesDetailScroll).toBeNull();
    unmountMatch();

    // 不一致 seriesId -> scrollTo せずクリアのみ
    scrollToSpy.mockClear();
    useBookshelfUiStateStore
      .getState()
      .saveSeriesDetailScroll("other-series", 500);
    const { unmount: unmountMismatch } = render(
      <ServiceContext.Provider value={createMockServices()}>
        <RouterContext.Provider value={router}>
          <SeriesDetailPage seriesId="series-1" />
        </RouterContext.Provider>
      </ServiceContext.Provider>,
    );
    await waitFor(() => {
      expect(useBookshelfUiStateStore.getState().seriesDetailScroll).toBeNull();
    });
    expect(scrollToSpy).not.toHaveBeenCalled();
    unmountMismatch();

    // 同期完了（completedSyncCount増加）で再読込され、アンマウント途中の非同期結果は無視される
    let resolveSeries!: (value: SeriesRecord | null) => void;
    const delayedSeriesPromise = new Promise<SeriesRecord | null>((resolve) => {
      resolveSeries = resolve;
    });
    const delayedServices = createMockServices({
      seriesRepo: {
        getById: vi.fn().mockReturnValueOnce(delayedSeriesPromise),
        listActive: vi.fn(),
        findOrCreateByParsedTitle: vi.fn(),
        mergeAuthorsIfUnlocked: vi.fn(),
        updateLastReadAt: vi.fn(),
      },
    });
    const { unmount: unmountDelayed } = render(
      <ServiceContext.Provider value={delayedServices}>
        <RouterContext.Provider value={router}>
          <SeriesDetailPage seriesId="series-1" />
        </RouterContext.Provider>
      </ServiceContext.Provider>,
    );
    unmountDelayed();
    await act(async () => {
      resolveSeries(createSeries());
      await Promise.resolve();
    });

    // completedSyncCount 変化による再フェッチ
    const syncServices = createMockServices();
    render(
      <ServiceContext.Provider value={syncServices}>
        <RouterContext.Provider value={router}>
          <SeriesDetailPage seriesId="series-1" />
        </RouterContext.Provider>
      </ServiceContext.Provider>,
    );
    await waitFor(() => {
      expect(syncServices.seriesRepo.getById).toHaveBeenCalledTimes(1);
    });
    act(() => {
      useDriveSyncStateStore.setState({ completedSyncCount: 1 });
    });
    await waitFor(() => {
      expect(syncServices.seriesRepo.getById).toHaveBeenCalledTimes(2);
    });
  });

  it("アンマウント後に進捗取得またはエラーが到着しても状態更新・警告ログを行わない", async () => {
    const router = createMockRouter();

    let resolveProgress!: (
      value: ReadonlyMap<string, ReadingProgressRecord>,
    ) => void;
    const progressPromise = new Promise<
      ReadonlyMap<string, ReadingProgressRecord>
    >((resolve) => {
      resolveProgress = resolve;
    });
    const progressDelayServices = createMockServices({
      readingProgressRepo: {
        get: vi.fn(),
        put: vi.fn(),
        listByVolumeIds: vi.fn().mockReturnValue(progressPromise),
        listRecentLocal: vi.fn(),
        delete: vi.fn(),
        clearLocal: vi.fn(),
      },
    });
    const { unmount: unmountProgress } = render(
      <ServiceContext.Provider value={progressDelayServices}>
        <RouterContext.Provider value={router}>
          <SeriesDetailPage seriesId="series-1" />
        </RouterContext.Provider>
      </ServiceContext.Provider>,
    );
    await waitFor(() => {
      expect(
        progressDelayServices.readingProgressRepo.listByVolumeIds,
      ).toHaveBeenCalledTimes(1);
    });
    unmountProgress();
    await act(async () => {
      resolveProgress(new Map());
      await Promise.resolve();
    });

    let rejectSeries!: (reason: unknown) => void;
    const rejectPromise = new Promise<SeriesRecord | null>((_, reject) => {
      rejectSeries = reject;
    });
    const rejectDelayServices = createMockServices({
      seriesRepo: {
        getById: vi.fn().mockReturnValue(rejectPromise),
        listActive: vi.fn(),
        findOrCreateByParsedTitle: vi.fn(),
        mergeAuthorsIfUnlocked: vi.fn(),
        updateLastReadAt: vi.fn(),
      },
    });
    const { unmount: unmountReject } = render(
      <ServiceContext.Provider value={rejectDelayServices}>
        <RouterContext.Provider value={router}>
          <SeriesDetailPage seriesId="series-1" />
        </RouterContext.Provider>
      </ServiceContext.Provider>,
    );
    unmountReject();
    await act(async () => {
      rejectSeries(new Error("late failure"));
      await Promise.resolve();
    });
    expect(diagnosticLogger.getEntries()).toHaveLength(0);
  });

  it("WithCoverErrorsストーリーと表紙抽出ビューポート監視・インプレース差分更新・再試行活性制御・TR-04同期プリエンプションを検証する (AC-SD-03, AC-SD-06, AC-SD-07)", async () => {
    // 1. WithCoverErrors ストーリー: initialSnapshot 指定時は isGoogleConnected/isSyncing 反映・ビューポート監視無効
    const { unmount: unmountStory } = render(<WithCoverErrors />);
    expect(volumeListSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({
        canRetryCovers: true,
        onRetryFailedCovers: expect.any(Function),
      }),
      undefined,
    );
    expect(viewportObserverSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({
        screenKey: "series-detail",
        enabled: false,
      }),
    );
    unmountStory();
    volumeListSpy.mockClear();
    summarySpy.mockClear();

    // 2. 通常マウント時: getSession・subscribeSession・syncPhase・インプレース更新・TR-04 pause("reader")
    const session: GoogleAuthSession = {
      email: "reader@example.com",
      accessToken: "ya29.ok",
      expiresAt: Date.now() + 3_600_000,
    };
    const authBridge = createMockGoogleAuthBridge({
      getCachedSession: vi.fn(() => null),
      getSession: vi.fn(async () => session),
    });
    const scheduler = createMockCoverExtractionScheduler();
    const router = createMockRouter();

    const vol1 = createVolume({
      id: "vol-1",
      seriesId: "series-1",
      volumeNumber: 1,
      coverStatus: "pending",
      coverBlob: null,
    });
    const vol2Blob = new Blob(["vol2"], { type: "image/webp" });
    const vol2 = createVolume({
      id: "vol-2",
      seriesId: "series-1",
      volumeNumber: 2,
      volumeLabel: "第02巻",
      coverStatus: "ready",
      coverBlob: vol2Blob,
      coverUpdatedAt: 1000,
    });

    const services = createMockServices({
      googleAuthBridge: authBridge,
      coverExtractionScheduler: scheduler,
      volumesRepo: {
        getById: vi.fn(),
        getByDriveFileId: vi.fn(),
        listBySeriesId: vi.fn().mockResolvedValue([vol1, vol2]),
        listVisibleByRootIds: vi.fn().mockResolvedValue([]),
        upsertByDriveFileId: vi.fn(),
        markTrashedByDriveFileId: vi.fn(),
        markTrashedMissingInRoot: vi.fn(),
        listPendingCovers: vi.fn(),
        updateCover: vi.fn(),
      } as unknown as ServiceContextValue["volumesRepo"],
    });

    const { unmount } = render(
      <ServiceContext.Provider value={services}>
        <RouterContext.Provider value={router}>
          <SeriesDetailPage seriesId="series-1" />
        </RouterContext.Provider>
      </ServiceContext.Provider>,
    );

    await waitFor(() => {
      expect(volumeListSpy).toHaveBeenLastCalledWith(
        expect.objectContaining({
          canRetryCovers: true,
        }),
        undefined,
      );
    });

    expect(scheduler.subscribeVolumeUpdated).toHaveBeenCalledTimes(1);
    expect(viewportObserverSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({
        screenKey: "series-detail",
        scheduler,
        pendingVolumeIds: ["vol-1"],
        enabled: true,
      }),
    );

    // 再試行コールバックが seriesId 指定で呼ばれること
    const lastVolumeListProps = volumeListSpy.mock.calls.at(
      -1,
    )![0] as SeriesVolumeListSectionModule.SeriesVolumeListSectionProps;
    act(() => {
      lastVolumeListProps.onRetryFailedCovers?.();
    });
    expect(scheduler.retryFailedCovers).toHaveBeenCalledWith({
      seriesId: "series-1",
    });

    // 同期中 (syncPhase === "syncing") は canRetryCovers が false になること
    act(() => {
      useDriveSyncStateStore.setState({ phase: "syncing" });
    });
    expect(
      (
        volumeListSpy.mock.calls.at(
          -1,
        )![0] as SeriesVolumeListSectionModule.SeriesVolumeListSectionProps
      ).canRetryCovers,
    ).toBe(false);
    act(() => {
      useDriveSyncStateStore.setState({ phase: "idle" });
    });

    // subscribeSession で未連携になると canRetryCovers が false になること
    act(() => {
      authBridge.emitSession(null);
    });
    expect(
      (
        volumeListSpy.mock.calls.at(
          -1,
        )![0] as SeriesVolumeListSectionModule.SeriesVolumeListSectionProps
      ).canRetryCovers,
    ).toBe(false);

    const beforeVolumes = (
      volumeListSpy.mock.calls.at(
        -1,
      )![0] as SeriesVolumeListSectionModule.SeriesVolumeListSectionProps
    ).volumes;
    const beforeVol2Item = beforeVolumes[1]!;

    // 別シリーズのイベントや未一致 volumeId は無視されること
    act(() => {
      scheduler.emitVolumeUpdated({
        volumeId: "vol-1",
        seriesId: "other-series",
        coverStatus: "ready",
        coverBlob: new Blob(["other"]),
        coverUpdatedAt: 2000,
      });
      scheduler.emitVolumeUpdated({
        volumeId: "vol-unmatched",
        seriesId: "series-1",
        coverStatus: "ready",
        coverBlob: new Blob(["other"]),
        coverUpdatedAt: 2000,
      });
    });
    expect(
      (
        volumeListSpy.mock.calls.at(
          -1,
        )![0] as SeriesVolumeListSectionModule.SeriesVolumeListSectionProps
      ).volumes,
    ).toBe(beforeVolumes);

    // 該当巻（代表巻 vol-1）の ready 更新 -> 代表表紙と vol-1 行のみインプレース更新し vol-2 の参照維持
    const newBlob = new Blob(["new-cover"], { type: "image/webp" });
    act(() => {
      scheduler.emitVolumeUpdated({
        volumeId: "vol-1",
        seriesId: "series-1",
        coverStatus: "ready",
        coverBlob: newBlob,
        coverUpdatedAt: 2001,
      });
    });
    const afterSummary = summarySpy.mock.calls.at(
      -1,
    )![0] as SeriesSummaryCardModule.SeriesSummaryCardProps;
    const afterVolumes = (
      volumeListSpy.mock.calls.at(
        -1,
      )![0] as SeriesVolumeListSectionModule.SeriesVolumeListSectionProps
    ).volumes;
    expect(afterSummary.representativeVolume.coverStatus).toBe("ready");
    expect(afterSummary.representativeVolume.coverBlob).toBe(newBlob);
    expect(afterVolumes[0]!.volume.coverStatus).toBe("ready");
    expect(afterVolumes[0]!.volume.coverBlob).toBe(newBlob);
    expect(afterVolumes[1]).toBe(beforeVol2Item);
    expect(afterVolumes[1]!.volume.coverBlob).toBe(vol2Blob);

    // 非代表巻（vol-2）の error 更新 -> 代表表紙は変わらず vol-2 行のみインプレース更新
    act(() => {
      scheduler.emitVolumeUpdated({
        volumeId: "vol-2",
        seriesId: "series-1",
        coverStatus: "error",
        coverBlob: null,
        coverUpdatedAt: 2002,
      });
    });
    expect(
      (
        summarySpy.mock.calls.at(
          -1,
        )![0] as SeriesSummaryCardModule.SeriesSummaryCardProps
      ).representativeVolume.coverStatus,
    ).toBe("ready");
    expect(
      (
        volumeListSpy.mock.calls.at(
          -1,
        )![0] as SeriesVolumeListSectionModule.SeriesVolumeListSectionProps
      ).volumes[1]!.volume.coverStatus,
    ).toBe("error");

    // TR-04 遷移ハンドラで navigate 直前に同期 pause("reader") が呼ばれること
    vi.mocked(scheduler.pause).mockClear();
    act(() => {
      afterSummary.onQuickRead("vol-1");
    });
    expect(scheduler.pause).toHaveBeenCalledWith("reader");
    expect(router.navigate).toHaveBeenCalledWith("/read/volume/vol-1", {
      readerOrigin: "series-detail",
      seriesId: "series-1",
    });

    unmount();

    // 3. getSession 失敗・アンマウント後解決・viewModel===null 時のイベント受信でも安全に動作すること
    const failingAuth = createMockGoogleAuthBridge({
      getCachedSession: vi.fn(() => null),
      getSession: vi.fn(async () => {
        throw new Error("auth failed");
      }),
    });
    const emptyScheduler = createMockCoverExtractionScheduler();
    const emptyServices = createMockServices({
      googleAuthBridge: failingAuth,
      coverExtractionScheduler: emptyScheduler,
      seriesRepo: {
        getById: vi.fn().mockResolvedValue(null),
        listActive: vi.fn(),
        findOrCreateByParsedTitle: vi.fn(),
        mergeAuthorsIfUnlocked: vi.fn(),
        updateLastReadAt: vi.fn(),
      },
    });
    const { unmount: unmountEmpty } = render(
      <ServiceContext.Provider value={emptyServices}>
        <RouterContext.Provider value={router}>
          <SeriesDetailPage seriesId="series-1" />
        </RouterContext.Provider>
      </ServiceContext.Provider>,
    );
    await waitFor(() => {
      expect(emptyStateSpy).toHaveBeenCalled();
    });
    act(() => {
      emptyScheduler.emitVolumeUpdated({
        volumeId: "vol-1",
        seriesId: "series-1",
        coverStatus: "ready",
        coverBlob: null,
        coverUpdatedAt: 3000,
      });
    });
    unmountEmpty();

    // getSession 解決/拒否がアンマウント後に届いた場合も安全に無視されること
    let resolveLateSession!: (s: GoogleAuthSession | null) => void;
    const lateSessionAuth = createMockGoogleAuthBridge({
      getCachedSession: vi.fn(() => null),
      getSession: vi.fn(
        () =>
          new Promise<GoogleAuthSession | null>((res) => {
            resolveLateSession = res;
          }),
      ),
    });
    const { unmount: unmountLate1 } = render(
      <ServiceContext.Provider
        value={createMockServices({ googleAuthBridge: lateSessionAuth })}
      >
        <RouterContext.Provider value={router}>
          <SeriesDetailPage seriesId="series-1" />
        </RouterContext.Provider>
      </ServiceContext.Provider>,
    );
    unmountLate1();
    await act(async () => {
      resolveLateSession(session);
      await Promise.resolve();
    });

    let rejectLateSession!: (err: unknown) => void;
    const lateRejectAuth = createMockGoogleAuthBridge({
      getCachedSession: vi.fn(() => null),
      getSession: vi.fn(
        () =>
          new Promise<GoogleAuthSession | null>((_, rej) => {
            rejectLateSession = rej;
          }),
      ),
    });
    const { unmount: unmountLate2 } = render(
      <ServiceContext.Provider
        value={createMockServices({ googleAuthBridge: lateRejectAuth })}
      >
        <RouterContext.Provider value={router}>
          <SeriesDetailPage seriesId="series-1" />
        </RouterContext.Provider>
      </ServiceContext.Provider>,
    );
    unmountLate2();
    await act(async () => {
      rejectLateSession(new Error("late auth err"));
      await Promise.resolve();
    });

    // getCachedSession が既に存在する場合は getSession を呼ばず即座に連携済み扱いとなること
    const cachedAuth = createMockGoogleAuthBridge({
      getCachedSession: vi.fn(() => session),
    });
    const { unmount: unmountCached } = render(
      <ServiceContext.Provider
        value={createMockServices({ googleAuthBridge: cachedAuth })}
      >
        <RouterContext.Provider value={router}>
          <SeriesDetailPage seriesId="series-1" />
        </RouterContext.Provider>
      </ServiceContext.Provider>,
    );
    await waitFor(() => {
      expect(volumeListSpy).toHaveBeenLastCalledWith(
        expect.objectContaining({ canRetryCovers: true }),
        undefined,
      );
    });
    expect(cachedAuth.getSession).not.toHaveBeenCalled();
    unmountCached();
  });
});
