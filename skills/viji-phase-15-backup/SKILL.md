---
name: viji-phase-15-backup
description: Implement or review Viji Helper Phase 15 recovery work. Use for Postgres backups, restore checks, retention jobs, media cache pruning, vector cleanup, audit retention, backup storage under pgbackups, and storage-warning cleanup behavior.
---

# Phase 15 Backup and Retention

## Goal

Keep the local-first system recoverable and bounded under the 200 GB allocation.

## Required Context

Start with $viji-project-guardrails when available, then read:

- [docs/DEV_GUIDE.md](/Volumes/Arya 1TB/VijiAI/workspace/viji-helper/docs/DEV_GUIDE.md)
- [docs/04_STORAGE_PROFILE.md](/Volumes/Arya 1TB/VijiAI/workspace/viji-helper/docs/04_STORAGE_PROFILE.md)
- [docs/09_IMPLEMENTATION_PHASES.md](/Volumes/Arya 1TB/VijiAI/workspace/viji-helper/docs/09_IMPLEMENTATION_PHASES.md)
- [docs/ERD.md](/Volumes/Arya 1TB/VijiAI/workspace/viji-helper/docs/ERD.md)

## Workflow

- Create compressed Postgres backups under `${VIJI_DATA_ROOT}/pgbackups`.
- Validate backups with restore checks in an isolated environment.
- Implement retention without deleting pinned resources or required context.
- Prune caches and old generated artifacts before risky data.
- Audit retention and restore actions.

## Guardrails

- Do not include secrets in backups unless explicitly designed and documented.
- Do not let retention break idempotency or context recovery.
- Do not delete pinned resources or current summaries.

## Acceptance Checks

- Run backup, restore-check, and retention safety tests.
- node --test tests/**/*.test.mjs
- corepack pnpm typecheck
- docker compose config

## Review Focus

- Verify restore can answer basic status queries.
- Verify retention order matches storage profile.
- Verify backup files stay on the SSD data root.
