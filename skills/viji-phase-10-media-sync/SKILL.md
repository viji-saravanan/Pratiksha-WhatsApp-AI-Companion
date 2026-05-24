---
name: viji-phase-10-media-sync
description: Implement or review Viji Helper Phase 10 media work. Use for allowlisted media download queues, msg_message_media, msg_media_download_jobs, file asset linkage, quota checks, resumable downloads, and storage warning behavior.
---

# Phase 10 Media Sync

## Goal

Download allowlisted chat media safely without exceeding the SSD allocation.

## Required Context

Start with $viji-project-guardrails when available, then read:

- [docs/DEV_GUIDE.md](/Volumes/Arya 1TB/VijiAI/workspace/viji-helper/docs/DEV_GUIDE.md)
- [docs/04_STORAGE_PROFILE.md](/Volumes/Arya 1TB/VijiAI/workspace/viji-helper/docs/04_STORAGE_PROFILE.md)
- [docs/09_IMPLEMENTATION_PHASES.md](/Volumes/Arya 1TB/VijiAI/workspace/viji-helper/docs/09_IMPLEMENTATION_PHASES.md)
- [docs/ERD.md](/Volumes/Arya 1TB/VijiAI/workspace/viji-helper/docs/ERD.md)

## Workflow

- Queue media downloads only for allowlisted conversations.
- Store downloaded media under `${VIJI_DATA_ROOT}/wacli/media`.
- Link media metadata to `res_file_assets` only after safe storage.
- Pause media downloads on storage warning and block writes on storage critical.
- Make media jobs resumable and duplicate-safe.

## Guardrails

- Do not let paths escape the configured data root.
- Do not download non-allowlisted media.
- Do not let large media starve DB, logs, model, or backup allocations.

## Acceptance Checks

- Run media queue, duplicate prevention, path safety, and storage warning tests.
- node --test tests/**/*.test.mjs
- corepack pnpm typecheck
- docker compose config

## Review Focus

- Verify all file paths are normalized and rooted.
- Verify media retry state is explicit.
- Verify storage guard integration blocks unsafe writes.
