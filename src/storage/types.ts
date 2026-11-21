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
