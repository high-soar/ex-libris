import { Capacitor } from "@capacitor/core";
import { composeStories } from "@storybook/react";
import { act, render, screen } from "@testing-library/react";
import * as Comlink from "comlink";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CapacitorAppBridge } from "../bridges/app/capacitorAppBridge";
import { MockAppBridge } from "../bridges/app/mockAppBridge";
import type { AppBridge } from "../bridges/app/types";
import { CapacitorGoogleAuthAdapter } from "../bridges/oauth/capacitorGoogleAuthAdapter";
import { GoogleAuthTokenManager } from "../bridges/oauth/googleAuthTokenManager";
import { MockGoogleAuthAdapter } from "../bridges/oauth/mockGoogleAuthAdapter";
import type {
  GoogleAuthBridge,
  GoogleAuthSession,
} from "../bridges/oauth/types";
import { diagnosticLogger } from "../diagnostics/diagnosticLogger";
import {
  CoverExtractionSchedulerCore,
  NoopCoverExtractionScheduler,
} from "../engine/cover/CoverExtractionSchedulerCore";
import type {
  CoverExtractionProgressSnapshot,
  CoverExtractionScheduler,
  CoverResizeWorkerApi,
} from "../engine/cover/types";
import type {
  CoordinatorHostCallbacks,
  CoordinatorWorkerApi,
} from "../engine/types";
import { DefaultDriveSyncEngine } from "../providers/gdrive/driveSyncEngine";
import { GoogleDriveFolderClient } from "../providers/gdrive/googleDriveFolderClient";
import { GoogleDriveSyncClient } from "../providers/gdrive/googleDriveSyncClient";
import { MockDriveFolderClient } from "../providers/gdrive/mockDriveFolderClient";
import { MockDriveSyncClient } from "../providers/gdrive/mockDriveSyncClient";
import type {
  DriveFolderClient,
  DriveSyncClient,
  DriveSyncEngine,
} from "../providers/gdrive/types";
import { useBookshelfUiStateStore } from "../features/bookshelf/bookshelfUiStateStore";
import {
  resetCoverExtractionState,
  useCoverExtractionStateStore,
} from "../shared/sync/coverExtractionStateStore";
import {
  resetDriveSyncState,
  useDriveSyncStateStore,
} from "../shared/sync/driveSyncStateStore";
import { db, resetTestDb } from "../storage/db";
import {
  DexieDriveSyncMetaRepository,
  type DriveSyncMetaRepository,
} from "../storage/repositories/driveSyncMetaRepository";
import {
  DexieDriveSyncRootsRepository,
  type DriveSyncRootsRepository,
} from "../storage/repositories/driveSyncRootsRepository";
import {
  DexieReaderSettingsRepository,
  type ReaderSettingsRepository,
} from "../storage/repositories/readerSettingsRepository";
import {
  DexieReadingProgressRepository,
  type ReadingProgressRepository,
} from "../storage/repositories/readingProgressRepository";
import {
  DexieSeriesRepository,
  type SeriesRepository,
} from "../storage/repositories/seriesRepository";
import {
  DexieVolumesRepository,
  type VolumesRepository,
} from "../storage/repositories/volumesRepository";
import {
  DexieZipIndexCacheRepository,
  type ZipIndexCacheRepository,
} from "../storage/repositories/zipIndexCacheRepository";
import { DEFAULT_SHADER_CORRECTION_PARAMS } from "../webgl/shaderParams";
import { ServiceProvider, shouldExposeResetTestDb } from "./ServiceProvider";
import * as stories from "./ServiceProvider.stories";
import type { CoordinatorSessionHandle } from "./coordinatorClient";
import { type ServiceContextValue, useServices } from "./serviceContext";

const { Default, InjectedServices } = composeStories(stories);

function ServicesProbe({
  onCapture,
}: {
  onCapture: (services: ServiceContextValue) => void;
}) {
  const services = useServices();
  onCapture(services);
  return <div data-testid="services-probe-ready">ready</div>;
}

function resetGlobalServices(): void {
  delete window.__exLibrisServices;
}

describe("ServiceProvider", () => {
  beforeEach(async () => {
    diagnosticLogger.clear();
    resetCoverExtractionState();
    resetDriveSyncState();
    window.sessionStorage.clear();
    resetGlobalServices();
    await resetTestDb();
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    resetCoverExtractionState();
    resetDriveSyncState();
    window.sessionStorage.clear();
    resetGlobalServices();
    await resetTestDb();
  });

  it("DefaultおよびInjectedServicesストーリーを描画しグローバル初期化フラグを設定すること", () => {
    const { unmount } = render(<Default />);
    expect(screen.getByTestId("story-bridge-kind")).toHaveTextContent(
      "MockAppBridge",
    );
    expect(screen.getByTestId("story-session-factory")).toHaveTextContent(
      "function",
    );
    expect(window.__exLibrisServices?.isReady).toBe(true);
    expect(window.__exLibrisServices?.appBridge).toBeInstanceOf(MockAppBridge);
    expect(window.__exLibrisServices?.resetTestDb).toEqual(
      expect.any(Function),
    );
    unmount();

    resetGlobalServices();

    render(<InjectedServices />);
    expect(screen.getByTestId("story-bridge-kind")).toHaveTextContent(
      "CustomAppBridge",
    );
    expect(window.__exLibrisServices?.isReady).toBe(true);
    expect(window.__exLibrisServices?.appBridge).toBeDefined();
    expect(window.__exLibrisServices?.appBridge).not.toBeInstanceOf(
      MockAppBridge,
    );
    expect(window.__exLibrisServices?.resetTestDb).toEqual(
      expect.any(Function),
    );
  });

  it("Capacitor.isNativePlatform()がfalseのときはMockアダプタとDexie各Repositoryを自動構築し参照維持・CoordinatorへauthBridge結線すること", async () => {
    vi.spyOn(Capacitor, "isNativePlatform").mockReturnValue(false);
    const captured: ServiceContextValue[] = [];

    const { rerender } = render(
      <ServiceProvider>
        <ServicesProbe onCapture={(s) => captured.push(s)} />
      </ServiceProvider>,
    );

    expect(screen.getByTestId("services-probe-ready")).toBeVisible();
    expect(captured).toHaveLength(1);
    expect(captured[0]?.appBridge).toBeInstanceOf(MockAppBridge);
    expect(captured[0]?.createCoordinatorSession).toEqual(expect.any(Function));
    expect(captured[0]?.zipIndexCacheRepo).toBeInstanceOf(
      DexieZipIndexCacheRepository,
    );
    expect(captured[0]?.readingProgressRepo).toBeInstanceOf(
      DexieReadingProgressRepository,
    );
    expect(captured[0]?.readerSettingsRepo).toBeInstanceOf(
      DexieReaderSettingsRepository,
    );
    expect(captured[0]?.googleAuthBridge).toBeInstanceOf(
      GoogleAuthTokenManager,
    );
    expect(captured[0]?.driveSyncRootsRepo).toBeInstanceOf(
      DexieDriveSyncRootsRepository,
    );
    expect(captured[0]?.driveFolderClient).toBeInstanceOf(
      MockDriveFolderClient,
    );
    expect(captured[0]?.seriesRepo).toBeInstanceOf(DexieSeriesRepository);
    expect(captured[0]?.volumesRepo).toBeInstanceOf(DexieVolumesRepository);
    expect(captured[0]?.driveSyncMetaRepo).toBeInstanceOf(
      DexieDriveSyncMetaRepository,
    );
    expect(captured[0]?.driveSyncClient).toBeInstanceOf(MockDriveSyncClient);
    expect(captured[0]?.driveSyncEngine).toBeInstanceOf(DefaultDriveSyncEngine);
    expect(captured[0]?.coverExtractionScheduler).toBeInstanceOf(
      NoopCoverExtractionScheduler,
    );
    expect(window.__exLibrisServices).toEqual({
      isReady: true,
      appBridge: captured[0]?.appBridge,
      resetTestDb: expect.any(Function),
      mockGoogleAuthAdapter: expect.any(MockGoogleAuthAdapter),
      mockDriveFolderClient: captured[0]?.driveFolderClient,
      driveSyncEngine: captured[0]?.driveSyncEngine,
      seriesRepo: captured[0]?.seriesRepo,
      volumesRepo: captured[0]?.volumesRepo,
      driveSyncMetaRepo: captured[0]?.driveSyncMetaRepo,
      mockDriveSyncClient: captured[0]?.driveSyncClient,
      coverExtractionScheduler: captured[0]?.coverExtractionScheduler,
      setTestCoverExtractionAutoRun: expect.any(Function),
    });

    // 再レンダー時も同一のサービスインスタンスを維持すること
    rerender(
      <ServiceProvider>
        <ServicesProbe onCapture={(s) => captured.push(s)} />
      </ServiceProvider>,
    );
    expect(captured).toHaveLength(2);
    expect(captured[1]?.appBridge).toBe(captured[0]?.appBridge);
    expect(captured[1]?.createCoordinatorSession).toBe(
      captured[0]?.createCoordinatorSession,
    );
    expect(captured[1]?.zipIndexCacheRepo).toBe(captured[0]?.zipIndexCacheRepo);
    expect(captured[1]?.readingProgressRepo).toBe(
      captured[0]?.readingProgressRepo,
    );
    expect(captured[1]?.readerSettingsRepo).toBe(
      captured[0]?.readerSettingsRepo,
    );
    expect(captured[1]?.googleAuthBridge).toBe(captured[0]?.googleAuthBridge);
    expect(captured[1]?.driveSyncRootsRepo).toBe(
      captured[0]?.driveSyncRootsRepo,
    );
    expect(captured[1]?.driveFolderClient).toBe(captured[0]?.driveFolderClient);
    expect(captured[1]?.seriesRepo).toBe(captured[0]?.seriesRepo);
    expect(captured[1]?.volumesRepo).toBe(captured[0]?.volumesRepo);
    expect(captured[1]?.driveSyncMetaRepo).toBe(captured[0]?.driveSyncMetaRepo);
    expect(captured[1]?.driveSyncClient).toBe(captured[0]?.driveSyncClient);
    expect(captured[1]?.driveSyncEngine).toBe(captured[0]?.driveSyncEngine);
    expect(captured[1]?.coverExtractionScheduler).toBe(
      captured[0]?.coverExtractionScheduler,
    );

    // 公開モック経由のシード後に createCoordinatorSession() を呼ぶと authBridge 経由でトークンが Worker へ同期されること
    window.__exLibrisServices!.mockGoogleAuthAdapter!.seedLinkedSession({
      email: "it@example.com",
      accessToken: "ya29.seeded-provider",
    });
    await expect(
      captured[0]!.googleAuthBridge.getSession(),
    ).resolves.toMatchObject({
      email: "it@example.com",
      accessToken: "ya29.seeded-provider",
    });

    const receivedTokens: Array<string | null> = [];
    let receivedCallbacks: CoordinatorHostCallbacks | null = null;
    class ProviderMockWorker {
      private readonly port1: MessagePort;
      private readonly port2: MessagePort;

      constructor() {
        const channel = new MessageChannel();
        this.port1 = channel.port1;
        this.port2 = channel.port2;
        this.port2.start();
        const remoteImpl: CoordinatorWorkerApi = {
          async openArchive() {
            return { pageCount: 0, entries: [], fromIndexCache: false };
          },
          async requestVisiblePages() {
            return [];
          },
          updateAccessToken(token) {
            receivedTokens.push(token);
          },
          setHostCallbacks(callbacks) {
            receivedCallbacks = callbacks;
          },
          cancelEpochBelow() {},
          async closeArchive() {},
        };
        Comlink.expose(remoteImpl, this.port1);
      }

      postMessage(message: unknown, transfer: Transferable[] = []): void {
        this.port2.postMessage(message, transfer);
      }

      addEventListener(
        type: string,
        listener: EventListenerOrEventListenerObject,
      ): void {
        this.port2.addEventListener(type, listener);
      }

      removeEventListener(
        type: string,
        listener: EventListenerOrEventListenerObject,
      ): void {
        this.port2.removeEventListener(type, listener);
      }

      terminate(): void {
        this.port1.close();
        this.port2.close();
      }
    }

    vi.stubGlobal("Worker", ProviderMockWorker);
    const session = captured[0]!.createCoordinatorSession();
    await vi.waitFor(() => {
      expect(receivedCallbacks).not.toBeNull();
      expect(receivedTokens).toEqual(["ya29.seeded-provider"]);
    });
    session.dispose();
  });

  it("Capacitor.isNativePlatform()がtrueのときはネイティブアダプタを構築しテスト用フックを公開しないこと (R1-12)", async () => {
    vi.spyOn(Capacitor, "isNativePlatform").mockReturnValue(true);
    const restoreSpy = vi
      .spyOn(CapacitorGoogleAuthAdapter.prototype, "restoreSession")
      .mockResolvedValueOnce({ status: "unlinked" });
    const captured: ServiceContextValue[] = [];

    render(
      <ServiceProvider>
        <ServicesProbe onCapture={(s) => captured.push(s)} />
      </ServiceProvider>,
    );

    const capturedServices = captured[0];
    expect(capturedServices?.appBridge).toBeInstanceOf(CapacitorAppBridge);
    expect(capturedServices?.googleAuthBridge).toBeInstanceOf(
      GoogleAuthTokenManager,
    );
    expect(capturedServices?.driveFolderClient).toBeInstanceOf(
      GoogleDriveFolderClient,
    );
    expect(capturedServices?.driveSyncClient).toBeInstanceOf(
      GoogleDriveSyncClient,
    );
    expect(capturedServices?.driveSyncEngine).toBeInstanceOf(
      DefaultDriveSyncEngine,
    );
    expect(capturedServices?.driveSyncRootsRepo).toBeInstanceOf(
      DexieDriveSyncRootsRepository,
    );
    await expect(
      capturedServices!.googleAuthBridge.getSession(),
    ).resolves.toBeNull();
    expect(restoreSpy).toHaveBeenCalledTimes(1);

    expect(window.__exLibrisServices).toEqual({
      isReady: true,
      appBridge: capturedServices?.appBridge,
    });
    expect(window.__exLibrisServices?.resetTestDb).toBeUndefined();
    expect("resetTestDb" in window.__exLibrisServices!).toBe(false);
    expect("mockGoogleAuthAdapter" in window.__exLibrisServices!).toBe(false);
    expect("mockDriveFolderClient" in window.__exLibrisServices!).toBe(false);
    expect("mockDriveSyncClient" in window.__exLibrisServices!).toBe(false);
    expect("driveSyncEngine" in window.__exLibrisServices!).toBe(false);
    expect("seriesRepo" in window.__exLibrisServices!).toBe(false);
    expect("volumesRepo" in window.__exLibrisServices!).toBe(false);
    expect("driveSyncMetaRepo" in window.__exLibrisServices!).toBe(false);
    expect("coverExtractionScheduler" in window.__exLibrisServices!).toBe(
      false,
    );
    expect("setTestCoverExtractionAutoRun" in window.__exLibrisServices!).toBe(
      false,
    );
  });

  it("DI props指定時は注入された各種Bridge・Repository・Clientを使用・更新しモック非該当時はグローバル公開しないこと", () => {
    const customBridge1: AppBridge = {
      addBackButtonListener: vi.fn(() => () => {}),
      minimizeApp: vi.fn(async () => {}),
    };
    const customBridge2: AppBridge = {
      addBackButtonListener: vi.fn(() => () => {}),
      minimizeApp: vi.fn(async () => {}),
    };
    const customFactory = vi.fn((): CoordinatorSessionHandle => ({
      api: {} as CoordinatorWorkerApi,
      dispose: vi.fn(),
    }));
    const customRepo1: ZipIndexCacheRepository = {
      get: vi.fn(async () => null),
      put: vi.fn(async () => {}),
      delete: vi.fn(async () => {}),
    };
    const customRepo2: ZipIndexCacheRepository = {
      get: vi.fn(async () => null),
      put: vi.fn(async () => {}),
      delete: vi.fn(async () => {}),
    };
    const customProgressRepo1: ReadingProgressRepository = {
      get: vi.fn(async () => null),
      put: vi.fn(async () => {}),
      listByVolumeIds: vi.fn(async () => new Map()),
      listRecentLocal: vi.fn(async () => []),
      delete: vi.fn(async () => {}),
      clearLocal: vi.fn(async () => {}),
    };
    const customProgressRepo2: ReadingProgressRepository = {
      get: vi.fn(async () => null),
      put: vi.fn(async () => {}),
      listByVolumeIds: vi.fn(async () => new Map()),
      listRecentLocal: vi.fn(async () => []),
      delete: vi.fn(async () => {}),
      clearLocal: vi.fn(async () => {}),
    };
    const customSettingsRepo1: ReaderSettingsRepository = {
      getShaderDefaults: vi.fn(async () => ({
        ...DEFAULT_SHADER_CORRECTION_PARAMS,
      })),
      saveShaderDefaults: vi.fn(async (params) => ({ ...params })),
    };
    const customSettingsRepo2: ReaderSettingsRepository = {
      getShaderDefaults: vi.fn(async () => ({
        ...DEFAULT_SHADER_CORRECTION_PARAMS,
      })),
      saveShaderDefaults: vi.fn(async (params) => ({ ...params })),
    };
    const customAuthBridge1: GoogleAuthBridge = {
      getCachedSession: vi.fn(() => null),
      getSession: vi.fn(async () => null),
      signIn: vi.fn(),
      signOut: vi.fn(async () => {}),
      getValidAccessToken: vi.fn(async () => "ya29.custom-1"),
      subscribeSession: vi.fn(() => () => {}),
    };
    const customAuthBridge2: GoogleAuthBridge = {
      ...customAuthBridge1,
      getValidAccessToken: vi.fn(async () => "ya29.custom-2"),
    };
    const customSyncRootsRepo1: DriveSyncRootsRepository = {
      listActive: vi.fn(async () => []),
      countEnabled: vi.fn(async () => 0),
      upsertRoot: vi.fn(),
      setEnabled: vi.fn(async () => null),
      removeRoot: vi.fn(async () => {}),
    };
    const customSyncRootsRepo2: DriveSyncRootsRepository = {
      listActive: vi.fn(async () => []),
      countEnabled: vi.fn(async () => 1),
      upsertRoot: vi.fn(),
      setEnabled: vi.fn(async () => null),
      removeRoot: vi.fn(async () => {}),
    };
    const customFolderClient1: DriveFolderClient = {
      resolveFolderById: vi.fn(),
      listChildFolders: vi.fn(async () => ({
        folders: [],
        nextPageToken: null,
      })),
    };
    const customFolderClient2 = new MockDriveFolderClient();
    const customSeriesRepo1: SeriesRepository = {
      getById: vi.fn(async () => null),
      listActive: vi.fn(async () => []),
      findOrCreateByParsedTitle: vi.fn(),
      mergeAuthorsIfUnlocked: vi.fn(async () => null),
      updateLastReadAt: vi.fn(async () => null),
    };
    const customSeriesRepo2: SeriesRepository = {
      ...customSeriesRepo1,
      listActive: vi.fn(async () => []),
    };
    const customVolumesRepo1: VolumesRepository = {
      getById: vi.fn(async () => null),
      getByDriveFileId: vi.fn(async () => null),
      listBySeriesId: vi.fn(async () => []),
      listVisibleByEnabledRoots: vi.fn(async () => []),
      listByRootFolderIds: vi.fn(async () => []),
      upsertFromDriveSync: vi.fn(),
      markTrashedByDriveFileIds: vi.fn(async () => 0),
      saveCoverReady: vi.fn(async () => null),
      saveCoverError: vi.fn(async () => null),
      resetErrorCoversToPending: vi.fn(async () => []),
    };
    const customVolumesRepo2: VolumesRepository = {
      ...customVolumesRepo1,
      markTrashedByDriveFileIds: vi.fn(async () => 1),
    };
    const customSyncMetaRepo1: DriveSyncMetaRepository = {
      getSyncState: vi.fn(async () => ({
        startPageToken: null,
        lastDriveSyncAt: null,
        syncedRootFolderIds: [],
      })),
      saveSyncState: vi.fn(),
      clearSyncState: vi.fn(async () => {}),
    };
    const customSyncMetaRepo2: DriveSyncMetaRepository = {
      ...customSyncMetaRepo1,
      clearSyncState: vi.fn(async () => {}),
    };
    const customSyncClient1: DriveSyncClient = {
      getStartPageToken: vi.fn(async () => "1"),
      listItemsInParents: vi.fn(async () => ({
        files: [],
        nextPageToken: null,
      })),
      getFileMetadata: vi.fn(async () => null),
      listChanges: vi.fn(async () => ({
        changes: [],
        nextPageToken: null,
        newStartPageToken: "1",
      })),
    };
    const customSyncClient2 = new MockDriveSyncClient();
    const customSyncEngine1: DriveSyncEngine = {
      sync: vi.fn(async () => ({
        mode: "skipped-no-roots" as const,
        scannedRoots: 0,
        upsertedVolumes: 0,
        trashedVolumes: 0,
        invalidatedZipCaches: 0,
        syncedAt: 0,
      })),
    };
    const customSyncEngine2: DriveSyncEngine = {
      sync: vi.fn(async () => ({
        mode: "full" as const,
        scannedRoots: 1,
        upsertedVolumes: 0,
        trashedVolumes: 0,
        invalidatedZipCaches: 0,
        syncedAt: 1,
      })),
    };
    const createMockCoverScheduler = (): CoverExtractionScheduler => ({
      syncQueue: vi.fn(async () => {}),
      setViewportVolumeIds: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
      retryFailedCovers: vi.fn(async () => 0),
      getSnapshot: vi.fn(() => ({
        phase: "idle" as const,
        totalCount: 0,
        readyCount: 0,
        pendingCount: 0,
        errorCount: 0,
        activeVolumeId: null,
        pauseReasons: [],
      })),
      subscribeProgress: vi.fn(() => () => {}),
      subscribeVolumeUpdated: vi.fn(() => () => {}),
      resetForTest: vi.fn(async () => {}),
      dispose: vi.fn(),
    });
    const customCoverScheduler1 = createMockCoverScheduler();
    const customCoverScheduler2 = createMockCoverScheduler();

    const captured: ServiceContextValue[] = [];

    const { rerender, unmount } = render(
      <ServiceProvider
        appBridge={customBridge1}
        createCoordinatorSession={customFactory}
        zipIndexCacheRepo={customRepo1}
        readingProgressRepo={customProgressRepo1}
        readerSettingsRepo={customSettingsRepo1}
        googleAuthBridge={customAuthBridge1}
        driveSyncRootsRepo={customSyncRootsRepo1}
        driveFolderClient={customFolderClient1}
        seriesRepo={customSeriesRepo1}
        volumesRepo={customVolumesRepo1}
        driveSyncMetaRepo={customSyncMetaRepo1}
        driveSyncClient={customSyncClient1}
        driveSyncEngine={customSyncEngine1}
        coverExtractionScheduler={customCoverScheduler1}
      >
        <ServicesProbe onCapture={(s) => captured.push(s)} />
      </ServiceProvider>,
    );

    expect(captured[0]?.appBridge).toBe(customBridge1);
    expect(captured[0]?.createCoordinatorSession).toBe(customFactory);
    expect(captured[0]?.zipIndexCacheRepo).toBe(customRepo1);
    expect(captured[0]?.readingProgressRepo).toBe(customProgressRepo1);
    expect(captured[0]?.readerSettingsRepo).toBe(customSettingsRepo1);
    expect(captured[0]?.googleAuthBridge).toBe(customAuthBridge1);
    expect(captured[0]?.driveSyncRootsRepo).toBe(customSyncRootsRepo1);
    expect(captured[0]?.driveFolderClient).toBe(customFolderClient1);
    expect(captured[0]?.seriesRepo).toBe(customSeriesRepo1);
    expect(captured[0]?.volumesRepo).toBe(customVolumesRepo1);
    expect(captured[0]?.driveSyncMetaRepo).toBe(customSyncMetaRepo1);
    expect(captured[0]?.driveSyncClient).toBe(customSyncClient1);
    expect(captured[0]?.driveSyncEngine).toBe(customSyncEngine1);
    expect(captured[0]?.coverExtractionScheduler).toBe(customCoverScheduler1);
    expect(window.__exLibrisServices).toEqual({
      isReady: true,
      appBridge: customBridge1,
      resetTestDb: expect.any(Function),
      driveSyncEngine: customSyncEngine1,
      seriesRepo: customSeriesRepo1,
      volumesRepo: customVolumesRepo1,
      driveSyncMetaRepo: customSyncMetaRepo1,
      coverExtractionScheduler: customCoverScheduler1,
      setTestCoverExtractionAutoRun: expect.any(Function),
    });
    expect("mockGoogleAuthAdapter" in window.__exLibrisServices!).toBe(false);
    expect("mockDriveFolderClient" in window.__exLibrisServices!).toBe(false);
    expect("mockDriveSyncClient" in window.__exLibrisServices!).toBe(false);

    rerender(
      <ServiceProvider
        appBridge={customBridge2}
        createCoordinatorSession={customFactory}
        zipIndexCacheRepo={customRepo2}
        readingProgressRepo={customProgressRepo2}
        readerSettingsRepo={customSettingsRepo2}
        googleAuthBridge={customAuthBridge2}
        driveSyncRootsRepo={customSyncRootsRepo2}
        driveFolderClient={customFolderClient2}
        seriesRepo={customSeriesRepo2}
        volumesRepo={customVolumesRepo2}
        driveSyncMetaRepo={customSyncMetaRepo2}
        driveSyncClient={customSyncClient2}
        driveSyncEngine={customSyncEngine2}
        coverExtractionScheduler={customCoverScheduler2}
      >
        <ServicesProbe onCapture={(s) => captured.push(s)} />
      </ServiceProvider>,
    );

    expect(captured[1]?.appBridge).toBe(customBridge2);
    expect(captured[1]?.zipIndexCacheRepo).toBe(customRepo2);
    expect(captured[1]?.readingProgressRepo).toBe(customProgressRepo2);
    expect(captured[1]?.readerSettingsRepo).toBe(customSettingsRepo2);
    expect(captured[1]?.googleAuthBridge).toBe(customAuthBridge2);
    expect(captured[1]?.driveSyncRootsRepo).toBe(customSyncRootsRepo2);
    expect(captured[1]?.driveFolderClient).toBe(customFolderClient2);
    expect(captured[1]?.seriesRepo).toBe(customSeriesRepo2);
    expect(captured[1]?.volumesRepo).toBe(customVolumesRepo2);
    expect(captured[1]?.driveSyncMetaRepo).toBe(customSyncMetaRepo2);
    expect(captured[1]?.driveSyncClient).toBe(customSyncClient2);
    expect(captured[1]?.driveSyncEngine).toBe(customSyncEngine2);
    expect(captured[1]?.coverExtractionScheduler).toBe(customCoverScheduler2);
    expect(window.__exLibrisServices).toEqual({
      isReady: true,
      appBridge: customBridge2,
      resetTestDb: expect.any(Function),
      mockDriveFolderClient: customFolderClient2,
      driveSyncEngine: customSyncEngine2,
      seriesRepo: customSeriesRepo2,
      volumesRepo: customVolumesRepo2,
      driveSyncMetaRepo: customSyncMetaRepo2,
      mockDriveSyncClient: customSyncClient2,
      coverExtractionScheduler: customCoverScheduler2,
      setTestCoverExtractionAutoRun: expect.any(Function),
    });
    expect("mockGoogleAuthAdapter" in window.__exLibrisServices!).toBe(false);

    // 外部注入されたスケジューラはアンマウント時に勝手に dispose しないこと
    unmount();
    expect(customCoverScheduler1.dispose).not.toHaveBeenCalled();
    expect(customCoverScheduler2.dispose).not.toHaveBeenCalled();
  });

  it("window.__exLibrisServices.resetTestDbが公開され呼び出しによりsyncMeta等のDBテーブル・mockDriveSyncClient・UI/同期/表紙ストアを初期化できること (R1-17)", async () => {
    render(
      <ServiceProvider>
        <div>ready</div>
      </ServiceProvider>,
    );

    await db.syncMeta.put({
      key: "itPollutionGuard",
      value: "stale-record",
    });
    window.sessionStorage.setItem("exLibris:test:coverExtractionAutoRun", "1");
    useCoverExtractionStateStore.getState().applySnapshot({
      phase: "running",
      totalCount: 5,
      readyCount: 2,
      pendingCount: 2,
      errorCount: 1,
      activeVolumeId: "vol-1",
      pauseReasons: [],
    });
    useBookshelfUiStateStore.setState({
      scrollY: 320,
      sortOrder: "titleAsc",
      seriesDetailScroll: { seriesId: "s-stale", scrollY: 150 },
    });
    useDriveSyncStateStore.setState({
      phase: "completed",
      lastSyncedAt: 1_700_000_000_000,
      isLastSyncedAtLoaded: true,
      completedSyncCount: 3,
    });
    expect(await db.syncMeta.count()).toBe(1);
    const mockSyncResetSpy = vi.spyOn(
      window.__exLibrisServices!.mockDriveSyncClient!,
      "reset",
    );
    const schedulerResetSpy = vi.spyOn(
      window.__exLibrisServices!.coverExtractionScheduler!,
      "resetForTest",
    );

    const resetFn = window.__exLibrisServices?.resetTestDb;
    expect(resetFn).toEqual(expect.any(Function));
    await resetFn!();

    expect(await db.syncMeta.count()).toBe(0);
    expect(
      window.sessionStorage.getItem("exLibris:test:coverExtractionAutoRun"),
    ).toBeNull();
    expect(schedulerResetSpy).toHaveBeenCalledTimes(1);
    expect(mockSyncResetSpy).toHaveBeenCalledTimes(1);
    expect(useCoverExtractionStateStore.getState()).toMatchObject({
      phase: "idle",
      totalCount: 0,
      readyCount: 0,
      pendingCount: 0,
      errorCount: 0,
      activeVolumeId: null,
      pauseReasons: [],
    });
    expect(useBookshelfUiStateStore.getState()).toMatchObject({
      scrollY: 0,
      sortOrder: "lastReadDesc",
      seriesDetailScroll: null,
    });
    expect(useDriveSyncStateStore.getState()).toMatchObject({
      phase: "idle",
      lastSyncedAt: null,
      isLastSyncedAtLoaded: false,
      completedSyncCount: 0,
    });
  });

  it("shouldExposeResetTestDbがネイティブ実機および通常本番ブラウザではfalse、非ネイティブかつDEV/test/WebDriverではtrueを返すこと (R1-12)", () => {
    // 1. ネイティブ実機は DEV / test / WebDriver が true でも必ず false
    expect(
      shouldExposeResetTestDb({
        isNativePlatform: true,
        isDev: true,
        mode: "test",
        isWebDriver: true,
      }),
    ).toBe(false);

    // 2. 非ネイティブ環境で DEV / mode==="test" / isWebDriver のいずれかが true なら true
    expect(
      shouldExposeResetTestDb({
        isNativePlatform: false,
        isDev: true,
        mode: "production",
        isWebDriver: false,
      }),
    ).toBe(true);
    expect(
      shouldExposeResetTestDb({
        isNativePlatform: false,
        isDev: false,
        mode: "test",
        isWebDriver: false,
      }),
    ).toBe(true);
    expect(
      shouldExposeResetTestDb({
        isNativePlatform: false,
        isDev: false,
        mode: "production",
        isWebDriver: true,
      }),
    ).toBe(true);

    // 3. 非ネイティブの通常本番ブラウザ (DEV=false, mode="production", isWebDriver=false) は false
    expect(
      shouldExposeResetTestDb({
        isNativePlatform: false,
        isDev: false,
        mode: "production",
        isWebDriver: false,
      }),
    ).toBe(false);

    // 4. navigator フォールバック判定 (undefined / webdriver=false / webdriver=true)
    vi.stubGlobal("navigator", undefined);
    expect(
      shouldExposeResetTestDb({
        isNativePlatform: false,
        isDev: false,
        mode: "production",
      }),
    ).toBe(false);

    vi.stubGlobal("navigator", { webdriver: false });
    expect(
      shouldExposeResetTestDb({
        isNativePlatform: false,
        isDev: false,
        mode: "production",
      }),
    ).toBe(false);

    vi.stubGlobal("navigator", { webdriver: true });
    expect(
      shouldExposeResetTestDb({
        isNativePlatform: false,
        isDev: false,
        mode: "production",
      }),
    ).toBe(true);

    // 5. 引数省略時のデフォルト環境判定
    vi.spyOn(Capacitor, "isNativePlatform").mockReturnValue(false);
    expect(shouldExposeResetTestDb()).toBe(true);
    vi.spyOn(Capacitor, "isNativePlatform").mockReturnValue(true);
    expect(shouldExposeResetTestDb()).toBe(false);
  });

  it("WebDriver環境でMockGoogleAuthAdapterのサインイン/サインアウトをsessionStorageへ永続化しリロード時にサイレント復元、resetTestDbで初期化すること", async () => {
    vi.spyOn(Capacitor, "isNativePlatform").mockReturnValue(false);
    vi.stubGlobal("navigator", { webdriver: true });

    // 1. サインインすると sessionStorage へ永続化され、再マウント後も復元されること
    const captured1: ServiceContextValue[] = [];
    const { unmount: unmount1 } = render(
      <ServiceProvider>
        <ServicesProbe onCapture={(s) => captured1.push(s)} />
      </ServiceProvider>,
    );
    const signedIn = await captured1[0]!.googleAuthBridge.signIn();
    expect(signedIn.email).toBe("reader@example.com");
    unmount1();

    const captured2: ServiceContextValue[] = [];
    const { unmount: unmount2 } = render(
      <ServiceProvider>
        <ServicesProbe onCapture={(s) => captured2.push(s)} />
      </ServiceProvider>,
    );
    const restored = await captured2[0]!.googleAuthBridge.getSession();
    expect(restored).toMatchObject({
      email: "reader@example.com",
      accessToken: signedIn.accessToken,
    });

    // 2. resetTestDb() で DB・モックアダプタ・sessionStorage がまとめて初期化されること
    await db.syncMeta.put({ key: "authResetCheck", value: "1" });
    await window.__exLibrisServices?.resetTestDb?.();
    expect(await db.syncMeta.count()).toBe(0);
    expect(
      window.__exLibrisServices?.mockGoogleAuthAdapter?.getLinkedState().linked,
    ).toBe(false);
    unmount2();

    const captured3: ServiceContextValue[] = [];
    const { unmount: unmount3 } = render(
      <ServiceProvider>
        <ServicesProbe onCapture={(s) => captured3.push(s)} />
      </ServiceProvider>,
    );
    expect(await captured3[0]!.googleAuthBridge.getSession()).toBeNull();

    // 3. サインイン後のサインアウトで永続状態が削除されること
    await captured3[0]!.googleAuthBridge.signIn();
    await captured3[0]!.googleAuthBridge.signOut();
    unmount3();

    const captured4: ServiceContextValue[] = [];
    const { unmount: unmount4 } = render(
      <ServiceProvider>
        <ServicesProbe onCapture={(s) => captured4.push(s)} />
      </ServiceProvider>,
    );
    expect(await captured4[0]!.googleAuthBridge.getSession()).toBeNull();
    unmount4();

    // 4. 不正 JSON や null / 非オブジェクト / 必須フィールド欠損値、sessionStorage 例外時は安全に未連携開始となること
    for (const invalidPayload of [
      "{bad",
      "null",
      "123",
      JSON.stringify({ email: 123, accessToken: "tok" }),
      JSON.stringify({ email: "only@example.com" }),
    ]) {
      window.sessionStorage.setItem(
        "exLibris:test:mockGoogleAuthSession",
        invalidPayload,
      );
      const capturedInvalid: ServiceContextValue[] = [];
      const { unmount: unmountInvalid } = render(
        <ServiceProvider>
          <ServicesProbe onCapture={(s) => capturedInvalid.push(s)} />
        </ServiceProvider>,
      );
      expect(
        await capturedInvalid[0]!.googleAuthBridge.getSession(),
      ).toBeNull();
      unmountInvalid();
    }

    const getItemSpy = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("storage blocked");
      });
    const setItemSpy = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("storage quota");
      });
    const capturedErr: ServiceContextValue[] = [];
    const { unmount: unmountErr } = render(
      <ServiceProvider>
        <ServicesProbe onCapture={(s) => capturedErr.push(s)} />
      </ServiceProvider>,
    );
    expect(await capturedErr[0]!.googleAuthBridge.getSession()).toBeNull();
    await capturedErr[0]!.googleAuthBridge.signIn();
    unmountErr();
    getItemSpy.mockRestore();
    setItemSpy.mockRestore();

    // 5. 非 WebDriver 環境では sessionStorage に保存済みでも復元せず書き込まないこと
    window.sessionStorage.setItem(
      "exLibris:test:mockGoogleAuthSession",
      JSON.stringify({ email: "ignored@example.com", accessToken: "tok" }),
    );
    vi.stubGlobal("navigator", { webdriver: false });
    const capturedNonWd: ServiceContextValue[] = [];
    const { unmount: unmountNonWd } = render(
      <ServiceProvider>
        <ServicesProbe onCapture={(s) => capturedNonWd.push(s)} />
      </ServiceProvider>,
    );
    expect(await capturedNonWd[0]!.googleAuthBridge.getSession()).toBeNull();
    unmountNonWd();

    // 6. カスタム googleAuthBridge / driveFolderClient 指定時の resetTestDb() もエラーなく動作すること
    const customAuth: GoogleAuthBridge = {
      getCachedSession: vi.fn(() => null),
      getSession: vi.fn(async () => null),
      signIn: vi.fn(async () => {
        throw new Error("unused");
      }),
      signOut: vi.fn(async () => undefined),
      getValidAccessToken: vi.fn(async () => "tok"),
      subscribeSession: vi.fn(() => () => undefined),
    };
    const customFolderClient: DriveFolderClient = {
      listChildFolders: vi.fn(async () => ({
        folders: [],
        nextPageToken: null,
      })),
      resolveFolderById: vi.fn(async () => ({ id: "f1", name: "Folder 1" })),
    };
    render(
      <ServiceProvider
        googleAuthBridge={customAuth}
        driveFolderClient={customFolderClient}
      >
        <div>custom</div>
      </ServiceProvider>,
    );
    await window.__exLibrisServices?.resetTestDb?.();
  });

  it("Worker利用可能環境でネイティブ・通常Webプレビュー・WebDriver別のCoverExtractionSchedulerを構築し、アンマウント解放およびWebDriver制御を行うこと (AC-COV-02, AC-COV-07)", async () => {
    const coverBlob = new Blob(["webp-bytes"], { type: "image/webp" });
    let workerCreatedCount = 0;
    let workerTerminatedCount = 0;

    class MockCoverWorker {
      private readonly port1: MessagePort;
      private readonly port2: MessagePort;

      constructor() {
        workerCreatedCount += 1;
        const channel = new MessageChannel();
        this.port1 = channel.port1;
        this.port2 = channel.port2;
        this.port2.start();
        const remoteImpl: CoverResizeWorkerApi = {
          async encodeCoverWebp() {
            return { blob: coverBlob, width: 1, height: 1 };
          },
        };
        Comlink.expose(remoteImpl, this.port1);
      }

      postMessage(message: unknown, transfer: Transferable[] = []): void {
        this.port2.postMessage(message, transfer);
      }

      addEventListener(
        type: string,
        listener: EventListenerOrEventListenerObject,
      ): void {
        this.port2.addEventListener(type, listener);
      }

      removeEventListener(
        type: string,
        listener: EventListenerOrEventListenerObject,
      ): void {
        this.port2.removeEventListener(type, listener);
      }

      terminate(): void {
        workerTerminatedCount += 1;
        this.port1.close();
        this.port2.close();
      }
    }

    vi.stubGlobal("Worker", MockCoverWorker);
    const fetchSpy = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchSpy);

    const seedOnePendingVolume = async () => {
      await db.driveSyncRoots.put({
        folderId: "root-1",
        folderName: "Comics",
        enabled: 1,
        addedAt: 1,
        updatedAt: 1,
        deletedAt: null,
      });
      await db.series.put({
        id: "series-1",
        title: "テスト作品",
        titleReading: "てすとさくひん",
        authors: [],
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
        addedAt: 1,
        updatedAt: 1,
        deletedAt: null,
      });
      await db.volumes.put({
        id: "vol-1",
        seriesId: "series-1",
        volumeNumber: 1,
        volumeLabel: "第01巻",
        rawFileName: "test_01.zip",
        driveFileId: "drive-file-1",
        parentFolderId: "root-1",
        rootFolderId: "root-1",
        fileSize: 4096,
        md5Checksum: "md5-1",
        driveModifiedTime: 1,
        coverBlob: null,
        coverStatus: "pending",
        coverCropMode: "auto",
        coverPageIndex: 0,
        coverUpdatedAt: null,
        isTrashed: 0,
        addedAt: 1,
        updatedAt: 1,
      });
    };

    const linkedSession: GoogleAuthSession = {
      email: "reader@example.com",
      accessToken: "ya29.cover-token",
      expiresAt: Date.now() + 3_600_000,
    };
    const createLinkedAuth = (): GoogleAuthBridge => ({
      getCachedSession: vi.fn(() => linkedSession),
      getSession: vi.fn(async () => linkedSession),
      signIn: vi.fn(async () => linkedSession),
      signOut: vi.fn(async () => {}),
      getValidAccessToken: vi.fn(async () => linkedSession.accessToken),
      subscribeSession: vi.fn(() => () => {}),
    });

    // 1. 通常 Web プレビュー (!isNative && !webdriver): MockCoverArchiveRangeReader で fetch ゼロ完結 + StrictMode 再生成・アンマウント dispose
    vi.spyOn(Capacitor, "isNativePlatform").mockReturnValue(false);
    vi.stubGlobal("navigator", { webdriver: false });
    await seedOnePendingVolume();

    const capturedWeb: ServiceContextValue[] = [];
    const { unmount: unmountWeb } = render(
      <StrictMode>
        <ServiceProvider googleAuthBridge={createLinkedAuth()}>
          <ServicesProbe onCapture={(s) => capturedWeb.push(s)} />
        </ServiceProvider>
      </StrictMode>,
    );

    const webScheduler = capturedWeb.at(-1)!.coverExtractionScheduler;
    expect(webScheduler).toBeInstanceOf(CoverExtractionSchedulerCore);
    await vi.waitFor(async () => {
      const vol = await db.volumes.get("vol-1");
      expect(vol?.coverStatus).toBe("ready");
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(workerCreatedCount).toBeGreaterThanOrEqual(1);

    const disposeSpy = vi.spyOn(webScheduler, "dispose");
    unmountWeb();
    expect(disposeSpy).toHaveBeenCalledTimes(1);
    expect(workerTerminatedCount).toBe(workerCreatedCount);

    // 2. WebDriver 環境 (!isNative && webdriver=true): 初期 pause("test-harness") -> setTestCoverExtractionAutoRun(true/false) -> reload 継続 -> resetTestDb 再適用
    await resetTestDb();
    await seedOnePendingVolume();
    vi.stubGlobal("navigator", { webdriver: true });
    fetchSpy.mockResolvedValue(new Response("not-found", { status: 404 }));

    const capturedWd: ServiceContextValue[] = [];
    const { unmount: unmountWd } = render(
      <ServiceProvider googleAuthBridge={createLinkedAuth()}>
        <ServicesProbe onCapture={(s) => capturedWd.push(s)} />
      </ServiceProvider>,
    );

    const wdScheduler = capturedWd[0]!.coverExtractionScheduler;
    expect(wdScheduler).toBeInstanceOf(CoverExtractionSchedulerCore);
    await vi.waitFor(() => {
      expect(wdScheduler.getSnapshot().pauseReasons).toContain("test-harness");
    });
    expect(fetchSpy).not.toHaveBeenCalled();

    // setTestCoverExtractionAutoRun(true) で sessionStorage 保存 + resume("test-harness") + syncQueue -> 実 GoogleDriveRangeReader 発火 + diagnosticLogger 記録
    act(() => {
      window.__exLibrisServices!.setTestCoverExtractionAutoRun!(true);
    });
    expect(
      window.sessionStorage.getItem("exLibris:test:coverExtractionAutoRun"),
    ).toBe("1");
    await vi.waitFor(async () => {
      const vol = await db.volumes.get("vol-1");
      expect(vol?.coverStatus).toBe("error");
    });
    expect(fetchSpy).toHaveBeenCalled();
    expect(
      diagnosticLogger
        .getEntries()
        .some((entry) => entry.scope === "cover" && entry.level === "error"),
    ).toBe(true);

    // reload 相当の再マウント時は sessionStorage="1" により test-harness なしで起動すること
    unmountWd();
    const capturedReload: ServiceContextValue[] = [];
    const { unmount: unmountReload } = render(
      <ServiceProvider googleAuthBridge={createLinkedAuth()}>
        <ServicesProbe onCapture={(s) => capturedReload.push(s)} />
      </ServiceProvider>,
    );
    expect(
      capturedReload[0]!.coverExtractionScheduler.getSnapshot().pauseReasons,
    ).not.toContain("test-harness");

    // setTestCoverExtractionAutoRun(false) でフラグ削除 + pause("test-harness")
    act(() => {
      window.__exLibrisServices!.setTestCoverExtractionAutoRun!(false);
    });
    expect(
      window.sessionStorage.getItem("exLibris:test:coverExtractionAutoRun"),
    ).toBeNull();
    expect(
      capturedReload[0]!.coverExtractionScheduler.getSnapshot().pauseReasons,
    ).toContain("test-harness");

    // resetTestDb() でフラグ消去・resetForTest・WebDriver 時 pause("test-harness") 再適用
    window.sessionStorage.setItem("exLibris:test:coverExtractionAutoRun", "1");
    await window.__exLibrisServices!.resetTestDb!();
    expect(
      window.sessionStorage.getItem("exLibris:test:coverExtractionAutoRun"),
    ).toBeNull();
    expect(
      capturedReload[0]!.coverExtractionScheduler.getSnapshot().pauseReasons,
    ).toContain("test-harness");
    unmountReload();

    // 3. Android ネイティブ環境 (isNative=true): 実 GoogleDriveRangeReader が構築され test-harness なしで稼働すること
    await resetTestDb();
    await seedOnePendingVolume();
    fetchSpy.mockClear();
    fetchSpy.mockResolvedValue(new Response("server-error", { status: 500 }));
    vi.spyOn(Capacitor, "isNativePlatform").mockReturnValue(true);

    const capturedNative: ServiceContextValue[] = [];
    const { unmount: unmountNative } = render(
      <ServiceProvider googleAuthBridge={createLinkedAuth()}>
        <ServicesProbe onCapture={(s) => capturedNative.push(s)} />
      </ServiceProvider>,
    );
    expect(capturedNative[0]!.coverExtractionScheduler).toBeInstanceOf(
      CoverExtractionSchedulerCore,
    );
    expect(
      capturedNative[0]!.coverExtractionScheduler.getSnapshot().pauseReasons,
    ).not.toContain("test-harness");
    await vi.waitFor(async () => {
      const vol = await db.volumes.get("vol-1");
      expect(vol?.coverStatus).toBe("error");
    });
    expect(fetchSpy).toHaveBeenCalled();
    unmountNative();

    // 4. sessionStorage 例外時も安全にフォールバックすること
    vi.spyOn(Capacitor, "isNativePlatform").mockReturnValue(false);
    vi.stubGlobal("navigator", { webdriver: true });
    const getItemSpy = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("blocked");
      });
    const setItemSpy = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("blocked");
      });
    const removeItemSpy = vi
      .spyOn(Storage.prototype, "removeItem")
      .mockImplementation(() => {
        throw new Error("blocked");
      });
    const { unmount: unmountStorageErr } = render(
      <ServiceProvider googleAuthBridge={createLinkedAuth()}>
        <div>storage-err</div>
      </ServiceProvider>,
    );
    window.__exLibrisServices!.setTestCoverExtractionAutoRun!(true);
    window.__exLibrisServices!.setTestCoverExtractionAutoRun!(false);
    unmountStorageErr();
    getItemSpy.mockRestore();
    setItemSpy.mockRestore();
    removeItemSpy.mockRestore();
  });

  it("coverExtractionStateStore・GoogleAuthBridge・driveSyncStateStoreの変化をcoverExtractionSchedulerへ自動連携すること (AC-COV-02, AC-COV-07)", async () => {
    let progressListener:
      ((snapshot: CoverExtractionProgressSnapshot) => void) | null = null;
    const initialSnapshot: CoverExtractionProgressSnapshot = {
      phase: "paused",
      totalCount: 3,
      readyCount: 1,
      pendingCount: 2,
      errorCount: 0,
      activeVolumeId: null,
      pauseReasons: ["unauthenticated"],
    };
    const scheduler: CoverExtractionScheduler = {
      syncQueue: vi.fn(async () => {}),
      setViewportVolumeIds: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
      retryFailedCovers: vi.fn(async () => 0),
      getSnapshot: vi.fn(() => initialSnapshot),
      subscribeProgress: vi.fn((listener) => {
        progressListener = listener;
        return () => {
          progressListener = null;
        };
      }),
      subscribeVolumeUpdated: vi.fn(() => () => {}),
      resetForTest: vi.fn(async () => {}),
      dispose: vi.fn(),
    };

    const sessionA: GoogleAuthSession = {
      email: "user@example.com",
      accessToken: "ya29.auth",
      expiresAt: Date.now() + 3_600_000,
    };
    let authListener: ((session: GoogleAuthSession | null) => void) | null =
      null;
    let resolveInitialSession!: (session: GoogleAuthSession | null) => void;
    const initialSessionPromise = new Promise<GoogleAuthSession | null>(
      (resolve) => {
        resolveInitialSession = resolve;
      },
    );
    const authBridge: GoogleAuthBridge = {
      getCachedSession: vi.fn(() => null),
      getSession: vi.fn(() => initialSessionPromise),
      signIn: vi.fn(async () => sessionA),
      signOut: vi.fn(async () => {}),
      getValidAccessToken: vi.fn(async () => sessionA.accessToken),
      subscribeSession: vi.fn((listener) => {
        authListener = listener;
        return () => {
          authListener = null;
        };
      }),
    };

    // 初期 syncing 状態からマウント
    useDriveSyncStateStore.setState({ phase: "syncing" });

    const { unmount } = render(
      <ServiceProvider
        googleAuthBridge={authBridge}
        coverExtractionScheduler={scheduler}
      >
        <div>sync-test</div>
      </ServiceProvider>,
    );

    // 1. 初期スナップショット即時反映 + 以降の進捗通知反映
    expect(useCoverExtractionStateStore.getState()).toMatchObject(
      initialSnapshot,
    );
    act(() => {
      progressListener?.({
        phase: "running",
        totalCount: 3,
        readyCount: 2,
        pendingCount: 1,
        errorCount: 0,
        activeVolumeId: "vol-2",
        pauseReasons: [],
      });
    });
    expect(useCoverExtractionStateStore.getState()).toMatchObject({
      phase: "running",
      readyCount: 2,
      pendingCount: 1,
      activeVolumeId: "vol-2",
    });

    // 2. 初期 syncing による pause("drive-sync") と syncing -> completed -> idle の遷移
    expect(scheduler.pause).toHaveBeenCalledWith("drive-sync");
    act(() => {
      useDriveSyncStateStore.setState({ phase: "completed" });
    });
    expect(scheduler.resume).toHaveBeenCalledWith("drive-sync");
    expect(scheduler.syncQueue).toHaveBeenCalledTimes(1);

    // 非 syncing 間の遷移 (completed -> idle) では不要な pause/resume を呼ばない
    act(() => {
      useDriveSyncStateStore.setState({ phase: "idle" });
    });
    expect(scheduler.syncQueue).toHaveBeenCalledTimes(1);

    // idle -> syncing で再度 pause("drive-sync")
    act(() => {
      useDriveSyncStateStore.setState({ phase: "syncing" });
    });
    expect(scheduler.pause).toHaveBeenLastCalledWith("drive-sync");

    // 3. 初期未認証キャッシュ時の pause("unauthenticated") -> getSession 解決で resume + syncQueue
    expect(scheduler.pause).toHaveBeenCalledWith("unauthenticated");
    await act(async () => {
      resolveInitialSession(sessionA);
      await initialSessionPromise;
    });
    expect(scheduler.resume).toHaveBeenCalledWith("unauthenticated");
    expect(scheduler.syncQueue).toHaveBeenCalledTimes(2);

    // subscribeSession によるログアウト/再ログイン
    act(() => {
      authListener?.(null);
    });
    expect(scheduler.pause).toHaveBeenLastCalledWith("unauthenticated");
    act(() => {
      authListener?.(sessionA);
    });
    expect(scheduler.resume).toHaveBeenLastCalledWith("unauthenticated");
    expect(scheduler.syncQueue).toHaveBeenCalledTimes(3);

    unmount();
    expect(progressListener).toBeNull();
    expect(authListener).toBeNull();

    // 4. getSession() が null 解決・失敗・アンマウント後解決のケース
    const scheduler2: CoverExtractionScheduler = {
      ...scheduler,
      pause: vi.fn(),
      resume: vi.fn(),
      syncQueue: vi.fn(async () => {}),
    };
    const failingAuth: GoogleAuthBridge = {
      ...authBridge,
      getCachedSession: vi.fn(() => null),
      getSession: vi.fn(async () => {
        throw new Error("auth failed");
      }),
      subscribeSession: vi.fn(() => () => {}),
    };
    const { unmount: unmountFail } = render(
      <ServiceProvider
        googleAuthBridge={failingAuth}
        coverExtractionScheduler={scheduler2}
      >
        <div>fail</div>
      </ServiceProvider>,
    );
    await vi.waitFor(() => {
      expect(scheduler2.pause).toHaveBeenCalledWith("unauthenticated");
    });
    expect(scheduler2.resume).not.toHaveBeenCalledWith("unauthenticated");
    unmountFail();

    // アンマウント後の遅延 getSession resolve / reject は無視されること
    const scheduler3: CoverExtractionScheduler = {
      ...scheduler,
      pause: vi.fn(),
      resume: vi.fn(),
      syncQueue: vi.fn(async () => {}),
    };
    let resolveLate!: (s: GoogleAuthSession | null) => void;
    const latePromise = new Promise<GoogleAuthSession | null>((r) => {
      resolveLate = r;
    });
    const lateAuth: GoogleAuthBridge = {
      ...authBridge,
      getCachedSession: vi.fn(() => null),
      getSession: vi.fn(() => latePromise),
      subscribeSession: vi.fn(() => () => {}),
    };
    const { unmount: unmountLate } = render(
      <ServiceProvider
        googleAuthBridge={lateAuth}
        coverExtractionScheduler={scheduler3}
      >
        <div>late</div>
      </ServiceProvider>,
    );
    unmountLate();
    await act(async () => {
      resolveLate(sessionA);
      await latePromise;
    });
    expect(scheduler3.resume).not.toHaveBeenCalled();

    let rejectLate!: (err: Error) => void;
    const lateRejectPromise = new Promise<GoogleAuthSession | null>(
      (_, rej) => {
        rejectLate = rej;
      },
    );
    const lateRejectAuth: GoogleAuthBridge = {
      ...authBridge,
      getCachedSession: vi.fn(() => null),
      getSession: vi.fn(() => lateRejectPromise),
      subscribeSession: vi.fn(() => () => {}),
    };
    const scheduler4: CoverExtractionScheduler = {
      ...scheduler,
      pause: vi.fn(),
      resume: vi.fn(),
      syncQueue: vi.fn(async () => {}),
    };
    const { unmount: unmountLateReject } = render(
      <ServiceProvider
        googleAuthBridge={lateRejectAuth}
        coverExtractionScheduler={scheduler4}
      >
        <div>late-reject</div>
      </ServiceProvider>,
    );
    unmountLateReject();
    await act(async () => {
      rejectLate(new Error("late boom"));
      await lateRejectPromise.catch(() => {});
    });
    expect(scheduler4.pause).toHaveBeenCalledTimes(1);
  });
});
