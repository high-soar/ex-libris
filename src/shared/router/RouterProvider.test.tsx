import { composeStories } from "@storybook/react";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode, useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RouterProvider } from "./RouterProvider";
import * as stories from "./RouterProvider.stories";
import { useRouter } from "./routerContext";

const { Default, LocalReaderRoute, SettingsRoute, UnknownFallbackRoute } =
  composeStories(stories);

function RouterConsumerProbe() {
  const {
    currentPath,
    route,
    readerOriginState,
    navigate,
    replace,
    back,
    exitReader,
    isBackBlocked,
    setBackBlocked,
  } = useRouter();

  return (
    <div>
      <span data-testid="probe-current-path">{currentPath}</span>
      <span data-testid="probe-route-name">{route.name}</span>
      <span data-testid="probe-route-path">{route.path}</span>
      <span data-testid="probe-reader-origin">
        {readerOriginState.readerOrigin ?? "null"}
      </span>
      <span data-testid="probe-reader-origin-series">
        {readerOriginState.seriesId ?? "null"}
      </span>
      <span data-testid="probe-can-go-back-from">
        {readerOriginState.canGoBackFrom ?? "null"}
      </span>
      <span data-testid="probe-back-blocked">{String(isBackBlocked)}</span>
      <button
        type="button"
        data-testid="btn-nav-reader"
        onClick={() => navigate("/read/local")}
      >
        to reader
      </button>
      <button
        type="button"
        data-testid="btn-nav-settings"
        onClick={() => navigate("/settings")}
      >
        to settings
      </button>
      <button
        type="button"
        data-testid="btn-nav-series"
        onClick={() => navigate("/series/s-1")}
      >
        to series
      </button>
      <button
        type="button"
        data-testid="btn-nav-vol-from-bookshelf"
        onClick={() =>
          navigate("/read/volume/v-1", {
            readerOrigin: "bookshelf",
            seriesId: "s-1",
          })
        }
      >
        to vol from bookshelf
      </button>
      <button
        type="button"
        data-testid="btn-nav-vol-from-series"
        onClick={() =>
          navigate("/read/volume/v-1", {
            readerOrigin: "series-detail",
            seriesId: "s-1",
          })
        }
      >
        to vol from series
      </button>
      <button
        type="button"
        data-testid="btn-nav-replace-vol-origin"
        onClick={() =>
          navigate("/read/volume/v-2", {
            replace: true,
            readerOrigin: "series-detail",
            seriesId: "s-2",
          })
        }
      >
        replace vol with origin
      </button>
      <button
        type="button"
        data-testid="btn-nav-replace-home"
        onClick={() => navigate("/", { replace: true })}
      >
        replace home via navigate
      </button>
      <button
        type="button"
        data-testid="btn-replace-reader"
        onClick={() => replace("/read/local")}
      >
        replace reader
      </button>
      <button
        type="button"
        data-testid="btn-replace-empty"
        onClick={() => replace("   ")}
      >
        replace empty
      </button>
      <button type="button" data-testid="btn-back" onClick={back}>
        back
      </button>
      <button
        type="button"
        data-testid="btn-exit-reader"
        onClick={() => exitReader()}
      >
        exit reader
      </button>
      <button
        type="button"
        data-testid="btn-exit-reader-fallback"
        onClick={() => exitReader("s-fallback")}
      >
        exit reader with fallback
      </button>
      <button
        type="button"
        data-testid="btn-block-back"
        onClick={() => setBackBlocked(true)}
      >
        block back
      </button>
      <button
        type="button"
        data-testid="btn-unblock-back"
        onClick={() => setBackBlocked(false)}
      >
        unblock back
      </button>
    </div>
  );
}

describe("RouterProvider", () => {
  const originalUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;

  beforeEach(() => {
    window.history.replaceState(null, "", "/");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.history.replaceState(null, "", originalUrl || "/");
  });

  it("全Storybookストーリー（Default / LocalReaderRoute / SettingsRoute / UnknownFallbackRoute）を描画できること", () => {
    const { unmount: unmountDefault } = render(<Default />);
    expect(screen.getByTestId("story-route-name")).toHaveTextContent(
      "bookshelf",
    );
    expect(screen.getByTestId("story-route-path")).toHaveTextContent("/");
    expect(screen.getByTestId("story-current-path")).toHaveTextContent("/");
    expect(screen.getByTestId("story-back-blocked")).toHaveTextContent("false");
    unmountDefault();

    const { unmount: unmountReader } = render(<LocalReaderRoute />);
    expect(screen.getByTestId("story-route-name")).toHaveTextContent(
      "reader-local",
    );
    expect(screen.getByTestId("story-route-path")).toHaveTextContent(
      "/read/local",
    );
    expect(screen.getByTestId("story-current-path")).toHaveTextContent(
      "/read/local",
    );
    unmountReader();

    const { unmount: unmountSettings } = render(<SettingsRoute />);
    expect(screen.getByTestId("story-route-name")).toHaveTextContent(
      "settings",
    );
    expect(screen.getByTestId("story-route-path")).toHaveTextContent(
      "/settings",
    );
    expect(screen.getByTestId("story-current-path")).toHaveTextContent(
      "/settings",
    );
    unmountSettings();

    render(<UnknownFallbackRoute />);
    expect(screen.getByTestId("story-route-name")).toHaveTextContent(
      "bookshelf",
    );
    expect(screen.getByTestId("story-route-path")).toHaveTextContent("/");
    expect(screen.getByTestId("story-current-path")).toHaveTextContent(
      "/unknown/path",
    );
  });

  it("initialPath未指定時はwindow.locationから初期ルートを解決すること", () => {
    window.history.replaceState(null, "", "/read/local?from=test");

    render(
      <RouterProvider>
        <RouterConsumerProbe />
      </RouterProvider>,
    );

    expect(screen.getByTestId("probe-current-path")).toHaveTextContent(
      "/read/local?from=test",
    );
    expect(screen.getByTestId("probe-route-name")).toHaveTextContent(
      "reader-local",
    );
    expect(screen.getByTestId("probe-route-path")).toHaveTextContent(
      "/read/local",
    );
  });

  it("navigate・replace・同一パス抑止がHistory APIと同期すること", async () => {
    const user = userEvent.setup();
    const pushStateSpy = vi.spyOn(window.history, "pushState");
    const replaceStateSpy = vi.spyOn(window.history, "replaceState");

    render(
      <RouterProvider initialPath="/">
        <RouterConsumerProbe />
      </RouterProvider>,
    );

    // pushState で /read/local へ遷移（履歴マーカー付与）
    await user.click(screen.getByTestId("btn-nav-reader"));
    expect(pushStateSpy).toHaveBeenCalledTimes(1);
    expect(pushStateSpy).toHaveBeenCalledWith(
      { exLibrisCanGoBackFrom: "/" },
      "",
      "/read/local",
    );
    expect(screen.getByTestId("probe-current-path")).toHaveTextContent(
      "/read/local",
    );
    expect(screen.getByTestId("probe-route-name")).toHaveTextContent(
      "reader-local",
    );

    // 同一パスへの重複 navigate はノーオペ
    await user.click(screen.getByTestId("btn-nav-reader"));
    expect(pushStateSpy).toHaveBeenCalledTimes(1);
    expect(replaceStateSpy).not.toHaveBeenCalled();

    // navigate("/", { replace: true }) で replaceState 遷移
    await user.click(screen.getByTestId("btn-nav-replace-home"));
    expect(replaceStateSpy).toHaveBeenCalledTimes(1);
    expect(replaceStateSpy).toHaveBeenCalledWith(null, "", "/");
    expect(screen.getByTestId("probe-route-name")).toHaveTextContent(
      "bookshelf",
    );

    // replace("/read/local") で replaceState 遷移
    await user.click(screen.getByTestId("btn-replace-reader"));
    expect(replaceStateSpy).toHaveBeenCalledTimes(2);
    expect(replaceStateSpy).toHaveBeenLastCalledWith(null, "", "/read/local");
    expect(screen.getByTestId("probe-route-name")).toHaveTextContent(
      "reader-local",
    );

    // 空白ターゲットへの replace は "/" へ正規化して遷移
    await user.click(screen.getByTestId("btn-replace-empty"));
    expect(replaceStateSpy).toHaveBeenCalledTimes(3);
    expect(replaceStateSpy).toHaveBeenLastCalledWith(null, "", "/");
    expect(screen.getByTestId("probe-route-name")).toHaveTextContent(
      "bookshelf",
    );
  });

  it("back()はreader-local時は'/'へ安全戻りし、bookshelf時はノーオペであること", async () => {
    const user = userEvent.setup();
    const pushStateSpy = vi.spyOn(window.history, "pushState");
    const replaceStateSpy = vi.spyOn(window.history, "replaceState");

    render(
      <RouterProvider initialPath="/read/local">
        <RouterConsumerProbe />
      </RouterProvider>,
    );

    // reader-local からの back() は履歴マーカー不在時に "/" へ replace フォールバック
    await user.click(screen.getByTestId("btn-back"));
    expect(replaceStateSpy).toHaveBeenCalledTimes(1);
    expect(replaceStateSpy).toHaveBeenCalledWith(null, "", "/");
    expect(screen.getByTestId("probe-current-path")).toHaveTextContent("/");
    expect(screen.getByTestId("probe-route-name")).toHaveTextContent(
      "bookshelf",
    );

    // bookshelf での back() はノーオペ
    await user.click(screen.getByTestId("btn-back"));
    expect(replaceStateSpy).toHaveBeenCalledTimes(1);
    expect(pushStateSpy).not.toHaveBeenCalled();
  });

  it("back()は'/'からpushState遷移したreader-localではwindow.history.back()で巻き戻し、それ以外の起点はreplace('/')へフォールバックすること", async () => {
    const user = userEvent.setup();
    const historyBackSpy = vi.spyOn(window.history, "back");
    const replaceStateSpy = vi.spyOn(window.history, "replaceState");

    const { unmount } = render(
      <RouterProvider initialPath="/">
        <RouterConsumerProbe />
      </RouterProvider>,
    );

    // 1. "/" -> pushState("/read/local") 後の back() は window.history.back() で履歴を巻き戻す
    await user.click(screen.getByTestId("btn-nav-reader"));
    expect(screen.getByTestId("probe-current-path")).toHaveTextContent(
      "/read/local",
    );
    replaceStateSpy.mockClear();

    await user.click(screen.getByTestId("btn-back"));
    expect(historyBackSpy).toHaveBeenCalledTimes(1);
    expect(replaceStateSpy).not.toHaveBeenCalled();

    await act(async () => {
      await vi.waitFor(() => {
        expect(screen.getByTestId("probe-current-path")).toHaveTextContent("/");
      });
    });
    expect(screen.getByTestId("probe-route-name")).toHaveTextContent(
      "bookshelf",
    );
    unmount();

    // 2. 起点マーカーが "/" 以外（例: "/unknown"）の場合は replace("/") へフォールバック
    window.history.replaceState(
      { exLibrisCanGoBackFrom: "/unknown" },
      "",
      "/read/local",
    );
    render(
      <RouterProvider>
        <RouterConsumerProbe />
      </RouterProvider>,
    );

    historyBackSpy.mockClear();
    replaceStateSpy.mockClear();
    await user.click(screen.getByTestId("btn-back"));
    expect(historyBackSpy).not.toHaveBeenCalled();
    expect(replaceStateSpy).toHaveBeenCalledWith(null, "", "/");
    expect(screen.getByTestId("probe-current-path")).toHaveTextContent("/");
  });

  it("popstateイベントおよびinitialPathプロップ変更に追従しアンマウント時にリスナーを解除すること", () => {
    const removeListenerSpy = vi.spyOn(window, "removeEventListener");

    const { rerender, unmount } = render(
      <RouterProvider initialPath="/">
        <RouterConsumerProbe />
      </RouterProvider>,
    );

    // popstate で /read/local へ追従
    act(() => {
      window.history.pushState(null, "", "/read/local?pop=1");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(screen.getByTestId("probe-current-path")).toHaveTextContent(
      "/read/local?pop=1",
    );
    expect(screen.getByTestId("probe-route-name")).toHaveTextContent(
      "reader-local",
    );

    // initialPath 変更へ追従
    rerender(
      <RouterProvider initialPath="/unknown">
        <RouterConsumerProbe />
      </RouterProvider>,
    );
    expect(screen.getByTestId("probe-current-path")).toHaveTextContent(
      "/unknown",
    );
    expect(screen.getByTestId("probe-route-name")).toHaveTextContent(
      "bookshelf",
    );

    // initialPath が undefined になった場合は上書きしない
    rerender(
      <RouterProvider>
        <RouterConsumerProbe />
      </RouterProvider>,
    );
    expect(screen.getByTestId("probe-current-path")).toHaveTextContent(
      "/unknown",
    );

    unmount();
    expect(removeListenerSpy).toHaveBeenCalledWith(
      "popstate",
      expect.any(Function),
    );
  });

  it("initialPath指定時の初回マウント（StrictMode含む）で子useEffectがreplace('/')を実行してもinitialPathで上書きしないこと (TR-10)", () => {
    function RedirectOnMount() {
      const { replace, currentPath, route } = useRouter();
      useEffect(() => {
        if (route.name === "reader-local") {
          replace("/");
        }
      }, [replace, route.name]);
      return <span data-testid="redirect-current-path">{currentPath}</span>;
    }

    render(
      <StrictMode>
        <RouterProvider initialPath="/read/local">
          <RedirectOnMount />
        </RouterProvider>
      </StrictMode>,
    );

    expect(screen.getByTestId("redirect-current-path")).toHaveTextContent("/");
    expect(window.location.pathname).toBe("/");
  });

  it("back()はsettings時に'/'起点ならwindow.history.back()、起点不在時はreplace('/')へフォールバックすること (TR-09)", async () => {
    const user = userEvent.setup();
    const historyBackSpy = vi.spyOn(window.history, "back");
    const replaceStateSpy = vi.spyOn(window.history, "replaceState");

    const { unmount } = render(
      <RouterProvider initialPath="/">
        <RouterConsumerProbe />
      </RouterProvider>,
    );

    await user.click(screen.getByTestId("btn-nav-settings"));
    expect(screen.getByTestId("probe-route-name")).toHaveTextContent(
      "settings",
    );
    expect(screen.getByTestId("probe-current-path")).toHaveTextContent(
      "/settings",
    );
    replaceStateSpy.mockClear();

    await user.click(screen.getByTestId("btn-back"));
    expect(historyBackSpy).toHaveBeenCalledTimes(1);
    expect(replaceStateSpy).not.toHaveBeenCalled();

    await act(async () => {
      await vi.waitFor(() => {
        expect(screen.getByTestId("probe-current-path")).toHaveTextContent("/");
      });
    });
    expect(screen.getByTestId("probe-route-name")).toHaveTextContent(
      "bookshelf",
    );
    unmount();

    // 直接 /settings 到達時は replace("/") へフォールバック
    window.history.replaceState(null, "", "/settings");
    historyBackSpy.mockClear();
    replaceStateSpy.mockClear();

    render(
      <RouterProvider>
        <RouterConsumerProbe />
      </RouterProvider>,
    );

    expect(screen.getByTestId("probe-route-name")).toHaveTextContent(
      "settings",
    );
    await user.click(screen.getByTestId("btn-back"));
    expect(historyBackSpy).not.toHaveBeenCalled();
    expect(replaceStateSpy).toHaveBeenCalledWith(null, "", "/");
    expect(screen.getByTestId("probe-current-path")).toHaveTextContent("/");
  });

  it("isBackBlockedがtrueの間はback()とpopstateによる離脱を抑止しURLと履歴状態を保持すること (AC-ST-06)", async () => {
    const user = userEvent.setup();
    const historyBackSpy = vi.spyOn(window.history, "back");
    const pushStateSpy = vi.spyOn(window.history, "pushState");
    const replaceStateSpy = vi.spyOn(window.history, "replaceState");

    render(
      <RouterProvider initialPath="/">
        <RouterConsumerProbe />
      </RouterProvider>,
    );

    await user.click(screen.getByTestId("btn-nav-settings"));
    expect(screen.getByTestId("probe-route-name")).toHaveTextContent(
      "settings",
    );

    await user.click(screen.getByTestId("btn-block-back"));
    expect(screen.getByTestId("probe-back-blocked")).toHaveTextContent("true");

    historyBackSpy.mockClear();
    pushStateSpy.mockClear();
    replaceStateSpy.mockClear();

    // 1. back() はブロック中はノーオペ
    await user.click(screen.getByTestId("btn-back"));
    expect(historyBackSpy).not.toHaveBeenCalled();
    expect(replaceStateSpy).not.toHaveBeenCalled();
    expect(screen.getByTestId("probe-current-path")).toHaveTextContent(
      "/settings",
    );

    // 2. popstate で URL が "/" へ変わっていた場合は元の "/settings" へ戻して離脱を防ぐ
    act(() => {
      window.history.replaceState(null, "", "/");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(pushStateSpy).toHaveBeenCalledWith(
      { exLibrisCanGoBackFrom: "/" },
      "",
      "/settings",
    );
    expect(window.location.pathname).toBe("/settings");
    expect(screen.getByTestId("probe-current-path")).toHaveTextContent(
      "/settings",
    );

    // 3. popstate で URL が変わっていない場合は pushState せずそのまま抑止
    pushStateSpy.mockClear();
    act(() => {
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(pushStateSpy).not.toHaveBeenCalled();
    expect(screen.getByTestId("probe-current-path")).toHaveTextContent(
      "/settings",
    );

    // 4. ブロック解除後は back() で "/" へ戻れること
    await user.click(screen.getByTestId("btn-unblock-back"));
    expect(screen.getByTestId("probe-back-blocked")).toHaveTextContent("false");

    await user.click(screen.getByTestId("btn-back"));
    expect(historyBackSpy).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.waitFor(() => {
        expect(screen.getByTestId("probe-current-path")).toHaveTextContent("/");
      });
    });
  });

  it("back()はseries-detail時に'/'起点ならwindow.history.back()、直接到達時はreplace('/')へフォールバックすること (TR-05)", async () => {
    const user = userEvent.setup();
    const historyBackSpy = vi.spyOn(window.history, "back");
    const replaceStateSpy = vi.spyOn(window.history, "replaceState");

    const { unmount } = render(
      <RouterProvider initialPath="/">
        <RouterConsumerProbe />
      </RouterProvider>,
    );

    await user.click(screen.getByTestId("btn-nav-series"));
    expect(screen.getByTestId("probe-route-name")).toHaveTextContent(
      "series-detail",
    );
    expect(screen.getByTestId("probe-current-path")).toHaveTextContent(
      "/series/s-1",
    );
    expect(screen.getByTestId("probe-can-go-back-from")).toHaveTextContent("/");
    replaceStateSpy.mockClear();

    await user.click(screen.getByTestId("btn-back"));
    expect(historyBackSpy).toHaveBeenCalledTimes(1);
    expect(replaceStateSpy).not.toHaveBeenCalled();

    await act(async () => {
      await vi.waitFor(() => {
        expect(screen.getByTestId("probe-current-path")).toHaveTextContent("/");
      });
    });
    unmount();

    // 直接 /series/s-1 へ到達時は replace("/") へフォールバック
    window.history.replaceState(null, "", "/series/s-1");
    historyBackSpy.mockClear();
    replaceStateSpy.mockClear();

    render(
      <RouterProvider>
        <RouterConsumerProbe />
      </RouterProvider>,
    );

    expect(screen.getByTestId("probe-route-name")).toHaveTextContent(
      "series-detail",
    );
    await user.click(screen.getByTestId("btn-back"));
    expect(historyBackSpy).not.toHaveBeenCalled();
    expect(replaceStateSpy).toHaveBeenCalledWith(null, "", "/");
    expect(screen.getByTestId("probe-current-path")).toHaveTextContent("/");
  });

  it("navigateのreaderOrigin/seriesIdオプションとpopstateでreaderOriginStateが同期され不正値はnullへ正規化されること (TR-02b, TR-04)", async () => {
    const user = userEvent.setup();
    const pushStateSpy = vi.spyOn(window.history, "pushState");
    const replaceStateSpy = vi.spyOn(window.history, "replaceState");

    window.history.replaceState(
      {
        exLibrisCanGoBackFrom: "",
        readerOrigin: "invalid",
        seriesId: "   ",
      },
      "",
      "/",
    );

    render(
      <RouterProvider initialPath="/">
        <RouterConsumerProbe />
      </RouterProvider>,
    );

    expect(screen.getByTestId("probe-reader-origin")).toHaveTextContent("null");
    expect(screen.getByTestId("probe-reader-origin-series")).toHaveTextContent(
      "null",
    );
    expect(screen.getByTestId("probe-can-go-back-from")).toHaveTextContent(
      "null",
    );

    // bookshelf -> /read/volume/v-1 (TR-02b)
    await user.click(screen.getByTestId("btn-nav-vol-from-bookshelf"));
    expect(pushStateSpy).toHaveBeenCalledWith(
      {
        exLibrisCanGoBackFrom: "/",
        readerOrigin: "bookshelf",
        seriesId: "s-1",
      },
      "",
      "/read/volume/v-1",
    );
    expect(screen.getByTestId("probe-reader-origin")).toHaveTextContent(
      "bookshelf",
    );
    expect(screen.getByTestId("probe-reader-origin-series")).toHaveTextContent(
      "s-1",
    );
    expect(screen.getByTestId("probe-can-go-back-from")).toHaveTextContent("/");

    // replace: true + readerOrigin/seriesId
    await user.click(screen.getByTestId("btn-nav-replace-vol-origin"));
    expect(replaceStateSpy).toHaveBeenCalledWith(
      {
        readerOrigin: "series-detail",
        seriesId: "s-2",
      },
      "",
      "/read/volume/v-2",
    );
    expect(screen.getByTestId("probe-reader-origin")).toHaveTextContent(
      "series-detail",
    );
    expect(screen.getByTestId("probe-reader-origin-series")).toHaveTextContent(
      "s-2",
    );
    expect(screen.getByTestId("probe-can-go-back-from")).toHaveTextContent(
      "null",
    );

    // popstate 時は window.history.state から readerOriginState を再同期する
    act(() => {
      window.history.pushState(
        {
          exLibrisCanGoBackFrom: "/series/s-3",
          readerOrigin: "series-detail",
          seriesId: "s-3",
        },
        "",
        "/read/volume/v-3",
      );
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(screen.getByTestId("probe-reader-origin")).toHaveTextContent(
      "series-detail",
    );
    expect(screen.getByTestId("probe-reader-origin-series")).toHaveTextContent(
      "s-3",
    );
    expect(screen.getByTestId("probe-can-go-back-from")).toHaveTextContent(
      "/series/s-3",
    );
  });

  it("exitReader()がreader-localおよびreader-volumeの各起点・直接URLフォールバック・ブロック状態に応じて正しく遷移すること (TR-07, TR-08)", async () => {
    const user = userEvent.setup();
    const historyBackSpy = vi.spyOn(window.history, "back");
    const replaceStateSpy = vi.spyOn(window.history, "replaceState");

    // 1. bookshelf での exitReader はノーオペ
    const first = render(
      <RouterProvider initialPath="/">
        <RouterConsumerProbe />
      </RouterProvider>,
    );
    await user.click(screen.getByTestId("btn-exit-reader"));
    expect(historyBackSpy).not.toHaveBeenCalled();
    expect(replaceStateSpy).not.toHaveBeenCalled();

    // 2. TR-02b: bookshelf -> /read/volume/v-1 の exitReader は window.history.back() (TR-08)
    await user.click(screen.getByTestId("btn-nav-vol-from-bookshelf"));
    expect(screen.getByTestId("probe-route-name")).toHaveTextContent(
      "reader-volume",
    );
    await user.click(screen.getByTestId("btn-block-back"));
    await user.click(screen.getByTestId("btn-exit-reader"));
    expect(historyBackSpy).not.toHaveBeenCalled();
    await user.click(screen.getByTestId("btn-unblock-back"));

    await user.click(screen.getByTestId("btn-exit-reader"));
    expect(historyBackSpy).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.waitFor(() => {
        expect(screen.getByTestId("probe-current-path")).toHaveTextContent("/");
      });
    });

    // 3. TR-04: / -> /series/s-1 -> /read/volume/v-1 の exitReader は window.history.back() (TR-07)
    await user.click(screen.getByTestId("btn-nav-series"));
    await user.click(screen.getByTestId("btn-nav-vol-from-series"));
    expect(screen.getByTestId("probe-route-name")).toHaveTextContent(
      "reader-volume",
    );
    historyBackSpy.mockClear();
    await user.click(screen.getByTestId("btn-exit-reader"));
    expect(historyBackSpy).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.waitFor(() => {
        expect(screen.getByTestId("probe-current-path")).toHaveTextContent(
          "/series/s-1",
        );
      });
    });
    first.unmount();

    // 4. reader-local からの exitReader は back() と同様に "/" へフォールバック (TR-08)
    window.history.replaceState(null, "", "/read/local");
    replaceStateSpy.mockClear();
    const localRun = render(
      <RouterProvider>
        <RouterConsumerProbe />
      </RouterProvider>,
    );
    await user.click(screen.getByTestId("btn-exit-reader"));
    expect(replaceStateSpy).toHaveBeenCalledWith(null, "", "/");
    expect(screen.getByTestId("probe-current-path")).toHaveTextContent("/");
    localRun.unmount();

    // 5. readerOrigin === "bookshelf" だが canGoBackFrom が "/" 以外は replace("/")
    window.history.replaceState(
      { readerOrigin: "bookshelf", exLibrisCanGoBackFrom: "/settings" },
      "",
      "/read/volume/v-1",
    );
    historyBackSpy.mockClear();
    replaceStateSpy.mockClear();
    const bookshelfFallbackRun = render(
      <RouterProvider>
        <RouterConsumerProbe />
      </RouterProvider>,
    );
    await user.click(screen.getByTestId("btn-exit-reader"));
    expect(historyBackSpy).not.toHaveBeenCalled();
    expect(replaceStateSpy).toHaveBeenCalledWith(null, "", "/");
    bookshelfFallbackRun.unmount();

    // 6. readerOrigin === "series-detail" だが履歴不在: seriesId 優先 -> fallbackSeriesId -> "/"
    window.history.replaceState(
      { readerOrigin: "series-detail", seriesId: "s-from-state" },
      "",
      "/read/volume/v-1",
    );
    replaceStateSpy.mockClear();
    const sdStateRun = render(
      <RouterProvider>
        <RouterConsumerProbe />
      </RouterProvider>,
    );
    await user.click(screen.getByTestId("btn-exit-reader"));
    expect(replaceStateSpy).toHaveBeenCalledWith(
      null,
      "",
      "/series/s-from-state",
    );
    sdStateRun.unmount();

    window.history.replaceState(
      { readerOrigin: "series-detail" },
      "",
      "/read/volume/v-1",
    );
    replaceStateSpy.mockClear();
    const sdFallbackRun = render(
      <RouterProvider>
        <RouterConsumerProbe />
      </RouterProvider>,
    );
    await user.click(screen.getByTestId("btn-exit-reader-fallback"));
    expect(replaceStateSpy).toHaveBeenCalledWith(
      null,
      "",
      "/series/s-fallback",
    );
    sdFallbackRun.unmount();

    window.history.replaceState(
      { readerOrigin: "series-detail" },
      "",
      "/read/volume/v-1",
    );
    replaceStateSpy.mockClear();
    const sdHomeFallbackRun = render(
      <RouterProvider>
        <RouterConsumerProbe />
      </RouterProvider>,
    );
    await user.click(screen.getByTestId("btn-exit-reader"));
    expect(replaceStateSpy).toHaveBeenCalledWith(null, "", "/");
    sdHomeFallbackRun.unmount();

    // 7. 直接 URL アクセス (readerOrigin === null): fallbackSeriesId あり -> /series/:id, なし -> "/"
    window.history.replaceState(null, "", "/read/volume/v-direct");
    replaceStateSpy.mockClear();
    const directWithFallbackRun = render(
      <RouterProvider>
        <RouterConsumerProbe />
      </RouterProvider>,
    );
    await user.click(screen.getByTestId("btn-exit-reader-fallback"));
    expect(replaceStateSpy).toHaveBeenCalledWith(
      null,
      "",
      "/series/s-fallback",
    );
    directWithFallbackRun.unmount();

    window.history.replaceState(null, "", "/read/volume/v-direct");
    replaceStateSpy.mockClear();
    const directNoFallbackRun = render(
      <RouterProvider>
        <RouterConsumerProbe />
      </RouterProvider>,
    );
    await user.click(screen.getByTestId("btn-exit-reader"));
    expect(replaceStateSpy).toHaveBeenCalledWith(null, "", "/");
    directNoFallbackRun.unmount();
  });
});
