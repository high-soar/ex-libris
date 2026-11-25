import { normalizeSeriesTitleKey } from "../../providers/filename/textNormalization";
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

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNullableFiniteNumber(value: unknown): value is number | null {
  return value === null || Number.isFinite(value);
}

export function isValidSeriesRecord(record: SeriesRecord): boolean {
  return (
    isNonEmptyString(record.id) &&
    isNonEmptyString(record.title) &&
    typeof record.titleReading === "string" &&
    isStringArray(record.authors) &&
    typeof record.publisher === "string" &&
    typeof record.label === "string" &&
    isStringArray(record.tags) &&
    typeof record.synopsis === "string" &&
    (record.publicationStatus === "ongoing" ||
      record.publicationStatus === "completed" ||
      record.publicationStatus === "unknown") &&
    (record.knownTotalVolumes === null ||
      (Number.isSafeInteger(record.knownTotalVolumes) &&
        record.knownTotalVolumes >= 0)) &&
    isPlainObject(record.externalIds) &&
    typeof record.metadataLocked === "boolean" &&
    (record.representativeVolumeId === null ||
      typeof record.representativeVolumeId === "string") &&
    (record.readerPresetJson === null ||
      typeof record.readerPresetJson === "string") &&
    isNullableFiniteNumber(record.lastReadAt) &&
    Number.isFinite(record.addedAt) &&
    Number.isFinite(record.updatedAt) &&
    isNullableFiniteNumber(record.deletedAt)
  );
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

export function compareSeriesAsc(a: SeriesRecord, b: SeriesRecord): number {
  if (a.addedAt !== b.addedAt) {
    return a.addedAt - b.addedAt;
  }
  return compareStringsAsc(a.id, b.id);
}

function normalizeUniqueStrings(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of values) {
    const trimmed = raw.trim();
    if (trimmed.length > 0 && !seen.has(trimmed)) {
      seen.add(trimmed);
      result.push(trimmed);
    }
  }
  return result;
}

function mergeUniqueStrings(
  existing: readonly string[],
  incoming: readonly string[],
): string[] {
  const seen = new Set(existing);
  const merged = [...existing];
  for (const item of incoming) {
    if (!seen.has(item)) {
      seen.add(item);
      merged.push(item);
    }
  }
  return merged;
}

export class DexieSeriesRepository implements SeriesRepository {
  private readonly database: ExLibrisDatabase;
  private readonly now: () => number;
  private readonly idGenerator: () => string;
  private queue: Promise<void> = Promise.resolve();

  constructor(
    database: ExLibrisDatabase = db,
    options: DexieSeriesRepositoryOptions = {},
  ) {
    this.database = database;
    this.now = options.now ?? Date.now;
    this.idGenerator = options.idGenerator ?? (() => crypto.randomUUID());
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.queue.then(operation);
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async loadValidRecords(): Promise<SeriesRecord[]> {
    const records = await this.database.series.toArray();
    const corruptKeys: string[] = [];
    const valid: SeriesRecord[] = [];
    for (const record of records) {
      if (!isValidSeriesRecord(record)) {
        corruptKeys.push(record.id);
        continue;
      }
      valid.push(record);
    }
    if (corruptKeys.length > 0) {
      await this.database.series.bulkDelete(corruptKeys);
    }
    return valid;
  }

  private async findActiveMutableSeries(
    normalizedId: string,
  ): Promise<SeriesRecord | null> {
    const existing = await this.database.series.get(normalizedId);
    if (!existing) {
      return null;
    }
    if (!isValidSeriesRecord(existing)) {
      await this.database.series.delete(normalizedId);
      return null;
    }
    if (existing.deletedAt !== null) {
      return null;
    }
    return existing;
  }

  getById(id: string): Promise<SeriesRecord | null> {
    return this.enqueue(async () => {
      const normalizedId = id.trim();
      if (normalizedId.length === 0) {
        return null;
      }
      const existing = await this.database.series.get(normalizedId);
      if (!existing) {
        return null;
      }
      if (!isValidSeriesRecord(existing)) {
        await this.database.series.delete(normalizedId);
        return null;
      }
      return existing;
    });
  }

  listActive(): Promise<readonly SeriesRecord[]> {
    return this.enqueue(async () => {
      const valid = await this.loadValidRecords();
      return valid
        .filter((record) => record.deletedAt === null)
        .sort(compareSeriesAsc);
    });
  }

  findOrCreateByParsedTitle(
    input: FindOrCreateSeriesInput,
  ): Promise<SeriesRecord> {
    return this.enqueue(async () => {
      const title = input.title.trim();
      if (title.length === 0) {
        throw new Error("title must not be empty");
      }
      const titleReading = input.titleReading.trim() || title;
      const incomingAuthors = normalizeUniqueStrings(input.authors);
      const targetKey = normalizeSeriesTitleKey(title);

      return this.database.transaction("rw", this.database.series, async () => {
        const valid = await this.loadValidRecords();
        const activeSorted = valid
          .filter((record) => record.deletedAt === null)
          .sort(compareSeriesAsc);

        const matched = activeSorted.find(
          (record) => normalizeSeriesTitleKey(record.title) === targetKey,
        );
        if (matched) {
          if (!matched.metadataLocked && incomingAuthors.length > 0) {
            const mergedAuthors = mergeUniqueStrings(
              matched.authors,
              incomingAuthors,
            );
            if (mergedAuthors.length > matched.authors.length) {
              const updated: SeriesRecord = {
                ...matched,
                authors: mergedAuthors,
              };
              await this.database.series.put(updated);
              return updated;
            }
          }
          return matched;
        }

        const timestamp = this.now();
        const created: SeriesRecord = {
          id: this.idGenerator(),
          title,
          titleReading,
          authors: incomingAuthors,
          publisher: "",
          label: "",
          tags: [],
          synopsis: "",
          publicationStatus: "unknown",
          knownTotalVolumes: null,
          externalIds: {},
          metadataLocked: false,
          representativeVolumeId: null,
          readerPresetJson: null,
          lastReadAt: null,
          addedAt: timestamp,
          updatedAt: timestamp,
          deletedAt: null,
        };
        await this.database.series.put(created);
        return created;
      });
    });
  }

  mergeAuthorsIfUnlocked(
    seriesId: string,
    authors: readonly string[],
  ): Promise<SeriesRecord | null> {
    return this.enqueue(async () => {
      const normalizedId = seriesId.trim();
      if (normalizedId.length === 0) {
        return null;
      }
      const incomingAuthors = normalizeUniqueStrings(authors);

      return this.database.transaction("rw", this.database.series, async () => {
        const existing = await this.findActiveMutableSeries(normalizedId);
        if (existing === null) {
          return null;
        }
        if (existing.metadataLocked || incomingAuthors.length === 0) {
          return existing;
        }
        const mergedAuthors = mergeUniqueStrings(
          existing.authors,
          incomingAuthors,
        );
        if (mergedAuthors.length === existing.authors.length) {
          return existing;
        }
        const updated: SeriesRecord = {
          ...existing,
          authors: mergedAuthors,
        };
        await this.database.series.put(updated);
        return updated;
      });
    });
  }

  updateLastReadAt(
    seriesId: string,
    lastReadAt: number,
  ): Promise<SeriesRecord | null> {
    return this.enqueue(async () => {
      const normalizedId = seriesId.trim();
      if (normalizedId.length === 0 || !Number.isFinite(lastReadAt)) {
        return null;
      }

      return this.database.transaction("rw", this.database.series, async () => {
        const existing = await this.findActiveMutableSeries(normalizedId);
        if (existing === null) {
          return null;
        }
        const updated: SeriesRecord = {
          ...existing,
          lastReadAt,
        };
        await this.database.series.put(updated);
        return updated;
      });
    });
  }
}
