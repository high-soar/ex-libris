---
name: phase-final-review
description: "Use when orchestrating a cross-deliverable review at the end of a Phase (e.g., Phase 3 PoC) or Mini-Release Milestone (v0.1, v0.2...); split the review among read-only subagents without anchoring, verify findings, record on the tracking Issue, and lead into quality analysis (Kaizen)."
---

# 節目・ミニリリース Milestone 全体横断レビューのオーケストレーション手順

このスキルは、Phase 完了時（Phase 3 PoC 完了等）やミニリリース Milestone（`v0.1`, `v0.2` 等）の完了節目に実施する **全体横断レビューおよび品質分析（Kaizen）連携のオーケストレーション手順** を定めます。

3段階ゲート運用およびレビューコメント集約フォーマットの正本（SSOT）は以下を参照してください：

- [docs/guidelines/workflow.md](../../../docs/guidelines/workflow.md#5-ミニリリース-milestone-と品質改善kaizenループ)
- [docs/guidelines/review-comment-format.md](../../../docs/guidelines/review-comment-format.md#5-節目横断レビューphase--ミニmilestone-完了レビューの集約形式)

---

## 1. 基本オーケストレーションモデル

- **メインセッションが Coordinator**:
  メインセッションでレビュー範囲を重複しない 3 つの観点に分割し、複数の読み取り専用サブエージェント（`research`, `Workspace: "inherit"`, `Model: "inherit"` ※ローカル読み取り専用）を直接起動します（孫サブエージェントのネスト起動は行わない）。
- **マルチモデル・複数オーケストレーターの並行運用**:
  モデルごとの推論特性や深さ（網羅性・アーキテクチャ・潜在リスク等）の差異を活かすため、Antigravity 上で異なるモデルを選択した別会話を複数起動して横断レビューを並行実施することもサポートします。各オーケストレーターは独立した追記スレッドとしてレビュー結果を投稿し、モデル別の着眼点を可視化します。
- **アンカリング防止（独立性の担保）**:
  各 reviewer サブエージェントには「対象 SHA」「参照すべき正本（`docs/specs/`, `docs/guidelines/`）」「担当観点と対象ファイル」のみを渡し、過去の指摘やメインエージェントが疑っている具体的な箇所は事前に共有しません。

---

## 2. 横断レビュー実行手順（Step 1）

1. **対象と完了条件・SHA の固定（⚠️ レビュー開始時の既存コメント閲覧禁止）**:
   - 対象 Milestone（または Phase）の追跡 Issue 本文（`gh issue view <issue-number>` ※ `--comments` は付けない）、含まれる要望 Issue 一覧、および現在の `HEAD` コミット SHA（`git rev-parse HEAD`）を確認し、`git status` がクリーンであることを確認する。
   - **【重要】開始時コメント閲覧禁止**: 複数のオーケストレーターがほぼ同時に起動されるため、**この段階（レビュー開始時〜ステップ 3 完了前）では絶対に追跡 Issue の既存コメント（`--comments`）を取得・閲覧してはならない**（アンカリング防止、およびレビュー実行中の数分間に他エージェントがコメントを投稿して開始時点の ID が陳腐化・重複するのを防ぐため）。
   - **実施タイミングの鉄則**: 品質分析レポート（`docs/quality/reports/*.md`）を作成する **前** に Round 1 横断レビューおよび Step 2 の指摘是正・Android 実機検証を実施する。
2. **観点の分割と読み取り専用サブエージェントの起動**:
   対象範囲に応じて、以下の 3 観点に分割して読み取り専用サブエージェントを起動する：
   - **観点 A（仕様・設計正本とトレーサビリティ）**: `docs/specs/` 間の整合性（`requirements.md`, `architecture.md`, `db-schema.md`, `screen-transitions.md`, `features/*.md`, `engine/*.md`, `providers/*.md`）、受け入れ条件（`AC-xx`）・画面遷移（`TR-xx`）の双方向リンク、未消化の申し送り事項（`HO-xx`）の有無。
   - **観点 B（4層実装・メモリ/スレッド安全性・単体テスト/VRT 規律）**: `src/` 配下の実装が `docs/specs/` の契約に 1対1 準拠しているか（ZIP/ZIP64 境界、L1 `ImageBitmap.close()` 解放、Worker `AbortSignal`、WebGL2 `MAX_TEXTURE_SIZE`、Dexie トランザクション）、`docs/guidelines/testing.md`（1対1 Story/UT、親子分離、C0/C1 100%、不正な `v8 ignore` なし、1280px/375px VRT 網羅）を満たしているか。
   - **観点 C（結合テスト回帰保証と品質記録の整合性）**: `test/it/` の `SCN-01`〜 が過去機能を含め最新仕様を網羅しているか、`docs/quality/bug-and-handover-log.md` に原因 `D` の設計同期漏れがないか。

   各サブエージェントへの指示プロンプトには以下を明記する：

   ```text
   - レビュー対象 SHA: <commit-sha>
   - 参照正本: docs/guidelines/testing.md, docs/guidelines/workflow.md, docs/specs/
   - 担当観点と対象ファイル: <観点 A / B / C の範囲>
   - 制約: 読み取り専用（ファイル編集・コミット・GitHub コメント投稿は禁止）
   - 出力形式: docs/guidelines/review-comment-format.md に従い、[P0]〜[P3] の重要度と 4要素（Location, Problem, Impact, Recommendation）で報告すること（指摘なしの場合も確認範囲を報告）。
   ```

3. **メインセッションでの事実検証と品質ゲート実行（仮 ID での下書き整理）**:
   - 全サブエージェントの応答完了後、サブエージェントを明示的に終了（`manage_subagents` の `kill` / `kill_all`）する。
   - 報告された候補をメインセッションで実際のコード・正本と照合し、誤検知を除外して重複を整理する（この時点ではまだ `R1-xx` の確定番号を振らず、仮番号 `#1, #2...` で下書きを完成させておく）。
   - メインセッションで一通りの検証コマンド（`npm run lint:okf`, `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm run test:coverage`, `npm run test:vrt`, `npm run test:it`）を実行し、100% PASS することを確認する。
4. **投稿直前（Just-in-Time）の既存コメント確認・採番と、投稿直後（Post-Submit）の衝突検知・自動リナンバー**:
   - **① 投稿直前の最新コメント取得**:
     ```bash
     gh issue view <issue-number> --comments
     ```
   - **② 既存コメントの存在有無に応じた直前採番と即座の投稿**:
     - 先行コメントが存在しない場合は `R1-01` から採番して即座に投稿する。
     - 先行コメントが存在する場合は、先行と同一内容の指摘は「先行指摘 `R1-xx` を追認・補強」とし、独自の新規指摘のみに先行最終 ID の次番を付与して即座に投稿する。
   - **③ 投稿直後の衝突検知と自己コメント即時リナンバー（Race Condition 対策）**:
     - 投稿完了直後に再度 `gh issue view <issue-number> --comments` を実行し、数秒差で他エージェントと `R1-xx` が重複していた場合は直ちに `gh api --method PATCH` で自己コメントを連番へ振り直す。

---

## 3. Step 2（横断レビュー指摘是正・実機検証）から Step 3（品質分析・アーカイブ・最終承認）への進行

1. **Step 2-1（横断レビュー指摘の是正 PR 作成と AI 自律マージ）**: Sub-issue を起票して全 `R1-xx` を是正・台帳記録し、Gate 1〜6 完遂後にメインエージェントが自律マージする。
2. **Step 2-2（Android 実機検証 APK 生成と試験項目表の提示・実機収束）**: `gh workflow run build-android.yml --ref main` を実行して署名済み検証 APK を生成し、未消化 `HO-xx` と修正箇所を網羅した「Android 実機検証試験項目表」＋ APK Artifact 取得リンクを人間に提示する。不具合があれば追加是正 PR（AI 自律マージ＋APK 再生成）で全項目 OK まで収束させる。
3. **Step 3（最終承認 PR：人間マージ）**: 追跡 Issue に収束報告を行った後、`Closes #Milestone承認Issue` の最終 PR で ①品質分析レポート（`docs/quality/reports/<milestone>.md`）作成、②`testing.md` / `SKILL.md` への Kaizen 反映、③完了バグ＆HO の `docs/quality/archive/<milestone>-log.md` へのアーカイブ移動、④正本仕様書の一括 `Approved` 化、⑤`package.json` の `version` 更新（`X.Y.0`）を一括実施し、Gate 1〜6 完遂後に人間のマージを待つ（マージ時に `release.yml` が署名済み APK 付き GitHub Release を自動発行）。
