import type { DiagnosticEntry } from "../../diagnostics/types";
import type {
  DriveFolderMetadata,
  DriveSyncResult,
} from "../../providers/gdrive/types";
import type {
  DriveSyncActiveMode,
  DriveSyncUiPhase,
} from "../../shared/sync/driveSyncStateStore";
import type { DriveSyncRootRecord } from "../../storage/types";

export type GoogleAccountAuthStatus =
  "unlinked" | "signing-in" | "signing-out" | "connected";

export type DiagnosticsCopyStatus = "idle" | "copied" | "failed";

export interface DriveFolderBreadcrumbItem {
  readonly id: string;
  readonly name: string;
}

export interface SettingsAuthSnapshotState {
  readonly status: GoogleAccountAuthStatus;
  readonly email: string | null;
  readonly errorMessage?: string | null;
}

export interface SettingsPickerSnapshotState {
  readonly isOpen: boolean;
  readonly breadcrumbs?: readonly DriveFolderBreadcrumbItem[];
  readonly folders?: readonly DriveFolderMetadata[];
  readonly nextPageToken?: string | null;
  readonly isLoading?: boolean;
  readonly isLoadingMore?: boolean;
  readonly isSaving?: boolean;
  readonly errorMessage?: string | null;
}

export interface SettingsSyncSnapshotState {
  readonly phase: DriveSyncUiPhase;
  readonly activeMode?: DriveSyncActiveMode | null;
  readonly lastSyncedAt?: number | null;
  readonly lastResult?: DriveSyncResult | null;
  readonly errorMessage?: string | null;
}

export interface SettingsPageInitialSnapshot {
  readonly authState: SettingsAuthSnapshotState;
  readonly syncRoots: readonly DriveSyncRootRecord[];
  readonly syncState?: SettingsSyncSnapshotState;
  readonly diagnosticEntries?: readonly DiagnosticEntry[];
  readonly copyStatus?: DiagnosticsCopyStatus;
  readonly folderInput?: string;
  readonly isSubmittingRoot?: boolean;
  readonly syncRootsErrorMessage?: string | null;
  readonly pickerState?: SettingsPickerSnapshotState;
}
