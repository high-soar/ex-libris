import { composeStories } from "@storybook/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SeriesDetailEmptyState } from "./SeriesDetailEmptyState";
import * as stories from "./SeriesDetailEmptyState.stories";

const { Default } = composeStories(stories);

describe("SeriesDetailEmptyState", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("未存在・有効巻0件時の案内メッセージを表示する (AC-SD-04, AC-SD-06)", () => {
    render(<Default />);

    expect(screen.getByTestId("series-detail-empty")).toBeInTheDocument();
    expect(screen.getByText("シリーズを表示できません")).toBeInTheDocument();
    expect(
      screen.getByText(
        "指定されたシリーズが見つからないか、有効な同期フォルダ内に表示できる巻がありません。",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("series-detail-empty-back-button"),
    ).toHaveTextContent("本棚へ戻る");
  });

  it("本棚へ戻るボタン押下でonBackを呼び出す (AC-SD-05)", () => {
    const onBack = vi.fn();
    render(<SeriesDetailEmptyState onBack={onBack} />);

    fireEvent.click(screen.getByTestId("series-detail-empty-back-button"));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
