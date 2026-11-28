---
type: spec-feature
title: "シリーズ詳細・巻一覧画面仕様書（SCR-02: Series Detail）"
description: "SCR-02（/series/:seriesId）の作品サマリ、続きを読むクイック起動、単巻＋合本混在の所属有効巻一覧・進捗バー、ビューポート優先表紙抽出連携・エラー再試行導線、未存在/0件エンプティ案内、およびTR-01/TR-04/TR-05/TR-07・スクロール復元・優先度4戻る制御の正本"
status: "Approved"
updated: "2026-11-28"
tags:
  [
    feature,
    series-detail,
    scr-02,
    bookshelf,
    volumes,
    cover,
    webp,
    reading-progress,
    google-drive,
    navigation,
    back-button,
    ui,
  ]
related_specs:
  - docs/index.md
  - docs/specs/requirements.md
  - docs/specs/architecture.md
  - docs/specs/db-schema.md
  - docs/specs/screen-transitions.md
  - docs/specs/engine/cover-extraction.md
  - docs/specs/features/bookshelf.md
  - docs/specs/features/reader.md
  - docs/specs/features/settings.md
  - docs/specs/providers/google-drive.md
  - docs/specs/providers/filename-parser.md
  - docs/guidelines/testing.md
related_tests:
  - src/App.test.tsx
  - src/features/bookshelf/bookshelfUiStateStore.test.ts
  - src/features/bookshelf/bookshelfViewModel.test.ts
  - src/features/series-detail/SeriesDetailEmptyState.test.tsx
  - src/features/series-detail/SeriesDetailHeader.test.tsx
  - src/features/series-detail/SeriesDetailPage.test.tsx
  - src/features/series-detail/SeriesSummaryCard.test.tsx
  - src/features/series-detail/SeriesVolumeListSection.test.tsx
  - src/shared/router/RouterProvider.test.tsx
  - src/shared/router/routeMatcher.test.ts
  - src/shared/router/routerContext.test.ts
  - src/shared/sync/driveSyncStateStore.test.ts
  - src/shared/ui/CoverThumbnail.test.tsx
  - src/shared/ui/useViewportVolumeObserver.test.ts
  - src/storage/repositories/seriesRepository.test.ts
  - src/storage/repositories/volumesRepository.test.ts
  - src/storage/repositories/readingProgressRepository.test.ts
  - test/vrt/vrt.spec.ts
  - test/it/bookshelf-drive-reader.spec.ts
  - test/it/cover-extraction.spec.ts
---

# シリーズ詳細・巻一覧画面仕様書（`SCR-02`: Series Detail）

本ドキュメントは、ExLibris のシリーズ詳細・巻一覧画面 **`SCR-02`（ルートパス `/series/:seriesId`）** に関する機能仕様・UI コンポーネント構成・画面遷移（`TR-01` / `TR-04` / `TR-05` / `TR-07`）・スクロール位置復元・受け入れ条件（`AC-SD-xx`）の正本（Single Source of Truth）です。

> [!NOTE]
> `v0.2`（`Issue #25`・`#26`）ではローカル IndexedDB（`series` / `volumes` / `readingProgress` / `driveSyncRoots`）完結の作品サマリ・巻一覧・`SCR-03` リーダー起動に加え、`IntersectionObserver` による収録巻の表紙 WebP 即時優先抽出とインプレース差分反映・シリーズ内エラー巻の再試行導線を備えます。公開書誌 API（NDL / AniList / Google Books）による書誌再検索・手動編集・ロックモーダルは `v0.3`、作品別画質/綴じ方向プリセットおよび表紙半裁クロップ・表紙ページ番号変更は `v0.5` で拡張します。

---

## 1. 画面責務とレイアウト構成（`v0.2 [3/4]` 〜 `v0.2 [4/4]`）

1. **テーマ・シェル・セーフエリア保護**:
   - スレート系ダークテーマ統一（背景 `bg-slate-950`、カード `bg-slate-900`、境界 `border-slate-800`）。
   - `<header>` には `paddingTop: "calc(1rem + env(safe-area-inset-top, 0px))"`、ページ下部には `paddingBottom: "calc(2rem + env(safe-area-inset-bottom, 0px))"` を設定し、Android Edge-to-Edge 環境でのシステムバー重複を防止する。すべてのインタラクティブボタンに `touch-manipulation` を付与する。
2. **上部ヘッダー領域（`SeriesDetailHeader`）**:
   - 左側: **「本棚へ戻る」ボタン**（`data-testid="series-detail-back-button"`, `TR-05` 実行）＋ ヘッダータイトル（作品取得済み時は `series.title` の 1 行省略表示、読込中・未存在時は「シリーズ詳細」）。
   - 右側: アプリバージョンバッジ（`v${APP_VERSION}`）。
3. **データ解決条件・初回ローディング境界・表紙インプレース更新（`NFR-03` / `NFR-04`）**:
   - 初回非同期 IndexedDB 取得が完了するまでの間（`!isSettled`、`initialSnapshot?.kind === "loading"` を含む）はエンプティ案内を誤表示せず、控えめなローディング表示（`data-testid="series-detail-loading"`）のみを描画する。
   - マウント時および共有同期ストア（`driveSyncStateStore.completedSyncCount`）の更新時に、ネットワーク通信を一切行わず以下の手順で表示データを解決する：
     1. `SeriesRepository.getById(seriesId)` を呼び出す。同メソッドは既存契約通り Tombstone レコード（`deletedAt !== null`）もそのまま返却するため、呼び出し側／`buildSeriesDetailViewModel` で **`const activeSeries = rawSeries !== null && rawSeries.deletedAt === null ? rawSeries : null`** と判定し、論理削除済みシリーズは未存在（`null`）として扱う。
     2. `DriveSyncRootsRepository.listActive()` から有効ルート集合 `enabledRootIds`（`enabled === 1`）を構築し、`VolumesRepository.listBySeriesId(seriesId)` の結果から **`enabledRootIds.has(volume.rootFolderId) && volume.isTrashed === 0`** を満たす有効巻配列 `visibleVolumes`（`VolumesRepository` 決定論ソート済み）を抽出する。
     3. `activeSeries !== null && visibleVolumes.length > 0` の場合、`ReadingProgressRepository.listByVolumeIds(new Set(visibleVolumes.map(v => v.id)))` で全所属巻の読書進捗マップを単一クエリで一括取得する。
   - **表紙 WebP 自動抽出とのリアルタイム連携（`initialSnapshot === undefined` 時）**:
     - `CoverExtractionScheduler.subscribeVolumeUpdated` を購読し、`event.seriesId === seriesId` の表紙更新イベント（`coverStatus: "pending" | "ready" | "error"`）を受信した際は IndexedDB 全件再クエリを行わず、保持中の `viewModel` 内の該当 `volumeId`（`representativeVolume` および `volumes` 配列内要素）の `coverBlob` / `coverStatus` / `coverUpdatedAt` のみをインプレースで差分更新する（他巻の `Blob` 参照同一性とスクロール位置を保護）。
     - `useViewportVolumeObserver`（`IntersectionObserver` `rootMargin: "200px 0px"`、未定義環境は安全 no-op、描画中 `pending` 巻集合の変化に追従して再走査・非 `pending` 化 ID を即時除外）により、可視領域内の `coverStatus === "pending"` 巻（サマリ代表巻および収録巻行の `data-cover-volume-id`）を `CoverExtractionScheduler.setViewportVolumeIds("series-detail", visibleIds)` へ登録して `viewport-high`（待機 0ms）へ昇格させる（アンマウント時は空 `Set` でクリア）。
   - IndexedDB 読み取りで例外が発生した場合は `diagnosticLogger.warn("series-detail", ...)` へ記録し、`isSettled = true` として安全な案内状態へフォールバックする。
4. **作品サマリカード（`SeriesSummaryCard`：`isSettled && activeSeries !== null && visibleVolumes.length > 0` 時）**:
   - **代表表紙サムネイル（`CoverThumbnail`）**:
     - `activeSeries.representativeVolumeId` が `visibleVolumes` 内に存在する場合はその巻、存在しないまたは `null` の場合は `visibleVolumes[0]`（巻順先頭巻）を代表表紙巻とする。
     - `coverStatus === "ready" && coverBlob !== null` の場合は `URL.createObjectURL(coverBlob)` による表紙画像（`loading="lazy"`, `decoding="async"`）を表示し、コンポーネントアンマウントまたは `coverBlob` 変化時に必ず `URL.revokeObjectURL` を呼び出してメモリリークを防止する。未抽出時は作品タイトル頭文字を含むダーク調タイポグラフィプレースホルダを表示し、`coverStatus === "error"` の場合はプレースホルダ内に控えめな「`取得失敗`」バッジ（`data-testid="cover-thumbnail-error-badge"`）を表示する。
   - **作品メタ情報**:
     - 作品タイトル（`data-testid="series-detail-title"`）
     - 著者名一覧（`activeSeries.authors.length > 0` 時にカンマ区切りまたはバッジ表示、空配列時は非表示）
     - 所持巻数・読了サマリバッジ（`data-testid="series-detail-progress-summary"`：全 `visibleVolumes.length` 巻、および読了巻数 `${completedCount} / ${visibleVolumes.length} 冊読了`）
   - **プライマリ CTA（クイック起動ボタン：`data-testid="series-detail-primary-read-button"`, `TR-04`）**:
     - [bookshelf.md §1.5](bookshelf.md#1-画面責務とレイアウト構成v01--v02-44) と同一の決定論ルール（`resolveQuickLaunchVolume`）で対象巻を決定する：
       1. `readStatus === "reading"` の巻が 1 冊以上ある場合：`lastReadAt` 最大（同値時は `visibleVolumes` 順先頭）の巻を選び、ラベルは **`「続きを読む（${volumeLabel}）」`** とする。
       2. `"reading"` が無く未読了（`"unread"` または進捗未保存）の巻がある場合：`visibleVolumes` 順で最初の未読了巻を選び、既読了巻が 0 冊なら **`「読み始める（${volumeLabel}）」`**、1 冊以上あれば **`「次を読む（${volumeLabel}）」`** とする。
       3. 全有効巻が `"completed"` の場合：`visibleVolumes[0]`（先頭巻）を選び、ラベルは **`「最初から読む（${volumeLabel}）」`** とする。
5. **シリーズ内表紙エラー再試行バー ＆ 所属有効巻一覧セクション（`SeriesVolumeListSection`：`data-testid="series-volume-list"`）**:
   - **シリーズ内表紙エラー再試行案内**: 所属有効巻（`visibleVolumes`）のうち `coverStatus === "error"` の巻が 1 冊以上存在する場合、コンパクトな案内バー（`data-testid="series-cover-error-banner"`：`${errorCount} 冊の表紙取得に失敗しました`）と当該シリーズ限定の **「表紙を再試行」ボタン**（`data-testid="series-retry-failed-covers-button"`：Google 連携済み［`isGoogleConnected === true`］かつ Drive 非同期実行中［`syncPhase !== "syncing"`］のとき活性、未連携時または Drive 同期実行中は `disabled`；押下時に `coverExtractionScheduler.retryFailedCovers({ seriesId })` を実行し配信される `"pending"` イベントで表示・監視状態を即時更新）を表示する（0 件時は非表示）。
   - `visibleVolumes`（単巻・小数巻・上下巻・合本・単発本が `VolumesRepository` の決定論昇順［`volumeNumber` 昇順 → 同一 `volumeNumber` 時は単巻優先 → `volumeLabel` 昇順 → `rawFileName` 昇順 → `id` 昇順］で並んだ配列）を一覧表示する。
   - 各巻行（`data-testid="series-volume-item"`, `data-volume-id={volume.id}`, `pending` 時は `data-cover-volume-id={volume.id}` も付与）は全体をタップ可能なボタン（`data-testid="open-volume-reader-button"`）とし、以下を表示する：
     - 巻別の表紙サムネイルまたはプレースホルダ（`CoverThumbnail`）
     - 巻ラベル（`volume.volumeLabel`、例: `"第01巻"`, `"第01-05巻 合本"`, `"単巻"`）および合本識別バッジ（`volume.volumeLabel.includes("合本")` が `true` のとき `合本` バッジ `data-testid="volume-omnibus-badge"` を表示）
     - 元ファイル名（`volume.rawFileName`、1 行省略）および人間可読ファイルサイズ（`formatByteSize(volume.fileSize)`）
     - 読書ステータスバッジ（`data-testid="volume-read-status"`：進捗未保存または `"unread"` は `未読`、`"reading"` は `読書中`、`"completed"` は `読了`）
     - ページ進捗テキストおよびプログレスバー（進捗レコードが存在する場合のみ `${currentPageIndex + 1} / ${totalPageCount} ページ` と、`readStatus === "completed"` 時は `100%`、それ以外は `Math.round(((currentPageIndex + 1) / totalPageCount) * 100)%` の進捗バーを表示）
6. **未存在・表示可能巻 0 件時のエンプティ案内（`SeriesDetailEmptyState`：`data-testid="series-detail-empty"`、`isSettled && (activeSeries === null || visibleVolumes.length === 0)` 時）**:
   - 初回読込完了後（`isSettled === true`）に、指定された `seriesId` が DB に存在しない・論理削除済み（`activeSeries === null`）・または有効な同期ルート配下に非ゴミ箱巻が 1 冊も存在しない（`visibleVolumes.length === 0`：全巻ゴミ箱移動や `SCR-04` でのルート一時無効化時を含む）場合は、例外や無言リダイレクトを起こさず以下を表示する：
     - 案内見出し「シリーズを表示できません」と説明文「指定されたシリーズが見つからないか、有効な同期フォルダ内に表示できる巻がありません。」
     - **「本棚へ戻る」ボタン**（`data-testid="series-detail-empty-back-button"`, `TR-05` 実行）

---

## 2. 画面遷移（`TR-01` / `TR-04` / `TR-05` / `TR-07`）・プリエンプション・スクロール復元・戻る優先度制御

1. **`TR-01`（`SCR-01` → `SCR-02`）と `TR-05`（`SCR-02` → `SCR-01`）**:
   - `SCR-01` でシリーズカードを選択した際、`bookshelfUiStateStore` に `SCR-01` の現在ソート順と `scrollY` を保持しつつ、過去の未消費 `seriesDetailScroll` を `clearSeriesDetailScroll()` でクリアした上で `/series/:seriesId` へ遷移する（`TR-01`）。
   - `SCR-02` でヘッダー「本棚へ戻る」ボタン、エンプティ案内「本棚へ戻る」ボタン、ブラウザ戻る（`popstate`）、または Android ハードウェア戻るボタン（優先度 4：`router.back()`）を実行した際、`/`（`SCR-01`）へ復帰し、保持されていた `SCR-01` のソート順・スクロール位置を復元する（`TR-05`）。直接 URL アクセス等で `/` からの履歴が無い場合も `router.back()` 内の安全フォールバック（`replace("/")`）により確実に `SCR-01` へ戻る。
2. **`TR-04`（`SCR-02` → `SCR-03`）同期プリエンプションと `TR-07`（`SCR-03` → `SCR-02`）スクロール位置復元**:
   - 長巻シリーズで途中巻を閲覧して戻った際に一覧先頭へ巻き戻らないよう、サマリ CTA または巻行タップで `/read/volume/:volumeId` へ遷移する直前に `bookshelfUiStateStore.saveSeriesDetailScroll(seriesId, window.scrollY)` を記録し、**即座に `coverExtractionScheduler.pause("reader")` を同期呼び出しして進行中の表紙通信を中断** した上で、`router.navigate(buildReaderVolumePath(volumeId), { readerOrigin: "series-detail", seriesId })` を呼び出す（`TR-04`）。
   - `SCR-03` から `TR-07` で `/series/:seriesId` へ戻った際、`AppShell` 側で `coverExtractionScheduler.resume("reader")` が実行されるとともに、`SeriesDetailPage` は非同期 DB 読込が完了した時点（`isSettled === true`）で `bookshelfUiStateStore` の `seriesDetailScroll` を確認し、同一 `seriesId` かつ `scrollY > 0` であれば `window.scrollTo(0, savedScrollY)` を実行する。また `seriesId` 不一致や `scrollY <= 0` の場合を含め、`seriesDetailScroll !== null` であればその時点で必ず `clearSeriesDetailScroll()` を呼び出して未消費状態を残留させない。

---

## 3. コンポーネント構成・親子分離・Storybook VRT 決定論性契約

| コンポーネント              | ファイルパス                                             | 責務（テスト分離方針）                                                                                                                           |
| :-------------------------- | :------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------- |
| `SeriesDetailPage`          | `src/features/series-detail/SeriesDetailPage.tsx`        | `Series` / `Volumes` / `ReadingProgress` / `DriveSyncRoots` 取得統合、表紙インプレース更新・`IntersectionObserver`・エラー再試行、スクロール保持 |
| `SeriesDetailHeader`        | `src/features/series-detail/SeriesDetailHeader.tsx`      | セーフエリア対応上部ヘッダー、「本棚へ戻る」ボタン、タイトル、バージョン表示（Pure Presentational）                                              |
| `SeriesSummaryCard`         | `src/features/series-detail/SeriesSummaryCard.tsx`       | 代表表紙、作品タイトル、著者、巻数/読了サマリ、クイック起動プライマリ CTA（Pure Presentational）                                                 |
| `SeriesVolumeListSection`   | `src/features/series-detail/SeriesVolumeListSection.tsx` | シリーズ内表紙エラー再試行バー、単巻・合本バッジ・サイズ・ステータス・進捗バー付きの所属巻一覧表示と巻選択コールバック（Pure Presentational）    |
| `SeriesDetailEmptyState`    | `src/features/series-detail/SeriesDetailEmptyState.tsx`  | 未存在 `seriesId` または有効巻 0 件時の案内カード＋「本棚へ戻る」ボタン（Pure Presentational）                                                   |
| `CoverThumbnail`            | `src/shared/ui/CoverThumbnail.tsx`                       | `SCR-01` / `SCR-02` 共用の表紙 `Blob` `ObjectURL` 表示（厳格 `revokeObjectURL`）・`error` バッジ・タイポグラフィプレースホルダコンポーネント     |
| `useViewportVolumeObserver` | `src/shared/ui/useViewportVolumeObserver.ts`             | `SCR-01` / `SCR-02` 共用の `data-cover-volume-id` 要素 `IntersectionObserver` 監視による `viewport-high` 表紙抽出優先度同期フック                |

- **親子分離 UT**: 親 `SeriesDetailPage` の単体テストでは直下の子コンポーネント（`SeriesDetailHeader`, `SeriesSummaryCard`, `SeriesVolumeListSection`, `SeriesDetailEmptyState`）をすべて `vi.spyOn(...).mockImplementation(() => null)` で完全分離する。同様に `SeriesSummaryCard` / `SeriesVolumeListSection` の単体テストでは `CoverThumbnail` を `vi.spyOn` で分離し、`ObjectURL` ライフサイクル自体は `CoverThumbnail.test.tsx` で 100% 単体検証する。
- **Storybook / VRT 決定論性保証**: `SeriesDetailPageProps` にオプショナルな `initialSnapshot?: SeriesDetailPageInitialSnapshot`（`loading` / `ready`［`series` + 進捗・`coverStatus` 付き巻配列 + オプショナルな再試行活性制御用 `isGoogleConnected` / `isSyncing`（省略時は `true` / `false` 既定）］/ `empty` を同期注入し初期非同期 IndexedDB フェッチ・認証確認・表紙スケジューラ購読をスキップする Prop）を設け、1280px / 375px VRT を 100% 決定論的に描画する。

---

## 4. 受け入れ条件（`AC-SD-xx`）

|   AC ID    | 受け入れ条件                                                                                                                                                                                                                                                        |
| :--------: | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `AC-SD-01` | `SCR-01` のシリーズカード選択により `/series/:seriesId`（`SCR-02`）へ遷移（`TR-01`）でき、作品タイトル・著者・所持巻数・読了数サマリ・代表表紙（未抽出時はプレースホルダ）がネットワーク通信ゼロ（IndexedDB 完結）で表示される。                                    |
| `AC-SD-02` | 有効な同期ルート配下かつ `isTrashed === 0` の所属巻（単巻・小数巻・上下巻・合本・単発本）が決定論的昇順で表示され、合本バッジおよび各巻の読書ステータス（`未読` / `読書中` / `読了`）・ページ進捗バーが表示される。                                                 |
| `AC-SD-03` | 作品サマリのプライマリ CTA または任意の巻行を選択すると、現在スクロール位置を保持し表紙抽出キューを一時停止した上で起点 `series-detail` として `/read/volume/:volumeId`（`SCR-03`）が起動（`TR-04`）し、終了時（`TR-07`）に `SCR-02` のスクロール位置が復元される。 |
| `AC-SD-04` | 存在しない `seriesId`・論理削除済みシリーズ・または有効巻 0 件（全巻ゴミ箱化／ルート一時無効化中）の場合はクラッシュせず案内ビュー（`series-detail-empty`）と「本棚へ戻る」ボタンを表示する。                                                                       |
| `AC-SD-05` | ヘッダー戻るボタン・案内ビュー戻るボタン・ブラウザ戻る・Android ハードウェア戻る（優先度 4）で `/` へ復帰（`TR-05`）し、`SCR-01` のソート順およびスクロール位置が復元される。                                                                                       |
| `AC-SD-06` | `SCR-02` の全コンポーネントが 1対1 の `*.stories.tsx`・親子分離 `*.test.tsx`（C0/C1/Functions/Lines 100%）・決定的初期状態注入による 1280px/375px VRT を PASS する。                                                                                                |
| `AC-SD-07` | `SCR-02` で可視領域の `pending` 巻が `viewport-high` で優先抽出されてスクロール位置を崩さずインプレース反映され、シリーズ内に `coverStatus === "error"` の巻が存在する場合は再試行バーから当該シリーズのエラー巻を再抽出できる。                                    |
