import { ExLibrisDatabase, db } from "../db";
import type { DriveSyncRootRecord } from "../types";

export interface UpsertDriveSyncRootInput {
  readonly folderId: string;
  readonly folderName: string;
}

export interface DriveSyncRootsRepository {
  listActive(): Promise<readonly DriveSyncRootRecord[]>;
  countEnabled(): Promise<number>;
  upsertRoot(input: UpsertDriveSyncRootInput): Promise<DriveSyncRootRecord>;
  setEnabled(
    folderId: string,
    enabled: boolean,
  ): Promise<DriveSyncRootRecord | null>;
  removeRoot(folderId: string): Promise<void>;
}

export interface DexieDriveSyncRootsRepositoryOptions {
  readonly now?: () => number;
}

export class DexieDriveSyncRootsRepository implements DriveSyncRootsRepository {
  constructor(
    _database: ExLibrisDatabase = db,
    _options: DexieDriveSyncRootsRepositoryOptions = {},
  ) {}

  async listActive(): Promise<readonly DriveSyncRootRecord[]> {
    throw new Error("Not implemented");
  }

  async countEnabled(): Promise<number> {
    throw new Error("Not implemented");
  }

  async upsertRoot(
    _input: UpsertDriveSyncRootInput,
  ): Promise<DriveSyncRootRecord> {
    throw new Error("Not implemented");
  }

  async setEnabled(
    _folderId: string,
    _enabled: boolean,
  ): Promise<DriveSyncRootRecord | null> {
    throw new Error("Not implemented");
  }

  async removeRoot(_folderId: string): Promise<void> {
    throw new Error("Not implemented");
  }
}
