import type { ZipPageEntry } from "../engine/types";

export interface SyncMetaRecord {
  key: string;
  value: string;
}

export interface ZipIndexCacheRecord {
  cacheKey: string;
  pageCount: number;
  entries: ZipPageEntry[];
  cachedAt: number;
}

export type ReadStatus = "unread" | "reading" | "completed";

export interface ReadingProgressRecord {
  targetKey: string;
  volumeId: string | null;
  currentPageIndex: number;
  totalPageCount: number;
  readStatus: ReadStatus;
  spreadPageOffset: 0 | 1;
  lastReadAt: number;
  updatedAt: number;
}

export interface DriveSyncRootRecord {
  folderId: string;
  folderName: string;
  enabled: 0 | 1;
  addedAt: number;
  updatedAt: number;
  deletedAt: number | null;
}

export type PublicationStatus = "ongoing" | "completed" | "unknown";

export interface SeriesExternalIds {
  ndlId?: string;
  anilistId?: string;
  googleBooksId?: string;
}

export interface SeriesRecord {
  id: string;
  title: string;
  titleReading: string;
  authors: string[];
  publisher: string;
  label: string;
  tags: string[];
  synopsis: string;
  publicationStatus: PublicationStatus;
  knownTotalVolumes: number | null;
  externalIds: SeriesExternalIds;
  metadataLocked: boolean;
  representativeVolumeId: string | null;
  readerPresetJson: string | null;
  lastReadAt: number | null;
  addedAt: number;
  updatedAt: number;
  deletedAt: number | null;
}

export type CoverStatus = "pending" | "ready" | "error";
export type CoverCropMode = "auto" | "full" | "left-half" | "right-half";

export interface VolumeRecord {
  id: string;
  seriesId: string;
  volumeNumber: number | null;
  volumeLabel: string;
  rawFileName: string;
  driveFileId: string;
  parentFolderId: string | null;
  rootFolderId: string;
  fileSize: number;
  md5Checksum: string | null;
  driveModifiedTime: number;
  coverBlob: Blob | null;
  coverStatus: CoverStatus;
  coverCropMode: CoverCropMode;
  coverPageIndex: number;
  coverUpdatedAt: number | null;
  isTrashed: 0 | 1;
  addedAt: number;
  updatedAt: number;
}
