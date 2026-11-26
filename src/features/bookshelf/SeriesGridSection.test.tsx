import { composeStories } from "@storybook/react";
import { cleanup, render, screen } from "@testing-library/react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type MockInstance,
  vi,
} from "vitest";
import * as SeriesCardModule from "./SeriesCard";
import * as stories from "./SeriesGridSection.stories";

const { Default } = composeStories(stories);

describe("SeriesGridSection", () => {
  let cardSpy: MockInstance<typeof SeriesCardModule.SeriesCard>;

  beforeEach(() => {
    cardSpy = vi
      .spyOn(SeriesCardModule, "SeriesCard")
      .mockImplementation(() => null);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("全シリーズ項目を SeriesCard へ順に配線して描画すること (AC-BS-09, AC-BS-11)", () => {
    const onOpenDetail = vi.fn();
    const onQuickRead = vi.fn();

    render(<Default onOpenDetail={onOpenDetail} onQuickRead={onQuickRead} />);

    expect(screen.getByTestId("series-grid-section")).toBeInTheDocument();
    expect(cardSpy).toHaveBeenCalledTimes(3);
    expect(cardSpy).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        item: expect.objectContaining({ seriesId: "s-1" }),
        onOpenDetail,
        onQuickRead,
      }),
      undefined,
    );
    expect(cardSpy).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        item: expect.objectContaining({ seriesId: "s-2" }),
        onOpenDetail,
        onQuickRead,
      }),
      undefined,
    );
    expect(cardSpy).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        item: expect.objectContaining({ seriesId: "s-3" }),
        onOpenDetail,
        onQuickRead,
      }),
      undefined,
    );
  });
});
