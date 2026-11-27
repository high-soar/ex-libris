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
import { NoopCoverExtractionScheduler } from "../../engine/cover/CoverExtractionSchedulerCore";
import { diagnosticLogger } from "../../diagnostics/diagnosticLogger";
import {
  RouterContext,
  type RouterContextValue,
} from "../../shared/router/routerContext";
import {
  resetDriveSyncState,
  useDriveSyncStateStore,
} from "../../shared/sync/driveSyncStateStore";
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

const { Ready, Loading, Empty } = composeStories(stories);

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

function createMockServices(
  overrides: Partial<ServiceContextValue> = {},
): ServiceContextValue {
  return {
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
    coverExtractionScheduler: new NoopCoverExtractionScheduler(),
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
});
