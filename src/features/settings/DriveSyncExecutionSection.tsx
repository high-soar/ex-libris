import type { ReactNode } from "react";
import type { DriveSyncResult } from "../../providers/gdrive/types";
import type {
  DriveSyncActiveMode,
  DriveSyncUiPhase,
} from "../../shared/sync/driveSyncStateStore";
import type { GoogleAccountAuthStatus } from "./types";

export interface DriveSyncExecutionSectionProps {
  readonly authStatus: GoogleAccountAuthStatus;
  readonly enabledRootCount: number;
  readonly syncPhase: DriveSyncUiPhase;
  readonly activeMode: DriveSyncActiveMode | null;
  readonly lastSyncedAt: number | null;
  readonly lastResult: DriveSyncResult | null;
  readonly errorMessage: string | null;
  readonly isBackBlocked: boolean;
  readonly onRunIncrementalSync: () => void;
  readonly onRunFullScan: () => void;
}

export function DriveSyncExecutionSection(
  _props: DriveSyncExecutionSectionProps,
): ReactNode {
  return null;
}
