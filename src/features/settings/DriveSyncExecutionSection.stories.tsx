import type { Meta, StoryObj } from "@storybook/react";
import { DriveSyncExecutionSection } from "./DriveSyncExecutionSection";

// 2026-11-25 21:30:00 JST (12:30:00 UTC)
const FIXED_SYNCED_AT = Date.UTC(2026, 10, 25, 12, 30, 0);

const meta: Meta<typeof DriveSyncExecutionSection> = {
  title: "Settings/DriveSyncExecutionSection",
  component: DriveSyncExecutionSection,
  parameters: {
    layout: "padded",
  },
  decorators: [
    (Story) => (
      <div className="min-h-screen bg-slate-950 p-4 text-slate-100">
        <div className="mx-auto max-w-3xl">
          <Story />
        </div>
      </div>
    ),
  ],
  args: {
    authStatus: "connected",
    enabledRootCount: 2,
    syncPhase: "idle",
    activeMode: null,
    lastSyncedAt: null,
    lastResult: null,
    errorMessage: null,
    isBackBlocked: false,
    onRunIncrementalSync: () => {},
    onRunFullScan: () => {},
  },
};

export default meta;
type Story = StoryObj<typeof DriveSyncExecutionSection>;

/** 連携済み・有効ルートありの初期待機状態（未実行） */
export const ReadyIdle: Story = {
  name: "待機中（未実行・同期可能）",
};

/** Google 未連携または有効ルート 0 件時の実行不可状態 */
export const DisabledUnlinked: Story = {
  name: "未連携（実行不可）",
  args: {
    authStatus: "unlinked",
    enabledRootCount: 0,
  },
};

/** 連携済みだが有効ルート 0 件時の実行不可状態 */
export const DisabledNoRoots: Story = {
  name: "有効ルート0件（実行不可）",
  args: {
    authStatus: "connected",
    enabledRootCount: 0,
  },
};

/** 差分同期実行中のスピナー＆ボタン非活性状態 */
export const SyncingIncremental: Story = {
  name: "差分同期実行中",
  args: {
    syncPhase: "syncing",
    activeMode: "incremental",
    lastSyncedAt: FIXED_SYNCED_AT,
  },
};

/** 強制フルスキャン実行中のスピナー＆ボタン非活性状態 */
export const SyncingFullScan: Story = {
  name: "強制フルスキャン実行中",
  args: {
    syncPhase: "syncing",
    activeMode: "full",
    lastSyncedAt: FIXED_SYNCED_AT,
  },
};

/** 同期完了後の最終同期日時・結果サマリ表示状態 */
export const CompletedWithSummary: Story = {
  name: "同期完了（サマリ表示）",
  args: {
    syncPhase: "completed",
    lastSyncedAt: FIXED_SYNCED_AT,
    lastResult: {
      mode: "incremental",
      scannedRoots: 2,
      upsertedVolumes: 15,
      trashedVolumes: 2,
      invalidatedZipCaches: 1,
      syncedAt: FIXED_SYNCED_AT,
    },
  },
};

/** 同期失敗時のエラーアラート表示状態 */
export const ErrorState: Story = {
  name: "同期エラー表示",
  args: {
    syncPhase: "error",
    lastSyncedAt: FIXED_SYNCED_AT,
    errorMessage: "ネットワークエラーにより Google Drive 同期に失敗しました",
  },
};
