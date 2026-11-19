---
name: retrospective
description: "Use this skill when a session had repeated failed attempts, user corrections or negative feedback, or an explicit request for a retrospective; skip routine lint, test, type-check, hook, or CI failures resolved by existing safeguards."
---

# セッション振り返り（Retrospective & Kaizen）

セッション中の事実を確認し、再発防止につながる問題だけを分類して `docs/guidelines/`、`AGENTS.md`、または `.agents/skills/*/SKILL.md` の改善へつなげます。振り返りの目的は失敗を列挙することではなく、次回の作業を変えられる具体的な改善点を見つけることです。

---

## 1. 実行条件と事前切り分け

次のいずれかに該当するときに実行します（通常の TDD ループ内の Red や、既存の lint/typecheck/テストが一発で検出してその場で直せた通常の失敗では実行しません）。

- ユーザーが明示的に振り返りを依頼した。
- ユーザーが誤解、不要な変更、説明不足、規約違反（例: いきなり実装を始めた、親子分離違反、原因 `D` の設計書未同期など）を指摘し、作業をやり直した。
- 同じ調査や編集を複数回やり直した、または誤った仮説から抜け出すために大きな手戻りが発生した。
- 既存の `docs/guidelines/` や `SKILL.md` の記述不足により、再発可能な問題が見つかった。

---

## 2. 振り返り手順

1. **Step 1: 範囲と事実の特定**: 対象ブランチ、Issue/PR、問題が発生した作業・変更ファイル・コマンド、およびユーザーの指摘内容を特定する（推測で事実を作らない）。
2. **Step 2: 根本原因の整理**: 事実・影響・根本原因を特定し、「次回から注意する」といった精神論ではなく、**どのファイル（`docs/guidelines/*.md`, `AGENTS.md`, `.agents/skills/<name>/SKILL.md`, `.agents/agents/*.md` 等）のどの手順・チェックリストをどう変えるか** まで具体化する。
3. **Step 3: 2分類と反映判断**:
   - **分類 1: 本リポジトリ（ExLibris）の正本・スキルへ反映すべき問題**
   - **分類 2: 反映不要**（偶発事象など）
4. **Step 4: 正本・スキルの更新（二重管理の防止）**:
   - 人間も共有すべき開発ルール・テスト基準の改善は [workflow.md](../../../docs/guidelines/workflow.md) または [testing.md](../../../docs/guidelines/testing.md) を更新する。
   - AI 固有のオーケストレーション・実行手順の改善は `.agents/skills/<name>/SKILL.md`、`.agents/agents/*.md`、または [AGENTS.md](../../../AGENTS.md) を更新する。
