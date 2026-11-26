import type { ReactNode } from "react";
import type { BookshelfSeriesCardItem } from "./bookshelfViewModel";
import { SeriesCard } from "./SeriesCard";

export interface SeriesGridSectionProps {
  readonly items: readonly BookshelfSeriesCardItem[];
  readonly onOpenDetail: (seriesId: string) => void;
  readonly onQuickRead: (seriesId: string, volumeId: string) => void;
}

export function SeriesGridSection({
  items,
  onOpenDetail,
  onQuickRead,
}: SeriesGridSectionProps): ReactNode {
  return (
    <section
      data-testid="series-grid-section"
      aria-label="シリーズ一覧"
      className="grid w-full grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 sm:gap-4"
    >
      {items.map((item) => (
        <SeriesCard
          key={item.seriesId}
          item={item}
          onOpenDetail={onOpenDetail}
          onQuickRead={onQuickRead}
        />
      ))}
    </section>
  );
}
