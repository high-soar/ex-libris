import type { Meta, StoryObj } from "@storybook/react";
import { ReaderErrorView } from "./ReaderErrorView";

const meta: Meta<typeof ReaderErrorView> = {
  title: "Reader/ReaderErrorView",
  component: ReaderErrorView,
  parameters: {
    layout: "fullscreen",
  },
  decorators: [
    (Story) => (
      <div className="relative h-screen w-screen bg-black">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof ReaderErrorView>;

/** アーカイブ全体・WebGL2初期化失敗時の全画面エラーパネル */
export const ArchiveError: Story = {
  name: "アーカイブエラー（閲覧不能・戻る導線）",
  args: {
    mode: "archive",
    message: "ZIP ファイルが破損しているため開けませんでした",
    errorCode: "CORRUPT_ZIP",
    onBackToHome: () => {},
  },
};

/** 個別ページのみデコード失敗時の中央エラーカード（前後めくり継続可能） */
export const PageDecodeError: Story = {
  name: "個別ページデコードエラー（前後移動継続可）",
  args: {
    mode: "page",
    message: "ページの画像デコードに失敗しました",
    errorCode: "DECODE_FAILED",
  },
};
