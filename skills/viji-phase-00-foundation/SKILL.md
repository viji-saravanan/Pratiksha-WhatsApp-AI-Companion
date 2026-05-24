---
name: viji-phase-00-foundation
description: Implement or review Viji Helper Phase 0 foundation work. Use for SSD workspace setup, storage guard, Docker skeleton, pnpm scaffold, storage profile tests, lockfile reproducibility, and fixes to quota or ignored cache behavior.
---

# Phase 0 Foundation and Storage

## Goal

Make the SSD-backed repo and storage guard reliable before database, WhatsApp, or AI work depends on it.

## Required Context

Start with $viji-project-guardrails when available, then read:

- [docs/DEV_GUIDE.md](/Volumes/Arya 1TB/VijiAI/workspace/viji-helper/docs/DEV_GUIDE.md)
- [docs/04_STORAGE_PROFILE.md](/Volumes/Arya 1TB/VijiAI/workspace/viji-helper/docs/04_STORAGE_PROFILE.md)
- [docs/09_IMPLEMENTATION_PHASES.md](/Volumes/Arya 1TB/VijiAI/workspace/viji-helper/docs/09_IMPLEMENTATION_PHASES.md)

## Workflow

- Keep source and heavy development caches on the SSD workspace.
- Use `corepack pnpm bootstrap:ssd` to create or verify the SSD directory layout and sentinel file.
- Measure project allocation usage by walking the VijiAI tree and excluding `.pnpm-store`, `node_modules`, `.git`, generated builds, and caches.
- Use filesystem free space only as a separate safety check.
- Keep default tests portable with temp roots; keep real SSD checks opt-in.
- Keep Docker builds reproducible with `pnpm-lock.yaml` and frozen lockfile installs.

## Guardrails

- Do not treat APFS volume usage as the 200 GB project allocation.
- Do not commit `.pnpm-store`, `node_modules`, `dist`, `*.tsbuildinfo`, logs, or runtime state.
- Do not add runtime services before the storage guard and compose config are clean.

## Acceptance Checks

- corepack pnpm bootstrap:ssd
- node --test tests/**/*.test.mjs
- corepack pnpm typecheck
- node scripts/check-ssd-storage-profile.mjs
- docker compose config
- docker compose build storage-guard
- docker compose run --rm storage-guard

## Review Focus

- Check storage quota math against project usage, not whole-drive usage.
- Check test portability outside this exact SSD.
- Check lockfile and cache behavior.
