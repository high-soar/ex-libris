import type { ZipCompressionMethod } from "../types";

export interface EncodeCoverWebpOptions {
  readonly maxLongEdgePx?: number;
  readonly webpQuality?: number;
}

export interface EncodeCoverWebpResult {
  readonly blob: Blob;
  readonly width: number;
  readonly height: number;
}

export interface CoverResizeWorkerApi {
  encodeCoverWebp(
    compressedData: Uint8Array,
    compressionMethod: ZipCompressionMethod,
    options?: EncodeCoverWebpOptions,
  ): Promise<EncodeCoverWebpResult>;
}

export type CoverExtractionPauseReason =
  "reader" | "drive-sync" | "unauthenticated" | "test-harness";

export type CoverViewportScreenKey = "bookshelf" | "series-detail";

export type CoverExtractionPhase = "idle" | "running" | "paused" | "backoff";

export interface CoverExtractionProgressSnapshot {
  readonly phase: CoverExtractionPhase;
  /** 有効ルート配下・非ゴミ箱の全対象巻数（ready + pending + error） */
  readonly totalCount: number;
  readonly readyCount: number;
  readonly pendingCount: number;
  readonly errorCount: number;
  readonly activeVolumeId: string | null;
  readonly pauseReasons: readonly CoverExtractionPauseReason[];
}

export interface CoverExtractionVolumeUpdateEvent {
  readonly volumeId: string;
  readonly seriesId: string;
  readonly coverStatus: "pending" | "ready" | "error";
  readonly coverBlob: Blob | null;
  readonly coverUpdatedAt: number | null;
}

export interface CoverExtractionScheduler {
  /** DB の現在状態からキュー対象と集計値を同期し、稼働条件を満たせばワーカーを起動する */
  syncQueue(): Promise<void>;
  /** 画面ごとの可視 pending 巻集合を更新し、viewport-high 昇格／background-low 降格を即時反映する */
  setViewportVolumeIds(
    screen: CoverViewportScreenKey,
    volumeIds: ReadonlySet<string>,
  ): void;
  /** 指定理由で即座に一時停止し、進行中の Range 通信・待機タイマーを同期 abort する */
  pause(reason: CoverExtractionPauseReason): void;
  /** 指定理由の一時停止を解除し、全停止理由が解消かつキュー残があれば再開する */
  resume(reason: CoverExtractionPauseReason): void;
  /** 有効ルート配下の error 巻（seriesId 指定時は当該シリーズのみ）を pending に戻して再キュー投入する */
  retryFailedCovers(options?: { readonly seriesId?: string }): Promise<number>;
  getSnapshot(): CoverExtractionProgressSnapshot;
  subscribeProgress(
    listener: (snapshot: CoverExtractionProgressSnapshot) => void,
  ): () => void;
  subscribeVolumeUpdated(
    listener: (event: CoverExtractionVolumeUpdateEvent) => void,
  ): () => void;
  /** テスト環境リセット用：進行中処理を全中断し内部状態・集計値を初期化する */
  resetForTest(): Promise<void>;
  dispose(): void;
}
