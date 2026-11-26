import { composeStories } from "@storybook/react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
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
import { SeriesVolumeListSection } from "./SeriesVolumeListSection";
import * as stories from "./SeriesVolumeListSection.stories";

const { MixedVolumes } = composeStories(stories);

describe("SeriesVolumeListSection", () => {
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

  it("単巻・合本バッジ・ファイル名/サイズ・ステータス・進捗バーを表示し、CoverThumbnailを分離呼び出しする (AC-SD-02, AC-SD-06)", () => {
    render(<MixedVolumes />);

    expect(screen.getByTestId("series-volume-list")).toBeInTheDocument();
    const items = screen.getAllByTestId("series-volume-item");
    expect(items).toHaveLength(3);
    expect(coverSpy).toHaveBeenCalledTimes(3);

    // 1巻: 読了・100%・合本バッジなし
    const first = within(items[0]!);
    expect(items[0]).toHaveAttribute("data-volume-id", "vol-1");
    expect(first.getByTestId("volume-label")).toHaveTextContent("第01巻");
    expect(first.queryByTestId("volume-omnibus-badge")).toBeNull();
    expect(first.getByTestId("volume-read-status")).toHaveTextContent("読了");
    expect(first.getByTestId("volume-raw-filename")).toHaveTextContent(
      "[九井諒子] ダンジョン飯 第01巻.zip",
    );
    expect(first.getByTestId("volume-file-size")).toHaveTextContent("46.0 MB");
    expect(first.getByTestId("volume-progress-text")).toHaveTextContent(
      "192 / 192 ページ",
    );
    expect(first.getByTestId("volume-progress-bar")).toHaveStyle({
      width: "100%",
    });

    // 2巻: 読書中・25%
    const second = within(items[1]!);
    expect(second.getByTestId("volume-read-status")).toHaveTextContent(
      "読書中",
    );
    expect(second.getByTestId("volume-progress-text")).toHaveTextContent(
      "48 / 192 ページ",
    );
    expect(second.getByTestId("volume-progress-bar")).toHaveStyle({
      width: "25%",
    });

    // 3巻: 合本・未読・進捗バーなし
    const third = within(items[2]!);
    expect(third.getByTestId("volume-label")).toHaveTextContent(
      "第03-05巻 合本",
    );
    expect(third.getByTestId("volume-omnibus-badge")).toHaveTextContent("合本");
    expect(third.getByTestId("volume-read-status")).toHaveTextContent("未読");
    expect(third.queryByTestId("volume-progress")).toBeNull();
  });

  it("任意の巻行クリックで該当volumeIdをonSelectVolumeへ通知する (AC-SD-03)", () => {
    const onSelectVolume = vi.fn();
    render(
      <SeriesVolumeListSection
        volumes={MixedVolumes.args.volumes!}
        onSelectVolume={onSelectVolume}
      />,
    );

    const buttons = screen.getAllByTestId("open-volume-reader-button");
    fireEvent.click(buttons[2]!);
    expect(onSelectVolume).toHaveBeenCalledWith("vol-omnibus");
  });
});
