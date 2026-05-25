# Phase Completion Checklist

## Current Count

Numbered roadmap status:

- Complete: 22 phases, Phase 0 through Phase 16 plus Phase 18 through Phase 22.
- In progress: 1 numbered phase, Phase 17.
- Planned: 4 numbered phases, Phase 23 through Phase 26.
- Remaining: Phase 17 production-contact trial follow-up plus Phase 23 through Phase 26.
- Separate observability work block: complete.

Practical remaining work count:

- Phase 17 now has a fresh-message live reply observation through the allowlisted `Myself` contact. It still needs the production-contact follow-up with Vijayalakshmi and thermal/CPU observations over a longer window.
- Phase 23 through Phase 26 are future implementation phases created from the repo-wide review in [14_REPO_WIDE_REVIEW_AND_FUTURE_PHASES.md](14_REPO_WIDE_REVIEW_AND_FUTURE_PHASES.md).

## Completion Rule

A phase is complete only when implementation, verification, review, documentation, and operator usability are all done. A feature that works only through a script is not complete if the documented dashboard or CLI path is missing.

Universal gate for every phase:

- [ ] Implementation matches `docs/DEV_GUIDE.md`.
- [ ] Database changes match `docs/ERD.md` naming rules.
- [ ] Project data stays under `<external-data-root>`.
- [ ] Canonical state is in Postgres, not SQLite or scattered JSON stores.
- [ ] `.env` and `.env.example` are updated when configuration changes.
- [ ] Shared code is centralized in packages instead of duplicated across apps.
- [ ] Positive and negative tests exist for the changed behavior.
- [ ] `node --test tests/**/*.test.mjs` passes.
- [ ] `corepack pnpm typecheck` passes.
- [ ] Docker Compose config remains valid when services change.
- [ ] Dashboard and CLI paths both work for operator-facing features.
- [ ] Logs and UI outputs redact secrets, QR data, tokens, and auth stores.
- [ ] File/resource sends require Vijayalakshmi's WhatsApp confirmation only.
- [ ] Failure modes go idle/degraded instead of risking an unsafe send.

## Phase Checklist

| Phase | Scope | Status | Completion Proof |
| --- | --- | --- | --- |
| Phase 0 | Foundation, SSD workspace, storage guard | Complete | Bootstrap, storage checks, Docker skeleton, initial tests |
| Phase 1 | Core database schema | Complete | Migrations, seed path, disposable Postgres tests |
| Phase 2 | Typed DB and repositories | Complete | Repository layer, transactions, DB package tests |
| Phase 3 | WhatsApp adapter contract | Complete | Live `wacli` wrappers, fixture normalization, allowlist ingest |
| Phase 4 | Policy engine | Complete | Trusted text policy, degraded blockers, recipient confirmation rules |
| Phase 5 | AI draft generation | Complete | Structured local AI path, draft persistence, stale-context handling |
| Phase 6 | Outbox dispatch | Complete | Jobs, attempts, idempotency, retryable send failures |
| Phase 7 | API and CLI | Complete | Authenticated local API, CLI coverage, redacted summaries |
| Phase 8 | `wacli` hardening | Complete | QR auth, typed wrappers, timeout hardening, send gates |
| Phase 9 | Reconnect recovery | Complete | Backfill status, summaries, stale/fresh context transitions |
| Phase 10 | Live polling | Complete | Postgres-canonical live allowlist polling and `from_me` persistence |
| Phase 11 | Local LLM | Complete | Ollama runtime, structured output, embeddings, smoke tests |
| Phase 12 | Resource catalog | Complete | File indexing, ranked suggestions, WhatsApp-only confirmation |
| Phase 13 | Received media | Complete | Allowlisted media sync, guarded download, resource promotion |
| Phase 14 | Dashboard | Complete | API-backed command-board dashboard, onboarding, status, resources, audit, raw container logs |
| Phase 15 | Backup and retention | Complete | Compressed backups, restore checks, dry-run retention |
| Future Observability | Metrics and raw/container logs | Complete | Redacted structured logs, `viji_` metrics, Grafana/Loki/Prometheus provisioning, CLI fallback |
| Phase 16 | Failure and chaos testing | Complete | Failure suite proves no unsafe sends |
| Phase 17 | Local trial and tuning | In progress | Live worker, API-backed readiness command, Compose lifecycle, fresh `Myself` live reply proof, and runbook added; Vijayalakshmi production-contact follow-up still pending |
| Phase 18 | Optional project Codex skill | Complete | Project-local `$viji-helper-dev` skill created, documented, generated, and validated |
| Phase 19 | Live loop optimization | Complete | Scheduled startup/interval/retry sync, hot-poll sync disabled by default, timing logs, API/CLI/dashboard visibility, and focused tests |
| Phase 20 | Persistent WhatsApp adapter spike | Complete | Event-stream adapter contract, direct `wacli`/`whatsmeow`/Baileys comparison, local capability check, and rollback gate |
| Phase 21 | Automatic received-media persistence | Complete | Live worker drains queued media, stores files under per-job media directories, cleans partials, auto-promotes resources, and surfaces queue/drain status |
| Phase 22 | Image and document understanding | Complete | KB extraction tables, local extractor boundary, API/register extraction, OCR/PDF tool wiring, safe snippets, and focused tests |
| Phase 23 | Voice note transcription | Planned | Not started; target is local audio transcription linked to message media |
| Phase 24 | Semantic retrieval and resource matching | Planned | Not started; target is hybrid lexical plus pgvector retrieval |
| Phase 25 | Multi-contact copy and authority cleanup | Planned | Not started; target is contact-derived runtime copy without changing WhatsApp-only authority |
| Phase 26 | Evaluation harness and thermal gates | Planned | Not started; target is repeatable accuracy, safety, latency, CPU, and SSD-growth gates |

## Future Phase Checklist

These phases were added after the repo-wide review. They must be implemented one at a time, with review and verification before moving forward.

### Phase 19 Checklist

Goal: reduce live-worker heat and latency.

- [x] Split startup/reconnect sync from hot polling.
- [x] Add sync backoff, jitter, and stale-context behavior.
- [x] Add effective latency and sync-duration metrics/logs.
- [x] Show effective polling state in CLI/dashboard.
- [x] Test sync success, sync failure, stale context, and duplicate prevention.
- [x] Record CPU/latency expectations in the phase report; live thermal measurements remain part of the Phase 17 final trial.

### Phase 20 Checklist

Goal: evaluate a persistent WhatsApp adapter.

- [x] Update adapter spike docs with direct `wacli`, direct `whatsmeow`, and bridge options.
- [x] Design event-stream interface without bypassing policy/outbox.
- [x] Define auth/session storage under `VIJI_DATA_ROOT`.
- [x] Define reconnect, receipt, media, and message event handling.
- [x] Keep `wacli` as rollback until implementation is proven.

### Phase 21 Checklist

Goal: automatically save allowlisted received media.

- [x] Add Compose-managed media drain path.
- [x] Keep media downloads quota-controlled.
- [x] Clean partial files on failure.
- [x] Add dashboard and CLI media queue status.
- [x] Test image, document, audio, duplicate, non-allowlisted, group, and storage-full cases.

### Phase 22 Checklist

Goal: understand images and documents locally.

- [x] Add OCR/parser design to ERD and TDD before implementation.
- [x] Persist extracted text/snippets in Postgres-linked records.
- [x] Store extractor metadata without turning JSONB into the canonical model.
- [x] Keep file blobs outside Postgres.
- [x] Test marksheet-like images/PDFs, corrupt files, unsupported MIME, and path escapes.

### Phase 23 Checklist

Goal: transcribe voice notes locally.

- [ ] Choose local speech-to-text runtime and document storage impact.
- [ ] Link transcripts to message media.
- [ ] Expose transcript status/confidence.
- [ ] Block unsafe sends for missing or low-confidence transcripts.
- [ ] Test short audio, empty/noisy audio, unsupported MIME, and duplicate jobs.

### Phase 24 Checklist

Goal: add hybrid semantic retrieval.

- [ ] Update ERD with embedding storage and prefixed columns.
- [ ] Add migration-controlled vector indexes.
- [ ] Implement exact, lexical, semantic, permission, and recency ranking.
- [ ] Preserve deterministic exact filename behavior.
- [ ] Test positive, negative, ambiguous, and permission-filtered retrieval.

### Phase 25 Checklist

Goal: make runtime copy multi-contact-correct.

- [ ] Replace reusable hardcoded contact copy with contact-derived labels.
- [ ] Keep Vijayalakshmi documented as production primary.
- [ ] Keep Myself documented as controlled testing.
- [ ] Confirm dashboard/API cannot approve file sends.
- [ ] Test primary-contact and test-contact UI/resource copy.

### Phase 26 Checklist

Goal: make future completion measurable.

- [ ] Add redacted fixtures for text, resource, image, document, and audio flows.
- [ ] Track p50/p95 ingest and reply latency.
- [ ] Track duplicate replies, unsafe sends, media save success, OCR/transcript success, and retrieval quality.
- [ ] Track CPU pressure and SSD growth during trial windows.
- [ ] Keep live checks opt-in and redacted.

## Future Observability Checklist

This block was completed before Phase 16 verification.

- [x] Add structured JSON logs for API, worker, dashboard, WhatsApp adapter, AI, storage guard, and backup scripts.
- [x] Add request/job correlation IDs across inbound ingest, draft generation, outbox dispatch, media download, and API actions.
- [x] Expose Prometheus-style metrics with `viji_` prefixes.
- [x] Include storage, adapter, sync, draft, outbox, LLM, backup, media, and context-freshness metrics.
- [x] Add container raw log viewing in the dashboard, grouped by service.
- [x] Keep logs navigation separate and last in the dashboard.
- [x] Add CLI log tailing by service and severity.
- [x] Add log redaction tests for secrets, QR data, tokens, phone-sensitive payloads, and auth stores.
- [x] Add Docker Compose wiring for the chosen log/metric stack.
- [x] Document retention and disk impact under the 200 GB allocation.

## Phase 16 Checklist

Goal: prove the system chooses idle/degraded behavior over unsafe sends.

- [x] Simulate external SSD missing or sentinel missing.
- [x] Simulate storage warning and storage critical states.
- [x] Simulate Postgres unavailable during ingest, draft, dispatch, and dashboard requests.
- [x] Simulate local LLM unavailable, model missing, malformed structured output, and timeout.
- [x] Simulate WhatsApp auth required, network down, command timeout, and adapter crash.
- [x] Simulate duplicate inbound events and duplicate outbox dispatch attempts.
- [x] Simulate interrupted backfill and verify resumability.
- [x] Simulate media download failure and partial file cleanup.
- [x] Verify no failure path sends a file or text reply without the required policy state.
- [x] Verify idle/degraded state appears in dashboard and CLI.
- [x] Verify retries use bounded backoff.
- [x] Verify all operator actions are audited.
- [x] Update recovery runbooks for each tested failure.

## Phase 17 Checklist

Goal: run a controlled local trial with real WhatsApp and local AI.

- [x] Define trial window rules, contact allowlist, and rollback command.
- [x] Add API-backed readiness command that does not print private filenames or message bodies.
- [x] Add trial runbook with rollback and observation rules.
- [x] Add Compose-managed dashboard/API/Postgres lifecycle so dashboard runtime does not depend on local Node servers.
- [x] Add Compose-managed live worker lifecycle so stopping containers stops live automation.
- [x] Add tests for text automation, resource suggestion, and WhatsApp-recipient list-number file confirmation.
- [x] Confirm `Myself` test allowlist and Vijayalakshmi production allowlist are correct.
- [x] Confirm live polling reads Vijayalakshmi and Myself in the same allowlist cycle without broad chat fallback.
- [x] Centralize Pratiksha assistant identity and `[Pratiksha]` send prefix.
- [x] Run unattended trusted text mode for a limited period.
- [x] Confirm `[Pratiksha]` prefix appears on assistant-originated live text replies in the controlled `Myself` test.
- [x] Verify no duplicate replies in automated reconnect/restart coverage and the controlled fresh-message live test.
- [ ] Measure model latency, CPU pressure, memory pressure, and SSD growth.
- [ ] Review resource suggestion accuracy for exact, fuzzy, and ambiguous file requests.
- [ ] Test Vijayalakshmi selecting a file by list number and by natural language reply.
- [ ] Test received media reuse after promotion into the file repository.
- [ ] Tune prompts, resource ranking, and thresholds from observed misses.
- [x] Produce an initial live-gate trial report.
- [x] Produce a fresh-message live proof report for the allowlisted `Myself` test path.
- [ ] Produce the production-contact trial report with keep/change/disable decisions.

## Phase 18 Checklist

Goal: make future Codex work follow the repo rules quickly.

- [x] Create or update local skill `viji-helper-dev`.
- [x] Keep the skill short and procedural.
- [x] Reference `docs/DEV_GUIDE.md`, `docs/ERD.md`, and `docs/09_IMPLEMENTATION_PHASES.md`.
- [x] Include phase-gate commands and safety rules.
- [x] Exclude secrets, auth stores, real message bodies, and private local data.
- [x] Validate the skill with the available skill tooling.
- [x] Document how future prompts should invoke the skill.

## Last Known Verification Snapshot

Latest completed verification:

```bash
node --test tests/resources/phase22-document-understanding.test.mjs tests/resources/phase12-resource-api-cli.test.mjs
node --test tests/migrations/phase1-migrations.test.mjs
corepack pnpm typecheck
node --test tests/**/*.test.mjs
docker compose --profile dashboard --profile app --profile live config --quiet
docker compose build api live-worker
```

Result: Phase 22 focused extraction tests passed, API/CLI resource indexing regression passed, migration/schema checks passed, 118 Node tests passed, TypeScript passed, Docker Compose config passed, and API/live-worker Docker images rebuilt with OCR/PDF tools. Phase 22 added typed KB extraction records, local PDF/image/text extraction, safe prompt-snippet sanitization, resource summary updates through register/index paths, and Docker runtime packages for free/open-source OCR/PDF extraction.

Previous completed verification:

```bash
node --test tests/whatsapp/phase21-media-daemon.test.mjs
node --test tests/whatsapp/phase13-media-sync.test.mjs tests/api-cli/phase7-api-cli.test.mjs tests/observability/observability.test.mjs
corepack pnpm typecheck
node --test tests/**/*.test.mjs
docker compose --profile dashboard --profile app --profile live config --quiet
```

Result: Phase 21 media-daemon tests passed, focused media/API/CLI/observability regressions passed, 114 Node tests passed, TypeScript passed, and Docker Compose config passed. Phase 21 completed unattended media persistence: live runtime drains queued media downloads, stores files under SSD-backed per-job media directories, cleans partial files on failure, auto-promotes downloaded image/document/audio media into contact-scoped resources, and keeps recipient-confirmation policy intact for resends.

Previous completed verification:

```bash
node --test tests/whatsapp/phase20-persistent-adapter-contract.test.mjs
corepack pnpm typecheck
node --test tests/**/*.test.mjs
docker compose --profile dashboard --profile app --profile live config --quiet
```

Result: Phase 20 contract tests passed, 111 Node tests passed, TypeScript passed, and Docker Compose config passed. Phase 20 completed the persistent-adapter spike without switching production runtime: `wacli` remains the live adapter, while `packages/whatsapp` now exposes an optional event-stream adapter contract and `docs/ADAPTER_SPIKE.md` records direct `wacli`, direct `whatsmeow`, and Baileys bridge options with rollback rules.

Previous live verification: 108 Node tests passed, TypeScript passed, trial readiness passed, and the Docker-owned live runtime completed a real allowlisted WhatsApp self-test. A fresh `Myself` message received by WhatsApp at `2026-05-24T10:00:54Z` was imported into Postgres at `2026-05-24T10:01:35.616808Z`, drafted by local Ollama in `4872ms`, queued at `2026-05-24T10:01:54.532107Z`, marked read through the adapter path, and recorded as sent at `2026-05-24T10:02:04.838341Z`. A second fresh `Myself` text message from the same sync window was also replied to once. No duplicate outbound rows were observed for those triggers.

The observed latency is correct for the current `wacli` sync adapter but not the target long-term experience: a message sent just after a scheduled sync can wait until the next `VIJI_LIVE_SYNC_INTERVAL_MS` window, then wait for the one-shot sync and model/send path. Phase 20 remains the path for persistent-socket, lower-latency event handling.

The same verification also confirmed two Phase 19 hardening fixes:

- `VIJI_WACLI_SYNC_TIMEOUT=75s` is used for scheduled sync while normal chat/read/send commands keep `VIJI_WACLI_TIMEOUT=30s`.
- Storage quota accounting uses allocated disk blocks, so Docker sparse files on the SSD no longer produce false `critical` storage status.

Previous completed verification:

```bash
corepack pnpm --filter @viji/worker build
corepack pnpm --filter @viji/api build
corepack pnpm --filter @viji/cli build
corepack pnpm --filter @viji/dashboard build
node --test tests/whatsapp/phase19-live-loop.test.mjs
node --test tests/trial/phase17-live-automation.test.mjs tests/compose/compose-lifecycle.test.mjs tests/whatsapp/phase19-live-loop.test.mjs
node --test tests/api-cli/phase7-api-cli.test.mjs tests/dashboard/phase14-dashboard.test.mjs tests/observability/observability.test.mjs tests/whatsapp/phase19-live-loop.test.mjs
corepack pnpm typecheck
docker compose --profile dashboard --profile app --profile live config
node --test tests/**/*.test.mjs
```

Result: 108 Node tests passed, Phase 19 focused tests passed, Phase 17 live automation regression tests passed, API/CLI/dashboard/observability tests passed, TypeScript passed, and Compose config passed. The live worker now defaults to scheduled startup/interval/retry sync instead of forcing `wacli sync` before every hot poll. Phase 17 still needs a fresh inbound-message trial to confirm the reply behavior in the live chat.

Previous completed verification:

```bash
corepack pnpm typecheck
node --test tests/**/*.test.mjs
docker compose --profile dashboard --profile app --profile live config
corepack pnpm skills:sync
corepack pnpm skills:validate
```

Result: 86 Node tests passed, TypeScript passed, Compose config passed, and 24 project skills validated. The implementation centralized the Pratiksha identity, applies the `[Pratiksha]` prefix to text and file captions, and includes a dual-contact polling test proving Vijayalakshmi and Myself are both scanned in one live allowlist cycle.

Previous completed verification:

```bash
node --test tests/compose/compose-lifecycle.test.mjs
node --test tests/dashboard/phase14-dashboard.test.mjs tests/trial/phase17-trial-status.test.mjs tests/compose/compose-lifecycle.test.mjs
node --test tests/**/*.test.mjs
corepack pnpm typecheck
docker compose --profile dashboard config
corepack pnpm trial:status -- --json
corepack pnpm exec playwright screenshot --wait-for-timeout 3000 --full-page --browser chromium --viewport-size 1440,1100 http://127.0.0.1:8788 <operator-home>/Downloads/viji-dashboard-runtime.png
node scripts/generate-project-skills.mjs
corepack pnpm skills:validate
<temporary SSD venv>/bin/python <operator-home>/.codex/skills/.system/skill-creator/scripts/quick_validate.py <operator-home>/.codex/skills/viji-helper-dev
```

Result: 82 Node tests passed, TypeScript passed, the dashboard Compose profile rendered successfully, the dashboard loaded API-backed data visually, the project skill pack validated, `$viji-helper-dev` validated through the official skill validator, and trial readiness reached API/Postgres/storage/AI but remained blocked because live auto-reply and live send are intentionally disabled.
