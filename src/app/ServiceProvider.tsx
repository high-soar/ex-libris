import { Capacitor } from "@capacitor/core";
import { type ReactNode, useEffect, useMemo, useRef } from "react";
import { CapacitorAppBridge } from "../bridges/app/capacitorAppBridge";
import { MockAppBridge } from "../bridges/app/mockAppBridge";
import type { AppBridge } from "../bridges/app/types";
import { db, resetTestDb } from "../storage/db";
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
}: ServiceProviderProps) {
  const fallbackAppBridgeRef = useRef<AppBridge | null>(null);
  const fallbackZipIndexCacheRepoRef = useRef<ZipIndexCacheRepository | null>(
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
    }),
    [
      resolvedAppBridge,
      resolvedCreateCoordinatorSession,
      resolvedZipIndexCacheRepo,
    ],
  );

  return (
    <ServiceContext.Provider value={contextValue}>
      {children}
    </ServiceContext.Provider>
  );
}
