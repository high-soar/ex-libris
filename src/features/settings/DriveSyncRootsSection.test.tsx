import { composeStories } from "@storybook/react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DriveSyncRootsSection } from "./DriveSyncRootsSection";
import * as stories from "./DriveSyncRootsSection.stories";

const {
  UnlinkedEmpty,
  UnlinkedWithExistingRoots,
  ConnectedEmpty,
  ConnectedWithMixedRoots,
  Submitting,
  ErrorState,
} = composeStories(stories);

describe("DriveSyncRootsSection", () => {
  it("UnlinkedEmptyストーリーで未連携案内・追加系ボタン非活性・登録0件メッセージを表示すること (AC-ST-04)", () => {
    render(<UnlinkedEmpty />);

    expect(screen.getByTestId("drive-sync-roots-section")).toHaveClass(
      "bg-slate-900",
      "border",
      "border-slate-800",
    );
    expect(screen.getByTestId("sync-roots-unlinked-notice")).toHaveTextContent(
      "フォルダを追加するには先に Google アカウントと連携してください",
    );
    expect(screen.getByTestId("open-folder-picker-button")).toBeDisabled();
    expect(screen.getByTestId("folder-input")).toBeDisabled();
    expect(screen.getByTestId("add-folder-by-input-button")).toBeDisabled();
    expect(screen.getByTestId("sync-roots-empty")).toBeVisible();
    expect(screen.queryByTestId("sync-roots-error")).not.toBeInTheDocument();
  });

  it("UnlinkedWithExistingRootsストーリーでは追加操作を非活性にしつつ既存フォルダのトグル・削除操作を許可すること (AC-ST-04)", async () => {
    const user = userEvent.setup();
    const onToggleRootEnabled = vi.fn();
    const onRemoveRoot = vi.fn();

    render(
      <UnlinkedWithExistingRoots
        onToggleRootEnabled={onToggleRootEnabled}
        onRemoveRoot={onRemoveRoot}
      />,
    );

    expect(screen.getByTestId("open-folder-picker-button")).toBeDisabled();
    expect(screen.getByTestId("folder-input")).toBeDisabled();
    expect(screen.getByTestId("add-folder-by-input-button")).toBeDisabled();

    const rows = screen.getAllByTestId("sync-root-item");
    expect(rows).toHaveLength(2);

    const toggle0 = within(rows[0]).getByTestId("toggle-sync-root-button");
    const remove0 = within(rows[0]).getByTestId("remove-sync-root-button");
    expect(toggle0).toHaveAttribute("aria-pressed", "true");
    expect(toggle0).toBeEnabled();
    expect(toggle0).toHaveClass("touch-manipulation");
    expect(remove0).toBeEnabled();
    expect(remove0).toHaveClass("touch-manipulation");

    await user.click(toggle0);
    expect(onToggleRootEnabled).toHaveBeenCalledWith(
      "1AbCdEfGhIjKlMnOpQrStUvWxYz",
      false,
    );

    await user.click(remove0);
    expect(onRemoveRoot).toHaveBeenCalledWith("1AbCdEfGhIjKlMnOpQrStUvWxYz");
  });

  it("ConnectedEmptyストーリーでピッカー・入力欄を有効化し空入力フォーム送信を抑止すること (AC-ST-02, AC-ST-03)", async () => {
    const user = userEvent.setup();
    const onOpenFolderPicker = vi.fn();
    const onChangeFolderInput = vi.fn();
    const onAddFolderByInput = vi.fn();

    const openFolderPickerButtonRef = {
      current: null as HTMLButtonElement | null,
    };

    render(
      <ConnectedEmpty
        openFolderPickerButtonRef={openFolderPickerButtonRef}
        onOpenFolderPicker={onOpenFolderPicker}
        onChangeFolderInput={onChangeFolderInput}
        onAddFolderByInput={onAddFolderByInput}
      />,
    );

    expect(
      screen.queryByTestId("sync-roots-unlinked-notice"),
    ).not.toBeInTheDocument();

    const pickerBtn = screen.getByTestId("open-folder-picker-button");
    const input = screen.getByTestId("folder-input");
    const addBtn = screen.getByTestId("add-folder-by-input-button");

    expect(openFolderPickerButtonRef.current).toBe(pickerBtn);
    expect(pickerBtn).toBeEnabled();
    expect(pickerBtn).toHaveClass("touch-manipulation");
    expect(input).toBeEnabled();
    expect(addBtn).toBeDisabled();
    expect(addBtn).toHaveClass("touch-manipulation");

    await user.click(pickerBtn);
    expect(onOpenFolderPicker).toHaveBeenCalledTimes(1);

    await user.type(input, "A");
    expect(onChangeFolderInput).toHaveBeenCalledWith("A");

    // フォームの空送信や空白のみ送信は onAddFolderByInput を呼ばない
    const form = input.closest("form")!;
    const submitEvent = new Event("submit", {
      bubbles: true,
      cancelable: true,
    });
    fireEvent(form, submitEvent);
    expect(submitEvent.defaultPrevented).toBe(true);
    expect(onAddFolderByInput).not.toHaveBeenCalled();
  });

  it("ConnectedWithMixedRootsストーリーでフォルダ情報・有効/無効トグル・非空入力送信が動作すること (AC-ST-03, AC-ST-04)", async () => {
    const user = userEvent.setup();
    const onToggleRootEnabled = vi.fn();
    const onAddFolderByInput = vi.fn();

    render(
      <ConnectedWithMixedRoots
        folderInput="https://drive.google.com/drive/folders/folder-xyz"
        onToggleRootEnabled={onToggleRootEnabled}
        onAddFolderByInput={onAddFolderByInput}
      />,
    );

    const rows = screen.getAllByTestId("sync-root-item");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("自炊マンガ（完結）");
    expect(rows[0]).toHaveTextContent("1AbCdEfGhIjKlMnOpQrStUvWxYz");
    expect(
      within(rows[0]).getByTestId("toggle-sync-root-button"),
    ).toHaveAttribute("aria-pressed", "true");

    const toggle1 = within(rows[1]).getByTestId("toggle-sync-root-button");
    expect(toggle1).toHaveAttribute("aria-pressed", "false");
    await user.click(toggle1);
    expect(onToggleRootEnabled).toHaveBeenCalledWith(
      "2ZyXwVuTsRqPoNmLkJiHgFeDcBa",
      true,
    );

    const addBtn = screen.getByTestId("add-folder-by-input-button");
    expect(addBtn).toBeEnabled();
    await user.click(addBtn);
    expect(onAddFolderByInput).toHaveBeenCalledTimes(1);
  });

  it("Submittingストーリーで追加処理中表示・入力抑止を行い、ErrorStateでrole='alert'を表示すること (AC-ST-03)", () => {
    const { unmount } = render(<Submitting />);

    expect(screen.getByTestId("open-folder-picker-button")).toBeDisabled();
    expect(screen.getByTestId("folder-input")).toBeDisabled();
    const submitBtn = screen.getByTestId("add-folder-by-input-button");
    expect(submitBtn).toBeDisabled();
    expect(submitBtn).toHaveTextContent("追加中");

    // 送信中フォーム submit でも抑止
    const onAddFolderByInput = vi.fn();
    unmount();
    const { unmount: unmountSubmittingCb } = render(
      <Submitting onAddFolderByInput={onAddFolderByInput} />,
    );
    fireEvent.submit(screen.getByTestId("folder-input").closest("form")!);
    expect(onAddFolderByInput).not.toHaveBeenCalled();
    unmountSubmittingCb();

    const { unmount: unmountErr } = render(<ErrorState />);
    const alert = screen.getByTestId("sync-roots-error");
    expect(alert).toHaveAttribute("role", "alert");
    expect(alert).toHaveTextContent("マイドライブ直下（root）");
    unmountErr();

    // 空文字エラー時はアラート非表示
    render(
      <DriveSyncRootsSection
        roots={[]}
        isConnected={true}
        folderInput="   "
        isSubmitting={false}
        errorMessage=""
        onChangeFolderInput={vi.fn()}
        onAddFolderByInput={vi.fn()}
        onOpenFolderPicker={vi.fn()}
        onToggleRootEnabled={vi.fn()}
        onRemoveRoot={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("sync-roots-error")).not.toBeInTheDocument();
  });

  it("Drive同期実行中(isSyncing=true)はフォルダ追加・ピッカー・有効切替・削除をすべてdisabledで排他保護すること (AC-ST-08)", async () => {
    const user = userEvent.setup();
    const onToggleRootEnabled = vi.fn();
    const onRemoveRoot = vi.fn();

    render(
      <ConnectedWithMixedRoots
        isSyncing={true}
        folderInput="folder-abc"
        onToggleRootEnabled={onToggleRootEnabled}
        onRemoveRoot={onRemoveRoot}
      />,
    );

    expect(screen.getByTestId("open-folder-picker-button")).toBeDisabled();
    expect(screen.getByTestId("folder-input")).toBeDisabled();
    expect(screen.getByTestId("add-folder-by-input-button")).toBeDisabled();

    const rows = screen.getAllByTestId("sync-root-item");
    for (const row of rows) {
      const toggle = within(row).getByTestId("toggle-sync-root-button");
      const remove = within(row).getByTestId("remove-sync-root-button");
      expect(toggle).toBeDisabled();
      expect(remove).toBeDisabled();
      await user.click(toggle);
      await user.click(remove);
    }

    expect(onToggleRootEnabled).not.toHaveBeenCalled();
    expect(onRemoveRoot).not.toHaveBeenCalled();
  });
});
