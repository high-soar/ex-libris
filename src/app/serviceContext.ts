import { createContext, useContext } from "react";
import type { AppBridge } from "../bridges/app/types";
import type { GoogleAuthBridge } from "../bridges/oauth/types";
import type { DriveFolderClient } from "../providers/gdrive/types";
import type { DriveSyncRootsRepository } from "../storage/repositories/driveSyncRootsRepository";
import type { ReaderSettingsRepository } from "../storage/repositories/readerSettingsRepository";
import type { ReadingProgressRepository } from "../storage/repositories/readingProgressRepository";
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
}

export const ServiceContext = createContext<ServiceContextValue | null>(null);

export function useServices(): ServiceContextValue {
  const context = useContext(ServiceContext);
  if (!context) {
    throw new Error("useServices must be used within a ServiceProvider");
  }
  return context;
}
