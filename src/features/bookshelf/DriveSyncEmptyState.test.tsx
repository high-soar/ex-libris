import { composeStories } from "@storybook/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as stories from "./DriveSyncEmptyState.stories";

const { Default, Syncing, DragActive } = composeStories(stories);

describe("DriveSyncEmptyState", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("Default・Syncing・DragActive ストーリーを描画し同期状態とドラッグ強調を切り替えられること (AC-BS-08)", () => {
    const { unmount: unmountDefault } = render(<Default />);
    const container = screen.getByTestId("drive-sync-empty-state");
    expect(container).toHaveAttribute("data-drag-active", "false");
    expect(container).toHaveTextContent(
      "マンガ保管フォルダが設定されています。同期を実行して本棚を作成してください",
    );
    const syncBtn = screen.getByTestId("empty-state-sync-drive-button");
    expect(syncBtn).toBeEnabled();
    expect(syncBtn).toHaveTextContent("今すぐ同期");
    expect(screen.queryByTestId("empty-state-sync-spinner")).toBeNull();
    expect(screen.getByTestId("open-local-zip-button")).toHaveTextContent(
      "ローカル ZIP を開く（.zip / .cbz）",
    );
    unmountDefault();

    const { unmount: unmountSyncing } = render(<Syncing />);
    const syncingBtn = screen.getByTestId("empty-state-sync-drive-button");
    expect(syncingBtn).toBeDisabled();
    expect(syncingBtn).toHaveTextContent("同期中...");
    expect(screen.getByTestId("empty-state-sync-spinner")).toBeInTheDocument();
    unmountSyncing();

    render(<DragActive />);
    expect(screen.getByTestId("drive-sync-empty-state")).toHaveAttribute(
      "data-drag-active",
      "true",
    );
  });

  it("今すぐ同期ボタンとローカルZIPサブボタン押下で各コールバックが呼ばれること (AC-BS-01, AC-BS-08)", async () => {
    const user = userEvent.setup();
    const onSyncDrive = vi.fn();
    const onOpenLocalZip = vi.fn();

    render(
      <Default onSyncDrive={onSyncDrive} onOpenLocalZip={onOpenLocalZip} />,
    );

    await user.click(screen.getByTestId("empty-state-sync-drive-button"));
    expect(onSyncDrive).toHaveBeenCalledTimes(1);

    await user.click(screen.getByTestId("open-local-zip-button"));
    expect(onOpenLocalZip).toHaveBeenCalledTimes(1);
  });
});
