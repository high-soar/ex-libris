import type { ReactNode } from "react";
import type { SeriesDetailPageInitialSnapshot } from "./types";

export interface SeriesDetailPageProps {
  readonly seriesId: string;
  readonly initialSnapshot?: SeriesDetailPageInitialSnapshot;
}

export function SeriesDetailPage(_props: SeriesDetailPageProps): ReactNode {
  return null;
}
