---
name: viji-phase-16-chaos
description: Implement or review Viji Helper Phase 16 failure testing. Use for external-drive-missing tests, storage warning/full, DB unavailable, LLM unavailable, WhatsApp auth/network failures, duplicate inbound events, interrupted backfill, media failures, and no-unsafe-send proof.
---

# Phase 16 Failure and Chaos

## Goal

Prove failures enter visible idle/degraded states instead of unsafe sends.

## Required Context

Start with $viji-project-guardrails when available, then read:

- [docs/DEV_GUIDE.md](/Volumes/Arya 1TB/VijiAI/workspace/viji-helper/docs/DEV_GUIDE.md)
- [docs/09_IMPLEMENTATION_PHASES.md](/Volumes/Arya 1TB/VijiAI/workspace/viji-helper/docs/09_IMPLEMENTATION_PHASES.md)
- [docs/08_CHAT_CONTEXT_RECOVERY.md](/Volumes/Arya 1TB/VijiAI/workspace/viji-helper/docs/08_CHAT_CONTEXT_RECOVERY.md)

## Workflow

- Create failure tests around every outbound path.
- Assert idle/degraded states are visible in CLI and dashboard.
- Use bounded retries and backoff for recoverable failures.
- Audit operator actions and automated blocks.
- Update runbooks for recovery steps.

## Guardrails

- Do not allow any failure scenario to send without policy permission or required recipient confirmation.
- Do not create unbounded retry loops.
- Do not hide failure state from operators.

## Acceptance Checks

- Run the failure suite and confirm no unsafe sends occur.
- node --test tests/**/*.test.mjs
- corepack pnpm typecheck
- docker compose config

## Review Focus

- Verify each failure prefers idle over risky fallback behavior.
- Verify recovery paths are documented.
- Verify duplicate inbound and interrupted jobs are idempotent.
