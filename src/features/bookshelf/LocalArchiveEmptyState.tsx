import type { ReactNode } from "react";

export interface LocalArchiveEmptyStateProps {
  readonly isDragActive: boolean;
  readonly errorMessage: string | null;
  readonly onOpenLocalZip: () => void;
}

export function LocalArchiveEmptyState(
  _props: LocalArchiveEmptyStateProps,
): ReactNode {
  return null;
}
