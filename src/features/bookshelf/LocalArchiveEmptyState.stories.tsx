import type { Meta, StoryObj } from "@storybook/react";
import { LocalArchiveEmptyState } from "./LocalArchiveEmptyState";

const meta: Meta<typeof LocalArchiveEmptyState> = {
  title: "Bookshelf/LocalArchiveEmptyState",
  component: LocalArchiveEmptyState,
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
    isDragActive: false,
    errorMessage: null,
    onOpenLocalZip: () => {},
  },
};

export default meta;
type Story = StoryObj<typeof LocalArchiveEmptyState>;

/** ローカルアーカイブ未選択時の初期ガイドカード表示 */
export const Default: Story = {
  name: "初期状態（空の本棚ガイド）",
};

/** ファイルをドラッグオーバー中のハイライト表示 */
export const DragActive: Story = {
  name: "ドラッグオーバー中のハイライト状態",
  args: {
    isDragActive: true,
  },
};

/** 対応外拡張子選択時のインライン警告表示 */
export const UnsupportedExtensionError: Story = {
  name: "対応外拡張子エラー表示状態",
  args: {
    errorMessage: "対応形式は .zip または .cbz ファイルのみです",
  },
};
