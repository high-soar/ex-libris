import { Capacitor } from "@capacitor/core";
import { composeStories } from "@storybook/react";
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CapacitorAppBridge } from "../bridges/app/capacitorAppBridge";
import { MockAppBridge } from "../bridges/app/mockAppBridge";
import type { AppBridge } from "../bridges/app/types";
import type { CoordinatorWorkerApi } from "../engine/types";
import { db, resetTestDb } from "../storage/db";
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
import { ServiceProvider } from "./ServiceProvider";
import * as stories from "./ServiceProvider.stories";
import {
  createCoordinatorSession,
  type CoordinatorSessionHandle,
} from "./coordinatorClient";
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

  it("Capacitor.isNativePlatform()がfalseのときはMockAppBridgeとDexie各Repositoryを自動構築し参照を安定維持すること", () => {
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
    expect(captured[0]?.createCoordinatorSession).toBe(
      createCoordinatorSession,
    );
    expect(captured[0]?.zipIndexCacheRepo).toBeInstanceOf(
      DexieZipIndexCacheRepository,
    );
    expect(captured[0]?.readingProgressRepo).toBeInstanceOf(
      DexieReadingProgressRepository,
    );
    expect(captured[0]?.readerSettingsRepo).toBeInstanceOf(
      DexieReaderSettingsRepository,
    );
    expect(window.__exLibrisServices).toEqual({
      isReady: true,
      appBridge: captured[0]?.appBridge,
      resetTestDb: expect.any(Function),
    });

    // 再レンダー時も同一の MockAppBridge と Dexie Repository インスタンスを維持すること
    rerender(
      <ServiceProvider>
        <ServicesProbe onCapture={(s) => captured.push(s)} />
      </ServiceProvider>,
    );
    expect(captured).toHaveLength(2);
    expect(captured[1]?.appBridge).toBe(captured[0]?.appBridge);
    expect(captured[1]?.zipIndexCacheRepo).toBe(captured[0]?.zipIndexCacheRepo);
    expect(captured[1]?.readingProgressRepo).toBe(
      captured[0]?.readingProgressRepo,
    );
    expect(captured[1]?.readerSettingsRepo).toBe(
      captured[0]?.readerSettingsRepo,
    );
  });

  it("Capacitor.isNativePlatform()がtrueのときはCapacitorAppBridgeを自動構築すること", () => {
    vi.spyOn(Capacitor, "isNativePlatform").mockReturnValue(true);
    let capturedBridge: AppBridge | null = null;

    render(
      <ServiceProvider>
        <ServicesProbe
          onCapture={(s) => {
            capturedBridge = s.appBridge;
          }}
        />
      </ServiceProvider>,
    );

    expect(capturedBridge).toBeInstanceOf(CapacitorAppBridge);
    expect(window.__exLibrisServices).toEqual({
      isReady: true,
      appBridge: capturedBridge,
      resetTestDb: expect.any(Function),
    });
  });

  it("DI props指定時は注入されたappBridge・createCoordinatorSession・各Repositoryを使用・更新すること", () => {
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

    const captured: ServiceContextValue[] = [];

    const { rerender } = render(
      <ServiceProvider
        appBridge={customBridge1}
        createCoordinatorSession={customFactory}
        zipIndexCacheRepo={customRepo1}
        readingProgressRepo={customProgressRepo1}
        readerSettingsRepo={customSettingsRepo1}
      >
        <ServicesProbe onCapture={(s) => captured.push(s)} />
      </ServiceProvider>,
    );

    expect(captured[0]?.appBridge).toBe(customBridge1);
    expect(captured[0]?.createCoordinatorSession).toBe(customFactory);
    expect(captured[0]?.zipIndexCacheRepo).toBe(customRepo1);
    expect(captured[0]?.readingProgressRepo).toBe(customProgressRepo1);
    expect(captured[0]?.readerSettingsRepo).toBe(customSettingsRepo1);
    expect(window.__exLibrisServices).toEqual({
      isReady: true,
      appBridge: customBridge1,
      resetTestDb: expect.any(Function),
    });

    rerender(
      <ServiceProvider
        appBridge={customBridge2}
        createCoordinatorSession={customFactory}
        zipIndexCacheRepo={customRepo2}
        readingProgressRepo={customProgressRepo2}
        readerSettingsRepo={customSettingsRepo2}
      >
        <ServicesProbe onCapture={(s) => captured.push(s)} />
      </ServiceProvider>,
    );

    expect(captured[1]?.appBridge).toBe(customBridge2);
    expect(captured[1]?.zipIndexCacheRepo).toBe(customRepo2);
    expect(captured[1]?.readingProgressRepo).toBe(customProgressRepo2);
    expect(captured[1]?.readerSettingsRepo).toBe(customSettingsRepo2);
    expect(window.__exLibrisServices).toEqual({
      isReady: true,
      appBridge: customBridge2,
      resetTestDb: expect.any(Function),
    });
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
});
