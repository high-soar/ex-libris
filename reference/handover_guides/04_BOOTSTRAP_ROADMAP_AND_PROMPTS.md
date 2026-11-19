# 04. `ex-libris` リポジトリ立ち上げ手順・ロードマップ・AI 初期プロンプト集

本ガイドでは、この引き継ぎキットを使って新規 GitHub リポジトリ **`ex-libris`** を立ち上げ、Phase 1（基盤構築）→ Phase 2（コア仕様確定）→ Phase 3（Walking Skeleton PoC）→ Phase 4+（反復開発）へスムーズに入るための実践手順と、そのままコピー＆ペーストで使える AI プロンプトをまとめています。

---

## 1. 新リポジトリ `ex-libris` の初期セットアップ手順（Step-by-Step）

### Step 1: GitHub リポジトリ作成とスターターテンプレートの展開

```bash
# 1. 空ディレクトリを作成して Git 初期化（または gh repo create ex-libris --private --clone）
mkdir ex-libris && cd ex-libris
git init -b main

# 2. 02_starter_template/ の中身（隠しファイル .agents / .devcontainer / .github / .githooks 等を含む）をルートへコピー
cp -a /path/to/ex-libris-handover-kit/02_starter_template/. ./

# 3. 企画マスターインプット資料（ex_libris_concept.md）も初期参照用に docs/specs/ 脇または一時参照用に配置したい場合は任意で手元に保持
#    （※ docs/ 配下に置く場合は OKF フロントマター検査対象になるため、ルート直下または .local/ への配置を推奨）

# 4. Git Hooks（pre-commit / pre-push）の有効化
git config core.hooksPath .githooks

# 5. OKF ドキュメント・リンク整合性の初期チェック（Node.js があれば npm install 前でも実行可能）
node .github/skills/sdd/scripts/validate-okf.mjs
```

### Step 2: Android 共有検証用 Keystore の新規生成と Google Cloud OAuth 設定

> [!IMPORTANT]
> セキュリティとアプリケーション ID 分離のため、Yommy の `debug.keystore` は意図的に同梱していません。`ex-libris` 専用の検証用 Keystore を以下のコマンドで 1 度生成してください（ローカル実機ビルドと GitHub Actions ビルドの APK 署名を一致させ、アンインストール不要で上書きインストール可能にするためです）。

```bash
mkdir -p android/app
keytool -genkeypair -v \
  -keystore android/debug.keystore \
  -storepass android \
  -alias androiddebugkey \
  -keypass android \
  -keyalg RSA \
  -keysize 2048 \
  -validity 10000 \
  -dname "CN=Android Debug,O=Android,C=US"

# Google Cloud Console 登録用の SHA-1 フィンガープリントを確認
keytool -list -v -keystore android/debug.keystore -storepass android | grep SHA1
```

**Google Cloud Console 側の準備（Google Drive 連携着手前までで OK）**:
1. Google Cloud プロジェクトで **Google Drive API**（および書誌連携で使う場合は **Books API**）を有効化する。
2. OAuth 同意画面でテストユーザーを追加し、スコープ `.../auth/drive.readonly` と `.../auth/drive.appdata` を登録する。
3. 「認証情報を作成 > OAuth クライアント ID > Android」で、パッケージ名（例: `com.highsoar.exlibris`）と上記 `SHA-1` を登録する。

---

## 2. フェーズ別進行ロードマップ（Phase 1 〜 Phase 4+）

| フェーズ | 運用モード | 実施内容 | 完了基準 |
| :--- | :--- | :--- | :--- |
| **Phase 1**<br>AI駆動開発基盤構築 | 直接コミット / 初期セットアップ PR | `03_yommy_reference_files/configs/` を参考に Vite + React 19 + TypeScript + Tailwind + Vitest (100% 閾値) + Storybook + Playwright (SwiftShader WebGL2 VRT/IT) + Capacitor 最小構成を構築し、GitHub Actions `quality-gate` を Green にする。 | `npm run typecheck`, `lint`, `test:coverage`, `test:vrt`, `test:it`, `okf:check` がすべてローカル＆CIで PASS |
| **Phase 2**<br>コア仕様・設計骨格確定 | 対話的策定 ＋ レビュー合意 | `ex_libris_concept.md` §6 のアジェンダに基づき、MVP スコープ・マイルストーン計画・`architecture.md`・`db-schema.md`・`screen-transitions.md` を精緻化し、`status: "Approved (Phase 2)"` へ更新する。 | `validate-okf.mjs` PASS ＆ ユーザーが初期4仕様書に合意 |
| **Phase 3**<br>Walking Skeleton (PoC) | **Issue + PR + 独立レビュー + Gate 7条件** | 最小の垂直スライス（ローカル/モック HTTP Range からの ZIP 解析 → Coordinator/Decode Worker Zero-Copy → 生 WebGL2 1ページ描画・ページめくり）を TDD で貫通させる。完了時に初の Milestone 最終レビューを実施。 | C0/C1 100%、SwiftShader WebGL2 VRT PASS、Playwright IT `SCN-01` PASS、Milestone Step 1〜3 完了 |
| **Phase 4+**<br>`v0.1`, `v0.2`, `v0.3`... | **4ステップ Micro-Waterfall + AI 自律マージ** | 各機能 Issue ごとに「①質問 → ②設計PR（人間マージ） → ③MK Sub-issue PR群（AI 自律マージ） → ④最終IT PR（人間マージ）」を回し、ミニリリースごとに実機検証と Kaizen ループを回す。 | 各 Milestone 完了時に `vX.Y.0` 自動タグ＆署名済み APK リリース発行 |

---

## 3. そのまま使えるフェーズ開始用 AI プロンプト集

Google Antigravity または GitHub Copilot で新リポジトリ `ex-libris` を開いた際、以下のプロンプトを順番に投入することで、引き継いだフレームワーク通りに開発を開始できます。

### プロンプト①：Phase 1（開発基盤・AI ハーネス立ち上げ）

```markdown
`AGENTS.md` と `docs/index.md`、`docs/guidelines/workflow.md`、`docs/guidelines/testing.md` を確認してください。
これから ExLibris の **Phase 1（AI駆動開発基盤・テストハーネス構築）** を実施します。

手元の引き継ぎ参考資料（`ex_libris_concept.md`、適応ガイド `02_EX_LIBRIS_ARCHITECTURE_AND_TESTING_ADAPTATION.md`、および `03_yommy_reference_files/configs/`）をベースに、以下の最小構成を構築して全チェックを通してください。

1. React + TypeScript + Vite + Tailwind CSS + Dexie.js (`fake-indexeddb`) + Comlink + Zustand + fflate の `package.json` 構成
2. `capacitor.config.ts` の初期作成（`CapacitorHttp.enabled` は必ず `false` とし、Zero-Copy `fetch` を保護すること）
3. Vitest（C0/C1/Functions 100% 閾値）、ESLint、Prettier、Storybook、Playwright VRT（1280px / 375px + `--use-gl=angle --use-angle=swiftshader`）、Playwright IT の最小スモーク構成（`App.tsx` の最小プレースホルダ 1 画面に対して 1対1 Story / Portable Stories UT / VRT / IT `SCN-01` が通る状態）
4. `npm run okf:check`, `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm run test:coverage`, `npm run test:vrt:update && npm run test:vrt`, `npm run test:it` がすべて PASS することを確認してください。
```

### プロンプト②：Phase 2（MVP スコープ整理・コア仕様4文書の確定）

```markdown
Phase 1 の基盤が整いました。続いて **Phase 2（コア仕様・マイルストーン計画の確定）** に進みます。

マスター構想資料 `ex_libris_concept.md`（特に §3〜§6 の検討アジェンダ）と、現在 `Draft` 状態の以下の4ファイルを確認してください：
- `docs/specs/requirements.md`
- `docs/specs/architecture.md`
- `docs/specs/db-schema.md`
- `docs/specs/screen-transitions.md`

いきなり仕様を決め打ちで書き換えず、まずは以下の未決アジェンダについて推奨案付きの選択肢を提示して私とすり合わせてください：
1. Phase 3 (PoC) と `v0.1` 〜 `v0.3` の各ミニリリース Milestone に割り振る機能スコープ境界
2. Dexie.js テーブル・複合インデックス設計の詳細（0.01秒複合検索・五十音ソート・`appDataFolder` LWW 同期を見据えたカラム構成）
3. 公開書誌 API（NDL サーチ / Google Books / 楽天ブックス / AniList）の導入優先順位
4. `CoordinatorCore` / `DecodeWorker` / `WebGLRendererCore` の共通 TypeScript インターフェース契約

合意後、4つの正本仕様書を詳細化して `status: "Approved (Phase 2)"` へ更新し、`npm run okf:check` を通してください。
```

### プロンプト③：Phase 3 以降（各親 Issue 着手時の定型プロンプト）

```markdown
Issue #<番号> に着手します。
`AGENTS.md` および `.github/skills/iterative-github-task-management/SKILL.md` の **4ステップ・マイクロウォーターフォール** に厳密に従って進めてください。

まずは **Step 1（Open Questions の明確化）** として、Issue #<番号> と関連する `docs/specs/` 正本を読み、仕様上の確認事項や設計上のトレードオフがあれば質問してください（まだプロダクションコードは書かないでください）。
疑問点が解消したら **Step 2（設計更新 PR：差分仕様 `docs/specs/changes/issue-<番号>-*.md` 作成 ＋ 正本仕様更新 ＋ Sub-issue 分割計画 ＋ Android 実機検証タイミング判定）** を作成し、Task Completion Gate 1〜6 を通した上で私のレビュー・マージを待ってください。
```

### プロンプト④：ミニリリース Milestone 完了時の横断レビュー開始プロンプト

```markdown
Milestone Issue #<番号> の全対象機能 PR が完了しました。
`.github/skills/phase-final-review/SKILL.md` および `docs/guidelines/workflow.md` §5 に従い、**Milestone Step 1（成果物横断レビュー）** を開始してください。
`phase-final-reviewer` の観点に基づき、コード・仕様書・テスト・WebGL2/Worker/Android 境界の総点検を実施し、ローカル全品質ゲートを確認した上で Issue #<番号> へ構造化レビューコメントを投稿してください。
```
