import { Capacitor } from "@capacitor/core";
import { composeStories } from "@storybook/react";
import { render, screen } from "@testing-library/react";
import * as Comlink from "comlink";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CapacitorAppBridge } from "../bridges/app/capacitorAppBridge";
import { MockAppBridge } from "../bridges/app/mockAppBridge";
import type { AppBridge } from "../bridges/app/types";
import { CapacitorGoogleAuthAdapter } from "../bridges/oauth/capacitorGoogleAuthAdapter";
import { GoogleAuthTokenManager } from "../bridges/oauth/googleAuthTokenManager";
import { MockGoogleAuthAdapter } from "../bridges/oauth/mockGoogleAuthAdapter";
import type { GoogleAuthBridge } from "../bridges/oauth/types";
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
    window.sessionStorage.clear();
    resetGlobalServices();
    await resetTestDb();
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
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
      listRecentLocal: vi.fn(async () => []),
      delete: vi.fn(async () => {}),
      clearLocal: vi.fn(async () => {}),
    };
    const customProgressRepo2: ReadingProgressRepository = {
      get: vi.fn(async () => null),
      put: vi.fn(async () => {}),
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

    const captured: ServiceContextValue[] = [];

    const { rerender } = render(
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
    expect(window.__exLibrisServices).toEqual({
      isReady: true,
      appBridge: customBridge1,
      resetTestDb: expect.any(Function),
      driveSyncEngine: customSyncEngine1,
      seriesRepo: customSeriesRepo1,
      volumesRepo: customVolumesRepo1,
      driveSyncMetaRepo: customSyncMetaRepo1,
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
    });
    expect("mockGoogleAuthAdapter" in window.__exLibrisServices!).toBe(false);
  });

  it("window.__exLibrisServices.resetTestDbが公開され呼び出しによりsyncMeta等のDBテーブルとmockDriveSyncClientを初期化できること (R1-17)", async () => {
    render(
      <ServiceProvider>
        <div>ready</div>
      </ServiceProvider>,
    );

    await db.syncMeta.put({
      key: "itPollutionGuard",
      value: "stale-record",
    });
    expect(await db.syncMeta.count()).toBe(1);
    const mockSyncResetSpy = vi.spyOn(
      window.__exLibrisServices!.mockDriveSyncClient!,
      "reset",
    );

    const resetFn = window.__exLibrisServices?.resetTestDb;
    expect(resetFn).toEqual(expect.any(Function));
    await resetFn!();

    expect(await db.syncMeta.count()).toBe(0);
    expect(mockSyncResetSpy).toHaveBeenCalledTimes(1);
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
});
