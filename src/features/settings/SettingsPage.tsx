import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useServices } from "../../app/serviceContext";
import {
  type GoogleAuthError,
  toGoogleAuthError,
} from "../../bridges/oauth/googleAuthErrors";
import { diagnosticLogger } from "../../diagnostics/diagnosticLogger";
import type {
  DiagnosticEntry,
  DiagnosticLogger,
} from "../../diagnostics/types";
import { isAbortError } from "../../engine/zip/errors";
import { DriveApiError } from "../../providers/gdrive/driveApiErrors";
import { parseDriveFolderInput } from "../../providers/gdrive/driveFolderInput";
import type {
  DriveApiErrorCode,
  DriveFolderMetadata,
} from "../../providers/gdrive/types";
import { useRouter } from "../../shared/router/routerContext";
import { useDriveSyncStateStore } from "../../shared/sync/driveSyncStateStore";
import type { DriveSyncRootRecord } from "../../storage/types";
import { DiagnosticsSection } from "./DiagnosticsSection";
import { DriveFolderPickerModal } from "./DriveFolderPickerModal";
import { DriveSyncExecutionSection } from "./DriveSyncExecutionSection";
import { DriveSyncRootsSection } from "./DriveSyncRootsSection";
import { GoogleAccountSection } from "./GoogleAccountSection";
import { SettingsHeader } from "./SettingsHeader";
import type {
  DiagnosticsCopyStatus,
  DriveFolderBreadcrumbItem,
  GoogleAccountAuthStatus,
  SettingsPageInitialSnapshot,
} from "./types";

export interface SettingsPageProps {
  readonly initialSnapshot?: SettingsPageInitialSnapshot;
  readonly logger?: DiagnosticLogger;
  readonly onRegisterModalBack?: (closeModalFn: (() => void) | null) => void;
}

const ROOT_BREADCRUMB: DriveFolderBreadcrumbItem = {
  id: "root",
  name: "マイドライブ",
};

const DRIVE_ERROR_MESSAGES: Record<DriveApiErrorCode, string> = {
  UNAUTHORIZED:
    "Google アカウントの再認証が必要です。ログアウトして再度ログインしてください。",
  FORBIDDEN:
    "このフォルダへアクセスまたは登録する権限がありません（マイドライブ直下は登録できません）。",
  NOT_FOUND: "指定された Google Drive フォルダが見つかりませんでした。",
  NOT_A_FOLDER:
    "指定された対象はフォルダではありません（ファイルは登録できません）。",
  FOLDER_TRASHED: "ゴミ箱内のフォルダは登録できません。",
  RATE_LIMITED:
    "Google Drive API のアクセス上限に達しました。しばらく時間をおいて再試行してください。",
  TOKEN_EXPIRED:
    "同期トークンの有効期限が切れました。再度同期を実行してください。",
  NETWORK_ERROR:
    "Google Drive との通信に失敗しました。通信環境を確認して再試行してください。",
};

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatDriveErrorMessage(error: unknown): string {
  return error instanceof DriveApiError
    ? DRIVE_ERROR_MESSAGES[error.code]
    : formatErrorMessage(error);
}

function formatAuthErrorMessage(error: GoogleAuthError): string {
  if (error.code === "AUTH_NETWORK_ERROR") {
    return "Google アカウントとの通信に失敗しました。通信環境を確認して再試行してください。";
  }
  if (error.code === "AUTH_REQUIRED") {
    return "Google アカウントの再認証が必要です。もう一度ログインしてください。";
  }
  return error.message;
}

export function SettingsPage({
  initialSnapshot,
  logger = diagnosticLogger,
  onRegisterModalBack,
}: SettingsPageProps): ReactNode {
  const {
    googleAuthBridge,
    driveSyncRootsRepo,
    driveFolderClient,
    driveSyncMetaRepo,
    driveSyncEngine,
  } = useServices();
  const { back, setBackBlocked } = useRouter();

  const storeSyncPhase = useDriveSyncStateStore((state) => state.phase);
  const storeSyncActiveMode = useDriveSyncStateStore(
    (state) => state.activeMode,
  );
  const storeLastSyncedAt = useDriveSyncStateStore(
    (state) => state.lastSyncedAt,
  );
  const storeLastSyncResult = useDriveSyncStateStore(
    (state) => state.lastResult,
  );
  const storeSyncErrorMessage = useDriveSyncStateStore(
    (state) => state.errorMessage,
  );
  const hydrateLastSyncedAt = useDriveSyncStateStore(
    (state) => state.hydrateLastSyncedAt,
  );
  const runDriveSync = useDriveSyncStateStore((state) => state.runDriveSync);

  const [authStatus, setAuthStatus] = useState<GoogleAccountAuthStatus>(() => {
    if (initialSnapshot !== undefined) {
      return initialSnapshot.authState.status;
    }
    return googleAuthBridge.getCachedSession() !== null
      ? "connected"
      : "unlinked";
  });
  const [authEmail, setAuthEmail] = useState<string | null>(() => {
    if (initialSnapshot !== undefined) {
      return initialSnapshot.authState.email;
    }
    return googleAuthBridge.getCachedSession()?.email ?? null;
  });
  const [authErrorMessage, setAuthErrorMessage] = useState<string | null>(
    initialSnapshot?.authState.errorMessage ?? null,
  );

  const [syncRoots, setSyncRoots] = useState<readonly DriveSyncRootRecord[]>(
    () => initialSnapshot?.syncRoots ?? [],
  );
  const [folderInput, setFolderInput] = useState<string>(
    initialSnapshot?.folderInput ?? "",
  );
  const [isSubmittingRoot, setIsSubmittingRoot] = useState<boolean>(
    initialSnapshot?.isSubmittingRoot ?? false,
  );
  const [syncRootsErrorMessage, setSyncRootsErrorMessage] = useState<
    string | null
  >(initialSnapshot?.syncRootsErrorMessage ?? null);

  const [diagnosticEntries, setDiagnosticEntries] = useState<
    readonly DiagnosticEntry[]
  >(() =>
    initialSnapshot !== undefined
      ? (initialSnapshot.diagnosticEntries ?? [])
      : logger.getEntries(),
  );
  const [copyStatus, setCopyStatus] = useState<DiagnosticsCopyStatus>(
    initialSnapshot?.copyStatus ?? "idle",
  );

  const [isPickerOpen, setIsPickerOpen] = useState<boolean>(
    initialSnapshot?.pickerState?.isOpen ?? false,
  );
  const [pickerBreadcrumbs, setPickerBreadcrumbs] = useState<
    readonly DriveFolderBreadcrumbItem[]
  >(initialSnapshot?.pickerState?.breadcrumbs ?? [ROOT_BREADCRUMB]);
  const [pickerFolders, setPickerFolders] = useState<
    readonly DriveFolderMetadata[]
  >(initialSnapshot?.pickerState?.folders ?? []);
  const [pickerNextPageToken, setPickerNextPageToken] = useState<string | null>(
    initialSnapshot?.pickerState?.nextPageToken ?? null,
  );
  const [isPickerLoading, setIsPickerLoading] = useState<boolean>(
    initialSnapshot?.pickerState?.isLoading ?? false,
  );
  const [isPickerLoadingMore, setIsPickerLoadingMore] = useState<boolean>(
    initialSnapshot?.pickerState?.isLoadingMore ?? false,
  );
  const [isPickerSaving, setIsPickerSaving] = useState<boolean>(
    initialSnapshot?.pickerState?.isSaving ?? false,
  );
  const [pickerErrorMessage, setPickerErrorMessage] = useState<string | null>(
    initialSnapshot?.pickerState?.errorMessage ?? null,
  );

  const hasSnapshot = initialSnapshot !== undefined;
  const effectiveSyncPhase = hasSnapshot
    ? (initialSnapshot.syncState?.phase ?? "idle")
    : storeSyncPhase;
  const effectiveSyncActiveMode = hasSnapshot
    ? (initialSnapshot.syncState?.activeMode ?? null)
    : storeSyncActiveMode;
  const effectiveLastSyncedAt = hasSnapshot
    ? (initialSnapshot.syncState?.lastSyncedAt ?? null)
    : storeLastSyncedAt;
  const effectiveLastSyncResult = hasSnapshot
    ? (initialSnapshot.syncState?.lastResult ?? null)
    : storeLastSyncResult;
  const effectiveSyncErrorMessage = hasSnapshot
    ? (initialSnapshot.syncState?.errorMessage ?? null)
    : storeSyncErrorMessage;
  const isSyncing = effectiveSyncPhase === "syncing";
  const enabledRootCount = syncRoots.filter(
    (root) => root.enabled === 1,
  ).length;

  const isAuthBusy =
    authStatus === "signing-in" || authStatus === "signing-out";
  const isSavingSyncRoot = isSubmittingRoot || isPickerSaving;
  const isBackBlocked = isAuthBusy || isSavingSyncRoot;

  const isMountedRef = useRef<boolean>(true);
  const authFlowEpochRef = useRef<number>(0);
  const rootsMutationSeqRef = useRef<number>(0);
  const pickerEpochRef = useRef<number>(0);
  const addInputAbortRef = useRef<AbortController | null>(null);
  const pickerAbortRef = useRef<AbortController | null>(null);

  const isAuthBusyRef = useRef<boolean>(isAuthBusy);
  isAuthBusyRef.current = isAuthBusy;
  const isSyncingRef = useRef<boolean>(isSyncing);
  isSyncingRef.current = isSyncing;
  const isSubmittingRootRef = useRef<boolean>(isSubmittingRoot);
  isSubmittingRootRef.current = isSubmittingRoot;
  const isPickerSavingRef = useRef<boolean>(isPickerSaving);
  isPickerSavingRef.current = isPickerSaving;
  const isSavingSyncRootRef = useRef<boolean>(isSavingSyncRoot);
  isSavingSyncRootRef.current = isSavingSyncRoot;

  const authStatusRef = useRef<GoogleAccountAuthStatus>(authStatus);
  authStatusRef.current = authStatus;
  const syncRootsRef = useRef<readonly DriveSyncRootRecord[]>(syncRoots);
  syncRootsRef.current = syncRoots;
  const folderInputRef = useRef<string>(folderInput);
  folderInputRef.current = folderInput;
  const pickerBreadcrumbsRef =
    useRef<readonly DriveFolderBreadcrumbItem[]>(pickerBreadcrumbs);
  pickerBreadcrumbsRef.current = pickerBreadcrumbs;
  const pickerNextPageTokenRef = useRef<string | null>(pickerNextPageToken);
  pickerNextPageTokenRef.current = pickerNextPageToken;

  const syncDiagnosticsFromLogger = useCallback(() => {
    setDiagnosticEntries(logger.getEntries());
  }, [logger]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      addInputAbortRef.current?.abort();
      addInputAbortRef.current = null;
      pickerAbortRef.current?.abort();
      pickerAbortRef.current = null;
    };
  }, []);

  useEffect(() => {
    setBackBlocked(isBackBlocked);
    return () => {
      setBackBlocked(false);
    };
  }, [isBackBlocked, setBackBlocked]);

  useEffect(() => {
    if (initialSnapshot !== undefined) {
      return;
    }

    let isActive = true;
    const mountAuthEpoch = authFlowEpochRef.current;

    const unsubscribe = googleAuthBridge.subscribeSession((nextSession) => {
      if (isAuthBusyRef.current) {
        return;
      }
      if (nextSession === null) {
        setAuthStatus("unlinked");
        setAuthEmail(null);
      } else {
        setAuthStatus("connected");
        setAuthEmail(nextSession.email);
        setAuthErrorMessage(null);
      }
      syncDiagnosticsFromLogger();
    });

    if (googleAuthBridge.getCachedSession() === null) {
      void googleAuthBridge
        .getSession()
        .then((session) => {
          if (!isActive || authFlowEpochRef.current !== mountAuthEpoch) {
            return;
          }
          if (session !== null) {
            setAuthStatus("connected");
            setAuthEmail(session.email);
            setAuthErrorMessage(null);
          }
          syncDiagnosticsFromLogger();
        })
        .catch((error: unknown) => {
          if (!isActive || authFlowEpochRef.current !== mountAuthEpoch) {
            return;
          }
          logger.warn(
            "oauth",
            "Google セッションの確認に失敗しました",
            formatErrorMessage(error),
          );
          syncDiagnosticsFromLogger();
        });
    }

    void hydrateLastSyncedAt(driveSyncMetaRepo, logger);

    const initialRootsSeq = rootsMutationSeqRef.current;
    void driveSyncRootsRepo
      .listActive()
      .then((roots) => {
        if (!isActive || rootsMutationSeqRef.current !== initialRootsSeq) {
          return;
        }
        setSyncRoots(roots);
      })
      .catch((error: unknown) => {
        if (!isActive || rootsMutationSeqRef.current !== initialRootsSeq) {
          return;
        }
        logger.warn(
          "settings",
          "登録済みルートフォルダの読み込みに失敗しました",
          formatErrorMessage(error),
        );
        setSyncRootsErrorMessage(
          "登録済みルートフォルダの読み込みに失敗しました。",
        );
        syncDiagnosticsFromLogger();
      });

    return () => {
      isActive = false;
      unsubscribe();
    };
  }, [
    driveSyncMetaRepo,
    driveSyncRootsRepo,
    googleAuthBridge,
    hydrateLastSyncedAt,
    initialSnapshot,
    logger,
    syncDiagnosticsFromLogger,
  ]);

  const handleCloseFolderPicker = useCallback(() => {
    if (isSavingSyncRootRef.current) {
      return;
    }
    pickerEpochRef.current += 1;
    pickerAbortRef.current?.abort();
    pickerAbortRef.current = null;
    setIsPickerOpen(false);
    setIsPickerLoading(false);
    setIsPickerLoadingMore(false);
    setPickerErrorMessage(null);
  }, []);

  useEffect(() => {
    if (!isPickerOpen) {
      onRegisterModalBack?.(null);
      return;
    }
    onRegisterModalBack?.(handleCloseFolderPicker);
    return () => {
      onRegisterModalBack?.(null);
    };
  }, [handleCloseFolderPicker, isPickerOpen, onRegisterModalBack]);

  useEffect(() => {
    if (!isPickerOpen) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || isSavingSyncRootRef.current) {
        return;
      }
      event.preventDefault();
      handleCloseFolderPicker();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [handleCloseFolderPicker, isPickerOpen]);

  const handleSignIn = useCallback(async () => {
    if (isAuthBusyRef.current) {
      return;
    }
    isAuthBusyRef.current = true;
    authFlowEpochRef.current += 1;
    setAuthStatus("signing-in");
    setAuthErrorMessage(null);

    try {
      const session = await googleAuthBridge.signIn();
      if (!isMountedRef.current) {
        return;
      }
      setAuthStatus("connected");
      setAuthEmail(session.email);
      setAuthErrorMessage(null);
    } catch (error: unknown) {
      if (!isMountedRef.current) {
        return;
      }
      const authError = toGoogleAuthError(
        error,
        "Google アカウント連携に失敗しました",
      );
      if (authError.code === "AUTH_CANCELLED") {
        logger.info("oauth", "Google アカウント連携がキャンセルされました");
        setAuthStatus("unlinked");
        setAuthEmail(null);
        setAuthErrorMessage(null);
      } else {
        logger.error(
          "oauth",
          "Google アカウント連携に失敗しました",
          authError.message,
        );
        setAuthStatus("unlinked");
        setAuthEmail(null);
        setAuthErrorMessage(formatAuthErrorMessage(authError));
      }
    } finally {
      if (isMountedRef.current) {
        isAuthBusyRef.current = false;
        syncDiagnosticsFromLogger();
      }
    }
  }, [googleAuthBridge, logger, syncDiagnosticsFromLogger]);

  const handleSignOut = useCallback(async () => {
    if (isAuthBusyRef.current || isSyncingRef.current) {
      return;
    }
    isAuthBusyRef.current = true;
    authFlowEpochRef.current += 1;
    setAuthStatus("signing-out");
    setAuthErrorMessage(null);

    try {
      await googleAuthBridge.signOut();
      if (!isMountedRef.current) {
        return;
      }
      setAuthStatus("unlinked");
      setAuthEmail(null);
      setAuthErrorMessage(null);
    } catch (error: unknown) {
      if (!isMountedRef.current) {
        return;
      }
      const authError = toGoogleAuthError(
        error,
        "Google アカウントの連携解除に失敗しました",
      );
      logger.error(
        "oauth",
        "Google アカウントの連携解除に失敗しました",
        authError.message,
      );
      const latestSession = googleAuthBridge.getCachedSession();
      if (latestSession === null) {
        setAuthStatus("unlinked");
        setAuthEmail(null);
      } else {
        setAuthStatus("connected");
        setAuthEmail(latestSession.email);
      }
      setAuthErrorMessage(authError.message);
    } finally {
      if (isMountedRef.current) {
        isAuthBusyRef.current = false;
        syncDiagnosticsFromLogger();
      }
    }
  }, [googleAuthBridge, logger, syncDiagnosticsFromLogger]);

  const handleChangeFolderInput = useCallback((value: string) => {
    setFolderInput(value);
    setSyncRootsErrorMessage(null);
  }, []);

  const handleAddFolderByInput = useCallback(async () => {
    if (
      isSubmittingRootRef.current ||
      isSyncingRef.current ||
      authStatusRef.current !== "connected"
    ) {
      return;
    }

    const folderId = parseDriveFolderInput(folderInputRef.current);
    if (folderId === null) {
      logger.warn(
        "settings",
        "無効な Google Drive フォルダ URL / ID が入力されました",
      );
      setSyncRootsErrorMessage(
        "マイドライブ直下（root）や無効なフォルダ URL / ID は登録できません。",
      );
      syncDiagnosticsFromLogger();
      return;
    }

    isSubmittingRootRef.current = true;
    setIsSubmittingRoot(true);
    setSyncRootsErrorMessage(null);
    rootsMutationSeqRef.current += 1;

    const controller = new AbortController();
    addInputAbortRef.current = controller;

    try {
      const metadata = await driveFolderClient.resolveFolderById(
        folderId,
        controller.signal,
      );
      if (!isMountedRef.current) {
        return;
      }
      await driveSyncRootsRepo.upsertRoot({
        folderId: metadata.id,
        folderName: metadata.name,
      });
      if (!isMountedRef.current) {
        return;
      }
      const nextRoots = await driveSyncRootsRepo.listActive();
      if (!isMountedRef.current) {
        return;
      }
      setSyncRoots(nextRoots);
      setFolderInput("");
    } catch (error: unknown) {
      if (!isMountedRef.current || isAbortError(error)) {
        return;
      }
      logger.warn(
        "settings",
        "ルートフォルダの検証または登録に失敗しました",
        formatErrorMessage(error),
      );
      setSyncRootsErrorMessage(formatDriveErrorMessage(error));
    } finally {
      if (addInputAbortRef.current === controller) {
        addInputAbortRef.current = null;
      }
      if (isMountedRef.current) {
        isSubmittingRootRef.current = false;
        setIsSubmittingRoot(false);
        syncDiagnosticsFromLogger();
      }
    }
  }, [
    driveFolderClient,
    driveSyncRootsRepo,
    logger,
    syncDiagnosticsFromLogger,
  ]);

  const handleToggleRootEnabled = useCallback(
    async (folderId: string, nextEnabled: boolean) => {
      if (isSyncingRef.current) {
        return;
      }
      rootsMutationSeqRef.current += 1;
      const mutationSeq = rootsMutationSeqRef.current;
      const previousRoots = syncRootsRef.current;

      setSyncRoots((prev) =>
        prev.map((root) =>
          root.folderId === folderId
            ? { ...root, enabled: nextEnabled ? 1 : 0 }
            : root,
        ),
      );
      setSyncRootsErrorMessage(null);

      try {
        await driveSyncRootsRepo.setEnabled(folderId, nextEnabled);
        if (
          !isMountedRef.current ||
          rootsMutationSeqRef.current !== mutationSeq
        ) {
          return;
        }
        const nextRoots = await driveSyncRootsRepo.listActive();
        if (
          !isMountedRef.current ||
          rootsMutationSeqRef.current !== mutationSeq
        ) {
          return;
        }
        setSyncRoots(nextRoots);
      } catch (error: unknown) {
        if (
          !isMountedRef.current ||
          rootsMutationSeqRef.current !== mutationSeq
        ) {
          return;
        }
        setSyncRoots(previousRoots);
        logger.warn(
          "settings",
          "ルートフォルダの有効状態更新に失敗しました",
          formatErrorMessage(error),
        );
        setSyncRootsErrorMessage(
          "ルートフォルダの有効状態更新に失敗しました。",
        );
        syncDiagnosticsFromLogger();
      }
    },
    [driveSyncRootsRepo, logger, syncDiagnosticsFromLogger],
  );

  const handleRemoveRoot = useCallback(
    async (folderId: string) => {
      if (isSyncingRef.current) {
        return;
      }
      rootsMutationSeqRef.current += 1;
      const mutationSeq = rootsMutationSeqRef.current;
      const previousRoots = syncRootsRef.current;

      setSyncRoots((prev) => prev.filter((root) => root.folderId !== folderId));
      setSyncRootsErrorMessage(null);

      try {
        await driveSyncRootsRepo.removeRoot(folderId);
        if (
          !isMountedRef.current ||
          rootsMutationSeqRef.current !== mutationSeq
        ) {
          return;
        }
        const nextRoots = await driveSyncRootsRepo.listActive();
        if (
          !isMountedRef.current ||
          rootsMutationSeqRef.current !== mutationSeq
        ) {
          return;
        }
        setSyncRoots(nextRoots);
      } catch (error: unknown) {
        if (
          !isMountedRef.current ||
          rootsMutationSeqRef.current !== mutationSeq
        ) {
          return;
        }
        setSyncRoots(previousRoots);
        logger.warn(
          "settings",
          "ルートフォルダの削除に失敗しました",
          formatErrorMessage(error),
        );
        setSyncRootsErrorMessage("ルートフォルダの削除に失敗しました。");
        syncDiagnosticsFromLogger();
      }
    },
    [driveSyncRootsRepo, logger, syncDiagnosticsFromLogger],
  );

  const loadFolderPage = useCallback(
    async (
      parentFolderId: string,
      options: { readonly pageToken?: string; readonly append?: boolean } = {},
    ) => {
      pickerEpochRef.current += 1;
      const requestEpoch = pickerEpochRef.current;
      pickerAbortRef.current?.abort();
      const controller = new AbortController();
      pickerAbortRef.current = controller;

      const append = options.append === true;
      if (append) {
        setIsPickerLoadingMore(true);
      } else {
        setIsPickerLoading(true);
        setIsPickerLoadingMore(false);
        setPickerFolders([]);
        setPickerNextPageToken(null);
      }
      setPickerErrorMessage(null);

      try {
        const page = await driveFolderClient.listChildFolders(parentFolderId, {
          ...(options.pageToken !== undefined
            ? { pageToken: options.pageToken }
            : {}),
          signal: controller.signal,
        });
        if (!isMountedRef.current || pickerEpochRef.current !== requestEpoch) {
          return;
        }
        setPickerFolders((prev) =>
          append ? [...prev, ...page.folders] : page.folders,
        );
        setPickerNextPageToken(page.nextPageToken);
      } catch (error: unknown) {
        if (
          !isMountedRef.current ||
          pickerEpochRef.current !== requestEpoch ||
          isAbortError(error)
        ) {
          return;
        }
        logger.warn(
          "settings",
          "Google Drive フォルダ一覧の取得に失敗しました",
          formatErrorMessage(error),
        );
        setPickerErrorMessage(formatDriveErrorMessage(error));
      } finally {
        if (pickerAbortRef.current === controller) {
          pickerAbortRef.current = null;
        }
        if (isMountedRef.current && pickerEpochRef.current === requestEpoch) {
          setIsPickerLoading(false);
          setIsPickerLoadingMore(false);
          syncDiagnosticsFromLogger();
        }
      }
    },
    [driveFolderClient, logger, syncDiagnosticsFromLogger],
  );

  const handleOpenFolderPicker = useCallback(() => {
    if (
      authStatusRef.current !== "connected" ||
      isSubmittingRootRef.current ||
      isSyncingRef.current
    ) {
      return;
    }
    setIsPickerOpen(true);
    setPickerBreadcrumbs([ROOT_BREADCRUMB]);
    void loadFolderPage(ROOT_BREADCRUMB.id);
  }, [loadFolderPage]);

  const handleNavigateBreadcrumb = useCallback(
    (index: number) => {
      if (
        isSavingSyncRootRef.current ||
        index < 0 ||
        index >= pickerBreadcrumbsRef.current.length - 1
      ) {
        return;
      }
      const nextBreadcrumbs = pickerBreadcrumbsRef.current.slice(0, index + 1);
      setPickerBreadcrumbs(nextBreadcrumbs);
      const target = nextBreadcrumbs[nextBreadcrumbs.length - 1];
      void loadFolderPage(target.id);
    },
    [loadFolderPage],
  );

  const handleOpenFolder = useCallback(
    (folder: DriveFolderMetadata) => {
      if (isSavingSyncRootRef.current) {
        return;
      }
      const nextBreadcrumbs = [
        ...pickerBreadcrumbsRef.current,
        { id: folder.id, name: folder.name },
      ];
      setPickerBreadcrumbs(nextBreadcrumbs);
      void loadFolderPage(folder.id);
    },
    [loadFolderPage],
  );

  const handleLoadMore = useCallback(() => {
    const token = pickerNextPageTokenRef.current;
    if (token === null || isSavingSyncRootRef.current) {
      return;
    }
    const current =
      pickerBreadcrumbsRef.current[pickerBreadcrumbsRef.current.length - 1];
    void loadFolderPage(current.id, { pageToken: token, append: true });
  }, [loadFolderPage]);

  const savePickedFolder = useCallback(
    async (folder: DriveFolderMetadata) => {
      if (isPickerSavingRef.current) {
        return;
      }
      if (folder.id.trim().toLowerCase() === "root") {
        setPickerErrorMessage("マイドライブ直下（root）は登録できません。");
        return;
      }

      isPickerSavingRef.current = true;
      setIsPickerSaving(true);
      setPickerErrorMessage(null);
      rootsMutationSeqRef.current += 1;

      try {
        await driveSyncRootsRepo.upsertRoot({
          folderId: folder.id,
          folderName: folder.name,
        });
        if (!isMountedRef.current) {
          return;
        }
        const nextRoots = await driveSyncRootsRepo.listActive();
        if (!isMountedRef.current) {
          return;
        }
        setSyncRoots(nextRoots);
        pickerEpochRef.current += 1;
        pickerAbortRef.current?.abort();
        pickerAbortRef.current = null;
        setIsPickerOpen(false);
        setIsPickerLoading(false);
        setIsPickerLoadingMore(false);
        setSyncRootsErrorMessage(null);
      } catch (error: unknown) {
        if (!isMountedRef.current) {
          return;
        }
        logger.warn(
          "settings",
          "選択フォルダの保存に失敗しました",
          formatErrorMessage(error),
        );
        setPickerErrorMessage("ルートフォルダの保存に失敗しました。");
      } finally {
        if (isMountedRef.current) {
          isPickerSavingRef.current = false;
          setIsPickerSaving(false);
          syncDiagnosticsFromLogger();
        }
      }
    },
    [driveSyncRootsRepo, logger, syncDiagnosticsFromLogger],
  );

  const handleSelectFolder = useCallback(
    (folder: DriveFolderMetadata) => {
      void savePickedFolder(folder);
    },
    [savePickedFolder],
  );

  const handleConfirmCurrentFolder = useCallback(() => {
    const current =
      pickerBreadcrumbsRef.current[pickerBreadcrumbsRef.current.length - 1];
    void savePickedFolder({ id: current.id, name: current.name });
  }, [savePickedFolder]);

  const handleRunIncrementalSync = useCallback(() => {
    void runDriveSync({
      driveSyncEngine,
      forceFullScan: false,
      logger,
    }).finally(() => {
      if (isMountedRef.current) {
        syncDiagnosticsFromLogger();
      }
    });
  }, [driveSyncEngine, logger, runDriveSync, syncDiagnosticsFromLogger]);

  const handleRunFullScan = useCallback(() => {
    void runDriveSync({
      driveSyncEngine,
      forceFullScan: true,
      logger,
    }).finally(() => {
      if (isMountedRef.current) {
        syncDiagnosticsFromLogger();
      }
    });
  }, [driveSyncEngine, logger, runDriveSync, syncDiagnosticsFromLogger]);

  const handleCopyDiagnostics = useCallback(async () => {
    const report = logger.formatReport();
    if (!navigator.clipboard) {
      setCopyStatus("failed");
      return;
    }
    try {
      await navigator.clipboard.writeText(report);
      setCopyStatus("copied");
    } catch {
      setCopyStatus("failed");
    }
  }, [logger]);

  const handleClearDiagnostics = useCallback(() => {
    logger.clear();
    setDiagnosticEntries(logger.getEntries());
    setCopyStatus("idle");
  }, [logger]);

  return (
    <div
      data-testid="settings-page"
      className="flex min-h-screen flex-col bg-slate-950 text-slate-100"
    >
      <div
        data-testid="settings-main-content"
        inert={isPickerOpen}
        className="flex flex-1 flex-col"
      >
        <SettingsHeader isBackBlocked={isBackBlocked} onBack={back} />
        <main
          style={{
            paddingBottom: "calc(2rem + env(safe-area-inset-bottom, 0px))",
          }}
          className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-6 sm:px-6"
        >
          <GoogleAccountSection
            status={authStatus}
            email={authEmail}
            errorMessage={authErrorMessage}
            isSyncing={isSyncing}
            onSignIn={handleSignIn}
            onSignOut={handleSignOut}
          />
          <DriveSyncRootsSection
            roots={syncRoots}
            isConnected={authStatus === "connected"}
            folderInput={folderInput}
            isSubmitting={isSubmittingRoot}
            isSyncing={isSyncing}
            errorMessage={syncRootsErrorMessage}
            onChangeFolderInput={handleChangeFolderInput}
            onAddFolderByInput={handleAddFolderByInput}
            onOpenFolderPicker={handleOpenFolderPicker}
            onToggleRootEnabled={handleToggleRootEnabled}
            onRemoveRoot={handleRemoveRoot}
          />
          <DriveSyncExecutionSection
            authStatus={authStatus}
            enabledRootCount={enabledRootCount}
            syncPhase={effectiveSyncPhase}
            activeMode={effectiveSyncActiveMode}
            lastSyncedAt={effectiveLastSyncedAt}
            lastResult={effectiveLastSyncResult}
            errorMessage={effectiveSyncErrorMessage}
            isBackBlocked={isBackBlocked}
            onRunIncrementalSync={handleRunIncrementalSync}
            onRunFullScan={handleRunFullScan}
          />
          <DiagnosticsSection
            entries={diagnosticEntries}
            copyStatus={copyStatus}
            onCopyDiagnostics={handleCopyDiagnostics}
            onClearDiagnostics={handleClearDiagnostics}
          />
        </main>
      </div>

      <DriveFolderPickerModal
        isOpen={isPickerOpen}
        breadcrumbs={pickerBreadcrumbs}
        folders={pickerFolders}
        nextPageToken={pickerNextPageToken}
        isLoading={isPickerLoading}
        isLoadingMore={isPickerLoadingMore}
        isSaving={isSavingSyncRoot}
        errorMessage={pickerErrorMessage}
        onNavigateBreadcrumb={handleNavigateBreadcrumb}
        onOpenFolder={handleOpenFolder}
        onSelectFolder={handleSelectFolder}
        onConfirmCurrentFolder={handleConfirmCurrentFolder}
        onLoadMore={handleLoadMore}
        onClose={handleCloseFolderPicker}
      />
    </div>
  );
}
