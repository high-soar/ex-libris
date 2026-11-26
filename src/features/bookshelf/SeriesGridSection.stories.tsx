import type { Meta, StoryObj } from "@storybook/react";
import type { VolumeRecord } from "../../storage/types";
import type { BookshelfSeriesCardItem } from "./bookshelfViewModel";
import { SeriesGridSection } from "./SeriesGridSection";

function makeVolume(id: string, seriesId: string, label: string): VolumeRecord {
  return {
    id,
    seriesId,
    volumeNumber: 1,
    volumeLabel: label,
    rawFileName: `${label}.cbz`,
    driveFileId: `drive-${id}`,
    parentFolderId: "folder-1",
    rootFolderId: "root-1",
    fileSize: 32_000_000,
    md5Checksum: null,
    driveModifiedTime: 1_730_000_000_000,
    coverBlob: null,
    coverStatus: "pending",
    coverCropMode: "auto",
    coverPageIndex: 0,
    coverUpdatedAt: null,
    isTrashed: 0,
    addedAt: 1_730_000_000_000,
    updatedAt: 1_730_000_000_000,
  };
}

const SAMPLE_ITEMS: readonly BookshelfSeriesCardItem[] = [
  {
    seriesId: "s-1",
    title: "葬送のフリーレン",
    titleReading: "そうそうのふりーれん",
    authors: ["山田鐘人"],
    volumeCount: 12,
    completedCount: 5,
    readStatus: "reading",
    lastReadAt: 1_730_500_000_000,
    latestVolumeAddedAt: 1_730_100_000_000,
    seriesAddedAt: 1_730_000_000_000,
    representativeVolume: makeVolume("v-1", "s-1", "第1巻"),
    quickLaunchVolumeId: "v-6",
    quickLaunchLabel: "続きを読む (第6巻)",
  },
  {
    seriesId: "s-2",
    title: "ダンジョン飯",
    titleReading: "だんじょんめし",
    authors: ["九井諒子"],
    volumeCount: 14,
    completedCount: 0,
    readStatus: "unread",
    lastReadAt: null,
    latestVolumeAddedAt: 1_730_200_000_000,
    seriesAddedAt: 1_730_000_000_000,
    representativeVolume: makeVolume("v-2", "s-2", "第1巻"),
    quickLaunchVolumeId: "v-2",
    quickLaunchLabel: "読む (第1巻)",
  },
  {
    seriesId: "s-3",
    title: "AKIRA",
    titleReading: "あきら",
    authors: ["大友克洋"],
    volumeCount: 6,
    completedCount: 6,
    readStatus: "completed",
    lastReadAt: 1_730_400_000_000,
    latestVolumeAddedAt: 1_730_050_000_000,
    seriesAddedAt: 1_730_000_000_000,
    representativeVolume: makeVolume("v-3", "s-3", "第1巻"),
    quickLaunchVolumeId: "v-3",
    quickLaunchLabel: "最初から読む",
  },
];

const meta: Meta<typeof SeriesGridSection> = {
  title: "Bookshelf/SeriesGridSection",
  component: SeriesGridSection,
  parameters: {
    layout: "padded",
  },
  decorators: [
    (Story) => (
      <div className="min-h-screen bg-slate-950 p-4 text-slate-100">
        <div className="mx-auto max-w-6xl">
          <Story />
        </div>
      </div>
    ),
  ],
  args: {
    items: SAMPLE_ITEMS,
    onOpenDetail: () => {},
    onQuickRead: () => {},
  },
};

export default meta;
type Story = StoryObj<typeof SeriesGridSection>;

/** 複数シリーズのレスポンシブグリッド表示 */
export const Default: Story = {
  name: "シリーズ一覧グリッド",
};
