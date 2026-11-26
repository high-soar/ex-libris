import type { Meta, StoryObj } from "@storybook/react";
import { ServiceProvider } from "../../app/ServiceProvider";
import { RouterProvider } from "../../shared/router/RouterProvider";
import type { SeriesRecord, VolumeRecord } from "../../storage/types";
import type { SeriesDetailViewModel } from "../bookshelf/bookshelfViewModel";
import { SeriesDetailPage } from "./SeriesDetailPage";

const SAMPLE_SERIES: SeriesRecord = {
  id: "series-dungeon",
  title: "ダンジョン飯",
  titleReading: "だんじょんめし",
  authors: ["九井諒子"],
  publisher: "KADOKAWA",
  label: "ハルタコミックス",
  tags: ["ファンタジー", "グルメ"],
  synopsis: "",
  publicationStatus: "completed",
  knownTotalVolumes: 14,
  externalIds: {},
  metadataLocked: false,
  representativeVolumeId: "vol-1",
  readerPresetJson: null,
  lastReadAt: 1_730_000_200_000,
  addedAt: 1_730_000_000_000,
  updatedAt: 1_730_000_000_000,
  deletedAt: null,
};

const VOL_1: VolumeRecord = {
  id: "vol-1",
  seriesId: "series-dungeon",
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
};

const VOL_2: VolumeRecord = {
  ...VOL_1,
  id: "vol-2",
  volumeNumber: 2,
  volumeLabel: "第02巻",
  rawFileName: "[九井諒子] ダンジョン飯 第02巻.cbz",
  driveFileId: "drive-file-2",
  fileSize: 55_574_528,
};

const VOL_OMNIBUS: VolumeRecord = {
  ...VOL_1,
  id: "vol-3",
  volumeNumber: 3,
  volumeLabel: "第03-05巻 合本",
  rawFileName: "[九井諒子] ダンジョン飯 第03-05巻 合本.zip",
  driveFileId: "drive-file-3",
  fileSize: 162_529_280,
};

const SAMPLE_VIEW_MODEL: SeriesDetailViewModel = {
  series: SAMPLE_SERIES,
  representativeVolume: VOL_1,
  volumeCount: 3,
  completedCount: 1,
  quickLaunch: {
    volume: VOL_2,
    kind: "continue",
    bookshelfLabel: "続きを読む (第02巻)",
    seriesDetailLabel: "続きを読む（第02巻）",
  },
  volumes: [
    {
      volume: VOL_1,
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
      volume: VOL_2,
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
      volume: VOL_OMNIBUS,
      isOmnibus: true,
      fileSizeLabel: "155.0 MB",
      readStatus: "unread",
      progress: null,
      progressPercent: null,
    },
  ],
};

const meta: Meta<typeof SeriesDetailPage> = {
  title: "SeriesDetail/SeriesDetailPage",
  component: SeriesDetailPage,
  parameters: {
    layout: "fullscreen",
  },
  decorators: [
    (Story) => (
      <ServiceProvider>
        <RouterProvider initialPath="/series/series-dungeon">
          <Story />
        </RouterProvider>
      </ServiceProvider>
    ),
  ],
  args: {
    seriesId: "series-dungeon",
  },
};

export default meta;
type Story = StoryObj<typeof SeriesDetailPage>;

/** サマリカードと単巻・合本混在の巻一覧を表示する通常状態 */
export const Ready: Story = {
  name: "シリーズ詳細表示（通常）",
  args: {
    initialSnapshot: {
      kind: "ready",
      viewModel: SAMPLE_VIEW_MODEL,
    },
  },
};

/** 初回IndexedDB読み込み中のローディング表示 */
export const Loading: Story = {
  name: "初回読み込み中",
  args: {
    initialSnapshot: {
      kind: "loading",
    },
  },
};

/** 未存在・論理削除・有効巻0件時の案内表示 */
export const Empty: Story = {
  name: "未存在・有効巻0件案内",
  args: {
    seriesId: "missing-series",
    initialSnapshot: {
      kind: "empty",
    },
  },
};
