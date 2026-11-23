/// <reference types="vite/client" />

import type { AppBridge } from "./bridges/app/types";
import type { MockGoogleAuthAdapter } from "./bridges/oauth/mockGoogleAuthAdapter";
import type { MockDriveFolderClient } from "./providers/gdrive/mockDriveFolderClient";

export interface ExLibrisServicesState {
  isReady: boolean;
  appBridge?: AppBridge;
  /** 非ネイティブかつ DEV / test / WebDriver 環境でのみ公開される DB 初期化関数 */
  readonly resetTestDb?: () => Promise<void>;
  /** 非ネイティブかつ DEV / test / WebDriver 環境でのみ公開される OAuth モックアダプタ */
  readonly mockGoogleAuthAdapter?: MockGoogleAuthAdapter;
  /** 非ネイティブかつ DEV / test / WebDriver 環境でのみ公開される Drive フォルダモッククライアント */
  readonly mockDriveFolderClient?: MockDriveFolderClient;
}

declare global {
  interface Window {
    __exLibrisServices?: ExLibrisServicesState;
  }
}
