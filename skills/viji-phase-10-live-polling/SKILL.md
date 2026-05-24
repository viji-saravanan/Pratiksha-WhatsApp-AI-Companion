---
name: viji-phase-10-live-polling
description: Implement or review Viji Helper Phase 10 live polling work, including allowlist chat matching, Postgres-canonical message intake, from_me persistence, poll timing, and safe chat ambiguity handling.
---

# Phase 10 Live Polling

## Goal

Import allowlisted live WhatsApp messages into Postgres as the only application message source of truth.

## Required Context

Start with $viji-project-guardrails when available, then read:

- [docs/DEV_GUIDE.md](/Volumes/Arya 1TB/VijiAI/workspace/viji-helper/docs/DEV_GUIDE.md)
- [docs/09_IMPLEMENTATION_PHASES.md](/Volumes/Arya 1TB/VijiAI/workspace/viji-helper/docs/09_IMPLEMENTATION_PHASES.md)
- [docs/08_CHAT_CONTEXT_RECOVERY.md](/Volumes/Arya 1TB/VijiAI/workspace/viji-helper/docs/08_CHAT_CONTEXT_RECOVERY.md)

## Workflow

- Match allowlisted contacts by exact JID, phone, or unique display-name match only.
- Import inbound and `from_me` messages into `msg_messages`.
- Keep polling intervals and command timeouts independently configurable.
- Store adapter cache as adapter-owned state only; do not read `wacli` SQLite as application state.

## Guardrails

- Do not bind an allowlisted contact to the first broad direct-chat result.
- Do not ingest non-allowlisted or group messages as trusted conversation context.
- Do not generate or send replies while reconnect recovery cannot prove context freshness.

## Acceptance Checks

- node --test tests/whatsapp/phase10-live-polling.test.mjs
- corepack pnpm typecheck
- node --test tests/**/*.test.mjs

## Review Focus

- Verify ambiguous chat search results are skipped.
- Verify duplicate live polls are idempotent.
- Verify `from_me` messages are persisted for reconnect context.
