import type { ReactNode } from "react";
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

export function SeriesSummaryCard(_props: SeriesSummaryCardProps): ReactNode {
  return null;
}
