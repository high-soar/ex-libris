import { composeStories } from "@storybook/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DriveSyncExecutionSection } from "./DriveSyncExecutionSection";
import * as stories from "./DriveSyncExecutionSection.stories";

const {
  ReadyIdle,
  DisabledUnlinked,
  DisabledNoRoots,
  SyncingIncremental,
  SyncingFullScan,
  CompletedWithSummary,
  ErrorState,
} = composeStories(stories);

describe("DriveSyncExecutionSection", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("全Storybookストーリーを描画しステータスバッジ・日時・結果サマリ・エラー・活性条件を検証すること (AC-ST-08)", () => {
    const { unmount: unmountIdle } = render(<ReadyIdle />);
    expect(screen.getByTestId("settings-sync-status-badge")).toHaveTextContent(
      "待機中",
    );
    expect(screen.getByTestId("settings-last-synced-at")).toHaveTextContent(
      "未実行",
    );
    expect(screen.queryByTestId("settings-sync-result-summary")).toBeNull();
    expect(screen.queryByTestId("drive-sync-error")).toBeNull();
    expect(
      screen.getByTestId("settings-sync-incremental-button"),
    ).toBeEnabled();
    expect(screen.getByTestId("settings-sync-full-button")).toBeEnabled();
    unmountIdle();

    const { unmount: unmountUnlinked } = render(<DisabledUnlinked />);
    expect(
      screen.getByTestId("settings-sync-incremental-button"),
    ).toBeDisabled();
    expect(screen.getByTestId("settings-sync-full-button")).toBeDisabled();
    expect(screen.getByTestId("settings-sync-disabled-hint")).toHaveTextContent(
      "Google アカウントと連携",
    );
    unmountUnlinked();

    const { unmount: unmountNoRoots } = render(<DisabledNoRoots />);
    expect(
      screen.getByTestId("settings-sync-incremental-button"),
    ).toBeDisabled();
    expect(screen.getByTestId("settings-sync-disabled-hint")).toHaveTextContent(
      "有効なルートフォルダを 1 件以上",
    );
    unmountNoRoots();

    const { unmount: unmountInc } = render(<SyncingIncremental />);
    expect(screen.getByTestId("settings-sync-status-badge")).toHaveTextContent(
      "同期中",
    );
    expect(screen.getByTestId("settings-sync-spinner")).toBeInTheDocument();
    expect(
      screen.getByTestId("settings-sync-incremental-button"),
    ).toBeDisabled();
    expect(
      screen.getByTestId("settings-sync-incremental-button"),
    ).toHaveTextContent("差分同期中...");
    expect(screen.getByTestId("settings-sync-full-button")).toBeDisabled();
    unmountInc();

    const { unmount: unmountFull } = render(<SyncingFullScan />);
    expect(screen.getByTestId("settings-sync-full-button")).toHaveTextContent(
      "フルスキャン中...",
    );
    unmountFull();

    const { unmount: unmountCompleted } = render(<CompletedWithSummary />);
    expect(screen.getByTestId("settings-sync-status-badge")).toHaveTextContent(
      "同期完了",
    );
    expect(screen.getByTestId("settings-last-synced-at")).toHaveTextContent(
      "2026/11/25 21:30",
    );
    const summary = screen.getByTestId("settings-sync-result-summary");
    expect(summary).toHaveTextContent("差分同期");
    expect(summary).toHaveTextContent("2 フォルダ");
    expect(summary).toHaveTextContent("15 冊");
    expect(summary).toHaveTextContent("2 冊");
    unmountCompleted();

    render(<ErrorState />);
    expect(screen.getByTestId("settings-sync-status-badge")).toHaveTextContent(
      "同期エラー",
    );
    const alert = screen.getByTestId("drive-sync-error");
    expect(alert).toHaveAttribute("role", "alert");
    expect(alert).toHaveTextContent(
      "ネットワークエラーにより Google Drive 同期に失敗しました",
    );
  });

  it("差分同期・強制フルスキャンボタン押下でコールバックが呼ばれ、isBackBlocked中・フルスキャン結果・skipped-no-rootsも正しく描画すること (AC-ST-08)", async () => {
    const user = userEvent.setup();
    const onRunIncrementalSync = vi.fn();
    const onRunFullScan = vi.fn();

    const { unmount } = render(
      <ReadyIdle
        onRunIncrementalSync={onRunIncrementalSync}
        onRunFullScan={onRunFullScan}
      />,
    );

    await user.click(screen.getByTestId("settings-sync-incremental-button"));
    expect(onRunIncrementalSync).toHaveBeenCalledTimes(1);

    await user.click(screen.getByTestId("settings-sync-full-button"));
    expect(onRunFullScan).toHaveBeenCalledTimes(1);
    unmount();

    const { unmount: unmountBlocked } = render(
      <DriveSyncExecutionSection
        authStatus="connected"
        enabledRootCount={1}
        syncPhase="completed"
        activeMode={null}
        lastSyncedAt={Date.UTC(2026, 10, 25, 12, 30, 0)}
        lastResult={{
          mode: "full",
          scannedRoots: 1,
          upsertedVolumes: 10,
          trashedVolumes: 0,
          invalidatedZipCaches: 0,
          syncedAt: Date.UTC(2026, 10, 25, 12, 30, 0),
        }}
        errorMessage=""
        isBackBlocked={true}
        onRunIncrementalSync={vi.fn()}
        onRunFullScan={vi.fn()}
      />,
    );
    expect(
      screen.getByTestId("settings-sync-incremental-button"),
    ).toBeDisabled();
    expect(screen.getByTestId("settings-sync-full-button")).toBeDisabled();
    expect(
      screen.getByTestId("settings-sync-result-summary"),
    ).toHaveTextContent("フルスキャン");
    expect(screen.queryByTestId("drive-sync-error")).toBeNull();
    unmountBlocked();

    render(
      <DriveSyncExecutionSection
        authStatus="connected"
        enabledRootCount={1}
        syncPhase="idle"
        activeMode={null}
        lastSyncedAt={null}
        lastResult={{
          mode: "skipped-no-roots",
          scannedRoots: 0,
          upsertedVolumes: 0,
          trashedVolumes: 0,
          invalidatedZipCaches: 0,
          syncedAt: Date.UTC(2026, 10, 25, 12, 30, 0),
        }}
        errorMessage={null}
        isBackBlocked={false}
        onRunIncrementalSync={vi.fn()}
        onRunFullScan={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("settings-sync-result-summary")).toBeNull();
  });
});
