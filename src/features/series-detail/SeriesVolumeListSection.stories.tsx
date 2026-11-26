import type { Meta, StoryObj } from "@storybook/react";
import type { SeriesDetailVolumeItem } from "../bookshelf/bookshelfViewModel";
import { SeriesVolumeListSection } from "./SeriesVolumeListSection";

const SAMPLE_VOLUMES: readonly SeriesDetailVolumeItem[] = [
  {
    volume: {
      id: "vol-1",
      seriesId: "series-1",
      volumeNumber: 1,
      volumeLabel: "第01巻",
      rawFileName: "[九井諒子] ダンジョン飯 第01巻.zip",
      driveFileId: "drive-file-1",
      parentFolderId: "root-1",
      rootFolderId: "root-1",
      fileSize: 48_234_496,
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
    },
    isOmnibus: false,
    fileSizeLabel: "46.0 MB",
    readStatus: "completed",
    progress: {
      targetKey: "vol:vol-1",
      volumeId: "vol-1",
      currentPageIndex: 191,
      totalPageCount: 192,
      readStatus: "completed",
      spreadPageOffset: 0,
      lastReadAt: 1_730_000_100_000,
      updatedAt: 1_730_000_100_000,
    },
    progressPercent: 100,
  },
  {
    volume: {
      id: "vol-2",
      seriesId: "series-1",
      volumeNumber: 2,
      volumeLabel: "第02巻",
      rawFileName: "[九井諒子] ダンジョン飯 第02巻.cbz",
      driveFileId: "drive-file-2",
      parentFolderId: "root-1",
      rootFolderId: "root-1",
      fileSize: 55_574_528,
      md5Checksum: "md5-2",
      driveModifiedTime: 1_730_000_000_000,
      coverBlob: null,
      coverStatus: "pending",
      coverCropMode: "auto",
      coverPageIndex: 0,
      coverUpdatedAt: null,
      isTrashed: 0,
      addedAt: 1_730_000_000_000,
      updatedAt: 1_730_000_000_000,
    },
    isOmnibus: false,
    fileSizeLabel: "53.0 MB",
    readStatus: "reading",
    progress: {
      targetKey: "vol:vol-2",
      volumeId: "vol-2",
      currentPageIndex: 47,
      totalPageCount: 192,
      readStatus: "reading",
      spreadPageOffset: 0,
      lastReadAt: 1_730_000_200_000,
      updatedAt: 1_730_000_200_000,
    },
    progressPercent: 25,
  },
  {
    volume: {
      id: "vol-omnibus",
      seriesId: "series-1",
      volumeNumber: 3,
      volumeLabel: "第03-05巻 合本",
      rawFileName: "[九井諒子] ダンジョン飯 第03-05巻 合本.zip",
      driveFileId: "drive-file-3",
      parentFolderId: "root-1",
      rootFolderId: "root-1",
      fileSize: 162_529_280,
      md5Checksum: "md5-3",
      driveModifiedTime: 1_730_000_000_000,
      coverBlob: null,
      coverStatus: "pending",
      coverCropMode: "auto",
      coverPageIndex: 0,
      coverUpdatedAt: null,
      isTrashed: 0,
      addedAt: 1_730_000_000_000,
      updatedAt: 1_730_000_000_000,
    },
    isOmnibus: true,
    fileSizeLabel: "155.0 MB",
    readStatus: "unread",
    progress: null,
    progressPercent: null,
  },
];

const meta: Meta<typeof SeriesVolumeListSection> = {
  title: "SeriesDetail/SeriesVolumeListSection",
  component: SeriesVolumeListSection,
  parameters: {
    layout: "padded",
  },
  args: {
    onSelectVolume: () => {},
  },
};

export default meta;
type Story = StoryObj<typeof SeriesVolumeListSection>;

/** 単巻・合本・読了/読書中/未読が混在する巻一覧表示 */
export const MixedVolumes: Story = {
  name: "単巻・合本・進捗混在リスト",
  args: {
    volumes: SAMPLE_VOLUMES,
  },
};
