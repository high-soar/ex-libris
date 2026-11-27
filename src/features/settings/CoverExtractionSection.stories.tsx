import type { Meta, StoryObj } from "@storybook/react";
import { CoverExtractionSection } from "./CoverExtractionSection";

const noop = () => {};

const meta: Meta<typeof CoverExtractionSection> = {
  title: "Settings/CoverExtractionSection",
  component: CoverExtractionSection,
  parameters: {
    layout: "padded",
  },
  args: {
    authStatus: "connected",
    enabledRootCount: 1,
    syncPhase: "idle",
    isBackBlocked: false,
    onRetryFailedCovers: noop,
  },
};

export default meta;
type Story = StoryObj<typeof CoverExtractionSection>;

/** 対象巻が 0 冊の初期状態 */
export const NoTargets: Story = {
  name: "対象なし（0冊）",
  args: {
    extractionState: {
      phase: "idle",
      totalCount: 0,
      readyCount: 0,
      pendingCount: 0,
      errorCount: 0,
      activeVolumeId: null,
      pauseReasons: [],
    },
  },
};

/** 表紙抽出が進行中の状態 */
export const Running: Story = {
  name: "抽出中",
  args: {
    extractionState: {
      phase: "running",
      totalCount: 20,
      readyCount: 12,
      pendingCount: 8,
      errorCount: 0,
      activeVolumeId: "vol-13",
      pauseReasons: [],
    },
  },
};

/** Rate Limit 検知によるバックオフ待機状態 */
export const Backoff: Story = {
  name: "バックオフ待機",
  args: {
    extractionState: {
      phase: "backoff",
      totalCount: 20,
      readyCount: 10,
      pendingCount: 9,
      errorCount: 1,
      activeVolumeId: null,
      pauseReasons: [],
    },
  },
};

/** リーダー閲覧・同期・未認証等による一時停止状態 */
export const Paused: Story = {
  name: "一時停止中",
  args: {
    syncPhase: "syncing",
    extractionState: {
      phase: "paused",
      totalCount: 20,
      readyCount: 6,
      pendingCount: 12,
      errorCount: 2,
      activeVolumeId: null,
      pauseReasons: ["drive-sync"],
    },
  },
};

/** 全巻の表紙抽出が完了した状態 */
export const Completed: Story = {
  name: "完了",
  args: {
    extractionState: {
      phase: "idle",
      totalCount: 20,
      readyCount: 20,
      pendingCount: 0,
      errorCount: 0,
      activeVolumeId: null,
      pauseReasons: [],
    },
  },
};

/** 待機巻がなくエラー巻が残っている要再試行状態 */
export const RetryRequired: Story = {
  name: "要再試行（エラーあり）",
  args: {
    extractionState: {
      phase: "idle",
      totalCount: 20,
      readyCount: 17,
      pendingCount: 0,
      errorCount: 3,
      activeVolumeId: null,
      pauseReasons: [],
    },
  },
};

/** アイドル状態だが待機巻が残っている待機中状態 */
export const IdlePending: Story = {
  name: "待機中（未処理あり）",
  args: {
    extractionState: {
      phase: "idle",
      totalCount: 10,
      readyCount: 4,
      pendingCount: 6,
      errorCount: 0,
      activeVolumeId: null,
      pauseReasons: [],
    },
  },
};
