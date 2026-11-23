import { composeStories } from "@storybook/react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DriveFolderPickerModal } from "./DriveFolderPickerModal";
import * as stories from "./DriveFolderPickerModal.stories";

const {
  RootDirectory,
  SubdirectoryWithPagination,
  Loading,
  Saving,
  ErrorState,
  EmptySubdirectory,
  Closed,
} = composeStories(stories);

describe("DriveFolderPickerModal", () => {
  it("Closedストーリーでモーダルとバックドロップを描画しないこと (AC-ST-02)", () => {
    const { container } = render(<Closed />);

    expect(container.firstElementChild).toBeEmptyDOMElement();
    expect(
      screen.queryByTestId("drive-folder-picker-modal"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("folder-picker-backdrop"),
    ).not.toBeInTheDocument();
  });

  it("RootDirectoryストーリーでマイドライブ確定不可・サブフォルダ操作・バックドロップ閉鎖が動作すること (AC-ST-02, AC-ST-06)", async () => {
    const user = userEvent.setup();
    const onOpenFolder = vi.fn();
    const onSelectFolder = vi.fn();
    const onClose = vi.fn();

    render(
      <RootDirectory
        onOpenFolder={onOpenFolder}
        onSelectFolder={onSelectFolder}
        onClose={onClose}
      />,
    );

    const backdrop = screen.getByTestId("folder-picker-backdrop");
    expect(backdrop).toHaveAttribute("aria-hidden", "true");

    const dialog = screen.getByTestId("drive-folder-picker-modal");
    expect(dialog).toHaveAttribute("role", "dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAttribute("aria-label", "Google Drive フォルダを選択");

    const confirmBtn = screen.getByTestId("confirm-current-folder-button");
    expect(confirmBtn).toBeDisabled();
    expect(confirmBtn).toHaveTextContent("このフォルダを追加");
    expect(confirmBtn).toHaveClass("touch-manipulation");

    const items = screen.getAllByTestId("folder-picker-item");
    expect(items).toHaveLength(3);

    const openBtn = within(items[0]).getByTestId("open-subfolder-button");
    const selectBtn = within(items[0]).getByTestId("select-subfolder-button");
    expect(openBtn).toHaveClass("touch-manipulation");
    expect(selectBtn).toHaveClass("touch-manipulation");

    await user.click(openBtn);
    expect(onOpenFolder).toHaveBeenCalledWith({
      id: "folder-action",
      name: "アクション",
    });

    await user.click(selectBtn);
    expect(onSelectFolder).toHaveBeenCalledWith({
      id: "folder-action",
      name: "アクション",
    });

    expect(
      screen.queryByTestId("folder-picker-load-more"),
    ).not.toBeInTheDocument();

    await user.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);

    await user.click(screen.getByTestId("close-folder-picker-button"));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("SubdirectoryWithPaginationストーリーでパンくず移動・現在フォルダ確定・さらに読み込むが動作すること (AC-ST-02)", async () => {
    const user = userEvent.setup();
    const onNavigateBreadcrumb = vi.fn();
    const onConfirmCurrentFolder = vi.fn();
    const onLoadMore = vi.fn();

    const { unmount } = render(
      <SubdirectoryWithPagination
        onNavigateBreadcrumb={onNavigateBreadcrumb}
        onConfirmCurrentFolder={onConfirmCurrentFolder}
        onLoadMore={onLoadMore}
      />,
    );

    const nav = screen.getByTestId("folder-picker-breadcrumbs");
    const crumbBtns = within(nav).getAllByRole("button");
    expect(crumbBtns).toHaveLength(2);
    expect(crumbBtns[0]).toHaveTextContent("マイドライブ");
    expect(crumbBtns[1]).toHaveTextContent("Comics");

    const currentCrumb = within(nav).getByText("自炊マンガ");
    expect(currentCrumb).toHaveAttribute("aria-current", "page");

    await user.click(crumbBtns[1]);
    expect(onNavigateBreadcrumb).toHaveBeenCalledWith(1);

    const confirmBtn = screen.getByTestId("confirm-current-folder-button");
    expect(confirmBtn).toBeEnabled();
    await user.click(confirmBtn);
    expect(onConfirmCurrentFolder).toHaveBeenCalledTimes(1);

    const loadMoreBtn = screen.getByTestId("folder-picker-load-more");
    expect(loadMoreBtn).toBeEnabled();
    expect(loadMoreBtn).toHaveTextContent("さらに読み込む");
    expect(loadMoreBtn).toHaveClass("touch-manipulation");
    await user.click(loadMoreBtn);
    expect(onLoadMore).toHaveBeenCalledTimes(1);
    unmount();

    // isLoadingMore=true 時は読み込み中ラベル・非活性となり、breadcrumbs=[] でも安全に root 扱いとなること
    render(
      <DriveFolderPickerModal
        isOpen={true}
        breadcrumbs={[]}
        folders={[{ id: "f1", name: "Sub" }]}
        nextPageToken="p2"
        isLoading={false}
        isLoadingMore={true}
        isSaving={false}
        errorMessage=""
        onNavigateBreadcrumb={vi.fn()}
        onOpenFolder={vi.fn()}
        onSelectFolder={vi.fn()}
        onConfirmCurrentFolder={vi.fn()}
        onLoadMore={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByTestId("confirm-current-folder-button")).toBeDisabled();
    const loadingMoreBtn = screen.getByTestId("folder-picker-load-more");
    expect(loadingMoreBtn).toBeDisabled();
    expect(loadingMoreBtn).toHaveTextContent("読み込み中...");
    expect(screen.queryByTestId("folder-picker-error")).not.toBeInTheDocument();
  });

  it("Loadingストーリーで読込中表示・確定非活性・追加読込ボタン非表示を行うこと (AC-ST-02)", () => {
    render(<Loading nextPageToken="stale-token" />);

    expect(screen.getByTestId("folder-picker-loading")).toHaveAttribute(
      "role",
      "status",
    );
    expect(screen.getByTestId("confirm-current-folder-button")).toBeDisabled();
    expect(
      screen.queryByTestId("folder-picker-load-more"),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("folder-picker-list")).not.toBeInTheDocument();
  });

  it("Savingストーリーではバックドロップクリックや各種ボタン操作で閉じたり更新したりできないこと (AC-ST-06)", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onConfirmCurrentFolder = vi.fn();
    const onLoadMore = vi.fn();

    render(
      <Saving
        onClose={onClose}
        onConfirmCurrentFolder={onConfirmCurrentFolder}
        onLoadMore={onLoadMore}
      />,
    );

    const confirmBtn = screen.getByTestId("confirm-current-folder-button");
    expect(confirmBtn).toBeDisabled();
    expect(confirmBtn).toHaveTextContent("保存中");
    expect(screen.getByTestId("close-folder-picker-button")).toBeDisabled();
    expect(screen.getByTestId("folder-picker-load-more")).toBeDisabled();

    const firstRow = screen.getAllByTestId("folder-picker-item")[0];
    expect(
      within(firstRow).getByTestId("open-subfolder-button"),
    ).toBeDisabled();
    expect(
      within(firstRow).getByTestId("select-subfolder-button"),
    ).toBeDisabled();

    await user.click(screen.getByTestId("folder-picker-backdrop"));
    await user.click(screen.getByTestId("close-folder-picker-button"));
    await user.click(confirmBtn);
    await user.click(screen.getByTestId("folder-picker-load-more"));

    expect(onClose).not.toHaveBeenCalled();
    expect(onConfirmCurrentFolder).not.toHaveBeenCalled();
    expect(onLoadMore).not.toHaveBeenCalled();
  });

  it("ErrorStateおよびEmptySubdirectoryストーリーでエラー表示と0件表示を適切に切り替えること (AC-ST-02)", () => {
    const { unmount } = render(<ErrorState />);

    const alert = screen.getByTestId("folder-picker-error");
    expect(alert).toHaveAttribute("role", "alert");
    expect(alert).toHaveTextContent(
      "Google Drive フォルダ一覧の取得に失敗しました。",
    );
    expect(screen.queryByTestId("folder-picker-empty")).not.toBeInTheDocument();
    unmount();

    render(<EmptySubdirectory />);
    expect(screen.getByTestId("folder-picker-empty")).toBeVisible();
    expect(screen.queryByTestId("folder-picker-error")).not.toBeInTheDocument();
  });
});
