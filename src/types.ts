/// <reference types="vite/client" />

import type { AppBridge } from "./bridges/app/types";
import type { MockGoogleAuthAdapter } from "./bridges/oauth/mockGoogleAuthAdapter";
import type { CoverExtractionScheduler } from "./engine/cover/types";
import type { MockDriveFolderClient } from "./providers/gdrive/mockDriveFolderClient";
import type { MockDriveSyncClient } from "./providers/gdrive/mockDriveSyncClient";
import type { DriveSyncEngine } from "./providers/gdrive/types";
import type { DriveSyncMetaRepository } from "./storage/repositories/driveSyncMetaRepository";
import type { SeriesRepository } from "./storage/repositories/seriesRepository";
import type { VolumesRepository } from "./storage/repositories/volumesRepository";

export interface ExLibrisServicesState {
  isReady: boolean;
  appBridge?: AppBridge;
  /** 非ネイティブかつ DEV / test / WebDriver 環境でのみ公開される DB 初期化関数 */
  readonly resetTestDb?: () => Promise<void>;
  /** 非ネイティブかつ DEV / test / WebDriver 環境でのみ公開される OAuth モックアダプタ */
  readonly mockGoogleAuthAdapter?: MockGoogleAuthAdapter;
  /** 非ネイティブかつ DEV / test / WebDriver 環境でのみ公開される Drive フォルダモッククライアント */
  readonly mockDriveFolderClient?: MockDriveFolderClient;
  /** 非ネイティブかつ DEV / test / WebDriver 環境でのみ公開される Drive 同期エンジン */
  readonly driveSyncEngine?: DriveSyncEngine;
  /** 非ネイティブかつ DEV / test / WebDriver 環境でのみ公開される Series Repository */
  readonly seriesRepo?: SeriesRepository;
  /** 非ネイティブかつ DEV / test / WebDriver 環境でのみ公開される Volumes Repository */
  readonly volumesRepo?: VolumesRepository;
  /** 非ネイティブかつ DEV / test / WebDriver 環境でのみ公開される DriveSyncMeta Repository */
  readonly driveSyncMetaRepo?: DriveSyncMetaRepository;
  /** 非ネイティブかつ DEV / test / WebDriver 環境でのみ公開される Drive 同期モッククライアント */
  readonly mockDriveSyncClient?: MockDriveSyncClient;
  /** 非ネイティブかつ DEV / test / WebDriver 環境でのみ公開される表紙抽出スケジューラ */
  readonly coverExtractionScheduler?: CoverExtractionScheduler;
  /** 非ネイティブかつ DEV / test / WebDriver 環境でのみ公開される表紙抽出自動実行トグル */
  readonly setTestCoverExtractionAutoRun?: (enabled: boolean) => void;
}

declare global {
  interface Window {
    __exLibrisServices?: ExLibrisServicesState;
  }
}
