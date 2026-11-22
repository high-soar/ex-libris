import { ExLibrisDatabase, db } from "../db";
import type { ReadStatus, ReadingProgressRecord } from "../types";

export const LOCAL_READING_PROGRESS_MAX_ENTRIES = 100;
export const RECENT_LOCAL_HISTORY_DEFAULT_LIMIT = 10;

export interface ParsedLocalProgressKey {
  readonly rawFileName: string;
  readonly fileSize: number;
}

export interface SaveReadingProgressInput {
  readonly targetKey: string;
  readonly volumeId: string | null;
  readonly currentPageIndex: number;
  readonly totalPageCount: number;
  readonly readStatus: ReadStatus;
  readonly spreadPageOffset: 0 | 1;
}

export interface LocalReadingHistoryItem {
  readonly targetKey: string;
  readonly rawFileName: string;
  readonly fileSize: number;
  readonly currentPageIndex: number;
  readonly totalPageCount: number;
  readonly readStatus: ReadStatus;
  readonly spreadPageOffset: 0 | 1;
  readonly lastReadAt: number;
}

export interface ReadingProgressRepository {
  get(targetKey: string): Promise<ReadingProgressRecord | null>;
  put(input: SaveReadingProgressInput): Promise<void>;
  listRecentLocal(limit?: number): Promise<readonly LocalReadingHistoryItem[]>;
  delete(targetKey: string): Promise<void>;
  clearLocal(): Promise<void>;
}

export interface DexieReadingProgressRepositoryOptions {
  readonly maxLocalEntries?: number;
  readonly now?: () => number;
}

export function parseLocalProgressTargetKey(
  _targetKey: string,
): ParsedLocalProgressKey | null {
  return null;
}

export class DexieReadingProgressRepository implements ReadingProgressRepository {
  constructor(
    _database: ExLibrisDatabase = db,
    _options: DexieReadingProgressRepositoryOptions = {},
  ) {}

  async get(_targetKey: string): Promise<ReadingProgressRecord | null> {
    return null;
  }

  async put(_input: SaveReadingProgressInput): Promise<void> {}

  async listRecentLocal(
    _limit = RECENT_LOCAL_HISTORY_DEFAULT_LIMIT,
  ): Promise<readonly LocalReadingHistoryItem[]> {
    return [];
  }

  async delete(_targetKey: string): Promise<void> {}

  async clearLocal(): Promise<void> {}
}
