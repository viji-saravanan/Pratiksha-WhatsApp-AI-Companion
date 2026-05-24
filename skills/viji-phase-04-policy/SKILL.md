---
name: viji-phase-04-policy
description: Implement or review Viji Helper Phase 4 policy work. Use for reply modes, kill switches, send or no-send decisions, context freshness gates, storage health gates, adapter health inputs, and file-sharing policy defaults.
---

# Phase 4 Policy Engine

## Goal

Centralize every outbound safety decision before drafts and sends exist.

## Required Context

Start with $viji-project-guardrails when available, then read:

- [docs/DEV_GUIDE.md](/Volumes/Arya 1TB/VijiAI/workspace/viji-helper/docs/DEV_GUIDE.md)
- [docs/09_IMPLEMENTATION_PHASES.md](/Volumes/Arya 1TB/VijiAI/workspace/viji-helper/docs/09_IMPLEMENTATION_PHASES.md)
- [docs/ERD.md](/Volumes/Arya 1TB/VijiAI/workspace/viji-helper/docs/ERD.md)

## Workflow

- Create `packages/policy` with pure decision inputs and explicit outcomes.
- Cover `auto`, `confirm_resource`, `readonly`, `paused`, and `idle` modes.
- Block unknown contacts, paused conversations, stale context auto-send, storage-full sends, and unconfirmed file sharing.
- Require all future outbound paths to call policy immediately before queueing or dispatch.

## Guardrails

- Do not import adapter, DB, or LLM clients into policy.
- Do not create outbound jobs from readonly or paused modes.
- Do not allow auto-send unless all policy gates pass.

## Acceptance Checks

- Run policy unit tests covering all modes and blocking states.
- node --test tests/**/*.test.mjs
- corepack pnpm typecheck
- docker compose config

## Review Focus

- Verify policy results explain why behavior was allowed or blocked.
- Verify stale context blocks auto-send and creates no outbound job.
- Verify file/resource sharing defaults to exact-file recipient confirmation.
