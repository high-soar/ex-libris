import type { DriveSyncMetaRepository } from "../../storage/repositories/driveSyncMetaRepository";
import type { DriveSyncRootsRepository } from "../../storage/repositories/driveSyncRootsRepository";
import type { SeriesRepository } from "../../storage/repositories/seriesRepository";
import type { VolumesRepository } from "../../storage/repositories/volumesRepository";
import type { ZipIndexCacheRepository } from "../../storage/repositories/zipIndexCacheRepository";
import type {
  DriveSyncClient,
  DriveSyncEngine,
  DriveSyncOptions,
  DriveSyncResult,
} from "./types";

export interface DefaultDriveSyncEngineOptions {
  readonly driveSyncClient: DriveSyncClient;
  readonly driveSyncRootsRepo: DriveSyncRootsRepository;
  readonly driveSyncMetaRepo: DriveSyncMetaRepository;
  readonly seriesRepo: SeriesRepository;
  readonly volumesRepo: VolumesRepository;
  readonly zipIndexCacheRepo: ZipIndexCacheRepository;
  readonly now?: () => number;
  readonly maxParentBatchSize?: number;
  readonly maxAncestorDepth?: number;
}

export class DefaultDriveSyncEngine implements DriveSyncEngine {
  constructor(_options: DefaultDriveSyncEngineOptions) {
    void _options;
  }

  async sync(_options?: DriveSyncOptions): Promise<DriveSyncResult> {
    void _options;
    throw new Error("Not implemented");
  }
}
