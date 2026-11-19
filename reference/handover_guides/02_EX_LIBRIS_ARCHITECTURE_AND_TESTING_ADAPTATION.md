# 02. ExLibris 向け技術・テストアーキテクチャ適応ガイド（Yommy からの変更点）

Yommy（Web 小説リーダー：HTML パース ＋ SQLite ＋ 縦書き DOM）から **ExLibris（自炊マンガビューア：HTTP Range ZIP/ZIP64 ストリーミング ＋ Web Workers ＋ Dexie.js ＋ 生 WebGL2）** へ移行するにあたり、**そのまま流用すると罠になる設定** と **新しく構築すべき TDD ハーネス設計** を具体的にまとめます。

---

## 1. Yommy ⇔ ExLibris アーキテクチャ対比早見表

| 領域 | Yommy（旧・小説リーダー） | ExLibris（新・自炊マンガストリーミング） | 移行時の重要ポイント |
| :--- | :--- | :--- | :--- |
| **HTTP / 通信層** | `CapacitorHttp.enabled: true` で全 `fetch` をネイティブ化（HTML テキスト取得の CORS 回避） | **`CapacitorHttp.enabled: false` 必須**。ストリーミングは標準 `fetch`（`ArrayBuffer`）、書誌 API のみ明示的 `CapacitorHttp.request()` | **最重要の罠**（§2.1 参照）。`true` にするとバイナリが Base64 化され Zero-Copy が崩壊する |
| **Google OAuth & Drive** | `CloudSyncPlugin.java`（`drive.appdata` スコープのみ、ネイティブ側で JSON 同期通信） | `drive.readonly` ＋ `drive.appdata` の **2 スコープ要求**。ネイティブはトークン発行・更新を担い、データ通信は Worker `fetch` が直接実行 | `CloudSyncPlugin.java` の `AuthorizationClient` / 401 `clearToken` 実装をベースに拡張（§2.2 参照） |
| **ローカル DB** | `@capacitor-community/sqlite` ＋ SQL.js インメモリ切替 | **Dexie.js（IndexedDB）** ＋ テスト時 `fake-indexeddb` | ネイティブ SQLite プラグイン不要になり Web / Android 完全同一コードで動作（§3.3 参照） |
| **コア解析・スレッド** | メインスレッド HTML DOM パーサー（`DOMParser`） | **Coordinator Worker + Decode Worker Pool (×2)** + Comlink + Transferable `ImageBitmap` | `*.worker.ts` から純粋クラス `*Core.ts` を分離して Vitest C0/C1 100% を維持（§3.2 参照） |
| **描画レイヤー** | React DOM（CSS `writing-mode: vertical-rl` + `<ruby>`） | **生 WebGL2**（Mipmap + LOD/アンシャープ + レベル/ガンマ補正シェーダー + `MAX_TEXTURE_SIZE` ガード） | UT はモック `WebGL2RenderingContext`、VRT/IT は Chromium SwiftShader WebGL2 で検証（§3.4 参照） |
| **テストフィクスチャ** | 静的 HTML ファイル（`__fixtures__/*.html`） | **決定論的バイナリ ZIP 生成ヘルパー**（標準 ZIP / ZIP64 / LFH Extra 差分 / Data Descriptor / CP932 ファイル名） | 巨大バイナリを Git にコミットせず、数 KB の合成バッファで全 7 つの落とし穴を 100% 網羅（§3.1 参照） |

---

## 2. Capacitor / Android ブリッジの重要設計変更

### 2.1 【最重要】`capacitor.config.ts` で `CapacitorHttp` グローバルフックを無効化する理由

Yommy の `03_yommy_reference_files/android_and_bridges/capacitor.config.ts` では `CapacitorHttp: { enabled: true }` を使用していましたが、**ExLibris では必ず `enabled: false`（または未指定）にします**。

- **理由**: `enabled: true` にすると Capacitor が `window.fetch` をモンキーパッチし、すべてのレスポンスを Android Java 側で受信 → **Base64 文字列へエンコード** → JS ブリッジ経由でシリアライズ転送します。1 チャンク 8〜12MB の画像バイナリでこれを行うと CPU・メモリ・レイテンシが劇的に悪化し、さらに Web Worker 内の `fetch` 挙動とも乖離します。
- **正しい構成**:
  1. **Google Drive Range ストリーミング / Drive REST API / 自宅 HTTP Range**:
     Google Drive API（`www.googleapis.com`）は標準で CORS（`Access-Control-Allow-Origin: *` + `Range` ヘッダー許可）に対応しているため、Coordinator Worker 内のネイティブ Chromium `fetch` に `Authorization: Bearer <accessToken>` を付与して直接 `ArrayBuffer` を受け取ります。
  2. **CORS 制限のある公開書誌 API（NDL サーチ XML、楽天ブックス等）**:
     `CapacitorHttp` クラス自体は `enabled: false` でも `@capacitor/core` から直接インポートして `CapacitorHttp.request({ url, method, params })` を呼べます（`03_yommy_reference_files/android_and_bridges/bridges/http/capacitorHttpClient.ts` 参照）。これを `MetadataHttpClient` アダプタ内に閉じ込めます。

### 2.2 Google OAuth プラグイン（`CloudSyncPlugin.java` 流用時の改修ポイント）

`03_yommy_reference_files/android_and_bridges/android/CloudSyncPlugin.java` には、すでに以下の貴重な実機ノウハウが実装されています。
- Play Services Identity `AuthorizationClient` による認証と、`hasResolution()` 時の `StartIntentSenderForResult` 同意画面遷移（`saveCall(call)` パターン）
- トークン失効（401）時の `Identity.getAuthorizationClient(context).clearToken(...)` からの自動再取得
- Android `HttpURLConnection` が `PATCH` メソッドを拒否する問題への `POST` + `X-HTTP-Method-Override: PATCH` 回避策（将来の `appDataFolder` バックアップ更新時にそのまま有効）

**ExLibris での拡張方法**:
1. スコープ定数を `DriveScopes.DRIVE_READONLY`（`https://www.googleapis.com/auth/drive.readonly`）と `DriveScopes.DRIVE_APPDATA`（`https://www.googleapis.com/auth/drive.appdata`）の 2 つに拡張する。
2. JS / Worker 側へアクセストークンを渡す `@PluginMethod public void getAccessToken(PluginCall call)` と、401 検知時に強制クリアして再取得する `@PluginMethod public void refreshAccessToken(PluginCall call)` を公開する。
3. TypeScript 側の `TokenManager` で **Single-Flight リフレッシュ**（同時多発した 401 に対しネイティブ呼び出しを 1 つの Promise に束ねる制御）を実装する。

---

## 3. ExLibris 特有の 4 層 TDD・100% カバレッジ実現パターン

### 3.1 合成バイナリ ZIP フィクスチャビルダー（`src/engine/zip/__fixtures__/zipBuilder.ts`）
数 GB の実ファイルを使わずに `ex_libris_concept.md` §3.2 の「7 つの技術的落とし穴」をミリ秒で単体テストするため、テスト用の軽量バイナリビルダーを最初に作成します。

- **単体テストで必ず再現・検証するケース**:
  1. **LFH 可変長罠**: CDH の `extraFieldLength = 0` だが、LFH 側に 64 バイトの Extra Field が入っている ZIP（1 RTT マージン `+1024B` 切り出しの検証）。
  2. **Data Descriptor 罠**: General Purpose Bit 3 が立ち、LFH 内の `compressedSize` が `0` になっている ZIP（CDH 側の `compressedSize` 優先参照の検証）。
  3. **物理オフセット逆転・ギャップ罠**: `001.jpg` の物理位置がファイル末尾、`002.jpg` が先頭にある ZIP や、間に 200KB のゴミエントリがある ZIP（バイト予算アグリゲーションの分割判定検証）。
  4. **ZIP64 境界テスト**: ファイルサイズ仮想値 `> 4GB`（`0x1_0000_0000` 以上のオフセットを `MockSparseRangeReader` でシミュレート！実メモリは数十 KB のみ確保）＋ `0x0001` Extra Field の部分飽和パターン（LFH オフセットのみ `0xFFFFFFFF` で圧縮サイズは 32bit 収まりのケース等）。
  5. **末尾 128KB 溢れフォールバック**: CD サイズが 150KB ある ZIP で、1 回目 128KB 取得 → 不足先頭 22KB の追加 1 RTT 取得で結合パースされることの検証。
  6. **文字コード＆ゴミ除外**: Bit 11 未設定 UTF-8 と Shift_JIS（CP932：`①`・`髙`・`〜` 等）の自動判別、`__MACOSX/`・`._*`・`Thumbs.db` 除外、`p2.jpg` → `p10.jpg` 自然順ソート。

> [!TIP]
> **`MockSparseRangeReader` の活用**:
> `totalSize = 6_000_000_000`（6GB）を返し、要求された `[offset, offset + length)` 区間だけをオンデマンドで合成バイト列から返すモック `RandomAccessReader` を作れば、メモリを一切食わずに 6GB 合本 ZIP64 の全分岐を 5ms で C0/C1 100% テストできます。

### 3.2 Web Worker × Comlink の 100% カバレッジ分離構造
Vitest（Node / Happy-DOM / JSDOM）上で Worker スレッドをそのまま起動すると、カバレッジ計測（v8 / istanbul）が効きにくくなります。以下の **Core / Entry 分離規約** を徹底します。

- `src/engine/workers/CoordinatorCore.ts`:
  純粋な TypeScript クラス。依存（`RandomAccessReaderFactory`, `DecodeDispatcher`, `ZipIndexRepository`）をコンストラクタ注入し、Vitest から直接インスタンス化して C0/C1/Functions 100% を検証する。
- `src/engine/workers/coordinator.worker.ts`:
  `Comlink.expose(new CoordinatorCore(...))` だけを行う 10 行程度のエントリファイル（`vite.config.ts` の `coverage.exclude` 対象として明示承認、動作は Playwright IT で E2E 保証）。
- `ImageBitmap` の扱い:
  単体テストでは軽量な `FakeImageBitmap`（`width`, `height`, `closed: boolean`, `close: vi.fn()`）を注入し、**L1 キャッシュのウィンドウ（`N-1`〜`N+2`）から外れた瞬間、および古い Epoch のデコード結果が到着した瞬間に `bitmap.close()` が 1 回ずつ確実に呼ばれること** をスパイで厳密アサートする。

### 3.3 Dexie.js × `fake-indexeddb` の決定論的テスト初期化
```ts
// test/setup/dexieTestSetup.ts のイメージ
import "fake-indexeddb/auto";
import { db } from "@/storage/db";

export async function resetTestDb(): Promise<void> {
  await db.delete();
  await db.open();
}
```
- UT の `beforeEach`、Storybook の `beforeEach` / `loaders`、Playwright IT の初期化フックすべてで同じシード投入ヘルパーを使い、テスト間の状態汚染をゼロにします。

### 3.4 生 WebGL2 の 2 段階テスト戦略（UT ＆ SwiftShader VRT/IT）
1. **Unit Test（Vitest）**:
   - シェーダーコンパイル・テクスチャアップロード・Mipmap 生成・Uniform 更新・`MAX_TEXTURE_SIZE` 分割計算を担う `WebGLRendererCore.ts` を React コンポーネントから分離する。
   - モック `WebGL2RenderingContext` を注入し、`gl.getParameter(gl.MAX_TEXTURE_SIZE)` が `4096` を返した際に 6000×4200px の見開き画像が自動的に左右分割テクスチャ（または安全縮小）ルートへ分岐すること、コンテキストロスト（`webglcontextlost`）やアンマウント時に `gl.deleteTexture` / `gl.deleteProgram` が呼ばれることを 100% 検証する。
2. **VRT / Playwright IT（Chromium Headless + SwiftShader）**:
   - Linux コンテナ（GPU なし CI 環境）でも決定論的に生 WebGL2 シェーダーを描画できるよう、`playwright.vrt.config.ts` と `playwright.it.config.ts` の `launchOptions.args` に以下を指定する。
     ```ts
     launchOptions: {
       args: [
         "--use-gl=angle",
         "--use-angle=swiftshader",
         "--enable-unsafe-swiftshader",
         "--font-render-hinting=none",
       ],
     }
     ```
   - これにより、Mipmap モアレ除去・白黒レベル補正シェーダー・見開きレイアウト・「1ページずらし」補正の実際のピクセル描画結果を 1280px（タブレット横）と 375px（スマホ縦）の VRT スナップショットで回帰保証できる。

---

## 4. 新リポジトリ立ち上げ時の推奨パッケージ構成（`package.json` 差分指針）

`03_yommy_reference_files/configs/package.json` をベースに、以下を入れ替えます。

- **削除する Yommy 固有パッケージ**:
  - `@capacitor-community/sqlite`, `jeep-sqlite`, `sql.js`（Dexie.js に置換するため不要）
- **追加する ExLibris 用パッケージ**:
  - **Runtime (`dependencies`)**:
    - `dexie`（IndexedDB ラッパー）
    - `comlink`（Web Worker RPC + `Comlink.transfer()`）
    - `zustand`（軽量状態管理：リーダー描画設定・同期進捗等）
    - `fflate`（`DecompressionStream('deflate-raw')` 未対応環境や同期小チャンク解凍フォールバック用）
  - **Dev / Test (`devDependencies`)**:
    - `fake-indexeddb`（Vitest 上での高速・決定論的 IndexedDB 実行用）
