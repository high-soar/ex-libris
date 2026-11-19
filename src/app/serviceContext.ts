import { createContext } from "react";
import type { AppBridge } from "../bridges/app/types";
import type { CoordinatorSessionHandle } from "./coordinatorClient";

export interface ServiceContextValue {
  readonly appBridge: AppBridge;
  readonly createCoordinatorSession: () => CoordinatorSessionHandle;
}

export const ServiceContext = createContext<ServiceContextValue | null>(null);

export function useServices(): ServiceContextValue {
  throw new Error("Not implemented");
}
