import { Capacitor } from "@capacitor/core";
import { type ReactNode, useEffect, useMemo, useRef } from "react";
import { CapacitorAppBridge } from "../bridges/app/capacitorAppBridge";
import { MockAppBridge } from "../bridges/app/mockAppBridge";
import type { AppBridge } from "../bridges/app/types";
import {
  createCoordinatorSession as defaultCreateCoordinatorSession,
  type CoordinatorSessionHandle,
} from "./coordinatorClient";
import { ServiceContext, type ServiceContextValue } from "./serviceContext";

export interface ServiceProviderProps {
  readonly children?: ReactNode;
  readonly appBridge?: AppBridge;
  readonly createCoordinatorSession?: () => CoordinatorSessionHandle;
}

export function ServiceProvider({
  children,
  appBridge,
  createCoordinatorSession,
}: ServiceProviderProps) {
  const fallbackAppBridgeRef = useRef<AppBridge | null>(null);

  const resolvedAppBridge = useMemo(() => {
    if (appBridge) {
      return appBridge;
    }
    if (!fallbackAppBridgeRef.current) {
      fallbackAppBridgeRef.current = Capacitor.isNativePlatform()
        ? new CapacitorAppBridge()
        : new MockAppBridge();
    }
    return fallbackAppBridgeRef.current;
  }, [appBridge]);

  const resolvedCreateCoordinatorSession =
    createCoordinatorSession ?? defaultCreateCoordinatorSession;

  useEffect(() => {
    window.__exLibrisServices = {
      isReady: true,
      appBridge: resolvedAppBridge,
    };
  }, [resolvedAppBridge]);

  const contextValue = useMemo<ServiceContextValue>(
    () => ({
      appBridge: resolvedAppBridge,
      createCoordinatorSession: resolvedCreateCoordinatorSession,
    }),
    [resolvedAppBridge, resolvedCreateCoordinatorSession],
  );

  return (
    <ServiceContext.Provider value={contextValue}>
      {children}
    </ServiceContext.Provider>
  );
}
