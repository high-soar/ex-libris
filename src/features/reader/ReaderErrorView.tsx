import type { ReactNode } from "react";

export interface ReaderErrorViewProps {
  readonly mode: "archive" | "page";
  readonly message: string;
  readonly errorCode?: string;
  readonly onBackToHome?: () => void;
}

export function ReaderErrorView(_props: ReaderErrorViewProps): ReactNode {
  return null;
}
