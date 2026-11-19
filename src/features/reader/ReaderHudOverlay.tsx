import type { ReactNode } from "react";

export interface ReaderHudOverlayProps {
  readonly isOpen: boolean;
  readonly fileName: string;
  readonly currentPageIndex: number;
  readonly totalPages: number;
  readonly onClose: () => void;
  readonly onNextPage: () => void;
  readonly onPrevPage: () => void;
}

export function ReaderHudOverlay(_props: ReaderHudOverlayProps): ReactNode {
  return null;
}
