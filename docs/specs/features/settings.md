---
type: spec-feature
title: "ストレージ連携・設定画面仕様書（SCR-04: Settings）"
description: "SCR-04（/settings）のGoogleアカウント連携、マンガ保管ルートフォルダ管理、手動Drive差分同期・強制フルスキャン実行UI、表紙WebP抽出キュー進捗・エラー再試行UI、診断ログ閲覧/コピー/クリア、およびTR-03/TR-09・戻る優先度1/2/4仕様の正本"
status: "Review (#26)"
updated: "2026-11-27"
tags:
  [
    feature,
    settings,
    scr-04,
    oauth,
    google-drive,
    sync-roots,
    drive-sync,
    cover,
    webp,
    diagnostics,
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
  - docs/specs/providers/google-drive.md
  - docs/specs/features/bookshelf.md
  - docs/specs/features/series-detail.md
  - docs/specs/features/reader.md
  - docs/guidelines/testing.md
related_tests:
  - src/App.test.tsx
  - src/app/ServiceProvider.test.tsx
  - src/diagnostics/diagnosticLogger.test.ts
  - src/features/settings/DiagnosticsSection.test.tsx
  - src/features/settings/DriveFolderPickerModal.test.tsx
  - src/features/settings/DriveSyncExecutionSection.test.tsx
  - src/features/settings/DriveSyncRootsSection.test.tsx
  - src/features/settings/GoogleAccountSection.test.tsx
  - src/features/settings/SettingsHeader.test.tsx
  - src/features/settings/SettingsPage.test.tsx
  - src/providers/gdrive/driveSyncEngine.test.ts
  - src/shared/router/RouterProvider.test.tsx
  - src/shared/router/routeMatcher.test.ts
  - src/shared/sync/driveSyncStateStore.test.ts
  - test/vrt/vrt.spec.ts
  - test/it/settings-oauth.spec.ts
  - test/it/drive-sync.spec.ts
  - test/it/bookshelf-drive-reader.spec.ts
---

# ストレージ連携・設定画面仕様書（`SCR-04`: Settings）

本ドキュメントは、ExLibris のストレージ連携・設定画面 **`SCR-04`（ルートパス `/settings`）** に関する機能仕様・UI コンポーネント構成・遷移および戻る制御・受け入れ条件（`AC-ST-xx`）の正本（Single Source of Truth）です。

> [!NOTE]
> `Issue #23`（`[v0.2][1/4]`）の「Google アカウント連携・マンガ保管ルートフォルダ管理・オンメモリ診断ログ確認＆コピー」および `Issue #25`（`[v0.2][3/4]`）の「手動差分同期／強制フルスキャン実行セクション（`DriveSyncExecutionSection`）」の上に、`Issue #26`（`[v0.2][4/4]`）で **「表紙 WebP 抽出キュー進捗・エラー再試行セクション（`CoverExtractionSection`）」** を統合します。

---

## 1. 画面責務とレイアウト構成（`v0.2 [1/4]` 〜 `v0.2 [4/4]`）

1. **テーマ・シェル・セーフエリア保護**:
   - スレート系ダークテーマ統一（背景 `bg-slate-950`、セクションカード `bg-slate-900`、境界 `border-slate-800`）。
   - `<header>` には `paddingTop: "calc(1rem + env(safe-area-inset-top, 0px))"`、ページ下部には `paddingBottom: "calc(2rem + env(safe-area-inset-bottom, 0px))"` を設定し、Android Edge-to-Edge 環境でのシステムバー重複を防止する。
2. **上部ヘッダー領域（`SettingsHeader`）**:
   - 左側: **「本棚へ戻る」ボタン**（`data-testid="settings-back-button"`, `TR-09`、優先度 1 ブロック条件 `isBackBlocked === true`［OAuth `signIn`/`signOut` 実行中 または フォルダ登録確定保存中］の間は `disabled`）＋ 画面タイトル「ストレージ連携・設定」。
   - 右側: アプリバージョンバッジ（`v${APP_VERSION}`）。
3. **セクション①：Google アカウント連携（`GoogleAccountSection`）**:
   - **未連携状態**: 接続ステータスバッジ「未連携」、説明文（`drive.readonly` 読み取り専用スコープで ZIP を直接ストリーミングする旨）、および **「Google でログイン」ボタン**（`data-testid="google-signin-button"`）を表示する。
   - **処理中状態（`signing-in` / `signing-out`）**: スピナー・処理中ラベルを表示し、ログイン／ログアウトボタンおよび画面戻る操作を非活性化する（優先度 1 ブロック）。
   - **連携済み状態**: 接続ステータスバッジ「連携済み」、連携中のメールアドレス（`data-testid="google-account-email"`）、および **「連携を解除（ログアウト）」ボタン**（`data-testid="google-signout-button"`、Drive 同期実行中 `isSyncing === true` の間は認証競合防止のため `disabled`）を表示する。
   - **エラー表示**: OAuth 失敗・ネットワーク障害時はインラインエラーアラート（`role="alert"`, `data-testid="google-auth-error"`）を表示する（ユーザーが同意画面をキャンセルした `AUTH_CANCELLED` の場合は破壊的エラーではなく未連携状態を維持し控えめな案内またはアラートクリアとする）。
4. **セクション②：マンガ保管ルートフォルダ管理（`DriveSyncRootsSection`）**:
   - 登録済みの有効なルートフォルダ一覧（`DriveSyncRootsRepository.listActive()`、`deletedAt === null`）を表示し、Google Drive 連携状態および同期実行状態に応じて導線を制御する：
     - **未連携時**: フォルダ追加操作（URL/ID 入力欄・追加ボタン・ピッカー起動ボタン）を `disabled` とし、「フォルダを追加するには先に Google アカウントと連携してください」の案内を表示する。**既存の登録済みフォルダ一覧自体は消去せず表示・保持** し、削除や有効/無効切替はローカル設定として操作可能とする。
     - **同期実行中（`isSyncing === true`）**: 走査途中のルート集合変更による競合を防ぐため、フォルダ追加・ピッカー起動・各ルート行の有効/無効切替および登録解除ボタンを一時的に `disabled` とする。
     - **連携済み かつ 非同期実行中**:
       1. **アプリ内フォルダ選択モーダル起動ボタン**（`data-testid="open-folder-picker-button"`：「Drive からフォルダを選択」）。
       2. **フォルダ URL / ID 直接登録フォーム**: テキスト入力（`data-testid="folder-input"`）＋ **「URL / ID で追加」ボタン**（`data-testid="add-folder-by-input-button"`）。`parseDriveFolderInput` で ID を抽出し（予約エイリアス `"root"` や不正 URL/ID はこの段階で拒否）、`DriveFolderClient.resolveFolderById` で実在かつフォルダ（非ゴミ箱）であることを検証して `DriveSyncRootsRepository.upsertRoot` へ保存する（検証・保存失敗時は `role="alert"` `data-testid="sync-roots-error"` を表示）。
   - **登録済みフォルダ行（`data-testid="sync-root-item"`）と表紙キュー再同期**:
     - `folderName`・`folderId`・同期対象トグルボタン（`data-testid="toggle-sync-root-button"`, `aria-pressed={root.enabled === 1}`：有効 `1` ↔ 一時無効 `0`）・登録解除ボタン（`data-testid="remove-sync-root-button"`：`DriveSyncRootsRepository.removeRoot` による `deletedAt` Tombstone 論理削除）を表示する。
     - フォルダの追加・有効/無効トグル・登録解除が成功した際は、即座に `void coverExtractionScheduler.syncQueue()` を呼び出し、無効化・解除されたルートの巻を表紙抽出キューおよび集計対象から即時除外（再有効化時は再投入）する。
     - 非同期 DB 更新失敗時は直前の表示状態へロールバックし `role="alert"` で通知する（[testing.md §3.4](../../guidelines/testing.md#3-単体テストvrt結合テストitの衛生非同期規律継承-kaizen)）。
5. **セクション③：Google Drive 蔵書同期（`DriveSyncExecutionSection` / `v0.2 [3/4]`〜）**:
   - `driveSyncStateStore`（`SCR-01` と状態共有）および `DriveSyncMetaRepository.getSyncState()`（初回 `lastDriveSyncAt` 水和）を参照し、手動同期トリガーと実行ステータスを表示する：
     - **同期ステータス＆最終同期日時**:
       - ステータスバッジ（`data-testid="settings-sync-status-badge"`：`idle` 時は `待機中`、`syncing` 時はスピナー付き `同期中`、`completed` 時は `同期完了`、`error` 時は `同期エラー`）。
       - 最終同期日時（`data-testid="settings-last-synced-at"`：`lastSyncedAt !== null` 時は `Asia/Tokyo` タイムゾーン固定 `YYYY/MM/DD HH:mm` 形式、`null` 時は `"未実行"`）。
       - 直近結果サマリ（`data-testid="settings-sync-result-summary"`：`lastResult !== null && lastResult.mode !== "skipped-no-roots"` のとき、実行モード［`差分同期` / `フルスキャン`］・走査ルート数・追加/更新巻数・除外巻数を表示）。
       - エラーアラート（`role="alert"`, `data-testid="drive-sync-error"`：`errorMessage !== null` 時に表示）。
     - **手動同期アクションボタン**:
       - **「今すぐ同期（差分）」ボタン**（`data-testid="settings-sync-incremental-button"`）：`DriveSyncEngine.sync({ forceFullScan: false })` を実行する（初回トークン未保持時や新規ルート追加時はエンジン側で自動フルスキャン、2 回目以降は `changes.list` 増分同期）。
       - **「強制フルスキャン」ボタン**（`data-testid="settings-sync-full-button"`）：トラブルシュート用に `DriveSyncEngine.sync({ forceFullScan: true })` を実行し、有効ルート配下の全フォルダ木を再走査する。
       - **活性条件**: 両ボタンとも **`authStatus === "connected" && enabledRootCount > 0 && syncPhase !== "syncing" && !isBackBlocked`**（`SettingsPageInitialSnapshot` 上は `authState.status === "connected"`）のときのみ活性とし、未連携時・有効ルート 0 件時・同期実行中・OAuth/ルート保存中は `disabled`（未連携または有効ルート 0 件時は理由の補足案内を表示）とする。
6. **セクション④：表紙サムネイル自動抽出（`CoverExtractionSection` / `v0.2 [4/4]`〜）**:
   - `coverExtractionStateStore`（`CoverExtractionScheduler` と同期共有）を参照し、有効ルート配下の蔵書に対する表紙 WebP 自動抽出の進行状況とエラー再試行導線を表示する：
     - **状態バッジ**（`data-testid="settings-cover-status-badge"`）：`totalCount === 0` 時は `対象なし`、`phase === "running"` 時は `抽出中`、`phase === "backoff"` 時は `バックオフ待機`、`phase === "paused"`（`pendingCount > 0`）時は `一時停止中`、`pendingCount === 0 && errorCount > 0` 時は `要再試行`、`pendingCount === 0 && errorCount === 0 && totalCount > 0` 時は `完了`。
     - **進捗バー＆内訳サマリ**:
       - 進捗率 `totalCount > 0 ? Math.round((readyCount / totalCount) * 100) : 0`（`%`）に基づくプログレスバー（`data-testid="settings-cover-progress-bar"`）を表示する。
       - 内訳件数（`data-testid="settings-cover-counts"`：`抽出済み ${readyCount} / ${totalCount} 冊`・`待機 ${pendingCount} 冊`・`エラー ${errorCount} 冊`）を表示する。
     - **エラー再試行アクション**:
       - **「エラー分を再試行」ボタン**（`data-testid="settings-retry-failed-covers-button"`）：`coverExtractionScheduler.retryFailedCovers()` を実行し、有効ルート配下の `coverStatus === "error"` の巻を `"pending"` に戻して再キュー投入する。
       - **活性条件**: **`authStatus === "connected" && enabledRootCount > 0 && syncPhase !== "syncing" && !isBackBlocked && errorCount > 0`** のときのみ活性とし、それ以外は `disabled` とする。
7. **モーダル：アプリ内 Drive フォルダ階層選択（`DriveFolderPickerModal`）**:
   - `isOpen === false` 時は `null` を返す（Storybook の閉鎖状態ストーリーのみ `tags: ["skip-vrt"]` を許可）。
   - `isOpen === true` 時は背面メインコンテンツを `inert` 化し、`role="dialog"`, `aria-modal="true"`, `aria-label="Google Drive フォルダを選択"` でモーダルを表示する。
   - パンくずリスト（起点: `"マイドライブ"` `id: "root"` → 選択したサブフォルダ階層へドリルダウン・上位階層への戻り移動）、現在表示中フォルダ配下のサブフォルダ一覧（`DriveFolderClient.listChildFolders`）、`nextPageToken` 存在時の **「さらに読み込む」ボタン**（`data-testid="folder-picker-load-more"`）、および以下の確定アクションを備える：
     - 各サブフォルダ行の「開く」（下位階層へ移動）および「選択して追加」（`data-testid="select-subfolder-button"`）
     - 現在開いている階層自体（`"root"` マイドライブ直下選択は全ドライブ混入防止のため不可とし、1階層目以降のフォルダで活性）を登録する **「このフォルダを追加」ボタン**（`data-testid="confirm-current-folder-button"`）
     - 「キャンセル / 閉じる」ボタン（`data-testid="close-folder-picker-button"`、確定保存中 `isSavingSyncRoot === true` の間は `disabled`）
8. **セクション⑤：アプリ内診断ログ確認・コピー（`DiagnosticsSection`）**:
   - 注入された `logger`（デフォルトはシングルトン `diagnosticLogger`）の保持件数バッジと、最新エントリが確認しやすい順序で並んだオンメモリログビューア（`data-testid="diagnostics-log-list"`、0 件時は空状態メッセージ `data-testid="diagnostics-empty"`）を表示する。
   - **「診断ログをコピー」ボタン**（`data-testid="settings-copy-diagnostics-button"`、`logger.formatReport()` をクリップボードへ出力し結果ステータス `data-testid="settings-copy-diagnostics-status"` を表示）および **「ログをクリア」ボタン**（`data-testid="settings-clear-diagnostics-button"`、`logger.clear()` を実行して表示を即時更新）を備える。

---

## 2. 画面遷移（`TR-03` / `TR-09`）と戻るボタン優先度制御

1. **`TR-03`（`SCR-01` → `SCR-04`）と `TR-09`（`SCR-04` → `SCR-01`）**:
   - `SCR-01` のヘッダー「設定」ボタンまたは未連携／フォルダ未設定ガイドバナーの CTA から `/settings` へ遷移する際、現在の `window.scrollY` を `bookshelfUiStateStore` に保存する（`TR-03`）。
   - `SCR-04` から戻る際（ヘッダー「本棚へ戻る」、ブラウザ `popstate`、Android ハードウェア戻る優先度 4）は `/` へ遷移し、`SCR-01` マウント時に保存されていたソート順・スクロール位置を復元する（`TR-09`）。
2. **Android ハードウェア戻るボタン ＆ `Escape` キー優先度（[screen-transitions.md §4](../screen-transitions.md#4-android-ハードウェア戻るボタンback-button優先制御契約) 準拠）**:
   - **優先度 1（非同期クリティカル処理中のブロック：`isBackBlocked = isAuthBusy || isSavingSyncRoot`）**: OAuth `signIn` / `signOut` 実行中、またはフォルダ登録確定保存中（URL/ID 追加処理中・モーダル確定処理中の双方）は、ヘッダー戻るボタン `disabled`・モーダル閉鎖抑止・ブラウザ `popstate` 抑止・Android `backButton` 無視を一貫適用して状態不整合を防ぐ。なお **Drive 同期実行中（`isSyncing === true`）およびバックグラウンド表紙抽出実行中は画面間共有ストア／スケジューラにより安全に継続されるため、`isBackBlocked` には含めず `TR-09` での本棚復帰を許可する**。
   - **優先度 2（モーダル閉鎖）**: `DriveFolderPickerModal` が開いており `!isBackBlocked` の状態では、Android `backButton`・キーボード `Escape`・バックドロップクリックのすべてで `/settings` からの離脱を行わずモーダルのみを閉じる。
   - **優先度 4（`SCR-01` への復帰）**: モーダルが閉じており `!isBackBlocked` の場合は `TR-09` で `/` へ戻る。

---

## 3. コンポーネント構成・親子分離・Storybook VRT 決定論性契約

| コンポーネント              | ファイルパス                                          | 責務（テスト分離方針）                                                                                                                |
| :-------------------------- | :---------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------ |
| `SettingsPage`              | `src/features/settings/SettingsPage.tsx`              | `GoogleAuthBridge`・`DriveSyncRootsRepository`・`DriveFolderClient`・`driveSyncStateStore`・`coverExtractionScheduler`・`logger` 統合 |
| `SettingsHeader`            | `src/features/settings/SettingsHeader.tsx`            | セーフエリア対応上部ヘッダー、戻るボタン（`isBackBlocked` 連動 `disabled`）、タイトル、バージョン表示（Pure Presentational）          |
| `GoogleAccountSection`      | `src/features/settings/GoogleAccountSection.tsx`      | 未連携／処理中／連携済み（メール表示）UI、ログイン・ログアウト CTA、エラーアラート（Pure Presentational）                             |
| `DriveSyncRootsSection`     | `src/features/settings/DriveSyncRootsSection.tsx`     | ルートフォルダ一覧、有効/無効切替、削除、URL/ID 追加フォーム、ピッカー起動導線（Pure Presentational）                                 |
| `DriveSyncExecutionSection` | `src/features/settings/DriveSyncExecutionSection.tsx` | 手動「今すぐ同期（差分）」「強制フルスキャン」ボタン、最終同期日時、同期結果サマリ、エラーアラート（Pure Presentational）             |
| `CoverExtractionSection`    | `src/features/settings/CoverExtractionSection.tsx`    | 表紙 WebP 抽出キュー状態バッジ、進捗バー、抽出済み／待機／エラー冊数、「エラー分を再試行」ボタン（Pure Presentational）               |
| `DriveFolderPickerModal`    | `src/features/settings/DriveFolderPickerModal.tsx`    | アプリ内 Drive フォルダ階層移動、パンくず、ページネーション、フォルダ選択確定モーダル（Pure Presentational）                          |
| `DiagnosticsSection`        | `src/features/settings/DiagnosticsSection.tsx`        | リングバッファ診断ログ一覧表示、1タップコピー、ログクリア UI（Pure Presentational）                                                   |

- **親子分離 UT**: 親 `SettingsPage` の単体テストでは直下の子コンポーネント（`SettingsHeader`, `GoogleAccountSection`, `DriveSyncRootsSection`, `DriveSyncExecutionSection`, `CoverExtractionSection`, `DriveFolderPickerModal`, `DiagnosticsSection`）をすべて `vi.spyOn(...).mockImplementation(() => null)` で完全分離する。
- **Storybook / VRT 決定論性保証**: シングルトン `diagnosticLogger`・同期ストア・表紙抽出スケジューラによる VRT フレークを防ぐため、`SettingsPageProps` の `initialSnapshot?: SettingsPageInitialSnapshot`（固定タイムスタンプ付き `diagnosticEntries`・`authState`・`syncRoots`・オプショナル `syncState` および `coverExtractionState` を同期注入し初期非同期フェッチ・スケジューラ購読をスキップする Prop）および注入可能 `logger?: DiagnosticLogger` を維持・拡張し、1280px / 375px VRT を 100% 決定論的に描画する。

---

## 4. 受け入れ条件（`AC-ST-xx`）

|   AC ID    | 受け入れ条件                                                                                                                                                                                                                                                                                                           |
| :--------: | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AC-ST-01` | `/settings`（`SCR-04`）で Google アカウントの接続状態（未連携／処理中／連携済みメールアドレス）を確認でき、ログインおよびログアウトを実行できる。                                                                                                                                                                      |
| `AC-ST-02` | 連携済み状態で「Drive からフォルダを選択」モーダルを開き、マイドライブからの階層移動（`nextPageToken` 追加読込含む）によって任意のフォルダを `driveSyncRoots` へ登録できる（マイドライブ直下 `"root"` 自体は誤全件同期防止のため選択不可）。                                                                           |
| `AC-ST-03` | 連携済み状態で Google Drive フォルダ URL またはフォルダ ID を直接入力して実在フォルダを登録でき、予約語 `"root"`（直接入力・URL 双方）・不正入力・非フォルダ・ゴミ箱内フォルダ時はインライン警告（`role="alert"`）を表示して拒否する。                                                                                 |
| `AC-ST-04` | 登録済みルートフォルダの一覧表示、`enabled`（有効 `1` ↔ 無効 `0`）切替、および登録解除（`deletedAt` 論理削除）ができ、変更時に表紙抽出キュー対象が即時再同期され、ログアウトしても登録済みフォルダ設定は消失せず保持される（未連携中は追加導線のみ非活性）。                                                           |
| `AC-ST-05` | オンメモリ診断ログの一覧（マスク済み内容）・件数を画面上で確認でき、1タップでのクリップボードコピーおよびログクリアが動作する。                                                                                                                                                                                        |
| `AC-ST-06` | OAuth 処理中およびフォルダ登録確定保存中（`isBackBlocked === true`）は戻る操作・モーダル閉鎖がブロック（優先度 1）され、フォルダ選択モーダル表示中は `backButton` / `Escape` / バックドロップでモーダルのみが閉じ（優先度 2）、通常時は `SCR-01` のスクロール位置を復元して `/` へ戻る（優先度 4 / `TR-09`）。         |
| `AC-ST-07` | `SCR-04` の全コンポーネントが 1対1 の `*.stories.tsx`・親子分離 `*.test.tsx`（C0/C1/Functions/Lines 100%）・決定的初期状態注入による 1280px/375px VRT を PASS する。                                                                                                                                                   |
| `AC-ST-08` | 連携済み かつ 有効ルート 1 件以上のとき `/settings` から「今すぐ同期（差分）」および「強制フルスキャン」を実行でき、最終同期日時・結果サマリ・失敗時エラー（`role="alert"`）が表示される（同期実行中はログアウト・ルート変更を `disabled` で排他保護しつつ、`TR-09` で `SCR-01` へ戻っても同期状態が共有継続される）。 |
| `AC-ST-09` | `/settings` の `CoverExtractionSection` で表紙抽出キューの状態バッジ・プログレスバー・内訳冊数（抽出済み／待機／エラー）を確認でき、連携済みかつエラー巻が 1 冊以上あるとき「エラー分を再試行」ボタンから再抽出を実行できる。                                                                                          |
