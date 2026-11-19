# ExLibris (`ex-libris`) 開発引き継ぎ＆AI駆動開発スターターキット

本パッケージは、初期構想ドキュメント `ex_libris_concept.md` に基づく超高速ストリーミング自炊マンガビューア＆仮想本棚システム **ExLibris (`ex-libris`)** の開発立ち上げにあたり、現行リポジトリ **Yommy (`v1.2.0`)** で確立・実証された **AI駆動開発（SDD × TDD × 独立AIレビュー × 7条件完了ゲート × Milestone Kaizen）フレームワーク一式** と **関連技術資産** を持ち出し可能な形で体系化した引き継ぎキットです。

---

## パッケージ構成

```text
ex-libris-handover-kit/
├── README.md                              # 本ファイル（全体ガイド・クイックスタート）
├── 00_input/
│   └── ex_libris_concept.md               # ExLibris 初期構想・技術検証マスタードキュメント（原本コピー）
├── 01_handover_guides/                    # 【必読】開発手法・技術適応・Kaizen教訓・立ち上げプロンプト集
│   ├── 01_AI_DRIVEN_DEV_PLAYBOOK.md       # Yommy 流 AI駆動開発フレームワーク完全解説（SSOT / OKF / 4-Step WF / Gate 7条件）
│   ├── 02_EX_LIBRIS_ARCHITECTURE_AND_TESTING_ADAPTATION.md
│   │                                      # Yommy → ExLibris 技術適応ガイド（CapacitorHttp罠・ZIP64合成バイナリTDD・Worker分離・WebGL2 VRT）
│   ├── 03_KAIZEN_LESSONS_FROM_YOMMY.md    # Yommy 全12マイルストーン（495件の記録）から厳選した 8 つの実践 Kaizen 教訓
│   └── 04_BOOTSTRAP_ROADMAP_AND_PROMPTS.md# ex-libris 新規リポジトリ立ち上げ手順・keytool手順・AI初期プロンプト集
├── 02_starter_template/                   # 【そのまま展開可能】ExLibris 用にカスタマイズ済みのリポジトリ初期骨格
│   ├── AGENTS.md                          # Antigravity / Copilot 共通の AI ルート憲法（ExLibris 4層＋Worker 仕様適応済み）
│   ├── .agents/skills.json                # Antigravity 用スキルマッピング定義
│   ├── .devcontainer/                     # Node 24 + Chromium + 日本語フォント + SQLite/gh 同梱 DevContainer 構成
│   ├── .githooks/                         # pre-commit (format/lint/typecheck) & pre-push (100% coverage UT) フック
│   ├── .github/
│   │   ├── copilot-instructions.md        # GitHub Copilot → AGENTS.md ブリッジ定義
│   │   ├── ISSUE_TEMPLATE/ & pull_request_template.md
│   │   ├── agents/                        # 独立レビュアー（pr-reviewer / phase-final-reviewer）ExLibris 監査観点適応済み
│   │   ├── skills/                        # 全10種の AI ワークフロースキル ＋ OKF 機械検証スクリプト validate-okf.mjs
│   │   └── workflows/                     # GitHub Actions (ci.yml / build-android.yml / release.yml)
│   └── docs/                              # OKF 準拠ドキュメント3本柱（validate-okf.mjs 検証 PASS 済み）
│       ├── index.md                       # OKF 知識バンドル全体マップ（11種タクソノミー定義）
│       ├── guidelines/                    # workflow.md / testing.md / review-comment-format.md（ExLibris 適応済み正本）
│       ├── specs/                         # Phase 2 開始用の初期 Draft 骨格4文書（requirements / architecture / db-schema / screen-transitions）
│       └── quality/                       # バグ記録票・申し送り事項（HO-xx）台帳初期テンプレート
└── 03_yommy_reference_files/              # 【実装参考】Yommy (v1.2.0) から厳選した実績コード・設定サンプル集
    ├── README.md                          # 各リファレンスファイルの解説と流用時の注意点
    ├── configs/                           # package.json, vite.config.ts, playwright.{vrt,it}.config.ts, vrt.spec.ts 等
    ├── android_and_bridges/               # CloudSyncPlugin.java (Google OAuth), VolumeKeyPlugin.java, Capacitor Bridge 層
    └── patterns/                          # cacheScheduler.ts (優先度プリエンプション), syncEngine.ts, ServiceProvider.tsx, OKF実例文書
```

---

## クイックスタート（推奨の読み進め方）

1. **開発プロセスの全体像を把握する**:
   `01_handover_guides/01_AI_DRIVEN_DEV_PLAYBOOK.md` を読み、Google Antigravity / GitHub Copilot 共存の SSOT 構成、OKF 2層ドキュメント、4ステップ・マイクロウォーターフォール、Task Completion Gate（7条件）と AI 自律マージの仕組みを確認します。
2. **ExLibris 固有の技術ポイント・テスト設計を確認する**:
   `01_handover_guides/02_EX_LIBRIS_ARCHITECTURE_AND_TESTING_ADAPTATION.md` と `03_KAIZEN_LESSONS_FROM_YOMMY.md` を読み、特に **`CapacitorHttp.enabled: false` の絶対維持**、**Worker Core 分離による C0/C1 100% 維持**、**SwiftShader WebGL2 VRT**、**`ImageBitmap.close()` リーク検証** を確認します。
3. **新リポジトリ `ex-libris` を立ち上げて AI 駆動開発を開始する**:
   `01_handover_guides/04_BOOTSTRAP_ROADMAP_AND_PROMPTS.md` の手順に従い、`02_starter_template/` を新リポジトリへコピーして **プロンプト①（Phase 1）→ プロンプト②（Phase 2）** を実行します。
