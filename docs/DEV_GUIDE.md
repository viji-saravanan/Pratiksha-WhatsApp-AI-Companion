# Developer Guide

## 1. Purpose

This guide is binding for all generated and hand-written code in this project. It exists to prevent implementation drift from the design docs.

When generating code, use this file as the first constraint document, then use:

- [Codex Skill Pack](10_CODEX_SKILLS.md) for phase-specific implementation workflows
- [TDD.md](TDD.md)
- [ERD.md](ERD.md)
- [PROJECT_STRUCTURE.md](PROJECT_STRUCTURE.md)

If implementation requirements conflict with these docs, update the docs first and then write code.

For implementation work, start with `skills/viji-project-guardrails` and the active phase skill from `docs/10_CODEX_SKILLS.md`.

## 2. Non-Negotiable Constraints

- Personal WhatsApp only for Phase 0 and Phase 1.
- Do not implement WhatsApp Business Cloud API unless the design docs are updated and the user explicitly requests that direction.
- Use live personal WhatsApp through `wacli` as the implementation path unless a documented adapter spike proves it is not viable.
- Keep all WhatsApp-specific code inside `apps/wa-adapter-wacli` or the adapter interface package.
- Do not shell out to `wacli` from API, worker, dashboard, CLI, or generic tests.
- Do not implement a fake/mock WhatsApp adapter as a runtime service or product path.
- Test doubles for WhatsApp are allowed only inside isolated tests and fixtures where live sends would be unsafe; they must not be used to claim runtime implementation is complete.
- Heavy data must live under `VIJI_DATA_ROOT` on the external drive.
- The system must default to the `large-200gb` storage profile and keep `small-100gb` as an optional compact profile.
- The system must never assume the full 200 GB profile is available.
- Do not bake models, WhatsApp stores, media, database files, logs, or backups into Docker images.
- Do not store secrets, real WhatsApp payloads, real phone numbers, or private message fixtures in git.
- Auto-reply must be disabled by default.
- File/resource sharing must require exact-file confirmation from the WhatsApp requester by default.
- In any degraded or idle state, prefer no reply over an unsafe reply.

## 3. Allowed Implementation Scope

Code generation is allowed when the requested work maps to the documented architecture.

Allowed without a design update:

- Implementing services, packages, tests, and migrations already listed in `PROJECT_STRUCTURE.md`.
- Implementing tables already listed in `ERD.md`.
- Implementing idle states already listed in `TDD.md`.
- Adding tests for existing behavior.
- Refactoring within an existing package boundary without changing behavior.
- Adding small internal helper functions that do not introduce a new external dependency or new runtime service.

Requires a design update first:

- New database table, enum category, external service, Docker service, or storage path.
- New WhatsApp adapter.
- New cloud dependency.
- New paid dependency.
- New message recipient beyond the allowlist model.
- New background process that writes to disk.
- New file sharing behavior.
- New retention policy.
- New LLM provider or model runtime.
- Any change that increases storage usage materially.

Forbidden unless the user explicitly changes the project direction:

- Bulk messaging.
- Marketing automation.
- Replying to non-allowlisted contacts.
- Browser/Puppeteer WhatsApp automation before `wacli` and direct `whatsmeow` are evaluated.
- Using cloud LLMs for the core path.
- Writing heavy runtime state to the Mac internal disk.
- Committing real user messages, phone numbers, credentials, auth stores, or media.

## 4. Repository Boundaries

Follow the structure in `PROJECT_STRUCTURE.md`.

Rules:

- `apps/api` owns HTTP routes only. It must not run long background jobs.
- `apps/worker` owns orchestration and background jobs. It must not call `wacli` directly.
- `apps/dashboard` owns UI only. It must not connect directly to Postgres.
- `apps/cli` should use the API for normal operations and local log fallback only for emergency visibility.
- `apps/wa-adapter-wacli` is the only runtime owner of `wacli` commands.
- `apps/storage-guard` is the only runtime owner of mount, sentinel, and quota checks.
- `apps/llm-proxy` is the only runtime owner of direct local LLM calls.
- `packages/shared` owns cross-cutting primitives that must stay consistent across apps: error codes, typed errors, structured logging helpers, external call result shapes, and small Node process helpers.
- `packages/policy` must not import adapter-specific code.
- `packages/ai` must not send messages.
- `packages/whatsapp` defines adapter interfaces, JID helpers, and normalization only.
- `packages/db` owns database access.
- `packages/schemas` owns runtime validation schemas shared by apps.

## 5. Database Rules

Use Postgres with pgvector.

Every physical table must use one of these prefixes:

| Prefix | Purpose |
| --- | --- |
| `core_` | People, contacts, and channel accounts |
| `msg_` | Conversations, messages, and media links |
| `agent_` | Agent runs, drafts, outbox, and send attempts |
| `kb_` | Knowledge base and retrieval |
| `res_` | File assets and shareable resources |
| `policy_` | Reply and sharing policies |
| `ops_` | Adapter events, sync cursors, health, audit, and storage quota |

Rules:

- Do not create unprefixed tables.
- Do not create tables outside the ERD without updating `ERD.md`.
- Use `uuid` primary keys unless a documented reason exists.
- Include `created_at` on all persistent tables.
- Include `updated_at` on mutable tables.
- Use foreign keys for relationships shown in the ERD.
- Add idempotency constraints for inbound messages and outbound jobs.
- Store raw adapter payloads in `ops_adapter_events`, redacted by default.
- Store storage profile and usage data in `ops_storage_profiles` and `ops_storage_usage_snapshots`.
- Keep vector indexes explicit and migration-controlled.
- Do not store large file blobs in Postgres; store file paths and metadata.
- Postgres is the canonical store for normalized WhatsApp conversations and messages.
- Persist both inbound messages and `from_me` outbound messages in `msg_messages`.
- Do not make app code, dashboard code, worker code, or CLI code read from `wacli` SQLite files as application state.
- Treat `VIJI_WACLI_STORE` as adapter-owned auth/session/cache state only.

Migration rules:

- Every schema change needs a migration.
- Migration files live in `migrations/`.
- Migration names should be ordered and descriptive.
- Migrations must not include private seed data.
- Test migrations against an empty database and a migrated database where practical.

## 6. Storage Rules

The implementation must support these profiles:

- `large-200gb`: default.
- `small-100gb`: optional compact mode.

Rules:

- All heavy runtime data must be under `VIJI_DATA_ROOT`.
- `VIJI_DATA_ROOT` must point to the external drive.
- Default local path: `/Volumes/Arya 1TB/VijiAI`.
- The storage guard must verify mount, sentinel, write access, free space, and quota profile.
- Project quota usage must be measured from the VijiAI tree by allocated disk blocks, not sparse-file apparent size. Exclude development caches and generated outputs such as `.pnpm-store`, `node_modules`, `.git`, `dist`, `coverage`, `.cache`, `.turbo`, and `*.tsbuildinfo`; filesystem free space is a separate safety check.
- Non-allowlisted WhatsApp media download is off by default; allowlisted chat media download is enabled only through quota-controlled jobs.
- Models are referenced from `${VIJI_DATA_ROOT}/models`.
- Postgres data lives under `${VIJI_DATA_ROOT}/postgres`.
- wacli auth/store cache lives under `${VIJI_DATA_ROOT}/wacli/store`; it is not canonical application message storage.
- `VIJI_WACLI_STORE` defaults to `${VIJI_DATA_ROOT}/wacli/store` and is the only allowed `wacli` store path for runtime code.
- `VIJI_WACLI_MEDIA_ROOT` defaults to `${VIJI_DATA_ROOT}/wacli/media` and is the only allowed output root for adapter media downloads.
- `VIJI_WACLI_TIMEOUT` defaults to `30s` and is passed to normal live `wacli` commands.
- `VIJI_WACLI_SYNC_TIMEOUT` defaults to `75s` and is used only for scheduled one-shot syncs, because reconnect/sync can legitimately take longer than chat/message reads or sends.
- `VIJI_WACLI_MARK_READ_ENABLED` defaults to `true` for live dispatch; after a successful reply, the adapter must send a real WhatsApp read receipt for the inbound trigger or recipient confirmation message.
- `VIJI_WACLI_MARK_READ_BIN` points to the adapter-owned `wacli-mark-read` helper; do not fake mark-read in Postgres only.
- `VIJI_WACLI_MARK_READ_TIMEOUT` defaults to `5s` and bounds the post-send read receipt attempt so successful sends are not converted into failed sends because read receipts are unavailable.
- `VIJI_WACLI_LIVE_SMOKE_ENABLED` must default to `false`; live WhatsApp smoke checks require explicit operator opt-in.
- `VIJI_WACLI_LIVE_SEND_ENABLED` and `VIJI_AUTO_REPLY_ENABLED` must default to `false` in `.env`; `corepack pnpm stack:live:up` may enable them only for the Compose runtime after the trial gate passes.
- `VIJI_LIVE_POLL_INTERVAL_MS` defaults to `1000` and controls the target daemon polling interval; normal command timeout is controlled by `VIJI_WACLI_TIMEOUT`, while scheduled sync timeout is controlled by `VIJI_WACLI_SYNC_TIMEOUT`.
- `VIJI_LIVE_SYNC_BEFORE_POLL_ENABLED` defaults to `false`; setting it to `true` is a manual reliability override that forces a one-shot adapter sync before every poll.
- `VIJI_LIVE_SYNC_SCHEDULER_ENABLED` defaults to `true`; the live daemon should run startup, interval, and retry syncs through the scheduler instead of syncing on every hot poll.
- `VIJI_LIVE_STARTUP_SYNC_ENABLED` defaults to `true` so startup and reconnect windows refresh the adapter cache before normal hot polling.
- `VIJI_LIVE_SYNC_INTERVAL_MS` defaults to `60000`, `VIJI_LIVE_SYNC_RETRY_MIN_MS` defaults to `15000`, `VIJI_LIVE_SYNC_RETRY_MAX_MS` defaults to `300000`, and `VIJI_LIVE_SYNC_JITTER_RATIO` defaults to `0.15`.
- `VIJI_LIVE_SYNC_IDLE_EXIT` defaults to `12s` and bounds how long a scheduled one-shot live sync waits for idle before the poll reads the local `wacli` store.
- `VIJI_LIVE_AUTOMATION_BATCH_LIMIT` and `VIJI_LIVE_DISPATCH_LIMIT_PER_CYCLE` bound each live worker cycle.
- Live automation must run through the Compose `live-worker` service. Do not leave local `node` daemons running from the SSD for unattended operation.
- Live automation must not make a full adapter sync part of every hot poll; startup/reconnect sync, backoff, and stale-context gates must be explicit.
- Allowlisted chat media lives under `${VIJI_DATA_ROOT}/wacli/media` and is quota-controlled.
- Allowlisted media download jobs created by inbound ingestion must be drained by a Compose-managed worker path before received-media persistence can be called complete.
- Downloaded allowlisted WhatsApp media may be linked to `res_file_assets` and promoted into `res_resources` for future reuse, but it must still use the normal resource confirmation flow before any resend.
- Logs and observability state live under `${VIJI_DATA_ROOT}/logs`, `${VIJI_DATA_ROOT}/loki`, `${VIJI_DATA_ROOT}/prometheus`, and `${VIJI_DATA_ROOT}/grafana`.
- Shareable files live under `VIJI_RESOURCE_ROOT`, defaulting to `${VIJI_DATA_ROOT}/viji-files`.
- Resource repository subdirectories are `inbox`, `library`, `staged`, `thumbnails`, `manifests`, and `tmp`.
- File sharing code must never read from arbitrary local paths; files must be registered from the resource repository first.
- Previously received WhatsApp media must also be registered or promoted as a resource before resend; do not send directly from adapter cache paths.
- Resource indexing and registration must resolve real paths under `VIJI_RESOURCE_ROOT`; escaped paths and symlinks outside the root must be rejected before database writes.
- Text-like resource summaries must be bounded. Binary file understanding for PDF, DOCX, images, sheets, and slides belongs in the KB/parser phase, not ad hoc API route code.
- Temporary files live under `${VIJI_DATA_ROOT}/tmp` and must be cleaned.
- New ingestion, media downloads, and nonessential backups must stop in `DEGRADED_STORAGE_LOW`.
- Writes that require reliable persistence must stop in `IDLE_STORAGE_FULL`.

## 6.1 Chat Context Recovery Rules

Rules:

- Persist normalized messages for allowlisted contacts only.
- Persist allowlisted `from_me` messages as outbound rows so chat context is not split across stores.
- Preserve native WhatsApp quoted-reply relationships in `msg_messages.reply_to_msg_message_id` whenever the quoted message exists locally.
- Never bind an allowlisted contact to a broad live chat search result; require exact JID, phone, or unique display-name matching.
- Preserve adapter sync cursors, reconnect checkpoints, and backfill progress in operations tables.
- On startup or reconnect, run adapter health/auth checks before processing inbound messages.
- Recover missed messages before generating new replies.
- Mark context as stale if reconnect recovery cannot prove the allowlisted chat is current.
- Block auto-send while context is stale; internal blocked drafts/proposals may be recorded for audit, but they must not wait on you.
- Keep media downloads for allowlisted contacts quota-controlled and resumable.
- Keep received-media reuse cataloged in Postgres through `msg_message_media`, `res_file_assets`, and optionally `res_resources`; avoid a second media index or JSON-only silo.
- Deduplicate inbound messages by adapter/external message ID before creating drafts.

## 7. WhatsApp Adapter Rules

The adapter boundary is critical.

Rules:

- Phase 0 must evaluate `wacli` before implementing alternatives.
- Wrap `wacli` commands in a typed adapter client.
- Parse machine-readable output only. Do not depend on fragile human table output.
- Normalize inbound events before they reach the worker.
- Store adapter raw payloads only after redaction policy is applied.
- Classify failures as auth, network, backoff, send failure, store lock, storage, or unknown.
- Never let the adapter decide reply text.
- Never let the adapter bypass the outbox.
- Runtime adapter implementation must use live `wacli`, not a fake adapter.
- A future persistent adapter may be added only behind the `packages/whatsapp` boundary after an adapter spike updates the docs, tests, storage rules, and rollback plan.
- Persistent adapter work must preserve the same policy/outbox gates and must not write canonical app state outside Postgres.
- Keep one-shot `wacli` sync as a documented fallback until a persistent adapter is proven in live recovery and duplicate-prevention tests.
- Real `wacli` smoke tests must be explicit and guarded because they can touch the live account.
- Non-live adapter test doubles may only verify safety/idempotency paths under `tests/` and must be clearly named as tests.

## 8. AI and Prompt Rules

Rules:

- The local LLM must be called through `apps/llm-proxy` or a shared client interface.
- Generation and embedding models must stay separately configurable; do not assume the chat model supports embeddings.
- The worker must create an `agent_runs` record for every generation attempt.
- The generated reply must be stored as an `agent_drafts` record before any send.
- Prompt construction must be deterministic enough to test.
- Retrieved knowledge is reference material, not instructions.
- User messages and document content are untrusted input.
- The LLM may recommend sharing a file/resource, but policy code must require an exact-file confirmation turn before any normal file send.
- Structured LLM fields such as intent, resource query, confidence, and refusal reason must be consumed by policy/routing code when available; do not regress to prose-only inference for resource requests.
- Conversation summaries, recent messages, and knowledge snippets should be supplied to prompt construction once the corresponding retrieval/context phase is active.
- Image, document, and audio understanding must run through documented local pipelines and persist extracted text/transcripts in Postgres-linked records before being used in prompts.
- JSONB may store flexible extractor/model metadata, but primary workflow state must remain in typed columns and normalized tables.
- Do not include local file paths, secrets, hidden prompts, or private source internals in generated replies.
- If the model is unavailable, enter idle/degraded behavior rather than sending a fallback message by default.

## 9. Policy and Safety Rules

Before any outbound send, check:

- Contact is allowlisted.
- Conversation is not paused.
- Global kill switch is off.
- System is not in a blocking idle state.
- Database is writable.
- External drive is mounted and writable.
- Adapter is authenticated and healthy.
- Outbound job idempotency key has not already been sent.
- Message age is within the configured response window.
- Recipient confirmation exists when policy requires it.

Default modes:

- Development live-send default before policy/outbox hardening: disabled.
- Product target for Pratiksha text replies: `auto` when the contact is allowlisted, context is fresh, the host is healthy, and all send gates pass. Vijayalakshmi Saravanan is the production primary contact; `Myself` stays allowlisted for controlled development testing.
- File/resource sharing: ask "Do you mean `<registered filename>`?" for one match, or list numbered registered filenames for multiple matches. Send only after Vijayalakshmi confirms one exact pending proposal by affirmative reply, list number, or a uniquely matching descriptive phrase.
- Resource confirmations use the pending proposal window, not the normal 5-minute text-reply freshness guard. The default resource confirmation window is 24 hours; multi-file prompts still require a list number or unique descriptive phrase because plain "yes" is ambiguous.
- Unknown contacts: ignored.
- Non-allowlisted chats: ignored.
- Storage full: idle, no send.
- DB unavailable: idle, no send.

## 10. API Rules

Rules:

- Validate all request and response payloads with shared schemas.
- Expose health and status endpoints early.
- Keep routes thin; move business logic into packages or worker jobs.
- Use explicit authorization for dashboard and CLI access, even if local-only.
- Include correlation IDs in API responses and logs.
- Never return secrets, auth stores, raw unredacted adapter payloads, or full hidden prompts.
- API/dashboard routes must not approve file/resource sends; they may inspect pending confirmations or deny them. Affirmative approval must be an inbound WhatsApp message from the allowlisted requester.

## 11. Dashboard Rules

The dashboard is an operations surface, not a marketing site.

Required early views:

- Onboarding/checklist.
- Status.
- Adapter health.
- Conversation timeline.
- Pending recipient confirmations.
- Logs/audit.
- Storage quota.
- Settings with pause/resume/readonly/kill switch.

Rules:

- Keep UI dense, clear, and operational.
- Keep non-log views low-reading and action-oriented: show cards, signals, and plain next actions first; reserve long tables, raw JSON, and container output for dedicated detail areas.
- Use plain user-facing navigation labels. Current dashboard order is Home, Assistant, Files, Chats, Sync, Settings, Logs.
- Use blue as the primary accent and keep light/dark theme behavior available.
- Use icons for primary navigation and commands, and keep modern motion/decorative effects restrained enough that degraded states and controls remain readable.
- Support direct local review links such as `?view=files` and `?theme=dark` for screenshots and operator QA; never put tokens, contact identifiers, or resource approval state in dashboard URLs.
- Keep Logs last and separate from normal controls; group audit events by Safety, Files, WhatsApp, AI, Sync, Storage, and System.
- Include a raw container logs area inside Logs for debugging. It must show Docker logs per Viji Helper container/service, not Postgres audit JSON. Keep raw JSON, UUIDs, queue names, and adapter internals out of primary UI elsewhere.
- Container logs are read server-side through `VIJI_DOCKER_SOCKET_PATH` when `VIJI_CONTAINER_LOGS_ENABLED=true`. Keep the dashboard bound to localhost or a trusted network because raw container logs can include sensitive runtime details.
- File uploads from the dashboard must land under `${VIJI_RESOURCE_ROOT}/staged`, be registered through the normal resource API, and still require Vijayalakshmi's WhatsApp confirmation before any send.
- Browser assets must not contain `VIJI_API_TOKEN`, database URLs, passwords, QR/auth payloads, or raw adapter payloads.
- Use the dashboard service as a safe proxy to the API; do not call Postgres or `wacli` from browser code.
- Onboarding must be available in the visual dashboard and guide SSD mount/sentinel state, Docker service health, Postgres health, `wacli` auth status, allowlisted contact setup, resource root setup, model readiness, and live-send smoke opt-in state.
- Show idle and degraded states prominently.
- Show storage profile and quota usage.
- Do not hide pending recipient-confirmation requirements.
- Do not allow file/resource sends without exact-file recipient confirmation.
- Do not expose an affirmative dashboard approval control for resource sends. The dashboard may inspect or deny only.

## 12. CLI Rules

The CLI must expose the same critical operations as the dashboard.

Minimum commands:

```bash
viji status
viji pause
viji resume
viji readonly on
viji readonly off
viji logs --service agent --tail 200
viji conversation --contact viji --last 20
viji kb reindex
viji resources list
viji resources index --scope library --yes
viji resources register library/<file-name> --yes
viji storage status
viji storage profile
viji sync status
viji sync recover
viji chat backfill --contact <id>
viji media sync --contact <id>
viji context show --contact <id>
viji wa doctor
viji wa auth
viji backup run
viji restore check
corepack pnpm backup:run -- --json
corepack pnpm restore:check -- --json
corepack pnpm retention:plan
corepack pnpm retention:apply -- --json
```

Rules:

- Commands must be safe by default.
- Destructive commands require explicit flags.
- Backup artifacts must stay under `${VIJI_DATA_ROOT}/pgbackups`.
- Restore checks must use an isolated disposable database.
- Retention must prune backups and temporary files before touching any durable data, and must not delete pinned resources, current summaries, `wacli/store`, or Postgres data.
- CLI output should be readable by humans, with optional JSON where useful.
- `viji status` must work even when some services are degraded, using fallback reads when necessary.

## 13. Observability Rules

Rules:

- Use structured JSON logs.
- Use `packages/shared` for log record shape and logger helpers.
- Include correlation ID for each inbound message.
- Emit metrics using the `viji_` prefix.
- Record audit events for send, recipient confirm/deny, pause, resume, auth, config changes, storage state changes, and idle transitions.
- Do not log full message bodies by default.
- Do not log secrets, tokens, QR data, or auth stores.
- Dashboard and CLI must show idle/degraded state history.

## 13.1 Runtime Lifecycle Rules

Normal unattended runtime is Docker Compose, not local background `node` processes.

Rules:

- Use `corepack pnpm stack:dashboard:up` for the dashboard runtime; it must start Postgres, API, and dashboard together.
- Use `corepack pnpm stack:app:up` when the AI proxy is also required.
- Use `corepack pnpm stack:down` before ejecting the external SSD; the script must include every Compose profile and `--remove-orphans` so profile-backed containers do not outlive the network.
- Do not leave `corepack pnpm api:start`, `corepack pnpm dashboard:start`, or `corepack pnpm llm-proxy:start` running as the normal operator workflow; those are development-only commands.
- Dashboard containers must call the API through Docker service DNS (`http://api:8787`) by default, not `host.docker.internal`, so a standalone local API process is not required.
- Any new long-running service must be represented in `docker-compose.yml`, have a documented stop path, and be covered by Compose lifecycle tests.

## 14. Testing Rules

Testing is not optional for message-sending behavior.

Required test layers:

- Unit tests for policy, idle states, prompt construction, idempotency, and resource permissions.
- Contract tests for adapter, LLM client, and API schemas.
- Integration tests for migrations, repositories, pgvector retrieval, and outbox retry behavior.
- End-to-end tests using redacted recorded `wacli` fixtures or isolated test doubles where live sends would be unsafe.
- Failure tests for disk missing, storage low/full, DB down, LLM down, network down, auth required, and duplicate inbound events.

Rules:

- No real WhatsApp session is required for default tests.
- Live `wacli` adapter smoke tests must be opt-in and require explicit operator action.
- Runtime code must not depend on fake/mock WhatsApp adapters.
- Unsafe sends must not happen in failure tests.
- Every parser for `wacli` output must have fixture tests.
- Every migration must have at least one migration test before schema-dependent code is considered complete.
- Live-loop changes must include tests or trial metrics for effective latency, sync backoff, duplicate prevention, and stale-context behavior.
- Media-understanding phases must include negative tests for corrupt files, unsupported MIME types, missing transcripts/OCR, path escapes, and storage-full states.
- Future completion reports must include accuracy and performance evidence, not only a single live happy-path observation.

## 15. Dependency Rules

Rules:

- Prefer small, well-maintained, open-source dependencies.
- Do not add paid SaaS dependencies to the core path.
- Do not add a new runtime language unless the design docs are updated.
- Do not add Puppeteer/Chromium WhatsApp automation before the `wacli` spike is complete.
- Do not add cloud LLM SDKs to the core path.
- Pin major versions where practical.
- Document why a dependency is needed when it affects runtime, storage, security, or packaging.

## 16. Configuration Rules

Rules:

- Use `VIJI_` prefix for environment variables.
- Keep `.env.example` in git.
- Whenever code, Docker Compose, scripts, tests, or docs introduce a new environment variable, update both `.env` and `.env.example` in the same change.
- `.env.example` must contain safe local defaults or placeholders only.
- `.env` may contain local machine defaults and explicitly approved allowlist phone/JID values needed for exact live WhatsApp matching.
- `.env` must not contain WhatsApp auth stores, real message payloads, production API tokens, or production secrets.
- Keep the repo-root `.env` limited to local Compose and script defaults.
- Keep secret-bearing runtime env files under `${VIJI_DATA_ROOT}/config` or `${VIJI_DATA_ROOT}/config/secrets`.
- Keep secrets under `${VIJI_DATA_ROOT}/config/secrets`.
- Require explicit storage profile selection.
- Require explicit contact allowlist.
- Require explicit opt-in to auto-reply.
- Use safe defaults if optional config is missing.
- Fail into idle state for missing required runtime config.

## 17. Code Style Rules

Rules:

- TypeScript files use `kebab-case`.
- Types and classes use `PascalCase`.
- Functions and variables use `camelCase`.
- Database tables and columns use `snake_case`.
- Physical database columns must use table-stem prefixes, for example `core_person_id`, `msg_message_body`, and `agent_draft_created_at`.
- Metrics use `viji_` prefix.
- Idle reason codes use uppercase constants.
- Avoid clever abstractions until duplication or complexity justifies them.
- Keep side effects at app/service boundaries.
- Prefer explicit return types on exported functions.
- Prefer schema validation at process boundaries.

## 17.1 Modularity Rules

Rules:

- Search for an existing helper before adding a new function with overlapping behavior.
- Do not create duplicate functions under different names.
- Put cross-cutting error codes, typed errors, log helpers, external call result types, and small Node process helpers in `packages/shared`.
- Put business-domain logic in the owning package, not in `packages/shared`.
- Keep `packages/shared` free of database, adapter, dashboard, model-runtime, and policy side effects.
- Move repeated code into `packages/shared` only after the shared behavior is stable enough to name clearly.
- If a one-off helper becomes needed by a second app or package, promote it instead of copying it.
- Script-only bootstrap helpers may remain under `scripts/lib` when they must run before TypeScript packages are built, but they must not be duplicated inside runtime apps.

## 18. Code Generation Checklist

Before generating code:

- Confirm the task maps to a documented phase.
- Confirm the target files belong to the documented project structure.
- Confirm no new table, service, storage path, dependency, or adapter is being introduced without a doc update.
- Confirm storage writes stay under `VIJI_DATA_ROOT`.
- Confirm send behavior is policy-gated.
- Confirm tests are included or updated for the behavior.
- Confirm any new shared utility belongs in `packages/shared` and does not duplicate existing behavior.

After generating code:

- Run the narrowest relevant tests.
- Run lint/typecheck once those scripts exist.
- Verify no secrets or real WhatsApp data were added.
- Verify generated tables use ERD prefixes.
- Verify logs are redacted by default.
- Verify unsafe sends are blocked in failure paths.
- Verify duplicated helper logic was not introduced across apps, packages, or scripts.

## 19. When In Doubt

Choose the safer local-first option:

- Exact-file recipient confirmation before resource/file sends.
- Live WhatsApp implementation behind policy and recipient-confirmation gates; isolated test doubles only for unsafe-to-repeat test paths.
- Idle before risky fallback.
- Metadata before media download.
- One model before many models.
- Documentation update before new architecture.
