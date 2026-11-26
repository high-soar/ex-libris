import type { ReactNode } from "react";

export interface DriveSyncEmptyStateProps {
  readonly isSyncing: boolean;
  readonly isDragActive: boolean;
  readonly onSyncDrive: () => void;
  readonly onOpenLocalZip: () => void;
}

export function DriveSyncEmptyState(
  _props: DriveSyncEmptyStateProps,
): ReactNode {
  return null;
}
