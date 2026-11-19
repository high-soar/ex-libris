export interface ExLibrisServicesState {
  isReady: boolean;
}

declare global {
  interface Window {
    __exLibrisServices?: ExLibrisServicesState;
  }
}
