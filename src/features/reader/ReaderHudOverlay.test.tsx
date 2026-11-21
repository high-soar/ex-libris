import { composeStories } from "@storybook/react";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ReaderHudOverlay } from "./ReaderHudOverlay";
import * as stories from "./ReaderHudOverlay.stories";

const {
  OpenFirstPage,
  OpenMiddlePage,
  OpenLastPage,
  OpenSpreadRtl,
  OpenSpreadLtrOffsetOn,
  OpenForcedSingleLtr,
  Closed,
} = composeStories(stories);

describe("ReaderHudOverlay", () => {
  it("OpenFirstPageストーリーで先頭ページHUD・2段下部レイアウト・右開き順序・単頁モード表示を検証する (AC-RD-04, AC-RD-11)", () => {
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

    const spreadModeButton = screen.getByTestId("reader-spread-mode-button");
    const offsetToggleButton = screen.getByTestId(
      "reader-offset-toggle-button",
    );
    const directionButton = screen.getByTestId("reader-direction-button");

    expect(spreadModeButton).toHaveAttribute("data-spread-mode", "auto");
    expect(spreadModeButton).toHaveAttribute(
      "data-effective-spread-mode",
      "single",
    );
    expect(spreadModeButton).toHaveTextContent("自動(単頁)");

    expect(offsetToggleButton).toHaveTextContent("1ページずらし");
    expect(offsetToggleButton).toHaveAttribute("aria-pressed", "false");
    expect(offsetToggleButton).toBeDisabled();

    expect(directionButton).toHaveAttribute("data-reading-direction", "rtl");
    expect(directionButton).toHaveTextContent("右開き");

    // 2段レイアウト（上段ナビゲーション行・下段コントロール行）および右開き視覚順確認
    const navRow = nextButton.parentElement!;
    const controlsRow = spreadModeButton.parentElement!;
    expect(navRow).not.toBe(controlsRow);

    const rows = Array.from(bottomBar.children);
    expect(rows.indexOf(navRow)).toBeLessThan(rows.indexOf(controlsRow));

    const navChildren = Array.from(navRow.children);
    expect(navChildren.indexOf(nextButton)).toBeLessThan(
      navChildren.indexOf(indicator),
    );
    expect(navChildren.indexOf(indicator)).toBeLessThan(
      navChildren.indexOf(prevButton),
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

  it("OpenSpreadRtlストーリーで自動見開き表示・見開きページ表記・maxDisplayedPageIndex最終見開き無効化を検証する (AC-RD-04, AC-RD-11)", () => {
    const { unmount } = render(<OpenSpreadRtl />);

    expect(screen.getByTestId("reader-page-indicator")).toHaveTextContent(
      "2-3 / 24",
    );
    const spreadModeButton = screen.getByTestId("reader-spread-mode-button");
    expect(spreadModeButton).toHaveAttribute("data-spread-mode", "auto");
    expect(spreadModeButton).toHaveAttribute(
      "data-effective-spread-mode",
      "spread",
    );
    expect(spreadModeButton).toHaveTextContent("自動(見開き)");

    const offsetToggleButton = screen.getByTestId(
      "reader-offset-toggle-button",
    );
    expect(offsetToggleButton).toBeEnabled();
    expect(offsetToggleButton).toHaveAttribute("aria-pressed", "false");

    const directionButton = screen.getByTestId("reader-direction-button");
    expect(directionButton).toHaveAttribute("data-reading-direction", "rtl");
    expect(directionButton).toHaveTextContent("右開き");

    expect(screen.getByTestId("reader-next-button")).toBeEnabled();
    expect(screen.getByTestId("reader-prev-button")).toBeEnabled();
    unmount();

    // 最終見開き (index 22-23 / 24) 表示時は currentPageIndex < totalPages - 1 でも次へボタンが disabled
    render(
      <OpenSpreadRtl
        currentPageIndex={22}
        maxDisplayedPageIndex={23}
        totalPages={24}
        pageIndicatorText="23-24 / 24"
      />,
    );
    expect(screen.getByTestId("reader-page-indicator")).toHaveTextContent(
      "23-24 / 24",
    );
    expect(screen.getByTestId("reader-next-button")).toBeDisabled();
    expect(screen.getByTestId("reader-prev-button")).toBeEnabled();
  });

  it("OpenSpreadLtrOffsetOnおよびOpenForcedSingleLtrストーリーで左開き順序反転・1ページずらしON・全表示モードラベルを検証する (AC-RD-04, AC-RD-11)", () => {
    const { unmount } = render(<OpenSpreadLtrOffsetOn />);

    const prevButton = screen.getByTestId("reader-prev-button");
    const indicator = screen.getByTestId("reader-page-indicator");
    const nextButton = screen.getByTestId("reader-next-button");

    expect(prevButton).toHaveTextContent("← 前へ");
    expect(indicator).toHaveTextContent("3-4 / 24");
    expect(nextButton).toHaveTextContent("次へ →");

    // 左開き視覚順（前へ → インジケータ → 次へ）
    const navChildren = Array.from(prevButton.parentElement!.children);
    expect(navChildren.indexOf(prevButton)).toBeLessThan(
      navChildren.indexOf(indicator),
    );
    expect(navChildren.indexOf(indicator)).toBeLessThan(
      navChildren.indexOf(nextButton),
    );

    const spreadModeButton = screen.getByTestId("reader-spread-mode-button");
    expect(spreadModeButton).toHaveAttribute("data-spread-mode", "spread");
    expect(spreadModeButton).toHaveAttribute(
      "data-effective-spread-mode",
      "spread",
    );
    expect(spreadModeButton).toHaveTextContent("見開き");

    const offsetToggleButton = screen.getByTestId(
      "reader-offset-toggle-button",
    );
    expect(offsetToggleButton).toBeEnabled();
    expect(offsetToggleButton).toHaveAttribute("aria-pressed", "true");
    expect(offsetToggleButton).toHaveClass("border-indigo-400");

    const directionButton = screen.getByTestId("reader-direction-button");
    expect(directionButton).toHaveAttribute("data-reading-direction", "ltr");
    expect(directionButton).toHaveTextContent("左開き");
    unmount();

    render(<OpenForcedSingleLtr />);
    const singleModeButton = screen.getByTestId("reader-spread-mode-button");
    expect(singleModeButton).toHaveAttribute("data-spread-mode", "single");
    expect(singleModeButton).toHaveAttribute(
      "data-effective-spread-mode",
      "single",
    );
    expect(singleModeButton).toHaveTextContent("単ページ");
    expect(screen.getByTestId("reader-offset-toggle-button")).toBeDisabled();
    expect(screen.getByTestId("reader-offset-toggle-button")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByTestId("reader-direction-button")).toHaveTextContent(
      "左開き",
    );
    expect(screen.getByTestId("reader-prev-button")).toBeDisabled();
    expect(screen.getByTestId("reader-next-button")).toBeEnabled();
  });

  it("Closedストーリー・totalPages=0/1境界・任意Props省略時デフォルト値を正しく描画すること (AC-RD-11)", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<Closed />);
    expect(screen.queryByTestId("reader-hud-top")).not.toBeInTheDocument();
    expect(screen.queryByTestId("reader-hud-bottom")).not.toBeInTheDocument();
    unmount();

    const { unmount: unmountZero } = render(
      <OpenFirstPage totalPages={0} currentPageIndex={0} />,
    );
    expect(screen.getByTestId("reader-page-indicator")).toHaveTextContent(
      "0 / 0",
    );
    expect(screen.getByTestId("reader-next-button")).toBeDisabled();
    expect(screen.getByTestId("reader-prev-button")).toBeDisabled();
    expect(screen.getByTestId("reader-offset-toggle-button")).toBeDisabled();
    unmountZero();

    // totalPages=1 では有効表示が見開きでも 1ページずらしは無効
    const { unmount: unmountOne } = render(
      <OpenSpreadRtl
        totalPages={1}
        currentPageIndex={0}
        maxDisplayedPageIndex={0}
        pageIndicatorText={undefined}
      />,
    );
    expect(screen.getByTestId("reader-page-indicator")).toHaveTextContent(
      "1 / 1",
    );
    expect(screen.getByTestId("reader-next-button")).toBeDisabled();
    expect(screen.getByTestId("reader-prev-button")).toBeDisabled();
    expect(screen.getByTestId("reader-offset-toggle-button")).toBeDisabled();
    unmountOne();

    // 既存呼び出し互換: 新設の任意Propsをすべて省略しても動作すること
    render(
      <ReaderHudOverlay
        isOpen={true}
        fileName="legacy-compat.cbz"
        currentPageIndex={0}
        totalPages={10}
        onClose={vi.fn()}
        onNextPage={vi.fn()}
        onPrevPage={vi.fn()}
      />,
    );
    expect(screen.getByTestId("reader-page-indicator")).toHaveTextContent(
      "1 / 10",
    );
    expect(screen.getByTestId("reader-spread-mode-button")).toHaveTextContent(
      "自動(単頁)",
    );
    expect(screen.getByTestId("reader-direction-button")).toHaveTextContent(
      "右開き",
    );
    expect(screen.getByTestId("reader-offset-toggle-button")).toBeDisabled();
    await user.click(screen.getByTestId("reader-spread-mode-button"));
    await user.click(screen.getByTestId("reader-direction-button"));
  });

  it("全ボタン押下でコールバックが呼ばれ、上下バー上のクリック・ポインターイベントが親タップ領域へバブリングしないこと (AC-RD-11)", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onNextPage = vi.fn();
    const onPrevPage = vi.fn();
    const onCycleSpreadMode = vi.fn();
    const onToggleSpreadPageOffset = vi.fn();
    const onToggleReadingDirection = vi.fn();
    const parentClick = vi.fn();
    const parentPointerDown = vi.fn();
    const parentPointerUp = vi.fn();

    render(
      <div
        onClick={parentClick}
        onPointerDown={parentPointerDown}
        onPointerUp={parentPointerUp}
      >
        <OpenSpreadRtl
          onClose={onClose}
          onNextPage={onNextPage}
          onPrevPage={onPrevPage}
          onCycleSpreadMode={onCycleSpreadMode}
          onToggleSpreadPageOffset={onToggleSpreadPageOffset}
          onToggleReadingDirection={onToggleReadingDirection}
        />
      </div>,
    );

    const topBar = screen.getByTestId("reader-hud-top");
    const bottomBar = screen.getByTestId("reader-hud-bottom");
    const backButton = screen.getByTestId("reader-back-button");
    const nextButton = screen.getByTestId("reader-next-button");
    const prevButton = screen.getByTestId("reader-prev-button");
    const spreadModeButton = screen.getByTestId("reader-spread-mode-button");
    const offsetToggleButton = screen.getByTestId(
      "reader-offset-toggle-button",
    );
    const directionButton = screen.getByTestId("reader-direction-button");

    fireEvent.pointerDown(topBar);
    fireEvent.pointerUp(topBar);
    fireEvent.click(topBar);

    fireEvent.pointerDown(bottomBar);
    fireEvent.pointerUp(bottomBar);
    fireEvent.click(bottomBar);

    await user.click(backButton);
    await user.click(nextButton);
    await user.click(prevButton);
    await user.click(spreadModeButton);
    await user.click(offsetToggleButton);
    await user.click(directionButton);

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onNextPage).toHaveBeenCalledTimes(1);
    expect(onPrevPage).toHaveBeenCalledTimes(1);
    expect(onCycleSpreadMode).toHaveBeenCalledTimes(1);
    expect(onToggleSpreadPageOffset).toHaveBeenCalledTimes(1);
    expect(onToggleReadingDirection).toHaveBeenCalledTimes(1);

    expect(parentClick).not.toHaveBeenCalled();
    expect(parentPointerDown).not.toHaveBeenCalled();
    expect(parentPointerUp).not.toHaveBeenCalled();
  });

  it("上下HUDバーがセーフエリア余白を確保し全操作ボタンにtouch-manipulationクラスが付与されていること (AC-RD-04, AC-RD-11)", () => {
    render(<OpenSpreadRtl />);

    const topBar = screen.getByTestId("reader-hud-top");
    const bottomBar = screen.getByTestId("reader-hud-bottom");

    expect(topBar).toHaveStyle({
      paddingTop: "calc(0.75rem + env(safe-area-inset-top, 0px))",
    });
    expect(bottomBar).toHaveStyle({
      paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom, 0px))",
    });
    expect(topBar.style.paddingTop).toContain("safe-area-inset-top");
    expect(bottomBar.style.paddingBottom).toContain("safe-area-inset-bottom");

    expect(screen.getByTestId("reader-back-button")).toHaveClass(
      "touch-manipulation",
    );
    expect(screen.getByTestId("reader-next-button")).toHaveClass(
      "touch-manipulation",
    );
    expect(screen.getByTestId("reader-prev-button")).toHaveClass(
      "touch-manipulation",
    );
    expect(screen.getByTestId("reader-spread-mode-button")).toHaveClass(
      "touch-manipulation",
    );
    expect(screen.getByTestId("reader-offset-toggle-button")).toHaveClass(
      "touch-manipulation",
    );
    expect(screen.getByTestId("reader-direction-button")).toHaveClass(
      "touch-manipulation",
    );
  });
});
