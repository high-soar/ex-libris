import { composeStories } from "@storybook/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
import * as stories from "./SeriesCard.stories";

const { Reading, Unread, Completed } = composeStories(stories);

describe("SeriesCard", () => {
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

  it("全Storybookストーリーを描画し、CoverThumbnail へのProps配線と読書ステータスバッジを検証すること (AC-BS-11, AC-BS-12)", () => {
    const { unmount: unmountReading } = render(<Reading />);
    const readingCard = screen.getByTestId("series-card");
    expect(readingCard).toHaveAttribute("data-series-id", "series-frieren");
    expect(readingCard).toHaveTextContent("葬送のフリーレン");
    expect(readingCard).toHaveTextContent("山田鐘人 / アベツカサ");
    expect(screen.getByTestId("series-read-status")).toHaveTextContent(
      "読書中 (5/12)",
    );
    expect(screen.getByTestId("series-card-quick-read")).toHaveTextContent(
      "続きを読む (第6巻)",
    );
    expect(coverSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        coverBlob: null,
        coverStatus: "pending",
        title: "葬送のフリーレン",
        badgeText: "全 12 巻",
      }),
      undefined,
    );
    unmountReading();

    const { unmount: unmountUnread } = render(<Unread />);
    expect(screen.getByTestId("series-read-status")).toHaveTextContent("未読");
    expect(screen.getByTestId("series-card-quick-read")).toHaveTextContent(
      "読む (第1巻)",
    );
    expect(screen.queryByTestId("series-card-authors")).toBeNull();
    unmountUnread();

    render(<Completed />);
    expect(screen.getByTestId("series-read-status")).toHaveTextContent("読了");
    expect(screen.getByTestId("series-card-quick-read")).toHaveTextContent(
      "最初から読む",
    );
  });

  it("カード本体押下で onOpenDetail が呼ばれ、クイック起動ボタン押下時は onQuickRead のみが呼ばれてバブリングしないこと (AC-BS-11)", async () => {
    const user = userEvent.setup();
    const onOpenDetail = vi.fn();
    const onQuickRead = vi.fn();

    render(<Reading onOpenDetail={onOpenDetail} onQuickRead={onQuickRead} />);

    await user.click(screen.getByTestId("series-card-open-detail"));
    expect(onOpenDetail).toHaveBeenCalledTimes(1);
    expect(onOpenDetail).toHaveBeenCalledWith("series-frieren");
    expect(onQuickRead).not.toHaveBeenCalled();

    await user.click(screen.getByTestId("series-card-quick-read"));
    expect(onQuickRead).toHaveBeenCalledTimes(1);
    expect(onQuickRead).toHaveBeenCalledWith("series-frieren", "vol-6");
    expect(onOpenDetail).toHaveBeenCalledTimes(1);
  });

  it("代表表紙が pending のときのみ data-cover-volume-id を付与すること (AC-BS-13)", () => {
    const { unmount } = render(<Reading />);
    expect(screen.getByTestId("series-card")).toHaveAttribute(
      "data-cover-volume-id",
      "vol-1",
    );
    unmount();

    const readingArgs = stories.default.args!;
    const readyItem = {
      ...readingArgs.item!,
      representativeVolume: {
        ...readingArgs.item!.representativeVolume,
        coverStatus: "ready" as const,
      },
    };
    render(<Reading item={readyItem} />);
    expect(screen.getByTestId("series-card")).not.toHaveAttribute(
      "data-cover-volume-id",
    );
  });
});
