import type { Meta, StoryObj } from "@storybook/react";
import type { VolumeRecord } from "../../storage/types";
import type { BookshelfSeriesCardItem } from "./bookshelfViewModel";
import { SeriesCard } from "./SeriesCard";

function createSampleVolume(
  id: string,
  seriesId: string,
  volumeLabel: string,
): VolumeRecord {
  return {
    id,
    seriesId,
    volumeNumber: 1,
    volumeLabel,
    rawFileName: `${volumeLabel}.cbz`,
    driveFileId: `drive-${id}`,
    parentFolderId: "folder-1",
    rootFolderId: "root-1",
    fileSize: 45_000_000,
    md5Checksum: "md5-1",
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

const READING_ITEM: BookshelfSeriesCardItem = {
  seriesId: "series-frieren",
  title: "葬送のフリーレン",
  titleReading: "そうそうのふりーれん",
  authors: ["山田鐘人", "アベツカサ"],
  volumeCount: 12,
  completedCount: 5,
  readStatus: "reading",
  lastReadAt: 1_730_500_000_000,
  latestVolumeAddedAt: 1_730_100_000_000,
  seriesAddedAt: 1_730_000_000_000,
  representativeVolume: createSampleVolume("vol-1", "series-frieren", "第1巻"),
  quickLaunchVolumeId: "vol-6",
  quickLaunchLabel: "続きを読む (第6巻)",
};

const UNREAD_ITEM: BookshelfSeriesCardItem = {
  seriesId: "series-dungeon",
  title: "ダンジョン飯",
  titleReading: "だんじょんめし",
  authors: [],
  volumeCount: 14,
  completedCount: 0,
  readStatus: "unread",
  lastReadAt: null,
  latestVolumeAddedAt: 1_730_200_000_000,
  seriesAddedAt: 1_730_000_000_000,
  representativeVolume: createSampleVolume("vol-d1", "series-dungeon", "第1巻"),
  quickLaunchVolumeId: "vol-d1",
  quickLaunchLabel: "読む (第1巻)",
};

const COMPLETED_ITEM: BookshelfSeriesCardItem = {
  seriesId: "series-akira",
  title: "AKIRA",
  titleReading: "あきら",
  authors: ["大友克洋"],
  volumeCount: 6,
  completedCount: 6,
  readStatus: "completed",
  lastReadAt: 1_730_400_000_000,
  latestVolumeAddedAt: 1_730_050_000_000,
  seriesAddedAt: 1_730_000_000_000,
  representativeVolume: createSampleVolume("vol-a1", "series-akira", "第1巻"),
  quickLaunchVolumeId: "vol-a1",
  quickLaunchLabel: "最初から読む",
};

const meta: Meta<typeof SeriesCard> = {
  title: "Bookshelf/SeriesCard",
  component: SeriesCard,
  parameters: {
    layout: "centered",
  },
  decorators: [
    (Story) => (
      <div className="min-h-screen w-full bg-slate-950 p-6 text-slate-100 flex items-center justify-center">
        <div className="w-44">
          <Story />
        </div>
      </div>
    ),
  ],
  args: {
    item: READING_ITEM,
    onOpenDetail: () => {},
    onQuickRead: () => {},
  },
};

export default meta;
type Story = StoryObj<typeof SeriesCard>;

/** 読書中シリーズカード表示（続きを読むクイック起動付き） */
export const Reading: Story = {
  name: "読書中シリーズ",
};

/** 未読・著者未設定のシリーズカード表示 */
export const Unread: Story = {
  name: "未読シリーズ（著者なし）",
  args: {
    item: UNREAD_ITEM,
  },
};

/** 全巻読了済みのシリーズカード表示 */
export const Completed: Story = {
  name: "全巻読了シリーズ",
  args: {
    item: COMPLETED_ITEM,
  },
};
