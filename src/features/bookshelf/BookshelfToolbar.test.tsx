import { composeStories } from "@storybook/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BookshelfToolbar } from "./BookshelfToolbar";
import * as stories from "./BookshelfToolbar.stories";

const { Default, WithSyncResult, UnsyncedWithError } = composeStories(stories);

describe("BookshelfToolbar", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("全Storybookストーリーを描画し件数・最終同期日時・同期結果・エラーアラートを表示すること (AC-BS-09, AC-BS-10)", () => {
    const { unmount: unmountDefault } = render(<Default />);
    expect(screen.getByTestId("bookshelf-toolbar")).toBeInTheDocument();
    expect(screen.getByTestId("bookshelf-series-count")).toHaveTextContent(
      "全 12 作品 / 148 冊",
    );
    expect(screen.getByTestId("bookshelf-last-synced")).toHaveTextContent(
      "最終同期: 2026/11/25 21:30",
    );
    expect(screen.getByTestId("bookshelf-sort-select")).toHaveValue(
      "lastReadDesc",
    );
    expect(screen.queryByTestId("bookshelf-sync-error")).toBeNull();
    unmountDefault();

    const { unmount: unmountResult } = render(<WithSyncResult />);
    expect(screen.getByTestId("bookshelf-last-synced")).toHaveTextContent(
      "最終同期: 2026/11/25 21:30（+4 / -1）",
    );
    expect(screen.getByTestId("bookshelf-sort-select")).toHaveValue("titleAsc");
    unmountResult();

    render(<UnsyncedWithError />);
    expect(screen.getByTestId("bookshelf-last-synced")).toHaveTextContent(
      "最終同期: 未同期",
    );
    const errorEl = screen.getByTestId("bookshelf-sync-error");
    expect(errorEl).toHaveAttribute("role", "alert");
    expect(errorEl).toHaveTextContent("Google アカウントの認証が切れました");
  });

  it("4軸ソートセレクトの変更で onChangeSortOrder が呼ばれ、skipped-no-roots 結果ではサマリを付記しないこと (AC-BS-10)", async () => {
    const user = userEvent.setup();
    const onChangeSortOrder = vi.fn();

    render(
      <BookshelfToolbar
        seriesCount={2}
        totalVolumeCount={5}
        sortOrder="lastReadDesc"
        lastSyncedAt={Date.UTC(2026, 10, 25, 12, 30, 0)}
        lastSyncResult={{
          mode: "skipped-no-roots",
          scannedRoots: 0,
          upsertedVolumes: 0,
          trashedVolumes: 0,
          invalidatedZipCaches: 0,
          syncedAt: Date.UTC(2026, 10, 25, 12, 30, 0),
        }}
        syncErrorMessage=""
        onChangeSortOrder={onChangeSortOrder}
      />,
    );

    expect(screen.getByTestId("bookshelf-last-synced")).toHaveTextContent(
      /^最終同期: 2026\/11\/25 21:30$/,
    );
    expect(screen.queryByTestId("bookshelf-sync-error")).toBeNull();

    const select = screen.getByTestId("bookshelf-sort-select");
    await user.selectOptions(select, "addedDesc");
    await user.selectOptions(select, "titleAsc");
    await user.selectOptions(select, "volumeCountDesc");

    expect(onChangeSortOrder).toHaveBeenNthCalledWith(1, "addedDesc");
    expect(onChangeSortOrder).toHaveBeenNthCalledWith(2, "titleAsc");
    expect(onChangeSortOrder).toHaveBeenNthCalledWith(3, "volumeCountDesc");
  });
});
