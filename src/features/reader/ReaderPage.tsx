import type { ReactNode } from "react";
import type { DecodedPageFrame } from "../../engine/types";
import type { ExtractedReaderError } from "./readerErrors";

export interface ReaderPageInitialSnapshot {
  readonly totalPages: number;
  readonly currentPageIndex?: number;
  readonly frame?: DecodedPageFrame | null;
  readonly archiveError?: ExtractedReaderError | null;
  readonly isOpening?: boolean;
  readonly isHudOpen?: boolean;
}

export interface ReaderPageProps {
  readonly onRegisterExit?: (exitFn: (() => void) | null) => void;
  readonly initialSnapshot?: ReaderPageInitialSnapshot;
}

export function ReaderPage(_props: ReaderPageProps): ReactNode {
  return null;
}
