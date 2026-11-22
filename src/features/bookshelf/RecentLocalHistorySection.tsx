import type { ReactNode } from "react";
import type { LocalReadingHistoryItem } from "../../storage/repositories/readingProgressRepository";

export interface RecentLocalHistorySectionProps {
  readonly items: readonly LocalReadingHistoryItem[];
  readonly onReopenLocalFile: () => void;
  readonly onDeleteItem: (targetKey: string) => void;
  readonly onClearAll: () => void;
}

export function RecentLocalHistorySection(
  _props: RecentLocalHistorySectionProps,
): ReactNode {
  return null;
}
