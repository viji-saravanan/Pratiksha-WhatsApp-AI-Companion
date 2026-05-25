# Implementation Phases

## Purpose

This roadmap splits implementation into reviewable phases. Each phase should be implemented, verified, reviewed, and corrected before the next phase begins.

Working rule:

1. Implement one phase.
2. Run that phase's acceptance checks.
3. Do a focused code review.
4. Fix review findings.
5. Move to the next phase only after acceptance passes.

## Current Status

Phase work should use the project-local skills listed in [10_CODEX_SKILLS.md](10_CODEX_SKILLS.md). Start with `$viji-project-guardrails`, then use the active phase skill.

For a concise completion tracker, see [11_PHASE_COMPLETION_CHECKLIST.md](11_PHASE_COMPLETION_CHECKLIST.md).

For the repo-wide review that added the next implementation phases, see [14_REPO_WIDE_REVIEW_AND_FUTURE_PHASES.md](14_REPO_WIDE_REVIEW_AND_FUTURE_PHASES.md).

| Phase | Status | Notes |
| --- | --- | --- |
| Phase 0 | Complete | Foundation, SSD workspace, storage guard, Docker skeleton, initial migrations, skill pack |
| Phase 1 | Complete | Core schema, migration runner, synthetic seed, disposable Postgres migration tests |
| Phase 2 | Complete | Typed DB package, repository layer, transaction helper, disposable Postgres repository tests |
| Phase 3 | Complete | Live `wacli` adapter contract, redacted fixture normalization, allowlisted ingestion, duplicate replay guard, ignored-contact/group audits, opt-in live smoke path |
| Phase 4 | Complete | Pure policy package for trusted text auto-replies, idle/degraded blockers, and exact-file recipient confirmation |
| Phase 5 | Complete | Deterministic AI prompt/stub package, agent run/draft persistence, worker draft job, `[Pratiksha]` prefix, stale-context and LLM-failure blocking |
| Phase 6 | Complete | Outbox jobs, send attempts, recipient confirm/deny operations, stable idempotency, recorded dispatcher, retryable failure path |
| Phase 7 | Complete | Local authenticated API, API-backed CLI, status/storage/sync/audit/policy/confirmation routes, redacted outbox summaries |
| Phase 8 | Complete | `wacli` 0.6.0 typed wrappers, fixture parsers, QR auth, redacted read-only live smoke, and send-gate hardening |
| Phase 9 | Complete | Reconnect recovery, stale/fresh context transitions, resumable backfill page, summaries, API/CLI backfill status, and opt-in live recovery smoke |
| Phase 10 | Complete | Postgres-canonical live allowlist polling, `from_me` persistence, and live ingest command |
| Phase 11 | Complete | Host Ollama runtime with SSD model storage, typed structured-output client, authenticated LLM proxy, real draft smoke, and real embedding smoke |
| Phase 12 | Complete | Resource catalog schema/repository, safe local indexing, API/CLI registration, ranked filename/metadata suggestions, pending proposal options, and WhatsApp-only list-number/text confirmation |
| Phase 13 | Complete | Allowlisted media sync, storage-guarded download dispatch, file-asset linkage, and received-media resource promotion |
| Phase 14 | Complete | API-backed local dashboard, safe proxy, onboarding, status, conversations, confirmations, sync/media, resources, audit, and settings |
| Phase 15 | Complete | Compressed Postgres backups, isolated restore checks, dry-run retention sweep, and safe pruning of backups/tmp files |
| Future Observability | Complete | Structured redacted logs, `viji_` metrics, dashboard/container logs, CLI log fallback, Prometheus/Loki/Grafana provisioning |
| Phase 16 | Complete | Failure safety suite for DB/storage/LLM/adapter/live polling/media failures with no unsafe sends |
| Phase 17 | In progress | Controlled local trial and tuning; live worker, readiness tooling, Compose lifecycle, and a fresh `Myself` live reply proof are implemented; Vijayalakshmi follow-up remains |
| Phase 18 | Complete | Project-local `$viji-helper-dev` skill created and validated |
| Phase 19 | Complete | Scheduled startup/interval/retry sync, sync-specific timeout, hot-poll sync disabled by default, backoff, timing logs, API/CLI/dashboard visibility |
| Phase 20 | Complete | Persistent WhatsApp adapter spike, event-stream contract, option comparison, and rollback gate |
| Phase 21 | Complete | Automatic received-media persistence in unattended Docker runtime |
| Phase 22 | Complete | Image and document understanding for OCR, parsing, and safer retrieval |
| Phase 23 | Complete | Local voice note transcription, transcript persistence, status surfaces, and low-confidence safety gate |
| Phase 24 | Planned | Hybrid lexical plus semantic resource retrieval with pgvector |
| Phase 25 | Planned | Multi-contact runtime copy and authority cleanup |
| Phase 26 | Planned | Evaluation harness and thermal/performance gates |

## Phase 0: Foundation, SSD Workspace, and Storage Guard

Goal:

Establish a clean local-first project foundation that runs from the SSD and verifies the external-drive allocation before any WhatsApp, AI, or database work depends on it.

Deliverables:

- Active source workspace at `<external-data-root>/workspace/viji-helper`.
- Runtime data root at `<external-data-root>`.
- Sentinel file at `<external-data-root>/.viji-helper-root`.
- Idempotent SSD bootstrap command.
- Monorepo scaffold with `pnpm`, TypeScript, config examples, and package boundaries.
- Storage guard package and CLI checker.
- Docker Compose skeleton.
- Initial migrations for extensions and storage/ops tables.
- Portable storage tests that do not require the real SSD.
- Opt-in SSD storage check.

Acceptance checks:

```bash
corepack pnpm bootstrap:ssd
node --test tests/**/*.test.mjs
corepack pnpm typecheck
node scripts/check-ssd-storage-profile.mjs
docker compose config
docker compose build storage-guard
docker compose run --rm storage-guard
```

Review focus:

- No heavy generated state committed.
- `.pnpm-store`, `node_modules`, `dist`, and `*.tsbuildinfo` ignored.
- Storage quota measures project usage, not whole SSD usage.
- Docker install respects `pnpm-lock.yaml`.

Exit criteria:

- All acceptance checks pass.
- Phase 0 code review has no open P1/P2 findings.

## Phase 1: Core Database Schema and Migrations

Goal:

Create the durable schema for identity, conversations, messages, sync recovery, and media jobs before implementing runtime behavior.

Deliverables:

- Migrations for:
  - `core_people`
  - `core_contacts`
  - `core_channel_accounts`
  - `msg_conversations`
  - `msg_messages`
  - `msg_message_media`
  - `msg_conversation_summaries`
  - `msg_history_backfill_jobs`
  - `msg_media_download_jobs`
  - `res_file_assets` as the minimal file-asset table needed for `msg_message_media.backing_res_file_asset_id`; resource catalog behavior remains Phase 12
  - `ops_adapter_events`
  - `ops_sync_cursors`
  - `ops_sync_runs`
  - `ops_audit_events`
- Seed script for local dev contact data, including Vijayalakshmi as allowlisted.
- Migration runner script.
- Migration tests using a disposable Postgres container or test database.

Acceptance checks:

```bash
node --test tests/migrations/phase1-migrations.test.mjs
node --test tests/**/*.test.mjs
corepack pnpm typecheck
docker compose config
```

The migration test must verify:

- Empty database migrates successfully.
- Re-running migrations is safe.
- Vijayalakshmi seed data can be inserted without real phone/JID data.
- Unique constraints prevent duplicate external messages, adapter events, media jobs, and sync cursors.
- All table and column names follow the ERD naming convention.

Review focus:

- No generic physical columns such as `id`, `created_at`, or `state`.
- Foreign keys point to prefixed primary keys.
- Idempotency constraints exist for inbound messages and outbound jobs.
- No private contact data in seed files.

Exit criteria:

- Migration tests pass.
- Schema matches `docs/ERD.md`.

## Phase 2: DB Access Layer and Repositories

Goal:

Create typed database access without leaking SQL details throughout apps.

Deliverables:

- `packages/db` package.
- Database connection config.
- Repository modules for:
  - contacts
  - channel accounts
  - conversations
  - messages
  - sync cursors
  - sync runs
  - backfill jobs
  - media jobs
  - audit events
- Transaction helper.
- Test harness for repository tests.

Acceptance checks:

- Can create/find an allowlisted contact.
- Can create/find a conversation by external chat ID.
- Can insert an inbound message idempotently.
- Duplicate message insert returns existing row or explicit duplicate result.
- Can update sync cursors transactionally.
- `tests/db/phase2-repositories.test.mjs` passes against disposable Postgres.

Review focus:

- Repositories expose behavior-level methods, not raw table plumbing.
- SQL uses prefixed physical columns consistently.
- Transaction boundaries protect cursor/message writes.
- No app code connects directly to Postgres outside `packages/db`.

Exit criteria:

- Repository tests pass against disposable database.
- No duplicated SQL for core message writes.

## Phase 3: Live WhatsApp Adapter Contract and Message Normalization

Goal:

Implement the adapter contract around live personal WhatsApp through `wacli`, while keeping sends policy-gated and opt-in.

Deliverables:

- `packages/whatsapp` adapter interface.
- Normalized inbound message schema.
- `apps/wa-adapter-wacli` command wrapper skeleton.
- Redacted fixture format for `wacli` adapter events and command outputs.
- Message normalizer.
- Inbound ingestion path that stores allowlisted live messages.
- Opt-in live `wacli doctor` and auth/store smoke checks.

Acceptance checks:

- Redacted `wacli` fixture for Vijayalakshmi creates one normalized message.
- Duplicate fixture or live replay does not duplicate storage.
- Non-allowlisted message is ignored and audited.
- Group chat is ignored unless explicitly allowlisted later.
- Adapter payloads are redacted before storage.
- Live `wacli` smoke checks are skipped by default and run only with explicit operator opt-in.

Review focus:

- No `wacli` imports outside `apps/wa-adapter-wacli`.
- Adapter never decides reply content.
- Normalization handles missing optional fields.
- Raw payload logging is off by default.
- No fake/mock WhatsApp adapter is shipped as a runtime service.

Exit criteria:

- Adapter contract and redacted fixture tests pass.
- Live `wacli` doctor/auth smoke path is documented and guarded.
- Phase 3 fixture ingestion is covered by `tests/whatsapp/phase3-wacli-ingestion.test.mjs`.

## Phase 4: Policy Engine and Safety Gates

Goal:

Centralize all send/no-send decisions before drafts and outbound jobs exist.

Deliverables:

- `packages/policy`.
- Reply modes:
  - `confirm_resource`
  - `auto`
  - `readonly`
  - `paused`
  - `idle`
- Global kill switch.
- Context freshness checks.
- Storage/DB/adapter health checks as policy inputs.
- File/resource sharing policy defaults, including exact-file recipient confirmation before normal file sends.

Acceptance checks:

- Development live-send default is disabled, but product policy supports unattended `auto` for allowlisted trusted text replies.
- Auto mode permits text sends only when contact, context, storage, DB, adapter, model, and kill-switch checks pass.
- Unknown contacts are ignored.
- Readonly never creates outbound jobs.
- Paused conversations do not draft/send.
- Stale context blocks auto-send.
- Storage full blocks send behavior.
- File sharing requires exact-file recipient confirmation before normal sends.

Review focus:

- Policy package does not import adapter code.
- Policy package does not call LLMs or DB directly.
- Every outbound path must call policy before queueing.

Exit criteria:

- Policy unit tests cover all modes and blocking states.

## Phase 5: Draft Generation with Test LLM Stub

Goal:

Create the agent run and draft pipeline using a deterministic test LLM stub until the local model runtime is ready.

Deliverables:

- `packages/ai` prompt builder.
- Deterministic test LLM client.
- Agent worker job for inbound messages.
- `agent_runs` and `agent_drafts` persistence.
- `[Pratiksha]` prefix behavior.
- Context-state capture on each agent run.

Acceptance checks:

- Redacted inbound adapter fixture creates an `agent_run`.
- Redacted inbound adapter fixture creates a pending draft.
- Draft body starts with `[Pratiksha]`.
- Stale context records a blocked run and creates no outbound job.
- LLM failure records failed agent run and does not send.

Review focus:

- Prompt construction is deterministic and testable.
- User messages and summaries are treated as untrusted reference material.
- No outbound jobs are created unless policy permits the send or a required recipient confirmation exists.

Exit criteria:

- Agent/draft tests pass with redacted adapter fixtures and the deterministic test LLM stub.

## Phase 6: Outbox, Recipient Confirmation, and Idempotent Sends

Goal:

Add the safe path from policy-permitted generated replies and recipient-confirmed resource proposals to queued outbound jobs, with live WhatsApp dispatch disabled until Phase 8 hardening is accepted.

Deliverables:

- `agent_outbound_jobs` repository.
- `agent_send_attempts` repository.
- WhatsApp-recipient confirmation/denial operations; dashboard/API can inspect or deny, but cannot approve file sends.
- Outbound dispatcher interface with live `wacli` dispatch disabled until Phase 8 hardening is accepted.
- Idempotency key generation.
- Audit events for recipient confirm/deny, send, block, and fail.

Acceptance checks:

- Denied resource proposal never queues.
- Policy-permitted text reply queues exactly one outbound job.
- A Vijayalakshmi inbound "yes" to the exact pending filename queues exactly one outbound job.
- Duplicate recipient confirmation does not create duplicate jobs.
- Dashboard/API confirmation attempts are rejected and never queue resource sends.
- Test dispatcher records exactly one policy-permitted send intent.
- Failed send records attempt and remains retryable.

Review focus:

- Send path re-checks policy immediately before dispatch.
- Idempotency keys are stable.
- Audit events are redacted.

Exit criteria:

- End-to-end safety test passes: redacted inbound fixture -> policy decision or recipient confirmation -> outbound job -> recorded send intent.

## Phase 7: Local API and CLI Operations

Goal:

Expose enough operator control to use the system safely before real WhatsApp integration.

Deliverables:

- `apps/api` with local-only HTTP server.
- `apps/cli`.
- API routes for:
  - health/status
  - conversations
  - drafts
  - recipient confirmation inspection and denial; approval must come from WhatsApp inbound messages
  - policy mode changes
  - storage status
  - sync status
  - audit logs
- CLI commands:
  - `viji status`
  - `viji pause`
  - `viji resume`
  - `viji readonly on/off`
  - `viji storage status`
  - `viji sync status`
  - `viji drafts`
  - `viji confirmations`
  - `viji audit`

Operational commands:

```bash
corepack pnpm typecheck
node --test tests/api-cli/phase7-api-cli.test.mjs
corepack pnpm api:start
corepack pnpm viji -- status
```

Acceptance checks:

- CLI status works when all services are healthy.
- CLI status shows degraded storage/context states.
- CLI can inspect generated replies, pending recipient confirmations, and blocked send decisions from redacted adapter fixtures.
- API and CLI agree on state.

Review focus:

- Dashboard/CLI/API do not connect directly to Postgres outside documented package boundaries.
- API never returns secrets or raw unredacted payloads.
- CLI destructive commands require explicit flags.

Exit criteria:

- Operator can inspect the policy and pending-confirmation workflow from CLI without enabling live sends.
- API and CLI remain local-token authenticated through `VIJI_API_TOKEN`.
- Outbox inspection exposes payload keys and blocked state, not raw job payload values.

## Phase 8: `wacli` Adapter Hardening and Send Spike

Goal:

Harden live personal WhatsApp automation through `wacli` after the adapter contract exists.

Deliverables:

- `apps/wa-adapter-wacli`.
- Typed wrapper for:
  - `wacli doctor`
  - `wacli auth`
  - sync or polling command
  - message list/search
  - send text
  - send file
  - media download
  - mark-read helper for post-reply read receipts when `wacli` does not expose the command directly
- Fixture parsers for all command outputs.
- Manual smoke-test script.
- Adapter spike report in docs.

Operational commands:

```bash
node --test tests/whatsapp/phase8-wacli-hardening.test.mjs
corepack pnpm wa:auth:status
VIJI_WACLI_LIVE_SMOKE_ENABLED=true corepack pnpm wa:doctor:smoke
VIJI_WACLI_LIVE_READ_SMOKE_ENABLED=true corepack pnpm wa:read:smoke
```

Acceptance checks:

- Auth persists after container/app restart with store on SSD.
- Vijayalakshmi chat/JID can be identified.
- A test inbound message can be detected through the redacted read-only live smoke.
- An explicit live-send smoke test reply can be sent only when live-send smoke testing is enabled.
- Parser tests pass without real WhatsApp.
- Failures are classified as auth, network, backoff, send, store lock, storage, or unknown.

Review focus:

- No other service shells out to `wacli`.
- Real WhatsApp tests remain opt-in.
- No real message bodies or phone numbers are committed.

Exit criteria:

- Continue with `wacli` for Phase 9 because QR auth persisted on the SSD store, read-only chat/message access worked through the linked local store, and live sends remain disabled unless explicit smoke-send flags are set.

## Phase 9: Reconnect Recovery and History Backfill

Goal:

Make chat context durable across startup, disconnect, reconnect, and adapter restarts.

Deliverables:

- Reconnect recovery job.
- Missed-message replay from durable cursor.
- Resumable all-available history backfill for allowlisted contacts.
- Context freshness state updates.
- Backfill progress CLI/API.
- Rolling conversation summaries.

Acceptance checks:

- Reconnect recovery imports missed redacted fixture messages and has an opt-in live `wacli` smoke path.
- Duplicate replay does not duplicate messages or drafts.
- Backfill resumes after interruption.
- Context becomes `fresh` only after recovery succeeds.
- `DEGRADED_CONTEXT_STALE` blocks auto-send.

Operational commands:

```bash
node --test tests/whatsapp/phase9-reconnect-recovery.test.mjs
VIJI_WACLI_LIVE_RECOVERY_SMOKE_ENABLED=true corepack pnpm wa:recovery:smoke
corepack pnpm viji -- backfill status
```

Review focus:

- Cursor updates and message inserts are transactional.
- Backfill is resumable and idempotent.
- Summaries do not replace retained recent messages.

Exit criteria:

- Redacted reconnect/backfill fixture tests pass.
- Real adapter recovery path has opt-in smoke coverage through `wacli` with redacted output only.

## Phase 10: Postgres-Canonical Live Intake

Goal:

Keep WhatsApp message context in one canonical store by importing allowlisted live adapter reads into Postgres, including owner-sent `from_me` messages.

Deliverables:

- `msg_messages` stores inbound and outbound message rows for allowlisted direct chats.
- Native WhatsApp quoted replies populate `reply_to_msg_message_id` when the quoted message is already present in Postgres.
- Live allowlist poll job scans allowlisted contacts, resolves their DM chat, and imports bounded message windows.
- `corepack pnpm wa:ingest:once` runs a redacted one-shot live ingest into Postgres.
- `VIJI_LIVE_POLL_INTERVAL_MS` defines the target daemon interval; `VIJI_WACLI_TIMEOUT` bounds each adapter command.
- `wacli` SQLite files are adapter auth/session/cache only, not canonical application storage.

Acceptance checks:

- `tests/whatsapp/phase10-live-polling.test.mjs` passes.
- Reconnect recovery stores both inbound and `from_me` messages idempotently.
- Outbox dispatch records sent outbound messages in `msg_messages`.
- Inbound and `from_me` quoted reply fixtures preserve reply relationships.
- Live ingest command returns redacted output and does not print private message bodies.

Review focus:

- Dashboard, CLI, worker, and AI context read messages from Postgres, not adapter SQLite files.
- Polling imports are idempotent by external message ID.
- Broad or ambiguous chat search results are skipped instead of falling back to the first direct chat.
- Command timeouts and poll intervals are separate and configurable.

Exit criteria:

- Postgres is the only application message source of truth.

## Phase 13: Allowlisted Media Sync

Goal:

Download chat media for allowlisted contacts with quota and policy controls, then make eligible received media reusable when Vijayalakshmi asks for it again later.

Deliverables:

- Media download queue.
- Media storage under `<external-data-root>/wacli/media`.
- Media metadata in `msg_message_media`.
- File asset linkage for downloaded media.
- Promotion path from downloaded `msg_message_media` to `res_resources` when media is safe and useful to share again.
- Resource matching over promoted received media, including filename, caption, MIME type, sender, received date, and extracted/OCR summary where available.
- Storage warning integration.

Acceptance checks:

- Allowlisted media is queued.
- Non-allowlisted media is ignored.
- Duplicate media jobs are prevented.
- Downloaded Vijayalakshmi media is linked to `res_file_assets` and can be promoted into the resource catalog without duplicating file bytes.
- If Vijayalakshmi asks for previously received media, the assistant proposes matching registered/promoted media and still waits for her exact confirmation before sending.
- Storage warning pauses media downloads.
- Storage critical blocks media writes.

Review focus:

- Media downloads are resumable.
- Media paths cannot escape the configured data root.
- Large media cannot starve DB/log/model storage.
- Received media reuse must not bypass recipient confirmation or resource allowlist policy.

Exit criteria:

- Media sync is safe enough to run for allowlisted contacts only.
- Downloaded received media can be reused only through the resource catalog and recipient-confirmation path.

## Phase 11: Local LLM Runtime

Goal:

Replace the deterministic test LLM stub with local inference while preserving safety and storage controls.

Deliverables:

- `apps/llm-proxy`.
- Ollama host-service profile for Apple Silicon development.
- Optional llama.cpp Docker profile later if CPU-only Docker inference is acceptable.
- Model health check.
- Generation endpoint.
- Embedding endpoint and local embedding service wrapper.
- Model paths under `<external-data-root>/models`.
- Timeout and token limits.

Acceptance checks:

- Missing model enters `IDLE_MODEL_MISSING`.
- LLM timeout records failed agent run and does not send.
- Real local model can generate a draft from redacted adapter fixture input.
- Draft starts with `[Pratiksha]`.
- Real local embedding model returns a vector through the proxy.

Review focus:

- Model files are not copied into Docker images.
- Prompts do not expose hidden instructions or local file paths.
- Mac host Ollama uses SSD model storage and is documented as the Apple Metal path.
- CPU-only Docker latency tradeoff is documented before adding a Docker LLM runtime.

Exit criteria:

- Local model can create acceptable policy-scored reply candidates.
- LLM proxy health is green for both the generation and embedding models.

## Phase 12: Resource Catalog

Goal:

Support file lookup and confirmation-gated sending, such as finding and proposing Vijayalakshmi's resume PDF.

Deliverables:

- `res_file_assets` and `res_resources` repositories.
- Resource registration CLI/API.
- Tags, aliases, descriptions, sensitivity, and allowed-contact policy.
- Local folder indexing.
- Bounded text summary extraction for TXT, MD, CSV, JSON, TSV, and HTML.
- Metadata-only registration for binary formats such as PDF, DOCX, images, sheets, and slides until the KB extraction phase adds specialized parsers/OCR.
- Resource match planner.
- Confirmation-gated file send path.
- Pending resource proposal options stored in Postgres.
- List-number and descriptive-text confirmation, such as "2" or "12th marksheet".

Acceptance checks:

- Register a resource called "Viji resume".
- Index files from `VIJI_RESOURCE_ROOT` without reading arbitrary local paths.
- A message like "Can I have my resume?" replies with "Do you mean `<registered filename>`?"
- If multiple resources match, the assistant replies with a numbered list of registered filenames.
- For a pending numbered list, "yes" remains ambiguous, while "2" or a uniquely matching phrase resolves to one exact registered resource.
- A "yes" reply sends only the exact pending proposed file.
- A "no" or ambiguous reply does not send and asks for clarification.
- Proposed file is not sent until recipient confirmation.
- Sensitive/restricted files are sent only if the resource policy allows Vijayalakshmi and she confirms the exact filename; otherwise they are blocked or clarified in chat.
- Missing file enters blocked state.
- Escaped paths such as `../outside.pdf` are rejected and never registered.

Review focus:

- File paths stay under configured resource roots.
- LLM can recommend resources but cannot authorize sharing.
- Wrong-file risk is mitigated by exact-file confirmation and clear registered filenames.

Exit criteria:

- Resource catalog works end-to-end with redacted adapter fixture input.
- Resource registration and indexing are available through authenticated API and API-backed CLI.

## Phase 14: Dashboard

Goal:

Add a visual operations dashboard after backend and CLI behavior is stable.

Deliverables:

- Onboarding page/checklist.
- Status page.
- Conversation timeline.
- Pending recipient confirmations page.
- Storage quota page.
- Sync/backfill/media page.
- Resource catalog page.
- Logs/audit page.
- Settings page with pause/resume/readonly/kill switch.
- Low-reading command-board home, compact assistant controls, resource workbench, and card-first summaries before tables.
- Dashboard proxy that keeps `VIJI_API_TOKEN` server-side.
- Read-only media job API endpoint for sync/media visibility.
- Plain-language navigation: Home, Assistant, Files, Chats, Sync, Settings, Logs.
- Blue primary dashboard theme with light/dark mode switching.
- Icon-led command/navigation surfaces and restrained motion/decorative treatments.
- Local QA links with `?view=<view>` and `?theme=<light|dark>` for screenshots and browser verification.
- Dashboard upload path that writes to `viji-files/staged` and registers through the normal resource API.
- Logs view is last and categorized separately from normal control surfaces, with a raw Docker container logs stream for debugging each Viji Helper container/service.

Acceptance checks:

- Dashboard onboarding shows SSD mount/sentinel, Docker services, Postgres, `wacli` auth, allowlisted contact, resource root, model readiness, and live-send smoke opt-in state.
- Onboarding can show the next required setup action without exposing secrets, QR data, auth stores, or raw WhatsApp payloads.
- Dashboard and CLI report the same status.
- Pending recipient confirmations can be inspected and expire correctly.
- Storage/context stale states are prominent.
- Resource proposals show file metadata before recipient confirmation.
- Uploaded files are stored under the SSD resource repository and still require WhatsApp recipient confirmation before sharing.
- Browser assets do not include tokens, database passwords, raw auth data, or resource approval calls.
- Dashboard can deny a proposal but cannot approve one; affirmative approval remains an inbound WhatsApp confirmation.
- Normal controls avoid raw JSON-first displays and expose technical details only when needed; raw Docker logs stay in the Logs troubleshooting area.

Review focus:

- Dashboard is operational, not marketing-style.
- Onboarding is an operational checklist with clear pass/fail/blocked states.
- No secrets or raw auth payloads are displayed.
- UI handles degraded states clearly.

Exit criteria:

- User can inspect live adapter health, policy decisions, pending confirmations, and guarded send workflows visually.

Implementation:

- `apps/dashboard` serves the local operations UI.
- `/api/*` dashboard routes proxy to `apps/api` with authorization injected server-side.
- `GET /dashboard/summary` exposes sanitized readiness fields only.
- `GET /media/jobs` exposes media download queue state for dashboard visibility.
- `tests/dashboard/phase14-dashboard.test.mjs` verifies secret redaction, proxy auth, and blocked dashboard approval.

## Future Phase: Observability and Logs

Goal:

Wire metrics and logs into visual and CLI workflows.

Deliverables:

- Structured JSON logs.
- Correlation IDs.
- Prometheus metrics.
- Loki log shipping.
- Grafana dashboards.
- CLI log fallback.

Acceptance checks:

- Metrics expose storage, adapter, sync, draft, outbox, LLM, and context freshness state.
- Logs are redacted by default.
- Dashboard shows current and recent idle/degraded states.
- CLI can tail logs.

Review focus:

- No message bodies in default logs.
- No secrets, QR data, tokens, or auth stores in logs.
- Metrics use `viji_` prefix.

Exit criteria:

- Operational visibility works during normal and degraded flows.

Implementation:

- `packages/shared` provides redacted JSON logging, Prometheus metric rendering, and shared Docker container log reading.
- `apps/api`, `apps/dashboard`, and `apps/llm-proxy` expose local `/metrics` endpoints with `viji_` metric names and no private message content.
- `apps/api` reports degraded status when Postgres is unavailable so dashboard/CLI can still show idle/degraded state.
- `apps/cli` exposes `viji logs containers [--service <service>|all] [--tail <lines>] [--json]`.
- `apps/dashboard` continues to show categorized audit logs and raw container logs in the final Logs navigation item.
- `infra/observability` provisions Prometheus, Loki, Promtail, and Grafana dashboard/datasource config.
- `tests/observability/observability.test.mjs` verifies redaction, metric naming, metrics endpoints, CLI log fallback, and provisioning.

Completed checks:

```bash
node --test tests/observability/observability.test.mjs
node --test tests/**/*.test.mjs
corepack pnpm typecheck
docker compose --profile observability config
```

## Phase 15: Backup, Restore, and Retention

Goal:

Make the system recoverable and bounded under the 200 GB allocation.

Deliverables:

- Postgres backup script.
- Restore-check script.
- Retention jobs.
- Media cache pruning.
- Vector/version cleanup.
- Audit retention controls.
- `backup:run`, `restore:check`, `retention:plan`, and `retention:apply` commands.
- Dry-run retention by default; deletion requires `--apply`.

Acceptance checks:

- Backup creates compressed artifact under `pgbackups`.
- Restore check validates backup in isolated environment.
- Retention jobs do not delete pinned resources or needed context summaries.
- Storage warning triggers cleanup-safe behavior.
- Retention prunes only expired backup artifacts and temporary files in this pass.

Review focus:

- Backups do not include secrets unless explicitly intended.
- Restore process is documented and tested.
- Retention cannot break idempotency.

Exit criteria:

- A backup can be restored and basic status queries work.

Implementation:

- `scripts/backup-postgres.mjs` writes `pg_dump -Fc` artifacts and manifests under `${VIJI_DATA_ROOT}/pgbackups`.
- `scripts/restore-check-postgres.mjs` restores a selected or latest backup into an isolated disposable Postgres container and validates key tables.
- `scripts/retention-sweep.mjs` plans or applies backup/tmp pruning without touching `viji-files/library`, Postgres data, `wacli/store`, or current context tables.
- `tests/backup/phase15-backup-retention.test.mjs` verifies backup, restore, and retention safety.

## Phase 16: Failure and Chaos Testing

Goal:

Prove unsafe sends do not happen during failures.

Deliverables:

- Failure test suite for:
  - external drive missing
  - storage warning/full
  - DB unavailable
  - LLM unavailable
  - WhatsApp auth required
  - network down
  - duplicate inbound event
  - interrupted backfill
  - media download failure
- Runbook updates for recovery.

Acceptance checks:

- No failure test causes unsafe send.
- Idle/degraded states are visible in CLI/dashboard.
- Recovery path is documented.

Review focus:

- Failure modes prefer idle over risky fallback.
- Retry loops have bounded backoff.
- Operator actions are audited.

Exit criteria:

- System is safe enough for longer local trial.

Implementation:

- `tests/chaos/phase16-failure-safety.test.mjs` covers unavailable Postgres, missing SSD root, storage blocks, model/LLM failures, adapter auth failures, ambiguous chat results, and media download failures.
- Outbound dispatch failure cases assert that no adapter send intent is created and no send attempt is recorded.
- API/CLI status remains readable during database outage and storage-missing states.
- Live polling adapter failures do not import messages or queue replies.
- Media storage and adapter failures do not create reusable resources or downloaded media state.

Completed checks:

```bash
node --test tests/chaos/phase16-failure-safety.test.mjs
node --test tests/**/*.test.mjs
corepack pnpm typecheck
docker compose config
docker compose --profile observability config
```

## Phase 17: Local Trial and Tuning

Goal:

Run the assistant in controlled unattended text mode and tune behavior while using recipient confirmation for file/resource actions.

Deliverables:

- Trial checklist.
- API-backed trial status command.
- Prompt tuning notes.
- Model latency report.
- Adapter reliability report.
- Resource-catalog accuracy notes.

Acceptance checks:

- Trusted-contact auto text replies are useful in real conversations.
- File/resource sends happen only after Vijayalakshmi confirms the exact proposed filename.
- `[Pratiksha]` prefix is consistently applied.
- No duplicate replies.
- Reconnect recovery works after restart.
- Storage remains within budget.

Review focus:

- Draft tone and language mirroring.
- False resource matches.
- Latency and CPU pressure.
- WhatsApp adapter reliability.

Exit criteria:

- Decide whether trusted-contact auto text mode is reliable enough to keep enabled.

Implementation started:

- `scripts/phase17-trial-status.mjs` queries API endpoints for trial readiness instead of using hardcoded UI or fixture data.
- `corepack pnpm trial:status` prints a redacted Phase 17 readiness report.
- `corepack pnpm stack:dashboard:up` starts the Compose-managed Postgres, API, and dashboard runtime; `corepack pnpm stack:down` stops it before SSD eject.
- `corepack pnpm stack:live:up` starts the Compose-managed live worker with live auto-reply/send flags enabled at command scope, while `.env` stays disabled by default.
- `apps/worker/src/jobs/live-automation.job.ts` runs the poll, draft/resource suggestion, recipient confirmation, and dispatch cycle from Postgres-canonical state.
- `infra/docker/live-worker.Dockerfile` builds `wacli` and the adapter-owned `wacli-mark-read` helper into the live worker image so runtime WhatsApp commands remain inside the adapter boundary.
- Dashboard Compose networking uses `http://api:8787` so no standalone local API Node process is required.
- `docs/12_PHASE17_TRIAL_RUNBOOK.md` defines the readiness gate, rollback, and observation rules.
- `docs/13_PHASE17_TRIAL_REPORT.md` records the initial live-gate observation and remaining fresh-message checks.
- `tests/trial/phase17-trial-status.test.mjs` verifies API-derived status, auth headers, and filename redaction.
- `tests/trial/phase17-live-automation.test.mjs` verifies text automation, resource suggestion, and WhatsApp-recipient list-number confirmation without duplicate processing.
- `tests/compose/compose-lifecycle.test.mjs` verifies the dashboard profile owns the API/Postgres lifecycle and the live profile owns the live worker/Postgres lifecycle.

## Phase 18: Optional Project Codex Skill

Goal:

Create a compact local skill so future agents automatically follow this repo's rules.

Deliverables:

- Local skill `viji-helper-dev`.
- `SKILL.md` with concise triggers and workflow.
- References to `DEV_GUIDE.md`, `ERD.md`, and this phase plan.
- Validation with skill tooling.

Acceptance checks:

- Skill validates.
- Skill does not duplicate long docs.
- Future implementation prompts can reference the skill.

Review focus:

- Skill remains short and actionable.
- No secrets or local private data in skill resources.

Exit criteria:

- Restart Codex only if the skill is installed into the discoverable skills directory.

Implementation complete:

- `skills/viji-helper-dev/SKILL.md` provides a compact development workflow for future Viji Helper work.
- `skills/viji-helper-dev/agents/openai.yaml` provides UI metadata and a default invocation prompt.
- `scripts/generate-project-skills.mjs` includes the skill so regeneration keeps it aligned with the project skill pack.
- `docs/10_CODEX_SKILLS.md` documents `$viji-helper-dev` as the first skill to invoke for future repo work.
- `corepack pnpm skills:validate` validates the project-local skill pack.

## Phase 19: Live Loop Optimization

Goal:

Reduce unattended runtime heat and latency while keeping reconnect recovery safe.

Deliverables:

- Separate startup/reconnect sync from the hot polling path.
- Add sync backoff, jitter, and stale-context handling that does not hammer `wacli`.
- Expose effective polling latency and sync duration in logs, metrics, CLI, and dashboard.
- Keep `wacli sync` available as a reliability fallback and manual recovery path.

Acceptance checks:

- Default live mode does not run a full one-shot sync before every poll cycle.
- Fresh messages are still recovered after restart and reconnect.
- Sync failures produce idle/degraded state instead of unsafe replies.
- Tests cover sync success, sync failure, backoff, stale context, and no duplicate replies.
- A trial report records command count, CPU pressure, and observed reply latency.
- Scheduled one-shot syncs use `VIJI_WACLI_SYNC_TIMEOUT`, while normal chat/read/send commands continue to use `VIJI_WACLI_TIMEOUT`.

Review focus:

- No loss of canonical Postgres message storage.
- No broad chat fallback.
- No local `node` process outside Compose for unattended operation.

Exit criteria:

- Live polling feels responsive without creating repeated sync churn or excessive heat.
- A fresh live test records actual message-received, Postgres-ingested, draft-created, and sent timestamps.

Implementation complete:

- `apps/worker/src/jobs/live-sync-scheduler.ts` adds startup, interval, and retry sync decisions with bounded backoff and jitter.
- `scripts/live-worker-daemon.mjs` uses the scheduler so default hot polling skips full `wacli sync` except at startup, interval, or retry windows.
- `apps/worker/src/jobs/live-automation.job.ts` reports `syncDurationMs`, `cycleDurationMs`, and `syncReason` in cycle results and logs.
- `.env`, `.env.example`, and `docker-compose.yml` default `VIJI_LIVE_SYNC_BEFORE_POLL_ENABLED=false`, add scheduler controls, and use `VIJI_WACLI_SYNC_TIMEOUT=75s` so measured one-shot syncs are not killed by the normal 30-second command timeout.
- `apps/api/src/app.ts`, `apps/cli/src/main.ts`, and `apps/dashboard/src/assets/app.js` expose live poll/sync settings through status, metrics, CLI output, and the dashboard runtime panel.
- Tests cover scheduler startup, interval, retry backoff, Compose defaults, API/CLI status, dashboard/runtime exposure, and the Phase 17 live automation flows.

Completed checks:

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
```

Latest live proof:

- `corepack pnpm stack:live:up` starts the Docker-owned API, dashboard, Postgres, LLM proxy, storage guard, and live worker.
- `corepack pnpm trial:status` reports `Ready for controlled trial: yes`.
- A fresh allowlisted `Myself` message received at `2026-05-24T10:00:54Z` was imported into Postgres at `2026-05-24T10:01:35.616808Z`, drafted by local Ollama in `4872ms`, queued at `2026-05-24T10:01:54.532107Z`, marked read through the adapter path, and recorded as sent at `2026-05-24T10:02:04.838341Z`.
- A second fresh `Myself` message from the same sync window was also replied to once. No duplicate outbound rows were observed for those triggers.
- This proves the current `wacli` runtime works, but also confirms the remaining latency limitation: fresh intake is bounded by the scheduled sync interval plus one-shot sync duration. A later persistent-adapter prototype is still required before the product can claim push-like delivery.

## Phase 20: Persistent WhatsApp Adapter Spike

Goal:

Evaluate a persistent-socket WhatsApp adapter path that can provide lower latency, richer event handling, and fewer subprocess launches than the current `wacli` wrapper.

Deliverables:

- Adapter decision record comparing current `wacli`, direct `whatsmeow`, and any viable Baileys-style bridge.
- Event-stream interface proposal in the WhatsApp adapter boundary.
- Prototype plan for inbound message, receipt, media, reconnect, and auth events.
- Rollback plan that keeps `wacli` as the stable runtime until the spike passes.

Acceptance checks:

- No production runtime switches adapter without a reviewed implementation and tests.
- New adapter keeps auth/session state on the SSD.
- New adapter writes canonical state to Postgres only.
- Sends still go through policy and outbox.

Review focus:

- Interface stability.
- Socket lifecycle and reconnect correctness.
- Media event and receipt event coverage.

Exit criteria:

- Decide whether to implement a persistent adapter or continue optimizing `wacli`.

Implementation complete:

- `docs/ADAPTER_SPIKE.md` compares current `wacli`, documented `wacli` follow/events behavior, direct `whatsmeow`, and Baileys bridge options.
- Local capability checks recorded that the hosted `wacli` docs describe `--events` and `--webhook`, but the available host and Docker binaries do not expose those flags yet.
- `packages/whatsapp/src/adapter.interface.ts` adds optional `WhatsAppStreamingAdapter` and event envelopes for message, receipt, media, connection, history-sync, call, and adapter-error events.
- `hasWhatsAppEventStream` lets future workers detect event-stream support without changing the current `wacli` runtime path.
- `tests/whatsapp/phase20-persistent-adapter-contract.test.mjs` locks the boundary: current `wacli` remains request/response, event streaming is opt-in, and rollback stays explicit.

Completed checks:

```bash
node --test tests/whatsapp/phase20-persistent-adapter-contract.test.mjs
corepack pnpm typecheck
node --test tests/**/*.test.mjs
docker compose --profile dashboard --profile app --profile live config --quiet
```

## Phase 21: Automatic Received-Media Persistence

Goal:

Ensure allowlisted received media is downloaded, stored, deduplicated, and optionally promoted while the Docker live runtime is unattended.

Deliverables:

- Compose-managed media drain path.
- Quota-controlled download loop.
- Safe partial-file cleanup.
- Dashboard and CLI media queue status.
- Reuse path for downloaded media through the normal resource confirmation flow.

Acceptance checks:

- Allowlisted inbound image, document, and audio media are downloaded automatically when storage is healthy.
- Non-allowlisted and group media remain ignored.
- Duplicate media events do not duplicate file assets.
- Storage warning/full states block downloads safely.
- Received media can be promoted and later suggested without bypassing WhatsApp recipient confirmation.

Review focus:

- Storage quota safety.
- Idempotency.
- No sidecar-only media catalog.

Exit criteria:

- Media sent by Vijayalakshmi or the test contact is reliably saved during normal Docker runtime.

Implementation notes:

- `scripts/live-worker-daemon.mjs` drains queued media jobs each live-worker cycle when `VIJI_LIVE_MEDIA_DRAIN_ENABLED=true`.
- `drainMediaDownloadQueue` downloads up to `VIJI_LIVE_MEDIA_DRAIN_LIMIT_PER_CYCLE` jobs, stores each job under an SSD-backed media subdirectory, cleans partial files after failures, and promotes successful downloads when `VIJI_LIVE_MEDIA_AUTO_PROMOTE_ENABLED=true`.
- Promoted media resources stay contact-scoped and still require WhatsApp recipient confirmation before any resend.
- API, CLI, dashboard, and metrics now expose media-drain settings and active media-download queue counts.

Completed checks:

```bash
node --test tests/whatsapp/phase21-media-daemon.test.mjs
node --test tests/whatsapp/phase13-media-sync.test.mjs tests/api-cli/phase7-api-cli.test.mjs tests/observability/observability.test.mjs
corepack pnpm typecheck
node --test tests/**/*.test.mjs
docker compose --profile dashboard --profile app --profile live config --quiet
```

## Phase 22: Image and Document Understanding

Goal:

Make saved images and documents searchable and usable as trusted reference snippets without exposing local paths or treating extracted text as instructions.

Deliverables:

- OCR/text extraction for images and PDFs.
- Parser support for DOCX, spreadsheets, and slides where practical.
- Extractor metadata persisted in Postgres-linked records.
- Local-only summarization path for parsed content.
- `kb_knowledge_sources`, `kb_documents`, and `kb_document_chunks` migration.
- `packages/resources` extractor boundary with text, PDF, image OCR, corruption, unsupported MIME, and path-escape behavior.
- `apps/worker` resource-understanding job that persists chunks and updates safe resource summaries.
- Resource register/index API paths trigger extraction by default and return redacted extraction status summaries.
- API/live-worker Docker images include free/open-source `tesseract-ocr` and `poppler-utils` for OCR/PDF extraction.

Acceptance checks:

- Extracted content lands in typed resource/KB records with JSONB used only for flexible extractor metadata.
- File blobs remain outside Postgres.
- Tests cover marksheet-like documents, corrupt files, unsupported MIME types, and path escape attempts.
- Prompt snippets are bounded and sanitized.

Review focus:

- Parser isolation.
- Resource permissions.
- Prompt injection handling for extracted content.

Exit criteria:

- Pratiksha can use image/document content to clarify file requests and answer safe questions.

Implementation notes:

- Complete in source. Extraction records are typed Postgres rows linked to `res_file_assets`; flexible parser details stay in JSONB metadata.
- Text-like files use the built-in parser. PDFs use `pdftotext` when available and a bounded literal-text fallback for simple PDFs. Images use local `tesseract` OCR when available.
- Unsupported formats are persisted as `unsupported`; corrupt PDFs are persisted as `failed`; neither path invents content.
- Extracted snippets are sanitized for local paths, secrets, and instruction-injection language before becoming chunks or resource summaries.

Verification snapshot:

- `node --test tests/resources/phase22-document-understanding.test.mjs`
- `node --test tests/resources/phase22-document-understanding.test.mjs tests/resources/phase12-resource-api-cli.test.mjs`
- `node --test tests/migrations/phase1-migrations.test.mjs`
- `corepack pnpm typecheck`
- `node --test tests/**/*.test.mjs`
- `docker compose --profile dashboard --profile app --profile live config --quiet`
- `docker compose build api live-worker`

## Phase 23: Voice Note Transcription

Goal:

Transcribe allowlisted WhatsApp audio locally and make transcripts available to response generation and resource retrieval.

Deliverables:

- Local speech-to-text adapter decision.
- Transcript persistence linked to message media.
- Transcript confidence/status in dashboard and CLI.
- Failure behavior that stores media without inventing transcript text.

Acceptance checks:

- Audio messages without text become automation candidates only after transcript creation.
- Low-confidence transcripts are visible as reviewable degraded state.
- No cloud transcription dependency is added.
- Tests cover short audio, empty/noisy audio, unsupported MIME, and duplicate jobs.

Review focus:

- Local model performance and disk use.
- Transcript privacy.
- No unsafe sends from low-confidence transcription.

Exit criteria:

- Voice notes from allowlisted contacts can be stored and understood locally.

Implementation notes:

- `migrations/0010_message_media_transcripts.sql` stores one transcript row per downloaded media item with typed status, transcript text, language, confidence, duration, model name, and flexible local STT metadata.
- `packages/ai/src/speech-to-text.ts` runs a configurable local command, defaulting to a multilingual `whisper.cpp` style `whisper-cli` invocation with language auto-detection. No cloud transcription dependency is introduced.
- `apps/worker/src/jobs/audio-transcription.job.ts` drains downloaded audio media, writes transcript status to Postgres, and only copies high-confidence transcript text into the inbound audio message body so automation can pick it up.
- Empty, low-confidence, failed, and unsupported audio leaves the original media saved but does not create an automation candidate.
- API, CLI, dashboard, metrics, and Compose env now expose transcript status and local STT settings.

Completed checks:

```bash
node --test tests/whatsapp/phase23-voice-transcription.test.mjs
node --test tests/migrations/phase1-migrations.test.mjs
corepack pnpm typecheck
corepack pnpm --filter @viji/dashboard build
docker compose --profile dashboard --profile app --profile live config --quiet
node --test tests/**/*.test.mjs
docker compose build api live-worker dashboard
```

## Phase 24: Semantic Retrieval and Resource Matching

Goal:

Improve resource suggestions with hybrid exact, lexical, and semantic matching while preserving the exact-file WhatsApp confirmation rule.

Deliverables:

- ERD update for embedding storage with table-prefixed columns.
- Embedding job for resources and extracted KB chunks.
- Hybrid ranker combining exact filename, aliases, lexical score, semantic score, contact permission, and recency.
- Redacted evaluation fixtures for ambiguous documents such as marksheets, resumes, and certificates.

Acceptance checks:

- Exact filename matches remain deterministic.
- Ambiguous matches produce numbered options.
- Semantic retrieval improves recall without sending files automatically.
- Vector indexes are migration-controlled.
- Tests cover positive, negative, ambiguous, and permission-filtered retrieval.

Review focus:

- Retrieval safety.
- Ranking explainability.
- Storage and index size under the 200 GB cap.

Exit criteria:

- Natural requests such as "send my marksheet" return the best matching registered choices.

## Phase 25: Multi-Contact Copy and Authority Cleanup

Goal:

Keep Vijayalakshmi as the production primary contact while making runtime UI, resource descriptions, and media summaries correct for the actual allowlisted requester.

Deliverables:

- Replace reusable hardcoded contact copy with contact-derived labels.
- Keep docs explicit about Vijayalakshmi as production primary and Myself as controlled testing.
- Ensure resource-confirmation prompts use the actual requesting contact.
- Add dashboard and worker tests for primary and test-contact copy.

Acceptance checks:

- Runtime copy does not say Vijayalakshmi for media/resources received from Myself.
- Dashboard owner/API still cannot approve a file send.
- WhatsApp-only confirmation belongs to the inbound requester.
- Dual-contact polling tests still pass without broad chat fallback.

Review focus:

- Product authority rules.
- Contact-specific wording.
- Dashboard readability.

Exit criteria:

- Test-contact development no longer produces misleading contact labels.

## Phase 26: Evaluation Harness and Thermal Gates

Goal:

Create repeatable evaluation gates so future changes are judged by safety, accuracy, performance, and local machine impact.

Deliverables:

- Redacted fixture suite for text, resource, image, document, and audio requests.
- Latency, duplicate, unsafe-send, retrieval, media-save, OCR/transcript, CPU, and SSD-growth metrics.
- Trial report template for correctness, performance, thermal observations, and usability.
- Dashboard indicators for key live health and latency signals.

Acceptance checks:

- New phases cannot be marked complete with hardcoded or happy-path-only output.
- Evaluation commands work without a live WhatsApp session.
- Live checks remain opt-in and redacted.
- Phase reports include checks run, failures, and tuning decisions.

Review focus:

- Non-flaky metrics.
- Privacy-safe fixtures.
- Clear pass/fail gates.

Exit criteria:

- Future optimization work has measurable acceptance criteria beyond "it responded once."

## Phase Completion Template

Use this template at the end of every phase:

```text
Phase:
Delivered:
Checks run:
Review findings:
Fixes applied:
Open risks:
Next phase:
```

## Stop Conditions

Stop implementation and review before continuing if:

- A P1 review finding is open.
- Tests or typecheck fail.
- The SSD root is unavailable.
- Storage guard reports critical.
- Real WhatsApp behavior differs from adapter assumptions.
- Context window or rate limits are approaching.
