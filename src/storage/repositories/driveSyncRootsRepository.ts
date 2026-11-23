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

export function isValidDriveSyncRootRecord(
  record: DriveSyncRootRecord,
): boolean {
  return (
    typeof record.folderId === "string" &&
    record.folderId.trim().length > 0 &&
    typeof record.folderName === "string" &&
    record.folderName.trim().length > 0 &&
    (record.enabled === 0 || record.enabled === 1) &&
    Number.isFinite(record.addedAt) &&
    Number.isFinite(record.updatedAt) &&
    (record.deletedAt === null || Number.isFinite(record.deletedAt))
  );
}

export function compareDriveSyncRootsAsc(
  a: DriveSyncRootRecord,
  b: DriveSyncRootRecord,
): number {
  if (a.addedAt !== b.addedAt) {
    return a.addedAt - b.addedAt;
  }
  if (a.folderId < b.folderId) {
    return -1;
  }
  if (a.folderId > b.folderId) {
    return 1;
  }
  return 0;
}

export class DexieDriveSyncRootsRepository implements DriveSyncRootsRepository {
  private readonly database: ExLibrisDatabase;
  private readonly now: () => number;
  private queue: Promise<void> = Promise.resolve();

  constructor(
    database: ExLibrisDatabase = db,
    options: DexieDriveSyncRootsRepositoryOptions = {},
  ) {
    this.database = database;
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

  private async loadValidRecords(): Promise<DriveSyncRootRecord[]> {
    const records = await this.database.driveSyncRoots.toArray();
    const corruptKeys: string[] = [];
    const valid: DriveSyncRootRecord[] = [];
    for (const record of records) {
      if (!isValidDriveSyncRootRecord(record)) {
        corruptKeys.push(record.folderId);
        continue;
      }
      valid.push(record);
    }
    if (corruptKeys.length > 0) {
      await this.database.driveSyncRoots.bulkDelete(corruptKeys);
    }
    return valid;
  }

  private async findActiveMutableRoot(
    normalizedId: string,
  ): Promise<DriveSyncRootRecord | null> {
    const existing = await this.database.driveSyncRoots.get(normalizedId);
    if (!existing) {
      return null;
    }
    if (!isValidDriveSyncRootRecord(existing)) {
      await this.database.driveSyncRoots.delete(normalizedId);
      return null;
    }
    if (existing.deletedAt !== null) {
      return null;
    }
    return existing;
  }

  listActive(): Promise<readonly DriveSyncRootRecord[]> {
    return this.enqueue(async () => {
      const valid = await this.loadValidRecords();
      return valid
        .filter((record) => record.deletedAt === null)
        .sort(compareDriveSyncRootsAsc);
    });
  }

  countEnabled(): Promise<number> {
    return this.enqueue(async () => {
      const valid = await this.loadValidRecords();
      let count = 0;
      for (const record of valid) {
        if (record.deletedAt === null && record.enabled === 1) {
          count += 1;
        }
      }
      return count;
    });
  }

  upsertRoot(input: UpsertDriveSyncRootInput): Promise<DriveSyncRootRecord> {
    return this.enqueue(async () => {
      const folderId = input.folderId.trim();
      const folderName = input.folderName.trim();
      if (folderId.length === 0 || folderName.length === 0) {
        throw new Error("folderId and folderName must not be empty");
      }

      return this.database.transaction(
        "rw",
        this.database.driveSyncRoots,
        async () => {
          const existing = await this.database.driveSyncRoots.get(folderId);
          const validExisting =
            existing && isValidDriveSyncRootRecord(existing) ? existing : null;
          const timestamp = this.now();
          const nextRecord: DriveSyncRootRecord = {
            folderId,
            folderName,
            enabled: 1,
            addedAt: validExisting !== null ? validExisting.addedAt : timestamp,
            updatedAt: timestamp,
            deletedAt: null,
          };
          await this.database.driveSyncRoots.put(nextRecord);
          return nextRecord;
        },
      );
    });
  }

  setEnabled(
    folderId: string,
    enabled: boolean,
  ): Promise<DriveSyncRootRecord | null> {
    return this.enqueue(async () => {
      const normalizedId = folderId.trim();
      if (normalizedId.length === 0) {
        return null;
      }

      return this.database.transaction(
        "rw",
        this.database.driveSyncRoots,
        async () => {
          const existing = await this.findActiveMutableRoot(normalizedId);
          if (existing === null) {
            return null;
          }
          const updated: DriveSyncRootRecord = {
            ...existing,
            enabled: enabled ? 1 : 0,
            updatedAt: this.now(),
          };
          await this.database.driveSyncRoots.put(updated);
          return updated;
        },
      );
    });
  }

  removeRoot(folderId: string): Promise<void> {
    return this.enqueue(async () => {
      const normalizedId = folderId.trim();
      if (normalizedId.length === 0) {
        return;
      }

      await this.database.transaction(
        "rw",
        this.database.driveSyncRoots,
        async () => {
          const existing = await this.findActiveMutableRoot(normalizedId);
          if (existing === null) {
            return;
          }
          const timestamp = this.now();
          await this.database.driveSyncRoots.put({
            ...existing,
            enabled: 0,
            updatedAt: timestamp,
            deletedAt: timestamp,
          });
        },
      );
    });
  }
}
