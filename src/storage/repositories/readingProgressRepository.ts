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
  listByVolumeIds(
    volumeIds: ReadonlySet<string>,
  ): Promise<ReadonlyMap<string, ReadingProgressRecord>>;
  listRecentLocal(limit?: number): Promise<readonly LocalReadingHistoryItem[]>;
  delete(targetKey: string): Promise<void>;
  clearLocal(): Promise<void>;
}

export interface DexieReadingProgressRepositoryOptions {
  readonly maxLocalEntries?: number;
  readonly now?: () => number;
}

export function parseLocalProgressTargetKey(
  targetKey: string,
): ParsedLocalProgressKey | null {
  if (!targetKey.startsWith("local:")) {
    return null;
  }
  const body = targetKey.slice("local:".length);
  const sepIndex = body.lastIndexOf(":");
  if (sepIndex <= 0) {
    return null;
  }
  const rawFileName = body.slice(0, sepIndex);
  const sizeText = body.slice(sepIndex + 1);
  if (!/^\d+$/.test(sizeText)) {
    return null;
  }
  const fileSize = Number(sizeText);
  if (!Number.isSafeInteger(fileSize)) {
    return null;
  }
  return { rawFileName, fileSize };
}

function isValidTargetAndVolume(
  targetKey: string,
  volumeId: string | null,
): boolean {
  if (targetKey.startsWith("local:")) {
    return parseLocalProgressTargetKey(targetKey) !== null && volumeId === null;
  }
  if (targetKey.startsWith("vol:")) {
    const id = targetKey.slice("vol:".length);
    return id.length > 0 && volumeId === id;
  }
  return false;
}

function hasValidCoreValues(input: SaveReadingProgressInput): boolean {
  return (
    Number.isSafeInteger(input.totalPageCount) &&
    input.totalPageCount >= 1 &&
    Number.isSafeInteger(input.currentPageIndex) &&
    input.currentPageIndex >= 0 &&
    input.currentPageIndex < input.totalPageCount &&
    (input.readStatus === "unread" ||
      input.readStatus === "reading" ||
      input.readStatus === "completed") &&
    (input.spreadPageOffset === 0 || input.spreadPageOffset === 1)
  );
}

function isValidSaveInput(input: SaveReadingProgressInput): boolean {
  return (
    isValidTargetAndVolume(input.targetKey, input.volumeId) &&
    hasValidCoreValues(input)
  );
}

function isValidRecord(record: ReadingProgressRecord): boolean {
  return (
    isValidSaveInput(record) &&
    Number.isFinite(record.lastReadAt) &&
    Number.isFinite(record.updatedAt)
  );
}

export function compareTargetKeyAsc(a: string, b: string): number {
  if (a < b) {
    return -1;
  }
  if (a > b) {
    return 1;
  }
  return 0;
}

function toLocalReadingHistoryItem(
  record: ReadingProgressRecord,
): LocalReadingHistoryItem | null {
  const parsed = parseLocalProgressTargetKey(record.targetKey);
  if (
    parsed === null ||
    record.volumeId !== null ||
    !hasValidCoreValues(record) ||
    !Number.isFinite(record.lastReadAt) ||
    !Number.isFinite(record.updatedAt)
  ) {
    return null;
  }
  return {
    targetKey: record.targetKey,
    rawFileName: parsed.rawFileName,
    fileSize: parsed.fileSize,
    currentPageIndex: record.currentPageIndex,
    totalPageCount: record.totalPageCount,
    readStatus: record.readStatus,
    spreadPageOffset: record.spreadPageOffset,
    lastReadAt: record.lastReadAt,
  };
}

export class DexieReadingProgressRepository implements ReadingProgressRepository {
  private readonly database: ExLibrisDatabase;
  private readonly maxLocalEntries: number;
  private readonly now: () => number;
  private queue: Promise<void> = Promise.resolve();

  constructor(
    database: ExLibrisDatabase = db,
    options: DexieReadingProgressRepositoryOptions = {},
  ) {
    this.database = database;
    this.maxLocalEntries =
      options.maxLocalEntries ?? LOCAL_READING_PROGRESS_MAX_ENTRIES;
    this.now = options.now ?? Date.now;
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.queue.then(operation);
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  get(targetKey: string): Promise<ReadingProgressRecord | null> {
    return this.enqueue(async () => {
      const record = await this.database.readingProgress.get(targetKey);
      if (!record) {
        return null;
      }
      if (!isValidRecord(record)) {
        await this.database.readingProgress.delete(targetKey);
        return null;
      }
      return record;
    });
  }

  put(input: SaveReadingProgressInput): Promise<void> {
    return this.enqueue(async () => {
      if (!isValidSaveInput(input)) {
        return;
      }
      const timestamp = this.now();
      const record: ReadingProgressRecord = {
        targetKey: input.targetKey,
        volumeId: input.volumeId,
        currentPageIndex: input.currentPageIndex,
        totalPageCount: input.totalPageCount,
        readStatus: input.readStatus,
        spreadPageOffset: input.spreadPageOffset,
        lastReadAt: timestamp,
        updatedAt: timestamp,
      };

      await this.database.transaction(
        "rw",
        this.database.readingProgress,
        async () => {
          await this.database.readingProgress.put(record);
          if (record.targetKey.startsWith("local:")) {
            const localRecords = await this.database.readingProgress
              .where("targetKey")
              .startsWith("local:")
              .toArray();
            if (localRecords.length > this.maxLocalEntries) {
              const sorted = [...localRecords].sort((a, b) =>
                a.lastReadAt !== b.lastReadAt
                  ? a.lastReadAt - b.lastReadAt
                  : compareTargetKeyAsc(a.targetKey, b.targetKey),
              );
              const overflowCount = sorted.length - this.maxLocalEntries;
              const deleteKeys = sorted
                .slice(0, overflowCount)
                .map((item) => item.targetKey);
              await this.database.readingProgress.bulkDelete(deleteKeys);
            }
          }
        },
      );
    });
  }

  listByVolumeIds(
    volumeIds: ReadonlySet<string>,
  ): Promise<ReadonlyMap<string, ReadingProgressRecord>> {
    void volumeIds;
    return Promise.resolve(new Map());
  }

  listRecentLocal(
    limit = RECENT_LOCAL_HISTORY_DEFAULT_LIMIT,
  ): Promise<readonly LocalReadingHistoryItem[]> {
    return this.enqueue(async () => {
      if (!Number.isFinite(limit) || limit <= 0) {
        return [];
      }
      const records = await this.database.readingProgress
        .where("targetKey")
        .startsWith("local:")
        .toArray();

      const items: LocalReadingHistoryItem[] = [];
      for (const record of records) {
        const item = toLocalReadingHistoryItem(record);
        if (item !== null) {
          items.push(item);
        }
      }

      items.sort((a, b) =>
        a.lastReadAt !== b.lastReadAt
          ? b.lastReadAt - a.lastReadAt
          : compareTargetKeyAsc(a.targetKey, b.targetKey),
      );

      return items.slice(0, Math.floor(limit));
    });
  }

  delete(targetKey: string): Promise<void> {
    return this.enqueue(async () => {
      await this.database.readingProgress.delete(targetKey);
    });
  }

  clearLocal(): Promise<void> {
    return this.enqueue(async () => {
      await this.database.readingProgress
        .where("targetKey")
        .startsWith("local:")
        .delete();
    });
  }
}
