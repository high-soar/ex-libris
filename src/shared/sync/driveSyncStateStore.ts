import { create } from "zustand";
import { GoogleAuthError } from "../../bridges/oauth/googleAuthErrors";
import type { GoogleAuthErrorCode } from "../../bridges/oauth/types";
import { diagnosticLogger } from "../../diagnostics/diagnosticLogger";
import type { DiagnosticLogger } from "../../diagnostics/types";
import { DriveApiError } from "../../providers/gdrive/driveApiErrors";
import type {
  DriveApiErrorCode,
  DriveSyncEngine,
  DriveSyncResult,
} from "../../providers/gdrive/types";
import type { DriveSyncMetaRepository } from "../../storage/repositories/driveSyncMetaRepository";

export type DriveSyncUiPhase = "idle" | "syncing" | "completed" | "error";
export type DriveSyncActiveMode = "incremental" | "full";

export interface RunDriveSyncParams {
  readonly driveSyncEngine: DriveSyncEngine;
  readonly forceFullScan?: boolean;
  readonly logger?: DiagnosticLogger;
}

export interface DriveSyncState {
  readonly phase: DriveSyncUiPhase;
  readonly activeMode: DriveSyncActiveMode | null;
  readonly lastSyncedAt: number | null;
  readonly isLastSyncedAtLoaded: boolean;
  readonly lastResult: DriveSyncResult | null;
  readonly errorMessage: string | null;
  readonly completedSyncCount: number;
  readonly hydrateLastSyncedAt: (
    driveSyncMetaRepo: Pick<DriveSyncMetaRepository, "getSyncState">,
    logger?: DiagnosticLogger,
  ) => Promise<void>;
  readonly runDriveSync: (
    params: RunDriveSyncParams,
  ) => Promise<DriveSyncResult | null>;
}

const INITIAL_DRIVE_SYNC_STATE = {
  phase: "idle" as DriveSyncUiPhase,
  activeMode: null as DriveSyncActiveMode | null,
  lastSyncedAt: null as number | null,
  isLastSyncedAtLoaded: false,
  lastResult: null as DriveSyncResult | null,
  errorMessage: null as string | null,
  completedSyncCount: 0,
};

const DRIVE_API_ERROR_MESSAGES: Record<DriveApiErrorCode, string> = {
  UNAUTHORIZED:
    "Google アカウントの認証が切れました。設定画面から再ログインしてください",
  TOKEN_EXPIRED:
    "Google アカウントの認証が切れました。設定画面から再ログインしてください",
  FORBIDDEN: "Google Drive フォルダへのアクセス権限がありません",
  NOT_FOUND:
    "同期対象の Google Drive フォルダが見つかりません。設定を確認してください",
  NOT_A_FOLDER:
    "同期対象の Google Drive フォルダが見つかりません。設定を確認してください",
  FOLDER_TRASHED:
    "同期対象の Google Drive フォルダが見つかりません。設定を確認してください",
  RATE_LIMITED:
    "Google Drive API の利用制限に達しました。しばらく待ってから再試行してください",
  NETWORK_ERROR: "ネットワークエラーにより Google Drive 同期に失敗しました",
};

const GOOGLE_AUTH_ERROR_MESSAGES: Record<GoogleAuthErrorCode, string> = {
  AUTH_REQUIRED:
    "Google アカウントにログインしていないため同期できません。設定画面から連携してください",
  AUTH_CANCELLED: "Google アカウントの認証がキャンセルされました",
  AUTH_NETWORK_ERROR: "認証通信のネットワークエラーにより同期に失敗しました",
  AUTH_FAILED:
    "Google アカウントの認証に失敗しました。設定画面から再連携してください",
};

const UNKNOWN_SYNC_ERROR_MESSAGE =
  "Google Drive 同期中に予期しないエラーが発生しました";

export function formatDriveSyncErrorMessage(error: unknown): string {
  if (error instanceof DriveApiError) {
    return DRIVE_API_ERROR_MESSAGES[error.code];
  }
  if (error instanceof GoogleAuthError) {
    return GOOGLE_AUTH_ERROR_MESSAGES[error.code];
  }
  return UNKNOWN_SYNC_ERROR_MESSAGE;
}

function formatErrorDetail(error: unknown): string {
  return error instanceof Error
    ? `${error.name}: ${error.message}`
    : String(error);
}

export const useDriveSyncStateStore = create<DriveSyncState>((set, get) => ({
  ...INITIAL_DRIVE_SYNC_STATE,
  hydrateLastSyncedAt: async (
    driveSyncMetaRepo,
    logger = diagnosticLogger,
  ): Promise<void> => {
    if (get().isLastSyncedAtLoaded) {
      return;
    }
    try {
      const meta = await driveSyncMetaRepo.getSyncState();
      const current = get();
      if (current.isLastSyncedAtLoaded || current.lastSyncedAt !== null) {
        set({ isLastSyncedAtLoaded: true });
        return;
      }
      set({
        lastSyncedAt: meta.lastDriveSyncAt,
        isLastSyncedAtLoaded: true,
      });
    } catch (error) {
      logger.warn(
        "drive-sync",
        "Failed to hydrate lastDriveSyncAt",
        formatErrorDetail(error),
      );
    }
  },
  runDriveSync: async ({
    driveSyncEngine,
    forceFullScan = false,
    logger = diagnosticLogger,
  }): Promise<DriveSyncResult | null> => {
    if (get().phase === "syncing") {
      return null;
    }

    const activeMode: DriveSyncActiveMode = forceFullScan
      ? "full"
      : "incremental";
    set({
      phase: "syncing",
      activeMode,
      errorMessage: null,
    });

    try {
      const result = await driveSyncEngine.sync({ forceFullScan });
      if (result.mode === "skipped-no-roots") {
        set((state) => ({
          phase: "idle",
          activeMode: null,
          lastResult: result,
          errorMessage: null,
          completedSyncCount: state.completedSyncCount + 1,
        }));
        return result;
      }

      set((state) => ({
        phase: "completed",
        activeMode: null,
        lastSyncedAt: result.syncedAt,
        isLastSyncedAtLoaded: true,
        lastResult: result,
        errorMessage: null,
        completedSyncCount: state.completedSyncCount + 1,
      }));
      return result;
    } catch (error) {
      const errorMessage = formatDriveSyncErrorMessage(error);
      logger.error(
        "drive-sync",
        "Google Drive sync failed",
        formatErrorDetail(error),
      );
      set({
        phase: "error",
        activeMode: null,
        errorMessage,
      });
      return null;
    }
  },
}));

export function resetDriveSyncState(): void {
  useDriveSyncStateStore.setState({ ...INITIAL_DRIVE_SYNC_STATE });
}
