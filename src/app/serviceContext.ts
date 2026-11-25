import { createContext, useContext } from "react";
import type { AppBridge } from "../bridges/app/types";
import type { GoogleAuthBridge } from "../bridges/oauth/types";
import type {
  DriveFolderClient,
  DriveSyncClient,
  DriveSyncEngine,
} from "../providers/gdrive/types";
import type { DriveSyncMetaRepository } from "../storage/repositories/driveSyncMetaRepository";
import type { DriveSyncRootsRepository } from "../storage/repositories/driveSyncRootsRepository";
import type { ReaderSettingsRepository } from "../storage/repositories/readerSettingsRepository";
import type { ReadingProgressRepository } from "../storage/repositories/readingProgressRepository";
import type { SeriesRepository } from "../storage/repositories/seriesRepository";
import type { VolumesRepository } from "../storage/repositories/volumesRepository";
import type { ZipIndexCacheRepository } from "../storage/repositories/zipIndexCacheRepository";
import type { CoordinatorSessionHandle } from "./coordinatorClient";

export interface ServiceContextValue {
  readonly appBridge: AppBridge;
  readonly createCoordinatorSession: () => CoordinatorSessionHandle;
  readonly zipIndexCacheRepo: ZipIndexCacheRepository;
  readonly readingProgressRepo: ReadingProgressRepository;
  readonly readerSettingsRepo: ReaderSettingsRepository;
  readonly googleAuthBridge: GoogleAuthBridge;
  readonly driveSyncRootsRepo: DriveSyncRootsRepository;
  readonly driveFolderClient: DriveFolderClient;
  readonly seriesRepo: SeriesRepository;
  readonly volumesRepo: VolumesRepository;
  readonly driveSyncMetaRepo: DriveSyncMetaRepository;
  readonly driveSyncClient: DriveSyncClient;
  readonly driveSyncEngine: DriveSyncEngine;
}

export const ServiceContext = createContext<ServiceContextValue | null>(null);

export function useServices(): ServiceContextValue {
  const context = useContext(ServiceContext);
  if (!context) {
    throw new Error("useServices must be used within a ServiceProvider");
  }
  return context;
}
