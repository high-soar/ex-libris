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
import { GoogleDriveFolderClient } from "../providers/gdrive/googleDriveFolderClient";
import { MockDriveFolderClient } from "../providers/gdrive/mockDriveFolderClient";
import type { DriveFolderClient } from "../providers/gdrive/types";
import { db, resetTestDb } from "../storage/db";
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
    resetGlobalServices();
    await resetTestDb();
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
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
    expect(window.__exLibrisServices).toEqual({
      isReady: true,
      appBridge: captured[0]?.appBridge,
      resetTestDb: expect.any(Function),
      mockGoogleAuthAdapter: expect.any(MockGoogleAuthAdapter),
      mockDriveFolderClient: captured[0]?.driveFolderClient,
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
    expect(window.__exLibrisServices).toEqual({
      isReady: true,
      appBridge: customBridge1,
      resetTestDb: expect.any(Function),
    });
    expect("mockGoogleAuthAdapter" in window.__exLibrisServices!).toBe(false);
    expect("mockDriveFolderClient" in window.__exLibrisServices!).toBe(false);

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
    expect(window.__exLibrisServices).toEqual({
      isReady: true,
      appBridge: customBridge2,
      resetTestDb: expect.any(Function),
      mockDriveFolderClient: customFolderClient2,
    });
    expect("mockGoogleAuthAdapter" in window.__exLibrisServices!).toBe(false);
  });

  it("window.__exLibrisServices.resetTestDbが公開され呼び出しによりsyncMeta等のDBテーブルを初期化できること (R1-17)", async () => {
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

    const resetFn = window.__exLibrisServices?.resetTestDb;
    expect(resetFn).toEqual(expect.any(Function));
    await resetFn!();

    expect(await db.syncMeta.count()).toBe(0);
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
});
