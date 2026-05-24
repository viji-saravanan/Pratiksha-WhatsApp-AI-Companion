---
name: viji-phase-11-local-llm
description: Implement or review Viji Helper Phase 11 local inference work. Use for apps/llm-proxy, Docker-only llama.cpp profiles, model health checks, generation endpoints, embedding endpoints, model path configuration, timeouts, and token limits.
---

# Phase 11 Local LLM

## Goal

Replace the deterministic test LLM stub with local Docker inference while preserving safety controls.

## Required Context

Start with $viji-project-guardrails when available, then read:

- [docs/DEV_GUIDE.md](/Volumes/Arya 1TB/VijiAI/workspace/viji-helper/docs/DEV_GUIDE.md)
- [docs/04_STORAGE_PROFILE.md](/Volumes/Arya 1TB/VijiAI/workspace/viji-helper/docs/04_STORAGE_PROFILE.md)
- [docs/09_IMPLEMENTATION_PHASES.md](/Volumes/Arya 1TB/VijiAI/workspace/viji-helper/docs/09_IMPLEMENTATION_PHASES.md)

## Workflow

- Keep model files under `${VIJI_DATA_ROOT}/models`; never copy models into images.
- Expose generation through `apps/llm-proxy` or shared client interfaces.
- Add health checks for missing model, timeout, and unavailable runtime.
- Record failed agent runs and do not send on model failure.
- Keep prompt and token limits explicit and testable.

## Guardrails

- Do not use cloud LLMs for the core path.
- Do not leak hidden prompts, local paths, or secrets in generated replies.
- Do not hide CPU-only latency tradeoffs.

## Acceptance Checks

- Run local LLM proxy tests with missing/test model paths and opt-in real model smoke tests.
- node --test tests/**/*.test.mjs
- corepack pnpm typecheck
- docker compose config

## Review Focus

- Verify missing model enters `IDLE_MODEL_MISSING`.
- Verify drafts still start with `[Pratiksha]`.
- Verify model runtime state appears in status surfaces.
