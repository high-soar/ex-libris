import { create } from "zustand";
import type { DiagnosticLogger } from "../../diagnostics/types";
import type {
  DriveSyncEngine,
  DriveSyncResult,
} from "../../providers/gdrive/types";
import type { DriveSyncMetaRepository } from "../../storage/repositories/driveSyncMetaRepository";

export type DriveSyncUiPhase = "idle" | "syncing" | "completed" | "error";
export type DriveSyncActiveMode = "incremental" | "full";

export interface RunDriveSyncParams {
  readonly driveSyncEngine: DriveSyncEngine;
  readonly forceFullScan?: boolean;
  readonly logger?: DiagnosticLogger;
}

export interface DriveSyncState {
  readonly phase: DriveSyncUiPhase;
  readonly activeMode: DriveSyncActiveMode | null;
  readonly lastSyncedAt: number | null;
  readonly isLastSyncedAtLoaded: boolean;
  readonly lastResult: DriveSyncResult | null;
  readonly errorMessage: string | null;
  readonly completedSyncCount: number;
  readonly hydrateLastSyncedAt: (
    driveSyncMetaRepo: Pick<DriveSyncMetaRepository, "getSyncState">,
    logger?: DiagnosticLogger,
  ) => Promise<void>;
  readonly runDriveSync: (
    params: RunDriveSyncParams,
  ) => Promise<DriveSyncResult | null>;
}

const INITIAL_DRIVE_SYNC_STATE = {
  phase: "idle" as DriveSyncUiPhase,
  activeMode: null as DriveSyncActiveMode | null,
  lastSyncedAt: null as number | null,
  isLastSyncedAtLoaded: false,
  lastResult: null as DriveSyncResult | null,
  errorMessage: null as string | null,
  completedSyncCount: 0,
};

export function formatDriveSyncErrorMessage(error: unknown): string {
  void error;
  return "";
}

export const useDriveSyncStateStore = create<DriveSyncState>(() => ({
  ...INITIAL_DRIVE_SYNC_STATE,
  hydrateLastSyncedAt: async (driveSyncMetaRepo, logger) => {
    void driveSyncMetaRepo;
    void logger;
  },
  runDriveSync: async (params) => {
    void params;
    return null;
  },
}));

export function resetDriveSyncState(): void {
  useDriveSyncStateStore.setState({ ...INITIAL_DRIVE_SYNC_STATE });
}
