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

/** シリーズ詳細起点の Drive 巻検証エラー（シリーズ詳細へ戻るラベル） */
export const ArchiveErrorBackToSeries: Story = {
  name: "Drive巻検証エラー（シリーズ詳細へ戻る）",
  args: {
    mode: "archive",
    message: "この巻はゴミ箱に移動されたか、同期対象外のフォルダにあります",
    errorCode: "VOLUME_UNAVAILABLE",
    backLabel: "シリーズ詳細へ戻る",
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

/** 見開き左スロットのみデコード失敗時の半面エラーカード（p.3） */
export const PageDecodeErrorLeftSlot: Story = {
  name: "個別ページデコードエラー（左スロット・ページ番号付き）",
  args: {
    mode: "page",
    slotPosition: "left",
    pageNumber: 3,
    message: "ページの画像デコードに失敗しました",
    errorCode: "DECODE_FAILED",
  },
};

/** 見開き右スロットのみデコード失敗時の半面エラーカード（p.2） */
export const PageDecodeErrorRightSlot: Story = {
  name: "個別ページデコードエラー（右スロット・ページ番号付き）",
  args: {
    mode: "page",
    slotPosition: "right",
    pageNumber: 2,
    message: "ファイルの読み込みに失敗しました",
    errorCode: "READ_ERROR",
  },
};
