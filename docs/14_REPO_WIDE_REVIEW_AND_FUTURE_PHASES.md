# Repo-Wide Review and Future Phases

Date: 2026-05-23

## Purpose

This document captures the repo-wide review requested after Phase 18. It is intentionally implementation-facing: each finding is tied to future phases so improvements can be shipped incrementally without destabilizing the current local setup.

Review scope:

- Included `apps/`, `packages/`, `scripts/`, `tools/`, `migrations/`, `tests/`, `infra/`, `docs/`, and root config files.
- Excluded generated and cache paths: `dist`, `node_modules`, `.pnpm-store`, and `*.tsbuildinfo`.
- Reviewed WhatsApp runtime, media persistence, AI routing, resource retrieval, dashboard copy, Docker lifecycle, and docs consistency.

Current runtime baseline:

- Docker Desktop data is configured on the SSD at `<external-data-root>/DockerDesktop`.
- Docker VMM is enabled.
- Apple Virtualization Framework and Rosetta virtualization are disabled.
- Docker reports `aarch64`, and no project `amd64` platform pin was found.

## Review Findings

| Severity | Area | Finding | Impact | Evidence |
| --- | --- | --- | --- | --- |
| P1 | Received media | Live ingestion queues media download jobs, but the Compose live worker never drains those jobs or promotes completed media automatically. | Received images, PDFs, documents, and voice notes can remain metadata-only during unattended runtime, so future resend/search cannot rely on them being present. | `apps/worker/src/jobs/inbound-ingestion.job.ts:129`, `scripts/live-worker-daemon.mjs:57`, `apps/worker/src/jobs/media-sync.job.ts:312`, `scripts/download-next-media-once.mjs` |
| P1 | Live performance | Each live automation cycle can run a one-shot `wacli sync` before polling. With a low poll interval, the real loop is gated by sync runtime and repeated subprocess startup, not the configured interval. | Higher latency, laptop heat, adapter churn, and misleading operator expectations about "1s" or "3s" polling. | `apps/worker/src/jobs/live-automation.job.ts:216`, `docker-compose.yml:96`, `docker-compose.yml:98`, `scripts/live-worker-daemon.mjs:74` |
| P2 | WhatsApp adapter | The current adapter contract is request/response and subprocess-based. It has no event stream, persistent socket lifecycle, native ack/read event surface, or background media event hooks. | It cannot match a direct persistent-socket WhatsApp client for latency and richer event handling until a new adapter is added behind the existing boundary. | `packages/whatsapp/src/adapter.interface.ts:63`, `apps/wa-adapter-wacli/src/wacli-client.ts:255`, `tools/wacli-mark-read/main.go:129` |
| P2 | Multimodal understanding | Images, documents, and audio are normalized as media, but non-caption media is not eligible for draft automation, and binary resources do not get OCR, document text, or transcripts. | Messages like an image question with a separate caption, or a voice note asking for a file, are stored but not understood. | `packages/db/src/repositories/messages.repo.ts:471`, `apps/worker/src/jobs/draft-generation.job.ts:145`, `packages/resources/src/resource-indexer.ts:167` |
| P2 | AI routing | The Ollama client returns structured intent fields, but live resource routing still relies on a regex before draft generation. | Paraphrased resource requests, multilingual variants, and ambiguous requests can be missed even when the model could classify them. | `packages/ai/src/ollama-client.ts:86`, `packages/ai/src/ollama-client.ts:509`, `apps/worker/src/jobs/live-automation.job.ts:76`, `apps/worker/src/jobs/live-automation.job.ts:277` |
| P2 | Retrieval | `pgvector` and embedding calls exist, but resource matching is still lexical filename/metadata scoring only. | Requests such as "my marksheet" can work when filenames or aliases match, but not from document/image content or semantic similarity. | `migrations/0001_extensions.sql:2`, `packages/ai/src/ollama-client.ts:393`, `packages/resources/src/resource-matcher.ts:155` |
| P2 | Multi-contact polish | Some reusable runtime copy still hardcodes Vijayalakshmi when describing pending resources or received-media promotion. | Test-contact flows and future allowlisted contacts can show misleading UI/resource descriptions even if the underlying allowlist logic is multi-contact. | `apps/worker/src/jobs/media-sync.job.ts:471`, `apps/worker/src/jobs/media-sync.job.ts:511`, `apps/dashboard/src/assets/app.js:531`, `apps/dashboard/src/assets/app.js:698`, `apps/dashboard/src/assets/app.js:1139` |
| P3 | Context use | `buildDraftPrompt` supports conversation summary, recent messages, and knowledge snippets, but draft generation currently supplies only the latest inbound message. | Pratiksha has less conversation continuity than the schema and prompt builder are designed to support. | `packages/ai/src/prompt-builder.ts:23`, `packages/ai/src/prompt-builder.ts:24`, `packages/ai/src/prompt-builder.ts:25`, `apps/worker/src/jobs/draft-generation.job.ts:145` |

## Implementation Status Since This Review

- Phase 19 is complete. The live worker now uses scheduled startup/interval/retry sync by default, disables hot-poll sync by default, uses `VIJI_WACLI_SYNC_TIMEOUT=75s` for one-shot syncs, records timing fields in worker logs, and exposes poll/sync settings through API status, Prometheus metrics, CLI status, and the dashboard runtime panel.
- A controlled allowlisted `Myself` live test on 2026-05-24 proved the current `wacli` runtime can import a fresh WhatsApp message, draft locally, queue/send once, and record a real mark-read audit. The same test measured the current limitation: end-to-end reply latency can be roughly one sync window plus sync/model/send time.
- Storage quota accounting now uses allocated disk blocks so the Docker Desktop sparse disk image on the SSD does not falsely consume the project quota by apparent size.
- Phase 20 is complete as a spike and boundary phase. `packages/whatsapp` now has an optional event-stream adapter contract; `docs/ADAPTER_SPIKE.md` compares current `wacli`, documented `wacli` follow/events behavior, direct `whatsmeow`, and Baileys-style bridge options. The production runtime still stays on `wacli` until a persistent adapter passes recovery, duplicate-prevention, media, and send-gate tests.
- Phase 21 is complete. The live worker now drains queued allowlisted media during unattended Docker runtime, stores each download under a per-job SSD-backed media directory, cleans partial files after failures, auto-promotes successful downloads into contact-scoped resources, and exposes queue/drain status through API, CLI, dashboard, and metrics.
- The remaining open review themes are Phase 23 through Phase 26: voice transcription, semantic retrieval, multi-contact copy cleanup, and evaluation gates.

## Future Phase Plan

### Phase 19: Live Loop Optimization

Goal:

Reduce heat and latency without weakening reconnect safety.

Deliverables:

- Split startup/reconnect sync from the hot polling path.
- Add bounded backoff and jitter for sync failures.
- Add metrics for cycle duration, sync duration, commands per minute, and skipped cycles.
- Add a CLI/dashboard indicator for effective poll latency, not just configured interval.

Acceptance checks:

- Default live mode does not run `wacli sync` on every hot poll unless explicitly configured.
- Fresh-message intake remains correct after restart and reconnect.
- Tests cover sync success, sync failure, stale context, and backoff.
- CPU and command-count observations are recorded in the Phase 19 report.

Primary files:

- `scripts/live-worker-daemon.mjs`
- `apps/worker/src/jobs/live-automation.job.ts`
- `apps/worker/src/jobs/live-polling.job.ts`
- `packages/db/src/repositories/sync-cursors.repo.ts`
- `tests/trial/phase17-live-automation.test.mjs`
- New `tests/whatsapp/phase19-live-loop.test.mjs`

### Phase 20: Persistent WhatsApp Adapter Spike

Goal:

Evaluate and design a persistent-socket adapter that can approach OpenClaw/Baileys-style latency and event richness while preserving the existing policy/outbox boundary.

Deliverables:

- Adapter decision record comparing current `wacli`, direct `whatsmeow`, and any viable Baileys-style bridge.
- Event-stream interface proposal behind `packages/whatsapp`.
- Prototype plan for message, receipt, media, reconnect, and auth lifecycle events.
- Rollback path that keeps `wacli` as the stable implementation until the spike passes.

Acceptance checks:

- No production path switches adapters without a tested implementation.
- Persistent adapter stores canonical state in Postgres only.
- Auth/session state stays under `VIJI_DATA_ROOT`.
- Live sends still pass through outbox and policy.

Primary files:

- `docs/ADAPTER_SPIKE.md`
- `packages/whatsapp/src/adapter.interface.ts`
- `apps/wa-adapter-wacli/src/wacli-client.ts`
- New adapter spike docs and tests if a prototype is created.

### Phase 21: Automatic Received-Media Persistence

Goal:

Ensure allowlisted received media is saved under the SSD-backed media root during unattended runtime.

Deliverables:

- Compose-managed media download worker or live-worker media drain step.
- Quota-controlled queue draining.
- Safe partial-file cleanup.
- Dashboard and CLI media queue status.
- Promotion path for reusable media resources.

Acceptance checks:

- Allowlisted inbound image/document/audio media is downloaded automatically when storage is healthy.
- Non-allowlisted and group media remain ignored.
- Duplicate media events do not duplicate file assets or resources.
- Storage warning/full states block downloads safely.
- Received media can be promoted and later suggested through the normal recipient-confirmation flow.

Primary files:

- `apps/worker/src/jobs/media-sync.job.ts`
- `scripts/live-worker-daemon.mjs`
- `scripts/download-next-media-once.mjs`
- `packages/db/src/repositories/media-jobs.repo.ts`
- `tests/whatsapp/phase13-media-sync.test.mjs`
- New `tests/whatsapp/phase21-media-daemon.test.mjs`

### Phase 22: Image and Document Understanding

Goal:

Make Pratiksha understand saved images and documents well enough to answer questions and improve file retrieval.

Status:

- Complete in source. Phase 22 added typed KB extraction tables, a local extractor boundary, register/index extraction, PDF/text/image OCR extraction behavior, safe snippet sanitization, and focused tests for marksheet-like PDFs/images, corrupt PDFs, unsupported MIME types, path escapes, and API/CLI resource indexing regressions.

Deliverables:

- OCR/text extraction pipeline for images and PDFs.
- Document parser support for DOCX, spreadsheets, and slides where practical.
- Metadata storage for extractor version, page ranges, dimensions, OCR status, and confidence.
- Safe summary generation through local models only.

Acceptance checks:

- Extracted text and summaries are stored in Postgres-linked resource/KB records, not loose sidecar JSON.
- File blobs remain outside Postgres.
- Tests cover marksheet-like PDF/image fixtures, corrupt files, unsupported MIME types, and path escapes.
- Prompt construction can include extracted snippets without exposing local paths.

Primary files:

- `packages/resources/src/resource-indexer.ts`
- `packages/resources/src/content-extractor.ts`
- `packages/ai/src/prompt-builder.ts`
- `packages/db/src/repositories/resources.repo.ts`
- `packages/db/src/repositories/knowledge.repo.ts`
- `migrations/`
- `apps/worker/src/jobs/resource-understanding.job.ts`

### Phase 23: Voice Note Transcription

Goal:

Transcribe allowlisted WhatsApp audio/voice notes locally and make them available to retrieval and response generation.

Deliverables:

- Local speech-to-text adapter selection.
- Audio metadata capture for duration, MIME type, and transcript status.
- Transcript persistence in typed Postgres fields or KB rows with JSONB metadata only for flexible extractor details.
- Failure behavior that stores media but does not invent transcript content.

Acceptance checks:

- Audio messages with no text body can enter automation only after a transcript exists.
- Low-confidence or failed transcripts are visible in dashboard/CLI.
- No cloud transcription dependency is introduced.
- Tests cover short voice note, noisy/empty audio, unsupported MIME, and duplicate media jobs.

Primary files:

- `apps/worker/src/jobs/media-sync.job.ts`
- `packages/ai` or a new documented local speech package
- `packages/db/src/repositories/messages.repo.ts`
- `tests/whatsapp/`

### Phase 24: Semantic Retrieval and Resource Matching

Goal:

Move resource suggestions from lexical-only matching to hybrid lexical plus semantic retrieval.

Deliverables:

- Embedding table or columns designed in `ERD.md` with table-prefixed columns.
- Local embedding job for resources and extracted KB chunks.
- Hybrid ranker combining filename/alias exact matches, lexical score, semantic score, contact permissions, and recency.
- Evaluation fixtures for ambiguous marksheet/resume/certificate cases.

Acceptance checks:

- Exact filename matches remain deterministic and top-ranked.
- Ambiguous matches produce numbered choices.
- Semantic matches improve recall without unsafe file sends.
- Vector indexes are migration-controlled.
- Tests cover positive, negative, ambiguous, and permission-filtered retrieval.

Primary files:

- `migrations/`
- `docs/ERD.md`
- `packages/resources/src/resource-matcher.ts`
- `packages/ai/src/ollama-client.ts`
- New retrieval tests under `tests/resources/`

### Phase 25: Multi-Contact Copy and Authority Cleanup

Goal:

Keep Vijayalakshmi as the production authority while making runtime copy correct for Myself and any future allowlisted test contact.

Deliverables:

- Replace reusable hardcoded UI/resource text with contact-derived labels.
- Keep docs clear that Vijayalakshmi is production primary and Myself is controlled testing.
- Ensure all resource-confirmation prompts use the actual requesting contact.
- Add dashboard tests for primary and test-contact copy.

Acceptance checks:

- No reusable runtime path says Vijayalakshmi for a resource/media item that came from Myself.
- WhatsApp-only confirmation authority remains the inbound requester, not the dashboard owner.
- Tests prove both allowlisted contacts can be scanned without broad chat fallback.

Primary files:

- `apps/dashboard/src/assets/app.js`
- `apps/worker/src/jobs/media-sync.job.ts`
- `packages/resources/src/resource-confirmation.ts`
- `tests/dashboard/`
- `tests/whatsapp/phase10-live-polling.test.mjs`

### Phase 26: Evaluation Harness and Thermal Gates

Goal:

Add repeatable measurements so future optimizations are judged by accuracy, safety, and local machine impact.

Deliverables:

- Redacted fixture suite for text, resource, image, document, and audio requests.
- Metrics for p50/p95 ingest-to-reply latency, duplicate replies, unsafe sends, media save success, OCR/transcript success, retrieval quality, CPU pressure, and SSD growth.
- Trial report template that separates correctness, performance, thermal observations, and operator usability.

Acceptance checks:

- A phase cannot be called complete with only hardcoded or synthetic happy-path output.
- Evaluation commands work without a live WhatsApp session.
- Live checks remain opt-in and redacted.
- Dashboard exposes key health and latency indicators.

Primary files:

- `tests/`
- `scripts/`
- `docs/12_PHASE17_TRIAL_RUNBOOK.md`
- `docs/13_PHASE17_TRIAL_REPORT.md`
- `apps/dashboard/src/assets/app.js`

## Metrics to Track Going Forward

- p50 and p95 `message_received -> Postgres ingest` latency.
- p50 and p95 `message_received -> reply sent` latency.
- `wacli` or adapter commands per minute.
- Sync success, failure, stale-context, and backoff counts.
- Live worker CPU, memory, and laptop thermal observations during trial windows.
- Duplicate imported messages: target `0`.
- Duplicate outbound replies: target `0`.
- Wrong-contact imports: target `0`.
- Unsafe file sends without WhatsApp recipient confirmation: target `0`.
- Media download success rate for allowlisted media.
- OCR/transcription success and confidence distribution.
- Resource retrieval top-1/top-3 accuracy on redacted fixtures.

## Documentation Updates Required Before Implementation

Before implementing any phase above:

- Update `docs/ERD.md` before adding new tables, columns, vector indexes, or metadata JSONB fields.
- Update `docs/TDD.md` with the behavior and fallback state.
- Update `.env` and `.env.example` for any new runtime configuration.
- Update `docs/11_PHASE_COMPLETION_CHECKLIST.md` with exact checks run.
- Keep new source and heavy runtime state under `<external-data-root>`.
