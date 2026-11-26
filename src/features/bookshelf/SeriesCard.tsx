import type { MouseEvent, ReactNode } from "react";
import { CoverThumbnail } from "../../shared/ui/CoverThumbnail";
import type { BookshelfSeriesCardItem } from "./bookshelfViewModel";

export interface SeriesCardProps {
  readonly item: BookshelfSeriesCardItem;
  readonly onOpenDetail: (seriesId: string) => void;
  readonly onQuickRead: (seriesId: string, volumeId: string) => void;
}

function getReadStatusMeta(item: BookshelfSeriesCardItem): {
  readonly label: string;
  readonly className: string;
} {
  if (item.readStatus === "completed") {
    return {
      label: "読了",
      className: "border-emerald-500/40 bg-emerald-500/15 text-emerald-300",
    };
  }
  if (item.readStatus === "reading") {
    return {
      label: `読書中 (${item.completedCount}/${item.volumeCount})`,
      className: "border-indigo-400/40 bg-indigo-500/20 text-indigo-200",
    };
  }
  return {
    label: "未読",
    className: "border-slate-700 bg-slate-800/80 text-slate-300",
  };
}

export function SeriesCard({
  item,
  onOpenDetail,
  onQuickRead,
}: SeriesCardProps): ReactNode {
  const statusMeta = getReadStatusMeta(item);
  const authorsLabel = item.authors.join(" / ");

  const handleQuickReadClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    onQuickRead(item.seriesId, item.quickLaunchVolumeId);
  };

  return (
    <article
      data-testid="series-card"
      data-series-id={item.seriesId}
      className="flex flex-col overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 shadow-md transition-colors hover:border-slate-700"
    >
      <button
        type="button"
        data-testid="series-card-open-detail"
        onClick={() => onOpenDetail(item.seriesId)}
        className="flex flex-1 flex-col p-2.5 text-left touch-manipulation focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 sm:p-3"
      >
        <CoverThumbnail
          coverBlob={item.representativeVolume.coverBlob}
          coverStatus={item.representativeVolume.coverStatus}
          title={item.title}
          badgeText={`全 ${item.volumeCount} 巻`}
        />
        <div className="mt-2.5 flex flex-1 flex-col">
          <h3 className="line-clamp-2 break-words text-xs font-bold leading-snug text-white sm:text-sm">
            {item.title}
          </h3>
          {authorsLabel.length > 0 && (
            <p
              data-testid="series-card-authors"
              className="mt-1 truncate text-[11px] text-slate-400 sm:text-xs"
            >
              {authorsLabel}
            </p>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span
              data-testid="series-read-status"
              className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${statusMeta.className}`}
            >
              {statusMeta.label}
            </span>
          </div>
        </div>
      </button>

      <div className="border-t border-slate-800/80 px-2.5 pb-2.5 pt-2 sm:px-3 sm:pb-3">
        <button
          type="button"
          data-testid="series-card-quick-read"
          onClick={handleQuickReadClick}
          className="w-full truncate touch-manipulation rounded-lg bg-indigo-500 px-2.5 py-1.5 text-center text-xs font-semibold text-white transition-colors hover:bg-indigo-400"
        >
          {item.quickLaunchLabel}
        </button>
      </div>
    </article>
  );
}
