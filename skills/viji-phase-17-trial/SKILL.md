---
name: viji-phase-17-trial
description: Implement or review Viji Helper Phase 17 controlled trial work. Use for unattended text trial checklists, prompt tuning notes, model latency reports, adapter reliability reports, resource-catalog accuracy notes, and decision records about auto-send readiness.
---

# Phase 17 Local Trial

## Goal

Run controlled unattended trusted-contact text usage and tune behavior while resource sends require recipient confirmation.

## Required Context

Start with $viji-project-guardrails when available, then read:

- [docs/DEV_GUIDE.md](/Volumes/Arya 1TB/VijiAI/workspace/viji-helper/docs/DEV_GUIDE.md)
- [docs/09_IMPLEMENTATION_PHASES.md](/Volumes/Arya 1TB/VijiAI/workspace/viji-helper/docs/09_IMPLEMENTATION_PHASES.md)
- [docs/08_CHAT_CONTEXT_RECOVERY.md](/Volumes/Arya 1TB/VijiAI/workspace/viji-helper/docs/08_CHAT_CONTEXT_RECOVERY.md)

## Workflow

- Keep live behavior within trusted-contact policy gates unless the user explicitly changes direction.
- Track draft usefulness, `[Pratiksha]` prefix consistency, duplicate prevention, reconnect reliability, and storage usage.
- Record prompt tuning and model latency observations.
- Record adapter reliability and resource false-match observations.
- End with a trusted-contact auto mode reliability note.

## Guardrails

- Do not enable broad auto-send during trial.
- Do not tune using committed real private messages.
- Do not ignore storage, CPU, or adapter reliability regressions.

## Acceptance Checks

- Run trial checklist plus normal test/typecheck gates before changing modes.
- node --test tests/**/*.test.mjs
- corepack pnpm typecheck
- docker compose config

## Review Focus

- Verify real use did not create duplicate replies.
- Verify reconnect recovery worked after restart.
- Verify storage stayed within budget.
