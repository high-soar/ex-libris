import type { AppBridge } from "./bridges/app/types";

export interface ExLibrisServicesState {
  isReady: boolean;
  appBridge?: AppBridge;
}

declare global {
  interface Window {
    __exLibrisServices?: ExLibrisServicesState;
  }
}
