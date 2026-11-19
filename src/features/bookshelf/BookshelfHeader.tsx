import type { ReactNode } from "react";
import { APP_NAME, APP_VERSION } from "../../shared/constants/app";

export type CopyStatus = "idle" | "copied" | "failed";

export interface BookshelfHeaderProps {
  readonly copyStatus: CopyStatus;
  readonly onCopyDiagnostics: () => void;
  readonly onOpenLocalZip: () => void;
}

export function BookshelfHeader({
  copyStatus,
  onCopyDiagnostics,
  onOpenLocalZip,
}: BookshelfHeaderProps): ReactNode {
  return (
    <header
      style={{ paddingTop: "calc(1rem + env(safe-area-inset-top, 0px))" }}
      className="border-b border-slate-800 bg-slate-900/90 px-6 py-4 flex flex-wrap items-center justify-between gap-4"
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
      <div className="flex flex-wrap items-center gap-3">
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
      </div>
    </header>
  );
}
