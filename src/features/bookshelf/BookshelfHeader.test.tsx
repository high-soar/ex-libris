import { composeStories } from "@storybook/react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { APP_NAME, APP_VERSION } from "../../shared/constants/app";
import { BookshelfHeader } from "./BookshelfHeader";
import * as stories from "./BookshelfHeader.stories";

const { Default, SyncDisabled, Syncing, CopiedFeedback, CopyFailedFeedback } =
  composeStories(stories);

describe("BookshelfHeader", () => {
  it("Defaultストーリーでタイトル・バージョン・同期・ローカルZIP・診断コピー・設定ボタンを表示し初期ステータスを非表示にすること (AC-BS-01, AC-BS-05, AC-BS-07, AC-BS-08)", () => {
    render(<Default />);

    expect(screen.getByRole("banner")).toHaveClass(
      "border-b",
      "border-slate-800",
      "bg-slate-900/90",
    );
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      APP_NAME,
    );
    expect(screen.getByTestId("app-version")).toHaveTextContent(
      `v${APP_VERSION}`,
    );
    const syncButton = screen.getByTestId("header-sync-drive-button");
    expect(syncButton).toHaveTextContent("同期");
    expect(syncButton).toBeEnabled();
    expect(
      screen.getByTestId("header-open-local-zip-button"),
    ).toHaveTextContent("ローカル ZIP を開く");
    expect(screen.getByTestId("copy-diagnostics-button")).toHaveTextContent(
      "診断ログをコピー",
    );
    expect(screen.getByTestId("header-settings-button")).toHaveTextContent(
      "設定",
    );
    expect(
      screen.queryByTestId("copy-diagnostics-status"),
    ).not.toBeInTheDocument();
  });

  it("SyncDisabledおよびSyncingストーリーで同期ボタンの活性制御とスピナー表示を行うこと (AC-BS-08)", () => {
    const { unmount } = render(<SyncDisabled />);
    const disabledButton = screen.getByTestId("header-sync-drive-button");
    expect(disabledButton).toBeDisabled();
    expect(disabledButton).toHaveTextContent("同期");
    expect(screen.queryByTestId("header-sync-spinner")).toBeNull();
    unmount();

    render(<Syncing />);
    const syncingButton = screen.getByTestId("header-sync-drive-button");
    expect(syncingButton).toBeDisabled();
    expect(syncingButton).toHaveTextContent("同期中...");
    expect(screen.getByTestId("header-sync-spinner")).toBeInTheDocument();
  });

  it("CopiedFeedbackおよびCopyFailedFeedbackストーリーで適切なroleとメッセージを表示すること (AC-BS-05)", () => {
    const { unmount } = render(<CopiedFeedback />);
    const copiedStatus = screen.getByTestId("copy-diagnostics-status");
    expect(copiedStatus).toHaveAttribute("role", "status");
    expect(copiedStatus).toHaveTextContent("診断ログをコピーしました");
    unmount();

    render(<CopyFailedFeedback />);
    const failedStatus = screen.getByTestId("copy-diagnostics-status");
    expect(failedStatus).toHaveAttribute("role", "alert");
    expect(failedStatus).toHaveTextContent(
      "クリップボードへコピーできませんでした",
    );
  });

  it("同期・ローカルZIPを開く・診断ログをコピー・設定ボタン押下で対応コールバックが呼ばれ、任意Props省略時も安全に動作すること (AC-BS-01, AC-BS-05, AC-BS-07, AC-BS-08)", async () => {
    const user = userEvent.setup();
    const onSyncDrive = vi.fn();
    const onOpenLocalZip = vi.fn();
    const onCopyDiagnostics = vi.fn();
    const onOpenSettings = vi.fn();

    const { unmount } = render(
      <Default
        onSyncDrive={onSyncDrive}
        onOpenLocalZip={onOpenLocalZip}
        onCopyDiagnostics={onCopyDiagnostics}
        onOpenSettings={onOpenSettings}
      />,
    );

    await user.click(screen.getByTestId("header-sync-drive-button"));
    expect(onSyncDrive).toHaveBeenCalledTimes(1);

    await user.click(screen.getByTestId("header-open-local-zip-button"));
    expect(onOpenLocalZip).toHaveBeenCalledTimes(1);

    await user.click(screen.getByTestId("copy-diagnostics-button"));
    expect(onCopyDiagnostics).toHaveBeenCalledTimes(1);

    await user.click(screen.getByTestId("header-settings-button"));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
    unmount();

    // 任意 Props 省略時は同期ボタンが disabled になり、設定ボタンも例外なく押下可能であること
    render(
      <BookshelfHeader
        copyStatus="idle"
        onCopyDiagnostics={vi.fn()}
        onOpenLocalZip={vi.fn()}
      />,
    );
    expect(screen.getByTestId("header-sync-drive-button")).toBeDisabled();
    await user.click(screen.getByTestId("header-settings-button"));
  });

  it("ヘッダーがセーフエリア上余白を確保しアクションボタンにtouch-manipulationクラスが付与されていること (AC-BS-01, AC-BS-05, AC-BS-07, AC-BS-08)", () => {
    render(<Default />);

    const header = screen.getByRole("banner");
    expect(header).toHaveStyle({
      paddingTop: "calc(1rem + env(safe-area-inset-top, 0px))",
    });
    expect(header.style.paddingTop).toContain("safe-area-inset-top");

    expect(screen.getByTestId("header-sync-drive-button")).toHaveClass(
      "touch-manipulation",
    );
    expect(screen.getByTestId("header-open-local-zip-button")).toHaveClass(
      "touch-manipulation",
    );
    expect(screen.getByTestId("copy-diagnostics-button")).toHaveClass(
      "touch-manipulation",
    );
    expect(screen.getByTestId("header-settings-button")).toHaveClass(
      "touch-manipulation",
    );
  });
});
