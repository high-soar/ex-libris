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
    onCycleSpreadMode: () => {},
    onToggleSpreadPageOffset: () => {},
    onToggleReadingDirection: () => {},
    onOpenShaderSheet: () => {},
    onCommitSeek: () => {},
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

/** 右開き・見開き表示時の3段オーバーレイ HUD（auto + 見開き・2-3 / 24 表記） */
export const OpenSpreadRtl: Story = {
  name: "HUD表示（右開き・見開き）",
  args: {
    isOpen: true,
    currentPageIndex: 1,
    maxDisplayedPageIndex: 2,
    totalPages: 24,
    pageIndicatorText: "2-3 / 24",
    readingDirection: "rtl",
    spreadMode: "auto",
    effectiveSpreadMode: "spread",
    spreadPageOffset: 0,
  },
};

/** 左開き・見開き・1ページずらしON時の3段オーバーレイ HUD（ボタン順反転・ハイライト状態） */
export const OpenSpreadLtrOffsetOn: Story = {
  name: "HUD表示（左開き・見開き・1ページずらしON）",
  args: {
    isOpen: true,
    currentPageIndex: 2,
    maxDisplayedPageIndex: 3,
    totalPages: 24,
    pageIndicatorText: "3-4 / 24",
    readingDirection: "ltr",
    spreadMode: "spread",
    effectiveSpreadMode: "spread",
    spreadPageOffset: 1,
  },
};

/** 左開き・単ページ固定時の3段オーバーレイ HUD（1ページずらし無効状態） */
export const OpenForcedSingleLtr: Story = {
  name: "HUD表示（左開き・単ページ固定）",
  args: {
    isOpen: true,
    currentPageIndex: 0,
    totalPages: 24,
    readingDirection: "ltr",
    spreadMode: "single",
    effectiveSpreadMode: "single",
    spreadPageOffset: 0,
  },
};

/** 画質補正適用中のオーバーレイ HUD（画質補正ボタンインディゴ強調状態） */
export const OpenWithShaderModified: Story = {
  name: "HUD表示（画質補正適用中）",
  args: {
    isOpen: true,
    currentPageIndex: 5,
    totalPages: 24,
    shaderModified: true,
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
