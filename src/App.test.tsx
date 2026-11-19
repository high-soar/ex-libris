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
import { diagnosticLogger } from "./diagnostics/diagnosticLogger";
import type { CoordinatorWorkerApi } from "./engine/types";
import * as BookshelfPageModule from "./features/bookshelf/BookshelfPage";
import * as ReaderPageModule from "./features/reader/ReaderPage";
import { useRouter } from "./shared/router/routerContext";

const { Default, CopiedFeedback, CopyFailedFeedback, ReaderLocalFallback } =
  composeStories(stories);

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

describe("App", () => {
  const originalUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;

  let bookshelfSpy: MockInstance<typeof BookshelfPageModule.BookshelfPage>;
  let readerSpy: MockInstance<typeof ReaderPageModule.ReaderPage>;

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

  it("全Storybookストーリーを描画しルートに応じた子PageへPropsを正しく渡すこと", () => {
    const { unmount: unmountDefault } = render(<Default />);
    expect(screen.getByTestId("app-root")).toHaveAttribute(
      "data-app-ready",
      "true",
    );
    expect(window.__exLibrisServices?.isReady).toBe(true);
    expect(getLatestBookshelfProps()).toEqual({ initialCopyStatus: "idle" });
    expect(readerSpy).not.toHaveBeenCalled();
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
    expect(getLatestBookshelfProps()).toEqual({ initialCopyStatus: "copied" });
    unmountCopied();

    bookshelfSpy.mockClear();
    const { unmount: unmountFailed } = render(<CopyFailedFeedback />);
    expect(getLatestBookshelfProps()).toEqual({ initialCopyStatus: "failed" });
    unmountFailed();

    bookshelfSpy.mockClear();
    readerSpy.mockClear();
    render(<ReaderLocalFallback />);
    expect(readerSpy).toHaveBeenCalledTimes(1);
    expect(getLatestReaderProps()).toEqual({
      onRegisterExit: expect.any(Function),
    });
    expect(bookshelfSpy).not.toHaveBeenCalled();
  });

  it("ルートパス（'/'・'/read/local'・未知パス）に応じてBookshelfPageとReaderPageを切り替えること", () => {
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
    expect(readerSpy).not.toHaveBeenCalled();

    // Bookshelf -> /read/local への遷移で ReaderPage へ切り替わる
    act(() => {
      triggerNavigate?.("/read/local");
    });
    expect(readerSpy).toHaveBeenCalledTimes(1);
    unmountUnknown();

    bookshelfSpy.mockClear();
    readerSpy.mockClear();
    render(<App initialPath="/read/local" />);
    expect(readerSpy).toHaveBeenCalledTimes(1);
    expect(bookshelfSpy).not.toHaveBeenCalled();
  });

  it("AppBridgeのハードウェア戻るボタンで優先度3(TR-08終了)と優先度5(minimizeApp)を実行しアンマウント時に解除すること", async () => {
    const bridge = new MockAppBridge();
    const customSessionFactory = vi.fn((): CoordinatorSessionHandle => ({
      api: {} as CoordinatorWorkerApi,
      dispose: vi.fn(),
    }));

    let capturedFactory: (() => CoordinatorSessionHandle) | null = null;
    let triggerNavigate: ((to: string) => void) | null = null;
    bookshelfSpy.mockImplementation(() => {
      const services = useServices();
      const router = useRouter();
      capturedFactory = services.createCoordinatorSession;
      triggerNavigate = router.navigate;
      return null as unknown as ReactElement;
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
