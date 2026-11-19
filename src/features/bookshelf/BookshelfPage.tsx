import type { CopyStatus } from "./BookshelfHeader";

export interface BookshelfPageProps {
  readonly initialCopyStatus?: CopyStatus;
  readonly initialErrorMessage?: string | null;
  readonly initialDragActive?: boolean;
}

export function BookshelfPage(_props: BookshelfPageProps) {
  return null;
}
