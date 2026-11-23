import type { ReactNode } from "react";
import type { DriveFolderMetadata } from "../../providers/gdrive/types";
import type { DriveFolderBreadcrumbItem } from "./types";

export interface DriveFolderPickerModalProps {
  readonly isOpen: boolean;
  readonly breadcrumbs: readonly DriveFolderBreadcrumbItem[];
  readonly folders: readonly DriveFolderMetadata[];
  readonly nextPageToken: string | null;
  readonly isLoading: boolean;
  readonly isLoadingMore: boolean;
  readonly isSaving: boolean;
  readonly errorMessage: string | null;
  readonly onNavigateBreadcrumb: (index: number) => void;
  readonly onOpenFolder: (folder: DriveFolderMetadata) => void;
  readonly onSelectFolder: (folder: DriveFolderMetadata) => void;
  readonly onConfirmCurrentFolder: () => void;
  readonly onLoadMore: () => void;
  readonly onClose: () => void;
}

export function DriveFolderPickerModal({
  isOpen,
}: DriveFolderPickerModalProps): ReactNode {
  if (!isOpen) {
    return null;
  }
  return <div />;
}
