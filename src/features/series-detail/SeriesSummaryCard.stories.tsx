import type { Meta, StoryObj } from "@storybook/react";
import type { VolumeRecord } from "../../storage/types";
import { SeriesSummaryCard } from "./SeriesSummaryCard";

const SAMPLE_VOLUME: VolumeRecord = {
  id: "vol-1",
  seriesId: "series-1",
  volumeNumber: 1,
  volumeLabel: "第01巻",
  rawFileName: "[九井諒子] ダンジョン飯 第01巻.zip",
  driveFileId: "drive-file-1",
  parentFolderId: "root-1",
  rootFolderId: "root-1",
  fileSize: 52_428_800,
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

const SECOND_VOLUME: VolumeRecord = {
  ...SAMPLE_VOLUME,
  id: "vol-2",
  volumeNumber: 2,
  volumeLabel: "第02巻",
  rawFileName: "[九井諒子] ダンジョン飯 第02巻.zip",
  driveFileId: "drive-file-2",
};

const meta: Meta<typeof SeriesSummaryCard> = {
  title: "SeriesDetail/SeriesSummaryCard",
  component: SeriesSummaryCard,
  parameters: {
    layout: "padded",
  },
  args: {
    onQuickRead: () => {},
  },
};

export default meta;
type Story = StoryObj<typeof SeriesSummaryCard>;

/** 読書中の作品サマリ表示（続きを読む CTA） */
export const Reading: Story = {
  name: "読書中サマリ",
  args: {
    title: "ダンジョン飯",
    authors: ["九井諒子"],
    representativeVolume: SAMPLE_VOLUME,
    volumeCount: 14,
    completedCount: 1,
    quickLaunch: {
      volume: SECOND_VOLUME,
      kind: "continue",
      bookshelfLabel: "続きを読む (第02巻)",
      seriesDetailLabel: "続きを読む（第02巻）",
    },
  },
};

/** 著者情報なし・全巻読了時の作品サマリ表示（最初から読む CTA） */
export const CompletedNoAuthors: Story = {
  name: "読了済み（著者なし）",
  args: {
    title: "よつばと！",
    authors: [],
    representativeVolume: SAMPLE_VOLUME,
    volumeCount: 3,
    completedCount: 3,
    quickLaunch: {
      volume: SAMPLE_VOLUME,
      kind: "reread",
      bookshelfLabel: "最初から読む",
      seriesDetailLabel: "最初から読む（第01巻）",
    },
  },
};
