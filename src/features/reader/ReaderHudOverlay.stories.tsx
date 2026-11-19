import type { Meta, StoryObj } from "@storybook/react";
import { ReaderHudOverlay } from "./ReaderHudOverlay";

const meta: Meta<typeof ReaderHudOverlay> = {
  title: "Reader/ReaderHudOverlay",
  component: ReaderHudOverlay,
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
  args: {
    isOpen: true,
    fileName: "sample-comic-vol01.cbz",
    currentPageIndex: 0,
    totalPages: 24,
    onClose: () => {},
    onNextPage: () => {},
    onPrevPage: () => {},
  },
};

export default meta;
type Story = StoryObj<typeof ReaderHudOverlay>;

/** 先頭ページ表示時のオーバーレイ HUD（前へ無効・次へ有効） */
export const OpenFirstPage: Story = {
  name: "HUD表示（先頭ページ）",
  args: {
    isOpen: true,
    currentPageIndex: 0,
    totalPages: 24,
  },
};

/** 中間ページおよび長大ファイル名省略表示時のオーバーレイ HUD */
export const OpenMiddlePage: Story = {
  name: "HUD表示（中間ページ・長大ファイル名）",
  args: {
    isOpen: true,
    fileName:
      "とても長いタイトルの自炊マンガアーカイブ_第01巻_高解像度スキャン版.zip",
    currentPageIndex: 11,
    totalPages: 24,
  },
};

/** 最終ページ表示時のオーバーレイ HUD（次へ無効・前へ有効） */
export const OpenLastPage: Story = {
  name: "HUD表示（最終ページ）",
  args: {
    isOpen: true,
    currentPageIndex: 23,
    totalPages: 24,
  },
};

/** 没入閲覧中の HUD 非表示状態 */
export const Closed: Story = {
  name: "HUD非表示（フルスクリーン閲覧中）",
  tags: ["skip-vrt"],
  args: {
    isOpen: false,
  },
};
