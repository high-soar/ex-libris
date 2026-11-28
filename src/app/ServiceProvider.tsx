import { Capacitor } from "@capacitor/core";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { CapacitorAppBridge } from "../bridges/app/capacitorAppBridge";
import { MockAppBridge } from "../bridges/app/mockAppBridge";
import type { AppBridge } from "../bridges/app/types";
import { CapacitorGoogleAuthAdapter } from "../bridges/oauth/capacitorGoogleAuthAdapter";
import { GoogleAuthTokenManager } from "../bridges/oauth/googleAuthTokenManager";
import { MockGoogleAuthAdapter } from "../bridges/oauth/mockGoogleAuthAdapter";
import type {
  GoogleAuthBridge,
  GoogleAuthSession,
} from "../bridges/oauth/types";
import { diagnosticLogger } from "../diagnostics/diagnosticLogger";
import {
  CoverExtractionSchedulerCore,
  NoopCoverExtractionScheduler,
} from "../engine/cover/CoverExtractionSchedulerCore";
import { MockCoverArchiveRangeReader } from "../engine/cover/MockCoverArchiveRangeReader";
import type { CoverExtractionScheduler } from "../engine/cover/types";
import { GoogleDriveRangeReader } from "../engine/io/GoogleDriveRangeReader";
import { resetBookshelfUiState } from "../features/bookshelf/bookshelfUiStateStore";
import { DefaultDriveSyncEngine } from "../providers/gdrive/driveSyncEngine";
import { GoogleDriveFolderClient } from "../providers/gdrive/googleDriveFolderClient";
import { GoogleDriveSyncClient } from "../providers/gdrive/googleDriveSyncClient";
import { MockDriveFolderClient } from "../providers/gdrive/mockDriveFolderClient";
import { MockDriveSyncClient } from "../providers/gdrive/mockDriveSyncClient";
import type {
  DriveFolderClient,
  DriveSyncClient,
  DriveSyncEngine,
} from "../providers/gdrive/types";
import {
  resetCoverExtractionState,
  useCoverExtractionStateStore,
} from "../shared/sync/coverExtractionStateStore";
import {
  resetDriveSyncState,
  useDriveSyncStateStore,
} from "../shared/sync/driveSyncStateStore";
import { db, resetTestDb } from "../storage/db";
import {
  DexieDriveSyncMetaRepository,
  type DriveSyncMetaRepository,
} from "../storage/repositories/driveSyncMetaRepository";
import {
  DexieDriveSyncRootsRepository,
  type DriveSyncRootsRepository,
} from "../storage/repositories/driveSyncRootsRepository";
import {
  DexieReaderSettingsRepository,
  type ReaderSettingsRepository,
} from "../storage/repositories/readerSettingsRepository";
import {
  DexieReadingProgressRepository,
  type ReadingProgressRepository,
} from "../storage/repositories/readingProgressRepository";
import {
  DexieSeriesRepository,
  type SeriesRepository,
} from "../storage/repositories/seriesRepository";
import {
  DexieVolumesRepository,
  type VolumesRepository,
} from "../storage/repositories/volumesRepository";
import {
  DexieZipIndexCacheRepository,
  type ZipIndexCacheRepository,
} from "../storage/repositories/zipIndexCacheRepository";
import type { ExLibrisServicesState } from "../types";
import {
  createCoordinatorSession as defaultCreateCoordinatorSession,
  type CoordinatorSessionHandle,
} from "./coordinatorClient";
import { createCoverWorkerClient } from "./coverWorkerClient";
import { ServiceContext, type ServiceContextValue } from "./serviceContext";

export interface ServiceProviderProps {
  readonly children?: ReactNode;
  readonly appBridge?: AppBridge;
  readonly createCoordinatorSession?: () => CoordinatorSessionHandle;
  readonly zipIndexCacheRepo?: ZipIndexCacheRepository;
  readonly readingProgressRepo?: ReadingProgressRepository;
  readonly readerSettingsRepo?: ReaderSettingsRepository;
  readonly googleAuthBridge?: GoogleAuthBridge;
  readonly driveSyncRootsRepo?: DriveSyncRootsRepository;
  readonly driveFolderClient?: DriveFolderClient;
  readonly seriesRepo?: SeriesRepository;
  readonly volumesRepo?: VolumesRepository;
  readonly driveSyncMetaRepo?: DriveSyncMetaRepository;
  readonly driveSyncClient?: DriveSyncClient;
  readonly driveSyncEngine?: DriveSyncEngine;
  readonly coverExtractionScheduler?: CoverExtractionScheduler;
}

export interface ResetTestDbExposureOptions {
  readonly isNativePlatform?: boolean;
  readonly isDev?: boolean;
  readonly mode?: string;
  readonly isWebDriver?: boolean;
}

interface DefaultGoogleAuthResources {
  readonly bridge: GoogleAuthBridge;
  readonly mockAdapter?: MockGoogleAuthAdapter;
}

interface GlobalServicesBuildParams {
  readonly appBridge: AppBridge;
  readonly mockGoogleAuthAdapter?: MockGoogleAuthAdapter;
  readonly mockDriveFolderClient?: MockDriveFolderClient;
  readonly driveSyncEngine: DriveSyncEngine;
  readonly seriesRepo: SeriesRepository;
  readonly volumesRepo: VolumesRepository;
  readonly driveSyncMetaRepo: DriveSyncMetaRepository;
  readonly mockDriveSyncClient?: MockDriveSyncClient;
  readonly coverExtractionScheduler: CoverExtractionScheduler;
}

const TEST_MOCK_AUTH_STORAGE_KEY = "exLibris:test:mockGoogleAuthSession";
const TEST_COVER_EXTRACTION_AUTO_RUN_KEY =
  "exLibris:test:coverExtractionAutoRun";

interface PersistedMockGoogleAuthSession {
  readonly email: string;
  readonly accessToken: string;
}

function isWebDriverEnvironment(): boolean {
  return typeof navigator !== "undefined" && navigator.webdriver === true;
}

// eslint-disable-next-line react-refresh/only-export-components
export function shouldExposeResetTestDb(
  options: ResetTestDbExposureOptions = {},
): boolean {
  if (options.isNativePlatform ?? Capacitor.isNativePlatform()) {
    return false;
  }
  const isDev = options.isDev ?? import.meta.env.DEV;
  const mode = options.mode ?? import.meta.env.MODE;
  const isWebDriver = options.isWebDriver ?? isWebDriverEnvironment();
  return isDev || mode === "test" || isWebDriver;
}

function shouldPersistTestMockAuth(): boolean {
  return shouldExposeResetTestDb() && isWebDriverEnvironment();
}

function readPersistedMockAuthSession(): PersistedMockGoogleAuthSession | null {
  try {
    const raw = window.sessionStorage.getItem(TEST_MOCK_AUTH_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(
      raw,
    ) as Partial<PersistedMockGoogleAuthSession> | null;
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      typeof parsed.email === "string" &&
      typeof parsed.accessToken === "string"
    ) {
      return { email: parsed.email, accessToken: parsed.accessToken };
    }
    return null;
  } catch {
    return null;
  }
}

function writePersistedMockAuthSession(
  session: PersistedMockGoogleAuthSession | null,
): void {
  try {
    if (session === null) {
      window.sessionStorage.removeItem(TEST_MOCK_AUTH_STORAGE_KEY);
      return;
    }
    window.sessionStorage.setItem(
      TEST_MOCK_AUTH_STORAGE_KEY,
      JSON.stringify(session),
    );
  } catch {
    // ストレージアクセスが制限された環境では永続化をスキップする
  }
}

function readTestCoverExtractionAutoRun(): boolean {
  try {
    return (
      window.sessionStorage.getItem(TEST_COVER_EXTRACTION_AUTO_RUN_KEY) === "1"
    );
  } catch {
    return false;
  }
}

function writeTestCoverExtractionAutoRun(enabled: boolean): void {
  try {
    if (enabled) {
      window.sessionStorage.setItem(TEST_COVER_EXTRACTION_AUTO_RUN_KEY, "1");
      return;
    }
    window.sessionStorage.removeItem(TEST_COVER_EXTRACTION_AUTO_RUN_KEY);
  } catch {
    // ストレージアクセスが制限された環境では永続化をスキップする
  }
}

function buildGlobalServicesState(
  params: GlobalServicesBuildParams,
): ExLibrisServicesState {
  if (!shouldExposeResetTestDb()) {
    return {
      isReady: true,
      appBridge: params.appBridge,
    };
  }

  return {
    isReady: true,
    appBridge: params.appBridge,
    resetTestDb: async () => {
      writePersistedMockAuthSession(null);
      writeTestCoverExtractionAutoRun(false);
      await params.coverExtractionScheduler.resetForTest();
      if (isWebDriverEnvironment()) {
        params.coverExtractionScheduler.pause("test-harness");
      }
      resetCoverExtractionState();
      resetBookshelfUiState();
      resetDriveSyncState();
      params.mockGoogleAuthAdapter?.reset();
      params.mockDriveFolderClient?.reset();
      params.mockDriveSyncClient?.reset();
      await resetTestDb();
    },
    ...(params.mockGoogleAuthAdapter !== undefined
      ? { mockGoogleAuthAdapter: params.mockGoogleAuthAdapter }
      : {}),
    ...(params.mockDriveFolderClient !== undefined
      ? { mockDriveFolderClient: params.mockDriveFolderClient }
      : {}),
    driveSyncEngine: params.driveSyncEngine,
    seriesRepo: params.seriesRepo,
    volumesRepo: params.volumesRepo,
    driveSyncMetaRepo: params.driveSyncMetaRepo,
    ...(params.mockDriveSyncClient !== undefined
      ? { mockDriveSyncClient: params.mockDriveSyncClient }
      : {}),
    coverExtractionScheduler: params.coverExtractionScheduler,
    setTestCoverExtractionAutoRun: (enabled: boolean) => {
      writeTestCoverExtractionAutoRun(enabled);
      if (enabled) {
        params.coverExtractionScheduler.resume("test-harness");
        void params.coverExtractionScheduler.syncQueue();
      } else {
        params.coverExtractionScheduler.pause("test-harness");
      }
    },
  };
}

function createDefaultAppBridge(): AppBridge {
  return Capacitor.isNativePlatform()
    ? new CapacitorAppBridge()
    : new MockAppBridge();
}

function createDefaultZipIndexCacheRepo(): ZipIndexCacheRepository {
  return new DexieZipIndexCacheRepository(db);
}

function createDefaultReadingProgressRepo(): ReadingProgressRepository {
  return new DexieReadingProgressRepository(db);
}

function createDefaultReaderSettingsRepo(): ReaderSettingsRepository {
  return new DexieReaderSettingsRepository(db);
}

function createDefaultGoogleAuthResources(): DefaultGoogleAuthResources {
  if (Capacitor.isNativePlatform()) {
    return {
      bridge: new GoogleAuthTokenManager(new CapacitorGoogleAuthAdapter()),
    };
  }
  const persisted = shouldPersistTestMockAuth()
    ? readPersistedMockAuthSession()
    : null;
  const mockAdapter = new MockGoogleAuthAdapter(
    persisted !== null
      ? {
          initialLinked: true,
          email: persisted.email,
          initialAccessToken: persisted.accessToken,
        }
      : {},
  );
  return {
    bridge: new GoogleAuthTokenManager(mockAdapter),
    mockAdapter,
  };
}

function createDefaultDriveSyncRootsRepo(): DriveSyncRootsRepository {
  return new DexieDriveSyncRootsRepository(db);
}

function createDefaultDriveFolderClient(
  authBridge: GoogleAuthBridge,
): DriveFolderClient {
  return Capacitor.isNativePlatform()
    ? new GoogleDriveFolderClient({ authBridge })
    : new MockDriveFolderClient();
}

function createDefaultSeriesRepo(): SeriesRepository {
  return new DexieSeriesRepository(db);
}

function createDefaultVolumesRepo(): VolumesRepository {
  return new DexieVolumesRepository(db);
}

function createDefaultDriveSyncMetaRepo(): DriveSyncMetaRepository {
  return new DexieDriveSyncMetaRepository(db);
}

function createDefaultDriveSyncClient(
  authBridge: GoogleAuthBridge,
): DriveSyncClient {
  return Capacitor.isNativePlatform()
    ? new GoogleDriveSyncClient({ authBridge })
    : new MockDriveSyncClient();
}

function createDefaultCoverExtractionScheduler(params: {
  readonly driveSyncRootsRepo: DriveSyncRootsRepository;
  readonly seriesRepo: SeriesRepository;
  readonly volumesRepo: VolumesRepository;
  readonly zipIndexCacheRepo: ZipIndexCacheRepository;
  readonly googleAuthBridge: GoogleAuthBridge;
}): CoverExtractionScheduler {
  if (typeof Worker === "undefined") {
    return new NoopCoverExtractionScheduler();
  }

  const isNative = Capacitor.isNativePlatform();
  const isWebDriver = isWebDriverEnvironment();
  const useRealDriveReader = isNative || isWebDriver;

  const scheduler = new CoverExtractionSchedulerCore({
    driveSyncRootsRepo: params.driveSyncRootsRepo,
    seriesRepo: params.seriesRepo,
    volumesRepo: params.volumesRepo,
    zipIndexCacheRepo: params.zipIndexCacheRepo,
    googleAuthBridge: params.googleAuthBridge,
    createRangeReader: (volume) =>
      useRealDriveReader
        ? new GoogleDriveRangeReader({
            driveFileId: volume.driveFileId,
            totalSize: volume.fileSize,
            getAccessToken: (options) =>
              params.googleAuthBridge.getValidAccessToken(options),
            onDiagnostic: (level, message, detail) => {
              diagnosticLogger.log(level, "cover", message, detail);
            },
          })
        : new MockCoverArchiveRangeReader(volume.id),
    createWorkerClient: () => createCoverWorkerClient(),
  });

  if (!isNative && isWebDriver && !readTestCoverExtractionAutoRun()) {
    scheduler.pause("test-harness");
  }

  return scheduler;
}

function useStableService<T>(
  provided: T | undefined,
  createDefault: () => T,
): T {
  const fallbackRef = useRef<T | null>(null);
  return useMemo(() => {
    if (provided) {
      return provided;
    }
    if (!fallbackRef.current) {
      fallbackRef.current = createDefault();
    }
    return fallbackRef.current;
  }, [createDefault, provided]);
}

export function ServiceProvider({
  children,
  appBridge,
  createCoordinatorSession,
  zipIndexCacheRepo,
  readingProgressRepo,
  readerSettingsRepo,
  googleAuthBridge,
  driveSyncRootsRepo,
  driveFolderClient,
  seriesRepo,
  volumesRepo,
  driveSyncMetaRepo,
  driveSyncClient,
  driveSyncEngine,
  coverExtractionScheduler,
}: ServiceProviderProps) {
  const resolvedAppBridge = useStableService(appBridge, createDefaultAppBridge);
  const resolvedZipIndexCacheRepo = useStableService(
    zipIndexCacheRepo,
    createDefaultZipIndexCacheRepo,
  );
  const resolvedReadingProgressRepo = useStableService(
    readingProgressRepo,
    createDefaultReadingProgressRepo,
  );
  const resolvedReaderSettingsRepo = useStableService(
    readerSettingsRepo,
    createDefaultReaderSettingsRepo,
  );

  const defaultAuthRef = useRef<DefaultGoogleAuthResources | null>(null);
  const {
    bridge: resolvedGoogleAuthBridge,
    mockAdapter: resolvedMockGoogleAuthAdapter,
  } = useMemo<DefaultGoogleAuthResources>(() => {
    if (googleAuthBridge) {
      return { bridge: googleAuthBridge };
    }
    if (!defaultAuthRef.current) {
      defaultAuthRef.current = createDefaultGoogleAuthResources();
    }
    return defaultAuthRef.current;
  }, [googleAuthBridge]);

  const resolvedDriveSyncRootsRepo = useStableService(
    driveSyncRootsRepo,
    createDefaultDriveSyncRootsRepo,
  );

  const createDefaultFolderClient = useCallback(
    () => createDefaultDriveFolderClient(resolvedGoogleAuthBridge),
    [resolvedGoogleAuthBridge],
  );
  const resolvedDriveFolderClient = useStableService(
    driveFolderClient,
    createDefaultFolderClient,
  );

  const resolvedMockDriveFolderClient =
    resolvedDriveFolderClient instanceof MockDriveFolderClient
      ? resolvedDriveFolderClient
      : undefined;

  const resolvedSeriesRepo = useStableService(
    seriesRepo,
    createDefaultSeriesRepo,
  );
  const resolvedVolumesRepo = useStableService(
    volumesRepo,
    createDefaultVolumesRepo,
  );
  const resolvedDriveSyncMetaRepo = useStableService(
    driveSyncMetaRepo,
    createDefaultDriveSyncMetaRepo,
  );

  const createDefaultSyncClient = useCallback(
    () => createDefaultDriveSyncClient(resolvedGoogleAuthBridge),
    [resolvedGoogleAuthBridge],
  );
  const resolvedDriveSyncClient = useStableService(
    driveSyncClient,
    createDefaultSyncClient,
  );

  const resolvedMockDriveSyncClient =
    resolvedDriveSyncClient instanceof MockDriveSyncClient
      ? resolvedDriveSyncClient
      : undefined;

  const createDefaultSyncEngine = useCallback(
    () =>
      new DefaultDriveSyncEngine({
        driveSyncClient: resolvedDriveSyncClient,
        driveSyncRootsRepo: resolvedDriveSyncRootsRepo,
        driveSyncMetaRepo: resolvedDriveSyncMetaRepo,
        seriesRepo: resolvedSeriesRepo,
        volumesRepo: resolvedVolumesRepo,
        zipIndexCacheRepo: resolvedZipIndexCacheRepo,
      }),
    [
      resolvedDriveSyncClient,
      resolvedDriveSyncRootsRepo,
      resolvedDriveSyncMetaRepo,
      resolvedSeriesRepo,
      resolvedVolumesRepo,
      resolvedZipIndexCacheRepo,
    ],
  );
  const resolvedDriveSyncEngine = useStableService(
    driveSyncEngine,
    createDefaultSyncEngine,
  );

  const createDefaultCoverScheduler = useCallback(
    () =>
      createDefaultCoverExtractionScheduler({
        driveSyncRootsRepo: resolvedDriveSyncRootsRepo,
        seriesRepo: resolvedSeriesRepo,
        volumesRepo: resolvedVolumesRepo,
        zipIndexCacheRepo: resolvedZipIndexCacheRepo,
        googleAuthBridge: resolvedGoogleAuthBridge,
      }),
    [
      resolvedDriveSyncRootsRepo,
      resolvedSeriesRepo,
      resolvedVolumesRepo,
      resolvedZipIndexCacheRepo,
      resolvedGoogleAuthBridge,
    ],
  );

  const defaultCoverSchedulerRef = useRef<CoverExtractionScheduler | null>(
    null,
  );
  const [defaultCoverSchedulerVersion, setDefaultCoverSchedulerVersion] =
    useState(0);

  const resolvedCoverExtractionScheduler =
    useMemo<CoverExtractionScheduler>(() => {
      void defaultCoverSchedulerVersion;
      if (coverExtractionScheduler) {
        return coverExtractionScheduler;
      }
      if (!defaultCoverSchedulerRef.current) {
        defaultCoverSchedulerRef.current = createDefaultCoverScheduler();
      }
      return defaultCoverSchedulerRef.current;
    }, [
      coverExtractionScheduler,
      createDefaultCoverScheduler,
      defaultCoverSchedulerVersion,
    ]);

  useEffect(() => {
    if (coverExtractionScheduler !== undefined) {
      return undefined;
    }
    if (defaultCoverSchedulerRef.current === null) {
      defaultCoverSchedulerRef.current = createDefaultCoverScheduler();
      setDefaultCoverSchedulerVersion((version) => version + 1);
    }
    return () => {
      defaultCoverSchedulerRef.current?.dispose();
      defaultCoverSchedulerRef.current = null;
    };
  }, [coverExtractionScheduler, createDefaultCoverScheduler]);

  const resolvedCreateCoordinatorSession = useMemo(
    () =>
      createCoordinatorSession ??
      (() =>
        defaultCreateCoordinatorSession({
          authBridge: resolvedGoogleAuthBridge,
        })),
    [createCoordinatorSession, resolvedGoogleAuthBridge],
  );

  useEffect(() => {
    const applySnapshot = useCoverExtractionStateStore.getState().applySnapshot;
    applySnapshot(resolvedCoverExtractionScheduler.getSnapshot());
    return resolvedCoverExtractionScheduler.subscribeProgress(applySnapshot);
  }, [resolvedCoverExtractionScheduler]);

  useEffect(() => {
    let active = true;
    const applyAuthSession = (session: GoogleAuthSession | null): void => {
      if (session === null) {
        resolvedCoverExtractionScheduler.pause("unauthenticated");
        return;
      }
      resolvedCoverExtractionScheduler.resume("unauthenticated");
      void resolvedCoverExtractionScheduler.syncQueue();
    };

    const cached = resolvedGoogleAuthBridge.getCachedSession();
    if (cached !== null) {
      applyAuthSession(cached);
    } else {
      resolvedCoverExtractionScheduler.pause("unauthenticated");
      void resolvedGoogleAuthBridge
        .getSession()
        .then((session) => {
          if (!active) {
            return;
          }
          applyAuthSession(session);
        })
        .catch(() => {
          if (!active) {
            return;
          }
          resolvedCoverExtractionScheduler.pause("unauthenticated");
        });
    }

    const unsubscribe =
      resolvedGoogleAuthBridge.subscribeSession(applyAuthSession);
    return () => {
      active = false;
      unsubscribe();
    };
  }, [resolvedGoogleAuthBridge, resolvedCoverExtractionScheduler]);

  useEffect(() => {
    let prevPhase = useDriveSyncStateStore.getState().phase;
    if (prevPhase === "syncing") {
      resolvedCoverExtractionScheduler.pause("drive-sync");
    }
    return useDriveSyncStateStore.subscribe((state) => {
      const nextPhase = state.phase;
      if (nextPhase === prevPhase) {
        return;
      }
      const wasSyncing = prevPhase === "syncing";
      prevPhase = nextPhase;
      if (nextPhase === "syncing") {
        resolvedCoverExtractionScheduler.pause("drive-sync");
      } else if (wasSyncing) {
        resolvedCoverExtractionScheduler.resume("drive-sync");
        void resolvedCoverExtractionScheduler.syncQueue();
      }
    });
  }, [resolvedCoverExtractionScheduler]);

  useEffect(() => {
    const handleOnline = (): void => {
      void resolvedCoverExtractionScheduler.syncQueue();
    };
    window.addEventListener("online", handleOnline);
    return () => {
      window.removeEventListener("online", handleOnline);
    };
  }, [resolvedCoverExtractionScheduler]);

  useEffect(() => {
    window.__exLibrisServices = buildGlobalServicesState({
      appBridge: resolvedAppBridge,
      mockGoogleAuthAdapter: resolvedMockGoogleAuthAdapter,
      mockDriveFolderClient: resolvedMockDriveFolderClient,
      driveSyncEngine: resolvedDriveSyncEngine,
      seriesRepo: resolvedSeriesRepo,
      volumesRepo: resolvedVolumesRepo,
      driveSyncMetaRepo: resolvedDriveSyncMetaRepo,
      mockDriveSyncClient: resolvedMockDriveSyncClient,
      coverExtractionScheduler: resolvedCoverExtractionScheduler,
    });
  }, [
    resolvedAppBridge,
    resolvedMockGoogleAuthAdapter,
    resolvedMockDriveFolderClient,
    resolvedDriveSyncEngine,
    resolvedSeriesRepo,
    resolvedVolumesRepo,
    resolvedDriveSyncMetaRepo,
    resolvedMockDriveSyncClient,
    resolvedCoverExtractionScheduler,
  ]);

  useEffect(() => {
    if (
      resolvedMockGoogleAuthAdapter === undefined ||
      !shouldPersistTestMockAuth()
    ) {
      return undefined;
    }
    return resolvedGoogleAuthBridge.subscribeSession((session) => {
      writePersistedMockAuthSession(
        session !== null
          ? { email: session.email, accessToken: session.accessToken }
          : null,
      );
    });
  }, [resolvedGoogleAuthBridge, resolvedMockGoogleAuthAdapter]);

  const contextValue = useMemo<ServiceContextValue>(
    () => ({
      appBridge: resolvedAppBridge,
      createCoordinatorSession: resolvedCreateCoordinatorSession,
      zipIndexCacheRepo: resolvedZipIndexCacheRepo,
      readingProgressRepo: resolvedReadingProgressRepo,
      readerSettingsRepo: resolvedReaderSettingsRepo,
      googleAuthBridge: resolvedGoogleAuthBridge,
      driveSyncRootsRepo: resolvedDriveSyncRootsRepo,
      driveFolderClient: resolvedDriveFolderClient,
      seriesRepo: resolvedSeriesRepo,
      volumesRepo: resolvedVolumesRepo,
      driveSyncMetaRepo: resolvedDriveSyncMetaRepo,
      driveSyncClient: resolvedDriveSyncClient,
      driveSyncEngine: resolvedDriveSyncEngine,
      coverExtractionScheduler: resolvedCoverExtractionScheduler,
    }),
    [
      resolvedAppBridge,
      resolvedCreateCoordinatorSession,
      resolvedZipIndexCacheRepo,
      resolvedReadingProgressRepo,
      resolvedReaderSettingsRepo,
      resolvedGoogleAuthBridge,
      resolvedDriveSyncRootsRepo,
      resolvedDriveFolderClient,
      resolvedSeriesRepo,
      resolvedVolumesRepo,
      resolvedDriveSyncMetaRepo,
      resolvedDriveSyncClient,
      resolvedDriveSyncEngine,
      resolvedCoverExtractionScheduler,
    ],
  );

  return (
    <ServiceContext.Provider value={contextValue}>
      {children}
    </ServiceContext.Provider>
  );
}
