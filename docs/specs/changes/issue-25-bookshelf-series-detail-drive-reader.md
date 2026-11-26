---
type: spec-delta
title: "Issue #25 差分仕様: 仮想本棚ホーム（SCR-01）・シリーズ詳細（SCR-02）・Drive 巻リーダー統合"
description: "手動Drive同期トリガー（SCR-01/SCR-04共有）、4軸基本ソート対応シリーズカードグリッド・クイック起動（TR-02b）、シリーズ詳細画面（SCR-02: /series/:seriesId）、およびDrive巻リーダー統合（SCR-03: /read/volume/:volumeId, TR-07/TR-08）を定義する差分仕様"
status: "Review (#25)"
updated: "2026-11-25"
issue: "#25"
tags:
  [
    delta,
    v0.2,
    bookshelf,
    series-detail,
    reader,
    settings,
    scr-01,
    scr-02,
    scr-03,
    scr-04,
    google-drive,
    drive-sync,
    navigation,
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
  - docs/specs/providers/filename-parser.md
  - docs/guidelines/workflow.md
  - docs/guidelines/testing.md
  - docs/quality/bug-and-handover-log.md
related_tests:
  - src/App.test.tsx
  - src/app/ServiceProvider.test.tsx
  - src/features/bookshelf/BookshelfHeader.test.tsx
  - src/features/bookshelf/BookshelfPage.test.tsx
  - src/features/bookshelf/bookshelfUiStateStore.test.ts
  - src/features/reader/ReaderErrorView.test.tsx
  - src/features/reader/ReaderHudOverlay.test.tsx
  - src/features/reader/ReaderPage.test.tsx
  - src/features/reader/readerErrors.test.ts
  - src/features/settings/SettingsPage.test.tsx
  - src/shared/router/RouterProvider.test.tsx
  - src/shared/router/routeMatcher.test.ts
  - src/shared/router/routerContext.test.ts
  - src/storage/repositories/readingProgressRepository.test.ts
  - src/storage/repositories/seriesRepository.test.ts
  - src/storage/repositories/volumesRepository.test.ts
  - test/vrt/vrt.spec.ts
  - test/it/smoke.spec.ts
  - test/it/local-reader.spec.ts
  - test/it/settings-oauth.spec.ts
  - test/it/drive-sync.spec.ts
---

# Issue #25 差分仕様: 仮想本棚ホーム（`SCR-01`）・シリーズ詳細（`SCR-02`）・Drive 巻リーダー統合

## 1. 背景・目的（Why）

- Milestone `v0.2`（Google Drive 連携 ＆ 最小仮想本棚：日常実用 MVP）の第 3 弾として、`#23`（Google OAuth・`GoogleDriveRangeReader`・`SCR-04` ルート管理）および `#24`（`DriveSyncEngine`・ファイル名スマートパーサー・`Series` / `Volumes` / `DriveSyncMeta` Repository）で構築したバックエンド基盤を全 4 画面（`SCR-01`〜`SCR-04`）へ結線し、Google Drive 上の自炊アーカイブを日常的に同期・選書・ストリーミング読書・自動レジュームできる一気通貫の MVP 体験（`TR-01`〜`TR-10`）を完成させる。

### 1.1 Step 1 合意事項（`/grill-me` 確定内容：Q1〜Q7 ＋ `v0.3` ロードマップ整理）

1. **Google Drive 手動同期トリガーの配置・実行タイミング・画面間共有（Q1）**:
   - アプリ起動時や画面遷移時の自動バックグラウンド通信は行わず、明示的な手動実行のみとする（`NFR-03`：通常の本棚ブラウジング時は Drive API 通信ゼロ・100% ローカル IndexedDB 完結）。
   - `SCR-01`（`BookshelfHeader`）に日常利用向けの **「同期」ボタン**（`DriveSyncEngine.sync()`：初回・未同期ルート追加時は自動フルスキャン、2 回目以降は `changes.list` 増分同期）、`SCR-04`（`DriveSyncExecutionSection`）に **「今すぐ同期（差分）」ボタン** とトラブルシュート用の **「強制フルスキャン」ボタン**（`DriveSyncEngine.sync({ forceFullScan: true })`）の両方を配置し、実行中ステータス・最終同期日時・結果サマリ・エラーを共有 Zustand ストア（`driveSyncStateStore`）で一元管理する。
   - `SCR-04` で同期実行中（`isSyncing === true`）の間はログアウトおよびルートフォルダ追加/切替/削除を `disabled` で排他保護する一方、優先度 1 戻るブロック（`isBackBlocked`）には含めず、`TR-09` で `SCR-01` へ戻っても同期状態が共有継続され完了時に本棚一覧が自動再読込される構成とする。
2. **`SCR-01` 本棚ホームのレイアウトとローカル ZIP 導線の共存（Q2）**:
   - 有効な Drive シリーズが 1 件以上ある場合（`visibleSeries.length > 0`）は、「蔵書ツールバー（`BookshelfToolbar`）＋シリーズカードグリッド（`SeriesGridSection`）」を主役にして初期の大きな `LocalArchiveEmptyState` カードを自動的に折りたたむ。ローカル ZIP オープンはヘッダーボタン・`<main>` Web D&D・下部の `RecentLocalHistorySection`（`local:*` 1 件以上時）で引き続き常時利用可能とし、不正拡張子選択/ドロップ時の `role="alert"`（`data-testid="local-zip-error"`）も全状態で表示する。
   - Google 連携済み かつ 有効ルート 1 件以上で有効シリーズが 0 件のときは、「今すぐ同期」プライマリ CTA（およびローカル ZIP サブボタン）を備えた `DriveSyncEmptyState` を表示する。
   - 未連携（`unauthenticated`）でも過去に同期済みのローカル蔵書が IndexedDB に残っている場合は、上部に `DriveSetupBanner("unauthenticated")` を表示しつつローカル蔵書グリッドの閲覧を維持する。
3. **シリーズカードのタップ挙動（`TR-01`）とクイック起動（`TR-02b`）・代表表紙ルール（Q3）**:
   - シリーズカード本体タップは所持巻数（1 冊・複数冊）にかかわらず常に `/series/:seriesId`（`SCR-02`）へ遷移する（`TR-01`）。
   - カード上のクイック起動ボタン（`TR-02b`, `stopPropagation`）は全シリーズに配置し、対象巻を **「① `reading` 巻のうち最新 `lastReadAt`（同値時は巻順先頭） → ② 巻順最小の未読了巻 → ③ 全巻 `completed` 時は巻順先頭巻」** の決定論ルールで選んで `/read/volume/:volumeId`（`readerOrigin: "bookshelf"`）を直接開く。
   - 代表表紙は `series.representativeVolumeId`（所属有効巻内に存在する場合）を優先し、なければ巻順先頭巻を採用する。`coverStatus === "ready" && coverBlob !== null` 時は `URL.createObjectURL(coverBlob)`（アンマウント/変化時 `URL.revokeObjectURL` 厳格解放）、未抽出時はダーク調タイポグラフィプレースホルダを表示する。
4. **`SCR-01` 基本ソート 4 軸とオンメモリ状態保持（Q4）**:
   - **「最終読書順（初期値 `"lastReadDesc"`：未読 `lastReadAt === null` は後ろに回し追加順）」「追加順（`"addedDesc"`）」「タイトル順（`"titleAsc"`）」「巻数順（`"volumeCountDesc"`）」** の 4 軸を提供する。
   - 選択中のソート順は `bookshelfUiStateStore`（オンメモリ）で保持し、`SCR-02` / `SCR-03` / `SCR-04` との往復遷移（`TR-05` / `TR-08` / `TR-09`）時にスクロール位置とともに復元する。
5. **`SCR-02` シリーズ詳細（`/series/:seriesId`）の新設・スクロール復元・異常系（Q5）**:
   - 新規正本 [series-detail.md](../features/series-detail.md) を作成し、「上部ヘッダー ＋ 作品サマリカード（代表表紙・タイトル・著者・所持巻数/読了数・続きを読むプライマリ CTA）＋ 所属有効巻一覧（単巻/合本バッジ・元ファイル名・サイズ・ステータス・ページ進捗バー）」で構成する。
   - `SCR-02` ↔ `SCR-03`（`TR-04` / `TR-07`）往復時の `SCR-02` スクロール位置復元を備え、未存在 `seriesId`・論理削除済み・または有効巻 0 件（全巻ゴミ箱化／ルート一時無効化中）へのアクセス時は例外を起こさず案内ビュー（`SeriesDetailEmptyState`）＋「本棚へ戻る」（`TR-05`）を表示する。
6. **`SCR-03` Drive 巻リーダー統合（`/read/volume/:volumeId`）（Q6）**:
   - `window.history.state` で起点（`readerOrigin: "bookshelf" | "series-detail"`, `seriesId`）を保持し、終了時は `bookshelf` 起点なら `TR-08`（`/`）、`series-detail` 起点なら `TR-07`（`/series/:seriesId`）へ戻す（直接 URL アクセス等で起点不在時は実在巻なら所属 `/series/:seriesId`、未存在巻なら `/` へ `replace` フォールバック）。
   - 上部 HUD タイトルは「`${series.title} ${volume.volumeLabel}`」（`series` 未取得時は `volume.rawFileName`）を表示し、`vol:${volumeId}` 進捗保存時に `SeriesRepository.updateLastReadAt(volume.seriesId, lastReadAt)` を連動更新する（`series.updatedAt` は非汚染）。
   - 未存在 `volumeId`（`VOLUME_NOT_FOUND`）・ゴミ箱または無効ルート配下（`VOLUME_UNAVAILABLE`）・Google 未連携（`AUTH_REQUIRED`）時は Worker を起動せず `ReaderErrorView (mode="archive")` で理由別メッセージ＋戻りボタンを表示する。
7. **Android 実機検証区分・Sub-issue 分割計画（Q7）および `v0.3` 大規模本棚 UX 方針**:
   - **Android 実機検証**: **区分 A（`親 Issue #25 完了前`）** とし、`HO-10`（Drive Range ストリーミング閲覧・TTFP・0 RTT 再オープン・レジューム・戻る優先度）および `HO-12`（実 Drive ルート同期・`changes.list` 差分追従・ファイル名パース）をクラウドビルド `app-debug.apk` で一体実証してから `#26` へ進む。
   - **実装分割**: **3 MK（MK-1: ルーティング・一括進捗取得・共有同期ストア・集約純関数 / MK-2: `SCR-01` 本棚拡張 ＆ `SCR-04` 同期 UI / MK-3: `SCR-02` シリーズ詳細 ＆ `SCR-03` Drive リーダー統合）＋ Step 4 IT（`SCN-05`）** の 4 分割とする。
   - **`v0.3` ロードマップ明記**: `v0.2` は MVP としてフラットグリッド＋4軸ソートとし、1,000 シリーズ規模でのブラウジングアクセス性向上（五十音インデックスジャンプ、作者／レーベル別グルーピング表示切替、Virtual Grid 等）は `v0.3` で詳細検討・実装する方針を [requirements.md](../requirements.md) および [screen-transitions.md](../screen-transitions.md) へ反映する。

### 1.2 対象外スコープ

- 2段優先度・表紙 WebP 自動抽出スケジューラ（`CoverExtractionScheduler`）＆ リーダー起動時プリエンプション（→ `#26` `[v0.2][4/4]`）
- 公開書誌 API（NDL サーチ / AniList / Google Books）連携・精密五十音ソート・インクリメンタル複合検索・カスタム/スマートコレクション・1,000 シリーズ級本棚アクセス UX（→ `v0.3`）
- 巻末からの「次の巻を読む」連続遷移 `TR-06`・作品別画質プリセット・表紙半裁クロップ・メモ付きしおり（→ `v0.4`）

---

## 2. 新規作成・変更対象の App 全体正本一覧

|   種別   | 正本ファイル                                                     | 変更概要                                                                                                                                                                   |
| :------: | :--------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **新規** | [series-detail.md](../features/series-detail.md)                 | `SCR-02`（`/series/:seriesId`）の作品サマリ・クイック起動・単巻/合本巻一覧・進捗バー・未存在/0件案内・スクロール復元・`AC-SD-01`〜`06` を新設                              |
| **更新** | [bookshelf.md](../features/bookshelf.md)                         | `SCR-01` 手動同期ボタン・3分岐メイン構成・`BookshelfToolbar`（4軸ソート）・`SeriesCard`（`TR-01`/`TR-02b`）・決定的 VRT 契約・`AC-BS-08`〜`12` を追加                      |
| **更新** | [reader.md](../features/reader.md)                               | `/read/volume/:volumeId` 事前検証・`gdrive` ソース構築・`vol:*` ＆ `series.lastReadAt` 保存・HUD「作品名 巻ラベル」・`TR-07`/`TR-08` 起点戻り・`AC-RD-16`〜`19` を追加     |
| **更新** | [settings.md](../features/settings.md)                           | `DriveSyncExecutionSection`（今すぐ同期・強制フルスキャン・結果サマリ・同期中排他保護・`TR-09` 非ブロック継続）および `AC-ST-08` を追加                                    |
| **更新** | [db-schema.md](../db-schema.md)                                  | `ReadingProgressRepository.listByVolumeIds` 一括取得契約、`vol:*` 保存時の `series.lastReadAt` 更新、および `resetTestDb` での UI/同期ストア初期化を追記                   |
| **更新** | [screen-transitions.md](../screen-transitions.md)                | `SCR-01`〜`SCR-04`・`TR-01`〜`TR-10`（`readerOrigin` 履歴保持・直接 URL フォールバック・`#26` プリエンプション段階注記）・戻る優先度 3/4・結合シナリオ **`SCN-05`** を更新 |
| **更新** | [architecture.md](../architecture.md)                            | Layer 3（`listByVolumeIds`）および Layer 4（5ルート Router・`driveSyncStateStore`・`CoverThumbnail`・`series-detail`）の責務境界を同期                                     |
| **更新** | [requirements.md](../requirements.md)                            | `SCR-03` 生 WebGL2 vs 本棚表紙 `ObjectURL` 境界明確化、`v0.2` 4軸ソート更新、および **`v0.3` 大量蔵書（1,000シリーズ級）本棚アクセス UX 強化計画** を反映                  |
| **更新** | [google-drive.md](../providers/google-drive.md)                  | `related_specs` へ `series-detail.md` / `reader.md` を双方向同期                                                                                                           |
| **更新** | [filename-parser.md](../providers/filename-parser.md)            | `related_specs` へ `bookshelf.md` / `series-detail.md` を双方向同期                                                                                                        |
| **更新** | [bug-and-handover-log.md](../../quality/bug-and-handover-log.md) | 区分 A 実機検証合意に基づき **`HO-10`・`HO-12`** の完了ゲートを `親 Issue #25 完了前` に統一し検証観点を詳細化                                                             |

---

## 3. 追加・変更する仕様の差分詳細

### 3.1 ルーティング拡張・進捗一括取得・共有同期ストア・本棚集約純関数（MK-1）

1. **5 ルート対応カスタムルーター（`src/shared/router/`）**:
   - `routeMatcher.ts`:
     - `AppRoute` に `{ name: "series-detail", path: string, seriesId: string }`（`/series/:seriesId`）および `{ name: "reader-volume", path: string, volumeId: string }`（`/read/volume/:volumeId`）を追加する。
     - `buildSeriesDetailPath(seriesId)` / `buildReaderVolumePath(volumeId)` ヘルパーを提供し、`matchRoute(path)` では単一非空セグメントの `decodeURIComponent` を安全実行する（空セグメント・スラッシュ含有・不正パーセントエンコード `URIError` 時は例外を投げず `BOOKSHELF_ROUTE` `/` へフォールバック）。
   - `routerContext.ts` / `RouterProvider.tsx`:
     - `ReaderOrigin = "bookshelf" | "series-detail"` および `NavigateOptions = { replace?: boolean; readerOrigin?: ReaderOrigin; seriesId?: string }` を導入し、`navigate(to, options)` で `window.history.state`（`ExLibrisHistoryState`）に `{ exLibrisCanGoBackFrom, readerOrigin, seriesId }` を記録する。
     - `getReaderOriginState(): { readerOrigin: ReaderOrigin | null; seriesId: string | null; canGoBackFrom: string | null }`（または `RouterContextValue.exitReader(fallbackSeriesId?: string | null)`）を提供し、`back()` も `series-detail` ルートからの `/` 復帰（履歴一致時は `window.history.back()`、直接アクセス時は `replace("/")`）に対応する。
2. **Drive 巻進捗の一括取得（`src/storage/repositories/readingProgressRepository.ts`）**:
   - `ReadingProgressRepository` に `listByVolumeIds(volumeIds: ReadonlySet<string>): Promise<ReadonlyMap<string, ReadingProgressRecord>>` を追加する（FIFO 直列化、`volumeIds.size === 0` 即時空 `Map`、単一 `rw` トランザクション内 `bulkGet` による破損レコード自動削除＆有効レコード抽出）。
   - 既存テストで `ReadingProgressRepository` モックを手動構築している `src/features/bookshelf/BookshelfPage.test.tsx` および `src/features/reader/ReaderPage.test.tsx` のモックヘルパーへ `listByVolumeIds` スタブを同時追加し、`typecheck` 100% 整合を維持する。
3. **画面間共有 Drive 同期ストア（`src/shared/sync/driveSyncStateStore.ts`）**:
   - `phase: "idle" | "syncing" | "completed" | "error"`, `activeMode: "incremental" | "full" | null`, `lastSyncedAt: number | null`, `isLastSyncedAtLoaded: boolean`, `lastResult: DriveSyncResult | null`, `errorMessage: string | null`, `completedSyncCount: number` を管理する。
   - `hydrateLastSyncedAt(driveSyncMetaRepo)`（未読込時のみ `getSyncState()` から `lastDriveSyncAt` を反映し、先行完了した新同期時刻を上書きしないガード付き）、`runDriveSync({ driveSyncEngine, forceFullScan })`（多重実行抑止・`skipped-no-roots` 時の `lastSyncedAt` 保護・`DriveApiError`/`GoogleAuthError` の日本語メッセージ変換＆診断ログ記録・完了時 `completedSyncCount + 1`）、およびテスト初期化用 `resetDriveSyncState()` を提供する。
4. **本棚・シリーズ詳細ビューモデル純関数 ＆ UI 状態ストア拡張**:
   - `src/features/bookshelf/bookshelfViewModel.ts`:
     - `BookshelfSortOrder = "lastReadDesc" | "addedDesc" | "titleAsc" | "volumeCountDesc"`
     - `buildBookshelfSeriesItems({ seriesList, visibleVolumes, progressByVolumeId })`: 有効巻 1 冊以上のシリーズのみを抽出し、代表表紙巻（`representativeVolumeId` 優先 → 先頭巻）、読了冊数、シリーズ読了状態（`unread` / `reading` / `completed`）、およびクイック起動対象巻＆ラベル（`resolveQuickLaunchVolume`：①最新 `reading` → ②先頭未読了 → ③全読了時は先頭巻）を算出する。
     - `sortBookshelfSeriesItems(items, sortOrder)`: 4 軸ソート（`lastReadDesc` は `lastReadAt !== null` を先頭に降順、未読 `null` 同士は最大 `addedAt` 降順 → `titleReading` 昇順 → `title` 昇順 → `id` 昇順）を決定論的に実行する。
     - `buildSeriesDetailViewModel({ series, volumes, enabledRootIds, progressByVolumeId })`: 有効ルート＆非ゴミ箱フィルタ、合本判定（`isOmnibusVolume`）、各巻進捗率算出、サマリ CTA 解決を行う。
     - `formatSyncTimestamp(epochMs, timeZone = "Asia/Tokyo")`（`Intl.DateTimeFormat("ja-JP", ...)` による OS タイムゾーン非依存の `YYYY/MM/DD HH:mm` 決定論フォーマット）および `formatByteSize(bytes)` を提供する。
   - `src/features/bookshelf/bookshelfUiStateStore.ts`:
     - `sortOrder: BookshelfSortOrder`（初期値 `"lastReadDesc"`、`setSortOrder`）および `seriesDetailScroll: { seriesId: string; scrollY: number } | null`（`saveSeriesDetailScroll` / `clearSeriesDetailScroll`）を追加し、`resetBookshelfUiState()` で一括リセットする。
   - `src/app/ServiceProvider.tsx`:
     - `window.__exLibrisServices.resetTestDb` 内で `resetBookshelfUiState()` と `resetDriveSyncState()` を呼び出し、Playwright IT テスト間のストア残留をゼロにする。

### 3.2 `SCR-01` 仮想本棚ホーム拡張 ＆ `SCR-04` 手動同期セクション統合（MK-2）

1. **共通表紙サムネイルコンポーネント（`src/shared/ui/CoverThumbnail.tsx`）**:
   - `coverBlob: Blob | null`, `coverStatus: CoverStatus`, `title: string`, `badgeText?: string` を受け取り、`coverStatus === "ready" && coverBlob !== null` 時は `useEffect` 内で `URL.createObjectURL(coverBlob)` を生成して描画し、クリーンアップ時（アンマウントまたは `coverBlob` 参照変化時）に必ず `URL.revokeObjectURL` を呼び出す。未抽出時はタイトル頭文字・抜粋と巻数バッジを備えたスレート系プレースホルダを描画する。
2. **`SCR-01` コンポーネント群（`src/features/bookshelf/`）**:
   - `BookshelfHeader.tsx`: 右側アクション先頭に手動「同期」ボタン（`data-testid="header-sync-drive-button"`、`canSync?: boolean`, `isSyncing?: boolean`, `onSyncDrive?: () => void`）を追加する。
   - `BookshelfToolbar.tsx`: 作品・冊数サマリ、最終同期日時・直近同期結果・同期エラーアラート（`data-testid="bookshelf-sync-error"`）、4軸ソート `<select data-testid="bookshelf-sort-select">` を描画する Pure Presentational コンポーネント。
   - `SeriesCard.tsx` / `SeriesGridSection.tsx`: 代表表紙（`CoverThumbnail`）・タイトル・著者・所持巻数・読書ステータスバッジ、カード本体ボタン（`data-testid="series-card-open-detail"` → `TR-01`）、およびクイック起動ボタン（`data-testid="series-card-quick-read"` → `TR-02b`）を描画する。
   - `DriveSyncEmptyState.tsx`: `driveSetupState.kind === "ready" && visibleSeries.length === 0` 時に「今すぐ同期」プライマリ CTA（`data-testid="empty-state-sync-drive-button"`）と「ローカル ZIP を開く」サブボタン（`data-testid="open-local-zip-button"`）を描画する。
   - `BookshelfPage.tsx`: IndexedDB 蔵書読込・`driveSyncStateStore` 購読（`completedSyncCount` 変化時の自動再読込）・3 分岐レイアウト・非 `LocalArchiveEmptyState` 時の D&D 不正拡張子アラート（`data-testid="local-zip-error"`）・3 系統全完了後（`isDriveSetupSettled && isRecentHistorySettled && isShelfDataSettled`）の `window.scrollTo` 復元・VRT 用 `initialSnapshot?: BookshelfPageInitialSnapshot` を統合する。
3. **`SCR-04` 手動同期セクション（`src/features/settings/`）**:
   - `DriveSyncExecutionSection.tsx`: 同期ステータスバッジ、決定論フォーマット済み最終同期日時、直近結果サマリ、エラーアラート（`data-testid="drive-sync-error"`）、「今すぐ同期（差分）」（`data-testid="settings-sync-incremental-button"`）および「強制フルスキャン」（`data-testid="settings-sync-full-button"`）ボタンを描画する。
   - `GoogleAccountSection.tsx` / `DriveSyncRootsSection.tsx` / `SettingsPage.tsx` / `types.ts`: `isSyncing === true` 中のログアウトおよびルート追加・切替・削除ボタン `disabled` 排他制御、`driveSyncStateStore` 結線、および `SettingsPageInitialSnapshot.syncState` 拡張を行う。

### 3.3 `SCR-02` シリーズ詳細新設 ＆ `SCR-03` Drive 巻リーダー・App シェル統合（MK-3）

1. **`SCR-02` シリーズ詳細画面（`src/features/series-detail/`）**:
   - `SeriesDetailHeader.tsx`, `SeriesSummaryCard.tsx`, `SeriesVolumeListSection.tsx`, `SeriesDetailEmptyState.tsx`, `SeriesDetailPage.tsx`（および `types.ts`）を新設する。
   - `SeriesDetailPage.tsx` は `seriesId` に対して IndexedDB からシリーズ・有効巻・一括進捗を解決し、巻タップまたはサマリ CTA 押下時に `saveSeriesDetailScroll(seriesId, window.scrollY)` を記録して `navigate(buildReaderVolumePath(volumeId), { readerOrigin: "series-detail", seriesId })`（`TR-04`）を実行し、`TR-07` 復帰時に `isSettled === true` 後にスクロール位置を復元する。
2. **`SCR-03` Drive 巻リーダー統合（`src/features/reader/`）＆ `App.tsx` 配線**:
   - `readerErrors.ts`: `ReaderFatalErrorCode` に `"VOLUME_NOT_FOUND" | "VOLUME_UNAVAILABLE" | "AUTH_REQUIRED"` を追加し、`getReaderErrorMessage` に日本語メッセージを定義する。
   - `ReaderErrorView.tsx`: オプショナル `backLabel?: string`（デフォルト `"ホームへ戻る"`、`TR-07` 戻り時は `"シリーズ詳細へ戻る"`）を追加する。
   - `ReaderPage.tsx`:
     - `route.name === "reader-local"` と `route.name === "reader-volume"` の双方をサポートする。
     - `reader-volume` 時は `volumesRepo.getById` → `driveSyncRootsRepo.listActive`（有効＆非ゴミ箱検証）→ `googleAuthBridge` セッション確認 → `seriesRepo.getById`（HUD 表示名 `${series.title} ${volume.volumeLabel}` 解決）を経て `kind: "gdrive"` の `ArchiveSourceDescriptor` を構築し、既存の `CoordinatorCore`（`GoogleDriveRangeReader` ＋ `zipIndexCache` 0 RTT ＆ 1 回限り自己修復 ＋ L1/L2 キャッシュ ＋ 1パス画質補正シェーダー）へ接続する。
     - `persistCurrentProgress` で `kind: "gdrive"` 時は `ReadingProgressRepository.put({ targetKey: "vol:${volume.id}", volumeId: volume.id, ... })` と `SeriesRepository.updateLastReadAt(volume.seriesId, now)` を実行する。
     - 終了時は `readerOrigin` に基づき `TR-07`（`/series/:seriesId`）または `TR-08`（`/`）へ遷移する（直接 URL フォールバック対応）。
   - `src/App.tsx`: `route.name === "series-detail"`（`<SeriesDetailPage key={route.seriesId} ... />`）および `route.name === "reader-volume"`（`<ReaderPage key={route.path} ... />`）を配線し、`appBridge.addBackButtonListener` の優先度 2/3（`reader-local` / `reader-volume`）および優先度 4（`settings` / `series-detail`）を更新する。

### 3.4 Playwright IT `SCN-05` ＆ 差分仕様アーカイブ（Step 4 IT）

- `test/it/bookshelf-drive-reader.spec.ts`（`SCN-05`）を新設し、実ブラウザ IndexedDB ＋ 実 Web Worker ＋ SwiftShader WebGL2 ＋ Playwright `context.route("https://www.googleapis.com/drive/v3/files/**", ...)`（`206 Partial Content` バイトスライスおよび `401` Single-Flight トークンリフレッシュ応答）を組み合わせて、`SCR-04`/`SCR-01` 手動同期 → 本棚 4 軸ソート → `TR-02b` クイック起動 ＆ `TR-08` 復帰 → `TR-01` `SCR-02` 詳細 ＆ `TR-04` 2回目 `zipIndexCache` 0 RTT レジューム ＆ `TR-07` スクロール復元 → ハードウェア戻る優先度 → 全異常系エラー導線を一貫検証する。
- Step 4 PR（`Closes #25`）にて本差分仕様を `Completed (Archived)` として `docs/specs/changes/archive/issue-25-bookshelf-series-detail-drive-reader.md` へ `git mv` し、関連正本の `related_tests` 更新・実機検証（`HO-10` / `HO-12`）試験項目提示を実施する。

---

## 4. テスト計画（UT / Storybook VRT / Playwright IT）

| 層                                                   | テスト手法・対象                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | 合格基準                                                          |
| :--------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :---------------------------------------------------------------- |
| **MK-1: ルーター・進捗一括取得・同期＆集約ロジック** | `routeMatcher.test.ts`（5ルート解決・URLデコード・空/多段/不正エンコード `/` フォールバック）、`RouterProvider.test.tsx` / `routerContext.test.ts`（`readerOrigin` `history.state` 保持・`TR-05`/`TR-07`/`TR-08` 戻り＆直接 URL フォールバック）、`readingProgressRepository.test.ts`（`listByVolumeIds` 空集合・一括取得・破損自動削除・FIFO 直列化）、`driveSyncStateStore.test.ts`（水和競合保護・多重抑止・`skipped-no-roots`・エラー変換）、`bookshelfViewModel.test.ts`（4軸ソート・`resolveQuickLaunchVolume`・代表表紙・合本判定・`Asia/Tokyo` 日時整形）、`bookshelfUiStateStore.test.ts`、`ServiceProvider.test.tsx` | C0 / C1 / Functions / Lines **100%** PASS                         |
| **MK-2: `SCR-01` 本棚 ＆ `SCR-04` 手動同期 UI**      | `CoverThumbnail`（`createObjectURL` / `revokeObjectURL` 厳格解放・プレースホルダ）、`BookshelfHeader`、`BookshelfToolbar`、`SeriesCard`、`SeriesGridSection`、`DriveSyncEmptyState`、`BookshelfPage`（親子 `vi.spyOn` 完全分離・3系統完了後スクロール復元・非空時 D&D アラート）、`DriveSyncExecutionSection`、`GoogleAccountSection`、`DriveSyncRootsSection`、`SettingsPage` の 1対1 Story / UT ＆ VRT                                                                                                                                                                                                                       | C0 / C1 / Functions / Lines **100%** ＆ 1280px/375px **VRT PASS** |
| **MK-3: `SCR-02` 詳細 ＆ `SCR-03` Drive リーダー**   | `SeriesDetailHeader`、`SeriesSummaryCard`、`SeriesVolumeListSection`、`SeriesDetailEmptyState`、`SeriesDetailPage`（親子 `vi.spyOn` 分離・スクロール復元）、`readerErrors.test.ts`、`ReaderErrorView`、`ReaderPage`（`/read/volume/:volumeId` 事前検証 3 種・`gdrive` 0RTT/自己修復・`vol:*`＋`updateLastReadAt`・`TR-07`/`TR-08`）、`App.test.tsx`（5ルート＆戻る優先度 1〜5）の 1対1 Story / UT ＆ VRT                                                                                                                                                                                                                       | C0 / C1 / Functions / Lines **100%** ＆ 1280px/375px **VRT PASS** |
| **Step 4: Playwright IT (`SCN-05`)**                 | `test/it/bookshelf-drive-reader.spec.ts` 新設 ＋ 既存 `SCN-01`〜`SCN-04` 全シナリオ回帰実行                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | 全 UT 100% / 全 VRT PASS / 全 Playwright IT **100% PASS**         |

---

## 5. Sub-issue 分割計画・申し送り事項・Android 実機検証計画

### 5.1 Sub-issue 分割計画（設計 PR マージ後に起票）

1. **Sub-issue ①（MK-1）: 5ルート Router・`listByVolumeIds`・共有 `driveSyncStateStore`・本棚ビューモデル純関数実装**
   - 対象: `src/shared/router/{routeMatcher,routerContext,RouterProvider}.ts(x)`, `src/storage/repositories/readingProgressRepository.ts`, `src/shared/sync/driveSyncStateStore.ts`, `src/features/bookshelf/{bookshelfViewModel,bookshelfUiStateStore}.ts`, `src/app/ServiceProvider.tsx`（および型波及する既存テストモック `BookshelfPage.test.tsx`, `ReaderPage.test.tsx`）＋ 全 1対1 単体テスト
2. **Sub-issue ②（MK-2）: `CoverThumbnail`・`SCR-01` シリーズ本棚 UI 拡張 ＆ `SCR-04` 手動同期実行セクション実装（＋VRT）**
   - 対象: `src/shared/ui/CoverThumbnail.tsx`, `src/features/bookshelf/{BookshelfHeader,BookshelfToolbar,SeriesCard,SeriesGridSection,DriveSyncEmptyState,BookshelfPage}.tsx`, `src/features/settings/{types,DriveSyncExecutionSection,GoogleAccountSection,DriveSyncRootsSection,SettingsPage}.ts(x)` ＋ 全 1対1 `*.stories.tsx` / `*.test.tsx` / 1280px・375px VRT
3. **Sub-issue ③（MK-3）: `SCR-02` シリーズ詳細画面新設 ＆ `SCR-03` Drive 巻リーダー統合・`App` 5ルート結線（＋VRT）**
   - 対象: `src/features/series-detail/{types,SeriesDetailHeader,SeriesSummaryCard,SeriesVolumeListSection,SeriesDetailEmptyState,SeriesDetailPage}.ts(x)`, `src/features/reader/{readerErrors,ReaderErrorView,ReaderPage}.ts(x)`, `src/App.tsx` ＋ 全 1対1 `*.stories.tsx` / `*.test.tsx` / 1280px・375px VRT
4. **Sub-issue ④（Step 4 IT）: Playwright `SCN-05`（`test/it/bookshelf-drive-reader.spec.ts`）結合検証・実機検証（`HO-10` / `HO-12`）・仕様アーカイブ（`Closes #25`）**
   - 対象: `test/it/bookshelf-drive-reader.spec.ts`, 関連正本の `related_tests` 同期, 本差分仕様の `docs/specs/changes/archive/` 移動, `build-android.yml` `debug` による Google Drive `app-debug.apk` 配置 ＆ 実機検証試験項目表提示

### 5.2 Android 実機検証計画（区分 A：`親 Issue #25 完了前` / `HO-10`・`HO-12`）

- **実施粒度判定（[workflow.md §2.2](../../guidelines/workflow.md#22-android-実機検証の実施判断基準と試験項目表フォーマット)）**: **区分 A（親 Issue `#25` 完了前に実施）**
  - **根拠**: 実 Google Drive API と Android WebView Worker を用いた HTTP `Range` ストリーミング閲覧・L1 `ImageBitmap.close()` VRAM 解放・ハードウェア戻るボタン優先度制御（`SCR-01`〜`SCR-04` 横断）を含み、実機確認項目が 3 項目以上（下記 5 項目）発生するため、`#26`（表紙自動抽出キュー）へ進む前に実機で基盤動作を確定させる。
- **実機確認予定項目（Step 4 Gate 1〜6 完了時に `app-debug.apk` リンクとともに詳細試験項目表を提示）**:
  1. **`HO-12-1`（手動フルスキャン・シリーズ束ね）**: `SCR-04` または `SCR-01` から実 Google Drive 保管フォルダの同期を実行し、サブフォルダ配下の `.zip` / `.cbz`（単巻・合本・サブフォルダ補完）が本棚カードグリッドと `SCR-02` 巻一覧へ正しく束ね表示されること。
  2. **`HO-12-2`（`changes.list` 増分同期・ルート有効化切替）**: Drive 上でのファイル追加／リネーム／ゴミ箱移動後に「同期（差分）」で即座に追従すること、および `SCR-04` でのルート一時無効化→再有効化で本棚表示が切り替わること。
  3. **`HO-10-1`（Drive ZIP Range ストリーミング初回オープン ＆ ページめくり）**: `SCR-01` クイック起動（`TR-02b`）および `SCR-02` 巻選択（`TR-04`）から `/read/volume/:volumeId` を開き、事前全件 DL なしで初回ページ描画（目標 TTFP `< 1.0s`）・見開き/単頁めくり・シークバー・HUD「作品名 巻ラベル」表示が滑らかに動作すること。
  4. **`HO-10-2`（`zipIndexCache` 2回目 0 RTT オープン・自動レジューム・`lastReadAt` ソート連動）**: 途中ページでリーダーを閉じて再度同じ巻を開いた際、`fromIndexCache: true` で高速（目標 `< 0.5s`）に前回ページからレジュームし、`SCR-01`「最終読書順」の先頭および `SCR-02` 進捗バーへ反映されること。
  5. **`HO-10-3`（ハードウェア戻る優先度 ＆ スクロール復元 ＆ 診断ログ秘匿）**: 画質補正シート閉鎖（優先度 2）→ `TR-07`（`SCR-02` スクロール復元）/ `TR-08`（`SCR-01` スクロール＆ソート復元）（優先度 3）→ `SCR-02` から `SCR-01` 復帰（優先度 4）が意図通り動作し、診断ログコピー結果に平文 `Bearer` / `ya29.*` トークンが一切露出しないこと。
