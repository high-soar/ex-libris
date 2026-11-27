import { ExLibrisDatabase, db } from "../db";
import type { VolumeRecord } from "../types";

export interface UpsertVolumeFromDriveSyncInput {
  readonly seriesId: string;
  readonly volumeNumber: number | null;
  readonly volumeLabel: string;
  readonly rawFileName: string;
  readonly driveFileId: string;
  readonly parentFolderId: string | null;
  readonly rootFolderId: string;
  readonly fileSize: number;
  readonly md5Checksum: string | null;
  readonly driveModifiedTime: number;
  readonly isTrashed?: 0 | 1;
}

export interface UpsertVolumeFromDriveSyncResult {
  readonly volume: VolumeRecord;
  readonly created: boolean;
  readonly invalidatedCacheKey: string | null;
}

export interface SaveCoverReadyInput {
  readonly volumeId: string;
  readonly expectedMd5Checksum: string | null;
  readonly expectedFileSize: number;
  readonly coverBlob: Blob;
  readonly coverUpdatedAt?: number;
}

export interface SaveCoverErrorInput {
  readonly volumeId: string;
  readonly expectedMd5Checksum: string | null;
  readonly expectedFileSize: number;
  readonly coverUpdatedAt?: number;
}

export interface ResetErrorCoversToPendingInput {
  readonly enabledRootIds: ReadonlySet<string>;
  readonly seriesId?: string;
}

export interface VolumesRepository {
  getById(id: string): Promise<VolumeRecord | null>;
  getByDriveFileId(driveFileId: string): Promise<VolumeRecord | null>;
  listBySeriesId(seriesId: string): Promise<readonly VolumeRecord[]>;
  listVisibleByEnabledRoots(
    enabledRootIds: ReadonlySet<string>,
  ): Promise<readonly VolumeRecord[]>;
  listByRootFolderIds(
    rootFolderIds: ReadonlySet<string>,
  ): Promise<readonly VolumeRecord[]>;
  upsertFromDriveSync(
    input: UpsertVolumeFromDriveSyncInput,
  ): Promise<UpsertVolumeFromDriveSyncResult>;
  markTrashedByDriveFileIds(driveFileIds: readonly string[]): Promise<number>;
  saveCoverReady(input: SaveCoverReadyInput): Promise<VolumeRecord | null>;
  saveCoverError(input: SaveCoverErrorInput): Promise<VolumeRecord | null>;
  resetErrorCoversToPending(
    input: ResetErrorCoversToPendingInput,
  ): Promise<readonly VolumeRecord[]>;
}

export interface DexieVolumesRepositoryOptions {
  readonly now?: () => number;
  readonly idGenerator?: () => string;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isBlobLike(value: unknown): value is Blob {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

export function isValidVolumeRecord(record: VolumeRecord): boolean {
  return (
    isNonEmptyString(record.id) &&
    isNonEmptyString(record.seriesId) &&
    (record.volumeNumber === null ||
      (Number.isFinite(record.volumeNumber) && record.volumeNumber >= 0)) &&
    typeof record.volumeLabel === "string" &&
    isNonEmptyString(record.rawFileName) &&
    isNonEmptyString(record.driveFileId) &&
    (record.parentFolderId === null ||
      isNonEmptyString(record.parentFolderId)) &&
    isNonEmptyString(record.rootFolderId) &&
    Number.isSafeInteger(record.fileSize) &&
    record.fileSize >= 0 &&
    (record.md5Checksum === null || isNonEmptyString(record.md5Checksum)) &&
    Number.isFinite(record.driveModifiedTime) &&
    (record.coverBlob === null || isBlobLike(record.coverBlob)) &&
    (record.coverStatus === "pending" ||
      record.coverStatus === "ready" ||
      record.coverStatus === "error") &&
    (record.coverCropMode === "auto" ||
      record.coverCropMode === "full" ||
      record.coverCropMode === "left-half" ||
      record.coverCropMode === "right-half") &&
    Number.isSafeInteger(record.coverPageIndex) &&
    record.coverPageIndex >= 0 &&
    (record.coverUpdatedAt === null ||
      Number.isFinite(record.coverUpdatedAt)) &&
    (record.isTrashed === 0 || record.isTrashed === 1) &&
    Number.isFinite(record.addedAt) &&
    Number.isFinite(record.updatedAt)
  );
}

export function compareVolumesForDisplay(
  a: VolumeRecord,
  b: VolumeRecord,
): number {
  if (a.volumeNumber !== b.volumeNumber) {
    if (a.volumeNumber === null) {
      return 1;
    }
    if (b.volumeNumber === null) {
      return -1;
    }
    return a.volumeNumber - b.volumeNumber;
  }

  const aOmnibus = a.volumeLabel.includes("合本");
  const bOmnibus = b.volumeLabel.includes("合本");
  if (aOmnibus !== bOmnibus) {
    return aOmnibus ? 1 : -1;
  }

  const labelDiff = compareStringsAsc(a.volumeLabel, b.volumeLabel);
  if (labelDiff !== 0) {
    return labelDiff;
  }

  const fileDiff = compareStringsAsc(a.rawFileName, b.rawFileName);
  if (fileDiff !== 0) {
    return fileDiff;
  }

  return compareStringsAsc(a.id, b.id);
}

function normalizeNullableString(value: string | null): string | null {
  if (value === null) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export class DexieVolumesRepository implements VolumesRepository {
  private readonly database: ExLibrisDatabase;
  private readonly now: () => number;
  private readonly idGenerator: () => string;
  private queue: Promise<void> = Promise.resolve();

  constructor(
    database: ExLibrisDatabase = db,
    options: DexieVolumesRepositoryOptions = {},
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

  private async filterAndPurgeCorrupt(
    records: readonly VolumeRecord[],
  ): Promise<VolumeRecord[]> {
    const corruptKeys: string[] = [];
    const valid: VolumeRecord[] = [];
    for (const record of records) {
      if (!isValidVolumeRecord(record)) {
        corruptKeys.push(record.id);
        continue;
      }
      valid.push(record);
    }
    if (corruptKeys.length > 0) {
      await this.database.volumes.bulkDelete(corruptKeys);
    }
    return valid;
  }

  getById(id: string): Promise<VolumeRecord | null> {
    return this.enqueue(async () => {
      const normalizedId = id.trim();
      if (normalizedId.length === 0) {
        return null;
      }
      const existing = await this.database.volumes.get(normalizedId);
      if (!existing) {
        return null;
      }
      if (!isValidVolumeRecord(existing)) {
        await this.database.volumes.delete(normalizedId);
        return null;
      }
      return existing;
    });
  }

  getByDriveFileId(driveFileId: string): Promise<VolumeRecord | null> {
    return this.enqueue(async () => {
      const normalizedId = driveFileId.trim();
      if (normalizedId.length === 0) {
        return null;
      }
      const existing = await this.database.volumes
        .where("driveFileId")
        .equals(normalizedId)
        .first();
      if (!existing) {
        return null;
      }
      if (!isValidVolumeRecord(existing)) {
        await this.database.volumes.delete(existing.id);
        return null;
      }
      return existing;
    });
  }

  listBySeriesId(seriesId: string): Promise<readonly VolumeRecord[]> {
    return this.enqueue(async () => {
      const normalizedId = seriesId.trim();
      if (normalizedId.length === 0) {
        return [];
      }
      const records = await this.database.volumes
        .where("seriesId")
        .equals(normalizedId)
        .toArray();
      const valid = await this.filterAndPurgeCorrupt(records);
      return valid
        .filter((record) => record.isTrashed === 0)
        .sort(compareVolumesForDisplay);
    });
  }

  listVisibleByEnabledRoots(
    enabledRootIds: ReadonlySet<string>,
  ): Promise<readonly VolumeRecord[]> {
    return this.enqueue(async () => {
      if (enabledRootIds.size === 0) {
        return [];
      }
      const records = await this.database.volumes.toArray();
      const valid = await this.filterAndPurgeCorrupt(records);
      return valid
        .filter(
          (record) =>
            enabledRootIds.has(record.rootFolderId) && record.isTrashed === 0,
        )
        .sort(compareVolumesForDisplay);
    });
  }

  listByRootFolderIds(
    rootFolderIds: ReadonlySet<string>,
  ): Promise<readonly VolumeRecord[]> {
    return this.enqueue(async () => {
      if (rootFolderIds.size === 0) {
        return [];
      }
      const records = await this.database.volumes.toArray();
      const valid = await this.filterAndPurgeCorrupt(records);
      return valid
        .filter((record) => rootFolderIds.has(record.rootFolderId))
        .sort(compareVolumesForDisplay);
    });
  }

  upsertFromDriveSync(
    input: UpsertVolumeFromDriveSyncInput,
  ): Promise<UpsertVolumeFromDriveSyncResult> {
    return this.enqueue(async () => {
      const seriesId = input.seriesId.trim();
      const rawFileName = input.rawFileName.trim();
      const driveFileId = input.driveFileId.trim();
      const rootFolderId = input.rootFolderId.trim();
      if (
        seriesId.length === 0 ||
        rawFileName.length === 0 ||
        driveFileId.length === 0 ||
        rootFolderId.length === 0
      ) {
        throw new Error(
          "seriesId, rawFileName, driveFileId, and rootFolderId must not be empty",
        );
      }
      if (
        input.volumeNumber !== null &&
        (!Number.isFinite(input.volumeNumber) || input.volumeNumber < 0)
      ) {
        throw new Error(
          "volumeNumber must be null or a non-negative finite number",
        );
      }
      if (!Number.isSafeInteger(input.fileSize) || input.fileSize < 0) {
        throw new Error("fileSize must be a non-negative safe integer");
      }
      if (!Number.isFinite(input.driveModifiedTime)) {
        throw new Error("driveModifiedTime must be a finite number");
      }

      const parentFolderId = normalizeNullableString(input.parentFolderId);
      const md5Checksum = normalizeNullableString(input.md5Checksum);
      const isTrashed: 0 | 1 = input.isTrashed ?? 0;

      return this.database.transaction(
        "rw",
        this.database.volumes,
        async () => {
          const existingRaw = await this.database.volumes
            .where("driveFileId")
            .equals(driveFileId)
            .first();
          let existing: VolumeRecord | null = null;
          if (existingRaw) {
            if (isValidVolumeRecord(existingRaw)) {
              existing = existingRaw;
            } else {
              await this.database.volumes.delete(existingRaw.id);
            }
          }

          if (existing !== null) {
            const binaryChanged =
              existing.md5Checksum !== md5Checksum ||
              existing.fileSize !== input.fileSize;
            const invalidatedCacheKey = binaryChanged
              ? `gdrive:${driveFileId}:${existing.md5Checksum ?? existing.fileSize}`
              : null;

            const updated: VolumeRecord = {
              ...existing,
              seriesId,
              volumeNumber: input.volumeNumber,
              volumeLabel: input.volumeLabel,
              rawFileName,
              driveFileId,
              parentFolderId,
              rootFolderId,
              fileSize: input.fileSize,
              md5Checksum,
              driveModifiedTime: input.driveModifiedTime,
              coverBlob: binaryChanged ? null : existing.coverBlob,
              coverStatus: binaryChanged ? "pending" : existing.coverStatus,
              coverUpdatedAt: binaryChanged ? null : existing.coverUpdatedAt,
              isTrashed,
            };
            await this.database.volumes.put(updated);
            return {
              volume: updated,
              created: false,
              invalidatedCacheKey,
            };
          }

          const timestamp = this.now();
          const created: VolumeRecord = {
            id: this.idGenerator(),
            seriesId,
            volumeNumber: input.volumeNumber,
            volumeLabel: input.volumeLabel,
            rawFileName,
            driveFileId,
            parentFolderId,
            rootFolderId,
            fileSize: input.fileSize,
            md5Checksum,
            driveModifiedTime: input.driveModifiedTime,
            coverBlob: null,
            coverStatus: "pending",
            coverCropMode: "auto",
            coverPageIndex: 0,
            coverUpdatedAt: null,
            isTrashed,
            addedAt: timestamp,
            updatedAt: timestamp,
          };
          await this.database.volumes.put(created);
          return {
            volume: created,
            created: true,
            invalidatedCacheKey: null,
          };
        },
      );
    });
  }

  markTrashedByDriveFileIds(driveFileIds: readonly string[]): Promise<number> {
    return this.enqueue(async () => {
      const uniqueIds = new Set<string>();
      for (const rawId of driveFileIds) {
        const trimmed = rawId.trim();
        if (trimmed.length > 0) {
          uniqueIds.add(trimmed);
        }
      }
      if (uniqueIds.size === 0) {
        return 0;
      }

      return this.database.transaction(
        "rw",
        this.database.volumes,
        async () => {
          let updatedCount = 0;
          for (const driveFileId of uniqueIds) {
            const existing = await this.database.volumes
              .where("driveFileId")
              .equals(driveFileId)
              .first();
            if (!existing) {
              continue;
            }
            if (!isValidVolumeRecord(existing)) {
              await this.database.volumes.delete(existing.id);
              continue;
            }
            if (existing.isTrashed === 1) {
              continue;
            }
            await this.database.volumes.put({
              ...existing,
              isTrashed: 1,
            });
            updatedCount += 1;
          }
          return updatedCount;
        },
      );
    });
  }

  private updateCoverWithGuard(
    volumeId: string,
    expectedMd5Checksum: string | null,
    expectedFileSize: number,
    coverStatus: "ready" | "error",
    coverBlob: Blob | null,
    coverUpdatedAt?: number,
  ): Promise<VolumeRecord | null> {
    return this.enqueue(async () => {
      const normalizedId = volumeId.trim();
      if (normalizedId.length === 0) {
        return null;
      }
      const normalizedExpectedMd5 =
        normalizeNullableString(expectedMd5Checksum);

      return this.database.transaction(
        "rw",
        this.database.volumes,
        async () => {
          const existing = await this.database.volumes.get(normalizedId);
          if (!existing) {
            return null;
          }
          if (!isValidVolumeRecord(existing)) {
            await this.database.volumes.delete(normalizedId);
            return null;
          }
          if (
            existing.isTrashed !== 0 ||
            existing.md5Checksum !== normalizedExpectedMd5 ||
            existing.fileSize !== expectedFileSize
          ) {
            return null;
          }

          const updated: VolumeRecord = {
            ...existing,
            coverBlob,
            coverStatus,
            coverUpdatedAt: coverUpdatedAt ?? this.now(),
          };
          await this.database.volumes.put(updated);
          return updated;
        },
      );
    });
  }

  saveCoverReady(input: SaveCoverReadyInput): Promise<VolumeRecord | null> {
    return this.updateCoverWithGuard(
      input.volumeId,
      input.expectedMd5Checksum,
      input.expectedFileSize,
      "ready",
      input.coverBlob,
      input.coverUpdatedAt,
    );
  }

  saveCoverError(input: SaveCoverErrorInput): Promise<VolumeRecord | null> {
    return this.updateCoverWithGuard(
      input.volumeId,
      input.expectedMd5Checksum,
      input.expectedFileSize,
      "error",
      null,
      input.coverUpdatedAt,
    );
  }

  resetErrorCoversToPending(
    input: ResetErrorCoversToPendingInput,
  ): Promise<readonly VolumeRecord[]> {
    return this.enqueue(async () => {
      if (input.enabledRootIds.size === 0) {
        return [];
      }
      let normalizedSeriesId: string | null = null;
      if (input.seriesId !== undefined) {
        normalizedSeriesId = input.seriesId.trim();
        if (normalizedSeriesId.length === 0) {
          return [];
        }
      }

      return this.database.transaction(
        "rw",
        this.database.volumes,
        async () => {
          const records = await this.database.volumes.toArray();
          const valid = await this.filterAndPurgeCorrupt(records);
          const targets = valid
            .filter(
              (record) =>
                record.isTrashed === 0 &&
                input.enabledRootIds.has(record.rootFolderId) &&
                record.coverStatus === "error" &&
                (normalizedSeriesId === null ||
                  record.seriesId === normalizedSeriesId),
            )
            .sort(compareVolumesForDisplay);

          if (targets.length === 0) {
            return [];
          }

          const updated: VolumeRecord[] = targets.map((record) => ({
            ...record,
            coverBlob: null,
            coverStatus: "pending",
            coverUpdatedAt: null,
          }));
          await this.database.volumes.bulkPut(updated);
          return updated;
        },
      );
    });
  }
}
