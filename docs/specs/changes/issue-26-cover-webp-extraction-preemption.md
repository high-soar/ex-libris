---
type: spec-delta
title: "Issue #26 差分仕様: 2段優先度・表紙 WebP 自動抽出 ＆ リーダー閲覧優先プリエンプション（NFR-04）"
description: "専用 cover.worker（長辺350px WebP）、CoverExtractionSchedulerCore（viewport-high 即時優先＋background-low 2冊/秒・429/403指数バックオフ・zipIndexCache 0RTT還元）、SCR-03/Drive同期プリエンプション、および SCR-01/02/04 進捗・エラー再試行 UI を定義する差分仕様"
status: "Review (#26)"
updated: "2026-11-27"
issue: "#26"
tags:
  [
    delta,
    v0.2,
    cover,
    webp,
    scheduler,
    preemption,
    rate-limit,
    bookshelf,
    series-detail,
    reader,
    settings,
    scr-01,
    scr-02,
    scr-03,
    scr-04,
  ]
related_specs:
  - docs/index.md
  - docs/specs/requirements.md
  - docs/specs/architecture.md
  - docs/specs/db-schema.md
  - docs/specs/screen-transitions.md
  - docs/specs/engine/cover-extraction.md
  - docs/specs/engine/zip-streaming.md
  - docs/specs/features/bookshelf.md
  - docs/specs/features/series-detail.md
  - docs/specs/features/reader.md
  - docs/specs/features/settings.md
  - docs/specs/providers/google-drive.md
  - docs/guidelines/workflow.md
  - docs/guidelines/testing.md
  - docs/quality/bug-and-handover-log.md
related_tests:
  - src/App.test.tsx
  - src/app/ServiceProvider.test.tsx
  - src/app/serviceContext.test.ts
  - src/engine/constants.test.ts
  - src/engine/io/GoogleDriveRangeReader.test.ts
  - src/engine/workers/DecodeWorkerCore.test.ts
  - src/engine/zip/errors.test.ts
  - src/engine/zip/zipParser.test.ts
  - src/features/bookshelf/BookshelfPage.test.tsx
  - src/features/bookshelf/BookshelfToolbar.test.tsx
  - src/features/bookshelf/SeriesCard.test.tsx
  - src/features/bookshelf/SeriesGridSection.test.tsx
  - src/features/reader/ReaderPage.test.tsx
  - src/features/series-detail/SeriesDetailPage.test.tsx
  - src/features/series-detail/SeriesSummaryCard.test.tsx
  - src/features/series-detail/SeriesVolumeListSection.test.tsx
  - src/features/settings/SettingsPage.test.tsx
  - src/shared/ui/CoverThumbnail.test.tsx
  - src/storage/repositories/volumesRepository.test.ts
  - src/storage/repositories/zipIndexCacheRepository.test.ts
  - test/vrt/vrt.spec.ts
  - test/it/smoke.spec.ts
  - test/it/local-reader.spec.ts
  - test/it/settings-oauth.spec.ts
  - test/it/drive-sync.spec.ts
  - test/it/bookshelf-drive-reader.spec.ts
---

# Issue #26 差分仕様: 2段優先度・表紙 WebP 自動抽出 ＆ リーダー閲覧優先プリエンプション（`NFR-04`）

## 1. 背景・目的（Why）

- Milestone `v0.2`（Google Drive 連携 ＆ 最小仮想本棚：日常実用 MVP）の最終第 4 弾（`[v0.2][4/4]`）として、Google Drive 上の多数の `.zip` / `.cbz` 蔵書から事前一括ダウンロードなしで軽量な表紙 WebP（長辺上限 `350px`・約 15〜25KB/冊）を自動生成・永続化し、かつ Google Drive API のレート制限（`429` / `403` Rate Limit）回避と `SCR-03` リーダー読書時の通信帯域 100% 優先確保（`NFR-04`）を両立させる。

### 1.1 Step 1 合意事項（`/grill-me` 確定内容：Q1〜Q7）

1. **スレッド構成とリーダー Worker プールとの完全分離（Q1）**:
   - スケジューラ状態機械・`GoogleDriveRangeReader` I/O・`AbortController`・DB 読み書きは Main Thread 側の純粋クラス（`CoverExtractionSchedulerCore.ts`）に置き、伸長・`createImageBitmap` デコード・`OffscreenCanvas` 長辺 `350px` WebP エンコード・即時 `bitmap.close()` のみを専用の単一軽量 Worker（`src/engine/cover/cover.worker.ts` ＋ `CoverResizeWorkerCore.ts`）へ分離する。
   - これにより `SCR-03` セッション専用の `coordinator.worker.ts` / `DecodeWorkerPool` と一切干渉せず、`pause("reader")` 呼び出し時に IPC 遅延ゼロで進行中 `fetch` を即座に `abort()` できる。
2. **起動タイミング・キュー優先順・`error` 巻の再試行境界（Q2）**:
   - Google 連携済み かつ 有効ルート配下に `coverStatus === "pending"` の非ゴミ箱巻が存在する時は、「手動同期完了直後」に加えて「アプリ起動・画面表示時（前回未完了分の再開）」も自動稼働する（全巻 `ready` 到達後は `pending === 0` のため通信ゼロとなり `NFR-03` を維持）。
   - `background-low` キュー内は **「①各有効シリーズの代表表紙巻 → ②残りの収録巻」** の順で並べ、`SCR-01` の本棚カードを優先的に埋めた後に詳細巻を順次抽出する。
   - `coverStatus === "error"` の巻は無限 API ループ防止のため自動再試行対象から除外し、ユーザーの明示的な「再試行」操作時（または Drive 同期時の MD5/サイズ更新による `pending` リセット時）のみ再試行する。
3. **直列実行・2冊/秒レート制御・`429`/`403` 指数バックオフ・未認証保護（Q3）**:
   - 同時実行数は `1`（直列）とし、`viewport-high` は待機 `0ms` で連続実行（着手前に可視領域から外れた巻は `background-low` へ降格）、`background-low` は最終通信完了時刻基準で最小 `500ms` 間隔（最大 `2` 冊/秒、`viewport-high` 到着時は待機を即時起床）とする（[testing.md §3.1](../../guidelines/testing.md#3-単体テストvrt結合テストitの衛生非同期規律継承-kaizen)）。
   - `429` および Rate Limit 系 `403` 応答時はキュー全体を指数バックオフ（`1s → 2s → 4s`、同一巻最大 `3` 回リトライ後に `error` 化）し、未認証（`401` Single-Flight 再試行失敗 / `AUTH_REQUIRED`）時は蔵書を `error` 化せず `pending` 維持のまま一時停止する。
4. **理由別プリエンプションと Drive 同期・ルート変更連携（Q4）**:
   - 一時停止理由を `"reader" | "drive-sync" | "unauthenticated"` の集合で管理し、`SCR-03` 表示中（`TR-02a`/`02b`/`04`・直接 URL・`popstate` 含む）および手動 Drive 同期実行中（`phase === "syncing"`）は進行中通信・スリープを即座に `abort()` して一時停止する（中断巻は `pending` 維持）。
   - 同期完了時および `SCR-04` でのルート登録/有効切替/削除時に `syncQueue()` で対象を再計算し、DB 保存時も `md5Checksum` / `fileSize` / `isTrashed === 0` 一致を検証して古い結果の上書きを防止する。
5. **進捗表示・エラー識別・再試行 UI の配置（Q5）**:
   - `SCR-01`（`BookshelfToolbar`）は抽出稼働中または `errorCount > 0` のときのみコンパクトに進捗／エラー件数＋「再試行」ボタンを表示し、全件完了（`pending === 0 && error === 0`）時は非表示でスッキリ維持する。
   - `SCR-04` に専用の `CoverExtractionSection`（状態バッジ・進捗バー・内訳件数・「エラー分を再試行」ボタン）を新設する。
   - `CoverThumbnail` は `coverStatus === "error"` 時に控えめな「取得失敗」表示を出し、`SCR-02` でも当該シリーズ内に `error` 巻が存在する時はシリーズ単位の再試行導線を表示する。
6. **WebP 仕様・`zipIndexCache` 自己修復・インプレース UI 反映（Q6）**:
   - 長辺上限 `350px`（350px 以下の短小画像は拡大せず等倍維持）・WebP `quality: 0.8` とし、`zipIndexCache` ヒット時は 0 RTT 再利用（不整合時は 1 回限り再解析自己修復）、ミス時は解析目次を `zipIndexCache` へ還元保存する。
   - UI 側は `rootMargin: "200px 0px"` の `IntersectionObserver` で可視 `pending` 巻を `viewport-high` へ昇格させ、完了時は該当 `volumeId` のみをインプレース差分更新して他カードの `Blob` 参照変化（`revokeObjectURL` / `createObjectURL` 再発火によるチラつき）と全件再クエリを防止する。
7. **Android 実機検証区分 ＆ Sub-issue 分割計画（Q7）**:
   - Android 実機検証は **区分 A（`親 Issue #26 完了前`：`HO-13`）** とし、`v0.2` 日常実用 MVP の総合動作確認（実 Drive 表紙 WebP 自動抽出・連続スクロール時メモリ健全性・`SCR-03` 遷移プリエンプション＆0 RTT オープン・診断ログ機密マスク）を実施する。
   - 実装は **MK-1（Storage・専用 `cover.worker`・2段スケジューラ Core）→ MK-2（`SCR-01`/`02`/`04` UI・`IntersectionObserver`・プリエンプション結線・VRT）→ Step 4 IT（Playwright `SCN-06`・差分仕様アーカイブ・実機検証）** の 3 PR 構成とする。

### 1.2 対象外スコープ

- 見開きカバーの半裁クロップ（`left-half` / `right-half`）および表紙採用ページ番号（`coverPageIndex`）の手動変更 UI（→ `v0.4`）
- 公開書誌 API（NDL サーチ / AniList / Google Books）連携・複合検索・コレクション・Virtual Grid（→ `v0.3`）

---

## 2. 新規作成・変更対象の App 全体正本一覧

|   種別   | 正本ファイル                                                     | 変更概要                                                                                                                                                       |
| :------: | :--------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **新規** | [cover-extraction.md](../engine/cover-extraction.md)             | 専用 `cover.worker`（`CoverResizeWorkerCore`）、2段優先度 `CoverExtractionSchedulerCore`、429/403 指数バックオフ、プリエンプション、`AC-COV-01`〜`08` を新設   |
| **更新** | [zip-streaming.md](../engine/zip-streaming.md)                   | 共通伸長純関数 `decompressSlice.ts` 抽出、および `ZipArchiveError` / `GoogleDriveRangeReader` の HTTP `429`/`403` Rate Limit・`401` 未認証メタデータ付与を追記 |
| **更新** | [db-schema.md](../db-schema.md)                                  | `VolumesRepository` の表紙保存・エラー記録・エラー再試行リセット 3 メソッド（FIFO・LWW `updatedAt` 非汚染・整合ガード）および `resetTestDb` 初期化対象を追記   |
| **更新** | [architecture.md](../architecture.md)                            | `ENGINE_BUDGETS` 表紙定数、Layer 2 `src/engine/cover/`・Layer 3/4 の責務、および §5.2 理由別プリエンプション規約を最新化                                       |
| **更新** | [bookshelf.md](../features/bookshelf.md)                         | `BookshelfToolbar` 表紙進捗/エラー再試行表示、`IntersectionObserver` 登録、インプレース差分反映、`TR-02a`/`02b` 同期 `pause("reader")`、`AC-BS-13` を追加      |
| **更新** | [series-detail.md](../features/series-detail.md)                 | `SCR-02` の `IntersectionObserver` 登録、シリーズ内 `error` 巻の再試行導線、インプレース差分反映、`TR-04` 同期 `pause("reader")`、`AC-SD-07` を追加            |
| **更新** | [reader.md](../features/reader.md)                               | `SCR-03` 入退場時の同期プリエンプション（`pause("reader")` / `resume("reader")`）および表紙抽出による `zipIndexCache` 0 RTT 恩恵（`AC-RD-20`）を明記           |
| **更新** | [settings.md](../features/settings.md)                           | セクション④ `CoverExtractionSection`（状態バッジ・進捗バー・内訳件数・「エラー分を再試行」ボタン）・ルート変更時 `syncQueue()`・`AC-ST-09` を追加              |
| **更新** | [screen-transitions.md](../screen-transitions.md)                | `TR-02a`/`02b`/`04`/`07`/`08`/`10` の表紙キュー一時停止/再開を本実装契約へ更新し、結合テストシナリオ **`SCN-06`**（`cover-extraction.spec.ts`）を追加          |
| **更新** | [requirements.md](../requirements.md)                            | `related_specs` へ `cover-extraction.md` を追加しステータスを同期                                                                                              |
| **更新** | [google-drive.md](../providers/google-drive.md)                  | `related_specs` へ `cover-extraction.md` を追加しステータスを同期                                                                                              |
| **更新** | [bug-and-handover-log.md](../../quality/bug-and-handover-log.md) | 区分 A 実機検証項目 **`HO-13`**（完了ゲート: `親 Issue #26 完了前`）を新規登録                                                                                 |

---

## 3. 追加・変更する仕様の差分詳細

### 3.1 Storage 拡張・Range エラー分類・専用 `cover.worker`・2段スケジューラ Core（MK-1）

1. **基準定数拡張（`src/engine/constants.ts`）**:
   - `ENGINE_BUDGETS` に `COVER_MAX_LONG_EDGE_PX: 350`, `COVER_WEBP_QUALITY: 0.8`, `COVER_RATE_LIMIT_MAX_RETRIES: 3`, `COVER_RATE_LIMIT_BASE_BACKOFF_MS: 1_000` を追加する。
2. **`ZipArchiveError` メタデータ拡張と `GoogleDriveRangeReader` の Rate Limit / 未認証識別**:
   - `src/engine/zip/errors.ts`:
     - `ZipArchiveErrorMetadata = { readonly httpStatus?: number; readonly isRateLimited?: boolean; readonly isUnauthorized?: boolean }` を定義し、`ZipArchiveError` コンストラクタ第 4 引数（または `options`）とプロパティ（`httpStatus`, `isRateLimited`, `isUnauthorized`）および `comlinkErrorHandler.ts` シリアライズ対象へ追加する。
   - `src/engine/io/GoogleDriveRangeReader.ts`:
     - `SCR-03` リーダーの即時失敗契約（`AC-ENG-15`：リトライなし・`ZipArchiveError("READ_ERROR")` 送出）は 100% 維持したまま、以下の構造化フラグを付与する：
       - `429` 応答時：`{ httpStatus: 429, isRateLimited: true }`
       - `403` 応答時：`response.json()`（非 JSON・読込失敗時は空メタデータフォールバック、`signal?.aborted` 再確認付き）から Google Drive エラー `reason` を検査し、`rateLimitExceeded` / `userRateLimitExceeded` / `downloadQuotaExceeded` / `quotaExceeded` のいずれかを含む場合は `{ httpStatus: 403, isRateLimited: true }`、それ以外は `{ httpStatus: 403, isRateLimited: false }`
       - 初回 `401` 後の再リクエストでも `401` が返った場合、または `getAccessToken` が `GoogleAuthError`（`code === "AUTH_REQUIRED" || code === "AUTH_CANCELLED"`）を送出した場合：`{ httpStatus: 401, isUnauthorized: true }`（`getAccessToken` 由来の場合は `httpStatus` 省略可・`isUnauthorized: true`）
       - その他の非 206/200 ステータス（`404`, `416`, `5xx` 等）：`{ httpStatus: response.status, isRateLimited: false }`
3. **共通伸長ヘルパ抽出と専用 `CoverResizeWorkerCore` / `cover.worker.ts` / `coverWorkerClient.ts`**:
   - `src/engine/zip/decompressSlice.ts` に Store / Deflate（`DecompressionStream("deflate-raw")` ＋ `fflate.inflateSync` フォールバック）伸長関数を抽出し、`DecodeWorkerCore.ts` と `CoverResizeWorkerCore.ts` の双方から利用する。
   - `src/engine/cover/CoverResizeWorkerCore.ts` は `encodeCoverWebp` を実装し、`try { ... } finally { bitmap.close(); }` で `ImageBitmap` を即時解放しつつ長辺上限 `350px`（短小画像は等倍維持）・WebP `quality: 0.8` の `Blob` を返す。
   - `src/engine/cover/cover.worker.ts` は条件分岐ゼロの数行ブートストラップとし、`src/app/coverWorkerClient.ts` で `prepareDecodeTransfer` 送信保護および Worker `error` / `messageerror` 時の即時 `DECODE_FAILED` reject・`isBroken()` 状態公開を行う。
4. **`VolumesRepository` の表紙更新 3 メソッド追加と既存モック伝播**:
   - `src/storage/repositories/volumesRepository.ts` に以下を追加する（すべて FIFO 直列化、**`updatedAt` 非変更**、`existing.isTrashed === 0` かつ `md5Checksum` / `fileSize` 一致時のみ保存）：
     - `saveCoverReady({ volumeId, expectedMd5Checksum, expectedFileSize, coverBlob, coverUpdatedAt? }): Promise<VolumeRecord | null>`
     - `saveCoverError({ volumeId, expectedMd5Checksum, expectedFileSize, coverUpdatedAt? }): Promise<VolumeRecord | null>`
     - `resetErrorCoversToPending({ enabledRootIds, seriesId? }): Promise<readonly VolumeRecord[]>`
   - **既存テストモックへの型伝播（MK-1 同時更新対象）**: 手動で `VolumesRepository` モックを定義している既存テスト（`src/app/serviceContext.test.ts`, `src/app/ServiceProvider.test.tsx`, `src/features/bookshelf/BookshelfPage.test.tsx`, `src/features/series-detail/SeriesDetailPage.test.tsx`, `src/features/reader/ReaderPage.test.tsx`）に上記 3 メソッドのモックスタブを同時追加し、MK-1 単体で `npm run typecheck` を 100% PASS させる。
5. **`CoverExtractionSchedulerCore.ts` と `coverExtractionStateStore.ts`**:
   - [cover-extraction.md §4](../engine/cover-extraction.md#4-coverextractionschedulercore2段優先度レート制限プリエンプション状態機械) に従い、`viewport-high`（0ms 待機・画面外降格）＋ `background-low`（①代表表紙巻→②収録巻、`lastNetworkCompletedAt` 基準 500ms 間隔・`viewport-high` 到着時即時起床）、`zipIndexCache` 0 RTT 参照＆還元保存＋1回限り自己修復、`429`/`403` Rate Limit 指数バックオフ（`1s → 2s → 4s`、最大 3 回リトライ）、`isUnauthorized` 時 `pause("unauthenticated")`（`pending` 維持）、および `retryFailedCovers` を実装する。

### 3.2 `SCR-01` / `SCR-02` / `SCR-04` UI・`IntersectionObserver`・プリエンプション結線・VRT（MK-2）

1. **`ServiceProvider` / `AppShell` への DI 配線と同期プリエンプション**:
   - `ServiceContextValue`（および `ServiceProviderProps`、テスト環境限定 `window.__exLibrisServices`）に `coverExtractionScheduler: CoverExtractionScheduler` を追加し、`resetTestDb` 実行時は `await coverExtractionScheduler.resetForTest()` および `resetCoverExtractionState()` を先行実行する（既存テスト `src/app/serviceContext.test.ts` 等も同時更新）。
   - `ServiceProvider` 内で ①`GoogleAuthBridge` の初期セッション解決・`subscribeSession` 変化に応じた `pause("unauthenticated")` / `resume("unauthenticated")` ＋ `syncQueue()`、および ②`driveSyncStateStore.phase` 変化に応じた同期開始時 `pause("drive-sync")`・同期完了時 `resume("drive-sync")` ＋ `syncQueue()` を自動連携する。
   - `AppShell`（`src/App.tsx`）の `useLayoutEffect` で現在ルートを監視し、`route.name === "reader-local" || route.name === "reader-volume"` の間は同期的に `coverExtractionScheduler.pause("reader")`（`ReaderPage` の `useEffect` `openArchive` 開始より前に確定実行）、それ以外のルート（`SCR-01` / `SCR-02` / `SCR-04`）では `coverExtractionScheduler.resume("reader")` を実行する。あわせて `BookshelfPage`（`TR-02a` / `TR-02b`）および `SeriesDetailPage`（`TR-04`）の遷移ハンドラ内でも `navigate` 直前に `pause("reader")` を同期呼び出しする。
2. **共通サムネイル・各画面 UI 拡張とインプレース差分反映**:
   - **`CoverThumbnail`（`src/shared/ui/CoverThumbnail.tsx`）**:
     - `<img>` に `loading="lazy"` および `decoding="async"` を付与し、`coverBlob` / `coverStatus` 変化・アンマウント時の `URL.revokeObjectURL` を厳守する。
     - `coverStatus === "error"` の場合、プレースホルダ内に控えめなエラーステータスラベル（`data-testid="cover-thumbnail-error-badge"`：`"取得失敗"`）を表示して `pending`（待機中）と視覚的に区別できるようにする。
   - **共有ビューポート監視フック / ヘルパ（`src/shared/ui/useViewportVolumeObserver.ts` 等）**:
     - `IntersectionObserver`（`rootMargin: "200px 0px"`、未定義環境は安全 no-op）を用いて、`data-cover-volume-id` を持つ `pending` 要素群の交差変化を追跡し、`coverExtractionScheduler.setViewportVolumeIds(screenKey, visibleIds)` を更新する（アンマウント時に空 `Set` でクリア）。
   - **`SCR-01`（`BookshelfToolbar` / `SeriesGridSection` / `SeriesCard` / `BookshelfPage`）**:
     - `BookshelfToolbar`: 表紙抽出が稼働中／一時停止・バックオフ待機中（`pendingCount > 0`）または `errorCount > 0` のときのみ、コンパクトな表紙ステータス行（`data-testid="bookshelf-cover-status"`：例 `表紙抽出中: ${readyCount} / ${totalCount} 冊`、エラー存在時は `表紙未取得: ${errorCount} 冊` ＋ **「再試行」ボタン** `data-testid="bookshelf-retry-failed-covers-button"`）を表示する。`pendingCount === 0 && errorCount === 0` 時は非表示とする。
     - `BookshelfPage`: `coverExtractionScheduler.subscribeVolumeUpdated` を購読し、完了・失敗イベント到着時は IndexedDB 全件再取得を行わず、保持中の `seriesItems` 内の該当 `representativeVolume.id === event.volumeId` のみをインプレース更新する（他カードの `Blob` 参照同一性を保ち `ObjectURL` 再生成チラつきを防止）。
   - **`SCR-02`（`SeriesDetailPage` / `SeriesSummaryCard` / `SeriesVolumeListSection`）**:
     - `SeriesDetailPage`: 所属有効巻のうち `coverStatus === "error"` の巻が 1 冊以上存在する場合、コンパクトな案内バー（`data-testid="series-cover-error-banner"`）と当該シリーズ限定の **「表紙を再試行」ボタン**（`data-testid="series-retry-failed-covers-button"`：`retryFailedCovers({ seriesId })`）を表示する。`subscribeVolumeUpdated` で該当巻・代表表紙をインプレース更新する。
   - **`SCR-04`（`CoverExtractionSection` 新設 / `SettingsPage`）**:
     - `src/features/settings/CoverExtractionSection.tsx`（1対1 `.stories.tsx` / `.test.tsx` 付き Pure Presentational）を `DriveSyncExecutionSection` の直下に配置し、状態バッジ（`data-testid="settings-cover-status-badge"`：`待機中` / `抽出中` / `一時停止中` / `バックオフ待機` / `完了` / `要再試行`）、進捗バー（`data-testid="settings-cover-progress-bar"`）、内訳件数（抽出済み `readyCount` / 全体 `totalCount`・待機 `pendingCount`・エラー `errorCount`）、および **「エラー分を再試行」ボタン**（`data-testid="settings-retry-failed-covers-button"`：`authStatus === "connected" && enabledRootCount > 0 && !isSyncing && !isBackBlocked && errorCount > 0` のとき活性）を表示する。
     - `SettingsPage` でルートフォルダ追加・有効/無効トグル・登録解除が成功した際、`void coverExtractionScheduler.syncQueue()` を呼び出して無効化されたルートの巻を即座にキューから除外（再有効化時は再投入）する。
3. **Storybook / VRT 決定論的初期状態注入**:
   - `BookshelfPageInitialSnapshot` および `SettingsPageInitialSnapshot` にオプショナルな `coverExtractionState?: CoverExtractionProgressSnapshot` を追加する。`initialSnapshot` 指定時は `CoverExtractionScheduler` の非同期購読・自動稼働をスキップし、省略時は既定の完了/待機スナップショットへ決定論的にフォールバックさせて既存・新規全 Story の 1280px / 375px VRT 安定性を 100% 保証する。

### 3.3 Playwright 実ブラウザ結合テスト `SCN-06`・差分仕様アーカイブ・実機検証（Step 4 IT）

- 新規結合テスト `test/it/cover-extraction.spec.ts`（`SCN-06`）を追加し、実ブラウザ＋実 `cover.worker.ts`＋Playwright `context.route`（Google Drive `alt=media` Range モック）上で以下を一気通貫検証する：
  1. 手動 Drive 同期完了後、本棚 `SCR-01` で `IntersectionObserver` により画面内カードの代表表紙が `viewport-high` で最優先 WebP 化されて `<img data-testid="cover-thumbnail-image">`（`blob:` URL）が表示され、画面外の巻も `background-low`（最大 2 冊/秒）で順次抽出されること、および `volumes.updatedAt` / `series.updatedAt` が一切変化しないこと。
  2. 表紙抽出が完了した巻を `SCR-03`（`/read/volume/:volumeId`）で開いた際、表紙抽出時に保存された `zipIndexCache` により Central Directory Range 通信ゼロ（`fromIndexCache: true`, 0 RTT）で即座に開けること。
  3. 複数冊の表紙抽出が進行中に `SCR-01` / `SCR-02` から `SCR-03`（Drive 巻およびローカル ZIP 双方）へ遷移した瞬間（`TR-02a` / `TR-02b` / `TR-04`）、表紙用の新規・進行中 Range リクエストが即座に停止（プリエンプション）してリーダー描画が阻害されず、`TR-07` / `TR-08` で戻ると残りの `pending` 巻の表紙抽出が自動再開して完了すること。
  4. `429`（または Rate Limit `403`）応答からの指数バックオフ自動回復、および破損 ZIP / `404` による `coverStatus === "error"`（「取得失敗」バッジ表示）からの `SCR-01` / `SCR-02` / `SCR-04`「再試行」ボタンによる正常回復（サーバー側正常化後 `ready` 遷移）が動作すること。

---

## 4. テスト計画（4層 TDD・100% カバレッジ・VRT・IT）

| レイヤー / 区分              | 対象モジュール・検証観点                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| :--------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Layer 1 & 2 UT**           | `GoogleDriveRangeReader.test.ts`（`429`・Rate Limit `403` vs 権限 `403`・`401` 再試行失敗時の `ZipArchiveError` メタデータ）、`decompressSlice.test.ts`、`CoverResizeWorkerCore.test.ts`（350px 縮小・短小画像非拡大・WebP 変換・例外時含む `bitmap.close()` 100% 呼出）、`CoverExtractionSchedulerCore.test.ts`（`viewport-high` 昇格/降格・2冊/秒スロットリング＆即時起床・`zipIndexCache` 0RTT/自己修復・`429`/`403` 1s/2s/4s バックオフ・未認証一時停止・`pause`/`resume` `AbortController` 中断） |
| **Layer 3 Storage UT**       | `volumesRepository.test.ts`（`saveCoverReady` / `saveCoverError` / `resetErrorCoversToPending` の FIFO 直列化・`updatedAt` 非汚染厳密アサーション・`md5Checksum`/`fileSize`/`isTrashed` 不一致時の古い結果破棄ガード）                                                                                                                                                                                                                                                                                 |
| **Layer 4 UI / VRT**         | `coverWorkerClient.test.ts`（Worker クラッシュ検知＆再生成）、`coverExtractionStateStore.test.ts`、`CoverThumbnail`（`error` バッジ・`revokeObjectURL`）、`CoverExtractionSection`、`BookshelfToolbar`、`BookshelfPage`、`SeriesDetailPage`、`SettingsPage`、`App.test.tsx`（`useLayoutEffect` ルート連動 `pause("reader")`/`resume("reader")`）、1280px/375px VRT 全件 PASS                                                                                                                           |
| **Playwright IT (`SCN-06`)** | `test/it/cover-extraction.spec.ts` による実 Worker WebP 生成・`viewport-high`/`background-low`・`zipIndexCache` 0RTT 還元・`SCR-03` プリエンプション・429 バックオフ・エラー再試行・`updatedAt` 非汚染、および既存 `SCN-01`〜`SCN-05` 全件回帰 PASS                                                                                                                                                                                                                                                    |

---

## 5. 申し送り事項（`HO-xx`）・Android 実機検証計画・Sub-issue 分割

### 5.1 Android 実機検証の実施判断（区分 A：`親 Issue #26 完了前`）

- [workflow.md §2.2](../../guidelines/workflow.md#22-android-実機検証の実施判断基準と試験項目表フォーマット) の基準（専用 Worker `OffscreenCanvas` ＆ `ImageBitmap.close()` メモリ制御、連続スクロール時の `ObjectURL` 健全性、実 Google Drive API レート制限回避＆リーダー帯域プリエンプション、実機確認観点 4 項目）および `v0.2` MVP 最終 Issue としての総合確認の観点から、**区分 A（完了ゲート: `親 Issue #26 完了前`）** として [bug-and-handover-log.md](../../quality/bug-and-handover-log.md) に **`HO-13`** を登録する。
- Step 4 最終 IT PR が Gate 1〜6 を通過した直後に `build-android.yml` (`debug`) を自動実行し、Google Drive の開発検証用 `app-debug.apk`（`app-release.apk` とは分離）へ配置して以下の試験項目表を提示する：
  1. **`HO-13-1`（実 Drive 表紙 WebP 自動抽出・2段優先度・進捗表示）**: 実 Google Drive 蔵書を同期後、`SCR-01` 表示中のシリーズカード表紙が優先的に表示され、画面外および `SCR-02` 収録巻もバックグラウンド（最大 2 冊/秒）で `403 Rate Limit` エラーなく順次抽出され、`SCR-01` / `SCR-04` の進捗表示が完了へ遷移すること。
  2. **`HO-13-2`（連続スクロール時の描画滑らかさ・メモリ健全性）**: 表紙抽出中および完了後の `SCR-01` / `SCR-02` を上下に連続スクロール・往復遷移しても WebView クラッシュ・カクつき・画像欠落が発生しないこと。
  3. **`HO-13-3`（`SCR-03` 閲覧最優先プリエンプション ＆ `zipIndexCache` 0 RTT 恩恵）**: 未抽出巻が残っている抽出進行中に `SCR-01` / `SCR-02` から `SCR-03` を開いた際、表紙通信に邪魔されず高速に 1 ページ目が表示され（表紙抽出完了済み巻では初回閲覧から `fromIndexCache=true` 0 RTT オープンとなること）、リーダー終了後に表紙抽出が自動再開すること。
  4. **`HO-13-4`（エラー再試行導線・診断ログ `[REDACTED]` マスク）**: 通信遮断等で `取得失敗` となった表紙がオンライン復帰後の「再試行」操作で正常取得でき、`SCR-04` 診断ログコピーに平文トークンが一切露出しないこと。

### 5.2 実装 Sub-issue 分割計画（Step 2 マージ後に起票）

1. **MK-1**: Storage 表紙更新拡張・`GoogleDriveRangeReader` Rate Limit 識別・専用 `cover.worker`（`CoverResizeWorkerCore`）・2段優先度 `CoverExtractionSchedulerCore` の TDD 実装（Layer 1〜3 ＋ `coverWorkerClient` / `coverExtractionStateStore`）
2. **MK-2**: `CoverThumbnail` エラー表示・`SCR-04` `CoverExtractionSection`・`SCR-01`/`SCR-02` 進捗＆再試行 UI・`IntersectionObserver` 結線・`AppShell` 同期プリエンプション・1280px/375px VRT 実装
3. **Step 4 IT**: Playwright `SCN-06`（`test/it/cover-extraction.spec.ts`）結合検証・全シナリオ回帰 PASS・差分仕様アーカイブ移動・`HO-13` Android 実機検証（`Closes #26`）
