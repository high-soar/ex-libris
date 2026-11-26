import type { Meta, StoryObj } from "@storybook/react";
import { DriveSyncEmptyState } from "./DriveSyncEmptyState";

const meta: Meta<typeof DriveSyncEmptyState> = {
  title: "Bookshelf/DriveSyncEmptyState",
  component: DriveSyncEmptyState,
  parameters: {
    layout: "fullscreen",
  },
  decorators: [
    (Story) => (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-6">
        <Story />
      </div>
    ),
  ],
  args: {
    isSyncing: false,
    isDragActive: false,
    onSyncDrive: () => {},
    onOpenLocalZip: () => {},
  },
};

export default meta;
type Story = StoryObj<typeof DriveSyncEmptyState>;

/** Drive 連携済み・蔵書 0 件時の手動同期誘導状態 */
export const Default: Story = {
  name: "未同期（今すぐ同期 CTA）",
};

/** 同期実行中のスピナー＆ボタン非活性状態 */
export const Syncing: Story = {
  name: "同期実行中",
  args: {
    isSyncing: true,
  },
};

/** ローカルファイルドラッグ中のハイライト状態 */
export const DragActive: Story = {
  name: "ドラッグオーバー強調状態",
  args: {
    isDragActive: true,
  },
};
