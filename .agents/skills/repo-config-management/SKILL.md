---
name: repo-config-management
description: "Use this skill when modifying, adding, or maintaining repository configurations, including .agents/, .github/, .githooks/, AGENTS.md, docs/guidelines/, skills, agents, or Git hooks."
---

# Repository Configuration & Remote Agent Governance

This skill defines the operational standards and procedures for maintaining configurations in the **ExLibris** (`ex-libris`) repository, configured exclusively for **Google Antigravity Remote Agent** with a strict Single Source of Truth (SSOT).

---

## 1. Architecture Overview (SSOT Policy)

To prevent configuration drift and duplication between human documentation and AI skills:

1. **Human & AI Shared Rules live in `docs/guidelines/`**:
   Workflow rules ([workflow.md](../../../docs/guidelines/workflow.md)), testing/TDD/VRT rules ([testing.md](../../../docs/guidelines/testing.md)), and review formats ([review-comment-format.md](../../../docs/guidelines/review-comment-format.md)) are maintained in `docs/guidelines/`.
2. **All Antigravity AI Assets live natively in `.agents/`**:
   - `.agents/environment.json`: Idempotent, non-interactive cloud VM setup script (`sudo`-free).
   - `.agents/skills/<skill-name>/SKILL.md`: Native Antigravity skills (slash commands & automatic semantic discovery) referencing `docs/guidelines/`.
   - `.agents/agents/<agent-name>.md`: System prompts for isolated reviewer subagents (`pr-reviewer`, `phase-final-reviewer`) invoked via `define_subagent`.
3. **GitHub Directory (`.github/`) is strictly for GitHub Platform Features**:
   Keep only GitHub Actions workflows (`.github/workflows/*.yml`) and Issue/PR templates in `.github/`. Do not introduce `.devcontainer/` or duplicate AI instructions under `.github/`.

```text
/
├── AGENTS.md                             # [SSOT] Root AI constitution & Remote Agent overview
├── docs/
│   └── guidelines/                       # [SSOT] Canonical workflow, testing, and review rules
├── .agents/
│   ├── environment.json                  # [VM Bootstrap] Cloud VM idempotent setup command
│   ├── agents/
│   │   └── *.md                          # [SSOT] Reviewer subagent prompts (pr-reviewer, phase-final-reviewer)
│   └── skills/
│       └── <skill-name>/
│           └── SKILL.md                  # [SSOT] Native Antigravity skill instructions
├── .githooks/                            # [Tracked] Repository-shared Git hook scripts
└── .github/
    ├── ISSUE_TEMPLATE/
    │   └── feature_request.md            # [Template] Feature request issue template with AI checklist
    ├── pull_request_template.md          # [Template] PR template with defect & handover mini-tables
    └── workflows/
        └── *.yml                         # [CI/CD] ci.yml (Debian 12 VRT parity), build-android.yml, release.yml
```

---

## 2. Configuration Maintenance Procedures

### A. Modifying Development Workflow, Testing, or Review Rules

1. **Target Files**: `docs/guidelines/workflow.md`, `docs/guidelines/testing.md`, or `docs/guidelines/review-comment-format.md`.
2. **Action**: Update the canonical guideline in `docs/guidelines/` first. Only update `AGENTS.md` or `.agents/skills/<name>/SKILL.md` if AI orchestration steps or high-level summaries also need adjustment.

### B. Adding or Updating a Skill or Reviewer Agent

1. **Target Directory**: `.agents/skills/<skill-name>/SKILL.md` or `.agents/agents/<agent-name>.md`
2. **Requirements**:
   - Include valid YAML frontmatter (`name` and `description`).
   - Reference `docs/guidelines/` for shared rules rather than copy-pasting long rule tables.

### C. Modifying Cloud VM Environment (`.agents/environment.json`) or CI Parity

1. **Target Files**: `.agents/environment.json`, `.github/workflows/ci.yml`.
2. **Requirements**:
   - Never use `sudo` or `apt-get` in `.agents/environment.json` (`/` is read-only in the Remote Agent sandbox; use `npx playwright install chromium` without `--with-deps`).
   - Keep the `vrt-and-e2e` job in `.github/workflows/ci.yml` on `container: node:24-bookworm` with `fonts-dejavu-core` and `fonts-noto-cjk` so OS/FreeType font rendering stays 100% identical to the Debian 12 Remote Agent VM.
   - Update `AGENTS.md` §1 if runtime versions or VM boundaries change.

### D. Adding or Modifying Git Hooks

1. Consult the [hook-ci-guidance skill](../hook-ci-guidance/SKILL.md) to decide what runs in `.githooks/` vs. `.github/workflows/`.
2. Keep shared hook scripts under `.githooks/` with executable permissions (`chmod +x`) and configure `core.hooksPath` idempotently via `.agents/environment.json` and `npm run prepare`.

---

## 3. Verification Checklist

Whenever configuration changes are made:

- [ ] **JSON Syntax**: Confirm `.agents/environment.json` and `package.json` are valid JSON.
- [ ] **Idempotency**: Verify `.agents/environment.json`'s `install` command exits `0` when run twice consecutively.
- [ ] **OKF & Markdown Links**: Run `npm run lint:okf` (`node .agents/skills/sdd/scripts/validate-okf.mjs`) and confirm all OKF frontmatter rules and relative links across `AGENTS.md`, `docs/`, and `.agents/` pass.
