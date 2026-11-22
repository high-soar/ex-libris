# Project Agent Guidelines (ExLibris)

Welcome to **ExLibris** (`ex-libris`), an Android & Web ultra-fast comic streaming reader and virtual bookshelf application built with **React (TypeScript / Vite) + Capacitor (`com.highsoar.exlibris`) + Web Workers (Comlink) + Raw WebGL2 + Dexie.js**.
This repository is configured exclusively for **Google Antigravity Remote Agent** with a strict Single Source of Truth (SSOT) architecture.

---

## 1. Environment & Remote Agent Architecture

- **Execution Environment**: Google Antigravity Remote Agent VM (Debian 12 `bookworm`, read-only `/`, no `sudo`/`apt`, writable `/home/antigravity` & `/tmp`)
- **Automated VM Bootstrap**: `.agents/environment.json` idempotently configures `.githooks` and runs `npm ci && npx playwright install chromium` (user-space install without `--with-deps`) on new cloud VMs.
- **Runtimes & Stack**: Node.js 24, npm, React 19, TypeScript, Vite, Tailwind CSS, Zustand, Dexie.js (IndexedDB + `fake-indexeddb`), Comlink (Web Workers + Transferable Objects), Raw WebGL2, `DecompressionStream` (`fflate` fallback), Capacitor (`@capacitor/core`, `@capacitor/app`, `@capacitor/android`)
- **Preinstalled CLI & Fonts**: GitHub CLI (`gh`), ripgrep (`rg`), zip/unzip, `keytool`, Chromium, DejaVu Sans (`fonts-dejavu-core`), Noto CJK (`fonts-noto-cjk`). GitHub Actions `vrt-and-e2e` runs in `container: node:24-bookworm` to guarantee 100% OS/font rendering parity with the Remote Agent VM.
- **Remote Agent VM vs. GitHub Actions & Physical Device Boundary**:
  - **Inside Remote Agent VM**: Run Web builds, OKF validation (`npm run lint:okf`), static checks, Vitest unit tests (100% coverage), Storybook VRT (1280px tablet landscape / 375px mobile portrait with SwiftShader WebGL2), Playwright IT, `npx cap sync android`, and optional live UI previews (`IsDaemon: true` server + `.url.json` artifact).
  - **In GitHub Actions (`ci.yml` / `build-android.yml` / `release.yml`)**: Run full CI `quality-gate` (including Temurin 21 + Gradle `compileDebugJavaWithJavac`), build signed verification APKs (`gh workflow run build-android.yml --ref <branch>`), and attach signed APKs to GitHub Releases.
  - **On Physical Android Device (PC-less Workflow & Google Drive Separation)**: Follow the [android-apk-distribution skill](.agents/skills/android-apk-distribution/SKILL.md) to automatically download/extract `build-android.yml` (`debug`) outputs into Google Drive `app-debug.apk` before requesting device testing, update Google Drive `app-release.apk` separately only after `release.yml` releases, share boundary test archives from [test/fixtures/manual/](test/fixtures/manual/README.md) when applicable, and capture device runtime diagnostics via the in-app ring-buffer diagnostic logger (`src/diagnostics/`, 1-tap clipboard copy with automatic token redaction) instead of requiring USB `adb logcat`.

---

## 2. AI Configuration & SSOT Architecture

To prevent duplication between human rules and AI skills, this repository strictly separates responsibilities:

| Component                        | Source of Truth (SSOT)                 | Purpose & Integration                                                                                                                                                                                                                                                                                                                                     |
| :------------------------------- | :------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Human & AI Shared Guidelines** | `docs/guidelines/*.md`                 | Canonical rules for workflow ([workflow.md](docs/guidelines/workflow.md)), 4-layer testing & TDD ([testing.md](docs/guidelines/testing.md)), and review formatting ([review-comment-format.md](docs/guidelines/review-comment-format.md)).                                                                                                                |
| **Product Specifications (OKF)** | `docs/specs/*.md`                      | 2-Layer Living Documentation with OKF YAML frontmatter ([docs/index.md](docs/index.md)): **Canonical App Specs** (`requirements.md`, `architecture.md`, `db-schema.md`, `screen-transitions.md`, `features/*.md`, `engine/*.md`, `providers/*.md`) + **Per-Issue Delta Specs** (`changes/issue-XX-*.md`, archived to `changes/archive/` upon completion). |
| **Quality & Handover Log**       | `docs/quality/bug-and-handover-log.md` | Defect tracking (Production vs. Support, root causes `L`/`S`/`D`/`B`/`A`) and Handover items (`HO-xx`). Archived milestone logs live in `docs/quality/archive/`.                                                                                                                                                                                          |
| **AI Root Constitution**         | `AGENTS.md` (this file)                | Loaded natively by Antigravity Remote Agent as the top-level repository instruction set.                                                                                                                                                                                                                                                                  |
| **AI Workflow Skills**           | `.agents/skills/<name>/SKILL.md`       | Native Antigravity skills (supporting `/skill-name` slash commands and automatic discovery) referencing `docs/guidelines/`.                                                                                                                                                                                                                               |
| **Independent Reviewer Prompts** | `.agents/agents/<name>.md`             | System prompts for independent PR review ([pr-reviewer.md](.agents/agents/pr-reviewer.md), invoked via `define_subagent`) and milestone cross-deliverable review ([phase-final-reviewer.md](.agents/agents/phase-final-reviewer.md)).                                                                                                                     |
| **Temporary Reference Assets**   | `reference/`                           | Initial concept master doc and Yommy reference implementations kept temporarily outside `docs/` during bootstrap and early porting; remove once fully ported.                                                                                                                                                                                             |

---

## 3. Core Development Rules & Issue-Driven Micro-Waterfall

Always read [docs/index.md](docs/index.md) and follow [docs/guidelines/workflow.md](docs/guidelines/workflow.md) and [docs/guidelines/testing.md](docs/guidelines/testing.md).

1. **Unified 4-Phase Progression**:
   - **Phase 1 (AI Foundation & Test/CI Harness)**: Build `.agents/`, `docs/`, Vite/React/Vitest/Storybook/Playwright/Capacitor scaffolding, and bring GitHub Actions `quality-gate` to Green.
   - **Phase 2 (Core Specs)**: Collaborate with the user to finalize the initial Canonical App Specs in `docs/specs/` and promote them to `Approved (Phase 2)`.
   - **Phase 3 (PoC / Walking Skeleton) & Phase 4+ (Iterative Feature Development)**: Enforce the strict **Issue + PR + Independent AI Review (`pr-reviewer`) + Task Completion Gate (7 conditions)** workflow.
2. **Issue-Driven Micro-Waterfall (No Premature Coding)**:
   - Never jump straight into production code for a feature request.
   - Progress sequentially per feature: **① Open Questions Clarification → ② Design Update PR (create Delta Spec `docs/specs/changes/issue-XX-*.md` + update Canonical App Specs in `docs/specs/` in `Review` state + Sub-issue breakdown + decide Android physical device verification timing [Parent Issue vs. Milestone] and record in Delta Spec / Parent Issue / `HO-xx`, merged by human to become `Approved`) → ③ MK PRs (TDD Red-Green-Refactor, 1-to-1 Story/UT, VRT, auto-merged by Orchestrator AI upon passing Gates 1–6 unless an escalation condition applies) → ④ IT PR (Playwright `SCN-xx` system-wide regression, Handover resolution, archiving the Delta Spec to `docs/specs/changes/archive/`, triggering `build-android.yml` `debug`, placing `app-debug.apk` on Google Drive separately from `app-release.apk`, and presenting structured Android physical device test items upon passing Gates 1–6 when Parent-Issue verification is required, merged by human to close the parent Issue)**.
   - Follow the [iterative GitHub task-management skill](.agents/skills/iterative-github-task-management/SKILL.md).
3. **4-Layer Testing & Implementation Discipline**:
   - Follow [docs/guidelines/testing.md](docs/guidelines/testing.md) and the [C・UT workflow skill](.agents/skills/c-ut-workflow/SKILL.md).
   - **Streaming & Binary Engine Layer**: Pure unit tests using deterministic in-memory binary ZIP/ZIP64/CP932 fixtures (`__fixtures__/`), zero live network calls. Separate core worker/coordinator/LRU/prefetch state machines (`*Core.ts`) from thin `*.worker.ts` bootstrap wrappers.
   - **Metadata & Filename Provider Layer**: Pure unit tests with local XML/JSON/GraphQL response fixtures (`__fixtures__/`) for NDL Search, Google Books, Rakuten Books, AniList, and smart filename parsing. Keep global `CapacitorHttp.enabled: false` so Worker `fetch` streams raw binary `ArrayBuffer` without Base64 bridge overhead; invoke `CapacitorHttp.request()` explicitly inside `MetadataHttpClient` only for CORS-restricted bibliographic APIs.
   - **Storage & Sync Layer**: Abstract Dexie.js (IndexedDB) behind repository interfaces; use `fake-indexeddb` initialized via `resetTestDb()` in UT/Storybook/IT.
   - **WebGL2 Viewer, Diagnostics, UI & Bridge Layer**: Enforce 1-to-1 `*.stories.tsx` and `*.test.tsx` (Portable Stories `composeStories`) for every `*.tsx`, strict parent-child test isolation (`vi.spyOn(...).mockImplementation(() => null)`), `ImageBitmap.close()` L1 eviction verification, secret-redacted in-app diagnostic logging (`src/diagnostics/`), **100% C0/C1/Functions/Lines coverage**, and Storybook VRT (1280px / 375px).
   - **Japanese Naming & Commits**: Write Vitest `it` descriptions and Storybook display names/JSDoc in Japanese. Use English Conventional Commits types with Japanese summaries (e.g., `feat(engine): ZIP64 Central Directoryの1RTT切り出し処理を実装（Green）`). Follow the [Git workflow skill](.agents/skills/git-workflow/SKILL.md).
4. **Defect Recording & Design Sync (`D` Category)**:
   - Record defects found during TDD Green/Refactor, VRT/IT, or AI review in [docs/quality/bug-and-handover-log.md](docs/quality/bug-and-handover-log.md) and the PR body.
   - If a defect's root cause is **`D` (Design / Specification mismatch or omission)**, **never fix code alone**; update the corresponding `docs/specs/` document in the same PR and record both commits.

---

## 4. Remote Agent Subagent Orchestration & Workspace Rules

- **Orchestrator vs. Worker Separation (`Workspace: "inherit"` Sequential Only)**:
  - The main agent acts as an **orchestrator** (requirement analysis, task breakdown, subagent delegation, PR creation, APK workflow dispatch, and gate verification).
  - Always invoke subagents with `Workspace: "inherit"` and `Model: "inherit"` (branched/shared workspaces are unsupported in Remote Agent; avoid `git worktree` and run one clean topic branch at a time).
  - Delegate heavy implementation, TDD Red-Green-Refactor cycles, test runs, and review fixes **sequentially** to general subagents (`self`) with explicit instructions to follow [.agents/skills/c-ut-workflow/SKILL.md](.agents/skills/c-ut-workflow/SKILL.md).
- **Read-Only Offline Research (`research`)**:
  - `research` subagents run in a read-only sandbox **without network access** (`gh` CLI cannot run inside `research`). Use `research` for local codebase/spec surveys, and run `gh` queries from the orchestrator or a `define_subagent` agent.
- **Independent PR Reviewer (`pr-reviewer` via `define_subagent`)**:
  - For Gate 5 and Gate 6, define a dedicated `pr-reviewer` subagent via `define_subagent` (`enable_write_tools: true` so it can run `gh pr view`/`gh pr diff`/`gh pr comment` and read-only checks) using [.agents/agents/pr-reviewer.md](.agents/agents/pr-reviewer.md) as its system prompt, ensuring review happens in an isolated conversation context free from implementation bias.
- **Compaction Recovery Protocol**:
  - If context compaction occurs during a session, do not rely solely on the summary's `Next Steps`. Re-verify the current state against the **Task Completion Gate** below before reporting completion.

---

## 5. Task Completion Gate (7 Mandatory Conditions)

In Phase 3 and beyond, **never report a task or PR as complete merely upon creating a PR**. Every PR must pass all 7 gates defined in [docs/guidelines/workflow.md](docs/guidelines/workflow.md#4-task-completion-gate7つの完了条件):

1. **Static Checks & Automated Tests PASS**: `npm run lint:okf`, `npm run typecheck`, `npm run lint`, `npm run format:check`, and required tests (`npm run test:unit`, `npm run test:coverage` with 100% C0/C1/Functions/Lines) PASS.
2. **VRT Parity PASS**: If UI/Storybook stories changed, VRT snapshots (1280px / 375px) are updated (`npm run test:vrt:update`) and verified (`npm run test:vrt`) PASS.
3. **PR Created with Issue Link**: PR includes the defect/handover mini-tables and `Closes #N` (`Refs #N` only for intermediate split PRs). **AI agents must never close issues directly (`gh issue close`) or self-approve PRs (`gh pr review --approve`).**
4. **GitHub Actions PASS**: Required remote CI workflow (`quality-gate` covering static checks, UT, Debian 12 VRT/IT, and Android Java compilation) PASS.
5. **Independent AI Review**: Conducted in an isolated subagent context ([.agents/agents/pr-reviewer.md](.agents/agents/pr-reviewer.md)) adhering to [docs/guidelines/review-comment-format.md](docs/guidelines/review-comment-format.md).
6. **Review Remediation & Independent Re-review Confirmation**: If review findings exist, fixes are committed and verified, and the independent `pr-reviewer` subagent is re-invoked for Round 2+ re-review to confirm resolution on the PR. AI agents must never self-declare Gate 6 PASS without independent reviewer confirmation.
7. **Merge Execution (Human Approval Gate vs. AI Autonomous Merge)**:
   - **Human Approval & Merge Required**: Step 2 Design Update PRs (`Refs #ParentIssue`), Step 4 Final IT / Parent Issue Closing PRs (`Closes #ParentIssue`), Milestone Step 3 Final Approval / Quality Analysis / Archive PRs (`Closes #MilestoneIssue`), and any PR matching the escalation conditions in [docs/guidelines/workflow.md §4.1](docs/guidelines/workflow.md#41-ai-自律マージの停止人間エスカレーション条件).
   - **AI Autonomous Merge Permitted**: Intermediate Step 3 MK Sub-issue PRs (`Closes #Sub-issue`) and Milestone Step 2 Cross-Review Remediation PRs (`Closes #Sub-issue`, including physical-device bug fix PRs) that pass Gates 1–6 with zero escalation conditions may be merged autonomously by the Orchestrator AI (`gh pr merge --squash --delete-branch`) to proceed immediately to the next step.

---

## 6. Milestone Reviews & Continuous Improvement (Kaizen)

- At the end of Phase 3 (PoC) and each Mini-Release Milestone (`v0.1`, `v0.2`, etc.), follow the 3-step Milestone workflow in [docs/guidelines/workflow.md §5](docs/guidelines/workflow.md#5-ミニリリース-milestone-と品質改善kaizenループ) and the [phase-final-review skill](.agents/skills/phase-final-review/SKILL.md): **Step 1** (3-aspect `research` split review and optional multi-model concurrent Antigravity sessions with `R1-xx` just-in-time numbering & `PATCH` collision renumbering) → **Step 2** (auto-merged remediation PRs for `R1-xx` findings, followed by triggering `build-android.yml` `debug`, placing `app-debug.apk` on Google Drive separately from `app-release.apk`, presenting structured Android physical device test items + download links, and resolving any device defects) → **Step 3** (Final Approval PR `Closes #MilestoneIssue` combining the Kaizen report, guideline/skill updates, archiving logs to `docs/quality/archive/`, setting canonical specs to `Approved`, and bumping `package.json` `version` to `X.Y.0` to trigger automated `vX.Y.0` Git Tag + signed APK GitHub Release creation upon human merge, followed by updating Google Drive `app-release.apk`).
- When modifying repository/AI configurations (`.agents/`, `.github/`, `.githooks/`, `AGENTS.md`, `docs/guidelines/`), always follow the [repo-config-management skill](.agents/skills/repo-config-management/SKILL.md).
- When a session experiences repeated rework or user corrections, use the [retrospective skill](.agents/skills/retrospective/SKILL.md).
