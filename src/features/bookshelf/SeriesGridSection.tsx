import type { ReactNode } from "react";
import type { BookshelfSeriesCardItem } from "./bookshelfViewModel";

export interface SeriesGridSectionProps {
  readonly items: readonly BookshelfSeriesCardItem[];
  readonly onOpenDetail: (seriesId: string) => void;
  readonly onQuickRead: (seriesId: string, volumeId: string) => void;
}

export function SeriesGridSection(_props: SeriesGridSectionProps): ReactNode {
  return null;
}
