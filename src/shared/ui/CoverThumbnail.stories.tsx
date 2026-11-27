import type { Meta, StoryObj } from "@storybook/react";
import { CoverThumbnail } from "./CoverThumbnail";

function createDeterministicCoverBlob(): Blob {
  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="340" viewBox="0 0 240 340">',
    '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">',
    '<stop offset="0%" stop-color="#4338ca"/>',
    '<stop offset="100%" stop-color="#0f172a"/>',
    "</linearGradient></defs>",
    '<rect width="240" height="340" fill="url(#g)"/>',
    '<rect x="18" y="24" width="204" height="292" rx="10" fill="none" stroke="#818cf8" stroke-width="3" opacity="0.7"/>',
    '<text x="120" y="155" text-anchor="middle" fill="#e0e7ff" font-family="DejaVu Sans, sans-serif" font-size="24" font-weight="bold">EXLIBRIS</text>',
    '<text x="120" y="190" text-anchor="middle" fill="#a5b4fc" font-family="DejaVu Sans, sans-serif" font-size="14">SAMPLE COVER</text>',
    "</svg>",
  ].join("");
  return new Blob([svg], { type: "image/svg+xml" });
}

const SAMPLE_COVER_BLOB = createDeterministicCoverBlob();

const meta: Meta<typeof CoverThumbnail> = {
  title: "Shared/CoverThumbnail",
  component: CoverThumbnail,
  parameters: {
    layout: "centered",
  },
  decorators: [
    (Story) => (
      <div className="min-h-screen w-full bg-slate-950 p-6 text-slate-100 flex items-center justify-center">
        <div className="w-40">
          <Story />
        </div>
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof CoverThumbnail>;

/** 未抽出状態（pending）のダーク調プレースホルダ表示 */
export const PendingPlaceholder: Story = {
  name: "未抽出プレースホルダ",
  args: {
    coverBlob: null,
    coverStatus: "pending",
    title: "葬送のフリーレン",
    badgeText: "全 12 巻",
  },
};

/** 抽出済み表紙画像（ObjectURL）表示 */
export const ReadyImage: Story = {
  name: "表紙画像あり（ready）",
  args: {
    coverBlob: SAMPLE_COVER_BLOB,
    coverStatus: "ready",
    title: "ダンジョン飯",
    badgeText: "全 14 巻",
  },
};

/** 表紙抽出失敗（error）時の取得失敗バッジ付き表示 */
export const Error: Story = {
  name: "取得失敗（error）",
  args: {
    coverBlob: null,
    coverStatus: "error",
    title: "葬送のフリーレン",
    badgeText: "全 12 巻",
  },
};

/** 表紙抽出失敗（error）時のタイトル空プレースホルダフォールバック表示 */
export const ErrorFallback: Story = {
  name: "抽出エラー時フォールバック",
  args: {
    coverBlob: null,
    coverStatus: "error",
    title: "   ",
  },
};
