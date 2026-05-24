---
name: viji-phase-07-api-cli
description: Implement or review Viji Helper Phase 7 operator surfaces. Use for local API routes, CLI commands, health/status, conversations, generated replies, recipient confirmations, policy mode changes, storage status, sync status, and audit-log access.
---

# Phase 7 API and CLI

## Goal

Expose safe local operator control before live WhatsApp sends are enabled.

## Required Context

Start with $viji-project-guardrails when available, then read:

- [docs/DEV_GUIDE.md](/Volumes/Arya 1TB/VijiAI/workspace/viji-helper/docs/DEV_GUIDE.md)
- [docs/09_IMPLEMENTATION_PHASES.md](/Volumes/Arya 1TB/VijiAI/workspace/viji-helper/docs/09_IMPLEMENTATION_PHASES.md)
- [docs/PROJECT_STRUCTURE.md](/Volumes/Arya 1TB/VijiAI/workspace/viji-helper/docs/PROJECT_STRUCTURE.md)

## Workflow

- Keep API routes thin and move behavior into packages or worker operations.
- Make CLI use the API for normal operations.
- Expose health, generated replies, recipient confirmations, policy, storage, sync, and audit status.
- Add explicit local authorization even for local-only access.
- Use correlation IDs in API responses and logs.

## Guardrails

- Do not expose secrets, auth stores, raw adapter payloads, or hidden prompts.
- Do not let CLI destructive commands run without explicit flags.
- Do not let dashboard or CLI connect directly to Postgres.

## Acceptance Checks

- Run API and CLI tests for policy and recipient-confirmation workflow controls.
- node --test tests/**/*.test.mjs
- corepack pnpm typecheck
- docker compose config

## Review Focus

- Verify CLI and API agree on state.
- Verify degraded storage and stale context are visible.
- Verify validation uses shared schemas.
