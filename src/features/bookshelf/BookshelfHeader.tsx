import type { ReactNode } from "react";

export type CopyStatus = "idle" | "copied" | "failed";

export interface BookshelfHeaderProps {
  readonly copyStatus: CopyStatus;
  readonly onCopyDiagnostics: () => void;
  readonly onOpenLocalZip: () => void;
}

export function BookshelfHeader(_props: BookshelfHeaderProps): ReactNode {
  return null;
}
