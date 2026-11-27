import type { ReactNode } from "react";
import type { CoverExtractionProgressSnapshot } from "../../engine/cover/types";
import type { DriveSyncUiPhase } from "../../shared/sync/driveSyncStateStore";
import type { GoogleAccountAuthStatus } from "./types";

export interface CoverExtractionSectionProps {
  readonly authStatus: GoogleAccountAuthStatus;
  readonly enabledRootCount: number;
  readonly syncPhase: DriveSyncUiPhase;
  readonly isBackBlocked: boolean;
  readonly extractionState: CoverExtractionProgressSnapshot;
  readonly onRetryFailedCovers: () => void;
}

export function CoverExtractionSection(
  _props: CoverExtractionSectionProps,
): ReactNode {
  return null;
}
