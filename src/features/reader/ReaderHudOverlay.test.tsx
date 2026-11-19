import { composeStories } from "@storybook/react";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import * as stories from "./ReaderHudOverlay.stories";

const { OpenFirstPage, OpenMiddlePage, OpenLastPage, Closed } =
  composeStories(stories);

describe("ReaderHudOverlay", () => {
  it("OpenFirstPageストーリーで先頭ページHUD・右開き順序・前へ無効状態を表示すること (AC-RD-04)", () => {
    render(<OpenFirstPage />);

    const topBar = screen.getByTestId("reader-hud-top");
    const bottomBar = screen.getByTestId("reader-hud-bottom");
    expect(topBar).toBeVisible();
    expect(bottomBar).toBeVisible();

    expect(screen.getByTestId("reader-back-button")).toHaveTextContent("戻る");
    expect(topBar).toHaveTextContent("sample-comic-vol01.cbz");

    const nextButton = screen.getByTestId("reader-next-button");
    const indicator = screen.getByTestId("reader-page-indicator");
    const prevButton = screen.getByTestId("reader-prev-button");

    expect(nextButton).toHaveTextContent("← 次へ");
    expect(nextButton).toBeEnabled();
    expect(indicator).toHaveTextContent("1 / 24");
    expect(prevButton).toHaveTextContent("前へ →");
    expect(prevButton).toBeDisabled();

    // 右開き視覚順（次へ → インジケータ → 前へ）の DOM 順序確認
    const children = Array.from(bottomBar.children);
    expect(children.indexOf(nextButton)).toBeLessThan(
      children.indexOf(indicator),
    );
    expect(children.indexOf(indicator)).toBeLessThan(
      children.indexOf(prevButton),
    );
  });

  it("OpenMiddlePageおよびOpenLastPageストーリーでページ表示とdisabled境界が切り替わること (AC-RD-04)", () => {
    const { unmount } = render(<OpenMiddlePage />);
    expect(screen.getByTestId("reader-page-indicator")).toHaveTextContent(
      "12 / 24",
    );
    expect(screen.getByTestId("reader-next-button")).toBeEnabled();
    expect(screen.getByTestId("reader-prev-button")).toBeEnabled();
    expect(
      screen.getByText(
        "とても長いタイトルの自炊マンガアーカイブ_第01巻_高解像度スキャン版.zip",
      ),
    ).toHaveClass("truncate");
    unmount();

    render(<OpenLastPage />);
    expect(screen.getByTestId("reader-page-indicator")).toHaveTextContent(
      "24 / 24",
    );
    expect(screen.getByTestId("reader-next-button")).toBeDisabled();
    expect(screen.getByTestId("reader-prev-button")).toBeEnabled();
  });

  it("ClosedストーリーおよびtotalPages=0境界を正しく描画すること", () => {
    const { unmount } = render(<Closed />);
    expect(screen.queryByTestId("reader-hud-top")).not.toBeInTheDocument();
    expect(screen.queryByTestId("reader-hud-bottom")).not.toBeInTheDocument();
    unmount();

    render(<OpenFirstPage totalPages={0} currentPageIndex={0} />);
    expect(screen.getByTestId("reader-page-indicator")).toHaveTextContent(
      "0 / 0",
    );
    expect(screen.getByTestId("reader-next-button")).toBeDisabled();
    expect(screen.getByTestId("reader-prev-button")).toBeDisabled();
  });

  it("各ボタン押下でコールバックが呼ばれ、上下バー上のクリック・ポインターイベントが親タップ領域へバブリングしないこと", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onNextPage = vi.fn();
    const onPrevPage = vi.fn();
    const parentClick = vi.fn();
    const parentPointerDown = vi.fn();
    const parentPointerUp = vi.fn();

    render(
      <div
        onClick={parentClick}
        onPointerDown={parentPointerDown}
        onPointerUp={parentPointerUp}
      >
        <OpenMiddlePage
          onClose={onClose}
          onNextPage={onNextPage}
          onPrevPage={onPrevPage}
        />
      </div>,
    );

    const topBar = screen.getByTestId("reader-hud-top");
    const bottomBar = screen.getByTestId("reader-hud-bottom");
    const backButton = screen.getByTestId("reader-back-button");
    const nextButton = screen.getByTestId("reader-next-button");
    const prevButton = screen.getByTestId("reader-prev-button");

    fireEvent.pointerDown(topBar);
    fireEvent.pointerUp(topBar);
    fireEvent.click(topBar);

    fireEvent.pointerDown(bottomBar);
    fireEvent.pointerUp(bottomBar);
    fireEvent.click(bottomBar);

    await user.click(backButton);
    await user.click(nextButton);
    await user.click(prevButton);

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onNextPage).toHaveBeenCalledTimes(1);
    expect(onPrevPage).toHaveBeenCalledTimes(1);

    expect(parentClick).not.toHaveBeenCalled();
    expect(parentPointerDown).not.toHaveBeenCalled();
    expect(parentPointerUp).not.toHaveBeenCalled();
  });
});
