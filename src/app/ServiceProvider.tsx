import { Capacitor } from "@capacitor/core";
import { type ReactNode, useEffect, useMemo, useRef } from "react";
import { CapacitorAppBridge } from "../bridges/app/capacitorAppBridge";
import { MockAppBridge } from "../bridges/app/mockAppBridge";
import type { AppBridge } from "../bridges/app/types";
import { resetTestDb } from "../storage/db";
import type { ZipIndexCacheRepository } from "../storage/repositories/zipIndexCacheRepository";
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

const RED_STUB_ZIP_INDEX_CACHE_REPO: ZipIndexCacheRepository = {
  get: async () => null,
  put: async () => {},
  delete: async () => {},
};

function createDefaultAppBridge(): AppBridge {
  return Capacitor.isNativePlatform()
    ? new CapacitorAppBridge()
    : new MockAppBridge();
}

export function ServiceProvider({
  children,
  appBridge,
  createCoordinatorSession,
  zipIndexCacheRepo: _zipIndexCacheRepo,
}: ServiceProviderProps) {
  const fallbackAppBridgeRef = useRef<AppBridge | null>(null);

  const resolvedAppBridge = useMemo(() => {
    if (appBridge) {
      return appBridge;
    }
    if (!fallbackAppBridgeRef.current) {
      fallbackAppBridgeRef.current = createDefaultAppBridge();
    }
    return fallbackAppBridgeRef.current;
  }, [appBridge]);

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
      zipIndexCacheRepo: RED_STUB_ZIP_INDEX_CACHE_REPO,
    }),
    [resolvedAppBridge, resolvedCreateCoordinatorSession],
  );

  return (
    <ServiceContext.Provider value={contextValue}>
      {children}
    </ServiceContext.Provider>
  );
}
