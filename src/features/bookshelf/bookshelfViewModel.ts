import type {
  ReadingProgressRecord,
  ReadStatus,
  SeriesRecord,
  VolumeRecord,
} from "../../storage/types";

export type BookshelfSortOrder =
  "lastReadDesc" | "addedDesc" | "titleAsc" | "volumeCountDesc";

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
  void volume;
  return false;
}

export function resolveRepresentativeVolume(
  series: Pick<SeriesRecord, "representativeVolumeId">,
  visibleVolumes: readonly VolumeRecord[],
): VolumeRecord | null {
  void series;
  void visibleVolumes;
  return null;
}

export function resolveQuickLaunchVolume(
  visibleVolumes: readonly VolumeRecord[],
  progressByVolumeId: ReadonlyMap<string, ReadingProgressRecord>,
): QuickLaunchTarget | null {
  void visibleVolumes;
  void progressByVolumeId;
  return null;
}

export function computeProgressPercent(
  progress: Pick<
    ReadingProgressRecord,
    "readStatus" | "currentPageIndex" | "totalPageCount"
  >,
): number {
  void progress;
  return 0;
}

export function buildBookshelfSeriesItems(
  input: BuildBookshelfSeriesItemsInput,
): BookshelfSeriesCardItem[] {
  void input;
  return [];
}

export function sortBookshelfSeriesItems(
  items: readonly BookshelfSeriesCardItem[],
  sortOrder: BookshelfSortOrder,
): BookshelfSeriesCardItem[] {
  void sortOrder;
  return [...items];
}

export function buildSeriesDetailViewModel(
  input: BuildSeriesDetailViewModelInput,
): SeriesDetailViewModel | null {
  void input;
  return null;
}

export function formatSyncTimestamp(
  epochMs: number,
  timeZone = "Asia/Tokyo",
): string {
  void epochMs;
  void timeZone;
  return "";
}

export function formatByteSize(bytes: number): string {
  void bytes;
  return "";
}
