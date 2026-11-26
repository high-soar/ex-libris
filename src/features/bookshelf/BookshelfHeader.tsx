import type { ReactNode } from "react";
import { APP_NAME, APP_VERSION } from "../../shared/constants/app";

export type CopyStatus = "idle" | "copied" | "failed";

export interface BookshelfHeaderProps {
  readonly copyStatus: CopyStatus;
  readonly onCopyDiagnostics: () => void;
  readonly onOpenLocalZip: () => void;
  readonly onOpenSettings?: () => void;
  readonly canSync?: boolean;
  readonly isSyncing?: boolean;
  readonly onSyncDrive?: () => void;
}

function SyncSpinner(): ReactNode {
  return (
    <svg
      data-testid="header-sync-spinner"
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

export function BookshelfHeader({
  copyStatus,
  onCopyDiagnostics,
  onOpenLocalZip,
  onOpenSettings,
  canSync = false,
  isSyncing = false,
  onSyncDrive,
}: BookshelfHeaderProps): ReactNode {
  const isSyncDisabled = !canSync || isSyncing;

  return (
    <header
      style={{ paddingTop: "calc(1rem + env(safe-area-inset-top, 0px))" }}
      className="border-b border-slate-800 bg-slate-900/90 px-4 py-4 sm:px-6 flex flex-wrap items-center justify-between gap-3 sm:gap-4"
    >
      <div className="flex items-baseline gap-3">
        <h1 className="text-xl font-bold tracking-tight text-white">
          {APP_NAME}
        </h1>
        <span
          data-testid="app-version"
          className="rounded-full bg-indigo-500/20 px-2.5 py-0.5 text-xs font-medium text-indigo-300"
        >
          v{APP_VERSION}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2 sm:gap-3">
        {copyStatus === "copied" && (
          <span
            data-testid="copy-diagnostics-status"
            role="status"
            className="text-xs font-medium text-emerald-400"
          >
            診断ログをコピーしました
          </span>
        )}
        {copyStatus === "failed" && (
          <span
            data-testid="copy-diagnostics-status"
            role="alert"
            className="text-xs font-medium text-rose-400"
          >
            クリップボードへコピーできませんでした
          </span>
        )}
        <button
          type="button"
          data-testid="header-sync-drive-button"
          disabled={isSyncDisabled}
          onClick={onSyncDrive}
          className="inline-flex items-center gap-1.5 touch-manipulation rounded-lg border border-indigo-400/50 bg-indigo-500/20 px-3 py-1.5 text-xs font-semibold text-indigo-200 hover:bg-indigo-500/30 disabled:cursor-not-allowed disabled:opacity-40 transition-colors"
        >
          {isSyncing && <SyncSpinner />}
          <span>{isSyncing ? "同期中..." : "同期"}</span>
        </button>
        <button
          type="button"
          data-testid="header-open-local-zip-button"
          onClick={onOpenLocalZip}
          className="touch-manipulation rounded-lg bg-indigo-500 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-indigo-400 transition-colors"
        >
          ローカル ZIP を開く
        </button>
        <button
          type="button"
          data-testid="copy-diagnostics-button"
          onClick={onCopyDiagnostics}
          className="touch-manipulation rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700 transition-colors"
        >
          診断ログをコピー
        </button>
        <button
          type="button"
          data-testid="header-settings-button"
          onClick={onOpenSettings}
          className="touch-manipulation rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700 transition-colors"
        >
          設定
        </button>
      </div>
    </header>
  );
}
