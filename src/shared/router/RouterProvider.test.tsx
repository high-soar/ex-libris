import { composeStories } from "@storybook/react";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RouterProvider } from "./RouterProvider";
import * as stories from "./RouterProvider.stories";
import { useRouter } from "./routerContext";

const { Default, LocalReaderRoute, UnknownFallbackRoute } =
  composeStories(stories);

function RouterConsumerProbe() {
  const { currentPath, route, navigate, replace, back } = useRouter();

  return (
    <div>
      <span data-testid="probe-current-path">{currentPath}</span>
      <span data-testid="probe-route-name">{route.name}</span>
      <span data-testid="probe-route-path">{route.path}</span>
      <button
        type="button"
        data-testid="btn-nav-reader"
        onClick={() => navigate("/read/local")}
      >
        to reader
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
      <button type="button" data-testid="btn-back" onClick={back}>
        back
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

  it("全Storybookストーリー（Default / LocalReaderRoute / UnknownFallbackRoute）を描画できること", () => {
    const { unmount: unmountDefault } = render(<Default />);
    expect(screen.getByTestId("story-route-name")).toHaveTextContent(
      "bookshelf",
    );
    expect(screen.getByTestId("story-route-path")).toHaveTextContent("/");
    expect(screen.getByTestId("story-current-path")).toHaveTextContent("/");
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

    // pushState で /read/local へ遷移
    await user.click(screen.getByTestId("btn-nav-reader"));
    expect(pushStateSpy).toHaveBeenCalledTimes(1);
    expect(pushStateSpy).toHaveBeenCalledWith(null, "", "/read/local");
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

    // reader-local からの back() は "/" へ replace 遷移
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
});
