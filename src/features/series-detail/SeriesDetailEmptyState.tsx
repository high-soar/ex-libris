import type { ReactNode } from "react";

export interface SeriesDetailEmptyStateProps {
  readonly onBack: () => void;
}

export function SeriesDetailEmptyState(
  _props: SeriesDetailEmptyStateProps,
): ReactNode {
  return null;
}
