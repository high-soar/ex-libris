import { Capacitor } from "@capacitor/core";
import { type ReactNode, useCallback, useEffect, useMemo, useRef } from "react";
import { CapacitorAppBridge } from "../bridges/app/capacitorAppBridge";
import { MockAppBridge } from "../bridges/app/mockAppBridge";
import type { AppBridge } from "../bridges/app/types";
import { CapacitorGoogleAuthAdapter } from "../bridges/oauth/capacitorGoogleAuthAdapter";
import { GoogleAuthTokenManager } from "../bridges/oauth/googleAuthTokenManager";
import { MockGoogleAuthAdapter } from "../bridges/oauth/mockGoogleAuthAdapter";
import type { GoogleAuthBridge } from "../bridges/oauth/types";
import { GoogleDriveFolderClient } from "../providers/gdrive/googleDriveFolderClient";
import { MockDriveFolderClient } from "../providers/gdrive/mockDriveFolderClient";
import type { DriveFolderClient } from "../providers/gdrive/types";
import { db, resetTestDb } from "../storage/db";
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

function buildGlobalServicesState(
  appBridge: AppBridge,
  mockGoogleAuthAdapter?: MockGoogleAuthAdapter,
  mockDriveFolderClient?: MockDriveFolderClient,
): ExLibrisServicesState {
  if (!shouldExposeResetTestDb()) {
    return {
      isReady: true,
      appBridge,
    };
  }

  return {
    isReady: true,
    appBridge,
    resetTestDb: () => resetTestDb(),
    ...(mockGoogleAuthAdapter !== undefined ? { mockGoogleAuthAdapter } : {}),
    ...(mockDriveFolderClient !== undefined ? { mockDriveFolderClient } : {}),
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
  const mockAdapter = new MockGoogleAuthAdapter();
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
    window.__exLibrisServices = buildGlobalServicesState(
      resolvedAppBridge,
      resolvedMockGoogleAuthAdapter,
      resolvedMockDriveFolderClient,
    );
  }, [
    resolvedAppBridge,
    resolvedMockGoogleAuthAdapter,
    resolvedMockDriveFolderClient,
  ]);

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
    ],
  );

  return (
    <ServiceContext.Provider value={contextValue}>
      {children}
    </ServiceContext.Provider>
  );
}
