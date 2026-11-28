---
type: spec-engine
title: "2段優先度・表紙 WebP 自動抽出スケジューラ ＆ 閲覧優先プリエンプション仕様書"
description: "専用 cover.worker（長辺350px WebP縮小・即時 bitmap.close()）、CoverExtractionSchedulerCore（viewport-high 即時優先＋background-low 最大2冊/秒）、zipIndexCache 0RTT共有・自己修復、429/403指数バックオフ、およびSCR-03/Drive同期プリエンプションの正本"
status: "Approved"
updated: "2026-11-28"
tags:
  [
    engine,
    cover,
    webp,
    scheduler,
    preemption,
    rate-limit,
    backoff,
    intersection-observer,
    web-worker,
    google-drive,
  ]
related_specs:
  - docs/index.md
  - docs/specs/requirements.md
  - docs/specs/architecture.md
  - docs/specs/db-schema.md
  - docs/specs/screen-transitions.md
  - docs/specs/engine/zip-streaming.md
  - docs/specs/features/bookshelf.md
  - docs/specs/features/series-detail.md
  - docs/specs/features/reader.md
  - docs/specs/features/settings.md
  - docs/specs/providers/google-drive.md
  - docs/guidelines/testing.md
related_tests:
  - src/App.test.tsx
  - src/app/ServiceProvider.test.tsx
  - src/app/coverWorkerClient.test.ts
  - src/engine/constants.test.ts
  - src/engine/cover/CoverExtractionSchedulerCore.test.ts
  - src/engine/cover/CoverResizeWorkerCore.test.ts
  - src/engine/cover/MockCoverArchiveRangeReader.test.ts
  - src/engine/io/GoogleDriveRangeReader.test.ts
  - src/engine/workers/comlinkErrorHandler.test.ts
  - src/engine/zip/decompressSlice.test.ts
  - src/engine/zip/errors.test.ts
  - src/engine/zip/zipParser.test.ts
  - src/shared/bookshelf/seriesOrdering.test.ts
  - src/shared/sync/coverExtractionStateStore.test.ts
  - src/shared/ui/CoverThumbnail.test.tsx
  - src/shared/ui/useViewportVolumeObserver.test.ts
  - src/storage/repositories/volumesRepository.test.ts
  - src/storage/repositories/zipIndexCacheRepository.test.ts
  - test/it/cover-extraction.spec.ts
---

# 2段優先度・表紙 WebP 自動抽出スケジューラ ＆ 閲覧優先プリエンプション仕様書

本ドキュメントは、ExLibris の **Layer 2（Engine Worker Layer）** および **Layer 4（UI / DI 連携境界）** に属する表紙サムネイル WebP 自動抽出パイプライン（`src/engine/cover/`）、2 段優先度スケジューラ（`CoverExtractionSchedulerCore`）、`429` / `403` レート制限バックオフ、およびリーダー閲覧最優先プリエンプション（`NFR-04`）の正本（Single Source of Truth）です。

---

## 1. 設計原則とスレッド分離アーキテクチャ

1. **リーダー専用 Worker プールとの完全分離（60fps スクロール保護 ＆ 即時中断）**:
   - `SCR-03`（`ReaderPage`）が閲覧セッション単位で生成・破棄する `coordinator.worker.ts` ＋ `DecodeWorkerPool`（2 Worker）とは完全に分離し、表紙抽出専用の軽量単一 Worker（`src/engine/cover/cover.worker.ts` ＆ `CoverResizeWorkerCore.ts`）を設ける。
   - スケジューラ状態機械・キュー優先度制御・`AbortController` 管理・`GoogleDriveRangeReader` による HTTP `Range` 取得・`zipIndexCache` / `volumes` の IndexedDB 読み書きは Main Thread 側の純粋クラス（`CoverExtractionSchedulerCore.ts`）に配置する。これにより、`SCR-03` 遷移瞬間（`pause("reader")`）に Worker 間 IPC 遅延ゼロで進行中 `fetch` の `AbortController.abort()` を同期発火できる。
   - CPU / メモリ負荷の高い圧縮ストリーム伸長（Deflate）、高解像度スキャン画像（3000×4200px 級）の `createImageBitmap` デコード、`OffscreenCanvas` による長辺上限 350px への縮小描画、および WebP エンコード（`convertToBlob`）はすべて `cover.worker.ts` 内で実行し、描画直後に Worker 内で即座に `bitmap.close()` することで Main Thread の 60fps スクロールと VRAM 予算を保護する。
2. **LWW タイムスタンプ（`updatedAt`）の厳格保護（[db-schema.md §1 原則 4](../db-schema.md#1-データベース設計-5-原則)）**:
   - 表紙抽出の成功（`coverStatus = "ready"`, `coverBlob`, `coverUpdatedAt`）・失敗（`coverStatus = "error"`, `coverBlob = null`, `coverUpdatedAt`）・エラー再試行リセット（`coverStatus = "pending"`, `coverBlob = null`, `coverUpdatedAt = null`）のいずれにおいても、**`volumes.updatedAt` および `series.updatedAt` は一切変更しない**。
3. **ZIP 目次キャッシュ（`zipIndexCache`）の双方向活用と 1 回限り自己修復**:
   - 識別キー `gdrive:${driveFileId}:${md5Checksum ?? fileSize}` で既存の `ZipIndexCacheRepository`（最大 500 件 LRU）を参照し、ヒット時は EOCD / Central Directory 取得を 0 RTT でスキップする。未取得時は `parseZipDirectory` で解析した `entries` を `zipIndexCache` へも還元保存し、直後にユーザーがその巻を `SCR-03` で開いた際の 0 RTT オープン（`fromIndexCache: true`, `NFR-01` `< 0.5s`）を実現する。

---

## 2. モジュール構成と責務境界（4層・純粋テスト規約）

| モジュールパス                                     |  レイヤー  | 責務                                                                                                                                                                                                                      |
| :------------------------------------------------- | :--------: | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/engine/constants.ts`                          |  共通定数  | 表紙抽出関連定数（`COVER_BG_MAX_PER_SECOND`, `COVER_MAX_LONG_EDGE_PX`, `COVER_WEBP_QUALITY`, `COVER_RATE_LIMIT_MAX_RETRIES`, `COVER_RATE_LIMIT_BASE_BACKOFF_MS`）を `ENGINE_BUDGETS` で一元管理                           |
| `src/engine/zip/decompressSlice.ts`                |  Layer 2   | Store (`0`) / Deflate (`8`: `DecompressionStream("deflate-raw")` ＋ `fflate.Inflate` ストリーミングフォールバック) 伸長純関数および伸長サイズ上限ガード（`DecodeWorkerCore` / `CoverResizeWorkerCore` 共用）              |
| `src/engine/cover/types.ts`                        |  Layer 2   | `CoverResizeWorkerApi`, `CoverWorkerClientHandle`, `CoverExtractionPauseReason`, `CoverExtractionPhase`, `CoverExtractionProgressSnapshot`, `CoverExtractionVolumeUpdateEvent`, `CoverExtractionScheduler` 等の純粋型定義 |
| `src/engine/cover/CoverResizeWorkerCore.ts`        |  Layer 2   | Worker グローバル非依存の伸長（`expectedUncompressedSize` 上限ガード付き）・`createImageBitmap`・`OffscreenCanvas` 長辺上限 350px 縮小・WebP `Blob` 変換・`finally` 即時 `bitmap.close()` 実装                            |
| `src/engine/cover/cover.worker.ts`                 |  Layer 2   | `registerZipArchiveErrorTransferHandler()` 登録、`CoverResizeWorkerCore` 初期化、および `Comlink.expose` のみの薄いブートストラップ（条件分岐ゼロ）                                                                       |
| `src/engine/cover/CoverExtractionSchedulerCore.ts` |  Layer 2   | 2 段優先度キュー（`viewport-high` / `background-low`）、優先度跨ぎレート制御、理由別 `pause`/`resume`、`429`/`403`・一時通信障害指数バックオフ、`zipIndexCache` 自己修復、DB 保存連携・耐障害性状態機械                   |
| `src/engine/cover/MockCoverArchiveRangeReader.ts`  |  Layer 2   | 通常 Web プレビュー（非ネイティブ・非 WebDriver）で外部通信ゼロ（`NFR-05`）のまま決定論的モック ZIP バイナリを返す表紙抽出用 `ArchiveRangeReader`                                                                         |
| `src/shared/bookshelf/seriesOrdering.ts`           | 共有純関数 | シリーズ並び順（`sortSeriesItems`）および代表表紙巻解決（`resolveRepresentativeVolume`）の UI 非依存 SSOT（`CoverExtractionSchedulerCore` と `bookshelfViewModel` の双方から参照）                                        |
| `src/app/coverWorkerClient.ts`                     |  Layer 4   | `cover.worker.ts` の生成・Comlink ラップ・`prepareDecodeTransfer` 送信バッファ分離・`error`/`messageerror` クラッシュ検知時即時 `DECODE_FAILED` reject・`dispose()` 時保留中/破棄後 RPC 即時 `AbortError` reject          |
| `src/shared/sync/coverExtractionStateStore.ts`     |  Layer 4   | `SCR-01` / `SCR-02` / `SCR-04` 横断の表紙抽出進捗スナップショット（`phase`, `totalCount`, `readyCount`, `pendingCount`, `errorCount`, `activeVolumeId`, `pauseReasons`）を保持する Zustand ストア                         |
| `src/shared/ui/useViewportVolumeObserver.ts`       |  Layer 4   | `SCR-01` / `SCR-02` の `data-cover-volume-id` 要素を `IntersectionObserver`（`rootMargin: "200px 0px"`）で監視し、`viewport-high` 対象巻 ID 集合をスケジューラへ通知する共通フック                                        |

---

## 3. 表紙抽出基準定数と専用 Worker 契約

### 3.1 基準定数（`ENGINE_BUDGETS` 拡張）

| 定数名                             | 設定値 | 設計根拠・用途                                                                                    |
| :--------------------------------- | :----: | :------------------------------------------------------------------------------------------------ |
| `COVER_BG_MAX_PER_SECOND`          |  `2`   | `background-low` キューの最大処理レート（最小間隔 `500ms` = `Math.ceil(1000 / 2)`）               |
| `COVER_MAX_LONG_EDGE_PX`           | `350`  | 表紙 WebP の長辺最大ピクセル数（元画像の長辺が 350px 以下の場合は拡大せず元寸法を維持）           |
| `COVER_WEBP_QUALITY`               | `0.8`  | `OffscreenCanvas.convertToBlob({ type: "image/webp", quality })` の品質係数（約 15〜25KB/冊目安） |
| `COVER_RATE_LIMIT_MAX_RETRIES`     |  `3`   | 同一巻に対する `429` / `403` Rate Limit 応答時の最大自動リトライ回数（初回含め最大 4 回試行）     |
| `COVER_RATE_LIMIT_BASE_BACKOFF_MS` | `1000` | Rate Limit 検知時の指数バックオフ基準待機時間（`1000ms → 2000ms → 4000ms`）                       |

### 3.2 `CoverResizeWorkerCore` と `coverWorkerClient` 契約

```ts
export interface EncodeCoverWebpOptions {
  readonly maxLongEdgePx?: number;
  readonly webpQuality?: number;
  readonly expectedUncompressedSize?: number;
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
```

1. **`CoverResizeWorkerCore.encodeCoverWebp` 処理手順**:
   - `decompressZipSlice(compressedData, compressionMethod, { ...deps, maxUncompressedBytes: computeMaxDecompressedBytes(options?.expectedUncompressedSize) })` で伸長バイト列を取得し（`expectedUncompressedSize + 1KB` マージン、かつ絶対上限 `160 MiB` を超過した場合は Zip Bomb / OOM 防止のため即時切断して `ZipArchiveError("DECODE_FAILED", ...)` を送出）、`new Blob([rawBytes])` から `createImageBitmap(blob)` を実行する（失敗時は `ZipArchiveError("DECODE_FAILED", ...)`）。
   - `bitmap` 取得後は必ず `try { ... } finally { bitmap.close(); }` ブロック内で処理し、後続の検証・描画・エンコードのいずれで例外が発生しても **`bitmap.close()` が 100% 実行される** ことを保証する。
   - `bitmap.width <= 0 || bitmap.height <= 0`（または非有限値）の場合は `ZipArchiveError("DECODE_FAILED", ...)` を送出する。
   - 縮小寸法の算出（拡大禁止）：
     - `maxLongEdge = options?.maxLongEdgePx ?? ENGINE_BUDGETS.COVER_MAX_LONG_EDGE_PX`
     - `longEdge = Math.max(bitmap.width, bitmap.height)`
     - `scale = longEdge > maxLongEdge ? maxLongEdge / longEdge : 1`
     - `targetWidth = Math.max(1, Math.round(bitmap.width * scale))`
     - `targetHeight = Math.max(1, Math.round(bitmap.height * scale))`
   - `createOffscreenCanvas(targetWidth, targetHeight)`（デフォルト `new OffscreenCanvas(w, h)`）から `"2d"` コンテキストを取得し（`null` 時は `DECODE_FAILED`）、`imageSmoothingEnabled = true`, `imageSmoothingQuality = "high"` を設定して `ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight)` を実行する。
   - `await canvas.convertToBlob({ type: "image/webp", quality: options?.webpQuality ?? ENGINE_BUDGETS.COVER_WEBP_QUALITY })` を呼び出し、`blob.size > 0` を検証（0 バイト時は `DECODE_FAILED`）して `{ blob, width: targetWidth, height: targetHeight }` を返却する。
2. **`coverWorkerClient` の転送保護・異常終了自己復旧・破棄時 RPC 決済**:
   - Main Thread から Worker へ `compressedData` を渡す際は、`coordinatorTransfer.prepareDecodeTransfer(compressedData)` を用いて部分 `subarray` の余剰バッファ転送・共有デタッチを防止する。
   - `cover.worker.ts` の `"error"` / `"messageerror"` イベントを購読し、クラッシュ発生時は `diagnosticLogger.error("cover", "Cover Workerが異常終了しました", detail)` を記録して当該セッションを `broken` 化し、保留中・後続 RPC を即時 `ZipArchiveError("DECODE_FAILED", ...)` で reject する。
   - `dispose()` 時は保留中の全 `pendingRejects` を `DOMException(..., "AbortError")` で明示 reject してから `clear()` し、破棄後の新規 RPC 呼び出しも即座に `AbortError` で reject する（`loopPromise` の永久ハングを防止）。
   - `CoverExtractionSchedulerCore` は Worker セッションが `broken` になった場合、古いセッションを `dispose()` して次回タスク実行時に新しい Worker セッションを遅延再生成する（単一の破損画像によるセッション恒久停止を防止する）。

---

## 4. `CoverExtractionSchedulerCore`（2段優先度・レート制限・プリエンプション状態機械）

### 4.1 インターフェース契約

```ts
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
```

### 4.2 対象抽出・2 段キュー優先順・`IntersectionObserver` 昇格/降格・直列 `syncQueue()` ルール

1. **対象巻の抽出・起動タイミング・直列再同期契約**:
   - `syncQueue()` は以下のタイミングで呼び出す：①`ServiceProvider` 初期認証確認完了・セッション変化時、②手動 Drive 同期（`DriveSyncEngine.sync()`）完了時、③`SCR-04` でのルートフォルダ登録・有効/無効切替・登録解除時、④`retryFailedCovers()` 完了時、⑤端末のオンライン復帰（`AndroidManifest.xml` の `ACCESS_NETWORK_STATE` 権限で有効化された `window` の `online` イベント）およびアプリフォアグラウンド復帰（`document` の `visibilitychange` `visible` かつ `idle`・`pendingCount > 0`・`pauseReasons` 空）時。
   - **並列 `syncQueue()` の最新世代直列化**: `syncQueue()` が重複呼び出しされた場合は内部直列化（または `syncGeneration` カウンタによる後発優先再実行）を行い、古い DB 読込結果が新しいルート状態を上書きしないことを保証する。また `googleAuthBridge.getCachedSession() !== null` が確認できた場合は、取り残された `"unauthenticated"` 停止理由を安全に自動解除する。
   - `DriveSyncRootsRepository.listActive()` の `enabled === 1` ルート集合 `enabledRootIds`、`VolumesRepository.listVisibleByEnabledRoots(enabledRootIds)`（`isTrashed === 0`）、および `SeriesRepository.listActive()`（`deletedAt === null`）を取得し、`totalCount` / `readyCount` / `pendingCount` / `errorCount`（`totalCount === readyCount + pendingCount + errorCount`）を算出する。
   - **進行中 `activeVolumeId` のルート無効化即時 `abort()` と重複エンキュー防止**:
     - `activeVolumeId !== null` の巻が今回の有効対象（`enabledRootIds` 配下かつ `isTrashed === 0` かつ `coverStatus === "pending"`）から外れていた場合（例：`SCR-04` で所属ルートが無効化・解除された場合）は、即座に `schedulerEpoch` をインクリメントし進行中の `AbortController.abort()` を同期発火して不要な Range 通信を停止する。
     - `activeVolumeId !== null` の巻が引き続き有効対象の `pending` 巻として実行中である場合は、待機キュー（`viewport-high` / `background-low`）へ二重投入せず実行中スロットとして保持し、`pendingCount` には当該実行中 1 冊を含めて計上する。
   - **`coverStatus === "pending"` の巻のみ** を自動抽出キュー候補とする（`coverStatus === "error"` の巻は起動時・画面遷移時の無限 API ループを防ぐため自動投入せず、`retryFailedCovers` 明示実行または Drive 同期時の MD5/サイズ変更による `pending` リセット時のみ対象とする）。
   - **`retryFailedCovers(options)` の `"pending"` イベント即時配信**: `VolumesRepository.resetErrorCoversToPending` で `"pending"` に戻された全巻について、即座に `subscribeVolumeUpdated({ volumeId, seriesId, coverStatus: "pending", coverBlob: null, coverUpdatedAt: null })` を配信してから `await syncQueue()` を実行する。これにより `SCR-01` / `SCR-02` 上の該当カードが単一の購読経路で即座に `"pending"` 表示（`data-cover-volume-id` 付与）へ復帰し、画面内にあればそのまま `viewport-high` へ再昇格する。
2. **`background-low` 内の 2 段階優先順位**:
   - 本棚ホーム（`SCR-01`）のシリーズカード表紙がいち早く揃うよう、`background-low` 候補は以下の順で決定論的に並べる：
     1. **第 1 優先（シリーズ代表表紙巻）**: 有効シリーズ一覧（`src/shared/bookshelf/seriesOrdering.ts` の `sortSeriesItems(..., "lastReadDesc")` 順）の各代表表紙巻（`resolveRepresentativeVolumeNonEmpty` により `representativeVolumeId` が所属有効巻内にあればその巻、なければ先頭巻）のうち `coverStatus === "pending"` のもの。
     2. **第 2 優先（残りの収録巻）**: 上記以外の `coverStatus === "pending"` 有効巻（所属シリーズの並び順 → `compareVolumesForDisplay` 昇順。所属シリーズ未解決の孤立有効巻がある場合は末尾に `compareVolumesForDisplay` 昇順で付加）。
3. **`viewport-high`（画面内即時優先）への昇格・画面外降格・動的再監視境界**:
   - `SCR-01`（代表表紙が `pending` の `SeriesCard`）および `SCR-02`（`pending` の `SeriesSummaryCard` 代表巻・`SeriesVolumeListSection` 各巻行）は、`useViewportVolumeObserver`（`IntersectionObserver` `rootMargin: "200px 0px"`、`typeof IntersectionObserver === "undefined"` の JSDOM 等では安全に no-op フォールバック）で可視集合を検知し、`setViewportVolumeIds(screen, visibleIds)` へ通知する。
   - **動的属性変化への追従**: 初回非同期読込完了・ソート変更・`pending -> ready/error` 完了・`error -> pending` 再試行により描画中の `pending` 巻 ID リストが変化した際、`useViewportVolumeObserver` はコンテナ配下の `data-cover-volume-id` 要素群を再走査して監視対象を更新し、`pending` 対象外になった ID を可視集合から即時除外して通知する（アンマウント時は `observer.disconnect()` の上、空 `Set` でクリアする）。
   - 全画面の可視集合の和集合 `activeViewportIds` に含まれる未着手の `pending` 巻は即座に `viewport-high` キューへ昇格する。
   - 高速スクロールや画面遷移により着手前に `activeViewportIds` から外れた巻は、`viewport-high` に滞留させず即座に `background-low`（代表表紙巻なら第 1 優先先頭側、収録巻なら第 2 優先側）へ降格させる。

### 4.3 直列実行・優先度跨ぎレート制御（2冊/秒）・世代ガード（[testing.md §3.1](../../guidelines/testing.md#3-単体テストvrt結合テストitの衛生非同期規律継承-kaizen)）

1. **同時実行数 `1`（直列ループ）とエポック管理**:
   - 進行中の抽出タスクは常に最大 **1 冊** とする。
   - 内部に単調増加する `schedulerEpoch` カウンタを持ち、`pause()`・`resetForTest()`・`dispose()`・認証切断・進行中巻の対象除外を伴う `syncQueue()` 時にインクリメントして、各 `await` 直後に `epoch === this.schedulerEpoch && !signal.aborted && !this.disposed` を検証する。
   - **プリエンプション時の投入済み `encodeCoverWebp` の扱い（許容事項）**: `pause("reader")` 等の発火時点で既に `cover.worker.ts` へ投入済みの `encodeCoverWebp` 処理自体は中断せず、完了後の `assertEpochActive` チェックにより結果（`Blob`）を破棄して DB へ書き込まない方針とする（HTTP Range 通信は `AbortController.abort()` で同期遮断済みのため帯域競合は発生せず、単一表紙の縮小完了待ちは実用上許容範囲とする）。
2. **`viewport-high` 即時実行と `background-low` 最終通信完了時刻基準スロットリング**:
   - ネットワーク通信（`RandomAccessReader.readRange`）を 1 回以上実行したタスクの終了時に `lastNetworkCompletedAt = now()` を記録する。
   - 次の 1 冊を取り出す際：
     - **`viewport-high` に候補が存在する場合**: スロットリング待機 **0ms** で即座に先頭候補を実行する。
     - **`viewport-high` が空で `background-low` に候補が存在する場合**:
       - `minIntervalMs = Math.ceil(1000 / ENGINE_BUDGETS.COVER_BG_MAX_PER_SECOND)`（`500ms`）に対し、`waitMs = lastNetworkCompletedAt === null ? 0 : Math.max(0, lastNetworkCompletedAt + minIntervalMs - now())` を算出する。
       - `waitMs > 0` の間は割り込み可能なタイマーで待機する。待機中に `viewport-high` へ候補が昇格した場合は **タイマーを即時起床（中断）** して先頭ループへ戻り、待ち時間ゼロで `viewport-high` を先に処理する。待機中に `pause()` が呼ばれた場合は即座にループを終了する。

### 4.4 単一巻抽出フロー・`zipIndexCache` 自己修復・エラー分類＆指数バックオフ・永続化耐障害性

1. **1 冊あたりの抽出ステップ**:
   - 抽出開始前に最新の `VolumesRepository.getById(volumeId)` を確認し、既に `coverStatus === "ready"`、論理削除（`isTrashed === 1`）、または現在の `enabledRootIds` 外になっていた場合は通信せずスキップする。
   - 注入された `createRangeReader(volume)`（実機 Android および Playwright WebDriver 環境では `GoogleDriveRangeReader`［`getAccessToken: (opts) => googleAuthBridge.getValidAccessToken(opts)`, `onDiagnostic` は `logger.warn` / `logger.error` へ `"cover"` スコープで転送］、非ネイティブ通常ブラウザ `npm run dev` プレビュー環境では外部通信ゼロのインメモリ合成 1 ページ ZIP リーダー `MockCoverArchiveRangeReader`［`NFR-05`］）を構築する。
   - **目次解決（0 RTT キャッシュ優先 ＋ 1 回限り自己修復）**:
     - `reader.totalSize === volume.fileSize`（実サイズ一致リーダー）の場合、`cacheKey = "gdrive:${volume.driveFileId}:${volume.md5Checksum ?? volume.fileSize}"` で `zipIndexCacheRepo.get(cacheKey)` を参照し、`validateZipIndexEntries` を通過すれば `fromIndexCache = true`（0 RTT）で採用する。未保持・不正時は `parseZipDirectory(reader, signal)`（1 RTT）を実行し、実サイズ一致リーダーであれば成功時に `zipIndexCacheRepo.put(cacheKey, entries)` へ非ブロッキング保存する（非ネイティブ開発プレビューの合成リーダーでは模擬 `volume.fileSize` とバイト長が異なるため `zipIndexCache` 読み書きをスキップして不整合を防ぐ）。
     - `targetEntry = entries[volume.coverPageIndex]`（`0 <= volume.coverPageIndex < entries.length`）に対して `readCompressedPageSlice(reader, targetEntry, signal)` → `coverWorker.encodeCoverWebp(slice, targetEntry.compressionMethod, { expectedUncompressedSize: targetEntry.uncompressedSize })` を実行する。
     - **`fromIndexCache === true` 時の 1 回限り自己修復**: キャッシュ由来エントリで `volume.coverPageIndex >= entries.length`、または `CORRUPT_ZIP` / `DECODE_FAILED` が発生した場合は、`await zipIndexCacheRepo.delete(cacheKey)` の上で `parseZipDirectory(reader, signal)` による再解析・キャッシュ更新とページ抽出を **同一試行内で 1 回だけ** フォールバック実行する。
   - **DB 永続化・イベント配信・永続化失敗時の安全継続（`R1-02`, `R1-08`）**:
     - `runLoop` での `processVolume` 呼び出しは必ず `try/finally` で囲んで `activeVolumeId` を解除し、`ensureLoopRunning` にも `.catch` ＋ `logger.error("cover", ...)` を備えて未処理 rejection と `"running"` 固着を防止する。
     - `VolumesRepository.saveCoverReady({ volumeId: volume.id, expectedMd5Checksum: volume.md5Checksum, expectedFileSize: volume.fileSize, coverBlob: result.blob })` を呼び出す。整合ガードを通過して保存された場合、`readyCount` / `pendingCount` を更新して `subscribeProgress` および `subscribeVolumeUpdated({ volumeId, seriesId, coverStatus: "ready", coverBlob, coverUpdatedAt })` を発火する。
     - **`saveCoverReady` / `saveCoverError` の IndexedDB 例外（`QuotaExceededError`・トランザクション中断等）時**: Core 内の `try/catch` で捕捉して `logger.error("cover", ...)` を記録し、DB 上の `coverStatus = "pending"` を維持したまま当該セッションのキューから安全スキップ（無限再試行ループ防止）して次巻へ継続する（次回 `syncQueue()` またはアプリ再起動時に再試行可能）。
     - **`syncQueue()` / `retryFailedCovers()` の Dexie 呼び出し失敗時**: Core 内で catch して `logger.error("cover", ...)` を記録し、未処理 rejection を送出せず安全に resolve（`retryFailedCovers` は `0` 返却）させる。
2. **中断・レート制限・認証切れ・一時通信障害・個別ファイル異常の厳格分類**:
   - **① プリエンプション／中断（`AbortError` または `signal.aborted` または `pauseReasons.size > 0`）**:
     - **エラー扱いにせず**、当該巻を `pending` のまま元の優先度キュー先頭へ戻して終了する（`coverStatus` は `"pending"` 維持、リトライ回数も消費しない）。
   - **② レート制限（`error instanceof ZipArchiveError && error.isRateLimited === true`：`429` または `403` Rate Limit）**:
     - 当該巻の連続リトライ回数 `attempts` が `COVER_RATE_LIMIT_MAX_RETRIES`（`3`）未満の場合、`phase = "backoff"` に遷移して当該巻をキュー先頭へ戻し、`backoffMs = COVER_RATE_LIMIT_BASE_BACKOFF_MS * (2 ** attempts)`（**`1000ms → 2000ms → 4000ms`**）だけ `AbortSignal` 対応スリープでキュー全体を待機してから再試行する。
     - `3` 回のリトライすべてが再び Rate Limit で失敗した場合（計 4 回失敗）は、`diagnosticLogger.warn("cover", ...)` を記録し `VolumesRepository.saveCoverError(...)` で当該巻を `coverStatus = "error"` に確定させて次巻へ進む。
   - **③ 未認証・トークン失効（`error instanceof ZipArchiveError && error.isUnauthorized === true`）**:
     - **`googleAuthBridge.getCachedSession() === null` またはトークン取得失敗（`error.httpStatus !== 401`：`AUTH_REQUIRED` / `AUTH_CANCELLED` / `AUTH_FAILED`）の場合**: 蔵書全体を誤って `"error"` で汚染しないよう、当該巻は `"pending"` のままキューへ戻し、`pause("unauthenticated")` を設定して認証セッション回復（`GoogleAuthBridge.subscribeSession` 非 `null` 通知、または有効セッション下での手動同期完了／`retryFailedCovers()` 実行）までスケジューラを一時停止する。
     - **トークンリフレッシュ成功後も `googleAuthBridge.getCachedSession() !== null`（連携維持）のまま再リクエスト HTTP `401` が返った場合**: セッション自体は有効なまま特定ファイル要求のみ拒否されているため、`pause("unauthenticated")` による恒久スタックを避け、⑤と同様に当該巻のみ `saveCoverError`（`coverStatus = "error"`）として記録して次巻へ進む。
   - **④ 一時通信・サーバー障害（オフライン・通信断［`READ_ERROR` かつ `httpStatus === undefined`］、`AUTH_NETWORK_ERROR`、HTTP `5xx`）**:
     - 蔵書全体がオフラインやサーバー一時障害で恒久 `"error"` 汚染されるのを防ぐため、`saveCoverError` は呼び出さない。
     - 連続一時障害回数 `transientErrorAttempts` が `COVER_RATE_LIMIT_MAX_RETRIES`（`3`）未満の間は、当該巻を `"pending"` のままキュー先頭へ戻し、`phase = "backoff"` で指数バックオフ（**`1000ms → 2000ms → 4000ms`**）待機後に再試行する（1 冊でも成功または非一時エラー確定した時点でカウンタを `0` へリセット）。
     - `3` 回のリトライすべてに失敗した場合（計 4 回連続失敗）は、`diagnosticLogger.warn("cover", ...)` を記録し、当該巻を `"pending"` のままキュー先頭へ戻した上で当該セッションの自動ループを待機停止（`phase = "idle"`、`pendingCount` 維持、`errorCount` 非加算）とする。端末のオンライン復帰（`AndroidManifest.xml` の `ACCESS_NETWORK_STATE` 権限下で `ServiceProvider` が購読する `window` の `online` イベント）、フォアグラウンド復帰（`visibilitychange` `visible` かつ `idle`・`pendingCount > 0`・`pauseReasons` 空）、または次回 `syncQueue()`・`resume()`・`retryFailedCovers()` 呼び出し時に待機停止を解除して自動再試行を再開する。
   - **⑤ 恒久的／個別アーカイブ異常（`404`, 非 Rate Limit の `403`, `416`, `CORRUPT_ZIP`, `EMPTY_ARCHIVE`, `ENCRYPTED_ZIP`, `UNSUPPORTED_COMPRESSION`, `DECODE_FAILED`, `coverPageIndex` 範囲外）**:
     - リトライを行わず `diagnosticLogger.warn("cover", ...)` を記録し、`VolumesRepository.saveCoverError({ volumeId: volume.id, expectedMd5Checksum: volume.md5Checksum, expectedFileSize: volume.fileSize })` で `coverStatus = "error"`, `coverBlob = null` を保存し、`subscribeVolumeUpdated`（`coverStatus: "error"`）と進捗更新を通知して直ちに次巻へ進む。

### 4.5 実行環境境界・プリエンプション・一時停止理由（`pauseReasons`）の連携規約

1. **実行環境別の既定構築・ライフサイクル境界（`ServiceProvider`）**:
   - **Vitest JSDOM 環境（`typeof Worker === "undefined"`）**: `ServiceProvider` に `coverExtractionScheduler` Prop が明示注入されていない場合、Worker 生成や外部通信を一切行わない決定論的 `NoopCoverExtractionScheduler` を既定採用する（`CoverExtractionSchedulerCore` 本体は DI 単体テストで 100% 検証する）。
   - **Android ネイティブ実機環境（`Capacitor.isNativePlatform() === true`）**: 実 `GoogleDriveRangeReader` ＋ 実 `cover.worker.ts` で稼働し、初期認証解決・手動同期完了時に自動実行する。
   - **非ネイティブ通常 Web プレビュー環境（`!Capacitor.isNativePlatform() && !navigator.webdriver`、`npm run dev` 等）**: `MockDriveSyncClient` の仮想ファイル ID に対して実 `www.googleapis.com` へ通信しないよう、インメモリ合成 1 ページ ZIP を返す `MockCoverArchiveRangeReader` ＋ 実 `cover.worker.ts` を既定採用し、ゼロコンフィグ（`NFR-05`）で表紙 WebP 縮小生成がオフライン完結で動作するようにする。
   - **Playwright WebDriver 結合テスト環境（`!Capacitor.isNativePlatform() && navigator.webdriver === true`）**: Playwright `context.route` と結合するため実 `GoogleDriveRangeReader` ＋ 実 `cover.worker.ts` を使用する。ただし既存の同期・リーダー単体検証シナリオ（`SCN-01`〜`SCN-05`）で意図しないバックグラウンド Range 通信が混入しないよう、`window.sessionStorage` の `"exLibris:test:coverExtractionAutoRun"` が `"1"` でない限り初期状態で `pause("test-harness")` を適用する（`resetTestDb()` 実行時は同フラグを消去して `pause("test-harness")` へ戻す）。`SCN-06` では `shouldExposeResetTestDb()` 限定フック `window.__exLibrisServices.setTestCoverExtractionAutoRun(true)` を有効化することで、リロード後（`page.reload()`）の起動時自動再開を含め実機と同一の自動スケジュール動作を一気通貫検証する。
   - **アンマウント時クリーンアップ**: `ServiceProvider` が内部生成した `CoverExtractionScheduler`（および保持する `CoverWorkerClientHandle`）は、`ServiceProvider` アンマウント時に必ず `dispose()` してタイマー・`AbortController`・Worker スレッドをリークなく解放する。
2. **一時停止理由（`pauseReasons`）一覧**:

| `reason`            | `pause(reason)` 発火条件                                                                                                                                                                       | `resume(reason)` 発火条件                                                                                                                                     |
| :------------------ | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `"reader"`          | ①`TR-02a` / `TR-02b` / `TR-04` 遷移ハンドラ内での同期呼び出し、および ②`AppShell` `useLayoutEffect` でルートが `/read/local` または `/read/volume/:volumeId` の間（直接 URL・`popstate` 含む） | `AppShell` `useLayoutEffect` でルートが非リーダー画面（`SCR-01` / `SCR-02` / `SCR-04`）へ遷移した時点（`TR-07` / `TR-08` / `TR-10`）                          |
| `"drive-sync"`      | `driveSyncStateStore.phase === "syncing"` 開始時                                                                                                                                               | `driveSyncStateStore.phase !== "syncing"` 終了時（直後に `syncQueue()` で新規・更新 `pending` 巻を反映）                                                      |
| `"unauthenticated"` | `GoogleAuthBridge` セッションが `null`（未連携・ログアウト）または抽出中に未認証を検知した時                                                                                                   | `GoogleAuthBridge.subscribeSession` で非 `null` セッションを受信した時、または有効キャッシュセッション保持下での `syncQueue()` / `retryFailedCovers()` 実行時 |
| `"test-harness"`    | WebDriver（Playwright E2E）環境で `"exLibris:test:coverExtractionAutoRun" !== "1"` の既定初期化・`resetTestDb()` 時（本番・実機では未使用）                                                    | `window.__exLibrisServices.setTestCoverExtractionAutoRun(true)` 呼び出し時（`SCN-06`）                                                                        |

- `pauseReasons.size > 0` の間は新規タスクの取り出しを完全に停止し、`pendingCount > 0` が残っていれば `phase = "paused"`（`pendingCount === 0` なら `"idle"`）を公開する。すべての `reason` が解除された時点で未処理キューがあれば自動的にワーカーを再開する。

---

## 5. 受け入れ条件（`AC-COV-xx`）

|    AC ID    | 受け入れ条件                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| :---------: | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AC-COV-01` | `CoverResizeWorkerCore`（および条件分岐ゼロの `cover.worker.ts`）は Store/Deflate 圧縮スライス（`expectedUncompressedSize` 超過上限ガード付き）から画像をデコードし、長辺上限 `350px`（短小画像は拡大せず等倍維持）・WebP（`quality: 0.8`）の `Blob` を生成するとともに、成否を問わず `bitmap.close()` を即座に実行する。                                                                                                                                                                                                                                                                                                                              |
| `AC-COV-02` | Google 連携済みかつ有効ルート配下に `coverStatus === "pending"` の非ゴミ箱巻が存在するとき、手動同期完了直後およびアプリ起動／画面表示時に自動稼働し、`error` 巻はユーザー明示再試行（または Drive 側ファイル更新検知）まで自動再試行しない。                                                                                                                                                                                                                                                                                                                                                                                                          |
| `AC-COV-03` | `IntersectionObserver`（`rootMargin: "200px 0px"`）で可視判定された `pending` 巻は `viewport-high` として待機 0ms で最優先処理（画面外離脱時は `background-low` へ降格、エラー再試行時の `"pending"` 復帰カードも再監視昇格）され、画面外の `background-low` は「①シリーズ代表表紙巻 → ②残りの収録巻」の順かつ最終通信完了時刻基準で最大 **2 冊/秒（最小 500ms 間隔）** に制御される（待機中の `viewport-high` 到着時は即時起床）。                                                                                                                                                                                                                    |
| `AC-COV-04` | 表紙抽出時に `gdrive:${driveFileId}:${md5Checksum ?? fileSize}` の `zipIndexCache` があれば 0 RTT で目次を再利用し、未キャッシュ時は解析した目次を `zipIndexCache` へ保存して後続の `SCR-03` オープンを 0 RTT 化する（キャッシュ不整合時は 1 回限り再解析自己修復を行う）。                                                                                                                                                                                                                                                                                                                                                                            |
| `AC-COV-05` | 抽出成功（`ready`）・失敗（`error`）・エラー再試行リセット（`pending`）の全 DB 更新において、**`volumes.updatedAt` および `series.updatedAt` が一切変更されない** こと、かつ抽出中に `md5Checksum` / `fileSize` 変化やゴミ箱化が起きた巻へ古い結果を上書きしないこと。                                                                                                                                                                                                                                                                                                                                                                                 |
| `AC-COV-06` | `429` および Rate Limit 系 `403` 応答時はキュー全体を指数バックオフ（`1s → 2s → 4s`、同一巻最大 3 回リトライ後に `error` 化）し、オフライン・通信断・`AUTH_NETWORK_ERROR`・`5xx` の一時通信障害時は指数バックオフ（`1s → 2s → 4s`）後に上限到達しても恒久 `error` 化せず `pending` 維持のまま待機停止（端末オンライン復帰 `window` `online` イベント・フォアグラウンド復帰 `visibilitychange` や次回 `syncQueue()` / `resume()` / `retryFailedCovers()` で自動再開）し、セッション失効・未認証時は `pending` 維持のまま一時停止する（有効セッション維持下の個別 `401`・`404`・非 Rate Limit `403`・破損アーカイブは当該巻 `error` として次巻へ進む）。 |
| `AC-COV-07` | `SCR-03`（`/read/local`・`/read/volume/:volumeId`）への遷移瞬間（直接 URL・`popstate` 含む）、手動 Drive 同期実行中、および進行中巻の所属ルート無効化／解除時は進行中の表紙 Range 通信・待機タイマーが同期的に `abort()` され、リーダー終了（`TR-07` / `TR-08` / `TR-10`）・同期完了時に自動再開する（`NFR-04`）。                                                                                                                                                                                                                                                                                                                                     |
| `AC-COV-08` | `src/engine/cover/`（`MockCoverArchiveRangeReader.ts` 含む、`cover.worker.ts` / `types.ts` を除く）、`src/shared/bookshelf/seriesOrdering.ts`、`decompressSlice.ts`、`coverWorkerClient.ts`、`coverExtractionStateStore.ts`、`useViewportVolumeObserver.ts`、および拡張後の `GoogleDriveRangeReader` / `VolumesRepository` がすべて C0/C1/Functions/Lines 100% 単体テストを PASS する。                                                                                                                                                                                                                                                                |
