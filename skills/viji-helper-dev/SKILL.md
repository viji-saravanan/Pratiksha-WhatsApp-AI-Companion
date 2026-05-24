---
name: viji-helper-dev
description: Follow Viji Helper development rules. Use when implementing, reviewing, testing, or documenting this repo, especially changes touching Docker lifecycle, Postgres schema, WhatsApp integration, AI behavior, dashboard UI, storage, files, logs, or phase status.
---

# Viji Helper Dev

## Goal

Keep future Viji Helper code generation aligned with the dev guide, ERD naming rules, SSD-backed Docker runtime, and WhatsApp/file-sharing safety constraints.

## Required Context

Start with $viji-project-guardrails when available, then read:

- [docs/DEV_GUIDE.md](/Volumes/Arya 1TB/VijiAI/workspace/viji-helper/docs/DEV_GUIDE.md)
- [docs/ERD.md](/Volumes/Arya 1TB/VijiAI/workspace/viji-helper/docs/ERD.md)
- [docs/09_IMPLEMENTATION_PHASES.md](/Volumes/Arya 1TB/VijiAI/workspace/viji-helper/docs/09_IMPLEMENTATION_PHASES.md)
- [docs/11_PHASE_COMPLETION_CHECKLIST.md](/Volumes/Arya 1TB/VijiAI/workspace/viji-helper/docs/11_PHASE_COMPLETION_CHECKLIST.md)

## Workflow

- Work only in `/Volumes/Arya 1TB/VijiAI/workspace/viji-helper`.
- Start from the active phase in `docs/09_IMPLEMENTATION_PHASES.md`.
- Use the existing package boundaries before adding new abstractions.
- Keep reusable code in shared packages instead of duplicating helpers across apps.
- Update `.env`, `.env.example`, docs, and tests whenever runtime behavior or configuration changes.
- Use Docker Compose as the normal runtime boundary; local `node apps/...` servers are development-only.

## Guardrails

- Do not revive the old Desktop copy.
- Do not hardcode private filenames, phone numbers, messages, dashboard statuses, or test-only fixtures into runtime UI.
- Keep canonical application state in Postgres, not SQLite or scattered JSON stores.
- Use ERD-prefixed table and column names; never add generic physical columns such as `id` or `created_at`.
- Do not let dashboard/API owner actions confirm file sends; Vijayalakshmi's WhatsApp confirmation is the authority.
- Do not route `wacli` execution outside the WhatsApp adapter boundary.
- Do not fake WhatsApp read receipts in Postgres only; live mark-read must go through the adapter-owned `wacli-mark-read` helper or a future adapter equivalent.
- Prefer idle/degraded no-reply behavior over unsafe fallback replies.

## Acceptance Checks

- Run focused tests for the changed behavior.
- node --test tests/**/*.test.mjs
- corepack pnpm typecheck
- docker compose --profile dashboard config
- Verify the dashboard visually after frontend changes.

## Review Focus

- Update `docs/11_PHASE_COMPLETION_CHECKLIST.md`.
- Record checks run and any remaining blocked gates.
- Stop if a P1/P2 review finding, failing test, storage critical state, or uncertain live WhatsApp behavior remains.
