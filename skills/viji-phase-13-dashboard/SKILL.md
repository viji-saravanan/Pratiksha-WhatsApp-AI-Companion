---
name: viji-phase-13-dashboard
description: Deprecated compatibility alias. Dashboard work moved to $viji-phase-14-dashboard.
---

# Deprecated Dashboard Alias

## Goal

Use $viji-phase-14-dashboard for dashboard implementation and review.

## Required Context

Start with $viji-project-guardrails when available, then read:

- [docs/DEV_GUIDE.md](/Volumes/Arya 1TB/VijiAI/workspace/viji-helper/docs/DEV_GUIDE.md)
- [docs/09_IMPLEMENTATION_PHASES.md](/Volumes/Arya 1TB/VijiAI/workspace/viji-helper/docs/09_IMPLEMENTATION_PHASES.md)
- [docs/PROJECT_STRUCTURE.md](/Volumes/Arya 1TB/VijiAI/workspace/viji-helper/docs/PROJECT_STRUCTURE.md)

## Workflow

- Build an operations surface, not a marketing page.
- Keep UI data access through API routes.
- Show pending recipient confirmations and their expiry state.
- Show storage, context stale, adapter auth, and idle states prominently.
- Show resource metadata before recipient confirmation.

## Guardrails

- Do not display secrets, QR data, auth stores, raw unredacted payloads, or hidden prompts.
- Do not connect the dashboard directly to Postgres.
- Do not obscure degraded states behind decorative UI.

## Acceptance Checks

- Run dashboard tests and verify UI against API/CLI state.
- node --test tests/**/*.test.mjs
- corepack pnpm typecheck
- docker compose config

## Review Focus

- Verify core workflows are ergonomic and visible.
- Verify degraded states are clear.
- Verify dashboard and CLI report the same status.
