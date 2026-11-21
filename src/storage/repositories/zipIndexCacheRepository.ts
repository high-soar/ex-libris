import type { ZipPageEntry } from "../../engine/types";
import { ExLibrisDatabase, db } from "../db";

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

  async get(_cacheKey: string): Promise<readonly ZipPageEntry[] | null> {
    void this.database;
    void this.maxEntries;
    void this.now;
    return null;
  }

  async put(
    _cacheKey: string,
    _entries: readonly ZipPageEntry[],
  ): Promise<void> {
    return;
  }

  async delete(_cacheKey: string): Promise<void> {
    return;
  }
}
