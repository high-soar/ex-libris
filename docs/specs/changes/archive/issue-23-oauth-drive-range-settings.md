---
type: spec-delta
title: "Issue #23 差分仕様: Google OAuth（Single-Flight）・GoogleDriveRangeReader・SCR-04 設定基盤"
description: "Androidネイティブ GoogleAuthPlugin（drive.readonly）・Webモック自動フォールバック、Single-Flightトークン管理、GoogleDriveRangeReader（HTTP Range・401 1回リトライ・200 OOM防御）、Dexie version(3) 先行定義＆ルートフォルダ管理UI、およびSCR-04（/settings）ルーティング・戻る優先度制御を定義する差分仕様"
status: "Completed (Archived)"
updated: "2026-11-23"
issue: "#23"
tags:
  [
    delta,
    v0.2,
    oauth,
    single-flight,
    google-drive,
    http-range,
    settings,
    scr-04,
    dexie,
    back-button,
    diagnostics,
  ]
related_specs:
  - docs/index.md
  - docs/specs/requirements.md
  - docs/specs/architecture.md
  - docs/specs/db-schema.md
  - docs/specs/screen-transitions.md
  - docs/specs/engine/zip-streaming.md
  - docs/specs/features/bookshelf.md
  - docs/specs/features/settings.md
  - docs/specs/providers/google-drive.md
  - docs/guidelines/workflow.md
  - docs/guidelines/testing.md
  - docs/quality/bug-and-handover-log.md
related_tests:
  - scripts/android-build-config.test.ts
  - src/App.test.tsx
  - src/app/ServiceProvider.test.tsx
  - src/app/coordinatorClient.test.ts
  - src/app/serviceContext.test.ts
  - src/diagnostics/diagnosticLogger.test.ts
  - src/engine/io/GoogleDriveRangeReader.test.ts
  - src/engine/workers/CoordinatorCore.test.ts
  - src/features/bookshelf/BookshelfHeader.test.tsx
  - src/features/bookshelf/BookshelfPage.test.tsx
  - src/features/bookshelf/DriveSetupBanner.test.tsx
  - src/features/bookshelf/bookshelfUiStateStore.test.ts
  - src/features/reader/ReaderPage.test.tsx
  - src/features/settings/DiagnosticsSection.test.tsx
  - src/features/settings/DriveFolderPickerModal.test.tsx
  - src/features/settings/DriveSyncRootsSection.test.tsx
  - src/features/settings/GoogleAccountSection.test.tsx
  - src/features/settings/SettingsHeader.test.tsx
  - src/features/settings/SettingsPage.test.tsx
  - src/shared/router/RouterProvider.test.tsx
  - src/shared/router/routeMatcher.test.ts
  - src/shared/router/routerContext.test.ts
  - src/storage/db.test.ts
  - test/vrt/vrt.spec.ts
  - test/it/smoke.spec.ts
  - test/it/settings-oauth.spec.ts
---

# Issue #23 差分仕様: Google OAuth（Single-Flight）・`GoogleDriveRangeReader`・`SCR-04` 設定基盤

## 1. 背景・目的（Why）

- Milestone `v0.2`（Google Drive 連携 ＆ 最小仮想本棚：日常実用 MVP）の第 1 弾として、ユーザー自身の Google Drive 上にある自炊マンガアーカイブ（`.zip` / `.cbz`）を事前ダウンロードなしでストリーミング閲覧・管理するための **① Google OAuth 認証基盤（Single-Flight トークン更新）**、**② HTTP `Range` 対応 `GoogleDriveRangeReader` ＆ Coordinator Worker 連携**、および **③ アカウント・マンガ保管ルートフォルダ・診断ログを管理する設定画面 `SCR-04`（`/settings`）** を構築する。

### 1.1 Step 1 合意事項（`/grill-me` 確定内容：Q1〜Q9）

1. **Google OAuth プラットフォーム範囲（Q1）**:
   - Android 実機は `android/app/build.gradle` に導入済みの `com.google.android.gms:play-services-auth:21.4.0` を用いた独自 Capacitor Java プラグイン `GoogleAuthPlugin.java`（`MainActivity.onCreate` で `super.onCreate` 前に登録）で実装する。
   - Web / Vitest / Storybook / Playwright IT は外部 GIS スクリプトや `.env.local` の Client ID を一切要求せず `MockGoogleAuthAdapter` へ自動フォールバックし、`NFR-05`（ゼロコンフィグ PASS）を完全維持する。
2. **起動時セッション復元・有効期限推定・要求スコープ（Q2）**:
   - `GoogleAuthBridge` に `getCachedSession()`（同期参照）、`getSession()`（`SharedPreferences` の連携フラグに基づく同意画面なしの起動時サイレント復元、オフライン時は `SharedPreferences` を消去せず保持）、および変化時のみ発火する `subscribeSession()` を追加する。
   - GMS `AuthorizationResult` に残り秒数がない仕様に対しては、取得時刻 `+ 1時間`（`TOKEN_EARLY_REFRESH_MARGIN_MS = 5分`、55分経過時点で事前 `clearToken` 再取得）＋ `401` リアクティブ Single-Flight 強制リフレッシュ（時差 `401` による新トークン誤破棄を防ぐ `failedToken` Compare-and-Refresh 付き）の二段構えとする。
   - 要求スコープは `v0.2` では `https://www.googleapis.com/auth/drive.readonly` 単独とする（`@Nullable` な `toGoogleSignInAccount()` から `email` が得られない場合は `GET /drive/v3/about?fields=user(emailAddress)` で 1 回補完）。
3. **Worker 境界をまたぐ Single-Flight 更新 ＆ 診断ログ転送（Q3）**:
   - 通常時は `CoordinatorCore` 保持の `accessToken` で IPC ゼロで `fetch` し、未保持または初回 `401` 発生時のみ `Comlink.proxy` 経由の `CoordinatorHostCallbacks.refreshAccessToken({ forceRefresh: true, failedToken })` で Main Thread の Single-Flight 更新を呼び出して 1 回透過リトライする（先行リクエストにより既に Worker 内の `this.accessToken !== failedToken` へ更新済みの場合は IPC ゼロで新トークンを即返却）。
   - Worker 内 `GoogleDriveRangeReader` の通信異常ログも `Comlink.proxy` 経由の `reportDiagnostic` で Main Thread の `diagnosticLogger` へマスク転送する。
4. **`GoogleDriveRangeReader` の HTTP 応答境界とリトライ方針（Q4）**:
   - エンドポイントは `GET /drive/v3/files/{fileId}?alt=media&supportsAllDrives=true`。リトライは `401`（Single-Flight 更新後 1 回のみ）に限定し、`403`/`404`/`416`/`429`/`5xx`/通信断は即座に診断ログ記録の上 `ZipArchiveError("READ_ERROR")` へ変換する。
   - `206 Partial Content` を標準とし、`200 OK` はファイル全体要求時（`offset === 0 && end === totalSize`）のみ許容して部分範囲要求時の巨大 `200 OK` 応答による OOM をストリーム即時キャンセルで遮断し、さらにボディ長不一致（`byteLength !== expectedLength`：短尺切断および `Content-Length` 省略時の超過応答双方）も厳格に `READ_ERROR` として拒否する。
5. **Dexie `version(3)` 先行定義とルートフォルダ UI 境界（Q5）**:
   - `v0.1`（`#19`）の前例に倣い、`#23` で `src/storage/db.ts` に `version(3)`（`driveSyncRoots`, `series`, `volumes` の 3 テーブル）を先行確定させた上で、`DriveSyncRootsRepository` と `SCR-04`「マンガ保管ルートフォルダ管理 UI」まで実装する（`series` / `volumes` Repository とフルスキャン・`changes.list` 差分同期・ファイル名パーサーは `#24` で実装）。
6. **`SCR-04` ルートフォルダ登録 UX（Q6）**:
   - 外部 Google Picker API は使用せず、① Drive REST API（`files.list`）を用いたアプリ内フォルダ階層選択モーダル（マイドライブ階層移動＋このフォルダを追加）と、② 共有フォルダ等も登録できるフォルダ URL / ID 直接入力（予約エイリアス `"root"` を大小文字非区別で拒否し、`files.get` でフォルダ存在・非ゴミ箱検証＋名前自動取得）の両方を提供する。
7. **`SCR-01` 導線・段階別ガイドバナー・診断ログ UI 配置（Q7）**:
   - `SCR-01` にヘッダー「設定」ボタンと段階別ガイドバナー（① Google 未連携 → 連携案内、② 連携済み・有効ルートフォルダ 0 件 → フォルダ登録案内、両方充足時は非表示）を追加し、`TR-03` / `TR-09` で `SCR-01` スクロール位置を保存・復元する。
   - `SCR-01` ヘッダーの「診断ログをコピー」は維持しつつ、`SCR-04` に直近診断ログ一覧表示＋1タップコピー＋ログクリアの拡張セクションを新設する。
8. **ログアウト時のローカルデータ保持ポリシー（Q8）**:
   - ログアウト時は OAuth セッション破棄（`SharedPreferences` クリア・GMS `clearToken`・ベストエフォート `revoke`・Worker `updateAccessToken(null)`）のみを行い、IndexedDB の `driveSyncRoots` や `readingProgress` は保持する（未連携中はフォルダ追加・ピッカー起動ボタンを非活性にして案内表示）。
9. **Android 実機検証（`HO-09`）範囲と `#25`（`HO-10`）分担（Q9）**:
   - `#23` 完了前（区分 A: `HO-09`）の実機検証は「OAuth 同意/サイレント復元/ログアウト・実 Drive フォルダ階層選択/URL登録・診断ログ `[REDACTED]` マスク・ハードウェア戻る優先度（1/2/4）」とし、実 Drive ZIP ストリーミング閲覧の実機確認は `#25`（`/read/volume/:volumeId` 統合時、`HO-10`）で実施する。

### 1.2 対象外スコープ

- `capacitor.config.ts` での `CapacitorHttp.enabled: true` 有効化（**絶対禁止**）
- Drive フルスキャン・`changes.list` 差分同期・ファイル名スマートパーサー・`series` / `volumes` Repository（→ `#24` `[v0.2][2/4]`）
- 本棚シリーズグリッド・`SCR-02`（`/series/:seriesId`）・`SCR-03` Drive 巻リーダー起動（`/read/volume/:volumeId`）（→ `#25` `[v0.2][3/4]`）
- 2段優先度・表紙 WebP 自動抽出スケジューラ（→ `#26` `[v0.2][4/4]`）
- `drive.appdata`（`appDataFolder`）複数端末 LWW バックアップ同期（→ `v1.0`）

---

## 2. 新規作成・変更対象の App 全体正本一覧

|   種別   | 正本ファイル                                                        | 変更概要                                                                                                                                                                                                              |
| :------: | :------------------------------------------------------------------ | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **新規** | [google-drive.md](../../providers/google-drive.md)                  | `GoogleAuthPlugin.java`、`GoogleAuthBridge` / Single-Flight（Compare-and-Refresh 付き）`GoogleAuthTokenManager`、`ya29.*` 秘匿マスク、`parseDriveFolderInput`（`"root"` 拒否）/ `DriveFolderClient`・`AC-GD-01`〜`08` |
| **新規** | [settings.md](../../features/settings.md)                           | `SCR-04`（`/settings`）の画面構成、`isBackBlocked` 優先度 1/2/4 戻る制御、`initialSnapshot`/`logger` による決定的 VRT 契約、および `AC-ST-01`〜`07` を定義                                                            |
| **更新** | [architecture.md](../../architecture.md)                            | Layer 1/3/4 責務更新、`CoordinatorWorkerApi.setHostCallbacks`（`CoordinatorHostCallbacks`）追加、`§4.2` の段階的スコープ要求・`getCachedSession`/`getSession`/`subscribeSession`・`failedToken` 保護を反映            |
| **更新** | [zip-streaming.md](../../engine/zip-streaming.md)                   | `GoogleDriveRangeReader`（`§2.2`：`byteLength !== expectedLength` 厳格検証含む）、`CoordinatorCore` / `coordinator.worker.ts` / `coordinatorClient` の `gdrive` ＆初期トークン同期・`AC-ENG-15`〜`16` を追加          |
| **更新** | [db-schema.md](../../db-schema.md)                                  | `§3.4` に `DriveSyncRootsRepository`（FIFO 直列化・`listActive`/`countEnabled` 条件分離・Tombstone 削除・再登録復活・ログアウト時保持）契約を追加し、`§4.1` に `#23` での `version(3)` 先行定義を明記                 |
| **更新** | [bookshelf.md](../../features/bookshelf.md)                         | `SCR-01` ヘッダー「設定」ボタン、`DriveSetupBanner`（2段階ガイドバナー）、`TR-03`/`TR-09` スクロール位置保持、Storybook VRT 決定的注入契約、および `AC-BS-07` を追加                                                  |
| **更新** | [screen-transitions.md](../../screen-transitions.md)                | `SCR-04`・`TR-03`・`TR-09`、戻る優先度 1/2/4 の `SCR-04` 適用、および結合テストシナリオ `SCN-03`（`test/it/settings-oauth.spec.ts`）を追加                                                                            |
| **更新** | [requirements.md](../../requirements.md)                            | 新設正本 2 冊（`settings.md`, `google-drive.md`）への双方向 `related_specs` リンク同期                                                                                                                                |
| **更新** | [bug-and-handover-log.md](../../../quality/bug-and-handover-log.md) | 区分 A 実機検証申し送り **`HO-09`**（完了ゲート: `親 Issue #23 完了前`）、**`HO-10`**（完了ゲート: `親 Issue #25 完了前`）、および PR #74 Round 1 指摘是正記録（`No. 1`〜`6`）を登録                                  |

---

## 3. 追加・変更する仕様の差分詳細

### 3.1 Android ネイティブ OAuth・`GoogleAuthBridge`・機密マスク・Storage `version(3)`・Drive フォルダ参照（MK-1）

1. **Android ネイティブ層（`GoogleAuthPlugin.java`, `MainActivity.java`）**:
   - `package com.highsoar.exlibris;` 配下に `GoogleAuthPlugin.java`（`@CapacitorPlugin(name = "GoogleAuthPlugin")`）を新設し、`MainActivity.onCreate` の `super.onCreate(savedInstanceState)` 直前で `registerPlugin(GoogleAuthPlugin.class);` を呼び出す（`android/app/build.gradle` 既存の `play-services-auth:21.4.0` と `AndroidManifest.xml` 既存の `INTERNET` 権限のみで動作し、新規パッケージ・権限追加なし）。
   - メソッド契約：
     - `restoreSession()`: `result.hasResolution() == true`（権限取消）の場合のみ `SharedPreferences` をクリアして `"unlinked"` を返し、オフライン等の一時的通信障害時は `SharedPreferences` を保持したまま `"AUTH_NETWORK_ERROR"` で reject する。
     - `signIn()`: `!result.hasResolution()` 時は即時 `"connected"` 解決、`result.hasResolution() == true` 時は `StartIntentSenderForResult` 同意後に `getAuthorizationResultFromIntent` でトークンを取り出す（`RESULT_CANCELED` 時は `"cancelled"`）。
     - `refreshAccessToken({ previousToken, clearCache })`: `clearCache` 時は `clearToken` 先行実行。
     - `signOut({ previousToken })`: `SharedPreferences` 即時クリア ＋ `clearToken` ＋ `https://oauth2.googleapis.com/revoke` への `POST` フォームボディ送信。
   - `@Nullable` な `AuthorizationResult.toGoogleSignInAccount()` を `null` 安全に参照し、`email` が得られない場合は `GET https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)` で 1 回補完して `SharedPreferences` へ保存する。
   - `scripts/android-build-config.test.ts` に `MainActivity.java` の `registerPlugin(GoogleAuthPlugin.class)` 先行呼び出し・`GoogleAuthPlugin.java` の `StartIntentSenderForResult`＋`getBridge().saveCall`/`getSavedCall`/`releaseCall`（非推奨 `freeSavedCall` 排除）・`pendingSignInCallId`・`clearToken`・`drive.readonly` 単独スコープ・クエリ文字列トークン非露出の契約テストを追加する。
2. **`GoogleAuthBridge` ＆ Single-Flight `GoogleAuthTokenManager`（`src/bridges/oauth/`）**:
   - `GoogleAuthTokenManager` が `GoogleAuthAdapter`（ネイティブ時 `CapacitorGoogleAuthAdapter`、Web/テスト時 `MockGoogleAuthAdapter`）をラップし、`TOKEN_DEFAULT_TTL_MS = 3_600_000`・`TOKEN_EARLY_REFRESH_MARGIN_MS = 300_000`（残り 5 分未満で事前更新）・`failedToken` 比較ガード（Compare-and-Refresh：時差 `401` で既に別トークンへ更新済みなら `clearToken` をスキップして現トークンを即返却）・Single-Flight Promise 共有・`authEpoch` 世代ガード・`getCachedSession()` 同期参照・変化時のみ発火する `subscribeSession` 配信を一元管理する。
   - `getSession()` はオフライン一時障害（`AUTH_NETWORK_ERROR`）時に警告ログを記録して `null` を返し（ネイティブ `SharedPreferences` は保持）、画面初期マウントをクラッシュさせない。
   - `MockGoogleAuthAdapter` はデフォルトのテストアカウント（例: `reader@example.com`）での即時ログイン／サイレント復元／トークンローテーションに加え、UT・Storybook・Playwright IT から遅延応答（優先度 1 ブロック検証用）・キャンセル・エラー・401 用トークン切替を制御できるテストフックを備える。
3. **診断ロガー秘匿マスク拡張（`src/diagnostics/diagnosticLogger.ts`）**:
   - `redactSensitiveText` に `RAW_GOOGLE_ACCESS_TOKEN_PATTERN = /\bya29\.[A-Za-z0-9\-._~+/]+=*/g` → `"[REDACTED]"` を追加する。
4. **Dexie `version(3)` 先行定義 ＆ `DriveSyncRootsRepository`（`src/storage/`）**:
   - `src/storage/types.ts` に `DriveSyncRootRecord`, `SeriesRecord`, `VolumeRecord` を定義し、`src/storage/db.ts` に `this.version(3).stores({ ..., driveSyncRoots, series, volumes })` を追加する（`resetTestDb()` は `targetDb.tables` 全 6 テーブルをクリア）。
   - `src/storage/repositories/driveSyncRootsRepository.ts`（`DexieDriveSyncRootsRepository`）を実装し、FIFO Promise 直列化・レコード検証・`listActive()`（`deletedAt === null` 昇順）・`countEnabled()`（`deletedAt === null && enabled === 1` 件数）・`upsertRoot()`（Tombstone 再有効化対応）・`setEnabled()`・`removeRoot()`（`deletedAt` Tombstone 論理削除）を提供する。
5. **Drive フォルダ参照クライアント（`src/providers/gdrive/`）**:
   - `parseDriveFolderInput`（URL / ID 正規化抽出、予約エイリアス `"root"` は大小文字非区別で `null` 拒否）と `GoogleDriveFolderClient`（`resolveFolderById`, `listChildFolders`、`failedToken` 付き 401 Single-Flight 1回透過リトライ・決定論的 `DriveApiErrorCode` マッピング・クエリエスケープ・マスク済み診断記録）および Web/Storybook/IT 用の `MockDriveFolderClient` を実装する。

### 3.2 `GoogleDriveRangeReader` ＆ Coordinator Worker 統合（MK-2）

1. **`GoogleDriveRangeReader`（`src/engine/io/GoogleDriveRangeReader.ts`）**:
   - [zip-streaming.md §2.2](../../engine/zip-streaming.md#22-googledriverangereadersrcengineiogoogledriverangereaderts--v02) に従い、`Range: bytes=${offset}-${end - 1}`・`supportsAllDrives=true`・`206 Partial Content`（および全体要求時のみの `200 OK`）受理・部分要求時の `200 OK` 即時 `body.cancel()` OOM 遮断・`byteLength !== expectedLength`（短尺および `Content-Length` 省略超過応答の双方）厳格拒否・`401` 時の `{ forceRefresh: true, failedToken: token }` 1回透過リトライ・その他異常時のマスク済み `onDiagnostic` 通知＆`ZipArchiveError("READ_ERROR")`・`AbortSignal` 即時中断を実装する。
2. **`CoordinatorCore` / `coordinator.worker.ts` / `coordinatorClient` / `ServiceProvider` 配線**:
   - `src/engine/types.ts`（および `src/types.ts`）の `CoordinatorWorkerApi` に必須メソッド `setHostCallbacks(callbacks: CoordinatorHostCallbacks | null): void` を追加する（モック `CoordinatorWorkerApi` を生成する既存 `src/features/reader/ReaderPage.test.tsx` 等も同一 PR で同期更新する）。
   - `CoordinatorCore.ts` で `source.kind === "gdrive"` 時に `GoogleDriveRangeReader` を生成し、通常時および時差 `401` 更新済み時（`this.accessToken !== failedToken`）の IPC ゼロ高速パス＋未保持/初回 `401` 時の `hostCallbacks.refreshAccessToken({ forceRefresh, failedToken })` 呼び出し＋`tokenVersion` 保護＋`hostCallbacks.reportDiagnostic` 転送を実装する。
   - `src/engine/workers/coordinator.worker.ts` は **条件分岐ゼロ** で `setHostCallbacks: (callbacks) => core.setHostCallbacks(callbacks)` を透過中継する。
   - `src/app/coordinatorClient.ts` は `createGuardedCoordinatorApi` で `setHostCallbacks` を `forwardSyncRpc` 必須中継（不要な `?.` 不使用で C1 100% 維持）とし、`authBridge` 指定時は ① `api.setHostCallbacks(Comlink.proxy(hostCallbacks))`、② `authBridge.getCachedSession()` 非 `null` 時の初期トークン即時同期、③ `authBridge.subscribeSession` による変化時同期・`dispose()` 購読解除を行う。
   - `src/app/serviceContext.ts` / `src/app/ServiceProvider.tsx` に `googleAuthBridge`, `driveSyncRootsRepo`, `driveFolderClient` を追加し、`createCoordinatorSession` デフォルト生成へ `googleAuthBridge` を結線する（非ネイティブ開発/テスト環境では Playwright IT 制御用に `window.__exLibrisServices` へモック操作ヘルパまたは参照を安全公開し、`shouldExposeResetTestDb` と同一ガードで本番/Android 実機への露出を遮断する）。

### 3.3 `SCR-04` 設定画面・`SCR-01` バナー子コンポーネント ＆ Storybook / VRT（MK-3）

1. **`SCR-04` Presentational 子コンポーネント群（`src/features/settings/`）**:
   - `SettingsHeader.tsx`（`isBackBlocked` 連動 `disabled`）, `GoogleAccountSection.tsx`, `DriveSyncRootsSection.tsx`, `DriveFolderPickerModal.tsx`（`isSavingSyncRoot` 中閉鎖抑止）, `DiagnosticsSection.tsx` を実装し、全ファイルに対して 1対1 の `*.stories.tsx` と `*.test.tsx`（`composeStories` 全件実行＋操作網羅、C0/C1/Functions/Lines 100%）および 1280px/375px VRT スナップショットを作成する（`DriveFolderPickerModal` の `isOpen: false` ストーリーのみ `tags: ["skip-vrt"]`）。
2. **`SCR-01` 子コンポーネント更新・追加（`src/features/bookshelf/`）**:
   - `BookshelfHeader.tsx` に「設定」ボタン（`data-testid="header-settings-button"`, `onOpenSettings?: () => void`：MK-3 段階では既存 `BookshelfPage.tsx` の `typecheck` を壊さないようオプショナル Prop とし、Step 4 で `BookshelfPage` と結線）を追加し、既存ストーリー・UT・VRT を更新する。
   - `DriveSetupBanner.tsx`（`"unauthenticated"` / `"no-roots"` / `"ready"` / `"loading"`、非表示ストーリーのみ `tags: ["skip-vrt"]`）を新設し、1対1 Story/UT・VRT を整備する。

### 3.4 Page 結合・ルーティング・戻る優先度制御・Playwright IT `SCN-03`・実機検証（Step 4 IT）

1. **ルーティング・UI 状態ストア・Page 結合・Storybook 決定論性**:
   - `src/shared/router/routeMatcher.ts` / `RouterProvider.tsx` に `SETTINGS_ROUTE`（`/settings`）と優先度 1 戻るブロック（`isBackBlocked = isAuthBusy || isSavingSyncRoot`）対応を追加する。
   - `src/features/bookshelf/bookshelfUiStateStore.ts` で `SCR-01` スクロール位置の保存・復元を管理し、`BookshelfPage.tsx`（`DriveSetupBanner`・設定遷移統合、既存ストーリーへ決定的 `initialDriveSetupState` 指定）および `SettingsPage.tsx`（全子コンポーネント `vi.spyOn` 完全分離 UT・固定タイムスタンプ `initialSnapshot` / 注入可能 `logger` による決定的 1対1 Story / VRT 含む）と `src/App.tsx`（優先度 1/2/3/4/5 ハードウェア戻る制御統合）を結合する。
2. **Playwright IT（`SCN-01` 更新 ＆ `SCN-03` 新設）と完了処理**:
   - `test/it/smoke.spec.ts`（`SCN-01`）および新設 `test/it/settings-oauth.spec.ts`（`SCN-03`）で全受け入れ条件を実ブラウザ検証する。
   - 本差分仕様を `Completed (Archived)` として `docs/specs/changes/archive/issue-23-oauth-drive-range-settings.md` へ移動し、Gate 1〜6 完了直後に `build-android.yml`（`debug`）でビルドした `app-debug.apk` を Google Drive へ分離配置して **`HO-09` Android 実機検証試験項目表** を提示する。

---

## 4. テスト計画（UT / VRT / IT）

| 層                                                                      | テスト手法・対象                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | 合格基準                                                                            |
| :---------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------- |
| **MK-1: Native 契約・OAuth Bridge・Storage v3・Drive Folder Client**    | `scripts/android-build-config.test.ts`（`GoogleAuthPlugin.java` / `MainActivity.java` 登録・`saveCall`・`clearToken`・`drive.readonly`・`@Nullable` 安全参照・オフライン `SharedPreferences` 保護検証）、`googleAuthTokenManager.test.ts`（Single-Flight 並列集約・**並列リクエスト時差 `401` 到着時の `failedToken` Compare-and-Refresh 二重 `clearToken` 防止**・5分前更新・`authEpoch` ログアウト競合遮断・一時障害 `getSession()` `null` 救済・登録時非発火 `subscribeSession`）、`capacitorGoogleAuthAdapter.test.ts` / `mockGoogleAuthAdapter.test.ts`、`diagnosticLogger.test.ts`（`ya29.*` / `Bearer` 完全マスク）、`db.test.ts`（`version(3)` 6テーブル＆`resetTestDb`）、`driveSyncRootsRepository.test.ts`（FIFO 直列化・`countEnabled` 条件・Tombstone 論理削除・再登録復活・破損除外）、`driveFolderInput.test.ts` / `googleDriveFolderClient.test.ts` / `mockDriveFolderClient.test.ts`（URL/ID 解析・**予約語 `"root"` 拒否**・`failedToken` 付き 401 1回リトライ・全 `DriveApiErrorCode` マッピング・クエリエスケープ） | C0 / C1 / Functions / Lines **100%** PASS ＆ CI `android-compile` PASS              |
| **MK-2: `GoogleDriveRangeReader` ＆ Coordinator Worker 統合**           | `GoogleDriveRangeReader.test.ts`（`206` 範囲取得・終端クランプ・全体要求 `200` 許容 vs 部分要求 `200` 即時 `body.cancel()` OOM 遮断・`Content-Length` 超過遮断・**短尺および `Content-Length` 省略超過の双方 `byteLength !== expectedLength` `READ_ERROR`**・`401` `failedToken` 付き 1回透過リトライ・再 `401`/`403`/`404`/`416`/`429`/`500`/通信断 `READ_ERROR`＆マスク診断通知・`AbortSignal` 即時中断）、`CoordinatorCore.test.ts`（`gdrive` オープン・保持トークン＆時差 `401` 更新済み `this.accessToken !== failedToken` 0-IPC・初回 401 更新・`tokenVersion` ログアウト保護・診断転送）、`coordinatorClient.test.ts`（必須 `setHostCallbacks`・`getCachedSession()` 初期同期・購読解除） / `ServiceProvider.test.tsx` / `serviceContext.test.ts` / `ReaderPage.test.tsx`（モック型同期）                                                                                                                                                                                                                                        | C0 / C1 / Functions / Lines **100%** PASS                                           |
| **MK-3: `SCR-04` / `SCR-01` 子 UI コンポーネント ＆ VRT**               | `SettingsHeader`, `GoogleAccountSection`, `DriveSyncRootsSection`, `DriveFolderPickerModal`, `DiagnosticsSection`, `BookshelfHeader`, `DriveSetupBanner` 各 `.stories.tsx` / `.test.tsx`（`composeStories` 全件＋イベント・アクセシビリティ・ロールバック検証）および 1280px/375px VRT スナップショット更新                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | C0 / C1 / Functions / Lines **100%** PASS ＆ VRT 1280px/375px PASS                  |
| **Step 4: Page 結合・ルーティング・Playwright IT (`SCN-01`, `SCN-03`)** | `routeMatcher.test.ts` / `RouterProvider.test.tsx`、`bookshelfUiStateStore.test.ts`、`BookshelfPage.test.tsx` / `SettingsPage.test.tsx` / `App.test.tsx`（親子 `vi.spyOn` 完全分離・`isBackBlocked` 優先度 1/2/4 検証・決定的 `initialSnapshot` / `initialDriveSetupState` VRT）＋ Playwright `test/it/smoke.spec.ts` (`SCN-01`) / `test/it/settings-oauth.spec.ts` (`SCN-03`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | C0 / C1 / Functions / Lines **100%** PASS、VRT PASS、全 Playwright IT **100% PASS** |

---

## 5. Sub-issue 分割計画・申し送り事項・Android 実機検証計画

### 5.1 Sub-issue 分割計画（設計 PR マージ後に起票）

1. **Sub-issue ①（MK-1）: Android `GoogleAuthPlugin`・Single-Flight `GoogleAuthBridge`・`ya29.*` マスク・Dexie `version(3)` `DriveSyncRootsRepository`・`DriveFolderClient` 実装**
   - 対象: `android/app/src/main/java/com/highsoar/exlibris/{MainActivity,GoogleAuthPlugin}.java`, `scripts/android-build-config.test.ts`, `src/diagnostics/diagnosticLogger.ts`, `src/bridges/oauth/**`, `src/storage/{types,db}.ts`, `src/storage/repositories/driveSyncRootsRepository.ts`, `src/providers/gdrive/**` および全 1対1 単体テスト
   - マージ方針: 新規 npm/Gradle パッケージ・`AndroidManifest` 権限追加は伴わず本設計 PR で承認された外部ドメイン・Java プラグイン契約内の実装（エスカレーション条件非該当を確認の上 Gate 1〜6 通過後に進行。万一 Gradle/Manifest 変更が必要となった場合は [workflow.md §4.1](../../../guidelines/workflow.md#41-ai-自律マージの停止人間エスカレーション条件) に従い人間エスカレーション）
2. **Sub-issue ②（MK-2）: `GoogleDriveRangeReader` ＆ `CoordinatorCore` / `coordinatorClient` / `ServiceProvider` 統合**
   - 対象: `src/engine/io/GoogleDriveRangeReader.ts`, `src/engine/types.ts`, `src/types.ts`, `src/engine/workers/CoordinatorCore.ts`, `src/engine/workers/coordinator.worker.ts`, `src/app/{coordinatorClient,serviceContext,ServiceProvider}.ts(x)`, `src/features/reader/ReaderPage.test.tsx`（モック API 型同期）および全 1対1 単体テスト
3. **Sub-issue ③（MK-3）: `SCR-04` 設定画面子コンポーネント群・`SCR-01` 段階別ガイドバナー ＆ Storybook / VRT 実装**
   - 対象: `src/features/settings/{SettingsHeader,GoogleAccountSection,DriveSyncRootsSection,DriveFolderPickerModal,DiagnosticsSection}.tsx`（＋ `.stories.tsx` / `.test.tsx`）, `src/features/bookshelf/{BookshelfHeader,DriveSetupBanner}.tsx`（＋ `.stories.tsx` / `.test.tsx`、`BookshelfHeaderProps.onOpenSettings` はオプショナルとして既存 `BookshelfPage.tsx` 型整合を維持）, `test/vrt/snapshots/*`
4. **Sub-issue ④（Step 4 IT）: `SettingsPage` / `BookshelfPage` / ルーティング / 戻る優先度統合・Playwright `SCN-03`・仕様アーカイブ・Android 実機検証（`Closes #23`）**
   - 対象: `src/shared/router/{routeMatcher,RouterProvider,routerContext}.ts(x)`, `src/features/bookshelf/{bookshelfUiStateStore.ts,BookshelfPage.tsx}`, `src/features/settings/SettingsPage.tsx`, `src/App.tsx`（＋各 `.stories.tsx` / `.test.tsx` / VRT）, `test/it/{helpers,smoke.spec,settings-oauth.spec}.ts`, `docs/quality/bug-and-handover-log.md`, 本差分仕様の `docs/specs/changes/archive/` アーカイブ移動（**人間承認・マージ必須**）

### 5.2 申し送り事項（`HO-09` / `HO-10`）と Android 実機検証計画

- **実施区分判定（[workflow.md §2.2](../../../guidelines/workflow.md#22-android-実機検証の実施判断基準と試験項目表フォーマット)）**: **区分 A（完了ゲート: `親 Issue #23 完了前`）**
  - **根拠**: Android ネイティブ Java プラグイン（`GoogleAuthPlugin.java` / Play Services OAuth 同意画面インテント連携）の新設、実 Google Drive REST API 通信、および Android ハードウェア戻るボタン優先度制御（1/2/4）を含み、実機確認項目が 4 項目あるため。
- **登録済み申し送り**:
  1. **`HO-09`**（完了ゲート: `親 Issue #23 完了前`）: Step 4 IT PR の Gate 1〜6 完了直後に `build-android.yml` (`debug`) でビルドした `app-debug.apk` を Google Drive へ分離配置し、以下の 4 観点を実機確認する：
     - ① **Google OAuth 同意認可・メール表示・再起動サイレント復元・ログアウト**: `/settings` で「Google でログイン」から同意画面を経て連携メールアドレスが表示され、アプリ完全終了→再起動後も同意画面なしで連携状態が復元され、ログアウト後も登録済み `driveSyncRoots` が保持されること。
     - ② **実 Google Drive フォルダ階層選択 ＆ URL/ID 登録**: 「Drive からフォルダを選択」モーダルでマイドライブ配下の実フォルダ階層を開いて登録でき、またフォルダ URL / ID 直接入力でも登録・有効/無効切替・削除ができ、`SCR-01` の段階別ガイドバナーが状態に応じて切り替わる／消えること。
     - ③ **診断ログ閲覧・コピー・機密マスク**: `/settings` の診断ログ一覧および 1タップコピー出力に `ya29.*` や `Bearer <生トークン>` が一切平文出力されないこと。
     - ④ **Android ハードウェア戻るボタン優先度制御**: フォルダ選択モーダル表示中の戻る操作でモーダルのみが閉じ（優先度 2）、再度戻る操作で `SCR-01` へ戻りスクロール位置が復元されること（優先度 4 / `TR-09`）。
  2. **`HO-10`**（解決先: `#25`、完了ゲート: `親 Issue #25 完了前`）: `GoogleDriveRangeReader` を用いた実 Google Drive 上の ZIP/CBZ リーダー閲覧（`/read/volume/:volumeId` 初回 TTFP `< 1.0s`・2回目 `0RTT` `< 0.5s`）の実機確認は、リーダー統合を行う `#25` で実施する。
