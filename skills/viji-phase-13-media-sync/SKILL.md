---
name: viji-phase-13-media-sync
description: Implement or review Viji Helper Phase 13 media sync work, including allowlisted media queues, guarded downloads, file-asset linkage, received-media promotion, quota checks, and resend safety.
---

# Phase 13 Media Sync

## Goal

Download media from allowlisted WhatsApp conversations safely, link downloaded files into the canonical file-asset model, and make eligible received media reusable only through the resource catalog and recipient-confirmation flow.

## Required Context

Start with $viji-project-guardrails when available, then read:

- [docs/DEV_GUIDE.md](/Volumes/Arya 1TB/VijiAI/workspace/viji-helper/docs/DEV_GUIDE.md)
- [docs/09_IMPLEMENTATION_PHASES.md](/Volumes/Arya 1TB/VijiAI/workspace/viji-helper/docs/09_IMPLEMENTATION_PHASES.md)
- [docs/04_STORAGE_PROFILE.md](/Volumes/Arya 1TB/VijiAI/workspace/viji-helper/docs/04_STORAGE_PROFILE.md)
- [docs/ERD.md](/Volumes/Arya 1TB/VijiAI/workspace/viji-helper/docs/ERD.md)

## Workflow

- Normalize media metadata from redacted `wacli` fixtures before ingestion reaches workers.
- Queue media downloads only after an allowlisted direct message is stored in Postgres.
- Keep `msg_message_media`, `msg_media_download_jobs`, `res_file_assets`, and `res_resources` as the canonical chain for received-media reuse.
- Store downloaded media under `VIJI_WACLI_MEDIA_ROOT`, defaulting to `${VIJI_DATA_ROOT}/wacli/media`.
- Pause or block media downloads on warning, critical, missing, or unwritable storage states.
- Promote downloaded media into resources only when it should be reusable, and keep recipient confirmation required.

## Guardrails

- Do not download or promote media from non-allowlisted contacts.
- Do not send directly from adapter cache paths.
- Do not let adapter output paths escape `VIJI_WACLI_MEDIA_ROOT`.
- Do not duplicate file bytes when promotion can reuse `res_file_assets`.
- Do not bypass resource allowlist or exact-recipient confirmation for media resends.

## Acceptance Checks

- node --test tests/whatsapp/phase13-media-sync.test.mjs
- node --test tests/resources/*.test.mjs
- corepack pnpm typecheck
- node --test tests/**/*.test.mjs
- docker compose config

## Review Focus

- Verify storage warning and critical states prevent unsafe media writes.
- Verify duplicate media jobs are idempotent.
- Verify promoted received media is searchable but still confirmation-gated.
- Verify audit details avoid raw message bodies and local file paths.
