import type { ZipPageEntry } from "../../engine/types";
import { validateZipIndexEntries } from "../../engine/zip/zipIndexValidation";
import { ExLibrisDatabase, db } from "../db";
import type { ZipIndexCacheRecord } from "../types";

export const ZIP_INDEX_CACHE_MAX_ENTRIES = 500;

export interface ZipIndexCacheRepository {
  get(cacheKey: string): Promise<readonly ZipPageEntry[] | null>;
  put(cacheKey: string, entries: readonly ZipPageEntry[]): Promise<void>;
  delete(cacheKey: string): Promise<void>;
}

export interface DexieZipIndexCacheRepositoryOptions {
  readonly maxEntries?: number;
  readonly now?: () => number;
}

export class DexieZipIndexCacheRepository implements ZipIndexCacheRepository {
  private readonly database: ExLibrisDatabase;
  private readonly maxEntries: number;
  private readonly now: () => number;

  constructor(
    database: ExLibrisDatabase = db,
    options: DexieZipIndexCacheRepositoryOptions = {},
  ) {
    this.database = database;
    this.maxEntries = options.maxEntries ?? ZIP_INDEX_CACHE_MAX_ENTRIES;
    this.now = options.now ?? Date.now;
  }

  async get(cacheKey: string): Promise<readonly ZipPageEntry[] | null> {
    const record = await this.database.zipIndexCache.get(cacheKey);
    if (!record) {
      return null;
    }

    if (
      typeof record.pageCount !== "number" ||
      !Number.isInteger(record.pageCount) ||
      record.pageCount <= 0 ||
      !validateZipIndexEntries(record.entries, record.pageCount)
    ) {
      await this.database.zipIndexCache.delete(cacheKey);
      return null;
    }

    await this.database.zipIndexCache.update(cacheKey, {
      cachedAt: this.now(),
    });
    return record.entries;
  }

  async put(cacheKey: string, entries: readonly ZipPageEntry[]): Promise<void> {
    if (!validateZipIndexEntries(entries)) {
      return;
    }

    const record: ZipIndexCacheRecord = {
      cacheKey,
      pageCount: entries.length,
      entries: [...entries],
      cachedAt: this.now(),
    };

    await this.database.transaction(
      "rw",
      this.database.zipIndexCache,
      async () => {
        await this.database.zipIndexCache.put(record);
        const count = await this.database.zipIndexCache.count();
        if (count > this.maxEntries) {
          const oldestKeys = await this.database.zipIndexCache
            .orderBy("cachedAt")
            .limit(count - this.maxEntries)
            .primaryKeys();
          await this.database.zipIndexCache.bulkDelete(oldestKeys);
        }
      },
    );
  }

  async delete(cacheKey: string): Promise<void> {
    await this.database.zipIndexCache.delete(cacheKey);
  }
}
