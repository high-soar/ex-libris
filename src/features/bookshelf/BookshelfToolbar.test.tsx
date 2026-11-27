import { composeStories } from "@storybook/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BookshelfToolbar } from "./BookshelfToolbar";
import * as stories from "./BookshelfToolbar.stories";

const {
  Default,
  WithSyncResult,
  UnsyncedWithError,
  CoverExtracting,
  CoverPausedWithErrors,
  CoverErrorsOnly,
} = composeStories(stories);

describe("BookshelfToolbar", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("全Storybookストーリーを描画し件数・最終同期日時・同期結果・エラーアラートを表示すること (AC-BS-09, AC-BS-10, AC-BS-13)", () => {
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
    expect(screen.queryByTestId("bookshelf-cover-status")).toBeNull();
    unmountDefault();

    const { unmount: unmountResult } = render(<WithSyncResult />);
    expect(screen.getByTestId("bookshelf-last-synced")).toHaveTextContent(
      "最終同期: 2026/11/25 21:30（+4 / -1）",
    );
    expect(screen.getByTestId("bookshelf-sort-select")).toHaveValue("titleAsc");
    unmountResult();

    const { unmount: unmountError } = render(<UnsyncedWithError />);
    expect(screen.getByTestId("bookshelf-last-synced")).toHaveTextContent(
      "最終同期: 未同期",
    );
    const errorEl = screen.getByTestId("bookshelf-sync-error");
    expect(errorEl).toHaveAttribute("role", "alert");
    expect(errorEl).toHaveTextContent("Google アカウントの認証が切れました");
    unmountError();

    const { unmount: unmountExtracting } = render(<CoverExtracting />);
    expect(screen.getByTestId("bookshelf-cover-status")).toHaveTextContent(
      "表紙抽出中: 11 / 24 冊",
    );
    expect(
      screen.queryByTestId("bookshelf-retry-failed-covers-button"),
    ).toBeNull();
    unmountExtracting();

    const { unmount: unmountPaused } = render(<CoverPausedWithErrors />);
    const pausedStatus = screen.getByTestId("bookshelf-cover-status");
    expect(pausedStatus).toHaveTextContent(
      "表紙抽出中（一時停止）: 10 / 24 冊",
    );
    expect(pausedStatus).toHaveTextContent("表紙未取得: 2 冊");
    expect(
      screen.getByTestId("bookshelf-retry-failed-covers-button"),
    ).toBeDisabled();
    unmountPaused();

    render(<CoverErrorsOnly />);
    const errorOnlyStatus = screen.getByTestId("bookshelf-cover-status");
    expect(errorOnlyStatus).toHaveTextContent("表紙未取得: 2 冊");
    expect(errorOnlyStatus).not.toHaveTextContent("表紙抽出中");
    expect(
      screen.getByTestId("bookshelf-retry-failed-covers-button"),
    ).toBeEnabled();
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

  it("バックオフ待機表示とエラー再試行ボタン押下で onRetryFailedCovers が呼ばれること (AC-BS-13)", async () => {
    const user = userEvent.setup();
    const onRetryFailedCovers = vi.fn();

    render(
      <BookshelfToolbar
        seriesCount={4}
        totalVolumeCount={10}
        sortOrder="lastReadDesc"
        lastSyncedAt={null}
        lastSyncResult={null}
        syncErrorMessage={null}
        coverExtractionState={{
          phase: "backoff",
          totalCount: 10,
          readyCount: 6,
          pendingCount: 3,
          errorCount: 1,
          activeVolumeId: null,
          pauseReasons: [],
        }}
        canRetryCovers={true}
        onRetryFailedCovers={onRetryFailedCovers}
        onChangeSortOrder={vi.fn()}
      />,
    );

    const status = screen.getByTestId("bookshelf-cover-status");
    expect(status).toHaveTextContent("表紙抽出中（待機中）: 6 / 10 冊");
    expect(status).toHaveTextContent("表紙未取得: 1 冊");

    await user.click(
      screen.getByTestId("bookshelf-retry-failed-covers-button"),
    );
    expect(onRetryFailedCovers).toHaveBeenCalledTimes(1);
  });
});
