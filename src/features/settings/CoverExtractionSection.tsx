import type { ReactNode } from "react";
import type { CoverExtractionProgressSnapshot } from "../../engine/cover/types";
import type { DriveSyncUiPhase } from "../../shared/sync/driveSyncStateStore";
import type { GoogleAccountAuthStatus } from "./types";

export interface CoverExtractionSectionProps {
  readonly authStatus: GoogleAccountAuthStatus;
  readonly enabledRootCount: number;
  readonly syncPhase: DriveSyncUiPhase;
  readonly isBackBlocked: boolean;
  readonly extractionState: CoverExtractionProgressSnapshot;
  readonly onRetryFailedCovers: () => void;
}

interface CoverStatusBadgeConfig {
  readonly label: string;
  readonly className: string;
}

const BADGE_NO_TARGETS: CoverStatusBadgeConfig = {
  label: "対象なし",
  className: "border border-slate-600/60 bg-slate-800 text-slate-300",
};

const BADGE_COMPLETED: CoverStatusBadgeConfig = {
  label: "完了",
  className: "border border-emerald-500/40 bg-emerald-500/20 text-emerald-300",
};

const BADGE_RETRY_REQUIRED: CoverStatusBadgeConfig = {
  label: "要再試行",
  className: "border border-amber-500/40 bg-amber-500/20 text-amber-200",
};

const BADGE_RUNNING: CoverStatusBadgeConfig = {
  label: "抽出中",
  className: "border border-indigo-400/40 bg-indigo-500/20 text-indigo-200",
};

const BADGE_BACKOFF: CoverStatusBadgeConfig = {
  label: "バックオフ待機",
  className: "border border-amber-500/40 bg-amber-500/15 text-amber-200",
};

const BADGE_PAUSED: CoverStatusBadgeConfig = {
  label: "一時停止中",
  className: "border border-slate-600/60 bg-slate-800 text-slate-300",
};

const BADGE_IDLE: CoverStatusBadgeConfig = {
  label: "待機中",
  className: "border border-slate-600/60 bg-slate-800 text-slate-300",
};

function resolveCoverStatusBadge(
  state: CoverExtractionProgressSnapshot,
): CoverStatusBadgeConfig {
  if (state.totalCount === 0) {
    return BADGE_NO_TARGETS;
  }
  if (state.pendingCount === 0) {
    return state.errorCount === 0 ? BADGE_COMPLETED : BADGE_RETRY_REQUIRED;
  }
  if (state.phase === "running") {
    return BADGE_RUNNING;
  }
  if (state.phase === "backoff") {
    return BADGE_BACKOFF;
  }
  if (state.phase === "paused") {
    return BADGE_PAUSED;
  }
  return BADGE_IDLE;
}

export function CoverExtractionSection({
  authStatus,
  enabledRootCount,
  syncPhase,
  isBackBlocked,
  extractionState,
  onRetryFailedCovers,
}: CoverExtractionSectionProps): ReactNode {
  const badge = resolveCoverStatusBadge(extractionState);
  const progressPercent =
    extractionState.totalCount > 0
      ? Math.round(
          (extractionState.readyCount / extractionState.totalCount) * 100,
        )
      : 0;
  const canRetryFailedCovers =
    authStatus === "connected" &&
    enabledRootCount > 0 &&
    syncPhase !== "syncing" &&
    !isBackBlocked &&
    extractionState.errorCount > 0;

  return (
    <section
      data-testid="cover-extraction-section"
      aria-labelledby="cover-extraction-heading"
      className="rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-lg sm:p-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2
          id="cover-extraction-heading"
          className="text-base font-bold text-white sm:text-lg"
        >
          表紙サムネイル自動抽出
        </h2>
        <span
          data-testid="settings-cover-status-badge"
          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${badge.className}`}
        >
          {badge.label}
        </span>
      </div>

      <p className="mt-2 text-xs leading-relaxed text-slate-400 sm:text-sm">
        同期済み蔵書の表紙をバックグラウンドで軽量な WebP
        画像へ自動生成します（リーダー閲覧中は一時停止します）。
      </p>

      <div className="mt-4 rounded-xl border border-slate-800 bg-slate-950/60 px-4 py-3">
        <div className="flex items-center justify-between gap-2 text-xs">
          <span className="text-slate-400">抽出進捗</span>
          <span className="font-semibold text-slate-100">
            {progressPercent}%
          </span>
        </div>

        <div
          data-testid="settings-cover-progress-bar"
          role="progressbar"
          aria-label="表紙抽出の進捗"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progressPercent}
          className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-800"
        >
          <div
            className="h-full rounded-full bg-indigo-500 transition-all"
            style={{ width: `${progressPercent}%` }}
          />
        </div>

        <div
          data-testid="settings-cover-counts"
          className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-300"
        >
          <span>
            抽出済み {extractionState.readyCount} / {extractionState.totalCount}{" "}
            冊
          </span>
          <span className="text-slate-400">
            待機 {extractionState.pendingCount} 冊
          </span>
          <span
            className={
              extractionState.errorCount > 0
                ? "font-medium text-amber-300"
                : "text-slate-400"
            }
          >
            エラー {extractionState.errorCount} 冊
          </span>
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-2.5 sm:flex-row">
        <button
          type="button"
          data-testid="settings-retry-failed-covers-button"
          disabled={!canRetryFailedCovers}
          onClick={onRetryFailedCovers}
          className="inline-flex items-center justify-center touch-manipulation rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-medium text-slate-200 transition-colors hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40 sm:text-sm"
        >
          エラー分を再試行
        </button>
      </div>
    </section>
  );
}
