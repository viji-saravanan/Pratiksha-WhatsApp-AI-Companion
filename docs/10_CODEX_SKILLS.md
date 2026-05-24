# Codex Skill Pack

## Purpose

This project keeps a local Codex skill pack under `skills/` so phase work can start from the right constraints instead of rediscovering the project rules each time.

Use `$viji-project-guardrails` before any implementation or review task, then use the phase skill that matches the current phase.

## Skill Directory

Path:

`/Volumes/Arya 1TB/VijiAI/workspace/viji-helper/skills`

The skill bodies are generated from:

`/Volumes/Arya 1TB/VijiAI/workspace/viji-helper/scripts/generate-project-skills.mjs`

After changing phase docs or project constraints, run:

`corepack pnpm skills:sync`

Then validate:

`corepack pnpm skills:validate`

The official `quick_validate.py` from the system skill can also be used when Python has `PyYAML` available; the project script is dependency-free so it works on a clean local machine.

## Phase Skill Map

| Work Area | Skill |
| --- | --- |
| General Viji Helper development | `$viji-helper-dev` |
| Shared project rules | `$viji-project-guardrails` |
| Phase 0: foundation, SSD, storage guard | `$viji-phase-00-foundation` |
| Phase 1: schema and migrations | `$viji-phase-01-db-schema` |
| Phase 2: repositories | `$viji-phase-02-db-repositories` |
| Phase 3: live WhatsApp adapter contract | `$viji-phase-03-live-whatsapp` |
| Phase 4: policy engine | `$viji-phase-04-policy` |
| Phase 5: draft generation | `$viji-phase-05-drafts` |
| Phase 6: outbox and recipient confirmations | `$viji-phase-06-outbox` |
| Phase 7: API and CLI | `$viji-phase-07-api-cli` |
| Phase 8: wacli adapter hardening and send spike | `$viji-phase-08-wacli` |
| Phase 9: reconnect and backfill | `$viji-phase-09-reconnect` |
| Phase 10: live polling | `$viji-phase-10-live-polling` |
| Phase 11: local LLM | `$viji-phase-11-local-llm` |
| Phase 12: resource catalog | `$viji-phase-12-resources` |
| Phase 13: media sync and received-media reuse | `$viji-phase-13-media-sync` |
| Phase 14: dashboard | `$viji-phase-14-dashboard` |
| Future observability | `$viji-phase-14-observability` |
| Phase 15: backup and retention | `$viji-phase-15-backup` |
| Phase 16: failure testing | `$viji-phase-16-chaos` |
| Phase 17: local trial | `$viji-phase-17-trial` |
| Phase 18: skill maintenance | `$viji-phase-18-skills` |

## Usage Rule

For each phase:

1. Invoke `$viji-helper-dev` for the short repo-specific development workflow.
2. Invoke `$viji-project-guardrails`.
3. Invoke the active phase skill.
4. Implement only the smallest reviewable slice.
5. Run the phase checks.
6. Perform code review and fix findings before moving to the next phase.

## Installation Note

These skills are project-local source skills. To make them globally discoverable by Codex, copy or symlink the selected skill directories into `~/.codex/skills` and restart Codex.

Current global entry:

`~/.codex/skills/viji-helper-dev -> /Volumes/Arya 1TB/VijiAI/workspace/viji-helper/skills/viji-helper-dev`

Restart Codex after connecting the SSD if `$viji-helper-dev` is not visible in a future session.
