---
name: viji-phase-18-skills
description: Create or maintain Viji Helper project Codex skills. Use when adding phase skills, updating this local skill pack, validating SKILL.md files, preparing installation into Codex skills, or aligning skills with DEV_GUIDE, ERD, and the implementation phase plan.
---

# Phase 18 Project Skills

## Goal

Keep project-specific Codex skills compact, current, and safe to use for future phase work.

## Required Context

Start with $viji-project-guardrails when available, then read:

- [docs/DEV_GUIDE.md](/Volumes/Arya 1TB/VijiAI/workspace/viji-helper/docs/DEV_GUIDE.md)
- [docs/09_IMPLEMENTATION_PHASES.md](/Volumes/Arya 1TB/VijiAI/workspace/viji-helper/docs/09_IMPLEMENTATION_PHASES.md)
- [docs/10_CODEX_SKILLS.md](/Volumes/Arya 1TB/VijiAI/workspace/viji-helper/docs/10_CODEX_SKILLS.md)

## Workflow

- Use `scripts/generate-project-skills.mjs` as the source for generated phase skill bodies.
- Keep each skill concise and point to project docs instead of duplicating long design content.
- Validate every skill with `corepack pnpm skills:validate` after generation; use `quick_validate.py` too when Python has `PyYAML` available.
- Install globally only when the user wants automatic discovery; otherwise keep project-local.
- Update `docs/10_CODEX_SKILLS.md` when the skill map changes.

## Guardrails

- Do not put secrets, private contact data, or real message examples in skills.
- Do not add README or extra docs inside skill folders.
- Do not let skills contradict the developer guide or ERD.

## Acceptance Checks

- node scripts/generate-project-skills.mjs
- corepack pnpm skills:validate

## Review Focus

- Verify descriptions trigger on the right phase tasks.
- Verify agent metadata remains short and accurate.
- Verify global installation instructions require a Codex restart.
