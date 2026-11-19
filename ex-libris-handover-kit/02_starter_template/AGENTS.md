# Project Agent Guidelines (ExLibris)

Welcome to **ExLibris** (`ex-libris`), an Android & Web ultra-fast comic streaming reader and virtual bookshelf application built with **React (TypeScript / Vite) + Capacitor + Web Workers (Comlink) + Raw WebGL2 + Dexie.js**.
This repository maintains a unified Single Source of Truth (SSOT) configuration for both **Google Antigravity** and **GitHub Copilot**.

---

## 1. Environment & Architecture

- **Environment**: VS Code DevContainer (Ubuntu-based)
- **Runtimes & Stack**: Node.js 24, npm, React, TypeScript, Vite, Tailwind CSS, Zustand, Dexie.js (IndexedDB), Comlink (Web Workers + Transferable Objects), Raw WebGL2, `DecompressionStream` (`fflate` fallback), Capacitor (`@capacitor/core`, `@capacitor/app`)
- **CLI Tools**: GitHub CLI (`gh`), GitHub Copilot CLI (`@github/copilot`), ripgrep (`rg`), zip/unzip, Playwright (`@playwright/test` / Chromium with SwiftShader WebGL2)
- **System Fonts (Japanese UI VRT Parity)**: DejaVu Sans (`fonts-dejavu-core`), Noto CJK (`fonts-noto-cjk`)
- **DevContainer vs. Host OS Boundary**:
  - Run Web builds, static checks, Vitest unit tests (including `fake-indexeddb` and binary ZIP fixtures), Storybook VRT (1280px tablet landscape / 375px mobile portrait), Playwright IT, and `npx cap sync android` inside the DevContainer.
  - Perform Android APK builds and emulator/physical-device verification (60fps WebGL2 rendering, `MAX_TEXTURE_SIZE`, VRAM `ImageBitmap.close()`, Google OAuth, touch/volume-key gestures) on the Host OS (Android Studio / `adb`) or GitHub Actions.

---

## 2. AI Configuration & SSOT Architecture

To prevent duplication between human rules and AI skills, and across AI assistants, this repository strictly separates responsibilities:

| Component                        | Source of Truth (SSOT)                 | Purpose & Integration                                                                                                                                                                                                                                                                                                                                            |
| :------------------------------- | :------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Human & AI Shared Guidelines** | `docs/guidelines/*.md`                 | Canonical rules for workflow ([workflow.md](docs/guidelines/workflow.md)), 4-layer testing & TDD ([testing.md](docs/guidelines/testing.md)), and review formatting ([review-comment-format.md](docs/guidelines/review-comment-format.md)).                                                                                                                       |
| **Product Specifications (OKF)** | `docs/specs/*.md`                      | 2-Layer Living Documentation with OKF YAML frontmatter ([docs/index.md](docs/index.md)): **Canonical App Specs** (`requirements.md`, `architecture.md`, `db-schema.md`, `screen-transitions.md`, `features/*.md`, `engine/*.md`, `providers/*.md`) + **Per-Issue Delta Specs** (`changes/issue-XX-*.md`, archived to `changes/archive/` upon completion). |
| **Quality & Handover Log**       | `docs/quality/bug-and-handover-log.md` | Defect tracking (Production vs. Support, root causes `L`/`S`/`D`/`B`/`A`) and Handover items (`HO-xx`). Archived milestone logs live in `docs/quality/archive/`.                                                                                                                                                                                                 |
| **AI Root Constitution**         | `AGENTS.md` (this file)                | Loaded natively by Antigravity; bridged to GitHub Copilot via `.github/copilot-instructions.md`.                                                                                                                                                                                                                                                                 |
| **AI Workflow Skills**           | `.github/skills/<name>/SKILL.md`       | AI execution & subagent orchestration procedures referencing `docs/guidelines/`. Mapped for Antigravity via `.agents/skills.json`.                                                                                                                                                                                                                               |
| **Custom Agents**                | `.github/agents/<name>.agent.md`       | Independent PR reviewer (`pr-reviewer`) and milestone final reviewer (`phase-final-reviewer`).                                                                                                                                                                                                                                                                   |

---

## 3. Core Development Rules & Issue-Driven Micro-Waterfall

Always read [docs/index.md](docs/index.md) and follow [docs/guidelines/workflow.md](docs/guidelines/workflow.md) and [docs/guidelines/testing.md](docs/guidelines/testing.md).

1. **Hybrid Phase Progression**:
   - **Phase 1 (AI Foundation) & Phase 2 (Core Specs)**: Collaborate with the user and commit directly to build the foundation and initial `docs/specs/` rapidly.
   - **Phase 3 (PoC / Walking Skeleton) & Phase 4+ (Iterative Feature Development)**: Follow the strict **Issue + PR + Independent AI Review (`pr-reviewer`) + Task Completion Gate (7 conditions)** workflow.
2. **Issue-Driven Micro-Waterfall (No Premature Coding)**:
   - Never jump straight into production code for a feature request.
   - Progress sequentially per feature: **① Open Questions Clarification → ② Design Update PR (create Delta Spec `docs/specs/changes/issue-XX-*.md` + update Canonical App Specs in `docs/specs/` in `Review` state + Sub-issue breakdown + decide Android physical device verification timing [Parent Issue vs. Milestone] and record in Delta Spec / Parent Issue / `HO-xx`, merged by human to become `Approved`) → ③ MK PRs (TDD Red-Green-Refactor, 1-to-1 Story/UT, VRT, auto-merged by Orchestrator AI upon passing Gates 1–6 unless an escalation condition applies) → ④ IT PR (Playwright `SCN-xx` system-wide regression, Handover resolution, archiving the Delta Spec to `docs/specs/changes/archive/`, presenting structured Android physical device test items upon passing Gates 1–6 when Parent-Issue verification is required, and merged by human to close the parent Issue)**.
   - Follow the [iterative GitHub task-management skill](.github/skills/iterative-github-task-management/SKILL.md).
3. **4-Layer Testing & Implementation Discipline**:
   - Follow [docs/guidelines/testing.md](docs/guidelines/testing.md) and the [C・UT workflow skill](.github/skills/c-ut-workflow/SKILL.md).
   - **Streaming & Binary Engine Layer**: Pure unit tests using deterministic in-memory binary ZIP/ZIP64/CP932 fixtures (`__fixtures__/`), zero live network calls. Separate core worker/coordinator/LRU/prefetch state machines from thin `*.worker.ts` bootstrap wrappers.
   - **Metadata & Filename Provider Layer**: Pure unit tests with local XML/JSON/GraphQL response fixtures (`__fixtures__/`) for NDL Search, Google Books, Rakuten Books, AniList, and smart filename parsing. Keep global `CapacitorHttp.enabled: false` so Worker `fetch` streams raw binary `ArrayBuffer` without Base64 bridge overhead; invoke `CapacitorHttp.request()` explicitly inside `MetadataHttpClient` only for CORS-restricted bibliographic APIs.
   - **Storage & Sync Layer**: Abstract Dexie.js (IndexedDB) behind repository interfaces; use `fake-indexeddb` initialized via `resetTestDb()` in UT/Storybook/IT.
   - **WebGL2 Viewer, UI & Bridge Layer**: Enforce 1-to-1 `*.stories.tsx` and `*.test.tsx` (Portable Stories `composeStories`) for every `*.tsx`, strict parent-child test isolation (`vi.spyOn(...).mockImplementation(() => null)`), `ImageBitmap.close()` L1 eviction verification, **100% C0/C1/Functions coverage**, and Storybook VRT (1280px / 375px).
   - **Japanese Naming & Commits**: Write Vitest `it` descriptions and Storybook display names/JSDoc in Japanese. Use English Conventional Commits types with Japanese summaries (e.g., `feat(engine): ZIP64 Central Directoryの1RTT切り出し処理を実装（Green）`). Follow the [Git workflow skill](.github/skills/git-workflow/SKILL.md).
4. **Defect Recording & Design Sync (`D` Category)**:
   - Record defects found during TDD Green/Refactor, VRT/IT, or AI review in [docs/quality/bug-and-handover-log.md](docs/quality/bug-and-handover-log.md) and the PR body.
   - If a defect's root cause is **`D` (Design / Specification mismatch or omission)**, **never fix code alone**; update the corresponding `docs/specs/` document in the same PR and record both commits.

---

## 4. Context Management & Subagent Orchestration

- **Orchestrator vs. Worker Separation**:
  To prevent main session context exhaustion and compaction degradation, the main agent acts as an **orchestrator** (requirement analysis, task breakdown, subagent delegation, PR creation, and gate verification).
  Delegate heavy implementation, TDD Red-Green-Refactor cycles, test runs, and review fixes **sequentially** to general subagents (`self`) with explicit instructions to follow `.github/skills/c-ut-workflow/SKILL.md`.
- **Read-Only Research**:
  Use lightweight read-only `research` subagents for broad codebase or documentation surveys.
- **Compaction Recovery Protocol**:
  If context compaction occurs during a session, do not rely solely on the summary's `Next Steps`. Re-verify the current state against the **Task Completion Gate** below before reporting completion.

---

## 5. Task Completion Gate (7 Mandatory Conditions)

In Phase 3 and beyond, **never report a task or PR as complete merely upon creating a PR**. Every PR must pass all 7 gates defined in [docs/guidelines/workflow.md](docs/guidelines/workflow.md#4-task-completion-gate7つの完了条件):

1. **Static Checks & Automated Tests PASS**: `npm run lint:okf`, `npm run typecheck`, `npm run lint`, `npm run format:check`, and required tests (`npm run test:unit`, `npm run test:coverage` with 100% C0/C1/Functions) PASS.
2. **VRT Parity PASS**: If UI/Storybook stories changed, VRT snapshots (1280px / 375px) are updated (`npm run test:vrt:update`) and verified (`npm run test:vrt`) PASS.
3. **PR Created with Issue Link**: PR includes the defect/handover mini-tables and `Closes #N` (`Refs #N` only for intermediate split PRs). **AI agents must never close issues directly (`gh issue close`) or self-approve PRs (`gh pr review --approve`).**
4. **GitHub Actions PASS**: Required remote CI workflow (`quality-gate` covering static checks, UT, VRT, IT, and Android Java compilation) PASS.
5. **Independent AI Review**: Conducted by the [PR reviewer agent](.github/agents/pr-reviewer.agent.md) adhering to [docs/guidelines/review-comment-format.md](docs/guidelines/review-comment-format.md).
6. **Review Remediation & Independent Re-review Confirmation**: If review findings exist, fixes are committed and verified, and the [PR reviewer agent](.github/agents/pr-reviewer.agent.md) is re-invoked for Round 2+ re-review to confirm resolution and resolve threads on the PR. AI agents must never self-declare Gate 6 PASS without independent reviewer confirmation.
7. **Merge Execution (Human Approval Gate vs. AI Autonomous Merge)**:
   - **Human Approval & Merge Required**: Step 2 Design Update PRs (`Refs #ParentIssue`), Step 4 Final IT / Parent Issue Closing PRs (`Closes #ParentIssue`), Milestone Step 3 Final Approval / Quality Analysis / Archive PRs (`Closes #MilestoneIssue`), and any PR matching the escalation conditions in [docs/guidelines/workflow.md §4.1](docs/guidelines/workflow.md#41-ai-自律マージの停止人間エスカレーション条件) (external spec/schema changes, new dependencies/permissions/domains, governance/CI/release version changes, or unresolved review threads).
   - **AI Autonomous Merge Permitted**: Intermediate Step 3 MK Sub-issue PRs (`Closes #Sub-issue`) and Milestone Step 2 Cross-Review Remediation PRs (`Closes #Sub-issue`, including physical-device bug fix PRs) that pass Gates 1–6 with zero escalation conditions may be merged autonomously by the Orchestrator AI (`gh pr merge --squash --delete-branch`) to proceed immediately to the next step.

---

## 6. Milestone Reviews & Continuous Improvement (Kaizen)

- At the end of Phase 3 (PoC) and each Mini-Release Milestone (`v0.1`, `v0.2`, etc.), follow the 3-step Milestone workflow in [docs/guidelines/workflow.md §5](docs/guidelines/workflow.md#5-ミニリリース-milestone-と品質改善kaizenループ) and the [phase-final-review skill](.github/skills/phase-final-review/SKILL.md): **Step 1** (multi-model cross-deliverable review via `phase-final-reviewer`) → **Step 2** (auto-merged remediation PRs for `R1-xx` findings, followed by presenting structured Android physical device test items and resolving any device defects) → **Step 3** (once all review findings and device verifications converge, create a single Final Approval PR `Closes #MilestoneIssue` combining the quality analysis Kaizen report, guideline/skill updates, archiving bug/handover logs to `docs/quality/archive/`, setting canonical specs to `Approved`, and bumping `package.json` `version` to `X.Y.0` per [docs/guidelines/workflow.md §5.1](docs/guidelines/workflow.md#51-バージョン採番semverと-git-tag--github-release-自動化ルール) to trigger automated `vX.Y.0` Git Tag / GitHub Release creation upon human merge).
- **Multi-Model Orchestrator Reviews**: To leverage differing model perspectives (breadth, architectural depth, latent bug detection), running multiple orchestrators across different LLM models is supported. To prevent `R1-xx` ID collisions when orchestrators are launched concurrently, each orchestrator must **never** read existing issue comments at the start of the review; instead, it fetches existing comments **immediately before posting** (after all subagent verification and local quality checks finish) to assign sequential IDs (`R1-01`, `R1-02`...), and re-checks comments **immediately after posting** to auto-renumber its own comment via `gh api --method PATCH` if a concurrent post caused an ID collision.
- When modifying repository/AI configurations (`.devcontainer/`, `.agents/`, `.github/`, `AGENTS.md`), always follow the [repo-config-management skill](.github/skills/repo-config-management/SKILL.md).
- When a session experiences repeated rework or user corrections, use the [retrospective skill](.github/skills/retrospective/SKILL.md).
