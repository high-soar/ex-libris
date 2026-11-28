import type { Meta, StoryObj } from "@storybook/react";
import { ServiceProvider } from "../../app/ServiceProvider";
import { NoopCoverExtractionScheduler } from "../../engine/cover/CoverExtractionSchedulerCore";
import { RouterProvider } from "../../shared/router/RouterProvider";
import type { LocalReadingHistoryItem } from "../../storage/repositories/readingProgressRepository";
import type { VolumeRecord } from "../../storage/types";
import { BookshelfPage } from "./BookshelfPage";
import type { BookshelfSeriesCardItem } from "./bookshelfViewModel";

const STORY_COVER_SCHEDULER = new NoopCoverExtractionScheduler();

// 2026-11-25 21:30:00 JST (12:30:00 UTC)
const FIXED_SYNCED_AT = Date.UTC(2026, 10, 25, 12, 30, 0);

function makeSampleVolume(
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
    parentFolderId: "folder-comics",
    rootFolderId: "root-comics",
    fileSize: 42_000_000,
    md5Checksum: `md5-${id}`,
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

const SAMPLE_SERIES_ITEMS: readonly BookshelfSeriesCardItem[] = [
  {
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
    representativeVolume: makeSampleVolume("vol-f1", "series-frieren", "第1巻"),
    quickLaunchVolumeId: "vol-f6",
    quickLaunchLabel: "続きを読む (第6巻)",
  },
  {
    seriesId: "series-dungeon",
    title: "ダンジョン飯",
    titleReading: "だんじょんめし",
    authors: ["九井諒子"],
    volumeCount: 14,
    completedCount: 0,
    readStatus: "unread",
    lastReadAt: null,
    latestVolumeAddedAt: 1_730_200_000_000,
    seriesAddedAt: 1_730_000_000_000,
    representativeVolume: makeSampleVolume("vol-d1", "series-dungeon", "第1巻"),
    quickLaunchVolumeId: "vol-d1",
    quickLaunchLabel: "読む (第1巻)",
  },
  {
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
    representativeVolume: makeSampleVolume("vol-a1", "series-akira", "第1巻"),
    quickLaunchVolumeId: "vol-a1",
    quickLaunchLabel: "最初から読む",
  },
];

const RECENT_HISTORY_SAMPLE_ITEMS: readonly LocalReadingHistoryItem[] = [
  {
    targetKey: "local:sample-comic-vol01.cbz:15728640",
    rawFileName: "sample-comic-vol01.cbz",
    fileSize: 15_728_640,
    currentPageIndex: 11,
    totalPageCount: 24,
    readStatus: "reading",
    spreadPageOffset: 0,
    lastReadAt: 1_730_000_300_000,
  },
  {
    targetKey: "local:completed-oneshot.zip:524288",
    rawFileName: "completed-oneshot.zip",
    fileSize: 524_288,
    currentPageIndex: 19,
    totalPageCount: 20,
    readStatus: "completed",
    spreadPageOffset: 0,
    lastReadAt: 1_730_000_200_000,
  },
  {
    targetKey: "local:unread-short.cbz:512",
    rawFileName: "unread-short.cbz",
    fileSize: 512,
    currentPageIndex: 0,
    totalPageCount: 10,
    readStatus: "unread",
    spreadPageOffset: 0,
    lastReadAt: 1_730_000_100_000,
  },
];

const meta: Meta<typeof BookshelfPage> = {
  title: "Bookshelf/BookshelfPage",
  component: BookshelfPage,
  parameters: {
    layout: "fullscreen",
  },
  args: {
    initialSnapshot: {
      driveSetupState: { kind: "ready" },
      seriesItems: [],
      recentHistory: [],
    },
  },
  decorators: [
    (Story) => (
      <ServiceProvider coverExtractionScheduler={STORY_COVER_SCHEDULER}>
        <RouterProvider initialPath="/">
          <Story />
        </RouterProvider>
      </ServiceProvider>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof BookshelfPage>;

/** Drive 連携済み・蔵書 0 件時の手動同期誘導状態 */
export const Default: Story = {
  name: "初期状態（Drive連携済み・未同期）",
};

/** 同期済みの Drive シリーズカードグリッド表示状態 */
export const WithSeriesGrid: Story = {
  name: "Drive蔵書シリーズ一覧（最終読書順）",
  args: {
    initialSnapshot: {
      driveSetupState: { kind: "ready" },
      seriesItems: SAMPLE_SERIES_ITEMS,
      sortOrder: "lastReadDesc",
      syncPhase: "completed",
      lastSyncedAt: FIXED_SYNCED_AT,
      lastSyncResult: {
        mode: "incremental",
        scannedRoots: 1,
        upsertedVolumes: 32,
        trashedVolumes: 0,
        invalidatedZipCaches: 0,
        syncedAt: FIXED_SYNCED_AT,
      },
      recentHistory: [],
    },
  },
};

/** 表紙 WebP 自動抽出進行中・未取得エラーありの Drive 蔵書表示状態 */
export const WithCoverExtraction: Story = {
  name: "表紙抽出中・未取得エラーあり",
  args: {
    initialSnapshot: {
      driveSetupState: { kind: "ready" },
      seriesItems: SAMPLE_SERIES_ITEMS,
      sortOrder: "lastReadDesc",
      syncPhase: "completed",
      lastSyncedAt: FIXED_SYNCED_AT,
      coverExtractionState: {
        phase: "running",
        totalCount: 32,
        readyCount: 20,
        pendingCount: 10,
        errorCount: 2,
        activeVolumeId: "vol-f1",
        pauseReasons: [],
      },
      recentHistory: [],
    },
  },
};

/** 未連携でもローカル IndexedDB に残る同期済み蔵書を閲覧維持する状態 */
export const OfflineCachedSeries: Story = {
  name: "未連携・同期済み蔵書閲覧維持状態",
  args: {
    initialSnapshot: {
      driveSetupState: { kind: "unauthenticated" },
      seriesItems: SAMPLE_SERIES_ITEMS,
      sortOrder: "titleAsc",
      syncPhase: "error",
      lastSyncedAt: FIXED_SYNCED_AT,
      syncErrorMessage:
        "Google アカウントの認証が切れました。設定画面から再ログインしてください",
      recentHistory: [],
    },
  },
};

/** Google アカウント未連携・蔵書 0 件時のセットアップ案内バナー表示状態 */
export const Unauthenticated: Story = {
  name: "Google未連携バナー状態",
  args: {
    initialSnapshot: {
      driveSetupState: { kind: "unauthenticated" },
      seriesItems: [],
      recentHistory: [],
    },
  },
};

/** Google アカウント連携済み・有効ルートフォルダ0件時のセットアップ案内バナー表示状態 */
export const NoDriveRoots: Story = {
  name: "Driveフォルダ未設定バナー状態",
  args: {
    initialSnapshot: {
      driveSetupState: { kind: "no-roots", email: "reader@example.com" },
      seriesItems: [],
      recentHistory: [],
    },
  },
};

/** ドラッグ＆ドロップ受け入れ中のハイライト状態 */
export const DragActive: Story = {
  name: "ドラッグ中のハイライト状態",
  args: {
    initialSnapshot: {
      driveSetupState: { kind: "unauthenticated" },
      seriesItems: [],
      recentHistory: [],
      isDragActive: true,
    },
  },
};

/** 非対応拡張子選択時のエラー表示状態 */
export const UnsupportedExtensionError: Story = {
  name: "対応外拡張子エラー状態",
  args: {
    initialSnapshot: {
      driveSetupState: { kind: "unauthenticated" },
      seriesItems: [],
      recentHistory: [],
      errorMessage: "対応形式は .zip または .cbz ファイルのみです",
    },
  },
};

/** 診断ログコピー完了時のフィードバック表示状態 */
export const CopiedFeedback: Story = {
  name: "診断ログコピー完了状態",
  args: {
    initialSnapshot: {
      driveSetupState: { kind: "ready" },
      seriesItems: [],
      recentHistory: [],
      copyStatus: "copied",
    },
  },
};

/** ローカル閲覧履歴ありの本棚状態 */
export const WithRecentHistory: Story = {
  name: "閲覧履歴あり状態",
  args: {
    initialSnapshot: {
      driveSetupState: { kind: "ready" },
      seriesItems: [],
      recentHistory: RECENT_HISTORY_SAMPLE_ITEMS,
    },
  },
};
