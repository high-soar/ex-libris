import { composeStories } from "@storybook/react";
import { act, cleanup, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type MockInstance,
  vi,
} from "vitest";
import { App } from "./App";
import * as stories from "./App.stories";
import { useServices } from "./app/serviceContext";
import type { CoordinatorSessionHandle } from "./app/coordinatorClient";
import { MockAppBridge } from "./bridges/app/mockAppBridge";
import {
  createDiagnosticLogger,
  diagnosticLogger,
} from "./diagnostics/diagnosticLogger";
import type { CoordinatorWorkerApi } from "./engine/types";
import * as BookshelfPageModule from "./features/bookshelf/BookshelfPage";
import * as ReaderPageModule from "./features/reader/ReaderPage";
import * as SettingsPageModule from "./features/settings/SettingsPage";
import { useRouter } from "./shared/router/routerContext";

const {
  Default,
  CopiedFeedback,
  CopyFailedFeedback,
  SettingsRoute,
  ReaderLocalFallback,
} = composeStories(stories);

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

describe("App", () => {
  const originalUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;

  let bookshelfSpy: MockInstance<typeof BookshelfPageModule.BookshelfPage>;
  let readerSpy: MockInstance<typeof ReaderPageModule.ReaderPage>;
  let settingsSpy: MockInstance<typeof SettingsPageModule.SettingsPage>;

  beforeEach(() => {
    diagnosticLogger.clear();
    delete window.__exLibrisServices;
    window.history.replaceState(null, "", "/");

    bookshelfSpy = vi
      .spyOn(BookshelfPageModule, "BookshelfPage")
      .mockImplementation(() => null as unknown as ReactElement);
    readerSpy = vi
      .spyOn(ReaderPageModule, "ReaderPage")
      .mockImplementation(() => null);
    settingsSpy = vi
      .spyOn(SettingsPageModule, "SettingsPage")
      .mockImplementation(() => null);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    window.history.replaceState(null, "", originalUrl || "/");
    delete window.__exLibrisServices;
  });

  const getLatestBookshelfProps =
    (): BookshelfPageModule.BookshelfPageProps => {
      const lastCall = bookshelfSpy.mock.calls.at(-1);
      expect(lastCall).toBeDefined();
      return lastCall![0] as BookshelfPageModule.BookshelfPageProps;
    };

  const getLatestReaderProps = (): ReaderPageModule.ReaderPageProps => {
    const lastCall = readerSpy.mock.calls.at(-1);
    expect(lastCall).toBeDefined();
    return lastCall![0] as ReaderPageModule.ReaderPageProps;
  };

  const getLatestSettingsProps = (): SettingsPageModule.SettingsPageProps => {
    const lastCall = settingsSpy.mock.calls.at(-1);
    expect(lastCall).toBeDefined();
    return lastCall![0] as SettingsPageModule.SettingsPageProps;
  };

  it("全Storybookストーリーを描画しルートに応じた子PageへPropsを正しく渡すこと", () => {
    const { unmount: unmountDefault } = render(<Default />);
    expect(screen.getByTestId("app-root")).toHaveAttribute(
      "data-app-ready",
      "true",
    );
    expect(window.__exLibrisServices?.isReady).toBe(true);
    expect(getLatestBookshelfProps()).toEqual({
      initialCopyStatus: "idle",
      initialDriveSetupState: { kind: "ready" },
    });
    expect(readerSpy).not.toHaveBeenCalled();
    expect(settingsSpy).not.toHaveBeenCalled();
    expect(diagnosticLogger.getEntries()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: "info",
          scope: "app",
        }),
      ]),
    );
    unmountDefault();

    bookshelfSpy.mockClear();
    const { unmount: unmountCopied } = render(<CopiedFeedback />);
    expect(getLatestBookshelfProps()).toEqual({
      initialCopyStatus: "copied",
      initialDriveSetupState: { kind: "ready" },
    });
    unmountCopied();

    bookshelfSpy.mockClear();
    const { unmount: unmountFailed } = render(<CopyFailedFeedback />);
    expect(getLatestBookshelfProps()).toEqual({
      initialCopyStatus: "failed",
      initialDriveSetupState: { kind: "ready" },
    });
    unmountFailed();

    bookshelfSpy.mockClear();
    settingsSpy.mockClear();
    const { unmount: unmountSettings } = render(<SettingsRoute />);
    expect(settingsSpy).toHaveBeenCalledTimes(1);
    expect(bookshelfSpy).not.toHaveBeenCalled();
    expect(getLatestSettingsProps()).toEqual({
      onRegisterModalBack: expect.any(Function),
      initialSnapshot: expect.objectContaining({
        authState: expect.objectContaining({ status: "connected" }),
      }),
    });
    unmountSettings();

    bookshelfSpy.mockClear();
    readerSpy.mockClear();
    settingsSpy.mockClear();
    render(<ReaderLocalFallback />);
    expect(readerSpy).toHaveBeenCalledTimes(1);
    expect(getLatestReaderProps()).toEqual({
      onRegisterExit: expect.any(Function),
    });
    expect(bookshelfSpy).not.toHaveBeenCalled();
  });

  it("ルートパス（'/'・'/settings'・'/read/local'・未知パス）に応じてBookshelfPage・SettingsPage・ReaderPageを切り替えること", () => {
    let triggerNavigate: ((to: string) => void) | null = null;
    bookshelfSpy.mockImplementation(() => {
      const { navigate } = useRouter();
      triggerNavigate = navigate;
      return null as unknown as ReactElement;
    });

    const { unmount: unmountUnknown } = render(
      <App initialPath="/unknown/path" />,
    );
    expect(bookshelfSpy).toHaveBeenCalledTimes(1);
    expect(getLatestBookshelfProps()).toEqual({ initialCopyStatus: "idle" });
    expect(readerSpy).not.toHaveBeenCalled();
    expect(settingsSpy).not.toHaveBeenCalled();

    // Bookshelf -> /settings への遷移で SettingsPage へ切り替わる
    act(() => {
      triggerNavigate?.("/settings");
    });
    expect(settingsSpy).toHaveBeenCalledTimes(1);

    // /settings -> /read/local への遷移で ReaderPage へ切り替わる
    act(() => {
      triggerNavigate?.("/read/local");
    });
    expect(readerSpy).toHaveBeenCalledTimes(1);
    unmountUnknown();

    const customLogger = createDiagnosticLogger(10);
    bookshelfSpy.mockClear();
    readerSpy.mockClear();
    settingsSpy.mockClear();
    render(<App initialPath="/settings" settingsLogger={customLogger} />);
    expect(settingsSpy).toHaveBeenCalledTimes(1);
    expect(getLatestSettingsProps()).toEqual({
      onRegisterModalBack: expect.any(Function),
      logger: customLogger,
    });

    bookshelfSpy.mockClear();
    readerSpy.mockClear();
    settingsSpy.mockClear();
    render(<App initialPath="/read/local" />);
    expect(readerSpy).toHaveBeenCalledTimes(1);
    expect(bookshelfSpy).not.toHaveBeenCalled();
  });

  it("AppBridgeのハードウェア戻るボタンで優先度1(isBackBlocked)・2(Settingsモーダル)・3(TR-08終了)・4(/settings復帰)・5(minimizeApp)を実行しアンマウント時に解除すること", async () => {
    const bridge = new MockAppBridge();
    const customSessionFactory = vi.fn((): CoordinatorSessionHandle => ({
      api: {} as CoordinatorWorkerApi,
      dispose: vi.fn(),
    }));

    let capturedFactory: (() => CoordinatorSessionHandle) | null = null;
    let triggerNavigate: ((to: string) => void) | null = null;
    let setBackBlockedRef: ((blocked: boolean) => void) | null = null;
    let currentRoutePath = "/";

    bookshelfSpy.mockImplementation(() => {
      const services = useServices();
      const router = useRouter();
      capturedFactory = services.createCoordinatorSession;
      triggerNavigate = router.navigate;
      setBackBlockedRef = router.setBackBlocked;
      currentRoutePath = router.route.path;
      return null as unknown as ReactElement;
    });
    settingsSpy.mockImplementation(() => {
      const router = useRouter();
      triggerNavigate = router.navigate;
      setBackBlockedRef = router.setBackBlocked;
      currentRoutePath = router.route.path;
      return null;
    });

    const { unmount } = render(
      <App
        initialPath="/"
        appBridge={bridge}
        createCoordinatorSession={customSessionFactory}
      />,
    );

    expect(window.__exLibrisServices?.appBridge).toBe(bridge);
    expect(capturedFactory).toBe(customSessionFactory);

    // 優先度 5: SCR-01 表示中に戻るボタン押下 -> minimizeApp() 実行
    await act(async () => {
      await bridge.triggerBackButton();
    });
    expect(bridge.getMinimizeAppCallCount()).toBe(1);

    // 優先度 1 + 2 + 4: /settings へ遷移
    act(() => {
      triggerNavigate?.("/settings");
    });
    expect(currentRoutePath).toBe("/settings");

    const modalBackSpy = vi.fn();
    act(() => {
      getLatestSettingsProps().onRegisterModalBack?.(modalBackSpy);
      setBackBlockedRef?.(true);
    });

    // 優先度 1: isBackBlocked=true 中はモーダル閉鎖・戻る遷移・minimize いずれも発火しない
    await act(async () => {
      await bridge.triggerBackButton();
    });
    expect(modalBackSpy).not.toHaveBeenCalled();
    expect(currentRoutePath).toBe("/settings");
    expect(bridge.getMinimizeAppCallCount()).toBe(1);

    // 優先度 2: isBackBlocked=false かつモーダル登録あり -> モーダルのみ閉鎖し /settings に留まる
    act(() => {
      setBackBlockedRef?.(false);
    });
    await act(async () => {
      await bridge.triggerBackButton();
    });
    expect(modalBackSpy).toHaveBeenCalledTimes(1);
    expect(currentRoutePath).toBe("/settings");
    expect(bridge.getMinimizeAppCallCount()).toBe(1);

    // 優先度 4: モーダル登録解除後 -> /settings から前画面 '/' へ復帰 (TR-09)
    act(() => {
      getLatestSettingsProps().onRegisterModalBack?.(null);
    });
    await act(async () => {
      await bridge.triggerBackButton();
    });
    await act(async () => {
      await vi.waitFor(() => {
        expect(currentRoutePath).toBe("/");
      });
    });
    expect(bridge.getMinimizeAppCallCount()).toBe(1);

    // 優先度 3: /read/local 遷移後、登録された exit コールバックを実行（未登録時は安全にノーオペ）
    act(() => {
      triggerNavigate?.("/read/local");
    });
    await act(async () => {
      await bridge.triggerBackButton();
    });
    expect(bridge.getMinimizeAppCallCount()).toBe(1);

    const exitSpy = vi.fn();
    act(() => {
      getLatestReaderProps().onRegisterExit?.(exitSpy);
    });
    await act(async () => {
      await bridge.triggerBackButton();
    });
    expect(exitSpy).toHaveBeenCalledTimes(1);
    expect(bridge.getMinimizeAppCallCount()).toBe(1);

    // 登録解除 (null) 後の backButton は安全にノーオペとなること
    act(() => {
      getLatestReaderProps().onRegisterExit?.(null);
    });
    await act(async () => {
      await bridge.triggerBackButton();
    });
    expect(exitSpy).toHaveBeenCalledTimes(1);
    expect(bridge.getMinimizeAppCallCount()).toBe(1);

    // アンマウント後はバックキーリスナーが解除されること
    unmount();
    await act(async () => {
      await bridge.triggerBackButton();
    });
    expect(exitSpy).toHaveBeenCalledTimes(1);
    expect(bridge.getMinimizeAppCallCount()).toBe(1);
  });

  it("minimizeAppが拒否されても未処理Promise拒否を発生させないこと", async () => {
    const bridge = new MockAppBridge();
    vi.spyOn(bridge, "minimizeApp").mockRejectedValue(
      new Error("minimize failed"),
    );

    const unhandledRejections: unknown[] = [];
    const onUnhandled = (reason: unknown) => {
      unhandledRejections.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);

    try {
      render(<App initialPath="/" appBridge={bridge} />);
      await act(async () => {
        await bridge.triggerBackButton();
        await flushMicrotasks();
      });
      expect(bridge.minimizeApp).toHaveBeenCalledTimes(1);
      expect(unhandledRejections).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });
});
