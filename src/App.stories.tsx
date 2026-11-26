import type { Meta, StoryObj } from "@storybook/react";
import { App } from "./App";
import type { DiagnosticEntry } from "./diagnostics/types";
import type { BookshelfPageInitialSnapshot } from "./features/bookshelf/BookshelfPage";

const FIXED_SETTINGS_ENTRIES: readonly DiagnosticEntry[] = [
  {
    id: 1,
    timestamp: "2026-11-23T00:00:00.000Z",
    level: "info",
    scope: "app",
    message: "ExLibris shell initialized",
  },
  {
    id: 2,
    timestamp: "2026-11-23T00:01:00.000Z",
    level: "info",
    scope: "oauth",
    message: "Googleアカウント連携を確認しました",
  },
];

const READY_EMPTY_BOOKSHELF_SNAPSHOT: BookshelfPageInitialSnapshot = {
  driveSetupState: { kind: "ready" },
  seriesItems: [],
  recentHistory: [],
};

const meta: Meta<typeof App> = {
  title: "Shell/App",
  component: App,
  parameters: {
    layout: "fullscreen",
  },
};

export default meta;
type Story = StoryObj<typeof App>;

/** 初期起動時の空本棚シェル表示 */
export const Default: Story = {
  name: "初期状態（空の本棚シェル）",
  args: {
    initialBookshelfSnapshot: READY_EMPTY_BOOKSHELF_SNAPSHOT,
  },
};

/** 診断ログのクリップボードコピー成功時のフィードバック表示 */
export const CopiedFeedback: Story = {
  name: "診断ログコピー完了状態",
  args: {
    initialCopyStatus: "copied",
    initialBookshelfSnapshot: {
      ...READY_EMPTY_BOOKSHELF_SNAPSHOT,
      copyStatus: "copied",
    },
  },
};

/** クリップボードAPI非対応または拒否時のエラー通知表示 */
export const CopyFailedFeedback: Story = {
  name: "診断ログコピー失敗状態",
  args: {
    initialCopyStatus: "failed",
    initialBookshelfSnapshot: {
      ...READY_EMPTY_BOOKSHELF_SNAPSHOT,
      copyStatus: "failed",
    },
  },
};

/** 設定画面（/settings）表示 */
export const SettingsRoute: Story = {
  name: "設定画面（/settings）",
  args: {
    initialPath: "/settings",
    initialSettingsSnapshot: {
      authState: {
        status: "connected",
        email: "reader@example.com",
        errorMessage: null,
      },
      syncRoots: [
        {
          folderId: "mock-folder-comics",
          folderName: "Comics",
          enabled: 1,
          addedAt: 1_730_000_000_000,
          updatedAt: 1_730_000_000_000,
          deletedAt: null,
        },
      ],
      diagnosticEntries: FIXED_SETTINGS_ENTRIES,
      copyStatus: "idle",
    },
  },
};

/** ローカルセッション不在で /read/local へアクセスした際に '/' へ安全フォールバックする状態（TR-10） */
export const ReaderLocalFallback: Story = {
  name: "ローカルリーダーセッション不在フォールバック（/）",
  args: {
    initialPath: "/read/local",
    initialBookshelfSnapshot: READY_EMPTY_BOOKSHELF_SNAPSHOT,
  },
};

/** シリーズ詳細画面（/series/:seriesId）表示 */
export const SeriesDetailRoute: Story = {
  name: "シリーズ詳細画面（/series/:seriesId）",
  args: {
    initialPath: "/series/series-dungeon",
    initialSeriesDetailSnapshot: {
      kind: "ready",
      viewModel: {
        series: {
          id: "series-dungeon",
          title: "ダンジョン飯",
          titleReading: "だんじょんめし",
          authors: ["九井諒子"],
          publisher: "KADOKAWA",
          label: "ハルタコミックス",
          tags: [],
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
        },
        representativeVolume: {
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
        },
        volumeCount: 1,
        completedCount: 0,
        quickLaunch: {
          volume: {
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
          },
          kind: "start",
          bookshelfLabel: "読む (第01巻)",
          seriesDetailLabel: "読み始める（第01巻）",
        },
        volumes: [
          {
            volume: {
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
            },
            isOmnibus: false,
            fileSizeLabel: "46.0 MB",
            readStatus: "unread",
            progress: null,
            progressPercent: null,
          },
        ],
      },
    },
  },
};
