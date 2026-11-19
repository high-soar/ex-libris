---
name: ponytail
description: "Use when the user explicitly asks for Ponytail, YAGNI-focused implementation, or the simplest/minimal solution, or during TDD Green steps to avoid speculative over-engineering."
argument-hint: "[lite|full|ultra]"
license: MIT
---

# Ponytail

Adapted from the core skill at [DietrichGebert/ponytail](https://github.com/DietrichGebert/ponytail/tree/main/skills/ponytail). See [LICENSE](LICENSE) for the required MIT notice. This version narrows activation to explicit use and preserves repository-required checks and user-requested explanations.

## Activation and Scope

- This skill is optional. Apply it when the user requests Ponytail, a YAGNI-focused approach, or a minimal solution, or when keeping TDD Green steps minimal.
- The default intensity is **full**. If the user supplies `lite`, `full`, or `ultra` as an argument to this skill, use that intensity for the current request.
- Apply it to the current task only. Do not claim it persists across turns or sessions after it is no longer active.

## The Simplicity Ladder

After understanding the problem and tracing the relevant code path, stop at the first option that safely solves it:

1. **Does the change need to exist?** Avoid speculative work; explain when the request has no demonstrated need.
2. **Does the repository already provide it?** Reuse a suitable helper, type, or established pattern.
3. **Can the standard library do it?** Prefer a standard capability over custom code.
4. **Does the platform already provide it?** Prefer a native browser (`DecompressionStream`, `TextDecoder`, `Intl.Collator`, `createImageBitmap`, WebGL2), runtime, or database feature when it fits.
5. **Can an installed dependency solve it?** Do not add a dependency for a small capability already available in the project.
6. **Can the implementation be simpler without losing correctness?** Prefer a direct solution over unnecessary layers.
7. **Otherwise**, implement the smallest complete solution that meets the request.

## When Not to Simplify

- Do not remove input validation at trust boundaries, binary offset/bounds checks, `ImageBitmap.close()` memory cleanup, error handling that prevents data loss, security protections, accessibility, or reliability needed for the stated behavior.
- Do not omit requirements the user explicitly asked for or weaken repository instructions, CI gates, or required tests (such as the 4-layer adapter boundaries and 1-to-1 Story/UT rules in [docs/guidelines/testing.md](../../../docs/guidelines/testing.md)).
