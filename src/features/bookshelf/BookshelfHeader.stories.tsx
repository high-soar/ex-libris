import type { Meta, StoryObj } from "@storybook/react";
import { BookshelfHeader } from "./BookshelfHeader";

const meta: Meta<typeof BookshelfHeader> = {
  title: "Bookshelf/BookshelfHeader",
  component: BookshelfHeader,
  parameters: {
    layout: "fullscreen",
  },
  decorators: [
    (Story) => (
      <div className="min-h-screen bg-slate-950 text-slate-100">
        <Story />
      </div>
    ),
  ],
  args: {
    copyStatus: "idle",
    canSync: true,
    isSyncing: false,
    onCopyDiagnostics: () => {},
    onOpenLocalZip: () => {},
    onOpenSettings: () => {},
    onSyncDrive: () => {},
  },
};

export default meta;
type Story = StoryObj<typeof BookshelfHeader>;

/** 本棚ヘッダーの初期表示状態（同期可能） */
export const Default: Story = {
  name: "初期状態",
};

/** Google Drive 未連携またはルート未設定時の同期ボタン非活性状態 */
export const SyncDisabled: Story = {
  name: "同期非活性状態（未連携・ルート未設定）",
  args: {
    canSync: false,
    isSyncing: false,
  },
};

/** Google Drive 手動同期実行中のスピナー表示状態 */
export const Syncing: Story = {
  name: "Google Drive 同期実行中",
  args: {
    canSync: true,
    isSyncing: true,
  },
};

/** 診断ログのクリップボードコピー完了時のステータス表示 */
export const CopiedFeedback: Story = {
  name: "診断ログコピー完了状態",
  args: {
    copyStatus: "copied",
  },
};

/** クリップボード書き込み失敗時の警告表示 */
export const CopyFailedFeedback: Story = {
  name: "診断ログコピー失敗状態",
  args: {
    copyStatus: "failed",
  },
};
