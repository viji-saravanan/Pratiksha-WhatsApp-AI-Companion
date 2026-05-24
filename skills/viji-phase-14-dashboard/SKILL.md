---
name: viji-phase-14-dashboard
description: Implement or review Viji Helper Phase 14 dashboard work. Use for onboarding, operational status, adapter health, conversation timeline, pending recipient confirmations, storage quota, sync/backfill/media status, resource catalog views, audit logs, and settings.
---

# Phase 14 Dashboard

## Goal

Provide a visual operations dashboard after backend and CLI behavior are stable.

## Required Context

Start with $viji-project-guardrails when available, then read:

- [docs/DEV_GUIDE.md](/Volumes/Arya 1TB/VijiAI/workspace/viji-helper/docs/DEV_GUIDE.md)
- [docs/09_IMPLEMENTATION_PHASES.md](/Volumes/Arya 1TB/VijiAI/workspace/viji-helper/docs/09_IMPLEMENTATION_PHASES.md)
- [docs/PROJECT_STRUCTURE.md](/Volumes/Arya 1TB/VijiAI/workspace/viji-helper/docs/PROJECT_STRUCTURE.md)

## Workflow

- Build an operations surface, not a marketing page.
- Prefer user job labels over implementation labels: Home, Assistant, Files, Chats, Sync, Settings, Logs.
- Use blue as the primary dashboard accent and support light/dark theme switching.
- Use icons for primary navigation and commands, and keep modern motion/decorative effects readable in degraded states.
- Keep logs last in the navigation, group audit events by category, and include a raw Docker container log stream for debugging each Viji Helper container/service.
- Dashboard uploads must land under `VIJI_RESOURCE_ROOT/staged`, register through the normal resource API, and preserve WhatsApp-only file-send confirmation.
- Keep UI data access through API routes.
- Show pending recipient confirmations and their expiry state.
- Show storage, context stale, adapter auth, and idle states prominently.
- Show resource metadata before recipient confirmation.
- Keep `VIJI_API_TOKEN` server-side through the dashboard proxy.

## Guardrails

- Do not display secrets, QR data, auth stores, raw unredacted adapter payloads, or hidden prompts outside the dedicated raw container logs troubleshooting area.
- Do not connect the dashboard directly to Postgres.
- Do not obscure degraded states behind decorative UI.
- Do not expose a dashboard approval path for file/resource sends.
- Do not make raw JSON or internal IDs the primary UI outside the dedicated troubleshooting area. Put technical detail behind disclosure controls.

## Acceptance Checks

- node --test tests/dashboard/phase14-dashboard.test.mjs
- Run dashboard tests and verify UI against API/CLI state.
- node --test tests/**/*.test.mjs
- corepack pnpm typecheck
- docker compose config

## Review Focus

- Verify core workflows are ergonomic and visible.
- Verify degraded states are clear.
- Verify dashboard and CLI report the same status.
- Verify normal controls are understandable without knowing database, queue, or adapter internals.
