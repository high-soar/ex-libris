import type { ReactNode } from "react";
import type { BookshelfSeriesCardItem } from "./bookshelfViewModel";

export interface SeriesCardProps {
  readonly item: BookshelfSeriesCardItem;
  readonly onOpenDetail: (seriesId: string) => void;
  readonly onQuickRead: (seriesId: string, volumeId: string) => void;
}

export function SeriesCard(_props: SeriesCardProps): ReactNode {
  return null;
}
