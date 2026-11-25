---
type: spec-provider
title: "Google OAuth（Single-Flight）・Google Drive フォルダ参照 ＆ 差分同期プロバイダ仕様書"
description: "Android ネイティブ GoogleAuthPlugin・Web モック自動フォールバック、Single-Flight トークン管理、機密マスク、Drive ルートフォルダ参照、および指定ルート配下フルスキャン＆changes.list 増分差分同期エンジンの正本"
status: "Review (#24)"
updated: "2026-11-25"
tags:
  [
    provider,
    oauth,
    google-drive,
    single-flight,
    capacitor,
    android,
    security,
    redaction,
    drive-sync,
    changes-api,
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
  - docs/specs/providers/filename-parser.md
  - docs/guidelines/testing.md
related_tests:
  - scripts/android-build-config.test.ts
  - src/app/ServiceProvider.test.tsx
  - src/diagnostics/diagnosticLogger.test.ts
  - src/bridges/oauth/googleAuthErrors.test.ts
  - src/bridges/oauth/capacitorGoogleAuthAdapter.test.ts
  - src/bridges/oauth/mockGoogleAuthAdapter.test.ts
  - src/bridges/oauth/googleAuthTokenManager.test.ts
  - src/providers/gdrive/driveApiErrors.test.ts
  - src/providers/gdrive/driveFolderInput.test.ts
  - src/providers/gdrive/driveHttpClient.test.ts
  - src/providers/gdrive/googleDriveFolderClient.test.ts
  - src/providers/gdrive/mockDriveFolderClient.test.ts
  - src/providers/gdrive/googleDriveSyncClient.test.ts
  - src/providers/gdrive/mockDriveSyncClient.test.ts
  - src/providers/gdrive/driveSyncEngine.test.ts
---

# Google OAuth（Single-Flight）・Google Drive フォルダ参照 ＆ 差分同期プロバイダ仕様書

本ドキュメントは、ExLibris における Google OAuth 認証ブリッジ（`src/bridges/oauth/`、Android ネイティブ `GoogleAuthPlugin.java` ＆ Web モック自動フォールバック）、Single-Flight トークン更新マネージャ、診断ログ機密マスク規約、Google Drive フォルダ階層・メタデータ参照クライアント、および指定ルートフォルダ配下限定フルスキャン＆`changes.list` 増分差分同期エンジン（`src/providers/gdrive/`）の正本（Single Source of Truth）です。

---

## 1. モジュール構成と責務分離

| モジュールパス                                                          |      レイヤー      | 責務                                                                                                                                                          |
| :---------------------------------------------------------------------- | :----------------: | :------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `android/app/src/main/java/com/highsoar/exlibris/GoogleAuthPlugin.java` |  Native (Android)  | Google Play Services Identity API（`AuthorizationClient`）を用いた認可・同意画面遷移・サイレント復元・`clearToken`・トークン失効処理                          |
| `src/bridges/oauth/types.ts`                                            |  Layer 4 (Bridge)  | `GoogleAuthSession`, `GoogleAuthBridge`, `GoogleAuthAdapter`, `GoogleAuthErrorCode` 等の純粋型定義                                                            |
| `src/bridges/oauth/googleAuthErrors.ts`                                 |  Layer 4 (Bridge)  | 型付き認証エラー `GoogleAuthError`（`AUTH_CANCELLED` / `AUTH_REQUIRED` / `AUTH_NETWORK_ERROR` / `AUTH_FAILED`）                                               |
| `src/bridges/oauth/capacitorGoogleAuthAdapter.ts`                       |  Layer 4 (Bridge)  | Capacitor `registerPlugin("GoogleAuthPlugin")` を呼び出す薄いネイティブアダプタ                                                                               |
| `src/bridges/oauth/mockGoogleAuthAdapter.ts`                            |  Layer 4 (Bridge)  | Web / Vitest / Storybook / Playwright IT 用のゼロコンフィグ決定論的モックアダプタ（`NFR-05`）                                                                 |
| `src/bridges/oauth/googleAuthTokenManager.ts`                           |  Layer 4 (Bridge)  | `GoogleAuthBridge` 実装。有効期限5分前判定・Single-Flight Promise 共有・`authEpoch` 世代保護・セッション購読配信                                              |
| `src/providers/gdrive/types.ts`                                         | Layer 1 (Provider) | `DriveFolderMetadata`, `DriveFolderPage`, `DriveFolderClient`, `DriveSyncClient`, `DriveSyncEngine`, `DriveSyncResult`, `DriveApiErrorCode` 等の純粋型定義    |
| `src/providers/gdrive/driveApiErrors.ts`                                | Layer 1 (Provider) | `DriveApiError`（`UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `NOT_A_FOLDER`, `FOLDER_TRASHED`, `RATE_LIMITED`, `TOKEN_EXPIRED`, `NETWORK_ERROR`）               |
| `src/providers/gdrive/driveHttpClient.ts`                               | Layer 1 (Provider) | Drive REST JSON 共通実行ヘルパ（標準 `fetch`・401 Compare-and-Refresh 1回リトライ・429/403 任意指数バックオフ・`AbortError` 非ログ再送出・クエリエスケープ）  |
| `src/providers/gdrive/driveFolderInput.ts`                              | Layer 1 (Provider) | Google Drive フォルダ URL / フォルダ ID 文字列の正規化・抽出純関数（`parseDriveFolderInput`）                                                                 |
| `src/providers/gdrive/googleDriveFolderClient.ts`                       | Layer 1 (Provider) | `driveHttpClient` を用いた `files.get` / `files.list` フォルダ参照実装                                                                                        |
| `src/providers/gdrive/mockDriveFolderClient.ts`                         | Layer 1 (Provider) | Web / Storybook / Playwright IT 向けのインメモリ決定論的フォルダ階層モック実装                                                                                |
| `src/providers/gdrive/googleDriveSyncClient.ts`                         | Layer 1 (Provider) | `driveHttpClient`（最大 3 回指数バックオフ有効）を用いた `files.list`（バッチ子要素走査）・`files.get`（親遡り）・`changes.getStartPageToken`・`changes.list` |
| `src/providers/gdrive/mockDriveSyncClient.ts`                           | Layer 1 (Provider) | Web / Vitest / Playwright IT 向けのインメモリ決定論的 Drive ファイル木＆変更イベントモック実装（`NFR-05`）                                                    |
| `src/providers/gdrive/driveSyncEngine.ts`                               | Layer 1 (Provider) | 指定ルート限定 BFS フルスキャン ＆ `changes.list` 増分差分同期オーケストレータ（排他ロック・ファイル名パース連携・DB/キャッシュ反映・トークン原子保存）       |

---

## 2. Google OAuth 認証ブリッジ仕様（`src/bridges/oauth/` ＆ `GoogleAuthPlugin.java`）

### 2.1 プラットフォーム方針と要求スコープ（段階導入）

1. **Android 実機専用ネイティブ OAuth ＋ Web モック自動フォールバック（`NFR-05`）**:
   - `Capacitor.isNativePlatform() === true` の場合は `CapacitorGoogleAuthAdapter`（`GoogleAuthPlugin.java`）を使用し、それ以外の環境（Web ブラウザ・Vitest・Storybook・Playwright IT）では外部スクリプト（GIS）や `.env.local` の Client ID を一切要求せず `MockGoogleAuthAdapter` へ自動フォールバックする。
   - Android OAuth クライアント認証は Google Cloud Console 上のパッケージ名 `com.highsoar.exlibris` ＋ 固定署名キーストア `SHA-1`（[architecture.md §6](../architecture.md#6-android-ビルド署名バージョン管理リリース自動化契約ac-apk-0105)）のみで検証されるため、リポジトリや APK 内に Client Secret を一切保持しない。
2. **要求スコープの最小権限・段階導入**:
   - **`v0.2` 要求スコープ**: `https://www.googleapis.com/auth/drive.readonly` の **1 スコープ単独** を要求する。
   - **`v1.0` 追加予定スコープ**: 複数端末バックアップ・LWW 同期導入時に `https://www.googleapis.com/auth/drive.appdata` を増分追加する。

### 2.2 Android ネイティブ `GoogleAuthPlugin.java` 契約

1. **プラグイン登録とライフサイクル規律（[testing.md §2.4](../../guidelines/testing.md#24-webgl2-viewer-ui--bridge-layer生webgl2描画l1キャッシュuibridge層)）**:
   - `MainActivity.onCreate` にて **`super.onCreate(savedInstanceState)` より前に `registerPlugin(GoogleAuthPlugin.class);`** を呼び出す（`scripts/android-build-config.test.ts` で機械検証する）。
   - `load()` で `ActivityResultContracts.StartIntentSenderForResult` ランチャーを登録し、同意画面遷移時は `pendingSignInCallId` 二重起動ガードとともに `getBridge().saveCall(call)` / `getBridge().getSavedCall(callbackId)` / `getBridge().releaseCall(savedCall)` で `PluginCall` を確実に保持・解放する（`@Deprecated` な `Plugin#freeSavedCall()` は使用しない）。
   - `handleOnDestroy()` でワーカースレッド（`ExecutorService`）の `shutdownNow()` および揮発状態リセットを行う。
2. **提供するネイティブメソッド**:
   - `restoreSession()`:
     - `SharedPreferences`（`"exlibris_google_auth"`: `is_linked`, `email`）を確認し、`is_linked == false` の場合は同意画面を出さず `{ status: "unlinked" }` を返す。
     - `is_linked == true` の場合は `Identity.getAuthorizationClient(activity).authorize(request)` を呼び、`!result.hasResolution()` であればアクセストークンとメールアドレス（下記補完ルール適用）を含む `{ status: "connected", accessToken, email }` を返す。
     - **権限取消と一時的通信障害の厳格分離**: `result.hasResolution() == true`（権限取消済み・再同意必須）の場合のみ `SharedPreferences` をクリアして `{ status: "unlinked" }` を返す。一方、オフライン起動や一時的ネットワーク・GMS 障害（`ApiException` の `NETWORK_ERROR` / タイムアウト / `IOException` 等）の場合は **`SharedPreferences`（`is_linked = true` および保存済み `email`）をクリアせず維持** したまま `"AUTH_NETWORK_ERROR"` として reject する。
   - `signIn()`:
     - 既に進行中の `signIn` がある場合は競合エラーを返す。
     - `authorize(request)` で `!result.hasResolution()`（既に端末・アカウント側にスコープ認可が残っている場合）であれば、`PendingIntent` を起動せず即座に `{ status: "connected", accessToken, email }` を解決して `SharedPreferences` に保存する。
     - `result.hasResolution() == true` の場合は `PendingIntent` を `StartIntentSenderForResult` で起動してユーザーの同意操作を待ち、コールバックで `RESULT_CANCELED` 時は `{ status: "cancelled" }`、`RESULT_OK` 時は `Identity.getAuthorizationClient(activity).getAuthorizationResultFromIntent(result.getData())` から `accessToken` と `email` を取り出して `SharedPreferences` に保存し `{ status: "connected", accessToken, email }` を解決する。
   - `refreshAccessToken({ previousToken, clearCache })`:
     - `clearCache == true` かつ `previousToken` が非空の場合、**必ず先に `Identity.getAuthorizationClient(activity).clearToken(ClearTokenRequest)` を実行** して GMS ローカルキャッシュの失効トークンを破棄してから `authorize(request)` を再実行する。
     - `!result.hasResolution()` なら新トークンを返し、`result.hasResolution() == true` なら連携状態をクリアして `"AUTH_REQUIRED"` エラーで reject する（一時的ネットワーク障害時は `SharedPreferences` を消去せず `"AUTH_NETWORK_ERROR"` で reject する）。
   - `signOut({ previousToken })`:
     - `SharedPreferences` の連携状態とメモリ上のトークン・メールアドレスを即時クリアした上で、バックグラウンドで `clearToken` および `https://oauth2.googleapis.com/revoke` へのベストエフォート `POST`（`application/x-www-form-urlencoded` ボディ `token=...`、URL クエリへのトークン露出禁止、タイムアウト 5 秒、オフライン失敗時も非致命で `resolve`）を実行する。
3. **メールアドレス取得（`@Nullable` 安全参照）と `drive/v3/about` フォールバック**:
   - Play Services の `result.toGoogleSignInAccount()` 自体が `@Nullable` であるため、必ず `GoogleSignInAccount account = result.toGoogleSignInAccount(); String email = account != null ? account.getEmail() : null;` と `null` 安全に取り出す（直接チェーン呼び出しによる `NullPointerException` を防止）。
   - `drive.readonly` 単独スコープでは `email` が `null` または空文字となる端末が存在するため、未取得かつ `SharedPreferences` にも保存がない場合は、取得した `accessToken` を用いて `GET https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)`（タイムアウト 10 秒）を 1 回呼び出して `user.emailAddress` を補完・永続化する（それも取得不能な制限環境では `"Google Drive 連携済み"` 表示用フォールバック文字列を許容しログイン自体は失敗させない）。

### 2.3 Single-Flight `GoogleAuthTokenManager`（`GoogleAuthBridge` 実装）契約

```ts
export interface GoogleAuthSession {
  readonly email: string;
  readonly accessToken: string;
  /** UNIX ms（ネイティブ取得時は now + 3_600_000） */
  readonly expiresAt: number;
}

export interface GetAccessTokenOptions {
  readonly forceRefresh?: boolean;
  /**
   * 401 応答を引き起こした旧トークン文字列。
   * 並列リクエストの先行リフレッシュにより既に別トークンへ更新済みの場合、二重 clearToken・再認可をスキップする。
   */
  readonly failedToken?: string;
}

export type AuthSessionListener = (session: GoogleAuthSession | null) => void;

export interface GoogleAuthBridge {
  getCachedSession(): GoogleAuthSession | null;
  getSession(): Promise<GoogleAuthSession | null>;
  signIn(): Promise<GoogleAuthSession>;
  signOut(): Promise<void>;
  getValidAccessToken(options?: GetAccessTokenOptions): Promise<string>;
  subscribeSession(listener: AuthSessionListener): () => void;
}
```

1. **有効期限推定・5 分前プロアクティブ更新・`getSession()` 障害耐性**:
   - GMS `AuthorizationResult` は残り有効秒数を返さないため、トークン取得・更新時刻 `now` に対して `TOKEN_DEFAULT_TTL_MS = 3_600_000`（60 分）を設定し、`TOKEN_EARLY_REFRESH_MARGIN_MS = 300_000`（残り **5 分未満**、すなわち取得から 55 分経過時点）で期限間近と判定する。
   - `getValidAccessToken({ forceRefresh, failedToken })` 呼び出し時、`forceRefresh !== true` かつ保持中の `session` が `session.expiresAt - now >= TOKEN_EARLY_REFRESH_MARGIN_MS` を満たす場合は通信なしで即座に `session.accessToken` を返す。
   - `getSession()` はメモリ上に有効な `session` があれば即返し、未保持時は `adapter.restoreSession()` を実行する。オフライン等の一時的エラー（`AUTH_NETWORK_ERROR`）が発生した場合は `diagnosticLogger.warn("oauth", ...)` へ記録した上で例外を握り潰して `null` を返し（ネイティブ側の `SharedPreferences` は保持されるためオンライン復帰後に再復元可能）、`BookshelfPage` / `SettingsPage` の初期マウントをクラッシュさせない。
2. **Compare-and-Refresh（`failedToken` 比較ガード）・Single-Flight Promise 共有・`authEpoch` 世代ガード**:
   - **時差 `401` に対する Compare-and-Refresh 保護**: 複数の並列リクエスト（見開き 2 ページ取得や Warm Prefetch 等）が同一の旧トークン `T0` で通信を開始し、先行リクエストが `T1` への更新を完了した直後に後発リクエストの初回 `401` が到着して `getValidAccessToken({ forceRefresh: true, failedToken: "T0" })` を呼んだ場合、保持中の `session` が非 `null` かつ `session.accessToken !== failedToken` かつ `session.expiresAt - now >= TOKEN_EARLY_REFRESH_MARGIN_MS` であれば、**発行されたばかりの新トークン `T1` に対する `clearToken`・再認可を行わず即座に `session.accessToken`（`T1`）を返却** する。
   - `forceRefresh === true`（かつ上記 Compare-and-Refresh 非該当）、または残り有効期限が 5 分未満、または初回未復元状態で複数の呼び出しが同時に到着した場合は、**進行中の `inflightRefreshPromise` を共有してネイティブ `clearToken`＋再取得を 1 回のみ実行** し、全待機者へ同一の新トークンを返す。
   - 起動時の並列 `getSession()` 呼び出しも同様に `inflightRestorePromise` を共有して重複ブリッジ呼び出しを防ぐ。
   - 内部に単調増加する `authEpoch` カウンタを持ち、`signOut()` または新規 `signIn()` 実行時にインクリメントする。進行中だった古い `authEpoch` のリフレッシュやサイレント復元が遅れて完了しても、現在のセッション状態を上書き復活させてはならない。
3. **セッション購読の発火タイミング・初期同期・ログアウト時のローカルデータ保護**:
   - `getCachedSession()` は現在メモリ上に保持している `GoogleAuthSession | null` を同期返却する。
   - `subscribeSession(listener)` は **登録時点では同期発火せず、以後のセッション状態変化（`getSession` 復元完了・`signIn`・トークン更新・`AUTH_REQUIRED` 失効・`signOut`）のたびに発火** する（初期値が必要な呼び出し元は `getCachedSession()` または `getSession()` を明示参照することで、登録時の二重 IPC や React 再入更新を防ぐ）。
   - `signOut()` 実行時は OAuth セッション破棄と `updateAccessToken(null)` のみを行い、**IndexedDB 内の `driveSyncRoots`・`readingProgress`・`zipIndexCache` 等は一切削除せず保持する**（同一アカウント再ログイン時の設定消失防止）。

---

## 3. 診断ログのトークン秘匿（Redaction）契約

[diagnosticLogger.ts](../../../src/diagnostics/diagnosticLogger.ts) の `redactSensitiveText` は、既存の `Bearer <token>`・クエリパラメータ・JSON フィールドのマスクに加え、例外メッセージやレスポンス断片に生の Google OAuth アクセストークン（`\bya29\.[A-Za-z0-9\-._~+/]+=*`）が単体で混入した場合も必ず **`[REDACTED]`** へ置換する。いかなる認証・通信エラー時にも平文トークンが診断ログへ残らないことを単体テストで保証する。

---

## 4. Google Drive フォルダ参照クライアント仕様（`src/providers/gdrive/`）

### 4.1 フォルダ URL / ID 入力パーサー（`parseDriveFolderInput`）

ユーザーの貼り付け入力 `raw`（前後空白トリム後）から以下の規則で `folderId` を抽出する純関数を提供する（不一致時は `null`）：

1. **Google Drive フォルダ URL**:
   - `https://drive.google.com/drive/folders/<folderId>` または `https://drive.google.com/drive/u/<num>/folders/<folderId>`（クエリ `?usp=sharing` や末尾 `/`・`#...` 付きも許容）から `<folderId>`（`/^[A-Za-z0-9_-]{3,128}$/`）を抽出する。
   - `https://drive.google.com/open?id=<folderId>` 形式の `id` クエリパラメータも `/^[A-Za-z0-9_-]{3,128}$/` を満たす場合は抽出する。
   - `drive.google.com` 以外のドメイン URL やファイル専用 URL（`/file/d/<id>`）は誤登録防止のため `null` とする。
2. **直接フォルダ ID 文字列**:
   - URL スキームやスラッシュを含まず `/^[A-Za-z0-9_-]{3,128}$/` に一致する文字列はそのまま候補とする。
3. **予約エイリアス `"root"` の拒否（マイドライブ全域混入防止）**:
   - URL 抽出・直接入力のいずれの経路であっても、抽出された識別子が大小文字非区別で `"root"`（`extractedId.toLowerCase() === "root"`）である場合は、`AC-ST-02`（フォルダ選択モーダルでのマイドライブ直下登録禁止）と整合させるため必ず **`null` を返して拒否** する。

### 4.2 `DriveFolderClient` インターフェースと REST API 契約

```ts
export type DriveApiErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "NOT_A_FOLDER"
  | "FOLDER_TRASHED"
  | "RATE_LIMITED"
  | "TOKEN_EXPIRED"
  | "NETWORK_ERROR";

export interface DriveFolderMetadata {
  readonly id: string;
  readonly name: string;
}

export interface DriveFolderPage {
  readonly folders: readonly DriveFolderMetadata[];
  readonly nextPageToken: string | null;
}

export interface DriveFolderClient {
  resolveFolderById(
    folderId: string,
    signal?: AbortSignal,
  ): Promise<DriveFolderMetadata>;
  listChildFolders(
    parentFolderId: string,
    options?: {
      readonly pageToken?: string;
      readonly signal?: AbortSignal;
    },
  ): Promise<DriveFolderPage>;
}
```

1. **共通通信・401 Compare-and-Refresh 透過リトライ・エラーコードマッピング規約（`driveHttpClient.ts`）**:
   - グローバル `CapacitorHttp.enabled: false` を維持し、標準 `fetch` に `Authorization: Bearer <token>` を付与して呼び出す。
   - 初回応答が `401 Unauthorized` の場合は、未読ボディを `response.body?.cancel()` で解放した上で、失敗リクエストで使用した `token` を添えて `authBridge.getValidAccessToken({ forceRefresh: true, failedToken: token })`（Compare-and-Refresh ＋ Single-Flight）を呼び出し、**1 回だけ透過リトライ** する。再試行後も `401` またはトークン取得自体が未認証（`AUTH_REQUIRED` 等）の場合は `DriveApiError("UNAUTHORIZED")` を送出する。
   - 非 2xx 応答・不正レスポンス・通信断時は、トークンを含まない診断ログ（`scope: "gdrive-folder"` または `"gdrive-sync"`）を記録し、以下の決定論的マッピングで `DriveApiError` を送出する（`AbortSignal` 中断時は `AbortError` を非ログでそのまま再送出する）：
     - `401`（リトライ後含む）: `"UNAUTHORIZED"`
     - `429`、またはエラー JSON 内の `reason` に `"rateLimitExceeded"` / `"userRateLimitExceeded"` を含む `403`: `"RATE_LIMITED"`
     - 上記以外の `403`: `"FORBIDDEN"`
     - `404`: `"NOT_FOUND"`
     - `410`（`changes.list` の `startPageToken` 失効）は常に `"TOKEN_EXPIRED"`。また `changes.list` 呼び出し時に明示オプション `treatInvalidPageTokenAsExpired: true` が指定されている場合（`GoogleDriveFolderClient` では `false` 維持）に限り、`400` かつエラー JSON 内の `reason` が `"invalid"` / `"badRequest"` であり、`errors[].location === "pageToken"` または `error.message`（大小非区別）に `"pagetoken"` を含む場合も `"TOKEN_EXPIRED"` へ変換する
     - `5xx`、上記以外の `400`、JSON パース失敗／必須フィールド欠落、またはネットワーク通信断: `"NETWORK_ERROR"`
   - **レート制限指数バックオフ（同期クライアント用オプション）**: `driveHttpClient` に `maxRateLimitRetries`（デフォルト `0`、`GoogleDriveSyncClient` では `3`）・`baseBackoffMs`（デフォルト `500`）・`sleepFn`（UT 注入可能）を設け、`RATE_LIMITED` 応答時に `500ms → 1000ms → 2000ms` の最大 3 回自動リトライを行う（リトライ待機中の `AbortSignal` 発火時は即座に `AbortError` を送出）。
2. **`resolveFolderById(folderId, signal?)`（URL / ID 直接登録時の検証）**:
   - 入力 `folderId.trim().toLowerCase() === "root"` の場合は通信を行わず `DriveApiError("FORBIDDEN")` で拒否する二重ガードを設ける。
   - `GET https://www.googleapis.com/drive/v3/files/${encodeURIComponent(folderId)}?fields=id,name,mimeType,trashed&supportsAllDrives=true` を実行する。
   - `mimeType !== "application/vnd.google-apps.folder"` の場合は `DriveApiError("NOT_A_FOLDER")`、`trashed === true` の場合は `DriveApiError("FOLDER_TRASHED")` を送出し、ZIP ファイルやゴミ箱内フォルダの誤登録を防ぐ。
3. **`listChildFolders(parentFolderId, options?)`（アプリ内フォルダ階層選択モーダル用）**:
   - ルート起点は `"root"`（マイドライブ直下）とする。
   - クエリインジェクション防止のため `parentFolderId` 内の `\` と `'` をエスケープした上で、`q='${escapedParentId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`、`orderBy=name_natural`、`pageSize=100`、`fields=nextPageToken,files(id,name,mimeType,trashed)`、`includeItemsFromAllDrives=true`、`supportsAllDrives=true`（＋ `pageToken` 指定時は付与）で `GET https://www.googleapis.com/drive/v3/files` を実行する。

---

## 5. 指定ルート限定 Drive スキャン ＆ `changes.list` 増分差分同期仕様（`v0.2 [2/4]`）

### 5.1 `DriveSyncClient` ＆ `DriveSyncEngine` インターフェース契約

```ts
export interface DriveSyncFileItem {
  readonly id: string;
  readonly name: string;
  readonly mimeType: string;
  readonly parents: readonly string[];
  /** Drive API の整数バイトサイズ（フォルダ時は null） */
  readonly size: number | null;
  readonly md5Checksum: string | null;
  /** UNIX ms（RFC3339 modifiedTime から変換） */
  readonly modifiedTime: number;
  readonly trashed: boolean;
}

export interface DriveSyncFilesPage {
  readonly files: readonly DriveSyncFileItem[];
  readonly nextPageToken: string | null;
}

export interface DriveChangeItem {
  readonly fileId: string;
  readonly removed: boolean;
  readonly file: DriveSyncFileItem | null;
}

export interface DriveChangesPage {
  readonly changes: readonly DriveChangeItem[];
  readonly nextPageToken: string | null;
  readonly newStartPageToken: string | null;
}

export interface DriveSyncClient {
  getStartPageToken(signal?: AbortSignal): Promise<string>;
  listItemsInParents(
    parentFolderIds: readonly string[],
    options?: {
      readonly pageToken?: string;
      readonly signal?: AbortSignal;
    },
  ): Promise<DriveSyncFilesPage>;
  getFileMetadata(
    fileId: string,
    signal?: AbortSignal,
  ): Promise<DriveSyncFileItem | null>;
  listChanges(
    pageToken: string,
    options?: {
      readonly signal?: AbortSignal;
    },
  ): Promise<DriveChangesPage>;
}

export type DriveSyncMode = "full" | "incremental" | "skipped-no-roots";

export interface DriveSyncResult {
  readonly mode: DriveSyncMode;
  readonly scannedRoots: number;
  readonly upsertedVolumes: number;
  readonly trashedVolumes: number;
  readonly invalidatedZipCaches: number;
  readonly syncedAt: number;
}

export interface DriveSyncOptions {
  readonly forceFullScan?: boolean;
  readonly signal?: AbortSignal;
}

export interface DriveSyncEngine {
  sync(options?: DriveSyncOptions): Promise<DriveSyncResult>;
}
```

### 5.2 REST API クエリ契約（`GoogleDriveSyncClient`）

1. **`getStartPageToken(signal?)`**:
   - `GET https://www.googleapis.com/drive/v3/changes/startPageToken?supportsAllDrives=true` を呼び出し、非空の `startPageToken` を返す。
2. **`listItemsInParents(parentFolderIds, options?)`**:
   - 複数親フォルダ ID（1 バッチ最大 20 件、`escapeDriveQueryValue` でエスケープ）を `('id1' in parents or 'id2' in parents) and trashed = false` として束ね、`pageSize=1000`、`fields=nextPageToken,files(id,name,mimeType,parents,size,md5Checksum,modifiedTime,trashed)`、`includeItemsFromAllDrives=true`、`supportsAllDrives=true` で `GET https://www.googleapis.com/drive/v3/files` を実行する。
   - **JS 側拡張子厳密判定**: Drive 上で `.cbz` が `application/octet-stream` 等になる MIME 揺れを取りこぼさないよう、`files.list` 段階ではフォルダ＋非フォルダ双方を取得し、エンジン側で `mimeType === "application/vnd.google-apps.folder"`（サブフォルダ探索対象）と `/\.(zip|cbz)$/i.test(file.name)`（アーカイブ取り込み対象）を厳密分類する。
3. **`getFileMetadata(fileId, signal?)`**:
   - `GET https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType,parents,size,md5Checksum,modifiedTime,trashed&supportsAllDrives=true` を実行する。`404 NOT_FOUND` 時は `null` を返却し、未知親フォルダ遡り時のアクセス不可・削除済み親を安全にルート外扱いとする。
4. **`listChanges(pageToken, options?)`**:
   - `GET https://www.googleapis.com/drive/v3/changes?pageToken=${encodeURIComponent(pageToken)}&pageSize=1000&includeRemoved=true&includeItemsFromAllDrives=true&supportsAllDrives=true&fields=nextPageToken,newStartPageToken,changes(fileId,removed,file(id,name,mimeType,parents,size,md5Checksum,modifiedTime,trashed))` を実行する。`410 Gone` 等は `DriveApiError("TOKEN_EXPIRED")` へマッピングする。

### 5.3 同期オーケストレーション契約（`DriveSyncEngine`）

1. **排他ロック（直列化）**:
   - 内部 Promise キューにより `sync()` の多重並列呼び出しを直列化し、DB トランザクションと `driveStartPageToken` の競合を防止する。
2. **有効ルート 0 件時の早期リターン**:
   - `DriveSyncRootsRepository.listActive()` から `enabled === 1` の有効ルート群を抽出する。0 件の場合は API 通信および既存 `volumes` の破壊を行わず `{ mode: "skipped-no-roots", ... }` を返す（本棚クエリ側で有効ルート所属のみ表示するため、一時無効化・解除されたルートの既存巻や `coverBlob` は安全に保持される）。
3. **フルスキャン vs. 差分同期の自動切替**:
   - 以下のいずれかに該当する場合は **フルスキャン（`mode: "full"`）** を実行し、それ以外は **`changes.list` 差分同期（`mode: "incremental"`）** を実行する：
     1. `options.forceFullScan === true`
     2. `syncMeta['driveStartPageToken']` が未保存または空
     3. `syncMeta['syncedRootFolderIds']`（JSON 配列）に含まれていない新規追加／再有効化された有効ルートフォルダ ID が存在する
     4. 差分同期中に `DriveApiError("TOKEN_EXPIRED")`（`410` 等）を受信した（自動的にフルスキャンへフォールバック）
4. **フルスキャン（バッチ BFS ＋ スキャン前トークン確保）**:
   - **開始前トークン取得**: スキャン中の変更取りこぼしを防ぐため、**BFS 開始前に `getStartPageToken()` を取得** する。
   - **バッチ BFS 走査**: 有効ルート群を初期キューとし、訪問済みフォルダセット（循環参照ガード）と `folderAncestryMap`（`folderId -> { rootFolderId, folderName, parentFolderId }`）を構築しつつ、最大 20 親 ID バッチ＋`nextPageToken` 全ページで子フォルダと `.zip`/`.cbz` ファイルを収集する（子フォルダがさらにサブフォルダを持つ場合は次段キューへ投入）。
   - **ルート内消失ファイルのゴミ箱化**: 今回のフルスキャン対象となった有効ルート群（`enabledRootIds`）に紐づく既存 `volumes` のうち、スキャン結果に含まれなかった `driveFileId` は Drive 側で削除・ゴミ箱・ルート外移動されたとみなし `isTrashed = 1` に更新する（無効化中ルートの `volumes` には触れない）。
5. **`changes.list` 差分同期（フォルダ変更フルスキャン切替・未知親遡り・無効ルート保護）**:
   - 保存済み `driveStartPageToken` から `nextPageToken` が尽きて `newStartPageToken` が得られるまで全変更イベントを収集する（同一 `fileId` への複数イベントは最新イベントで畳み込み）。
   - **フォルダ単位の変更イベント（子ファイル個別イベント不発対策）**: Google Drive API はフォルダの移動・ゴミ箱化・削除・リネーム時に配下ファイルの個別イベントを発行しないため、① `file?.mimeType === "application/vnd.google-apps.folder"` であり当該フォルダが有効ルート自身・既存 `volumes` の `parentFolderId`・または親遡りで有効ルート配下に帰属する場合、または ② `removed === true` で `fileId` が有効ルート ID または既存 `volumes` の `parentFolderId` に一致する場合は、即座にフルスキャン（`mode: "full"`）へ自動フォールバックして配下全体の整合性を回復する。
   - **削除・ゴミ箱・ルート外移動時の無効化ルート保護**: `removed === true` / `file?.trashed === true` または親遡りで有効ルートへ到達しなかった `.zip`/`.cbz` について `isTrashed = 1` を設定する対象は、**現在有効なルートに所属する既存巻（`enabledRootIds.has(existing.rootFolderId)`）のみ** とする。一時無効化中ルート（`enabled = 0`）に所属する既存 `volumes` には一切触れない。
   - **未知親フォルダ遡りの打ち切り条件**: 有効な `.zip`/`.cbz` の `parents[0]` が有効ルート自身か既知サブフォルダかを確認し、未知の場合は `getFileMetadata(parentId)` で親方向へ最大深度ガード（32 階層・循環防止セット・結果メモ化キャッシュ）付きで遡る。途中の祖先フォルダで **`metadata === null || metadata.trashed === true || metadata.parents.length === 0`** を検出した場合は即座に「有効ルート外」と判定して遡りを打ち切る。有効 `rootFolderId` へ到達すれば取り込み／更新（`isTrashed = 0`）する。
6. **ファイル名パース・LWW `updatedAt` 保護・MD5 キャッシュ無効化・リネーム追従**:
   - 新規ファイルは [filename-parser.md](filename-parser.md) の `parseMangaFilename({ fileName, parentFolderName, isParentSyncRoot })` で解析し、`normalizedTitleKey` で既存 `series`（未削除）へ名寄せ（無ければ UUID v4 で新規作成）して `volumes` へ登録する。`series.metadataLocked === false` かつ新規著者がある場合は `series.authors` へ重複排除マージする。
   - 既存 `volumes`（`driveFileId` 一致）更新時：
     - **LWW タイムスタンプ非汚染**: **`volumes.updatedAt` および `series.updatedAt` は一切変更しない**（新規作成時のみ `addedAt = updatedAt = now`）。
     - **MD5 / サイズ変化時のキャッシュ・表紙無効化**: `prev.md5Checksum !== next.md5Checksum || prev.fileSize !== next.fileSize` の場合、旧キャッシュキー `gdrive:${driveFileId}:${prev.md5Checksum ?? prev.fileSize}` を `ZipIndexCacheRepository.delete()` で即時削除し、`coverBlob = null`, `coverStatus = "pending"`, `coverUpdatedAt = null` へリセットする。
     - **リネーム・サブフォルダ移動時の再パース判定**: `rawFileName` または `parentFolderId` が変化した際、所属シリーズが `metadataLocked === false` かつ巻が未手動編集（`volume.updatedAt === volume.addedAt`）であれば新ファイル名・新親フォルダ名で再パースして `seriesId`・`volumeNumber`・`volumeLabel` を自動追従する。手動ロックまたは手動編集済みの場合は物理情報（`rawFileName`, `parentFolderId`, `rootFolderId`, `fileSize`, `md5Checksum`, `driveModifiedTime`, `isTrashed`）のみ更新する。
7. **トークン・`syncedRootFolderIds` 更新の原子性（途中失敗保護）**:
   - ページネーション途中での通信エラー・`RATE_LIMITED` 上限超過・`AbortError` 発生時は `driveStartPageToken` を一切更新しない。
   - 全 API ページ取得および `series` / `volumes` の Dexie 反映が完了した後にのみ、`driveStartPageToken`・`lastDriveSyncAt`・`syncedRootFolderIds`（**同期完了時点の有効ルート ID 配列 `[...enabledRootIds].sort()` で上書き保存**。一時無効化中に別ルートで同期が走った後、再有効化すると不一致を検知して自動的にフルスキャンが起動する）を単一トランザクションで `syncMeta` へ原子保存する。

---

## 6. 受け入れ条件（`AC-GD-xx`）

|   AC ID    | 受け入れ条件                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| :--------: | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AC-GD-01` | Android ネイティブ環境では `GoogleAuthPlugin.java`（`drive.readonly` スコープ単独）により同意画面認可（既認可時の即時成功分岐・`getAuthorizationResultFromIntent` 含む）・起動時サイレント復元（オフライン時の `SharedPreferences` 保護含む）・`@Nullable` 安全なメールアドレス取得（`drive/v3/about` 補完含む）・`clearToken`＋`revoke` サインアウトが動作する。                                                                                           |
| `AC-GD-02` | Web / Vitest / Storybook / Playwright IT 環境では外部認証設定なしで `MockGoogleAuthAdapter` へ自動フォールバックし、全ビルド・テストが 100% ゼロコンフィグで動作する（`NFR-05`）。                                                                                                                                                                                                                                                                          |
| `AC-GD-03` | `GoogleAuthTokenManager` はトークン残り有効期限 5 分未満または `forceRefresh: true` 時に並列呼び出しを Single-Flight Promise で 1 回の更新に集約し、かつ時差 `401` 到着時は `failedToken` 比較（Compare-and-Refresh）により新トークンの二重 `clearToken` を防止し、`authEpoch` によりサインアウト後の古い更新結果による状態逆転を遮断する。                                                                                                                 |
| `AC-GD-04` | `getCachedSession()` 同期参照および変化時発火の `subscribeSession` を通じて `CoordinatorWorkerApi.updateAccessToken` へ最新トークン（サインアウト時は `null`）が配信され、サインアウト時も IndexedDB の `driveSyncRoots`・`readingProgress` は削除されず保持される。                                                                                                                                                                                        |
| `AC-GD-05` | `redactSensitiveText` は `Bearer <token>`・クエリ/JSON 機密キーに加え、単体の `ya29.*` Google アクセストークンもすべて `[REDACTED]` へマスクする。                                                                                                                                                                                                                                                                                                          |
| `AC-GD-06` | `parseDriveFolderInput` は Google Drive フォルダ URL（`/drive/folders/<ID>`, `/drive/u/<N>/folders/<ID>`, `/open?id=<ID>`）および直接フォルダ ID を正規化抽出し、予約語 `"root"`（大小文字非区別、直接入力・URL 双方）・非フォルダ URL（`/file/d/...`）・不正文字列をすべて拒否（`null`）する。                                                                                                                                                             |
| `AC-GD-07` | `GoogleDriveFolderClient` は `resolveFolderById` で非フォルダ（`NOT_A_FOLDER`）・ゴミ箱済み（`FOLDER_TRASHED`）・存在しない ID（`NOT_FOUND`）・レート制限（`RATE_LIMITED`）等を決定論的に検証拒否し、`listChildFolders` でサブフォルダ一覧と `nextPageToken` を取得でき、`401` 時は `failedToken` 付き Single-Flight 更新後に 1 回透過リトライする。                                                                                                        |
| `AC-GD-08` | `src/bridges/oauth/` および `src/providers/gdrive/` の全純粋 TypeScript モジュール（`types.ts` 除く）が実通信ゼロのフィクスチャ／モック単体テストで C0/C1/Functions/Lines 100% を PASS する。                                                                                                                                                                                                                                                               |
| `AC-GD-09` | `DriveSyncEngine` は `enabled === 1 && deletedAt === null` の `driveSyncRoots` 配下（多段サブフォルダ含む）にある `.zip` / `.cbz` のみをバッチ BFS で取り込み、対象外フォルダの ZIP や非アーカイブファイルを除外する。有効ルート 0 件時は API 通信を行わず既存データを保護する。                                                                                                                                                                            |
| `AC-GD-10` | `DriveSyncEngine` はフルスキャン開始前に取得した `startPageToken` を全ページ取得・DB 反映完了後にのみ `syncMeta` へ保存（`syncedRootFolderIds` は有効ルート配列で上書き）し、2 回目以降は `changes.list` で増分差分同期（未知親フォルダ遡り判定［ゴミ箱祖先で即打切り］・移動追従・有効ルート所属巻のみの `isTrashed = 1` 更新［無効化中ルート保護］・フォルダ単位変更や `410 TOKEN_EXPIRED`・新規/再有効化ルート検出時の自動フルスキャン切替）を実行する。 |
| `AC-GD-11` | 同一 `driveFileId` の `md5Checksum` または `fileSize` が変化した場合、旧キーの `zipIndexCache` を即時削除し `coverBlob = null` / `coverStatus = "pending"` / `coverUpdatedAt = null` へリセットする。また同期処理全体を通じて既存 `series.updatedAt` / `volumes.updatedAt` を一切変更しない（LWW 非汚染）。                                                                                                                                                 |
| `AC-GD-12` | Drive 上でのリネーム・サブフォルダ移動時、未手動編集（`series.metadataLocked === false && volume.updatedAt === volume.addedAt`）ならファイル名パーサー再実行で `seriesId`・巻数を自動追従し、手動ロック／編集済みの場合は物理属性のみ更新する。                                                                                                                                                                                                             |
| `AC-GD-13` | `GoogleDriveSyncClient` は `429` および `403 (rateLimitExceeded / userRateLimitExceeded)` 時に最大 3 回の指数バックオフリトライを行い、`DriveSyncEngine` は内部排他ロックで多重同期呼び出しを直列化し、途中失敗・`AbortError` 時は `driveStartPageToken` を一切進めない。                                                                                                                                                                                   |
| `AC-GD-14` | Web / Vitest / Playwright IT 環境では `MockDriveSyncClient` へ自動フォールバックし、実ネットワークなしでフルスキャン・差分同期・ルート切替・リネーム・MD5 更新の一貫動作を検証できる（`NFR-05`）。                                                                                                                                                                                                                                                          |
