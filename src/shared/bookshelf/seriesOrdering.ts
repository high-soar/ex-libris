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

function compareStringsAsc(a: string, b: string): number {
  if (a < b) {
    return -1;
  }
  if (a > b) {
    return 1;
  }
  return 0;
}

function compareTitleTieBreak(
  a: SortableSeriesFields,
  b: SortableSeriesFields,
): number {
  const readingDiff = compareStringsAsc(a.titleReading, b.titleReading);
  if (readingDiff !== 0) {
    return readingDiff;
  }
  const titleDiff = compareStringsAsc(a.title, b.title);
  if (titleDiff !== 0) {
    return titleDiff;
  }
  return compareStringsAsc(a.seriesId, b.seriesId);
}

function compareAddedDesc(
  a: SortableSeriesFields,
  b: SortableSeriesFields,
): number {
  if (a.latestVolumeAddedAt !== b.latestVolumeAddedAt) {
    return b.latestVolumeAddedAt - a.latestVolumeAddedAt;
  }
  if (a.seriesAddedAt !== b.seriesAddedAt) {
    return b.seriesAddedAt - a.seriesAddedAt;
  }
  return compareTitleTieBreak(a, b);
}

const SERIES_SORT_COMPARATORS: Record<
  BookshelfSortOrder,
  (a: SortableSeriesFields, b: SortableSeriesFields) => number
> = {
  lastReadDesc: (a, b) => {
    if (a.lastReadAt !== b.lastReadAt) {
      if (a.lastReadAt === null) {
        return 1;
      }
      if (b.lastReadAt === null) {
        return -1;
      }
      return b.lastReadAt - a.lastReadAt;
    }
    return compareAddedDesc(a, b);
  },
  addedDesc: compareAddedDesc,
  titleAsc: compareTitleTieBreak,
  volumeCountDesc: (a, b) => {
    if (a.volumeCount !== b.volumeCount) {
      return b.volumeCount - a.volumeCount;
    }
    return compareTitleTieBreak(a, b);
  },
};

export function resolveRepresentativeVolumeNonEmpty(
  series: Pick<SeriesRecord, "representativeVolumeId">,
  visibleVolumes: readonly [VolumeRecord, ...VolumeRecord[]],
): VolumeRecord {
  if (series.representativeVolumeId !== null) {
    const matched = visibleVolumes.find(
      (volume) => volume.id === series.representativeVolumeId,
    );
    if (matched !== undefined) {
      return matched;
    }
  }
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
  sortOrder: BookshelfSortOrder,
): T[] {
  return [...items].sort(SERIES_SORT_COMPARATORS[sortOrder]);
}
