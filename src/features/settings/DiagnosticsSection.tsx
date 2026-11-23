import type { ReactNode } from "react";
import type { DiagnosticEntry, DiagnosticLevel } from "../../diagnostics/types";
import type { DiagnosticsCopyStatus } from "./types";

export interface DiagnosticsSectionProps {
  readonly entries: readonly DiagnosticEntry[];
  readonly copyStatus: DiagnosticsCopyStatus;
  readonly onCopyDiagnostics: () => void;
  readonly onClearDiagnostics: () => void;
}

const LEVEL_BADGE_MAP: Record<
  DiagnosticLevel,
  { readonly label: string; readonly className: string }
> = {
  info: {
    label: "INFO",
    className: "border border-slate-600/60 bg-slate-800 text-slate-300",
  },
  warn: {
    label: "WARN",
    className: "border border-amber-500/40 bg-amber-500/20 text-amber-300",
  },
  error: {
    label: "ERROR",
    className: "border border-rose-500/40 bg-rose-500/20 text-rose-300",
  },
};

function CopyStatusFeedback({
  copyStatus,
}: {
  readonly copyStatus: DiagnosticsCopyStatus;
}): ReactNode {
  if (copyStatus === "copied") {
    return (
      <div className="mt-3">
        <span
          data-testid="settings-copy-diagnostics-status"
          role="status"
          className="text-xs font-medium text-emerald-400"
        >
          診断ログをコピーしました
        </span>
      </div>
    );
  }
  if (copyStatus === "failed") {
    return (
      <div className="mt-3">
        <span
          data-testid="settings-copy-diagnostics-status"
          role="alert"
          className="text-xs font-medium text-rose-400"
        >
          クリップボードへコピーできませんでした
        </span>
      </div>
    );
  }
  return null;
}

export function DiagnosticsSection({
  entries,
  copyStatus,
  onCopyDiagnostics,
  onClearDiagnostics,
}: DiagnosticsSectionProps): ReactNode {
  const orderedEntries = [...entries].reverse();
  const isEmpty = orderedEntries.length === 0;

  return (
    <section
      data-testid="diagnostics-section"
      aria-labelledby="diagnostics-heading"
      className="rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-lg sm:p-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <h2
            id="diagnostics-heading"
            className="text-base font-bold text-white sm:text-lg"
          >
            診断ログ
          </h2>
          <span
            data-testid="diagnostics-entry-count"
            className="rounded-full border border-slate-700 bg-slate-800 px-2.5 py-0.5 text-xs font-medium tabular-nums text-slate-300"
          >
            {entries.length} 件
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            data-testid="settings-copy-diagnostics-button"
            onClick={onCopyDiagnostics}
            className="touch-manipulation rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 transition-colors hover:bg-slate-700"
          >
            診断ログをコピー
          </button>
          <button
            type="button"
            data-testid="settings-clear-diagnostics-button"
            disabled={isEmpty}
            onClick={onClearDiagnostics}
            className="touch-manipulation rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-300 transition-colors hover:border-rose-500/50 hover:bg-rose-950/50 hover:text-rose-200 disabled:cursor-not-allowed disabled:opacity-40"
          >
            ログをクリア
          </button>
        </div>
      </div>

      <p className="mt-1.5 text-xs leading-relaxed text-slate-400">
        認証トークンや API キーは自動的に{" "}
        <code className="rounded bg-slate-800 px-1 py-0.5 font-mono text-slate-300">
          [REDACTED]
        </code>{" "}
        へマスクされます。
      </p>

      <CopyStatusFeedback copyStatus={copyStatus} />

      {isEmpty ? (
        <p
          data-testid="diagnostics-empty"
          className="mt-4 rounded-xl border border-dashed border-slate-800 bg-slate-950/40 px-4 py-6 text-center text-xs text-slate-400"
        >
          記録された診断ログはありません
        </p>
      ) : (
        <ul
          data-testid="diagnostics-log-list"
          className="mt-4 max-h-64 space-y-2 overflow-y-auto pr-1"
        >
          {orderedEntries.map((entry) => {
            const levelBadge = LEVEL_BADGE_MAP[entry.level];
            return (
              <li
                key={entry.id}
                data-testid="diagnostics-log-item"
                className="rounded-xl border border-slate-800 bg-slate-950/70 p-3 font-mono text-xs"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${levelBadge.className}`}
                  >
                    {levelBadge.label}
                  </span>
                  <span className="text-slate-400">{entry.timestamp}</span>
                  <span className="text-indigo-300">[{entry.scope}]</span>
                </div>
                <p className="mt-1.5 break-words text-slate-100">
                  {entry.message}
                </p>
                {entry.detail !== undefined && (
                  <p className="mt-1 break-all text-slate-400">
                    {entry.detail}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
