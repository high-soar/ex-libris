import type { AppBridge } from "./bridges/app/types";

export interface ExLibrisServicesState {
  isReady: boolean;
  appBridge?: AppBridge;
  readonly resetTestDb?: () => Promise<void>;
}

declare global {
  interface Window {
    __exLibrisServices?: ExLibrisServicesState;
  }
}
