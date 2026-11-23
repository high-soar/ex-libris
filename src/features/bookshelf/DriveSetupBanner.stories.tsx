import type { Meta, StoryObj } from "@storybook/react";
import { DriveSetupBanner } from "./DriveSetupBanner";

const meta: Meta<typeof DriveSetupBanner> = {
  title: "Bookshelf/DriveSetupBanner",
  component: DriveSetupBanner,
  parameters: {
    layout: "fullscreen",
  },
  decorators: [
    (Story) => (
      <div className="min-h-screen bg-slate-950 p-6 text-slate-100 flex items-center justify-center">
        <Story />
      </div>
    ),
  ],
  args: {
    state: { kind: "unauthenticated" },
    onOpenSettings: () => {},
  },
};

export default meta;
type Story = StoryObj<typeof DriveSetupBanner>;

/** Google アカウント未連携時のセットアップ案内バナー */
export const Unauthenticated: Story = {
  name: "未連携ガイド",
};

/** Google アカウント連携済みだが有効ルートフォルダが 0 件時の案内バナー */
export const NoRoots: Story = {
  name: "フォルダ未設定ガイド",
  args: {
    state: { kind: "no-roots", email: "reader@example.com" },
  },
};

/** Google アカウント連携済みかつ有効ルートフォルダ設定済み時の非表示状態 */
export const Ready: Story = {
  name: "準備完了（非表示）",
  tags: ["skip-vrt"],
  args: {
    state: { kind: "ready" },
  },
};

/** 初期セッション・ルートフォルダ件数確認中の非表示状態 */
export const Loading: Story = {
  name: "読込中（非表示）",
  tags: ["skip-vrt"],
  args: {
    state: { kind: "loading" },
  },
};
