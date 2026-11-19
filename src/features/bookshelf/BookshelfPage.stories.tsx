import type { Meta, StoryObj } from "@storybook/react";
import { RouterProvider } from "../../shared/router/RouterProvider";
import { BookshelfPage } from "./BookshelfPage";

const meta: Meta<typeof BookshelfPage> = {
  title: "Bookshelf/BookshelfPage",
  component: BookshelfPage,
  parameters: {
    layout: "fullscreen",
  },
  decorators: [
    (Story) => (
      <RouterProvider initialPath="/">
        <Story />
      </RouterProvider>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof BookshelfPage>;

/** 仮想本棚ページ全体の初期表示状態 */
export const Default: Story = {
  name: "初期状態",
};

/** ドラッグ＆ドロップ受け入れ中のハイライト状態 */
export const DragActive: Story = {
  name: "ドラッグ中のハイライト状態",
  args: {
    initialDragActive: true,
  },
};

/** 非対応拡張子選択時のエラー表示状態 */
export const UnsupportedExtensionError: Story = {
  name: "対応外拡張子エラー状態",
  args: {
    initialErrorMessage: "対応形式は .zip または .cbz ファイルのみです",
  },
};

/** 診断ログコピー完了時のフィードバック表示状態 */
export const CopiedFeedback: Story = {
  name: "診断ログコピー完了状態",
  args: {
    initialCopyStatus: "copied",
  },
};
