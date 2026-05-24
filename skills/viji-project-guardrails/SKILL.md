---
name: viji-project-guardrails
description: Apply shared Viji Helper engineering guardrails. Use before implementation, review fixes, docs changes, storage work, database work, WhatsApp adapter work, policy changes, AI draft behavior, monitoring, backups, or any phase transition.
---

# Viji Helper Project Guardrails

## Goal

Keep every change aligned with the local-first, SSD-backed, unattended trusted-contact project constraints.

## Required Context

Read:

- [docs/DEV_GUIDE.md](/Volumes/Arya 1TB/VijiAI/workspace/viji-helper/docs/DEV_GUIDE.md)
- [docs/09_IMPLEMENTATION_PHASES.md](/Volumes/Arya 1TB/VijiAI/workspace/viji-helper/docs/09_IMPLEMENTATION_PHASES.md)
- [docs/ERD.md](/Volumes/Arya 1TB/VijiAI/workspace/viji-helper/docs/ERD.md)
- [docs/TDD.md](/Volumes/Arya 1TB/VijiAI/workspace/viji-helper/docs/TDD.md)
- [docs/PROJECT_STRUCTURE.md](/Volumes/Arya 1TB/VijiAI/workspace/viji-helper/docs/PROJECT_STRUCTURE.md)

## Workflow

- Work only in `/Volumes/Arya 1TB/VijiAI/workspace/viji-helper`; do not revive the old Desktop copy.
- Confirm the SSD root `/Volumes/Arya 1TB/VijiAI` and `.viji-helper-root` sentinel when storage behavior is touched.
- Read the active phase in `docs/09_IMPLEMENTATION_PHASES.md` before editing code.
- Update docs first when a change would alter architecture, tables, services, storage paths, policies, retention, or dependencies.
- Implement one phase slice at a time, then run its acceptance checks and review before continuing.
- Stop on open P1/P2 findings, failing checks, missing SSD root, storage critical state, or uncertain WhatsApp behavior.

## Guardrails

- Keep heavy runtime state under `VIJI_DATA_ROOT`; never commit stores, media, models, logs, backups, secrets, phone numbers, or real messages.
- Default to policy-gated trusted-contact behavior; unknown contacts and stale context must not auto-send.
- Route WhatsApp behavior through adapter boundaries only; only `apps/wa-adapter-wacli` may own `wacli` execution.
- Use prefixed table and column names from `docs/ERD.md`; never create generic physical columns such as `id` or `created_at`.
- Prefer idle/degraded no-reply behavior over unsafe fallback replies.

## Acceptance Checks

- node --test tests/**/*.test.mjs
- corepack pnpm typecheck
- docker compose config

## Review Focus

- Verify package boundaries from `docs/DEV_GUIDE.md`.
- Verify no unrelated refactors or private data were introduced.
- End every phase with the completion template from `docs/09_IMPLEMENTATION_PHASES.md`.
