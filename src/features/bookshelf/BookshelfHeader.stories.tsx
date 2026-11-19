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
    onCopyDiagnostics: () => {},
    onOpenLocalZip: () => {},
  },
};

export default meta;
type Story = StoryObj<typeof BookshelfHeader>;

/** 本棚ヘッダーの初期表示状態 */
export const Default: Story = {
  name: "初期状態",
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
