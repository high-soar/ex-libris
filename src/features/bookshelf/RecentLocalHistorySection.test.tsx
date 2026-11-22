import { composeStories } from "@storybook/react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { RecentLocalHistorySection } from "./RecentLocalHistorySection";
import * as stories from "./RecentLocalHistorySection.stories";

const { Empty, SingleReading, MixedStatuses } = composeStories(stories);

describe("RecentLocalHistorySection", () => {
  it("Emptyストーリーで履歴0件時はセクション全体を描画しないこと (AC-BS-06)", () => {
    const { container, unmount } = render(<Empty />);

    expect(container.firstElementChild).toBeEmptyDOMElement();
    expect(
      screen.queryByTestId("recent-local-history-section"),
    ).not.toBeInTheDocument();
    unmount();

    const { container: directContainer } = render(
      <RecentLocalHistorySection
        items={[]}
        onReopenLocalFile={vi.fn()}
        onDeleteItem={vi.fn()}
        onClearAll={vi.fn()}
      />,
    );
    expect(directContainer).toBeEmptyDOMElement();
  });

  it("SingleReadingストーリーで見出し・案内文・一括クリアボタン・読書中行・進捗バーを表示すること (AC-BS-06)", () => {
    render(<SingleReading />);

    const section = screen.getByTestId("recent-local-history-section");
    expect(section).toBeVisible();
    expect(
      screen.getByRole("heading", { name: "最近のローカル閲覧履歴" }),
    ).toBeVisible();
    expect(section).toHaveTextContent(
      "同じ .zip / .cbz ファイルを再選択すると、前回のページから自動レジュームします",
    );

    const clearButton = screen.getByTestId("clear-local-history-button");
    expect(clearButton).toHaveTextContent("履歴をクリア");
    expect(clearButton).toHaveClass("touch-manipulation");

    const list = screen.getByTestId("recent-local-history-list");
    const items = within(list).getAllByTestId("recent-local-history-item");
    expect(items).toHaveLength(1);

    const reopenButton = within(items[0]).getByTestId(
      "reopen-local-history-button",
    );
    expect(reopenButton).toHaveClass("touch-manipulation");
    expect(reopenButton).toHaveTextContent("sample-comic-vol01.cbz");
    expect(reopenButton).toHaveTextContent("15.0 MB");
    expect(reopenButton).toHaveTextContent("読書中");
    expect(reopenButton).toHaveTextContent("12 / 24 ページ");

    const fileNameEl = within(reopenButton).getByText("sample-comic-vol01.cbz");
    expect(fileNameEl).toHaveClass("truncate");

    const progressBar = within(reopenButton).getByRole("progressbar");
    expect(progressBar).toHaveAttribute("aria-valuenow", "50");
    expect(
      within(reopenButton).getByTestId("local-history-progress-fill"),
    ).toHaveStyle({ width: "50%" });

    const deleteButton = within(items[0]).getByTestId(
      "delete-local-history-button",
    );
    expect(deleteButton).toHaveClass("touch-manipulation");
  });

  it("MixedStatusesストーリーで各ステータスバッジ・全サイズ単位(B/KB/MB/GB)・進捗バー・completed時100%を正しく表示すること (AC-BS-06)", () => {
    const { unmount } = render(<MixedStatuses />);

    const items = screen.getAllByTestId("recent-local-history-item");
    expect(items).toHaveLength(4);

    // 1件目: reading + GB + 長大ファイル名 truncate
    const item0 = within(items[0]);
    expect(
      item0.getByText(
        "とても長いタイトルの自炊マンガ合本_第01巻-第03巻_高解像度スキャン.cbz",
      ),
    ).toHaveClass("truncate");
    expect(item0.getByText("1.5 GB")).toBeVisible();
    expect(item0.getByText("読書中")).toBeVisible();
    expect(item0.getByText("20 / 40 ページ")).toBeVisible();
    expect(item0.getByTestId("local-history-progress-fill")).toHaveStyle({
      width: "50%",
    });

    // 2件目: completed + KB + 100%
    const item1 = within(items[1]);
    expect(item1.getByText("512.0 KB")).toBeVisible();
    expect(item1.getByText("読了")).toBeVisible();
    expect(item1.getByText("20 / 20 ページ")).toBeVisible();
    expect(item1.getByTestId("local-history-progress-fill")).toHaveStyle({
      width: "100%",
    });

    // 3件目: unread + B + 10%
    const item2 = within(items[2]);
    expect(item2.getByText("512 B")).toBeVisible();
    expect(item2.getByText("未読")).toBeVisible();
    expect(item2.getByText("1 / 10 ページ")).toBeVisible();
    expect(item2.getByTestId("local-history-progress-fill")).toHaveStyle({
      width: "10%",
    });

    // 4件目: reading + MB + 25%
    const item3 = within(items[3]);
    expect(item3.getByText("24.5 MB")).toBeVisible();
    expect(item3.getByText("3 / 12 ページ")).toBeVisible();
    expect(item3.getByTestId("local-history-progress-fill")).toHaveStyle({
      width: "25%",
    });
    unmount();

    // completed ステータス時は途中ページ番号でも進捗バーが 100% になること
    render(
      <SingleReading
        items={[
          {
            targetKey: "local:early-completed.cbz:2048",
            rawFileName: "early-completed.cbz",
            fileSize: 2048,
            currentPageIndex: 1,
            totalPageCount: 10,
            readStatus: "completed",
            spreadPageOffset: 0,
            lastReadAt: 1_730_000_000_000,
          },
        ]}
      />,
    );
    expect(screen.getByText("読了")).toBeVisible();
    expect(screen.getByText("2 / 10 ページ")).toBeVisible();
    expect(screen.getByTestId("local-history-progress-fill")).toHaveStyle({
      width: "100%",
    });
  });

  it("再選択オープン・個別削除・履歴一括クリアの各ボタン押下で分離されたコールバックのみが発火すること (AC-BS-06)", async () => {
    const user = userEvent.setup();
    const onReopenLocalFile = vi.fn();
    const onDeleteItem = vi.fn();
    const onClearAll = vi.fn();

    render(
      <MixedStatuses
        onReopenLocalFile={onReopenLocalFile}
        onDeleteItem={onDeleteItem}
        onClearAll={onClearAll}
      />,
    );

    const reopenButtons = screen.getAllByTestId("reopen-local-history-button");
    const deleteButtons = screen.getAllByTestId("delete-local-history-button");

    // 個別削除ボタンを押しても onReopenLocalFile は発火しない
    await user.click(deleteButtons[1]);
    expect(onDeleteItem).toHaveBeenCalledTimes(1);
    expect(onDeleteItem).toHaveBeenCalledWith(
      "local:completed-oneshot.zip:524288",
    );
    expect(onReopenLocalFile).not.toHaveBeenCalled();

    // 主ボタンを押すと onReopenLocalFile が呼ばれる
    await user.click(reopenButtons[0]);
    expect(onReopenLocalFile).toHaveBeenCalledTimes(1);

    // 履歴をクリア押下で onClearAll が呼ばれる
    await user.click(screen.getByTestId("clear-local-history-button"));
    expect(onClearAll).toHaveBeenCalledTimes(1);
  });
});
