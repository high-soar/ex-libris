---
name: c-ut-workflow
description: "Use when implementing production code and unit/VRT tests in MK tasks, orchestrating worker subagents (self) sequentially, and enforcing the 4-layer testing rules in docs/guidelines/testing.md."
---

# MK（C・UT / VRT）実行・サブエージェント委託手順

このスキルは、MK（実装・単体テスト・Storybook VRT）フェーズにおける **AI エージェントの実行手順およびサブエージェント（`self`）への直列委託（オーケストレーション）手順** を定めます。

4層アーキテクチャの責務境界、TDD コミット規約、1対1 Story/UT 原則、親子コンポーネント分離原則、カバレッジ基準（C0/C1/Functions 100%）、VRT（1280px / 375px）、およびバグ記録・原因 `D` 設計同期ルールの正本（SSOT）は **[docs/guidelines/testing.md](../../../docs/guidelines/testing.md)** です。作業前に必ず正本を読了してください。

---

## 1. オーケストレーター（親）とワーカー（`self`）の役割分担

MK 作業はファイル編集数やテスト・VRT 実行ログが多く、メインセッションのコンテキスト枯渇（Compaction による手順抜け）を招きやすいため、以下の役割分担を徹底します。

- **メインエージェント（Orchestrator）**:
  1. 対象 Issue の完了条件と `docs/specs/` の承認済み設計書を確認する。
  2. 作業単位（①Streaming/ZIP Engine・Provider・Storage・Bridge ロジック層、②WebGL2 シェーダー・UI 子コンポーネント層、③Page 結合層など）ごとに汎用サブエージェント（`self`, `Workspace: "inherit"`, `Model: "inherit"`）を **直列（1つずつ順番）** に起動して TDD 実装を委託する（※テスト干渉・Git ロック競合・VRT ポート競合を防ぐため並列起動しない）。
  3. ワーカー完了後、ブランチを push して PR を作成し、[git-workflow スキル](../git-workflow/SKILL.md) に従って GitHub Actions 確認と `pr-reviewer` による独立レビュー・スレッド収束を管理する。
- **ワーカーサブエージェント（`self`）**:
  1. [docs/guidelines/testing.md](../../../docs/guidelines/testing.md) と対象設計書（`docs/specs/`）を読む。
  2. 担当範囲について TDD（Red → Green → Refactor）を実行し、各ステップで個別にコミットを刻む。
  3. 品質チェック一式を実行し、検出した不備や申し送り事項を記録して親エージェントに完了報告（コミット SHA 一覧・テスト/カバレッジ結果・不備記録有無）を返す。

### ワーカーサブエージェント（`self`）起動時の指示プロンプトひな形

```text
対象 Issue #XX のうち、[担当モジュール/コンポーネント名] の TDD 実装および単体テスト・VRT 作成を行ってください。

1. 必読正本:
   - `docs/guidelines/testing.md`（TDDコミット規約、4層責務境界、1対1 Story/UT、親子分離、C0/C1 100%、VRT、原因D設計同期、ゼロコンフィグ・DIモック分離規律）
   - `docs/specs/...`（対象の設計正本・受け入れ条件 AC-xx）
2. 作業手順:
   - Red（型スタブ＋テスト失敗確認） → Green（最小実装） → Refactor の各ステップで個別にコミット（英語 type + 日本語要約）を刻むこと（`.githooks/pre-commit` の `typecheck` が通る状態で振る舞いアサーションを失敗させること）。
   - `.tsx` を作成・変更する場合は、同階層に `.stories.tsx` と `.test.tsx`（`composeStories` 全件実行＋分岐補完）を 1対1 で作成し、親のテストでは直下の子に `vi.spyOn(...).mockImplementation(() => null)` を適用して Props・コールバック配線のみを検証すること。
   - 新規 Dexie.js テーブル・インデックス・フィールド追加時は、スキーマ定義（マイグレーション含む）→ 型定義（`types.ts`）→ Repository → Store / Hook / Container → Page → View → Storybook / UT / IT の全層伝播を確認すること。
   - Green 以降や検証中に不備を見つけた場合は `docs/quality/bug-and-handover-log.md` に記録し、原因分類 `D`（設計不備）の場合は必ず `docs/specs/` も同時修正すること。
3. 完了前検証:
   - `npm run lint:okf`, `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm run test:coverage`（C0/C1/Functions/Lines 100%）を実行し PASS を確認すること。
   - `.env.local` の有無に関わらずテスト・ビルドが 100% 決定論的に PASS することを確認すること（モック DI 徹底）。
   - UI/Story 変更時は `npm run test:vrt:update` および `npm run test:vrt`（1280px / 375px）を実行し PASS を確認すること。
4. 報告内容:
   - 作成したコミット SHA 一覧、カバレッジ・VRT 検証結果、記録した不備（L/S/D/B/A）と申し送り（HO-xx）を報告してください（※push や PR 作成は親が行います）。
```

---

## 2. ワーカー実行時の TDD・4層チェックリスト

### Step 1: Red（テスト・Story 先行作成と失敗確認）

- **Streaming & Binary Engine Layer**:
  - 外部ネットワーク通信は一切行わず、`__fixtures__/` の決定論的バイナリ ZIP/ZIP64/CP932 バッファ生成ヘルパーを入力として、EOCD/ZIP64 EOCD 解析、1 RTT LFH 切り出し、Data Descriptor（Bit 3）、物理オフセット不連続ギャップ分割、`__MACOSX` 除外、自然順ソート、L2 キャッシュ LRU 退避、バイト予算制プリフェッチを `it("... (AC-xx)")` で記述する。
  - Worker コアロジッククラスと薄い `*.worker.ts`（`Comlink.expose` エントリー）を分離し、コアロジックの C0/C1/Functions 100% を保証する。
- **Metadata & Filename Provider Layer**:
  - ファイル名スマートパーサーの表記揺れパターン、および公開書誌 API（NDL OpenSearch XML / Google Books JSON / 楽天ブックス JSON / AniList GraphQL）のローカルフィクスチャ応答を用いた単体テストを記述する。
  - 重要: グローバル `CapacitorHttp.enabled` は `false` のまま維持し、CORS 回避が必要な書誌 API クライアントのみ `MetadataHttpClient` アダプター内で明示的に `CapacitorHttp.request()` を呼び出すこと。
- **Storage & Sync Layer (Dexie.js)**:
  - `fake-indexeddb` ＋ `resetTestDb()` を用い、テーブル CRUD・複合検索・`ZipIndexCache`（`fileId + md5Checksum`）・Google Drive `changes.list` 差分同期・`appDataFolder` LWW マージを決定論的に検証する。
  - 表紙サムネイル生成や目次キャッシュ保存などの定常バックグラウンド処理で LWW 調停用 `updatedAt` を汚染しないこと。
- **WebGL2 Viewer, UI & Bridge Layer**:
  - L1 キャッシュ（`ImageBitmap` 3〜5ページ保持）のウィンドウ外退避およびアンマウント時に **`bitmap.close()` が確実に呼ばれること**をスパイ検証する。
  - WebGL2 レンダラーは `MAX_TEXTURE_SIZE` 上限ガード（4096px 端末での分割またはリサイズフォールバック）、Mipmap 生成、およびシェーダー Uniform 更新をモックコンテキスト UT と Playwright SwiftShader E2E/VRT で検証する。
  - 非同期スケジューラ・プリフェッチ・探索 Hook では、世代カウンタ（エポック）と `AbortSignal` 下位伝播・各 `await` 直後の `isMountedRef` / `signal.aborted` 再確認を徹底する。
  - モバイル WebView のジェスチャーでは `pointerStartRef` と `touchStartRef` を分離し、画面内の複数タッチゾーンは幾何学的に排他配置して境界座標テストを作成する。
  - Container / Page の単体テストでは直下の子コンポーネントに `vi.spyOn(...).mockImplementation(() => null)` を適用し、`afterEach(() => vi.restoreAllMocks())` を配置する。
  - `Date.now()` と比較するテストでは固定カレンダー日付を禁止し、`Date.now()` 相対計算または `vi.setSystemTime` を使用する。
- **失敗確認とコミット**: `npx vitest run <対象テスト>` を実行し、未実装により期待通り失敗することを確認して `test(<scope>): ...（Red）` をコミットする。

### Step 2: Green（最小実装）

- テストをパスさせる最小限の実装コードを作成する（YAGNI 原則、[ponytail スキル](../ponytail/SKILL.md) 参照）。
- 対象テストを実行して全件 PASS を確認し、`feat(<scope>): ...（Green）`（または `fix`）をコミットする。

### Step 3: Refactor（構造・型安全性の改善）

- テストが Green の状態を維持したまま、重複排除・型定義の厳密化・可読性向上を行い、再度テスト PASS を確認して `refactor(<scope>): ...（Refactor）` をコミットする。

### Step 4: 局所検証・カバレッジ・VRT・不備記録

1. `npm run test:coverage` を実行し、変更・追加した全ファイルの **C0 / C1 / Functions カバレッジが 100%** であることを確認する（不正な `v8 ignore` は使用禁止）。
2. `npm run lint:okf`, `npm run typecheck`, `npm run lint`, `npm run format:check` を実行し PASS を確認する。
3. Story を追加・変更した場合は `npm run test:vrt:update` → `npm run test:vrt` を実行し、1280px / 375px のスナップショット整合と孤児ファイル 0 件を確認する。
4. 作業中に検出した不備や後続への申し送り（`HO-xx`）を [docs/quality/bug-and-handover-log.md](../../../docs/quality/bug-and-handover-log.md) に記録する（原因 `D` は設計書も同時修正）。
