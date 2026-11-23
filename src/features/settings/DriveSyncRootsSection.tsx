import type { ReactNode } from "react";
import type { DriveSyncRootRecord } from "../../storage/types";

export interface DriveSyncRootsSectionProps {
  readonly roots: readonly DriveSyncRootRecord[];
  readonly isConnected: boolean;
  readonly folderInput: string;
  readonly isSubmitting: boolean;
  readonly errorMessage: string | null;
  readonly onChangeFolderInput: (value: string) => void;
  readonly onAddFolderByInput: () => void;
  readonly onOpenFolderPicker: () => void;
  readonly onToggleRootEnabled: (
    folderId: string,
    nextEnabled: boolean,
  ) => void;
  readonly onRemoveRoot: (folderId: string) => void;
}

export function DriveSyncRootsSection({
  roots: _roots,
  isConnected: _isConnected,
  folderInput: _folderInput,
  isSubmitting: _isSubmitting,
  errorMessage: _errorMessage,
  onChangeFolderInput: _onChangeFolderInput,
  onAddFolderByInput: _onAddFolderByInput,
  onOpenFolderPicker: _onOpenFolderPicker,
  onToggleRootEnabled: _onToggleRootEnabled,
  onRemoveRoot: _onRemoveRoot,
}: DriveSyncRootsSectionProps): ReactNode {
  return <section />;
}
