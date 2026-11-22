import type { ReactNode } from "react";
import type { LocalReadingHistoryItem } from "../../storage/repositories/readingProgressRepository";
import type { ReadStatus } from "../../storage/types";

export interface RecentLocalHistorySectionProps {
  readonly items: readonly LocalReadingHistoryItem[];
  readonly onReopenLocalFile: () => void;
  readonly onDeleteItem: (targetKey: string) => void;
  readonly onClearAll: () => void;
}

const READ_STATUS_BADGE: Record<
  ReadStatus,
  { readonly label: string; readonly className: string }
> = {
  completed: {
    label: "読了",
    className:
      "border border-emerald-500/40 bg-emerald-500/20 text-emerald-300",
  },
  reading: {
    label: "読書中",
    className: "border border-indigo-400/40 bg-indigo-500/20 text-indigo-300",
  },
  unread: {
    label: "未読",
    className: "border border-slate-600/60 bg-slate-800 text-slate-300",
  },
};

function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export function RecentLocalHistorySection({
  items,
  onReopenLocalFile,
  onDeleteItem,
  onClearAll,
}: RecentLocalHistorySectionProps): ReactNode {
  if (items.length === 0) {
    return null;
  }

  return (
    <section
      data-testid="recent-local-history-section"
      className="w-full max-w-2xl rounded-2xl border border-slate-800 bg-slate-900/60 p-5 shadow-lg sm:p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-bold text-white sm:text-lg">
            最近のローカル閲覧履歴
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-slate-400 sm:text-sm">
            同じ .zip / .cbz
            ファイルを再選択すると、前回のページから自動レジュームします
          </p>
        </div>
        <button
          type="button"
          data-testid="clear-local-history-button"
          onClick={onClearAll}
          className="shrink-0 touch-manipulation rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 transition-colors hover:bg-slate-700"
        >
          履歴をクリア
        </button>
      </div>

      <ul data-testid="recent-local-history-list" className="mt-4 space-y-2.5">
        {items.map((item) => {
          const badge = READ_STATUS_BADGE[item.readStatus];
          const progressPercent =
            item.readStatus === "completed"
              ? 100
              : Math.min(
                  100,
                  Math.max(
                    0,
                    Math.round(
                      ((item.currentPageIndex + 1) / item.totalPageCount) * 100,
                    ),
                  ),
                );

          return (
            <li
              key={item.targetKey}
              data-testid="recent-local-history-item"
              className="flex items-stretch gap-2 rounded-xl border border-slate-800 bg-slate-950/60 p-2.5 sm:p-3"
            >
              <button
                type="button"
                data-testid="reopen-local-history-button"
                onClick={onReopenLocalFile}
                className="min-w-0 flex-1 touch-manipulation rounded-lg p-1 text-left transition-colors hover:bg-slate-800/60"
              >
                <span className="flex items-center justify-between gap-2">
                  <span
                    title={item.rawFileName}
                    className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-100"
                  >
                    {item.rawFileName}
                  </span>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${badge.className}`}
                  >
                    {badge.label}
                  </span>
                </span>
                <span className="mt-1 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
                  <span>{formatFileSize(item.fileSize)}</span>
                  <span className="tabular-nums">
                    {`${item.currentPageIndex + 1} / ${item.totalPageCount} ページ`}
                  </span>
                </span>
                <span
                  role="progressbar"
                  aria-label={`${item.rawFileName} の読書進捗`}
                  aria-valuenow={progressPercent}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  className="mt-2 block h-1.5 w-full overflow-hidden rounded-full bg-slate-800"
                >
                  <span
                    data-testid="local-history-progress-fill"
                    className="block h-full rounded-full bg-indigo-400 transition-all"
                    style={{ width: `${progressPercent}%` }}
                  />
                </span>
              </button>
              <button
                type="button"
                data-testid="delete-local-history-button"
                aria-label={`${item.rawFileName} の履歴を削除`}
                onClick={() => onDeleteItem(item.targetKey)}
                className="shrink-0 self-center touch-manipulation rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs font-medium text-slate-300 transition-colors hover:border-rose-500/50 hover:bg-rose-950/50 hover:text-rose-200"
              >
                削除
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
