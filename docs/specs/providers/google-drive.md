---
type: spec-provider
title: "Google OAuth（Single-Flight）＆ Google Drive フォルダ参照プロバイダ仕様書"
description: "Android ネイティブ GoogleAuthPlugin（Play Services Identity API）・Web モック自動フォールバック、Single-Flight トークン管理、機密マスク、および Drive ルートフォルダ参照クライアントの正本"
status: "Review (#23)"
updated: "2026-11-23"
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
  - docs/guidelines/testing.md
related_tests:
  - scripts/android-build-config.test.ts
  - src/app/ServiceProvider.test.tsx
  - src/diagnostics/diagnosticLogger.test.ts
---

# Google OAuth（Single-Flight）＆ Google Drive フォルダ参照プロバイダ仕様書

本ドキュメントは、ExLibris における Google OAuth 認証ブリッジ（`src/bridges/oauth/`、Android ネイティブ `GoogleAuthPlugin.java` ＆ Web モック自動フォールバック）、Single-Flight トークン更新マネージャ、診断ログ機密マスク規約、および Google Drive フォルダ階層・メタデータ参照クライアント（`src/providers/gdrive/`）の正本（Single Source of Truth）です。

> [!NOTE]
> 指定ルートフォルダ配下の `.zip` / `.cbz` 一括スキャンおよび `changes.list` 増分差分同期エンジンの仕様は `Issue #24`（`[v0.2][2/4]`）着手時に本仕様書へ拡張追記します。

---

## 1. モジュール構成と責務分離

| モジュールパス                                                          |      レイヤー      | 責務                                                                                                                                 |
| :---------------------------------------------------------------------- | :----------------: | :----------------------------------------------------------------------------------------------------------------------------------- |
| `android/app/src/main/java/com/highsoar/exlibris/GoogleAuthPlugin.java` |  Native (Android)  | Google Play Services Identity API（`AuthorizationClient`）を用いた認可・同意画面遷移・サイレント復元・`clearToken`・トークン失効処理 |
| `src/bridges/oauth/types.ts`                                            |  Layer 4 (Bridge)  | `GoogleAuthSession`, `GoogleAuthBridge`, `GoogleAuthAdapter`, `GoogleAuthErrorCode` 等の純粋型定義                                   |
| `src/bridges/oauth/googleAuthErrors.ts`                                 |  Layer 4 (Bridge)  | 型付き認証エラー `GoogleAuthError`（`AUTH_CANCELLED` / `AUTH_REQUIRED` / `AUTH_NETWORK_ERROR` / `AUTH_FAILED`）                      |
| `src/bridges/oauth/capacitorGoogleAuthAdapter.ts`                       |  Layer 4 (Bridge)  | Capacitor `registerPlugin("GoogleAuthPlugin")` を呼び出す薄いネイティブアダプタ                                                      |
| `src/bridges/oauth/mockGoogleAuthAdapter.ts`                            |  Layer 4 (Bridge)  | Web / Vitest / Storybook / Playwright IT 用のゼロコンフィグ決定論的モックアダプタ（`NFR-05`）                                        |
| `src/bridges/oauth/googleAuthTokenManager.ts`                           |  Layer 4 (Bridge)  | `GoogleAuthBridge` 実装。有効期限5分前判定・Single-Flight Promise 共有・`authEpoch` 世代保護・セッション購読配信                     |
| `src/providers/gdrive/types.ts`                                         | Layer 1 (Provider) | `DriveFolderMetadata`, `DriveFolderPage`, `DriveFolderClient`, `DriveApiErrorCode` 等の純粋型定義                                    |
| `src/providers/gdrive/driveFolderInput.ts`                              | Layer 1 (Provider) | Google Drive フォルダ URL / フォルダ ID 文字列の正規化・抽出純関数（`parseDriveFolderInput`）                                        |
| `src/providers/gdrive/googleDriveFolderClient.ts`                       | Layer 1 (Provider) | 標準 `fetch` + Single-Flight トークンによる `files.get` / `files.list` フォルダ参照実装（401 1回透過リトライ付き）                   |
| `src/providers/gdrive/mockDriveFolderClient.ts`                         | Layer 1 (Provider) | Web / Storybook / Playwright IT 向けのインメモリ決定論的フォルダ階層モック実装                                                       |

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
   - `load()` で `ActivityResultContracts.StartIntentSenderForResult` ランチャーを登録し、同意画面遷移時は `pendingSignInCall` 二重起動ガードとともに `saveCall(call)` / `getSavedCall()` / `freeSavedCall()` で `PluginCall` を確実に保持・解放する。
   - `handleOnDestroy()` でワーカースレッド（`ExecutorService`）の `shutdownNow()` および揮発状態リセットを行う。
2. **提供するネイティブメソッド**:
   - `restoreSession()`:
     - `SharedPreferences`（`"exlibris_google_auth"`: `is_linked`, `email`）を確認し、`is_linked == false` の場合は同意画面を出さず `{ status: "unlinked" }` を返す。
     - `is_linked == true` の場合は `Identity.getAuthorizationClient(activity).authorize(request)` を呼び、`!result.hasResolution()` であればアクセストークンとメールアドレス（下記補完ルール適用）を含む `{ status: "connected", accessToken, email }` を返す。`result.hasResolution() == true`（権限取消済み等）の場合は `SharedPreferences` をクリアして `{ status: "unlinked" }` を返す。
   - `signIn()`:
     - 既に進行中の `signIn` がある場合は競合エラーを返す。
     - `authorize(request)` で `result.hasResolution() == true` の場合は `PendingIntent` を起動してユーザーの同意操作を待ち、`RESULT_CANCELED` 時は `{ status: "cancelled" }`、同意成功時は `{ status: "connected", accessToken, email }` を解決して `SharedPreferences` に保存する。
   - `refreshAccessToken({ previousToken, clearCache })`:
     - `clearCache == true` かつ `previousToken` が非空の場合、**必ず先に `Identity.getAuthorizationClient(activity).clearToken(ClearTokenRequest)` を実行** して GMS ローカルキャッシュの失効トークンを破棄してから `authorize(request)` を再実行する。
     - `!result.hasResolution()` なら新トークンを返し、`result.hasResolution() == true` なら連携状態をクリアして `"AUTH_REQUIRED"` エラーで reject する。
   - `signOut({ previousToken })`:
     - `SharedPreferences` の連携状態とメモリ上のトークン・メールアドレスを即時クリアした上で、バックグラウンドで `clearToken` および `https://oauth2.googleapis.com/revoke` へのベストエフォート `POST`（`application/x-www-form-urlencoded` ボディ `token=...`、URL クエリへのトークン露出禁止、タイムアウト 5 秒、オフライン失敗時も非致命で `resolve`）を実行する。
3. **メールアドレス取得と `drive/v3/about` フォールバック**:
   - `drive.readonly` 単独スコープでは端末・GMS バージョンにより `result.toGoogleSignInAccount().getEmail()` が `null` を返す場合があるため、未取得かつ `SharedPreferences` にも保存がない場合は、取得した `accessToken` を用いて `GET https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)`（タイムアウト 10 秒）を 1 回呼び出して `user.emailAddress` を補完・永続化する（それも取得不能な極端な制限環境では `"Google Drive 連携済み"` 表示用フォールバック文字列を許容しログイン自体は失敗させない）。

### 2.3 Single-Flight `GoogleAuthTokenManager`（`GoogleAuthBridge` 実装）契約

```ts
export interface GoogleAuthSession {
  readonly email: string;
  readonly accessToken: string;
  /** UNIX ms（ネイティブ取得時は now + 3_600_000） */
  readonly expiresAt: number;
}

export type AuthSessionListener = (session: GoogleAuthSession | null) => void;

export interface GoogleAuthBridge {
  getSession(): Promise<GoogleAuthSession | null>;
  signIn(): Promise<GoogleAuthSession>;
  signOut(): Promise<void>;
  getValidAccessToken(options?: {
    readonly forceRefresh?: boolean;
  }): Promise<string>;
  subscribeSession(listener: AuthSessionListener): () => void;
}
```

1. **有効期限推定と 5 分前プロアクティブ更新**:
   - GMS `AuthorizationResult` は残り有効秒数を返さないため、トークン取得・更新時刻 `now` に対して `TOKEN_DEFAULT_TTL_MS = 3_600_000`（60 分）を設定し、`TOKEN_EARLY_REFRESH_MARGIN_MS = 300_000`（残り **5 分未満**、すなわち取得から 55 分経過時点）で期限間近と判定する。
   - `getValidAccessToken({ forceRefresh })` 呼び出し時、`forceRefresh !== true` かつ保持中の `session` が `session.expiresAt - now >= TOKEN_EARLY_REFRESH_MARGIN_MS` を満たす場合は通信なしで即座に `session.accessToken` を返す。
2. **Single-Flight Promise 共有と `authEpoch` 世代ガード**:
   - `forceRefresh === true`、または残り有効期限が 5 分未満、または初回未復元状態で複数の呼び出し（Fast-Path・Warm Prefetch・フォルダ取得等）が同時に到着した場合、**進行中の `inflightRefreshPromise` を共有してネイティブ `clearToken`＋再取得を 1 回のみ実行** し、全待機者へ同一の新トークンを返す。
   - 起動時の並列 `getSession()` 呼び出しも同様に `inflightRestorePromise` を共有して重複ブリッジ呼び出しを防ぐ。
   - 内部に単調増加する `authEpoch` カウンタを持ち、`signOut()` または新規 `signIn()` 実行時にインクリメントする。進行中だった古い `authEpoch` のリフレッシュやサイレント復元が遅れて完了しても、現在のセッション状態を上書き復活させてはならない。
3. **セッション購読配信とログアウト時のローカルデータ保護**:
   - セッションが変化（`getSession` 復元・`signIn`・トークン更新・`AUTH_REQUIRED` 失効・`signOut`）するたびに `subscribeSession` リスナーへ最新 `GoogleAuthSession | null` を通知し、`ServiceProvider` / `coordinatorClient` 経由で稼働中 `CoordinatorWorkerApi.updateAccessToken(session?.accessToken ?? null)` へ自動配信する。
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
   - URL スキームやスラッシュを含まず `/^[A-Za-z0-9_-]{3,128}$/` に一致する文字列はそのまま `folderId` として返す。

### 4.2 `DriveFolderClient` インターフェースと REST API 契約

```ts
export type DriveApiErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "NOT_A_FOLDER"
  | "FOLDER_TRASHED"
  | "RATE_LIMITED"
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

1. **共通通信・401 透過リトライ規約**:
   - グローバル `CapacitorHttp.enabled: false` を維持し、標準 `fetch` に `Authorization: Bearer <token>` を付与して呼び出す。
   - 初回応答が `401 Unauthorized` の場合は `authBridge.getValidAccessToken({ forceRefresh: true })`（Single-Flight）でトークンを更新し、**1 回だけ透過リトライ** する。再試行後も `401` またはトークン取得自体が未認証の場合は `DriveApiError("UNAUTHORIZED")` を送出する。
   - `403`（レート制限含む）・`404`・`429`・`5xx`・通信断時は、トークンを含まない診断ログ（`scope: "gdrive-folder"`）を記録し、対応する `DriveApiErrorCode` を持つ `DriveApiError` を送出する。`AbortSignal` 中断時は `AbortError` をそのまま再送出する。
2. **`resolveFolderById(folderId, signal?)`（URL / ID 直接登録時の検証）**:
   - `GET https://www.googleapis.com/drive/v3/files/${encodeURIComponent(folderId)}?fields=id,name,mimeType,trashed&supportsAllDrives=true` を実行する。
   - `mimeType !== "application/vnd.google-apps.folder"` の場合は `DriveApiError("NOT_A_FOLDER")`、`trashed === true` の場合は `DriveApiError("FOLDER_TRASHED")` を送出し、ZIP ファイルやゴミ箱内フォルダの誤登録を防ぐ。
3. **`listChildFolders(parentFolderId, options?)`（アプリ内フォルダ階層選択モーダル用）**:
   - ルート起点は `"root"`（マイドライブ直下）とする。
   - クエリインジェクション防止のため `parentFolderId` 内の `\` と `'` をエスケープした上で、`q='${escapedParentId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`、`orderBy=name_natural`、`pageSize=100`、`fields=nextPageToken,files(id,name,mimeType,trashed)`、`includeItemsFromAllDrives=true`、`supportsAllDrives=true`（＋ `pageToken` 指定時は付与）で `GET https://www.googleapis.com/drive/v3/files` を実行する。

---

## 5. 受け入れ条件（`AC-GD-xx`）

|   AC ID    | 受け入れ条件                                                                                                                                                                                                                                                                                                |
| :--------: | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AC-GD-01` | Android ネイティブ環境では `GoogleAuthPlugin.java`（`drive.readonly` スコープ単独）により同意画面認可・`SharedPreferences` 連携状態からの起動時サイレント復元・メールアドレス表示（`drive/v3/about` 補完含む）・`clearToken`＋ベストエフォート `revoke` によるサインアウトが動作する。                      |
| `AC-GD-02` | Web / Vitest / Storybook / Playwright IT 環境では外部認証設定なしで `MockGoogleAuthAdapter` へ自動フォールバックし、全ビルド・テストが 100% ゼロコンフィグで動作する（`NFR-05`）。                                                                                                                          |
| `AC-GD-03` | `GoogleAuthTokenManager` はトークン残り有効期限 5 分未満または `forceRefresh: true` 時に、複数の並列呼び出しを Single-Flight Promise で 1 回の更新に集約し、`authEpoch` によりサインアウト後の古い更新結果による状態逆転を防止する。                                                                        |
| `AC-GD-04` | セッション変化時に `subscribeSession` を通じて `CoordinatorWorkerApi.updateAccessToken` へ最新トークン（サインアウト時は `null`）が自動配信され、サインアウト時も IndexedDB の `driveSyncRoots`・`readingProgress` は削除されず保持される。                                                                 |
| `AC-GD-05` | `redactSensitiveText` は `Bearer <token>`・クエリ/JSON 機密キーに加え、単体の `ya29.*` Google アクセストークンもすべて `[REDACTED]` へマスクする。                                                                                                                                                          |
| `AC-GD-06` | `parseDriveFolderInput` は Google Drive フォルダ URL（`/drive/folders/<ID>`, `/drive/u/<N>/folders/<ID>`, `/open?id=<ID>`）および直接フォルダ ID を正規化抽出し、非フォルダ URL（`/file/d/...`）や不正文字列を拒否する。                                                                                    |
| `AC-GD-07` | `GoogleDriveFolderClient` は `resolveFolderById` で非フォルダ（`NOT_A_FOLDER`）・ゴミ箱済み（`FOLDER_TRASHED`）・存在しない ID（`NOT_FOUND`）を検証拒否し、`listChildFolders` で指定親フォルダ配下のサブフォルダ一覧と `nextPageToken` を取得でき、`401` 時は Single-Flight 更新後に 1 回透過リトライする。 |
| `AC-GD-08` | `src/bridges/oauth/` および `src/providers/gdrive/` の全純粋 TypeScript モジュール（`types.ts` 除く）が実通信ゼロのフィクスチャ／モック単体テストで C0/C1/Functions/Lines 100% を PASS する。                                                                                                               |
