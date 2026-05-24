---
name: viji-phase-03-live-whatsapp
description: Implement or review Viji Helper Phase 3 live WhatsApp adapter work. Use for packages/whatsapp, apps/wa-adapter-wacli, normalized inbound schemas, redacted wacli fixtures, allowlist handling, and duplicate event behavior.
---

# Phase 3 Live WhatsApp Adapter Contract

## Goal

Build the adapter contract around live personal WhatsApp through `wacli` while keeping sends policy-gated and opt-in.

## Required Context

Start with $viji-project-guardrails when available, then read:

- [docs/DEV_GUIDE.md](/Volumes/Arya 1TB/VijiAI/workspace/viji-helper/docs/DEV_GUIDE.md)
- [docs/09_IMPLEMENTATION_PHASES.md](/Volumes/Arya 1TB/VijiAI/workspace/viji-helper/docs/09_IMPLEMENTATION_PHASES.md)
- [docs/08_CHAT_CONTEXT_RECOVERY.md](/Volumes/Arya 1TB/VijiAI/workspace/viji-helper/docs/08_CHAT_CONTEXT_RECOVERY.md)

## Workflow

- Define adapter contracts in `packages/whatsapp`.
- Create the `apps/wa-adapter-wacli` wrapper skeleton as the only runtime owner of `wacli`.
- Use redacted `wacli` fixtures for repeatable parser and ingestion tests.
- Normalize inbound events before worker ingestion.
- Store only allowlisted direct-message content; ignore and audit non-allowlisted traffic.
- Redact adapter payloads before storage.

## Guardrails

- Do not ship a fake/mock WhatsApp adapter as runtime implementation.
- Do not import or execute `wacli` outside `apps/wa-adapter-wacli`.
- Do not let the adapter decide reply text.
- Do not enable raw payload logging by default.

## Acceptance Checks

- Run adapter contract and redacted `wacli` fixture ingestion tests.
- node --test tests/**/*.test.mjs
- corepack pnpm typecheck
- docker compose config

## Review Focus

- Verify duplicate inbound events do not duplicate messages or drafts.
- Verify group chats stay ignored unless explicitly allowed later.
- Verify fixture payloads contain no real private data.
- Verify live `wacli` smoke checks are explicit and guarded.
