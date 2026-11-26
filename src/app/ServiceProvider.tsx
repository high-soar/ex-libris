import { Capacitor } from "@capacitor/core";
import { type ReactNode, useCallback, useEffect, useMemo, useRef } from "react";
import { CapacitorAppBridge } from "../bridges/app/capacitorAppBridge";
import { MockAppBridge } from "../bridges/app/mockAppBridge";
import type { AppBridge } from "../bridges/app/types";
import { CapacitorGoogleAuthAdapter } from "../bridges/oauth/capacitorGoogleAuthAdapter";
import { GoogleAuthTokenManager } from "../bridges/oauth/googleAuthTokenManager";
import { MockGoogleAuthAdapter } from "../bridges/oauth/mockGoogleAuthAdapter";
import type { GoogleAuthBridge } from "../bridges/oauth/types";
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
import { resetBookshelfUiState } from "../features/bookshelf/bookshelfUiStateStore";
import { resetDriveSyncState } from "../shared/sync/driveSyncStateStore";
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
}

const TEST_MOCK_AUTH_STORAGE_KEY = "exLibris:test:mockGoogleAuthSession";

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
    window.__exLibrisServices = buildGlobalServicesState({
      appBridge: resolvedAppBridge,
      mockGoogleAuthAdapter: resolvedMockGoogleAuthAdapter,
      mockDriveFolderClient: resolvedMockDriveFolderClient,
      driveSyncEngine: resolvedDriveSyncEngine,
      seriesRepo: resolvedSeriesRepo,
      volumesRepo: resolvedVolumesRepo,
      driveSyncMetaRepo: resolvedDriveSyncMetaRepo,
      mockDriveSyncClient: resolvedMockDriveSyncClient,
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
    ],
  );

  return (
    <ServiceContext.Provider value={contextValue}>
      {children}
    </ServiceContext.Provider>
  );
}
