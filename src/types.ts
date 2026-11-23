/// <reference types="vite/client" />

import type { AppBridge } from "./bridges/app/types";

export interface ExLibrisServicesState {
  isReady: boolean;
  appBridge?: AppBridge;
  /** 非ネイティブかつ DEV / test / WebDriver 環境でのみ公開される DB 初期化関数 */
  readonly resetTestDb?: () => Promise<void>;
}

declare global {
  interface Window {
    __exLibrisServices?: ExLibrisServicesState;
  }
}
