import { composeStories } from "@storybook/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { APP_VERSION } from "../../shared/constants/app";
import { SeriesDetailHeader } from "./SeriesDetailHeader";
import * as stories from "./SeriesDetailHeader.stories";

const { WithTitle, FallbackTitle, LongTitle } = composeStories(stories);

describe("SeriesDetailHeader", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("全Storybookストーリーを描画し、タイトルとバージョンバッジを表示する (AC-SD-01, AC-SD-06)", () => {
    const { unmount: unmountWithTitle } = render(<WithTitle />);
    expect(screen.getByTestId("series-detail-header-title")).toHaveTextContent(
      "ダンジョン飯",
    );
    expect(screen.getByTestId("series-detail-app-version")).toHaveTextContent(
      `v${APP_VERSION}`,
    );
    expect(screen.getByTestId("series-detail-back-button")).toHaveTextContent(
      "本棚へ戻る",
    );
    unmountWithTitle();

    const { unmount: unmountFallback } = render(<FallbackTitle />);
    expect(screen.getByTestId("series-detail-header-title")).toHaveTextContent(
      "シリーズ詳細",
    );
    unmountFallback();

    render(<LongTitle />);
    expect(screen.getByTestId("series-detail-header-title")).toHaveTextContent(
      "とても長いシリーズタイトルの作品名が入ってもヘッダーが崩れず1行省略される確認テスト",
    );
  });

  it("空白のみのタイトルや省略時はデフォルト見出しを表示し、戻るボタン押下でonBackを呼び出す (AC-SD-05)", () => {
    const onBack = vi.fn();
    render(<SeriesDetailHeader title="   " onBack={onBack} />);

    expect(screen.getByTestId("series-detail-header-title")).toHaveTextContent(
      "シリーズ詳細",
    );

    const header = screen.getByRole("banner");
    expect(header.style.paddingTop).toBe(
      "calc(1rem + env(safe-area-inset-top, 0px))",
    );

    fireEvent.click(screen.getByTestId("series-detail-back-button"));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
