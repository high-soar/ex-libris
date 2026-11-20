import Dexie, { type EntityTable } from "dexie";
import type { SyncMetaRecord } from "./types";

export class ExLibrisDatabase extends Dexie {
  syncMeta!: EntityTable<SyncMetaRecord, "key">;

  constructor(databaseName = "ExLibrisDB") {
    super(databaseName);
    this.version(1).stores({
      syncMeta: "key",
    });
  }
}

export const db = new ExLibrisDatabase();

export async function resetTestDb(
  targetDb: ExLibrisDatabase = db,
): Promise<void> {
  await Promise.all(targetDb.tables.map((table) => table.clear()));
}
