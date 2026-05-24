---
name: viji-phase-06-outbox
description: Implement or review Viji Helper Phase 6 outbox work. Use for recipient confirmation and denial operations, agent_outbound_jobs, agent_send_attempts, recorded send intents, idempotency keys, and send audit events.
---

# Phase 6 Outbox and Recipient Confirmation

## Goal

Build the safe path from policy-permitted replies and recipient-confirmed resource proposals to queued outbound jobs, with live WhatsApp dispatch disabled until Phase 8 hardening is accepted.

## Required Context

Start with $viji-project-guardrails when available, then read:

- [docs/DEV_GUIDE.md](/Volumes/Arya 1TB/VijiAI/workspace/viji-helper/docs/DEV_GUIDE.md)
- [docs/09_IMPLEMENTATION_PHASES.md](/Volumes/Arya 1TB/VijiAI/workspace/viji-helper/docs/09_IMPLEMENTATION_PHASES.md)
- [docs/ERD.md](/Volumes/Arya 1TB/VijiAI/workspace/viji-helper/docs/ERD.md)

## Workflow

- Require exact-file recipient confirmation before queueing resource sends when policy demands it.
- Generate stable outbound idempotency keys.
- Re-check policy immediately before dispatch.
- Record recipient confirm/deny, send, block, and failure audit events.
- Record send intents in tests; do not enable live `wacli` sends until the guarded send phase.

## Guardrails

- Do not let duplicate recipient confirmations create duplicate jobs.
- Do not send denied or expired resource proposals.
- Do not store unredacted message bodies in audit details.

## Acceptance Checks

- Run safety test: redacted inbound fixture -> policy decision or recipient confirmation -> outbound job -> recorded send intent.
- node --test tests/**/*.test.mjs
- corepack pnpm typecheck
- docker compose config

## Review Focus

- Verify retries preserve the same idempotency key.
- Verify failed sends remain retryable unless terminal.
- Verify audit events are redacted.
