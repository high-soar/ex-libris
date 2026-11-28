import type { SeriesRecord, VolumeRecord } from "../../storage/types";

export type BookshelfSortOrder =
  "lastReadDesc" | "addedDesc" | "titleAsc" | "volumeCountDesc";

export interface SortableSeriesFields {
  readonly seriesId: string;
  readonly title: string;
  readonly titleReading: string;
  readonly volumeCount: number;
  readonly lastReadAt: number | null;
  readonly latestVolumeAddedAt: number;
  readonly seriesAddedAt: number;
}

export function resolveRepresentativeVolumeNonEmpty(
  _series: Pick<SeriesRecord, "representativeVolumeId">,
  visibleVolumes: readonly [VolumeRecord, ...VolumeRecord[]],
): VolumeRecord {
  return visibleVolumes[0];
}

export function resolveRepresentativeVolume(
  series: Pick<SeriesRecord, "representativeVolumeId">,
  visibleVolumes: readonly VolumeRecord[],
): VolumeRecord | null {
  if (visibleVolumes.length === 0) {
    return null;
  }
  return resolveRepresentativeVolumeNonEmpty(
    series,
    visibleVolumes as readonly [VolumeRecord, ...VolumeRecord[]],
  );
}

export function sortSeriesItems<T extends SortableSeriesFields>(
  items: readonly T[],
  _sortOrder: BookshelfSortOrder,
): T[] {
  return [...items];
}
