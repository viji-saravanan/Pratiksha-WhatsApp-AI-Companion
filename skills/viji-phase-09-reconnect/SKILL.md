---
name: viji-phase-09-reconnect
description: Implement or review Viji Helper Phase 9 reconnect and history work. Use for startup recovery, reconnect checkpoints, missed-message replay, all-available allowlisted history backfill, context freshness, sync cursors, and rolling summaries.
---

# Phase 9 Reconnect Recovery

## Goal

Make chat context durable across disconnects, reconnects, restarts, and interrupted backfills.

## Required Context

Start with $viji-project-guardrails when available, then read:

- [docs/DEV_GUIDE.md](/Volumes/Arya 1TB/VijiAI/workspace/viji-helper/docs/DEV_GUIDE.md)
- [docs/08_CHAT_CONTEXT_RECOVERY.md](/Volumes/Arya 1TB/VijiAI/workspace/viji-helper/docs/08_CHAT_CONTEXT_RECOVERY.md)
- [docs/09_IMPLEMENTATION_PHASES.md](/Volumes/Arya 1TB/VijiAI/workspace/viji-helper/docs/09_IMPLEMENTATION_PHASES.md)
- [docs/ERD.md](/Volumes/Arya 1TB/VijiAI/workspace/viji-helper/docs/ERD.md)

## Workflow

- Run adapter health/auth checks before processing inbound messages after startup or reconnect.
- Recover missed messages before generating new replies.
- Update message inserts and sync cursors transactionally.
- Mark context `fresh` only when recovery can prove the allowlisted chat is current.
- Keep backfill resumable and idempotent.

## Guardrails

- Do not auto-send while context is stale.
- Do not replace retained recent messages with summaries.
- Do not download broad media during backfill outside quota-controlled jobs.

## Acceptance Checks

- Run redacted reconnect, replay, backfill resume, and duplicate-replay fixture tests.
- node --test tests/**/*.test.mjs
- corepack pnpm typecheck
- docker compose config

## Review Focus

- Verify cursor semantics for latest, oldest backfilled, media, and reconnect checkpoints.
- Verify duplicate replay cannot create duplicate messages or drafts.
- Verify backfill progress is visible through CLI/API.
