import type { Meta, StoryObj } from "@storybook/react";
import { BookshelfToolbar } from "./BookshelfToolbar";

// 2026-11-25 21:30:00 JST (12:30:00 UTC)
const FIXED_SYNCED_AT = Date.UTC(2026, 10, 25, 12, 30, 0);

const meta: Meta<typeof BookshelfToolbar> = {
  title: "Bookshelf/BookshelfToolbar",
  component: BookshelfToolbar,
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
    seriesCount: 12,
    totalVolumeCount: 148,
    sortOrder: "lastReadDesc",
    lastSyncedAt: FIXED_SYNCED_AT,
    lastSyncResult: null,
    syncErrorMessage: null,
    onChangeSortOrder: () => {},
  },
};

export default meta;
type Story = StoryObj<typeof BookshelfToolbar>;

/** 同期済みの通常本棚ツールバー表示 */
export const Default: Story = {
  name: "同期済み（最終読書順）",
};

/** 同期完了直後の結果サマリ付き表示 */
export const WithSyncResult: Story = {
  name: "同期完了サマリ表示",
  args: {
    sortOrder: "titleAsc",
    lastSyncResult: {
      mode: "incremental",
      scannedRoots: 2,
      upsertedVolumes: 4,
      trashedVolumes: 1,
      invalidatedZipCaches: 0,
      syncedAt: FIXED_SYNCED_AT,
    },
  },
};

/** 初回同期未実行（未同期）かつエラー表示状態 */
export const UnsyncedWithError: Story = {
  name: "未同期・同期エラー表示",
  args: {
    seriesCount: 3,
    totalVolumeCount: 18,
    sortOrder: "volumeCountDesc",
    lastSyncedAt: null,
    lastSyncResult: null,
    syncErrorMessage:
      "Google アカウントの認証が切れました。設定画面から再ログインしてください",
  },
};

/** 表紙抽出進行中のコンパクトステータス表示 */
export const CoverExtracting: Story = {
  name: "表紙抽出中表示",
  args: {
    coverExtractionState: {
      phase: "running",
      totalCount: 24,
      readyCount: 11,
      pendingCount: 13,
      errorCount: 0,
      activeVolumeId: "vol-12",
      pauseReasons: [],
    },
    canRetryCovers: true,
    onRetryFailedCovers: () => {},
  },
};

/** 表紙抽出の一時停止かつ未取得エラーあり（再試行非活性） */
export const CoverPausedWithErrors: Story = {
  name: "表紙抽出・一時停止と未取得エラー",
  args: {
    coverExtractionState: {
      phase: "paused",
      totalCount: 24,
      readyCount: 10,
      pendingCount: 12,
      errorCount: 2,
      activeVolumeId: null,
      pauseReasons: ["drive-sync"],
    },
    canRetryCovers: false,
    onRetryFailedCovers: () => {},
  },
};

/** 表紙未取得エラーのみ残存し再試行可能な状態 */
export const CoverErrorsOnly: Story = {
  name: "表紙未取得エラーのみ（再試行可能）",
  args: {
    coverExtractionState: {
      phase: "idle",
      totalCount: 24,
      readyCount: 22,
      pendingCount: 0,
      errorCount: 2,
      activeVolumeId: null,
      pauseReasons: [],
    },
    canRetryCovers: true,
    onRetryFailedCovers: () => {},
  },
};
