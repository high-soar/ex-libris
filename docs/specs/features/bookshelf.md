---
type: spec-feature
title: "仮想本棚ホーム画面仕様書（SCR-01: Bookshelf）"
description: "SCR-01（/）のダークテーマシェル、手動Drive同期トリガー、4軸基本ソート対応シリーズカードグリッド、「続きを読む」クイック起動（TR-02b）、設定導線・段階別ガイドバナー、ローカルZIP/CBZ選択導線・閲覧履歴、診断ログコピー、およびTR-01/TR-02a/TR-02b/TR-03/TR-05/TR-08/TR-09仕様の正本"
status: "Review (#25)"
updated: "2026-11-25"
tags:
  [
    feature,
    bookshelf,
    scr-01,
    series-grid,
    sorting,
    local-zip,
    saf,
    reading-progress,
    google-drive,
    drive-sync,
    diagnostics,
    ui,
  ]
related_specs:
  - docs/index.md
  - docs/specs/requirements.md
  - docs/specs/architecture.md
  - docs/specs/db-schema.md
  - docs/specs/screen-transitions.md
  - docs/specs/features/series-detail.md
  - docs/specs/features/reader.md
  - docs/specs/features/settings.md
  - docs/specs/providers/google-drive.md
  - docs/specs/providers/filename-parser.md
  - docs/guidelines/testing.md
related_tests:
  - scripts/android-build-config.test.ts
  - src/App.test.tsx
  - src/features/bookshelf/BookshelfPage.test.tsx
  - src/features/bookshelf/BookshelfHeader.test.tsx
  - src/features/bookshelf/BookshelfToolbar.test.tsx
  - src/features/bookshelf/DriveSetupBanner.test.tsx
  - src/features/bookshelf/DriveSyncEmptyState.test.tsx
  - src/features/bookshelf/LocalArchiveEmptyState.test.tsx
  - src/features/bookshelf/RecentLocalHistorySection.test.tsx
  - src/features/bookshelf/SeriesCard.test.tsx
  - src/features/bookshelf/SeriesGridSection.test.tsx
  - src/features/bookshelf/bookshelfUiStateStore.test.ts
  - src/features/bookshelf/bookshelfViewModel.test.ts
  - src/features/reader/localReaderSessionStore.test.ts
  - src/shared/sync/driveSyncStateStore.test.ts
  - src/shared/ui/CoverThumbnail.test.tsx
  - src/storage/repositories/readingProgressRepository.test.ts
  - src/storage/repositories/seriesRepository.test.ts
  - src/storage/repositories/volumesRepository.test.ts
  - src/diagnostics/diagnosticLogger.test.ts
  - test/vrt/vrt.spec.ts
  - test/it/smoke.spec.ts
  - test/it/local-reader.spec.ts
  - test/it/settings-oauth.spec.ts
  - test/it/drive-sync.spec.ts
  - test/it/bookshelf-drive-reader.spec.ts
---

# 仮想本棚ホーム画面仕様書（`SCR-01`: Bookshelf）

本ドキュメントは、ExLibris のホーム画面 **`SCR-01`（ルートパス `/`）** に関する機能仕様・UI コンポーネント構成・受け入れ条件（`AC-BS-xx`）の正本（Single Source of Truth）です。Phase 3〜`v0.1` の「ローカル ZIP オープン導線 ＋ 最近のローカル閲覧履歴 ＋ 診断ログコピー」および `v0.2 [1/4]`（`#23`）の設定導線・Google Drive 段階別連携バナーを土台に、`v0.2 [3/4]`（`#25`）で **100% ローカル IndexedDB 完結のシリーズカードグリッド・4軸基本ソート・「続きを読む」クイック起動（`TR-02b`）・手動 Drive 同期トリガー** を統合します。

> [!NOTE]
> `v0.2`（日常実用 MVP）では全有効シリーズのフラットグリッド＋4軸ソート構成とし、1,000 シリーズ規模でのアクセス性を高める UI（インクリメンタル複合検索、カスタム/スマートコレクション棚タブ、五十音インデックスジャンプ、作者／レーベル別グルーピング表示切替、Virtual Grid 等）は `v0.3` で詳細設計・実装します（[requirements.md §4](../requirements.md#4-全機能カタログとマイルストーン割当マトリクス)）。

---

## 1. 画面責務とレイアウト構成（`v0.1` 〜 `v0.2 [3/4]`）

1. **テーマ・シェル**:
   - ダークテーマ統一（背景 `bg-slate-950`、ヘッダー/カード `bg-slate-900`、境界 `border-slate-800`）。下部タブバーは配置しない。
2. **上部ヘッダー領域（`BookshelfHeader`）**:
   - 左側: アプリ名（`ExLibris`）＋ バージョンバッジ（`vX.Y.Z`：`package.json` 由来の `APP_VERSION`）。
   - 右側アクション群:
     - **「同期」ボタン**（`data-testid="header-sync-drive-button"`）：手動で `DriveSyncEngine.sync()`（初回または未同期ルート追加時は自動フルスキャン、2 回目以降は `changes.list` 増分差分同期）を起動する。`driveSetupState.kind === "ready" && syncPhase !== "syncing"` のとき活性とし、未連携・有効ルート 0 件・初期確認中・同期実行中は `disabled` とする（同期実行中はスピナーおよび `"同期中..."` ラベルを表示）。**アプリ起動時や画面遷移時の自動バックグラウンド同期は行わず、明示操作時のみ Drive API 通信を実行する（`NFR-03`）**。
     - **「ローカル ZIP を開く」ボタン**（`data-testid="header-open-local-zip-button"`）
     - **「診断ログをコピー」ボタン**（`data-testid="copy-diagnostics-button"`）＋ コピー結果ステータス表示（`data-testid="copy-diagnostics-status"`）
     - **「設定」ボタン**（`data-testid="header-settings-button"`、押下時に現在スクロール位置を保存して `/settings` へ `TR-03` 遷移）
   - **システムバー非重複・セーフエリア＆タッチ応答保護**:
     - Android Edge-to-Edge 環境で OS ステータスバー／ノッチと重なってタップ操作が阻害されないよう（`screen-transitions.md §1` の WebView マージン設定と併用）、`<header>` には `paddingTop: "calc(1rem + env(safe-area-inset-top, 0px))"` を設定してセーフエリア上余白を確保し（`env(..., 0px)` が `0px` の環境では上下 `1rem` を維持）、アクションボタンへ `touch-manipulation` を付与する。
3. **Google Drive 段階別セットアップバナー（`DriveSetupBanner` / `v0.2 [1/4]`〜）**:
   - `BookshelfPage` マウント時および `GoogleAuthBridge.subscribeSession` 変化時に、`GoogleAuthBridge.getSession()` と `DriveSyncRootsRepository.countEnabled()` を参照して以下の 3 状態を切り替える（初期非同期確認中 `"loading"` および完了済み `"ready"` では `null` を返して非表示とする）：
     - **① 未連携状態（`"unauthenticated"`）**: Google Drive ストリーミング連携の案内と **「設定を開いて連携する」ボタン**（`data-testid="drive-setup-banner-cta"`, `TR-03`）を表示する（過去に同期済みのローカル蔵書が IndexedDB に残っている場合も、オフライン蔵書閲覧を維持しつつ上部に本バナーを表示する）。
     - **② 連携済み・有効ルートフォルダ 0 件状態（`"no-roots"`）**: 連携中メールアドレスと「マンガ保管ルートフォルダが未設定です」の案内および **「フォルダを設定する」ボタン**（`data-testid="drive-setup-banner-cta"`, `TR-03`）を表示する。
     - **③ 準備完了状態（`"ready"`：連携済み かつ 有効ルートフォルダ 1 件以上）**: バナーを非表示（`null`）とする。
4. **仮想本棚データ解決・初回ローディング境界・メイン領域の 3 分岐レイアウト（`NFR-03` ローカル IndexedDB 完結）**:
   - マウント時および共有同期ストア（`driveSyncStateStore.completedSyncCount`）の更新時に、ネットワーク通信ゼロで `DriveSyncRootsRepository.listActive()`（`enabled === 1` の集合 `enabledRootIds`）→ `VolumesRepository.listVisibleByEnabledRoots(enabledRootIds)` → `SeriesRepository.listActive()` → `ReadingProgressRepository.listByVolumeIds(...)` を結合し、有効巻を 1 冊以上持つシリーズ一覧 `visibleSeries` を構築する。
   - **初回読込中ローディング境界（エンプティ画面チラつき防止）**: `initialSnapshot === undefined` での通常マウント直後、初回 IndexedDB 本棚読込または Drive 連携状態解決が未完了の間（`!isShelfDataSettled || driveSetupState.kind === "loading"`）は `DriveSyncEmptyState` や `LocalArchiveEmptyState` を先行表示せず、控えめなローディング表示（`data-testid="bookshelf-loading"`）を描画し、解決完了後に以下の 3 分岐へ遷移する（`initialSnapshot` 指定時や `initialDriveSetupState` のみ指定時のテスト・Storybook 決定論注入もサポートする）。
   - **全分岐共通の Web D&D フィードバック ＆ アラート表示**:
     - `<main data-drag-active={String(isDragActive)}>` 領域全体は常時 Web ドラッグ＆ドロップ対応ドロップゾーンとし、ファイルドラッグ中（`isDragActive === true`）は分岐 A / B / C いずれにおいても視覚的ハイライト枠（および分岐 B / C では各エンプティカードのドラッグ強調）を表示する。
     - 対応外拡張子（`.zip` / `.cbz` 以外）が選択またはドロップされた場合は遷移せず、`diagnosticLogger.warn("bookshelf", ...)` へ記録した上でインライン警告メッセージ（`role="alert"`, `data-testid="local-zip-error"`）を表示する（`LocalArchiveEmptyState` 非表示の分岐 A / B でも `<main>` 上部に同 `data-testid="local-zip-error"` アラートを表示する）。
     - 手動同期が失敗して `driveSyncStateStore.errorMessage !== null` となった場合の同期エラーアラート（`role="alert"`, `data-testid="bookshelf-sync-error"`）も、分岐 A では `BookshelfToolbar` 内、分岐 B・分岐 C（同期中の `401 UNAUTHORIZED` 等で `driveSetupState.kind` が `"ready"` → `"unauthenticated"` へ遷移した場合を含む）では `<main>` 上部またはカード内に継続表示し、認証失効に伴う画面分岐変化でエラー通知が消失しないようにする。
   - **分岐 A：有効な Drive シリーズが 1 件以上存在する場合（`isShelfDataSettled && visibleSeries.length > 0`）**:
     - `LocalArchiveEmptyState`（大きな初期空本棚カード）は非表示（折りたたみ）とし、**`BookshelfToolbar` ＋ `SeriesGridSection`** をメイン表示する（下部に `local:*` 履歴が 1 件以上あれば `RecentLocalHistorySection` を並置する）。
   - **分岐 B：有効な Drive シリーズが 0 件 かつ Drive 準備完了状態（`isShelfDataSettled && visibleSeries.length === 0 && driveSetupState.kind === "ready"`）**:
     - **`DriveSyncEmptyState`**（`data-testid="drive-sync-empty-state"`）を表示する：「マンガ保管フォルダが設定されています。同期を実行して本棚を作成してください」の案内、プライマリ **「今すぐ同期」ボタン**（`data-testid="empty-state-sync-drive-button"`、同期中はスピナー＆`disabled`）、およびサブ導線の **「ローカル ZIP を開く（.zip / .cbz）」ボタン**（`data-testid="open-local-zip-button"`）を配置する（下部に `local:*` 履歴が 1 件以上あれば `RecentLocalHistorySection` を表示する）。
   - **分岐 C：有効な Drive シリーズが 0 件 かつ 未連携／ルート未設定（`isShelfDataSettled && visibleSeries.length === 0 && driveSetupState.kind !== "ready" && driveSetupState.kind !== "loading"`）**:
     - 従来通り `LocalArchiveEmptyState`（`data-testid="bookshelf-empty"`、目立つ **「ローカル ZIP を開く（.zip / .cbz）」ボタン** `data-testid="open-local-zip-button"` 付き）＋ `RecentLocalHistorySection`（1 件以上時）を表示する。
5. **本棚ツールバー・4軸基本ソート・シリーズカードグリッド（`BookshelfToolbar` / `SeriesGridSection` / `SeriesCard`）**:
   - **`BookshelfToolbar`（`data-testid="bookshelf-toolbar"`）**:
     - 蔵書件数表示（`data-testid="bookshelf-series-count"`：全 `${visibleSeries.length} 作品 / ${totalVisibleVolumes} 冊`）
     - 最終同期日時表示（`data-testid="bookshelf-last-synced"`：`driveSyncStateStore.lastSyncedAt` が存在する場合は `Asia/Tokyo` 固定タイムゾーン `YYYY/MM/DD HH:mm` 形式で表示、未実行時は `"未同期"`、同期完了直後は結果件数サマリを併記、同期失敗時は `role="alert"` `data-testid="bookshelf-sync-error"` を表示）
     - **基本ソート切替セレクト**（`<select data-testid="bookshelf-sort-select" aria-label="並び順">`）：選択状態は `bookshelfUiStateStore.sortOrder`（オンメモリ）で保持し、以下の 4 軸を決定論的タイブレーク付きで提供する：
       1. **`"lastReadDesc"`（最終読書順：初期値）**: `series.lastReadAt` が非 `null` のシリーズを先に `lastReadAt` 降順で並べ、未読シリーズ（`lastReadAt === null`）は後ろに回して最新追加日時（所属有効巻の最大 `addedAt`、同値時 `series.addedAt`）降順 → `titleReading` 昇順 → `title` 昇順 → `id` 昇順で並べる。
       2. **`"addedDesc"`（追加順）**: 所属有効巻の最大 `addedAt`（同値時 `series.addedAt`）降順 → `titleReading` 昇順 → `title` 昇順 → `id` 昇順。
       3. **`"titleAsc"`（タイトル順）**: `series.titleReading` 昇順 → `series.title` 昇順 → `id` 昇順。
       4. **`"volumeCountDesc"`（巻数順）**: 所属有効巻数（`visibleVolumes.length`）降順 → `titleReading` 昇順 → `title` 昇順 → `id` 昇順。
   - **`SeriesCard`（`data-testid="series-card"`, `data-series-id={item.seriesId}`）**:
     - **代表表紙サムネイル（`CoverThumbnail`）**: `series.representativeVolumeId` が所属有効巻内に存在する場合はその巻、なければ所属有効巻の先頭巻（`visibleVolumes[0]`）を採用する。`coverStatus === "ready" && coverBlob !== null` の場合は `URL.createObjectURL(coverBlob)` 画像を表示し（アンマウント・Blob 変化時に `URL.revokeObjectURL` 必須）、それ以外はタイトル・巻数バッジ付きのプレースホルダを表示する。
     - **カード情報**: 作品タイトル、著者名（存在時 1 行省略）、所持巻数バッジ（`全 ${volumeCount} 巻`）、およびシリーズ読書ステータスバッジ（`data-testid="series-read-status"`：全有効巻未読＝`未読`、全有効巻読了＝`読了`、それ以外＝`読書中 (${completedCount}/${volumeCount})`）。
     - **カード本体タップ（`data-testid="series-card-open-detail"` → `TR-01`）**: 所持巻数が 1 冊か複数冊かを問わず、現在の `window.scrollY` を `bookshelfUiStateStore` に保存し、`clearSeriesDetailScroll()` で過去の未消費詳細スクロール状態をクリアした上で `/series/:seriesId`（`SCR-02`）へ遷移する。
     - **カード上のクイック起動ボタン（`data-testid="series-card-quick-read"` → `TR-02b`）**: クリックバブリングを抑止（`stopPropagation`）し、全シリーズカードに配置する。対象巻は以下の決定論的優先順位（`resolveQuickLaunchVolume`）で選び、`window.scrollY` を保存した上で起点 `readerOrigin: "bookshelf"` として `/read/volume/:volumeId`（`SCR-03`）を直接開く：
       1. 所属有効巻のうち `readStatus === "reading"` が 1 冊以上ある場合：`lastReadAt` が最大の巻（同値時は巻順先頭）、ラベル **`「続きを読む (${volumeLabel})」`**。
       2. `"reading"` が無く未読了（`"unread"` または進捗未保存）の巻がある場合：巻順先頭の未読了巻、ラベルは既読了巻 0 冊なら **`「読む (${volumeLabel})」`**、1 冊以上なら **`「次を読む (${volumeLabel})」`**。
       3. 全有効巻が `"completed"` の場合：巻順先頭巻（`visibleVolumes[0]`）、ラベル **`「最初から読む」`**。
6. **最近のローカル閲覧履歴セクション（`data-testid="recent-local-history-section"` / `v0.1`〜）**:
   - `BookshelfPage` マウント時に `ReadingProgressRepository.listRecentLocal(10)` を取得し、**有効な `local:*` 履歴が 1 件以上存在する場合のみ** メイン領域の下部に最新 10 件（`lastReadAt` 降順）を表示する（**0 件時はセクション自体を非表示** とする）。
   - ヘッダーに見出し「最近のローカル閲覧履歴」、案内文「同じ `.zip` / `.cbz` ファイルを再選択すると、前回のページから自動レジュームします」、および `local:*` レコードのみを一括消去する **「履歴をクリア」ボタン**（`data-testid="clear-local-history-button"`）を配置する。
   - 各履歴行（`data-testid="recent-local-history-item"`）には以下を配置する：
     - **再選択オープンボタン**（`data-testid="reopen-local-history-button"`）: タップすると隠し `<input type="file">` ピッカーを起動する。`rawFileName`（1行省略表示）、人間可読サイズ（`B` / `KB` / `MB` / `GB`）、ステータスバッジ（`readStatus === "completed"` は `読了`、`"reading"` は `読書中`、`"unread"` は `未読`）、ページ進捗（`${currentPageIndex + 1} / ${totalPageCount} ページ`）、および進捗バー（`"completed"` 時は `100%`、それ以外は `Math.round(((currentPageIndex + 1) / totalPageCount) * 100)%`）を表示する。
     - **個別削除ボタン**（`data-testid="delete-local-history-button"`）: ファイル選択ピッカーを起動せず、該当 `targetKey` のみを `ReadingProgressRepository.delete(targetKey)` で削除して一覧から即座に除去する。
   - IndexedDB の取得・削除・クリアで例外が発生した場合は `diagnosticLogger.warn("bookshelf", ...)` へ記録し、UI をクラッシュさせない。

---

## 2. ローカル ZIP 選択・Android SAF 互換・遷移＆状態復元契約（`TR-01`〜`TR-03` / `TR-05` / `TR-08` / `TR-09`）

1. **Android WebView（SAF）互換の `<input type="file">`**:
   - Android のファイルピッカー（SAF）では MIME タイプとして `.cbz`（`application/x-cbz` や `application/vnd.comicbook+zip`）が認識されずグレーアウトする端末が存在する。
   - これを防ぐため、隠し `<input type="file" data-testid="local-zip-file-input" />` の `accept` 属性は `.zip,.cbz,application/zip,application/x-zip-compressed,application/x-cbz,application/octet-stream`（または SAF 環境で `.cbz` が選択不能にならない安全な指定）とし、**最終的な拡張子検証は JS 側で `file.name.toLowerCase().endsWith(".zip") || file.name.toLowerCase().endsWith(".cbz")` により厳格判定** する。
   - 連続で同一ファイルを再選択できるよう、選択処理後に `input.value = ""` をリセットする。
2. **ローカル一時 ZIP セッション保持と即時遷移（`TR-02a`）**:
   - 有効な `.zip` / `.cbz` `File` が選択されたら、オンメモリセッションストア（`useLocalReaderSessionStore`）へ `{ file, fileName: file.name, fileSize: file.size }` を格納し、直ちに `/read/local` へ遷移（`router.navigate("/read/local")`）する。
   - 遷移先の `ReaderPage` にて `local:${file.name}:${file.size}` をキーに `zipIndexCache`（0 RTT 目次復元）および `readingProgress`（保存済み `currentPageIndex` と `spreadPageOffset` の自動レジューム）を参照・更新する。
3. **サブ画面・リーダー遷移とソート順・スクロール位置復元（`TR-01` / `TR-02b` / `TR-03` ↔ `TR-05` / `TR-08` / `TR-09`）**:
   - `SCR-01` からシリーズ詳細（`TR-01`：あわせて `clearSeriesDetailScroll()` を実行）、クイック起動リーダー（`TR-02b`）、または設定画面（`TR-03`）へ遷移する際、オンメモリ UI 状態ストア（`bookshelfUiStateStore`）に現在の `window.scrollY` を保存する（選択中の `sortOrder` も同ストアで継続保持される）。
   - `SCR-02`（`TR-05`）・`SCR-03`（`TR-08`）・`SCR-04`（`TR-09`）から `/` へ復帰した際、`BookshelfPage` は **Drive 連携状態確認（`isDriveSetupSettled`）・ローカル履歴取得（`isRecentHistorySettled`）・仮想本棚データ取得（`isShelfDataSettled`）の 3 つすべてが完了した時点** で `window.scrollTo(0, savedScrollY)` を実行し、`clearScrollY()` で消費クリアする（グリッド描画完了前の高さ不足によるスクロール位置ロストを防止する）。

---

## 3. コンポーネント構成と親子分離（1対1 Story / UT 対象）

| モジュール / コンポーネント | ファイルパス                                           | 責務（テスト分離方針）                                                                                                     |
| :-------------------------- | :----------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------- |
| `bookshelfViewModel`        | `src/features/bookshelf/bookshelfViewModel.ts`         | シリーズカード集約、代表表紙解決、`resolveQuickLaunchVolume`、4軸決定論ソート、同期日時/バイトサイズ整形純関数群           |
| `bookshelfUiStateStore`     | `src/features/bookshelf/bookshelfUiStateStore.ts`      | `SCR-01` `scrollY`・`sortOrder` および `SCR-02` `seriesDetailScroll` を保持するオンメモリ Zustand ストア                   |
| `driveSyncStateStore`       | `src/shared/sync/driveSyncStateStore.ts`               | `SCR-01` / `SCR-04` 横断の Drive 手動同期状態（実行中・最終同期日時・結果・エラー・完了カウンタ）を管理する Zustand ストア |
| `CoverThumbnail`            | `src/shared/ui/CoverThumbnail.tsx`                     | `coverBlob` の `URL.createObjectURL` / `URL.revokeObjectURL` 厳格管理と未抽出時プレースホルダ描画                          |
| `BookshelfPage`             | `src/features/bookshelf/BookshelfPage.tsx`             | ローカル ZIP 検証、`TR-01`〜`TR-03` スクロール保持、Drive 連携・同期状態・IndexedDB 本棚＆履歴取得統合                     |
| `BookshelfHeader`           | `src/features/bookshelf/BookshelfHeader.tsx`           | タイトル、バージョン、手動「同期」ボタン、「ローカル ZIP を開く」、診断ログコピー、「設定」ボタン（Pure Presentational）   |
| `DriveSetupBanner`          | `src/features/bookshelf/DriveSetupBanner.tsx`          | Google 未連携／有効ルートフォルダ 0 件時の段階別ガイドバナー（準備完了・初期確認中は `null`、Pure Presentational）         |
| `BookshelfToolbar`          | `src/features/bookshelf/BookshelfToolbar.tsx`          | 作品・冊数サマリ、最終同期日時・同期エラー表示、4軸ソート切替セレクト（Pure Presentational）                               |
| `SeriesGridSection`         | `src/features/bookshelf/SeriesGridSection.tsx`         | レスポンシブシリーズカードグリッド描画（Pure Presentational）                                                              |
| `SeriesCard`                | `src/features/bookshelf/SeriesCard.tsx`                | 代表表紙、作品名・著者・巻数・進捗バッジ、詳細遷移（`TR-01`）＆クイック起動ボタン（`TR-02b`）（Pure Presentational）       |
| `DriveSyncEmptyState`       | `src/features/bookshelf/DriveSyncEmptyState.tsx`       | Drive 準備完了かつ有効蔵書 0 件時の「今すぐ同期」CTA カード＋ローカル ZIP サブ導線（Pure Presentational）                  |
| `LocalArchiveEmptyState`    | `src/features/bookshelf/LocalArchiveEmptyState.tsx`    | 未連携/未設定時の空本棚カード、目立つ「ローカル ZIP を開く」CTA、D&D ガイド、不正拡張子エラー表示                          |
| `RecentLocalHistorySection` | `src/features/bookshelf/RecentLocalHistorySection.tsx` | 直近ローカル閲覧履歴（最大10件、0件時 `null`、進捗バー、再選択導線、個別削除・一括クリア）                                 |

- **親子分離 UT**: 親 `BookshelfPage` の単体テストでは直下の子コンポーネント（`BookshelfHeader`, `DriveSetupBanner`, `BookshelfToolbar`, `SeriesGridSection`, `DriveSyncEmptyState`, `LocalArchiveEmptyState`, `RecentLocalHistorySection`）をすべて `vi.spyOn(...).mockImplementation(() => null)` で完全分離する。`SeriesGridSection` の単体テストでは `SeriesCard` を、`SeriesCard` の単体テストでは `CoverThumbnail` をそれぞれ `vi.spyOn` で分離する。
- **Storybook / VRT 決定論性保証**: `BookshelfPage.stories.tsx`（および `AppProps.initialBookshelfSnapshot` 経由の `App.stories.tsx` ホーム表示ストーリー）では、非同期 IndexedDB / Auth 解決や実時刻による VRT フレークを防ぐため、`initialDriveSetupState`・`initialRecentHistory` に加えてオプショナルな `initialSnapshot?: BookshelfPageInitialSnapshot`（固定 `lastSyncedAt`・シリーズ配列・ソート順・同期状態を同期注入し初期非同期フェッチをスキップする Prop）を設け、1280px / 375px VRT を 100% 決定論的に描画する。

---

## 4. 受け入れ条件（`AC-BS-xx`）

|   AC ID    | 受け入れ条件                                                                                                                                                                                                                                       |
| :--------: | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AC-BS-01` | `SCR-01`（`/`）のヘッダー（および蔵書 0 件時のメインカード）から「ローカル ZIP を開く」操作で `.zip` / `.cbz` ファイルを選択できる。                                                                                                               |
| `AC-BS-02` | Web ブラウザ上で `.zip` / `.cbz` ファイルをドロップゾーンへドラッグ＆ドロップして開くことができる（Drive 蔵書表示中も有効）。                                                                                                                      |
| `AC-BS-03` | `.zip` / `.cbz` 以外のファイルが選択・ドロップされた場合は遷移せず、画面状態にかかわらずインラインエラー（`role="alert"`, `data-testid="local-zip-error"`）を表示する。                                                                            |
| `AC-BS-04` | 有効な `.zip` / `.cbz` ファイル選択時にオンメモリセッションが更新され、`/read/local`（`SCR-03`）へ遷移する（`TR-02a`）。                                                                                                                           |
| `AC-BS-05` | 診断ログコピー機能（`data-testid="copy-diagnostics-button"`）および VRT（1280px / 375px）が引き続き 100% 正常動作する。                                                                                                                            |
| `AC-BS-06` | `local:*` の閲覧履歴が 1 件以上ある場合のみ最新 10 件（`lastReadAt` 降順）の進捗・ステータス一覧を表示し、行選択でのピッカー起動・個別履歴削除・一括クリアが動作する（0件時は非表示）。                                                            |
| `AC-BS-07` | ヘッダー「設定」ボタンおよび段階別ガイドバナー（① Google 未連携、② 連携済み・有効ルートフォルダ 0 件、両方充足時は非表示）から `/settings` へ遷移（`TR-03`）でき、復帰時（`TR-09`）に `SCR-01` のスクロール位置が復元される。                      |
| `AC-BS-08` | アプリ起動時・画面遷移時は自動通信を行わず（`NFR-03`）、Google 連携済み かつ 有効ルート 1 件以上のときヘッダー「同期」ボタン（蔵書 0 件時は `DriveSyncEmptyState` の「今すぐ同期」CTA も含む）から手動同期を実行・状態共有できる。                 |
| `AC-BS-09` | 有効な同期ルート所属かつ `isTrashed === 0` の巻を 1 冊以上持つシリーズのみがローカル IndexedDB から高速表示され、大きな初期空本棚カードは自動的に折りたたまれる（ルート一時無効化時は該当巻・空シリーズが即座に表示対象から除外される）。          |
| `AC-BS-10` | 「最終読書順（初期値・未読は後ろで追加順）」「追加順」「タイトル順」「巻数順」の 4 軸でシリーズ一覧を即時ソートでき、`SCR-02` / `SCR-03` / `SCR-04` との往復遷移（`TR-05` / `TR-08` / `TR-09`）後もソート順とスクロール位置が復元される。          |
| `AC-BS-11` | 各シリーズカードの本体選択で `/series/:seriesId` へ遷移（`TR-01`）でき、カード上のクイック起動ボタン（`TR-02b`）で「①最新読書中巻 → ②最小未読巻 → ③全巻読了時は先頭巻」を決定論的に `/read/volume/:volumeId` で直接起動できる。                    |
| `AC-BS-12` | 代表表紙（`representativeVolumeId` 優先、なければ先頭巻）について、`coverBlob` 準備完了時は `ObjectURL` 画像（厳格 `revokeObjectURL` 付き）、未抽出時はプレースホルダを表示し、全追加 TSX/TS が 1対1 Story/UT・100% カバレッジ・VRT を PASS する。 |
