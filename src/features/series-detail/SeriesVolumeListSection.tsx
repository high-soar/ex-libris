import type { ReactNode } from "react";
import type { SeriesDetailVolumeItem } from "../bookshelf/bookshelfViewModel";

export interface SeriesVolumeListSectionProps {
  readonly volumes: readonly SeriesDetailVolumeItem[];
  readonly onSelectVolume: (volumeId: string) => void;
}

export function SeriesVolumeListSection(
  _props: SeriesVolumeListSectionProps,
): ReactNode {
  return null;
}
