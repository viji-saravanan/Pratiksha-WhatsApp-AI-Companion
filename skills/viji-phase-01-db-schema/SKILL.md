---
name: viji-phase-01-db-schema
description: Implement or review Viji Helper Phase 1 Postgres schema work. Use for migrations, ERD alignment, prefixed table and column naming, idempotency constraints, seed data, migration runners, and migration tests.
---

# Phase 1 Core Database Schema

## Goal

Create durable identity, conversation, message, sync recovery, media job, and audit schema before runtime behavior.

## Required Context

Start with $viji-project-guardrails when available, then read:

- [docs/DEV_GUIDE.md](/Volumes/Arya 1TB/VijiAI/workspace/viji-helper/docs/DEV_GUIDE.md)
- [docs/ERD.md](/Volumes/Arya 1TB/VijiAI/workspace/viji-helper/docs/ERD.md)
- [docs/09_IMPLEMENTATION_PHASES.md](/Volumes/Arya 1TB/VijiAI/workspace/viji-helper/docs/09_IMPLEMENTATION_PHASES.md)

## Workflow

- Implement only tables already listed for Phase 1 unless `docs/ERD.md` is updated first.
- Use physical columns with singular table-stem prefixes, including primary keys and timestamps.
- Use semantic foreign key names such as `sender_core_contact_id` and `target_msg_conversation_id`.
- Add idempotency constraints for adapter events, inbound messages, sync cursors, and media jobs.
- Seed only synthetic local dev data; do not commit real phone numbers, JIDs, or messages.

## Guardrails

- Do not create generic columns like `id`, `created_at`, `updated_at`, `state`, or `name`.
- Do not store large blobs in Postgres.
- Do not add new tables without ERD and phase-plan updates.

## Acceptance Checks

- node --test tests/migrations/phase1-migrations.test.mjs
- Run migration tests against an empty disposable database.
- Run re-run or dirty-state migration behavior checks.
- node --test tests/**/*.test.mjs
- corepack pnpm typecheck
- docker compose config

## Review Focus

- Compare every table and column against `docs/ERD.md`.
- Verify uniqueness for duplicate external messages and sync cursors.
- Verify foreign keys and indexes support reconnect/backfill.
