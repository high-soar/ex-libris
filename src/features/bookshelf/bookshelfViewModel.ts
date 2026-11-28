import {
  resolveRepresentativeVolume,
  resolveRepresentativeVolumeNonEmpty,
  sortSeriesItems,
  type BookshelfSortOrder,
} from "../../shared/bookshelf/seriesOrdering";
import { compareVolumesForDisplay } from "../../storage/repositories/volumesRepository";
import type {
  ReadingProgressRecord,
  ReadStatus,
  SeriesRecord,
  VolumeRecord,
} from "../../storage/types";

export { resolveRepresentativeVolume, type BookshelfSortOrder };

export type QuickLaunchKind = "continue" | "start" | "next" | "reread";

export interface QuickLaunchTarget {
  readonly volume: VolumeRecord;
  readonly kind: QuickLaunchKind;
  readonly bookshelfLabel: string;
  readonly seriesDetailLabel: string;
}

export interface BookshelfSeriesCardItem {
  readonly seriesId: string;
  readonly title: string;
  readonly titleReading: string;
  readonly authors: readonly string[];
  readonly volumeCount: number;
  readonly completedCount: number;
  readonly readStatus: ReadStatus;
  readonly lastReadAt: number | null;
  readonly latestVolumeAddedAt: number;
  readonly seriesAddedAt: number;
  readonly representativeVolume: VolumeRecord;
  readonly quickLaunchVolumeId: string;
  readonly quickLaunchLabel: string;
}

export interface BuildBookshelfSeriesItemsInput {
  readonly seriesList: readonly SeriesRecord[];
  readonly visibleVolumes: readonly VolumeRecord[];
  readonly progressByVolumeId: ReadonlyMap<string, ReadingProgressRecord>;
}

export interface SeriesDetailVolumeItem {
  readonly volume: VolumeRecord;
  readonly isOmnibus: boolean;
  readonly fileSizeLabel: string;
  readonly readStatus: ReadStatus;
  readonly progress: ReadingProgressRecord | null;
  readonly progressPercent: number | null;
}

export interface SeriesDetailViewModel {
  readonly series: SeriesRecord;
  readonly representativeVolume: VolumeRecord;
  readonly volumeCount: number;
  readonly completedCount: number;
  readonly quickLaunch: QuickLaunchTarget;
  readonly volumes: readonly SeriesDetailVolumeItem[];
}

export interface BuildSeriesDetailViewModelInput {
  readonly series: SeriesRecord | null;
  readonly volumes: readonly VolumeRecord[];
  readonly enabledRootIds: ReadonlySet<string>;
  readonly progressByVolumeId: ReadonlyMap<string, ReadingProgressRecord>;
}

export function isOmnibusVolume(
  volume: Pick<VolumeRecord, "volumeLabel">,
): boolean {
  return volume.volumeLabel.includes("合本");
}

function resolveQuickLaunchVolumeNonEmpty(
  visibleVolumes: readonly [VolumeRecord, ...VolumeRecord[]],
  progressByVolumeId: ReadonlyMap<string, ReadingProgressRecord>,
): QuickLaunchTarget {
  let latestReadingVolume: VolumeRecord | null = null;
  let latestReadingAt = Number.NEGATIVE_INFINITY;
  let firstUncompletedVolume: VolumeRecord | null = null;
  let completedCount = 0;

  for (const volume of visibleVolumes) {
    const progress = progressByVolumeId.get(volume.id);
    if (progress?.readStatus === "reading") {
      if (
        latestReadingVolume === null ||
        progress.lastReadAt > latestReadingAt
      ) {
        latestReadingVolume = volume;
        latestReadingAt = progress.lastReadAt;
      }
    } else if (progress?.readStatus === "completed") {
      completedCount += 1;
    } else if (firstUncompletedVolume === null) {
      firstUncompletedVolume = volume;
    }
  }

  if (latestReadingVolume !== null) {
    return {
      volume: latestReadingVolume,
      kind: "continue",
      bookshelfLabel: `続きを読む (${latestReadingVolume.volumeLabel})`,
      seriesDetailLabel: `続きを読む（${latestReadingVolume.volumeLabel}）`,
    };
  }

  if (firstUncompletedVolume !== null) {
    if (completedCount === 0) {
      return {
        volume: firstUncompletedVolume,
        kind: "start",
        bookshelfLabel: `読む (${firstUncompletedVolume.volumeLabel})`,
        seriesDetailLabel: `読み始める（${firstUncompletedVolume.volumeLabel}）`,
      };
    }
    return {
      volume: firstUncompletedVolume,
      kind: "next",
      bookshelfLabel: `次を読む (${firstUncompletedVolume.volumeLabel})`,
      seriesDetailLabel: `次を読む（${firstUncompletedVolume.volumeLabel}）`,
    };
  }

  const firstVolume = visibleVolumes[0];
  return {
    volume: firstVolume,
    kind: "reread",
    bookshelfLabel: "最初から読む",
    seriesDetailLabel: `最初から読む（${firstVolume.volumeLabel}）`,
  };
}

export function resolveQuickLaunchVolume(
  visibleVolumes: readonly VolumeRecord[],
  progressByVolumeId: ReadonlyMap<string, ReadingProgressRecord>,
): QuickLaunchTarget | null {
  if (visibleVolumes.length === 0) {
    return null;
  }
  return resolveQuickLaunchVolumeNonEmpty(
    visibleVolumes as readonly [VolumeRecord, ...VolumeRecord[]],
    progressByVolumeId,
  );
}

export function computeProgressPercent(
  progress: Pick<
    ReadingProgressRecord,
    "readStatus" | "currentPageIndex" | "totalPageCount"
  >,
): number {
  if (progress.readStatus === "completed") {
    return 100;
  }
  return Math.min(
    100,
    Math.max(
      0,
      Math.round(
        ((progress.currentPageIndex + 1) / progress.totalPageCount) * 100,
      ),
    ),
  );
}

export function buildBookshelfSeriesItems(
  input: BuildBookshelfSeriesItemsInput,
): BookshelfSeriesCardItem[] {
  const volumesBySeriesId = new Map<string, VolumeRecord[]>();
  for (const volume of input.visibleVolumes) {
    if (volume.isTrashed !== 0) {
      continue;
    }
    const existing = volumesBySeriesId.get(volume.seriesId);
    if (existing !== undefined) {
      existing.push(volume);
    } else {
      volumesBySeriesId.set(volume.seriesId, [volume]);
    }
  }

  const items: BookshelfSeriesCardItem[] = [];
  for (const series of input.seriesList) {
    if (series.deletedAt !== null) {
      continue;
    }
    const seriesVolumes = volumesBySeriesId.get(series.id);
    if (seriesVolumes === undefined) {
      continue;
    }

    const sortedVolumes = [...seriesVolumes].sort(compareVolumesForDisplay) as [
      VolumeRecord,
      ...VolumeRecord[],
    ];

    let completedCount = 0;
    let hasReading = false;
    let latestVolumeAddedAt = sortedVolumes[0].addedAt;
    for (const volume of sortedVolumes) {
      if (volume.addedAt > latestVolumeAddedAt) {
        latestVolumeAddedAt = volume.addedAt;
      }
      const status = input.progressByVolumeId.get(volume.id)?.readStatus;
      if (status === "completed") {
        completedCount += 1;
      } else if (status === "reading") {
        hasReading = true;
      }
    }

    const readStatus: ReadStatus =
      completedCount === sortedVolumes.length
        ? "completed"
        : completedCount === 0 && !hasReading
          ? "unread"
          : "reading";

    const representativeVolume = resolveRepresentativeVolumeNonEmpty(
      series,
      sortedVolumes,
    );
    const quickLaunch = resolveQuickLaunchVolumeNonEmpty(
      sortedVolumes,
      input.progressByVolumeId,
    );

    items.push({
      seriesId: series.id,
      title: series.title,
      titleReading: series.titleReading,
      authors: series.authors,
      volumeCount: sortedVolumes.length,
      completedCount,
      readStatus,
      lastReadAt: series.lastReadAt,
      latestVolumeAddedAt,
      seriesAddedAt: series.addedAt,
      representativeVolume,
      quickLaunchVolumeId: quickLaunch.volume.id,
      quickLaunchLabel: quickLaunch.bookshelfLabel,
    });
  }

  return items;
}

export function sortBookshelfSeriesItems(
  items: readonly BookshelfSeriesCardItem[],
  sortOrder: BookshelfSortOrder,
): BookshelfSeriesCardItem[] {
  return sortSeriesItems(items, sortOrder);
}

export function buildSeriesDetailViewModel(
  input: BuildSeriesDetailViewModelInput,
): SeriesDetailViewModel | null {
  if (input.series === null || input.series.deletedAt !== null) {
    return null;
  }
  const activeSeries = input.series;
  const visibleVolumes = input.volumes
    .filter(
      (volume) =>
        volume.seriesId === activeSeries.id &&
        volume.isTrashed === 0 &&
        input.enabledRootIds.has(volume.rootFolderId),
    )
    .sort(compareVolumesForDisplay);

  if (visibleVolumes.length === 0) {
    return null;
  }

  const nonEmptyVolumes = visibleVolumes as [VolumeRecord, ...VolumeRecord[]];
  const representativeVolume = resolveRepresentativeVolumeNonEmpty(
    activeSeries,
    nonEmptyVolumes,
  );
  const quickLaunch = resolveQuickLaunchVolumeNonEmpty(
    nonEmptyVolumes,
    input.progressByVolumeId,
  );

  let completedCount = 0;
  const volumeItems: SeriesDetailVolumeItem[] = nonEmptyVolumes.map(
    (volume) => {
      const progress = input.progressByVolumeId.get(volume.id) ?? null;
      const readStatus: ReadStatus = progress?.readStatus ?? "unread";
      if (readStatus === "completed") {
        completedCount += 1;
      }
      return {
        volume,
        isOmnibus: isOmnibusVolume(volume),
        fileSizeLabel: formatByteSize(volume.fileSize),
        readStatus,
        progress,
        progressPercent:
          progress !== null ? computeProgressPercent(progress) : null,
      };
    },
  );

  return {
    series: activeSeries,
    representativeVolume,
    volumeCount: nonEmptyVolumes.length,
    completedCount,
    quickLaunch,
    volumes: volumeItems,
  };
}

export function formatSyncTimestamp(
  epochMs: number,
  timeZone = "Asia/Tokyo",
): string {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(epochMs));
}

export function formatByteSize(bytes: number): string {
  const safeBytes = Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
  if (safeBytes < 1024) {
    return `${safeBytes} B`;
  }
  if (safeBytes < 1024 * 1024) {
    return `${(safeBytes / 1024).toFixed(1)} KB`;
  }
  if (safeBytes < 1024 * 1024 * 1024) {
    return `${(safeBytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(safeBytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
