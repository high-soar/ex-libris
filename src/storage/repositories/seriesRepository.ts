import { ExLibrisDatabase, db } from "../db";
import type { SeriesRecord } from "../types";

export interface FindOrCreateSeriesInput {
  readonly title: string;
  readonly titleReading: string;
  readonly authors: readonly string[];
}

export interface SeriesRepository {
  getById(id: string): Promise<SeriesRecord | null>;
  listActive(): Promise<readonly SeriesRecord[]>;
  findOrCreateByParsedTitle(
    input: FindOrCreateSeriesInput,
  ): Promise<SeriesRecord>;
  mergeAuthorsIfUnlocked(
    seriesId: string,
    authors: readonly string[],
  ): Promise<SeriesRecord | null>;
  updateLastReadAt(
    seriesId: string,
    lastReadAt: number,
  ): Promise<SeriesRecord | null>;
}

export interface DexieSeriesRepositoryOptions {
  readonly now?: () => number;
  readonly idGenerator?: () => string;
}

export function isValidSeriesRecord(_record: SeriesRecord): boolean {
  throw new Error("Not implemented");
}

export class DexieSeriesRepository implements SeriesRepository {
  constructor(
    _database: ExLibrisDatabase = db,
    _options: DexieSeriesRepositoryOptions = {},
  ) {}

  getById(_id: string): Promise<SeriesRecord | null> {
    return Promise.reject(new Error("Not implemented"));
  }

  listActive(): Promise<readonly SeriesRecord[]> {
    return Promise.reject(new Error("Not implemented"));
  }

  findOrCreateByParsedTitle(
    _input: FindOrCreateSeriesInput,
  ): Promise<SeriesRecord> {
    return Promise.reject(new Error("Not implemented"));
  }

  mergeAuthorsIfUnlocked(
    _seriesId: string,
    _authors: readonly string[],
  ): Promise<SeriesRecord | null> {
    return Promise.reject(new Error("Not implemented"));
  }

  updateLastReadAt(
    _seriesId: string,
    _lastReadAt: number,
  ): Promise<SeriesRecord | null> {
    return Promise.reject(new Error("Not implemented"));
  }
}
