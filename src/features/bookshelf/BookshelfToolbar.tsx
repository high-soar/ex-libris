import type { ReactNode } from "react";
import type { DriveSyncResult } from "../../providers/gdrive/types";
import type { BookshelfSortOrder } from "./bookshelfViewModel";

export interface BookshelfToolbarProps {
  readonly seriesCount: number;
  readonly totalVolumeCount: number;
  readonly sortOrder: BookshelfSortOrder;
  readonly lastSyncedAt: number | null;
  readonly lastSyncResult: DriveSyncResult | null;
  readonly syncErrorMessage: string | null;
  readonly onChangeSortOrder: (sortOrder: BookshelfSortOrder) => void;
}

export function BookshelfToolbar(_props: BookshelfToolbarProps): ReactNode {
  return null;
}
