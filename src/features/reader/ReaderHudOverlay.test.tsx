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
  OpenWithShaderModified,
  Closed,
} = composeStories(stories);

describe("ReaderHudOverlay", () => {
  it("OpenFirstPageストーリーで先頭ページHUD・3段下部レイアウト・右開き順序・シークバー初期状態を検証する (AC-RD-04, AC-RD-11, AC-RD-13, AC-RD-14)", () => {
    render(<OpenFirstPage />);

    const topBar = screen.getByTestId("reader-hud-top");
    const bottomBar = screen.getByTestId("reader-hud-bottom");
    expect(topBar).toBeVisible();
    expect(bottomBar).toBeVisible();

    expect(screen.getByTestId("reader-back-button")).toHaveTextContent("戻る");
    expect(topBar).toHaveTextContent("sample-comic-vol01.cbz");

    const shaderButton = screen.getByTestId("reader-shader-button");
    expect(shaderButton).toHaveTextContent("画質補正");
    expect(shaderButton).toHaveAttribute("data-shader-modified", "false");
    expect(shaderButton).toHaveClass("touch-manipulation", "border-slate-700");

    const seekRow = screen.getByTestId("reader-hud-seek-row");
    const seekbar = screen.getByTestId("reader-seekbar");
    expect(seekbar).toHaveAttribute("type", "range");
    expect(seekbar).toHaveAttribute("aria-label", "ページシークバー");
    expect(seekbar).toHaveAttribute("min", "0");
    expect(seekbar).toHaveAttribute("max", "23");
    expect(seekbar).toHaveAttribute("step", "1");
    expect(seekbar).toHaveValue("0");
    expect(seekbar).toHaveAttribute("dir", "rtl");
    expect(seekbar).toHaveAttribute("data-reading-direction", "rtl");
    expect(seekbar).toBeEnabled();
    expect(seekbar).toHaveClass("touch-manipulation");

    const nextButton = screen.getByTestId("reader-next-button");
    const indicator = screen.getByTestId("reader-page-indicator");
    const prevButton = screen.getByTestId("reader-prev-button");

    expect(nextButton).toHaveTextContent("← 次へ");
    expect(nextButton).toBeEnabled();
    expect(indicator).toHaveTextContent("1 / 24");
    expect(indicator).toHaveAttribute("data-seek-preview", "false");
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

    // 3段レイアウト（上段シークバー行・中段ナビゲーション行・下段コントロール行）および右開き視覚順確認
    const navRow = screen.getByTestId("reader-hud-nav-row");
    const controlsRow = screen.getByTestId("reader-hud-controls-row");
    expect(seekbar.parentElement).toBe(seekRow);
    expect(nextButton.parentElement).toBe(navRow);
    expect(spreadModeButton.parentElement).toBe(controlsRow);

    const rows = Array.from(bottomBar.children);
    expect(rows).toEqual([seekRow, navRow, controlsRow]);

    const navChildren = Array.from(navRow.children);
    expect(navChildren.indexOf(nextButton)).toBeLessThan(
      navChildren.indexOf(indicator),
    );
    expect(navChildren.indexOf(indicator)).toBeLessThan(
      navChildren.indexOf(prevButton),
    );
  });

  it("OpenMiddlePageおよびOpenLastPageストーリーでページ表示とdisabled境界が切り替わること (AC-RD-04, AC-RD-14)", () => {
    const { unmount } = render(<OpenMiddlePage />);
    expect(screen.getByTestId("reader-page-indicator")).toHaveTextContent(
      "12 / 24",
    );
    expect(screen.getByTestId("reader-seekbar")).toHaveValue("11");
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
    expect(screen.getByTestId("reader-seekbar")).toHaveValue("23");
    expect(screen.getByTestId("reader-next-button")).toBeDisabled();
    expect(screen.getByTestId("reader-prev-button")).toBeEnabled();
  });

  it("OpenSpreadRtlおよびOpenWithShaderModifiedストーリーで自動見開き表示・最終見開き無効化・画質補正ボタン強調表示を検証する (AC-RD-04, AC-RD-11, AC-RD-13)", async () => {
    const user = userEvent.setup();
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
    const { unmount: unmountLastSpread } = render(
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
    unmountLastSpread();

    // 画質補正適用中はインディゴ強調表示となり押下で onOpenShaderSheet が呼ばれる
    const onOpenShaderSheet = vi.fn();
    render(<OpenWithShaderModified onOpenShaderSheet={onOpenShaderSheet} />);
    const shaderButton = screen.getByTestId("reader-shader-button");
    expect(shaderButton).toHaveAttribute("data-shader-modified", "true");
    expect(shaderButton).toHaveClass("border-indigo-400", "bg-indigo-500/30");
    await user.click(shaderButton);
    expect(onOpenShaderSheet).toHaveBeenCalledTimes(1);
  });

  it("OpenSpreadLtrOffsetOnおよびOpenForcedSingleLtrストーリーで左開き順序反転・ltrシークバー・1ページずらしON・全表示モードラベルを検証する (AC-RD-04, AC-RD-11, AC-RD-14)", () => {
    const { unmount } = render(<OpenSpreadLtrOffsetOn />);

    const seekbar = screen.getByTestId("reader-seekbar");
    expect(seekbar).toHaveAttribute("dir", "ltr");
    expect(seekbar).toHaveAttribute("data-reading-direction", "ltr");
    expect(seekbar).toHaveValue("2");

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

  it("Closedストーリー・totalPages=0/1境界・任意Props省略時デフォルト値を正しく描画すること (AC-RD-11, AC-RD-14)", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<Closed />);
    expect(screen.queryByTestId("reader-hud-top")).not.toBeInTheDocument();
    expect(screen.queryByTestId("reader-hud-bottom")).not.toBeInTheDocument();
    unmount();

    const onCommitSeekZero = vi.fn();
    const { unmount: unmountZero } = render(
      <OpenFirstPage
        totalPages={0}
        currentPageIndex={0}
        onCommitSeek={onCommitSeekZero}
      />,
    );
    expect(screen.getByTestId("reader-page-indicator")).toHaveTextContent(
      "0 / 0",
    );
    expect(screen.getByTestId("reader-next-button")).toBeDisabled();
    expect(screen.getByTestId("reader-prev-button")).toBeDisabled();
    expect(screen.getByTestId("reader-offset-toggle-button")).toBeDisabled();
    const zeroSeekbar = screen.getByTestId("reader-seekbar");
    expect(zeroSeekbar).toBeDisabled();
    expect(zeroSeekbar).toHaveAttribute("min", "0");
    expect(zeroSeekbar).toHaveAttribute("max", "0");
    fireEvent.pointerDown(zeroSeekbar);
    fireEvent.change(zeroSeekbar, { target: { value: "0" } });
    fireEvent.pointerUp(zeroSeekbar);
    expect(onCommitSeekZero).not.toHaveBeenCalled();
    expect(screen.getByTestId("reader-page-indicator")).toHaveAttribute(
      "data-seek-preview",
      "false",
    );
    unmountZero();

    // totalPages=1 では有効表示が見開きでも 1ページずらし・シークバーともに無効
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
    expect(screen.getByTestId("reader-seekbar")).toBeDisabled();
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
    expect(screen.getByTestId("reader-shader-button")).toHaveAttribute(
      "data-shader-modified",
      "false",
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
    await user.click(screen.getByTestId("reader-shader-button"));
    fireEvent.change(screen.getByTestId("reader-seekbar"), {
      target: { value: "4" },
    });
  });

  it("シークバードラッグ中はプレビュー表示のみで確定せず、window/要素pointerupで1回だけ確定し同頁では発火しないこと (AC-RD-14)", () => {
    const onCommitSeek = vi.fn();
    const { unmount } = render(
      <OpenSpreadRtl
        currentPageIndex={1}
        maxDisplayedPageIndex={2}
        totalPages={24}
        pageIndicatorText="2-3 / 24"
        onCommitSeek={onCommitSeek}
      />,
    );

    const seekbar = screen.getByTestId("reader-seekbar");
    const indicator = screen.getByTestId("reader-page-indicator");

    // 1. pointerDown 開始時は現在ページのままプレビューモードに入る（通信未発火）
    fireEvent.pointerDown(seekbar);
    expect(indicator).toHaveAttribute("data-seek-preview", "true");
    expect(indicator).toHaveTextContent("2 / 24");
    expect(onCommitSeek).not.toHaveBeenCalled();

    // 2. ドラッグ中の値変更はプレビュー表示のみ更新し、onCommitSeek は呼ばない
    fireEvent.change(seekbar, { target: { value: "15" } });
    expect(indicator).toHaveAttribute("data-seek-preview", "true");
    expect(indicator).toHaveTextContent("16 / 24");
    expect(seekbar).toHaveValue("15");
    expect(onCommitSeek).not.toHaveBeenCalled();

    // 3. 要素外（window）での pointerUp 確定で 1 回だけ onCommitSeek が呼ばれプレビュー解除
    fireEvent.pointerUp(window);
    expect(onCommitSeek).toHaveBeenCalledTimes(1);
    expect(onCommitSeek).toHaveBeenCalledWith(15);
    expect(indicator).toHaveAttribute("data-seek-preview", "false");
    expect(indicator).toHaveTextContent("2-3 / 24");

    // 4. 要素上での pointerUp 確定＋二重発火防止・およびドラッグ中でない pointerUp/pointerCancel 無視
    onCommitSeek.mockClear();
    fireEvent.pointerUp(seekbar);
    fireEvent.pointerCancel(seekbar);
    expect(onCommitSeek).not.toHaveBeenCalled();

    fireEvent.pointerDown(seekbar);
    fireEvent.change(seekbar, { target: { value: "20" } });
    fireEvent.pointerUp(seekbar);
    expect(onCommitSeek).toHaveBeenCalledTimes(1);
    expect(onCommitSeek).toHaveBeenCalledWith(20);
    expect(indicator).toHaveAttribute("data-seek-preview", "false");

    // 5. ドラッグして元のページ (currentPageIndex=1) へ戻してから離した場合は onCommitSeek を呼ばない
    onCommitSeek.mockClear();
    fireEvent.pointerDown(seekbar);
    fireEvent.change(seekbar, { target: { value: "9" } });
    expect(indicator).toHaveTextContent("10 / 24");
    fireEvent.change(seekbar, { target: { value: "1" } });
    expect(indicator).toHaveTextContent("2 / 24");
    fireEvent.pointerUp(window);
    expect(onCommitSeek).not.toHaveBeenCalled();
    expect(indicator).toHaveAttribute("data-seek-preview", "false");
    unmount();
  });

  it("pointercancel・ドラッグ中のHUD閉鎖・アンマウント時はジャンプ確定せずプレビューとwindowリスナーを解放すること (AC-RD-14)", () => {
    const onCommitSeek = vi.fn();
    const { rerender, unmount } = render(
      <OpenMiddlePage
        currentPageIndex={11}
        totalPages={24}
        onCommitSeek={onCommitSeek}
      />,
    );

    const seekbar = screen.getByTestId("reader-seekbar");
    const indicator = screen.getByTestId("reader-page-indicator");

    // 1. window pointercancel で確定せずプレビュー解除
    fireEvent.pointerDown(seekbar);
    fireEvent.change(seekbar, { target: { value: "2" } });
    expect(indicator).toHaveAttribute("data-seek-preview", "true");
    fireEvent.pointerCancel(window);
    expect(onCommitSeek).not.toHaveBeenCalled();
    expect(indicator).toHaveAttribute("data-seek-preview", "false");
    expect(indicator).toHaveTextContent("12 / 24");

    // 2. 要素 pointercancel でも確定せずプレビュー解除
    fireEvent.pointerDown(seekbar);
    fireEvent.change(seekbar, { target: { value: "4" } });
    fireEvent.pointerCancel(seekbar);
    expect(onCommitSeek).not.toHaveBeenCalled();
    expect(indicator).toHaveAttribute("data-seek-preview", "false");

    // 3. ドラッグ中に isOpen=false で HUD が閉じたら window pointerup が来ても確定せず、再開時も通常表示
    fireEvent.pointerDown(seekbar);
    fireEvent.change(seekbar, { target: { value: "18" } });
    rerender(
      <OpenMiddlePage
        isOpen={false}
        currentPageIndex={11}
        totalPages={24}
        onCommitSeek={onCommitSeek}
      />,
    );
    fireEvent.pointerUp(window);
    expect(onCommitSeek).not.toHaveBeenCalled();

    rerender(
      <OpenMiddlePage
        isOpen={true}
        currentPageIndex={11}
        totalPages={24}
        onCommitSeek={onCommitSeek}
      />,
    );
    expect(screen.getByTestId("reader-page-indicator")).toHaveAttribute(
      "data-seek-preview",
      "false",
    );
    expect(screen.getByTestId("reader-page-indicator")).toHaveTextContent(
      "12 / 24",
    );

    // 4. ドラッグ中にアンマウントされた場合も window pointerup が確定発火しない
    fireEvent.pointerDown(screen.getByTestId("reader-seekbar"));
    fireEvent.change(screen.getByTestId("reader-seekbar"), {
      target: { value: "22" },
    });
    unmount();
    fireEvent.pointerUp(window);
    expect(onCommitSeek).not.toHaveBeenCalled();
  });

  it("ポインタードラッグを伴わないキーボード操作等のonChange時は異なるページのみ即座にonCommitSeekが呼ばれること (AC-RD-14)", () => {
    const onCommitSeek = vi.fn();
    render(
      <OpenMiddlePage
        currentPageIndex={11}
        totalPages={24}
        onCommitSeek={onCommitSeek}
      />,
    );

    const seekbar = screen.getByTestId("reader-seekbar");
    fireEvent.change(seekbar, { target: { value: "12" } });
    expect(onCommitSeek).toHaveBeenCalledTimes(1);
    expect(onCommitSeek).toHaveBeenCalledWith(12);

    // 現在ページと同値の変更では発火しない
    onCommitSeek.mockClear();
    fireEvent.change(seekbar, { target: { value: "11" } });
    expect(onCommitSeek).not.toHaveBeenCalled();
  });

  it("全ボタン押下でコールバックが呼ばれ、上下バー上のクリック・ポインターイベントが親タップ領域へバブリングしないこと (AC-RD-11, AC-RD-13)", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onNextPage = vi.fn();
    const onPrevPage = vi.fn();
    const onCycleSpreadMode = vi.fn();
    const onToggleSpreadPageOffset = vi.fn();
    const onToggleReadingDirection = vi.fn();
    const onOpenShaderSheet = vi.fn();
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
          onOpenShaderSheet={onOpenShaderSheet}
        />
      </div>,
    );

    const topBar = screen.getByTestId("reader-hud-top");
    const bottomBar = screen.getByTestId("reader-hud-bottom");
    const backButton = screen.getByTestId("reader-back-button");
    const shaderButton = screen.getByTestId("reader-shader-button");
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
    await user.click(shaderButton);
    await user.click(nextButton);
    await user.click(prevButton);
    await user.click(spreadModeButton);
    await user.click(offsetToggleButton);
    await user.click(directionButton);

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onOpenShaderSheet).toHaveBeenCalledTimes(1);
    expect(onNextPage).toHaveBeenCalledTimes(1);
    expect(onPrevPage).toHaveBeenCalledTimes(1);
    expect(onCycleSpreadMode).toHaveBeenCalledTimes(1);
    expect(onToggleSpreadPageOffset).toHaveBeenCalledTimes(1);
    expect(onToggleReadingDirection).toHaveBeenCalledTimes(1);

    expect(parentClick).not.toHaveBeenCalled();
    expect(parentPointerDown).not.toHaveBeenCalled();
    expect(parentPointerUp).not.toHaveBeenCalled();
  });

  it("上下HUDバーがセーフエリア余白を確保し全操作ボタン・シークバーにtouch-manipulationクラスが付与されていること (AC-RD-04, AC-RD-11, AC-RD-13, AC-RD-14)", () => {
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
    expect(screen.getByTestId("reader-shader-button")).toHaveClass(
      "touch-manipulation",
    );
    expect(screen.getByTestId("reader-seekbar")).toHaveClass(
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
