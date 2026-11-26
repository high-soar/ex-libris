import type { Meta, StoryObj } from "@storybook/react";
import { SeriesDetailHeader } from "./SeriesDetailHeader";

const meta: Meta<typeof SeriesDetailHeader> = {
  title: "SeriesDetail/SeriesDetailHeader",
  component: SeriesDetailHeader,
  parameters: {
    layout: "fullscreen",
  },
  args: {
    onBack: () => {},
  },
};

export default meta;
type Story = StoryObj<typeof SeriesDetailHeader>;

/** 作品タイトル取得済みのヘッダー表示 */
export const WithTitle: Story = {
  name: "タイトルあり",
  args: {
    title: "ダンジョン飯",
  },
};

/** 読込中・未存在時のデフォルト見出し表示 */
export const FallbackTitle: Story = {
  name: "タイトル未取得（デフォルト表示）",
  args: {
    title: null,
  },
};

/** 375px 狭幅でも省略表示される長文タイトル */
export const LongTitle: Story = {
  name: "長文タイトル省略表示",
  args: {
    title:
      "とても長いシリーズタイトルの作品名が入ってもヘッダーが崩れず1行省略される確認テスト",
  },
};
