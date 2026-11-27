import type { ReactNode } from "react";
import { CoverThumbnail } from "../../shared/ui/CoverThumbnail";
import type { ReadStatus } from "../../storage/types";
import type { SeriesDetailVolumeItem } from "../bookshelf/bookshelfViewModel";

export interface SeriesVolumeListSectionProps {
  readonly volumes: readonly SeriesDetailVolumeItem[];
  readonly canRetryCovers?: boolean;
  readonly onRetryFailedCovers?: () => void;
  readonly onSelectVolume: (volumeId: string) => void;
}

const READ_STATUS_BADGE: Record<
  ReadStatus,
  { readonly label: string; readonly className: string }
> = {
  unread: {
    label: "未読",
    className: "border-slate-700 bg-slate-800/80 text-slate-300",
  },
  reading: {
    label: "読書中",
    className: "border-indigo-400/40 bg-indigo-500/20 text-indigo-200",
  },
  completed: {
    label: "読了",
    className: "border-emerald-500/40 bg-emerald-500/15 text-emerald-300",
  },
};

export function SeriesVolumeListSection({
  volumes,
  onSelectVolume,
}: SeriesVolumeListSectionProps): ReactNode {
  return (
    <section data-testid="series-volume-list" className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-200 sm:text-base">
          収録巻一覧（{volumes.length} 巻）
        </h2>
      </div>

      <ul className="space-y-2.5">
        {volumes.map((item) => {
          const statusMeta = READ_STATUS_BADGE[item.readStatus];
          return (
            <li
              key={item.volume.id}
              data-testid="series-volume-item"
              data-volume-id={item.volume.id}
            >
              <button
                type="button"
                data-testid="open-volume-reader-button"
                onClick={() => onSelectVolume(item.volume.id)}
                className="flex w-full items-center gap-3 rounded-xl border border-slate-800 bg-slate-900 p-3 text-left transition-colors hover:border-indigo-400/50 hover:bg-slate-900/80 touch-manipulation focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 sm:gap-4 sm:p-4"
              >
                <div className="w-14 shrink-0 sm:w-16">
                  <CoverThumbnail
                    coverBlob={item.volume.coverBlob}
                    coverStatus={item.volume.coverStatus}
                    title={item.volume.volumeLabel}
                  />
                </div>

                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                      <span
                        data-testid="volume-label"
                        className="text-sm font-semibold text-white sm:text-base"
                      >
                        {item.volume.volumeLabel}
                      </span>
                      {item.isOmnibus && (
                        <span
                          data-testid="volume-omnibus-badge"
                          className="rounded-md border border-amber-400/40 bg-amber-500/15 px-1.5 py-0.5 text-[11px] font-semibold text-amber-200"
                        >
                          合本
                        </span>
                      )}
                    </div>
                    <span
                      data-testid="volume-read-status"
                      className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium ${statusMeta.className}`}
                    >
                      {statusMeta.label}
                    </span>
                  </div>

                  <div className="flex items-center justify-between gap-2 text-xs text-slate-400">
                    <span
                      data-testid="volume-raw-filename"
                      className="min-w-0 truncate"
                    >
                      {item.volume.rawFileName}
                    </span>
                    <span
                      data-testid="volume-file-size"
                      className="shrink-0 font-mono text-[11px] text-slate-400"
                    >
                      {item.fileSizeLabel}
                    </span>
                  </div>

                  {item.progress !== null && item.progressPercent !== null && (
                    <div
                      data-testid="volume-progress"
                      className="space-y-1 pt-0.5"
                    >
                      <div className="flex items-center justify-between text-[11px] text-slate-300">
                        <span data-testid="volume-progress-text">
                          {item.progress.currentPageIndex + 1} /{" "}
                          {item.progress.totalPageCount} ページ
                        </span>
                        <span>{item.progressPercent}%</span>
                      </div>
                      <div
                        className="h-1.5 w-full overflow-hidden rounded-full bg-slate-800"
                        role="progressbar"
                        aria-valuenow={item.progressPercent}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-label={`${item.volume.volumeLabel} の読書進捗`}
                      >
                        <div
                          data-testid="volume-progress-bar"
                          className={
                            item.readStatus === "completed"
                              ? "h-full rounded-full bg-emerald-400"
                              : "h-full rounded-full bg-indigo-400"
                          }
                          style={{ width: `${item.progressPercent}%` }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
