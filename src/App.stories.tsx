import type { Meta, StoryObj } from "@storybook/react";
import { App } from "./App";

const meta: Meta<typeof App> = {
  title: "Shell/App",
  component: App,
  parameters: {
    layout: "fullscreen",
  },
};

export default meta;
type Story = StoryObj<typeof App>;

/** 初期起動時の空本棚シェル表示 */
export const Default: Story = {
  name: "初期状態（空の本棚シェル）",
};

/** 診断ログのクリップボードコピー成功時のフィードバック表示 */
export const CopiedFeedback: Story = {
  name: "診断ログコピー完了状態",
  args: {
    initialCopyStatus: "copied",
  },
};

/** クリップボードAPI非対応または拒否時のエラー通知表示 */
export const CopyFailedFeedback: Story = {
  name: "診断ログコピー失敗状態",
  args: {
    initialCopyStatus: "failed",
  },
};

/** ローカルセッション不在で /read/local へアクセスした際に '/' へ安全フォールバックする状態（TR-10） */
export const ReaderLocalFallback: Story = {
  name: "ローカルリーダーセッション不在フォールバック（/）",
  args: {
    initialPath: "/read/local",
  },
};
