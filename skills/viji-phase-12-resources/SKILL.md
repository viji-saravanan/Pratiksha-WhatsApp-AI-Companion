---
name: viji-phase-12-resources
description: Implement or review Viji Helper Phase 12 resource-catalog work. Use for res_file_assets, res_resources, local indexing, tags and aliases, document extraction, resource match planning, previews, and recipient-confirmed file sharing.
---

# Phase 12 Resource Catalog

## Goal

Let the assistant propose shareable resources without authorizing sends by itself.

## Required Context

Start with $viji-project-guardrails when available, then read:

- [docs/DEV_GUIDE.md](/Volumes/Arya 1TB/VijiAI/workspace/viji-helper/docs/DEV_GUIDE.md)
- [docs/09_IMPLEMENTATION_PHASES.md](/Volumes/Arya 1TB/VijiAI/workspace/viji-helper/docs/09_IMPLEMENTATION_PHASES.md)
- [docs/ERD.md](/Volumes/Arya 1TB/VijiAI/workspace/viji-helper/docs/ERD.md)

## Workflow

- Register resources with title, aliases, description, sensitivity, active state, allowlist, and recipient-confirmation requirements.
- Index only configured local resource roots unless docs expand the source model.
- Extract text for supported file types where feasible.
- Let the LLM recommend resources but require policy and Vijayalakshmi's exact-file confirmation to share.
- Show enough metadata for wrong-file prevention before recipient confirmation.

## Guardrails

- Do not send files without exact-file recipient confirmation.
- Do not allow file paths outside configured roots.
- Do not treat restricted or missing files as shareable.

## Acceptance Checks

- Run resource registration, match planning, missing-file, and recipient-confirmed send tests.
- node --test tests/**/*.test.mjs
- corepack pnpm typecheck
- docker compose config

## Review Focus

- Verify false-match risk is handled with exact filenames and recipient confirmation.
- Verify disallowed resources are blocked or clarified in chat, not sent.
- Verify resource sends reuse outbound policy gates.
