import { Capacitor } from "@capacitor/core";
import { composeStories } from "@storybook/react";
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CapacitorAppBridge } from "../bridges/app/capacitorAppBridge";
import { MockAppBridge } from "../bridges/app/mockAppBridge";
import type { AppBridge } from "../bridges/app/types";
import type { CoordinatorWorkerApi } from "../engine/types";
import { db, resetTestDb } from "../storage/db";
import { ServiceProvider } from "./ServiceProvider";
import * as stories from "./ServiceProvider.stories";
import {
  createCoordinatorSession,
  type CoordinatorSessionHandle,
} from "./coordinatorClient";
import { useServices } from "./serviceContext";

const { Default, InjectedServices } = composeStories(stories);

function ServicesProbe({
  onCapture,
}: {
  onCapture: (services: {
    appBridge: AppBridge;
    createCoordinatorSession: () => CoordinatorSessionHandle;
  }) => void;
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

  it("Capacitor.isNativePlatform()がfalseのときはMockAppBridgeを自動構築し参照を安定維持すること", () => {
    vi.spyOn(Capacitor, "isNativePlatform").mockReturnValue(false);
    const captured: Array<{
      appBridge: AppBridge;
      createCoordinatorSession: () => CoordinatorSessionHandle;
    }> = [];

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
    expect(window.__exLibrisServices).toEqual({
      isReady: true,
      appBridge: captured[0]?.appBridge,
      resetTestDb: expect.any(Function),
    });

    // 再レンダー時も同一の MockAppBridge インスタンスを維持すること
    rerender(
      <ServiceProvider>
        <ServicesProbe onCapture={(s) => captured.push(s)} />
      </ServiceProvider>,
    );
    expect(captured).toHaveLength(2);
    expect(captured[1]?.appBridge).toBe(captured[0]?.appBridge);
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

  it("DI props指定時は注入されたappBridgeとcreateCoordinatorSessionを使用・更新すること", () => {
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

    const captured: Array<{
      appBridge: AppBridge;
      createCoordinatorSession: () => CoordinatorSessionHandle;
    }> = [];

    const { rerender } = render(
      <ServiceProvider
        appBridge={customBridge1}
        createCoordinatorSession={customFactory}
      >
        <ServicesProbe onCapture={(s) => captured.push(s)} />
      </ServiceProvider>,
    );

    expect(captured[0]?.appBridge).toBe(customBridge1);
    expect(captured[0]?.createCoordinatorSession).toBe(customFactory);
    expect(window.__exLibrisServices).toEqual({
      isReady: true,
      appBridge: customBridge1,
      resetTestDb: expect.any(Function),
    });

    rerender(
      <ServiceProvider
        appBridge={customBridge2}
        createCoordinatorSession={customFactory}
      >
        <ServicesProbe onCapture={(s) => captured.push(s)} />
      </ServiceProvider>,
    );

    expect(captured[1]?.appBridge).toBe(customBridge2);
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
