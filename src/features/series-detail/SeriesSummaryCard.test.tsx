import { composeStories } from "@storybook/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type MockInstance,
  vi,
} from "vitest";
import * as CoverThumbnailModule from "../../shared/ui/CoverThumbnail";
import { SeriesSummaryCard } from "./SeriesSummaryCard";
import * as stories from "./SeriesSummaryCard.stories";

const { Reading, CompletedNoAuthors } = composeStories(stories);

describe("SeriesSummaryCard", () => {
  let coverSpy: MockInstance<typeof CoverThumbnailModule.CoverThumbnail>;

  beforeEach(() => {
    coverSpy = vi
      .spyOn(CoverThumbnailModule, "CoverThumbnail")
      .mockImplementation(() => null);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("全Storybookストーリーを描画し、代表表紙Propsとメタ情報・読了サマリを表示する (AC-SD-01, AC-SD-06)", () => {
    const { unmount: unmountReading } = render(<Reading />);
    expect(screen.getByTestId("series-detail-title")).toHaveTextContent(
      "ダンジョン飯",
    );
    expect(screen.getByTestId("series-detail-authors")).toHaveTextContent(
      "九井諒子",
    );
    expect(
      screen.getByTestId("series-detail-progress-summary"),
    ).toHaveTextContent("全 14 巻");
    expect(
      screen.getByTestId("series-detail-progress-summary"),
    ).toHaveTextContent("1 / 14 冊読了");
    expect(
      screen.getByTestId("series-detail-primary-read-button"),
    ).toHaveTextContent("続きを読む（第02巻）");
    expect(coverSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        coverBlob: null,
        coverStatus: "pending",
        title: "ダンジョン飯",
        badgeText: "全 14 巻",
      }),
      undefined,
    );
    unmountReading();

    coverSpy.mockClear();
    render(<CompletedNoAuthors />);
    expect(screen.getByTestId("series-detail-title")).toHaveTextContent(
      "よつばと！",
    );
    expect(screen.queryByTestId("series-detail-authors")).toBeNull();
    expect(
      screen.getByTestId("series-detail-progress-summary"),
    ).toHaveTextContent("3 / 3 冊読了");
    expect(
      screen.getByTestId("series-detail-primary-read-button"),
    ).toHaveTextContent("最初から読む（第01巻）");
  });

  it("プライマリCTA押下でquickLaunch対象巻のvolumeIdをonQuickReadへ通知する (AC-SD-03)", () => {
    const onQuickRead = vi.fn();
    render(
      <SeriesSummaryCard
        title={Reading.args.title!}
        authors={["九井諒子", "監修チーム"]}
        representativeVolume={Reading.args.representativeVolume!}
        volumeCount={Reading.args.volumeCount!}
        completedCount={Reading.args.completedCount!}
        quickLaunch={Reading.args.quickLaunch!}
        onQuickRead={onQuickRead}
      />,
    );

    expect(screen.getByTestId("series-detail-authors")).toHaveTextContent(
      "九井諒子 / 監修チーム",
    );

    fireEvent.click(screen.getByTestId("series-detail-primary-read-button"));
    expect(onQuickRead).toHaveBeenCalledWith("vol-2");
  });
});
