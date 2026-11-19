# Yommy (`v1.2.0`) 厳選リファレンス実装・設定ファイル一覧

本ディレクトリ（`03_yommy_reference_files/`）には、Yommy リポジトリから **ExLibris の立ち上げ・実装時に直接手本（リファレンス）として参照・部分流用できる設定ファイル、Capacitor/Android ネイティブ実装、および設計・非同期制御パターン** を厳選して収録しています。

> [!WARNING]
> これらは「Yommy での実績コード（参考資料）」です。そのまま丸ごと上書きコピーするのではなく、`../01_handover_guides/02_EX_LIBRIS_ARCHITECTURE_AND_TESTING_ADAPTATION.md` の注意事項（特に **`CapacitorHttp.enabled: false`** や **SQLite → Dexie.js 置換**）を踏まえて必要な部分を取り込んでください。

---

## 1. `configs/` — ビルド・テスト・VRT・CI スクリプト参考一式

| ファイルパス | 参考ポイント・ExLibris での流用方法 |
| :--- | :--- |
| `package.json` | Vite + React 19 + Vitest + Storybook + Playwright VRT/IT + ESLint/Prettier のスクリプト体系とバージョン組み合わせの基準。`@capacitor-community/sqlite` 系を外し、`dexie`, `comlink`, `zustand`, `fflate`, `fake-indexeddb` を追加して使う。 |
| `vite.config.ts` | `@` エイリアス、Vitest の `coverage` 設定（`thresholds: { lines: 100, branches: 100, functions: 100, statements: 100 }`）および除外対象（`*.stories.tsx`, `types.ts`, 薄いエントリポイント）の実績構成。 |
| `tsconfig.json` / `tsconfig.app.json` / `tsconfig.node.json` | Strict TypeScript 設定一式。Web Worker 用に `WebWorker` lib の併用または `tsconfig.worker.json` 分離時のベースになる。 |
| `eslint.config.js` | Flat Config 形式の ESLint + TypeScript + React Hooks + Storybook ルール定義。 |
| `playwright.vrt.config.ts` / `playwright.it.config.ts` | **`process.cwd()` の FNV-1a ハッシュによる決定論的ポート割り当て**（並列ワークスペースでポート衝突しない仕組み）と 1280px / 375px プロジェクト定義。ExLibris ではここに SwiftShader WebGL2 引数（`--use-gl=angle --use-angle=swiftshader`）を追加する。 |
| `.storybook/main.ts` / `.storybook/preview.ts` | Storybook Vite 構成と、VRT 時のアニメーション無効化・フォント安定化設定。 |
| `test/vrt/vrt.spec.ts` | Storybook の `index.json` を自動列挙し、全 Story を 1280px / 375px で自動スナップショット比較するゼロメンテナンス VRT ランナー。**ほぼそのまま ExLibris に流用可能**。 |
| `test/it/smoke.spec.ts` | Playwright IT の基本構造サンプル。 |
| `scripts/serve-storybook.mjs` (+ `.d.mts`) | ビルド済み `storybook-static` を外部依存ゼロで高速配信する軽量 HTTP サーバー（VRT 高速化の要）。そのまま流用可能。 |
| `scripts/sync-env.mjs` (+ `.d.mts`) | `.env` から Android `strings.xml` 等へ環境変数を同期するスクリプトの参考例。 |
| `scripts/generate-icons.mjs` (+ `.d.mts`) | SVG/元画像から PWA・Android Adaptive Icon 一式を生成するスクリプト例。 |
| `scripts/android-build-config.test.ts` | `build.gradle` や `capacitor.config.ts` の設定退行（署名設定や SDK バージョン等）を Vitest で機械検査する構成テストの手本。 |

---

## 2. `android_and_bridges/` — Capacitor 設定・Android Java プラグイン・ブリッジ層

| ファイルパス | 参考ポイント・ExLibris での流用方法 |
| :--- | :--- |
| `capacitor.config.ts` | Capacitor 基本設定の参考（**注意**: Yommy では `CapacitorHttp.enabled: true` だが、**ExLibris では必ず `false` に変更すること**）。 |
| `android/build.gradle` | Java 21 設定、Play Services Auth (`play-services-auth`) 依存、共有 `debug.keystore` 署名設定、`versionCode` / `versionName` 注入パターンの参考。 |
| `android/MainActivity.java` | カスタム Capacitor プラグイン（`CloudSyncPlugin`, `VolumeKeyPlugin`）の `registerPlugin()` 登録と、`dispatchKeyEvent` による音量キーイベント委譲の実装。 |
| `android/CloudSyncPlugin.java` | **必見リファレンス**。Google `AuthorizationClient` による OAuth 認証、同意画面遷移時の `saveCall` + `StartIntentSenderForResult`、401 時の `clearToken` 再認証、`X-HTTP-Method-Override: PATCH` 回避策がすべて実装済み。ExLibris ではスコープに `drive.readonly` を追加し、Worker 向けトークン取得メソッドを公開するベースとして活用できる。 |
| `android/VolumeKeyPlugin.java` | リーダー画面での音量ボタン上下によるページめくり（`ex_libris_concept.md` §5-E）を実装する際、**そのまま流用可能** なネイティブプラグイン。 |
| `bridges/http/*` | `CapacitorHttp.request()` を直接呼び出す本番アダプタと、UT/Storybook/IT 用モックアダプタの分離手本。ExLibris の公開書誌 API クライアント（`MetadataHttpClient`）にそのまま適用できる。 |
| `bridges/cloud-sync/*` / `bridges/volume-key/*` / `bridges/app/*` | `registerPlugin` ラッパーと Web モック実装の 1 対 1 インターフェース設計手本。 |
| `constants/app.ts` (+ `app.test.ts`) | `package.json` のバージョン情報等を型安全に参照する定数モジュール例。 |

---

## 3. `patterns/` — スケジューラ・同期エンジン・DI・OKF ドキュメント実例

| ファイルパス | 参考ポイント・ExLibris での流用方法 |
| :--- | :--- |
| `cacheScheduler.ts` | **必見リファレンス**。閲覧中の高優先度リクエストによるバックグラウンドキューの即時プリエンプション、レートリミット維持、`AbortController` 連携を純粋クラスで実装した実例。ExLibris の **「リーダー Fast-Path / Warm Prefetch」vs.「表紙 WebP 抽出 2 段キュー」** の設計モデルとして最適。 |
| `syncEngine.ts` | Google Drive `appDataFolder` を用いた Last-Write-Wins (LWW) マージアルゴリズムの実例（将来の端末間しおり・本棚メタデータ同期 `ex_libris_concept.md` §5-F の手本）。 |
| `ServiceProvider.tsx` | アプリ全体のインフラ依存（DB・HTTP・Bridge・Worker Client）を React Context で DI し、初期化完了時に `data-app-ready="true"` を出力して Storybook / Playwright IT の決定論的待機を支える要のパターン。 |
| `App.tsx` / `router.tsx` / `useBackgroundAutoPull.ts` | ルーティング構成、Android ハードウェア戻るボタン制御、起動時バックグラウンド差分同期フックの実装例。 |
| `docs_samples/architecture.md` | `Approved` 状態に至った本番 OKF アーキテクチャ仕様書の完成イメージ見本。 |
| `docs_samples/issue-344-priority-cache-scheduler.md` | **差分仕様（`spec-delta`）の完成見本**。Step 2 設計 PR でどの粒度で背景・差分仕様・テスト計画・Sub-issue 分割を書くかの実例。 |
| `docs_samples/v1.2-non-blocking-priority-cache-scheduler.md` | **Milestone Step 3 品質分析・Kaizen レポート（`quality-report`）の完成見本**。バグ分類集計・Milestone DRE 算出・再発防止策還流の書き方サンプル。 |
