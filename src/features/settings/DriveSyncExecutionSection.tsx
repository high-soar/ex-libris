import type { ReactNode } from "react";
import type { DriveSyncResult } from "../../providers/gdrive/types";
import type {
  DriveSyncActiveMode,
  DriveSyncUiPhase,
} from "../../shared/sync/driveSyncStateStore";
import { formatSyncTimestamp } from "../bookshelf/bookshelfViewModel";
import type { GoogleAccountAuthStatus } from "./types";

export interface DriveSyncExecutionSectionProps {
  readonly authStatus: GoogleAccountAuthStatus;
  readonly enabledRootCount: number;
  readonly syncPhase: DriveSyncUiPhase;
  readonly activeMode: DriveSyncActiveMode | null;
  readonly lastSyncedAt: number | null;
  readonly lastResult: DriveSyncResult | null;
  readonly errorMessage: string | null;
  readonly isBackBlocked: boolean;
  readonly onRunIncrementalSync: () => void;
  readonly onRunFullScan: () => void;
}

const SYNC_PHASE_BADGE: Record<
  DriveSyncUiPhase,
  { readonly label: string; readonly className: string }
> = {
  idle: {
    label: "待機中",
    className: "border border-slate-600/60 bg-slate-800 text-slate-300",
  },
  syncing: {
    label: "同期中",
    className: "border border-indigo-400/40 bg-indigo-500/20 text-indigo-200",
  },
  completed: {
    label: "同期完了",
    className:
      "border border-emerald-500/40 bg-emerald-500/20 text-emerald-300",
  },
  error: {
    label: "同期エラー",
    className: "border border-rose-500/40 bg-rose-950/60 text-rose-300",
  },
};

function SyncSpinner(): ReactNode {
  return (
    <svg
      data-testid="settings-sync-spinner"
      aria-hidden="true"
      className="h-3.5 w-3.5 animate-spin"
      viewBox="0 0 24 24"
      fill="none"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
      />
    </svg>
  );
}

export function DriveSyncExecutionSection({
  authStatus,
  enabledRootCount,
  syncPhase,
  activeMode,
  lastSyncedAt,
  lastResult,
  errorMessage,
  isBackBlocked,
  onRunIncrementalSync,
  onRunFullScan,
}: DriveSyncExecutionSectionProps): ReactNode {
  const badge = SYNC_PHASE_BADGE[syncPhase];
  const isSyncing = syncPhase === "syncing";
  const canExecuteSync =
    authStatus === "connected" &&
    enabledRootCount > 0 &&
    !isSyncing &&
    !isBackBlocked;

  const disabledHint =
    authStatus !== "connected"
      ? "同期を実行するには先に Google アカウントと連携してください。"
      : enabledRootCount === 0
        ? "同期を実行するには有効なルートフォルダを 1 件以上登録してください。"
        : null;

  const hasResultSummary =
    lastResult !== null && lastResult.mode !== "skipped-no-roots";
  const hasError = errorMessage !== null && errorMessage.length > 0;

  return (
    <section
      data-testid="drive-sync-execution-section"
      aria-labelledby="drive-sync-execution-heading"
      className="rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-lg sm:p-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2
          id="drive-sync-execution-heading"
          className="text-base font-bold text-white sm:text-lg"
        >
          Google Drive 蔵書同期
        </h2>
        <span
          data-testid="settings-sync-status-badge"
          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${badge.className}`}
        >
          {isSyncing && <SyncSpinner />}
          <span>{badge.label}</span>
        </span>
      </div>

      <p className="mt-2 text-xs leading-relaxed text-slate-400 sm:text-sm">
        通常の本棚表示時は通信を行わず、手動操作時のみ Google Drive
        から蔵書一覧を同期します。
      </p>

      <div className="mt-4 rounded-xl border border-slate-800 bg-slate-950/60 px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <span className="text-slate-400">最終同期日時</span>
          <span
            data-testid="settings-last-synced-at"
            className="font-medium text-slate-100"
          >
            {lastSyncedAt !== null
              ? formatSyncTimestamp(lastSyncedAt)
              : "未実行"}
          </span>
        </div>

        {hasResultSummary && (
          <p
            data-testid="settings-sync-result-summary"
            className="mt-2 border-t border-slate-800/80 pt-2 text-xs text-slate-300"
          >
            前回結果: {lastResult.mode === "full" ? "フルスキャン" : "差分同期"}{" "}
            / 走査 {lastResult.scannedRoots} フォルダ / 追加・更新{" "}
            {lastResult.upsertedVolumes} 冊 / 除外 {lastResult.trashedVolumes}{" "}
            冊
          </p>
        )}
      </div>

      {disabledHint !== null && (
        <p
          data-testid="settings-sync-disabled-hint"
          className="mt-3 rounded-lg border border-slate-700/80 bg-slate-950/60 px-3 py-2 text-xs text-slate-300"
        >
          {disabledHint}
        </p>
      )}

      <div className="mt-4 flex flex-col gap-2.5 sm:flex-row">
        <button
          type="button"
          data-testid="settings-sync-incremental-button"
          disabled={!canExecuteSync}
          onClick={onRunIncrementalSync}
          className="inline-flex flex-1 items-center justify-center gap-2 touch-manipulation rounded-lg bg-indigo-500 px-4 py-2 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-40 sm:text-sm"
        >
          {isSyncing && activeMode === "incremental"
            ? "差分同期中..."
            : "今すぐ同期（差分）"}
        </button>
        <button
          type="button"
          data-testid="settings-sync-full-button"
          disabled={!canExecuteSync}
          onClick={onRunFullScan}
          className="inline-flex flex-1 items-center justify-center gap-2 touch-manipulation rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-medium text-slate-200 transition-colors hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40 sm:text-sm"
        >
          {isSyncing && activeMode === "full"
            ? "フルスキャン中..."
            : "強制フルスキャン"}
        </button>
      </div>

      {hasError && (
        <p
          role="alert"
          data-testid="drive-sync-error"
          className="mt-4 rounded-lg border border-rose-500/40 bg-rose-950/50 px-3 py-2 text-xs font-medium text-rose-300"
        >
          {errorMessage}
        </p>
      )}
    </section>
  );
}
