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
}

export interface DexieVolumesRepositoryOptions {
  readonly now?: () => number;
  readonly idGenerator?: () => string;
}

export function isValidVolumeRecord(_record: VolumeRecord): boolean {
  throw new Error("Not implemented");
}

export function compareVolumesForDisplay(
  _a: VolumeRecord,
  _b: VolumeRecord,
): number {
  throw new Error("Not implemented");
}

export class DexieVolumesRepository implements VolumesRepository {
  constructor(
    _database: ExLibrisDatabase = db,
    _options: DexieVolumesRepositoryOptions = {},
  ) {}

  getById(_id: string): Promise<VolumeRecord | null> {
    return Promise.reject(new Error("Not implemented"));
  }

  getByDriveFileId(_driveFileId: string): Promise<VolumeRecord | null> {
    return Promise.reject(new Error("Not implemented"));
  }

  listBySeriesId(_seriesId: string): Promise<readonly VolumeRecord[]> {
    return Promise.reject(new Error("Not implemented"));
  }

  listVisibleByEnabledRoots(
    _enabledRootIds: ReadonlySet<string>,
  ): Promise<readonly VolumeRecord[]> {
    return Promise.reject(new Error("Not implemented"));
  }

  listByRootFolderIds(
    _rootFolderIds: ReadonlySet<string>,
  ): Promise<readonly VolumeRecord[]> {
    return Promise.reject(new Error("Not implemented"));
  }

  upsertFromDriveSync(
    _input: UpsertVolumeFromDriveSyncInput,
  ): Promise<UpsertVolumeFromDriveSyncResult> {
    return Promise.reject(new Error("Not implemented"));
  }

  markTrashedByDriveFileIds(_driveFileIds: readonly string[]): Promise<number> {
    return Promise.reject(new Error("Not implemented"));
  }
}
