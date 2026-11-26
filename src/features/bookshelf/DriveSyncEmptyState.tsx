import type { ReactNode } from "react";

export interface DriveSyncEmptyStateProps {
  readonly isSyncing: boolean;
  readonly isDragActive: boolean;
  readonly onSyncDrive: () => void;
  readonly onOpenLocalZip: () => void;
}

function EmptyStateSpinner(): ReactNode {
  return (
    <svg
      data-testid="empty-state-sync-spinner"
      aria-hidden="true"
      className="h-4 w-4 animate-spin"
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

export function DriveSyncEmptyState({
  isSyncing,
  isDragActive,
  onSyncDrive,
  onOpenLocalZip,
}: DriveSyncEmptyStateProps): ReactNode {
  const cardSurfaceClass = isDragActive
    ? "border-indigo-400 bg-indigo-950/30"
    : "border-slate-800 bg-slate-900/60";

  return (
    <section
      data-testid="drive-sync-empty-state"
      data-drag-active={isDragActive ? "true" : "false"}
      className={`max-w-md w-full rounded-2xl border p-6 text-center shadow-lg transition-colors sm:p-8 ${cardSurfaceClass}`}
    >
      <p className="text-sm font-semibold text-indigo-300">
        Google Drive 連携済み
      </p>
      <h2 className="mt-2 text-lg font-bold text-white">
        本棚にまだ作品が同期されていません
      </h2>
      <p className="mt-3 text-sm leading-relaxed text-slate-400">
        マンガ保管フォルダが設定されています。同期を実行して本棚を作成してください
      </p>
      <div className="mt-6 flex flex-col gap-3">
        <button
          type="button"
          data-testid="empty-state-sync-drive-button"
          disabled={isSyncing}
          onClick={onSyncDrive}
          className="inline-flex w-full items-center justify-center gap-2 touch-manipulation rounded-xl bg-indigo-500 px-5 py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isSyncing && <EmptyStateSpinner />}
          <span>{isSyncing ? "同期中..." : "今すぐ同期"}</span>
        </button>
        <button
          type="button"
          data-testid="open-local-zip-button"
          onClick={onOpenLocalZip}
          className="w-full touch-manipulation rounded-xl border border-slate-700 bg-slate-800 px-5 py-2.5 text-sm font-medium text-slate-200 transition-colors hover:bg-slate-700"
        >
          ローカル ZIP を開く（.zip / .cbz）
        </button>
      </div>
    </section>
  );
}
