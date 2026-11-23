import { Capacitor } from "@capacitor/core";
import { type ReactNode, useEffect, useMemo, useRef } from "react";
import { CapacitorAppBridge } from "../bridges/app/capacitorAppBridge";
import { MockAppBridge } from "../bridges/app/mockAppBridge";
import type { AppBridge } from "../bridges/app/types";
import { db, resetTestDb } from "../storage/db";
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
}

export interface ResetTestDbExposureOptions {
  readonly isNativePlatform?: boolean;
  readonly isDev?: boolean;
  readonly mode?: string;
  readonly isWebDriver?: boolean;
}

// eslint-disable-next-line react-refresh/only-export-components
export function shouldExposeResetTestDb(
  options: ResetTestDbExposureOptions = {},
): boolean {
  const isNativePlatform =
    options.isNativePlatform ?? Capacitor.isNativePlatform();
  if (isNativePlatform) {
    return false;
  }
  const isDev = options.isDev ?? import.meta.env.DEV;
  const mode = options.mode ?? import.meta.env.MODE;
  const isWebDriver =
    options.isWebDriver ??
    (typeof navigator !== "undefined" && navigator.webdriver === true);
  return isDev || mode === "test" || isWebDriver;
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

  const resolvedCreateCoordinatorSession =
    createCoordinatorSession ?? defaultCreateCoordinatorSession;

  useEffect(() => {
    const exposeResetTestDb = shouldExposeResetTestDb();
    window.__exLibrisServices = {
      isReady: true,
      appBridge: resolvedAppBridge,
      ...(exposeResetTestDb ? { resetTestDb: () => resetTestDb() } : {}),
    };
  }, [resolvedAppBridge]);

  const contextValue = useMemo<ServiceContextValue>(
    () => ({
      appBridge: resolvedAppBridge,
      createCoordinatorSession: resolvedCreateCoordinatorSession,
      zipIndexCacheRepo: resolvedZipIndexCacheRepo,
      readingProgressRepo: resolvedReadingProgressRepo,
      readerSettingsRepo: resolvedReaderSettingsRepo,
    }),
    [
      resolvedAppBridge,
      resolvedCreateCoordinatorSession,
      resolvedZipIndexCacheRepo,
      resolvedReadingProgressRepo,
      resolvedReaderSettingsRepo,
    ],
  );

  return (
    <ServiceContext.Provider value={contextValue}>
      {children}
    </ServiceContext.Provider>
  );
}
