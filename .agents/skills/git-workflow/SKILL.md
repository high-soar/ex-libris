---
name: git-workflow
description: "Use when executing Git or GitHub operations, including branch management, Japanese Conventional Commits, pull request creation, independent PR review coordination via define_subagent, and verifying the 7-condition Task Completion Gate."
---

# Git / GitHub ワークフロー実行手順（Antigravity Remote Agent 版）

このスキルは、ブランチ操作、コミットメッセージ、Pull Request 作成、および独立 AI レビュー（`pr-reviewer`）とのスレッド収束に関する実行手順を定めます。

フェーズごとの進行方式（Phase 1〜2 の迅速構築 vs Phase 3 以降の Issue+PR）および **Task Completion Gate（7条件）** の正本は [docs/guidelines/workflow.md](../../../docs/guidelines/workflow.md) です。

---

## 1. ブランチ戦略（直列トピックブランチ運用）

- **Phase 1〜2（AI基盤＆ハーネス構築・全体骨格設計期間）**:
  ユーザーと対話しながら `main` ブランチ（または初期セットアップ PR）へコミットしてスピーディに構築します。
- **Phase 3（PoC）および Phase 4 以降（本開発期間）**:
  GitHub Flow を適用し、Issue（Sub-issue）ごとに最新の `main` から短命なトピックブランチを切って **1本ずつ直列に** 作業し、PR で統合します（Remote Agent では `Workspace: "inherit"` 制約のため `git worktree` による並行ブランチ展開は原則使用しません）。
  - ブランチ命名規則（小文字 kebab-case）: `feat/issue-12-zip64-parser`, `fix/issue-15-l1-bitmap-close`, `docs/issue-10-reader-spec`, `chore/setup-ci` 等。

```sh
git switch main
git pull --ff-only origin main
git switch -c feat/issue-12-zip64-parser
```

---

## 2. コミットメッセージ規約（日本語 Conventional Commits）

- **形式**: `<type>(<scope>): <日本語の要約>`
  - `type` と `scope` は英語小文字、要約と本文は日本語で記述します。
  - 主な `type`: `feat`, `fix`, `docs`, `test`, `refactor`, `perf`, `ci`, `build`, `chore`
  - 主な `scope` 例: `engine`, `worker`, `webgl`, `provider`, `storage`, `bookshelf`, `reader`, `bridge`, `diagnostics`, `specs`, `guidelines`, `skills`, `ci`
- **TDD ステップ証跡**:
  MK（実装・単体テスト）では、[docs/guidelines/testing.md](../../../docs/guidelines/testing.md#4-tdd-サイクルとコミット規約) に従い、Red・Green・Refactor の各ステップでコミットを分けて履歴に残します（※Red 時は型定義・最小スタブを置いて `pre-commit` の `typecheck` を通し、振る舞いアサーションで失敗させること）：
  - `test(engine): ZIP64 Central Directoryの1RTT切り出しテストを追加（Red）`
  - `feat(engine): ZIP64 Central Directoryの1RTT切り出し処理を実装（Green）`
  - `refactor(engine): DataView読み取りヘルパーを共通モジュールに抽出（Refactor）`

---

## 3. Pull Request 作成と Task Completion Gate（7条件）の実行手順

Phase 3 以降の PR 作業では、[.github/pull_request_template.md](../../../.github/pull_request_template.md) の全項目（目的、変更内容、検証チェックリスト、**不備記録ミニテーブル**、**申し送り事項 `HO-xx` ミニテーブル**）を漏れなく記入し、[docs/guidelines/workflow.md](../../../docs/guidelines/workflow.md#4-task-completion-gate7つの完了条件) に定められた以下の **7条件** を順番に完遂します。

1. **ローカル静的検査・自動テスト PASS**:
   `npm run lint:okf`, `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm run test:coverage`（C0/C1/Functions/Lines 100%）を実行し PASS を確認する。
2. **VRT スナップショット更新・検証 PASS**:
   UI コンポーネント（`*.tsx` / `*.stories.tsx`）の変更時は、`npm run test:vrt:update` および `npm run test:vrt`（1280px / 375px）を実行し PASS を確認する。
3. **PR 作成と Issue リンク設定**:
   - 個別 Issue / Sub-issue を完了する PR には **`Closes #N`** を記載する（1つの Issue を複数 PR に分割する途中段階の PR のみ `Refs #N` を使用する）。
   - **厳守事項**: AI は `gh issue close` 等で Issue を直接クローズしたり、`gh pr review --approve` で PR を自己承認してはならない。必ず PR マージによって Issue（または Sub-issue）が同期クローズされる仕組みを厳守する。
4. **GitHub Actions の PASS 確認**:
   push 後、リモート上の必須ワークフロー（`quality-gate`）がすべて PASS することを確認する（`gh pr checks <PR番号> --watch` 等）。失敗した場合は原因を特定して修正 push する。
5. **独立 AI レビュー（`pr-reviewer` via `define_subagent`）の実施**:
   - セッション内で未定義の場合は `define_subagent`（`name: "pr-reviewer"`, `enable_write_tools: true`, `system_prompt`: [.agents/agents/pr-reviewer.md](../../agents/pr-reviewer.md) の内容）で定義した上で、`invoke_subagent(TypeName: "pr-reviewer", Model: "inherit", Workspace: "inherit")` により実装とは完全に分離されたコンテキストで PR レビューを実施し、[docs/guidelines/review-comment-format.md](../../../docs/guidelines/review-comment-format.md) の形式で PR にコメントを記録させる。
6. **指摘是正 ＆ 独立レビュアー（`pr-reviewer`）による再レビュー解消確認（Resolve 収束）**:
   - 指摘事項（`[P0]`〜`[P3]`）がある場合、以下の 4 ステップを確実に実行する（**Main/Worker による自己判断での Gate 6 完了判定は厳禁**）：
     1. 修正コミットを作成して push し、静的検査・自動テスト・GitHub Actions の PASS を確認する（原因が `D` の場合は同一 PR 内で `docs/specs/` も同時修正し、PR 本文・`bug-and-handover-log.md` に追記）。
     2. 各コメントスレッド / PR に修正コミット SHA と検証結果を返信する。
     3. 独立レビュアー（`pr-reviewer`）サブエージェントに Round 2+ 再レビューを依頼する。
     4. `pr-reviewer` が PR に全指摘の解消確認（Resolved）コメントを投稿したことを確認し、Gate 6 完了とする。
   - 指摘事項が 0 件の場合は、Gate 6 は自動的に完了（N/A）扱いとする。
7. **PR 種別に応じたマージ実行（👤 人間マージ待機 または 🤖 AI 自律マージ）**:
   上記 1〜6 がすべて完了した時点で、[docs/guidelines/workflow.md §4](../../../docs/guidelines/workflow.md#4-task-completion-gate7つの完了条件) の区分に従い以下のように完了処理を行う：
   - **👤 人間マージ待機とする PR**:
     - **Step 2（設計更新 PR / `Refs #親Issue`）**、**Step 4（最終 IT PR・親 Issue 完了 PR / `Closes #親Issue`）**、**Milestone Step 3（品質分析 Kaizen・ログアーカイブ・最終承認 PR / `Closes #MilestoneIssue`）**
     - または [docs/guidelines/workflow.md §4.1](../../../docs/guidelines/workflow.md#41-ai-自律マージの停止人間エスカレーション条件) のエスカレーション条件に該当する場合。
     - ※親 Issue 実機検証対象時は、Gate 1〜6 完了直後に `gh workflow run build-android.yml --ref <対象ブランチ>` を実行し、APK Artifact 取得リンクと「Android 実機検証試験項目表」を併せて提示する。
   - **🤖 AI（Orchestrator）が自律マージする PR**:
     - **Step 3（MK Sub-issue PR / `Closes #Sub-issue`）** および **Milestone Step 2（横断レビュー指摘是正 PR / `Closes #Sub-issue`、実機不具合追加是正 PR 含む）** であり、エスカレーション条件のいずれにも該当しない場合。
     - **アクション**: メインエージェント（Orchestrator）が `gh pr merge <PR番号> --squash --delete-branch` を実行して PR をマージし、`git switch main && git pull --ff-only origin main` で最新化した上で、直ちに次の Sub-issue へ進む。
