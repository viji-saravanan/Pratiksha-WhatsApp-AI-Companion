---
name: viji-phase-02-db-repositories
description: Implement or review Viji Helper Phase 2 data-access work. Use for packages/db, repository APIs, transaction helpers, typed SQL boundaries, and repository tests over contacts, conversations, messages, sync, media, and audit data.
---

# Phase 2 DB Access Layer

## Goal

Provide typed repository behavior so apps and workers do not spread raw SQL across the codebase.

## Required Context

Start with $viji-project-guardrails when available, then read:

- [docs/DEV_GUIDE.md](/Volumes/Arya 1TB/VijiAI/workspace/viji-helper/docs/DEV_GUIDE.md)
- [docs/ERD.md](/Volumes/Arya 1TB/VijiAI/workspace/viji-helper/docs/ERD.md)
- [docs/09_IMPLEMENTATION_PHASES.md](/Volumes/Arya 1TB/VijiAI/workspace/viji-helper/docs/09_IMPLEMENTATION_PHASES.md)

## Workflow

- Create `packages/db` as the only normal owner of Postgres access.
- Expose behavior-level repository methods, not table-shaped plumbing.
- Wrap cursor/message writes in transactions.
- Return explicit idempotent duplicate outcomes for inbound messages and jobs.
- Build repository tests on disposable databases or a controlled test harness.

## Guardrails

- Do not let apps connect directly to Postgres.
- Do not duplicate SQL for core message writes.
- Do not leak raw adapter payloads outside redacted operations storage.

## Acceptance Checks

- Run repository tests against the disposable database.
- node --test tests/**/*.test.mjs
- corepack pnpm typecheck
- docker compose config

## Review Focus

- Verify transaction boundaries around message plus cursor writes.
- Verify repository names and SQL use ERD-prefixed columns.
- Verify no untyped SQL escapes into app packages.
