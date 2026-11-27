import type { ReactNode } from "react";
import type { CoverExtractionProgressSnapshot } from "../../engine/cover/types";
import type { DriveSyncResult } from "../../providers/gdrive/types";
import { INITIAL_COVER_EXTRACTION_SNAPSHOT } from "../../shared/sync/coverExtractionStateStore";
import {
  type BookshelfSortOrder,
  formatSyncTimestamp,
} from "./bookshelfViewModel";

export interface BookshelfToolbarProps {
  readonly seriesCount: number;
  readonly totalVolumeCount: number;
  readonly sortOrder: BookshelfSortOrder;
  readonly lastSyncedAt: number | null;
  readonly lastSyncResult: DriveSyncResult | null;
  readonly syncErrorMessage: string | null;
  readonly coverExtractionState?: CoverExtractionProgressSnapshot;
  readonly canRetryCovers?: boolean;
  readonly onRetryFailedCovers?: () => void;
  readonly onChangeSortOrder: (sortOrder: BookshelfSortOrder) => void;
}

const SORT_OPTIONS: readonly {
  readonly value: BookshelfSortOrder;
  readonly label: string;
}[] = [
  { value: "lastReadDesc", label: "最終読書順" },
  { value: "addedDesc", label: "追加順" },
  { value: "titleAsc", label: "タイトル順" },
  { value: "volumeCountDesc", label: "巻数順" },
];

function formatCoverProgressLabel(
  state: CoverExtractionProgressSnapshot,
): string {
  const statusSuffix =
    state.phase === "paused"
      ? "（一時停止）"
      : state.phase === "backoff"
        ? "（待機中）"
        : "";
  return `表紙抽出中${statusSuffix}: ${state.readyCount} / ${state.totalCount} 冊`;
}

export function BookshelfToolbar({
  seriesCount,
  totalVolumeCount,
  sortOrder,
  lastSyncedAt,
  lastSyncResult,
  syncErrorMessage,
  coverExtractionState = INITIAL_COVER_EXTRACTION_SNAPSHOT,
  canRetryCovers = false,
  onRetryFailedCovers,
  onChangeSortOrder,
}: BookshelfToolbarProps): ReactNode {
  const resultSuffix =
    lastSyncResult !== null && lastSyncResult.mode !== "skipped-no-roots"
      ? `（+${lastSyncResult.upsertedVolumes} / -${lastSyncResult.trashedVolumes}）`
      : "";
  const lastSyncedLabel =
    lastSyncedAt !== null
      ? `最終同期: ${formatSyncTimestamp(lastSyncedAt)}${resultSuffix}`
      : "最終同期: 未同期";
  const hasSyncError = syncErrorMessage !== null && syncErrorMessage.length > 0;
  const showCoverStatus =
    coverExtractionState.pendingCount > 0 ||
    coverExtractionState.errorCount > 0;

  return (
    <section
      data-testid="bookshelf-toolbar"
      aria-label="蔵書ツールバー"
      className="w-full rounded-2xl border border-slate-800 bg-slate-900/80 px-4 py-3.5 shadow-sm sm:px-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <p
            data-testid="bookshelf-series-count"
            className="text-sm font-semibold text-white"
          >
            全 {seriesCount} 作品 / {totalVolumeCount} 冊
          </p>
          <p
            data-testid="bookshelf-last-synced"
            className="text-xs text-slate-400"
          >
            {lastSyncedLabel}
          </p>
        </div>

        <label className="flex items-center gap-2 text-xs font-medium text-slate-300">
          <span>並び順</span>
          <select
            data-testid="bookshelf-sort-select"
            aria-label="並び順"
            value={sortOrder}
            onChange={(event) =>
              onChangeSortOrder(event.currentTarget.value as BookshelfSortOrder)
            }
            className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs font-medium text-slate-100 focus:border-indigo-400 focus:outline-none"
          >
            {SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {showCoverStatus && (
        <div
          data-testid="bookshelf-cover-status"
          className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-800/80 pt-2.5 text-xs"
        >
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {coverExtractionState.pendingCount > 0 && (
              <span className="text-indigo-200">
                {formatCoverProgressLabel(coverExtractionState)}
              </span>
            )}
            {coverExtractionState.errorCount > 0 && (
              <span className="font-medium text-amber-300">
                表紙未取得: {coverExtractionState.errorCount} 冊
              </span>
            )}
          </div>
          {coverExtractionState.errorCount > 0 && (
            <button
              type="button"
              data-testid="bookshelf-retry-failed-covers-button"
              disabled={!canRetryCovers}
              onClick={onRetryFailedCovers}
              className="inline-flex shrink-0 items-center justify-center touch-manipulation rounded-lg border border-amber-500/40 bg-amber-500/15 px-2.5 py-1 text-xs font-medium text-amber-200 transition-colors hover:bg-amber-500/25 disabled:cursor-not-allowed disabled:opacity-40"
            >
              再試行
            </button>
          )}
        </div>
      )}

      {hasSyncError && (
        <p
          role="alert"
          data-testid="bookshelf-sync-error"
          className="mt-3 rounded-lg border border-rose-500/40 bg-rose-950/50 px-3 py-2 text-xs font-medium text-rose-300"
        >
          {syncErrorMessage}
        </p>
      )}
    </section>
  );
}
