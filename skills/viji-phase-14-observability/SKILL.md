---
name: viji-phase-14-observability
description: Implement or review Viji Helper future observability work. Use for structured JSON logs, correlation IDs, Prometheus metrics, Loki shipping, Grafana dashboards, CLI log fallback, redaction, and viji_ metric naming.
---

# Future Observability

## Goal

Make normal and degraded behavior visible through visual dashboards and CLI workflows.

## Required Context

Start with $viji-project-guardrails when available, then read:

- [docs/DEV_GUIDE.md](/Volumes/Arya 1TB/VijiAI/workspace/viji-helper/docs/DEV_GUIDE.md)
- [docs/09_IMPLEMENTATION_PHASES.md](/Volumes/Arya 1TB/VijiAI/workspace/viji-helper/docs/09_IMPLEMENTATION_PHASES.md)
- [docs/PROJECT_STRUCTURE.md](/Volumes/Arya 1TB/VijiAI/workspace/viji-helper/docs/PROJECT_STRUCTURE.md)

## Workflow

- Emit structured logs with correlation IDs.
- Expose Prometheus metrics for storage, adapter, sync, drafts, outbox, LLM, and context freshness.
- Use the `viji_` metric prefix.
- Ship redacted logs to Loki and surface them in Grafana.
- Provide CLI log tail fallback for operations.

## Guardrails

- Do not log message bodies by default.
- Do not log secrets, QR data, tokens, auth stores, or raw unredacted adapter payloads.
- Do not let logging fill the SSD without retention controls.

## Acceptance Checks

- Run logging, metric naming, redaction, and dashboard provisioning tests.
- node --test tests/**/*.test.mjs
- corepack pnpm typecheck
- docker compose config

## Review Focus

- Verify logs and metrics are useful during idle/degraded flows.
- Verify correlation IDs span API, worker, adapter, and LLM paths.
- Verify dashboards avoid private content.
