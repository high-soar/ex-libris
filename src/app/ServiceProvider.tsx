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

function createDefaultAppBridge(): AppBridge {
  return Capacitor.isNativePlatform()
    ? new CapacitorAppBridge()
    : new MockAppBridge();
}

export function ServiceProvider({
  children,
  appBridge,
  createCoordinatorSession,
  zipIndexCacheRepo,
  readingProgressRepo,
  readerSettingsRepo,
}: ServiceProviderProps) {
  const fallbackAppBridgeRef = useRef<AppBridge | null>(null);
  const fallbackZipIndexCacheRepoRef = useRef<ZipIndexCacheRepository | null>(
    null,
  );
  const fallbackReadingProgressRepoRef =
    useRef<ReadingProgressRepository | null>(null);
  const fallbackReaderSettingsRepoRef = useRef<ReaderSettingsRepository | null>(
    null,
  );

  const resolvedAppBridge = useMemo(() => {
    if (appBridge) {
      return appBridge;
    }
    if (!fallbackAppBridgeRef.current) {
      fallbackAppBridgeRef.current = createDefaultAppBridge();
    }
    return fallbackAppBridgeRef.current;
  }, [appBridge]);

  const resolvedZipIndexCacheRepo = useMemo(() => {
    if (zipIndexCacheRepo) {
      return zipIndexCacheRepo;
    }
    if (!fallbackZipIndexCacheRepoRef.current) {
      fallbackZipIndexCacheRepoRef.current = new DexieZipIndexCacheRepository(
        db,
      );
    }
    return fallbackZipIndexCacheRepoRef.current;
  }, [zipIndexCacheRepo]);

  const resolvedReadingProgressRepo = useMemo(() => {
    if (readingProgressRepo) {
      return readingProgressRepo;
    }
    if (!fallbackReadingProgressRepoRef.current) {
      fallbackReadingProgressRepoRef.current =
        new DexieReadingProgressRepository(db);
    }
    return fallbackReadingProgressRepoRef.current;
  }, [readingProgressRepo]);

  const resolvedReaderSettingsRepo = useMemo(() => {
    if (readerSettingsRepo) {
      return readerSettingsRepo;
    }
    if (!fallbackReaderSettingsRepoRef.current) {
      fallbackReaderSettingsRepoRef.current = new DexieReaderSettingsRepository(
        db,
      );
    }
    return fallbackReaderSettingsRepoRef.current;
  }, [readerSettingsRepo]);

  const resolvedCreateCoordinatorSession =
    createCoordinatorSession ?? defaultCreateCoordinatorSession;

  useEffect(() => {
    window.__exLibrisServices = {
      isReady: true,
      appBridge: resolvedAppBridge,
      resetTestDb: () => resetTestDb(),
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
