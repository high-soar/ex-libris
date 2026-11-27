import type { ReactNode } from "react";
import { CoverThumbnail } from "../../shared/ui/CoverThumbnail";
import type { VolumeRecord } from "../../storage/types";
import type { QuickLaunchTarget } from "../bookshelf/bookshelfViewModel";

export interface SeriesSummaryCardProps {
  readonly title: string;
  readonly authors: readonly string[];
  readonly representativeVolume: VolumeRecord;
  readonly volumeCount: number;
  readonly completedCount: number;
  readonly quickLaunch: QuickLaunchTarget;
  readonly onQuickRead: (volumeId: string) => void;
}

export function SeriesSummaryCard({
  title,
  authors,
  representativeVolume,
  volumeCount,
  completedCount,
  quickLaunch,
  onQuickRead,
}: SeriesSummaryCardProps): ReactNode {
  const authorsLabel = authors.join(" / ");

  return (
    <section
      data-testid="series-summary-card"
      data-cover-volume-id={
        representativeVolume.coverStatus === "pending"
          ? representativeVolume.id
          : undefined
      }
      className="rounded-2xl border border-slate-800 bg-slate-900 p-4 shadow-md sm:p-6"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-6">
        <div className="w-32 shrink-0 self-center sm:w-40 sm:self-start">
          <CoverThumbnail
            coverBlob={representativeVolume.coverBlob}
            coverStatus={representativeVolume.coverStatus}
            title={title}
            badgeText={`全 ${volumeCount} 巻`}
          />
        </div>

        <div className="flex min-w-0 flex-1 flex-col">
          <h2
            data-testid="series-detail-title"
            className="break-words text-lg font-bold leading-snug text-white sm:text-2xl"
          >
            {title}
          </h2>

          {authorsLabel.length > 0 && (
            <p
              data-testid="series-detail-authors"
              className="mt-1.5 break-words text-xs text-slate-300 sm:text-sm"
            >
              {authorsLabel}
            </p>
          )}

          <div
            data-testid="series-detail-progress-summary"
            className="mt-3 flex flex-wrap items-center gap-2 text-xs"
          >
            <span className="rounded-full border border-slate-700 bg-slate-800/80 px-2.5 py-0.5 font-medium text-slate-200">
              全 {volumeCount} 巻
            </span>
            <span className="rounded-full border border-indigo-400/40 bg-indigo-500/15 px-2.5 py-0.5 font-medium text-indigo-200">
              {completedCount} / {volumeCount} 冊読了
            </span>
          </div>

          <div className="mt-4">
            <button
              type="button"
              data-testid="series-detail-primary-read-button"
              onClick={() => onQuickRead(quickLaunch.volume.id)}
              className="w-full touch-manipulation rounded-xl bg-indigo-500 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-indigo-400 sm:w-auto"
            >
              {quickLaunch.seriesDetailLabel}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
