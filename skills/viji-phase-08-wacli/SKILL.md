---
name: viji-phase-08-wacli
description: Implement or review Viji Helper Phase 8 wacli adapter hardening. Use for apps/wa-adapter-wacli, typed command wrappers, command-output parsers, opt-in live WhatsApp tests, auth store persistence, send text/file experiments, and adapter reliability reports.
---

# Phase 8 wacli Adapter Hardening

## Goal

Harden live personal WhatsApp automation through `wacli` after the adapter contract exists.

## Required Context

Start with $viji-project-guardrails when available, then read:

- [docs/DEV_GUIDE.md](/Volumes/Arya 1TB/VijiAI/workspace/viji-helper/docs/DEV_GUIDE.md)
- [docs/09_IMPLEMENTATION_PHASES.md](/Volumes/Arya 1TB/VijiAI/workspace/viji-helper/docs/09_IMPLEMENTATION_PHASES.md)
- [docs/08_CHAT_CONTEXT_RECOVERY.md](/Volumes/Arya 1TB/VijiAI/workspace/viji-helper/docs/08_CHAT_CONTEXT_RECOVERY.md)

## Workflow

- Keep all `wacli` execution inside `apps/wa-adapter-wacli`.
- Wrap `doctor`, `auth`, sync/poll, list/search, send text, send file, media download, and adapter-owned mark-read commands.
- Parse machine-readable output only; fixture-test every parser.
- Persist auth/store data under `${VIJI_DATA_ROOT}/wacli/store`.
- Keep live WhatsApp smoke tests opt-in and never commit real payloads.

## Guardrails

- Do not use browser automation unless the docs and user direction change.
- Do not let other services shell out to `wacli`.
- Do not fake read receipts in Postgres; use `wacli-mark-read` or a future adapter equivalent.
- Do not commit QR data, phone numbers, JIDs, message bodies, or auth stores.

## Acceptance Checks

- Run parser and wrapper fixture tests; run opt-in smoke tests only when explicitly enabled.
- node --test tests/**/*.test.mjs
- corepack pnpm typecheck
- docker compose config

## Review Focus

- Classify failures as auth, network, backoff, send, store lock, storage, or unknown.
- Verify restart persistence with SSD store paths.
- Write the continue-or-switch adapter decision in docs.
