import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const skillsRoot = join(repoRoot, "skills");
const projectRoot = "/Volumes/Arya 1TB/VijiAI/workspace/viji-helper";

const docRefs = [
  "docs/DEV_GUIDE.md",
  "docs/09_IMPLEMENTATION_PHASES.md",
  "docs/ERD.md",
  "docs/TDD.md",
  "docs/PROJECT_STRUCTURE.md"
];

const baseChecks = [
  "node --test tests/**/*.test.mjs",
  "corepack pnpm typecheck",
  "docker compose config"
];

const skills = [
  {
    name: "viji-project-guardrails",
    title: "Viji Helper Project Guardrails",
    description:
      "Apply shared Viji Helper engineering guardrails. Use before implementation, review fixes, docs changes, storage work, database work, WhatsApp adapter work, policy changes, AI draft behavior, monitoring, backups, or any phase transition.",
    goal:
      "Keep every change aligned with the local-first, SSD-backed, unattended trusted-contact project constraints.",
    read: docRefs,
    workflow: [
      "Work only in `/Volumes/Arya 1TB/VijiAI/workspace/viji-helper`; do not revive the old Desktop copy.",
      "Confirm the SSD root `/Volumes/Arya 1TB/VijiAI` and `.viji-helper-root` sentinel when storage behavior is touched.",
      "Read the active phase in `docs/09_IMPLEMENTATION_PHASES.md` before editing code.",
      "Update docs first when a change would alter architecture, tables, services, storage paths, policies, retention, or dependencies.",
      "Implement one phase slice at a time, then run its acceptance checks and review before continuing.",
      "Stop on open P1/P2 findings, failing checks, missing SSD root, storage critical state, or uncertain WhatsApp behavior."
    ],
    guardrails: [
      "Keep heavy runtime state under `VIJI_DATA_ROOT`; never commit stores, media, models, logs, backups, secrets, phone numbers, or real messages.",
      "Default to policy-gated trusted-contact behavior; unknown contacts and stale context must not auto-send.",
      "Route WhatsApp behavior through adapter boundaries only; only `apps/wa-adapter-wacli` may own `wacli` execution.",
      "Use prefixed table and column names from `docs/ERD.md`; never create generic physical columns such as `id` or `created_at`.",
      "Prefer idle/degraded no-reply behavior over unsafe fallback replies."
    ],
    checks: baseChecks,
    review: [
      "Verify package boundaries from `docs/DEV_GUIDE.md`.",
      "Verify no unrelated refactors or private data were introduced.",
      "End every phase with the completion template from `docs/09_IMPLEMENTATION_PHASES.md`."
    ]
  },
  {
    name: "viji-helper-dev",
    title: "Viji Helper Dev",
    description:
      "Follow Viji Helper development rules. Use when implementing, reviewing, testing, or documenting this repo, especially changes touching Docker lifecycle, Postgres schema, WhatsApp integration, AI behavior, dashboard UI, storage, files, logs, or phase status.",
    goal:
      "Keep future Viji Helper code generation aligned with the dev guide, ERD naming rules, SSD-backed Docker runtime, and WhatsApp/file-sharing safety constraints.",
    read: [
      "docs/DEV_GUIDE.md",
      "docs/ERD.md",
      "docs/09_IMPLEMENTATION_PHASES.md",
      "docs/11_PHASE_COMPLETION_CHECKLIST.md"
    ],
    workflow: [
      "Work only in `/Volumes/Arya 1TB/VijiAI/workspace/viji-helper`.",
      "Start from the active phase in `docs/09_IMPLEMENTATION_PHASES.md`.",
      "Use the existing package boundaries before adding new abstractions.",
      "Keep reusable code in shared packages instead of duplicating helpers across apps.",
      "Update `.env`, `.env.example`, docs, and tests whenever runtime behavior or configuration changes.",
      "Use Docker Compose as the normal runtime boundary; local `node apps/...` servers are development-only."
    ],
    guardrails: [
      "Do not revive the old Desktop copy.",
      "Do not hardcode private filenames, phone numbers, messages, dashboard statuses, or test-only fixtures into runtime UI.",
      "Keep canonical application state in Postgres, not SQLite or scattered JSON stores.",
      "Use ERD-prefixed table and column names; never add generic physical columns such as `id` or `created_at`.",
      "Do not let dashboard/API owner actions confirm file sends; Vijayalakshmi's WhatsApp confirmation is the authority.",
      "Do not route `wacli` execution outside the WhatsApp adapter boundary.",
      "Prefer idle/degraded no-reply behavior over unsafe fallback replies."
    ],
    checks: [
      "Run focused tests for the changed behavior.",
      "node --test tests/**/*.test.mjs",
      "corepack pnpm typecheck",
      "docker compose --profile dashboard config",
      "Verify the dashboard visually after frontend changes."
    ],
    review: [
      "Update `docs/11_PHASE_COMPLETION_CHECKLIST.md`.",
      "Record checks run and any remaining blocked gates.",
      "Stop if a P1/P2 review finding, failing test, storage critical state, or uncertain live WhatsApp behavior remains."
    ]
  },
  {
    name: "viji-phase-00-foundation",
    title: "Phase 0 Foundation and Storage",
    description:
      "Implement or review Viji Helper Phase 0 foundation work. Use for SSD workspace setup, storage guard, Docker skeleton, pnpm scaffold, storage profile tests, lockfile reproducibility, and fixes to quota or ignored cache behavior.",
    goal:
      "Make the SSD-backed repo and storage guard reliable before database, WhatsApp, or AI work depends on it.",
    read: ["docs/DEV_GUIDE.md", "docs/04_STORAGE_PROFILE.md", "docs/09_IMPLEMENTATION_PHASES.md"],
    workflow: [
      "Keep source and heavy development caches on the SSD workspace.",
      "Use `corepack pnpm bootstrap:ssd` to create or verify the SSD directory layout and sentinel file.",
      "Measure project allocation usage by walking the VijiAI tree and excluding `.pnpm-store`, `node_modules`, `.git`, generated builds, and caches.",
      "Use filesystem free space only as a separate safety check.",
      "Keep default tests portable with temp roots; keep real SSD checks opt-in.",
      "Keep Docker builds reproducible with `pnpm-lock.yaml` and frozen lockfile installs."
    ],
    guardrails: [
      "Do not treat APFS volume usage as the 200 GB project allocation.",
      "Do not commit `.pnpm-store`, `node_modules`, `dist`, `*.tsbuildinfo`, logs, or runtime state.",
      "Do not add runtime services before the storage guard and compose config are clean."
    ],
    checks: [
      "corepack pnpm bootstrap:ssd",
      "node --test tests/**/*.test.mjs",
      "corepack pnpm typecheck",
      "node scripts/check-ssd-storage-profile.mjs",
      "docker compose config",
      "docker compose build storage-guard",
      "docker compose run --rm storage-guard"
    ],
    review: [
      "Check storage quota math against project usage, not whole-drive usage.",
      "Check test portability outside this exact SSD.",
      "Check lockfile and cache behavior."
    ]
  },
  {
    name: "viji-phase-01-db-schema",
    title: "Phase 1 Core Database Schema",
    description:
      "Implement or review Viji Helper Phase 1 Postgres schema work. Use for migrations, ERD alignment, prefixed table and column naming, idempotency constraints, seed data, migration runners, and migration tests.",
    goal:
      "Create durable identity, conversation, message, sync recovery, media job, and audit schema before runtime behavior.",
    read: ["docs/DEV_GUIDE.md", "docs/ERD.md", "docs/09_IMPLEMENTATION_PHASES.md"],
    workflow: [
      "Implement only tables already listed for Phase 1 unless `docs/ERD.md` is updated first.",
      "Use physical columns with singular table-stem prefixes, including primary keys and timestamps.",
      "Use semantic foreign key names such as `sender_core_contact_id` and `target_msg_conversation_id`.",
      "Add idempotency constraints for adapter events, inbound messages, sync cursors, and media jobs.",
      "Seed only synthetic local dev data; do not commit real phone numbers, JIDs, or messages."
    ],
    guardrails: [
      "Do not create generic columns like `id`, `created_at`, `updated_at`, `state`, or `name`.",
      "Do not store large blobs in Postgres.",
      "Do not add new tables without ERD and phase-plan updates."
    ],
    checks: [
      "node --test tests/migrations/phase1-migrations.test.mjs",
      "Run migration tests against an empty disposable database.",
      "Run re-run or dirty-state migration behavior checks.",
      ...baseChecks
    ],
    review: [
      "Compare every table and column against `docs/ERD.md`.",
      "Verify uniqueness for duplicate external messages and sync cursors.",
      "Verify foreign keys and indexes support reconnect/backfill."
    ]
  },
  {
    name: "viji-phase-02-db-repositories",
    title: "Phase 2 DB Access Layer",
    description:
      "Implement or review Viji Helper Phase 2 data-access work. Use for packages/db, repository APIs, transaction helpers, typed SQL boundaries, and repository tests over contacts, conversations, messages, sync, media, and audit data.",
    goal:
      "Provide typed repository behavior so apps and workers do not spread raw SQL across the codebase.",
    read: ["docs/DEV_GUIDE.md", "docs/ERD.md", "docs/09_IMPLEMENTATION_PHASES.md"],
    workflow: [
      "Create `packages/db` as the only normal owner of Postgres access.",
      "Expose behavior-level repository methods, not table-shaped plumbing.",
      "Wrap cursor/message writes in transactions.",
      "Return explicit idempotent duplicate outcomes for inbound messages and jobs.",
      "Build repository tests on disposable databases or a controlled test harness."
    ],
    guardrails: [
      "Do not let apps connect directly to Postgres.",
      "Do not duplicate SQL for core message writes.",
      "Do not leak raw adapter payloads outside redacted operations storage."
    ],
    checks: ["Run repository tests against the disposable database.", ...baseChecks],
    review: [
      "Verify transaction boundaries around message plus cursor writes.",
      "Verify repository names and SQL use ERD-prefixed columns.",
      "Verify no untyped SQL escapes into app packages."
    ]
  },
  {
    name: "viji-phase-03-live-whatsapp",
    title: "Phase 3 Live WhatsApp Adapter Contract",
    description:
      "Implement or review Viji Helper Phase 3 live WhatsApp adapter work. Use for packages/whatsapp, apps/wa-adapter-wacli, normalized inbound schemas, redacted wacli fixtures, allowlist handling, and duplicate event behavior.",
    goal:
      "Build the adapter contract around live personal WhatsApp through `wacli` while keeping sends policy-gated and opt-in.",
    read: ["docs/DEV_GUIDE.md", "docs/09_IMPLEMENTATION_PHASES.md", "docs/08_CHAT_CONTEXT_RECOVERY.md"],
    workflow: [
      "Define adapter contracts in `packages/whatsapp`.",
      "Create the `apps/wa-adapter-wacli` wrapper skeleton as the only runtime owner of `wacli`.",
      "Use redacted `wacli` fixtures for repeatable parser and ingestion tests.",
      "Normalize inbound events before worker ingestion.",
      "Store only allowlisted direct-message content; ignore and audit non-allowlisted traffic.",
      "Redact adapter payloads before storage."
    ],
    guardrails: [
      "Do not ship a fake/mock WhatsApp adapter as runtime implementation.",
      "Do not import or execute `wacli` outside `apps/wa-adapter-wacli`.",
      "Do not let the adapter decide reply text.",
      "Do not enable raw payload logging by default."
    ],
    checks: ["Run adapter contract and redacted `wacli` fixture ingestion tests.", ...baseChecks],
    review: [
      "Verify duplicate inbound events do not duplicate messages or drafts.",
      "Verify group chats stay ignored unless explicitly allowed later.",
      "Verify fixture payloads contain no real private data.",
      "Verify live `wacli` smoke checks are explicit and guarded."
    ]
  },
  {
    name: "viji-phase-04-policy",
    title: "Phase 4 Policy Engine",
    description:
      "Implement or review Viji Helper Phase 4 policy work. Use for reply modes, kill switches, send or no-send decisions, context freshness gates, storage health gates, adapter health inputs, and file-sharing policy defaults.",
    goal:
      "Centralize every outbound safety decision before drafts and sends exist.",
    read: ["docs/DEV_GUIDE.md", "docs/09_IMPLEMENTATION_PHASES.md", "docs/ERD.md"],
    workflow: [
      "Create `packages/policy` with pure decision inputs and explicit outcomes.",
      "Cover `auto`, `confirm_resource`, `readonly`, `paused`, and `idle` modes.",
      "Block unknown contacts, paused conversations, stale context auto-send, storage-full sends, and unconfirmed file sharing.",
      "Require all future outbound paths to call policy immediately before queueing or dispatch."
    ],
    guardrails: [
      "Do not import adapter, DB, or LLM clients into policy.",
      "Do not create outbound jobs from readonly or paused modes.",
      "Do not allow auto-send unless all policy gates pass."
    ],
    checks: ["Run policy unit tests covering all modes and blocking states.", ...baseChecks],
    review: [
      "Verify policy results explain why behavior was allowed or blocked.",
      "Verify stale context blocks auto-send and creates no outbound job.",
      "Verify file/resource sharing defaults to exact-file recipient confirmation."
    ]
  },
  {
    name: "viji-phase-05-drafts",
    title: "Phase 5 Draft Generation",
    description:
      "Implement or review Viji Helper Phase 5 AI draft work. Use for packages/ai, prompt builders, deterministic test LLM clients, agent_runs, agent_drafts, deterministic prompts, [Pratiksha] prefix behavior, and LLM failure handling.",
    goal:
      "Create policy-scored reply candidates from inbound messages using a deterministic test LLM stub.",
    read: ["docs/DEV_GUIDE.md", "docs/09_IMPLEMENTATION_PHASES.md", "docs/ERD.md"],
    workflow: [
      "Build prompt construction as a deterministic, testable function.",
      "Treat chat history, summaries, user messages, and knowledge snippets as untrusted reference material.",
      "Persist `agent_runs` for every generation attempt.",
      "Persist `agent_drafts` before any send path can exist.",
      "Ensure send-bound draft bodies start with `[Pratiksha]`."
    ],
    guardrails: [
      "Do not create outbound jobs in this phase.",
      "Do not include local paths, secrets, hidden prompts, or raw internals in generated replies.",
      "Do not send fallback messages when the test stub or real LLM fails."
    ],
    checks: ["Run agent and draft tests using redacted adapter fixtures and the deterministic test LLM stub.", ...baseChecks],
    review: [
      "Verify stale context behavior is explicit.",
      "Verify failed runs are recorded and do not send.",
      "Verify prompt snapshots or assertions are stable enough to catch regressions."
    ]
  },
  {
    name: "viji-phase-06-outbox",
    title: "Phase 6 Outbox and Recipient Confirmation",
    description:
      "Implement or review Viji Helper Phase 6 outbox work. Use for recipient confirmation and denial operations, agent_outbound_jobs, agent_send_attempts, recorded send intents, idempotency keys, and send audit events.",
    goal:
      "Build the safe path from policy-permitted replies and recipient-confirmed resource proposals to queued outbound jobs, with live WhatsApp dispatch disabled until Phase 8 hardening is accepted.",
    read: ["docs/DEV_GUIDE.md", "docs/09_IMPLEMENTATION_PHASES.md", "docs/ERD.md"],
    workflow: [
      "Require exact-file recipient confirmation before queueing resource sends when policy demands it.",
      "Generate stable outbound idempotency keys.",
      "Re-check policy immediately before dispatch.",
      "Record recipient confirm/deny, send, block, and failure audit events.",
      "Record send intents in tests; do not enable live `wacli` sends until the guarded send phase."
    ],
    guardrails: [
      "Do not let duplicate recipient confirmations create duplicate jobs.",
      "Do not send denied or expired resource proposals.",
      "Do not store unredacted message bodies in audit details."
    ],
    checks: ["Run safety test: redacted inbound fixture -> policy decision or recipient confirmation -> outbound job -> recorded send intent.", ...baseChecks],
    review: [
      "Verify retries preserve the same idempotency key.",
      "Verify failed sends remain retryable unless terminal.",
      "Verify audit events are redacted."
    ]
  },
  {
    name: "viji-phase-07-api-cli",
    title: "Phase 7 API and CLI",
    description:
      "Implement or review Viji Helper Phase 7 operator surfaces. Use for local API routes, CLI commands, health/status, conversations, generated replies, recipient confirmations, policy mode changes, storage status, sync status, and audit-log access.",
    goal:
      "Expose safe local operator control before live WhatsApp sends are enabled.",
    read: ["docs/DEV_GUIDE.md", "docs/09_IMPLEMENTATION_PHASES.md", "docs/PROJECT_STRUCTURE.md"],
    workflow: [
      "Keep API routes thin and move behavior into packages or worker operations.",
      "Make CLI use the API for normal operations.",
      "Expose health, generated replies, recipient confirmations, policy, storage, sync, and audit status.",
      "Add explicit local authorization even for local-only access.",
      "Use correlation IDs in API responses and logs."
    ],
    guardrails: [
      "Do not expose secrets, auth stores, raw adapter payloads, or hidden prompts.",
      "Do not let CLI destructive commands run without explicit flags.",
      "Do not let dashboard or CLI connect directly to Postgres."
    ],
    checks: ["Run API and CLI tests for policy and recipient-confirmation workflow controls.", ...baseChecks],
    review: [
      "Verify CLI and API agree on state.",
      "Verify degraded storage and stale context are visible.",
      "Verify validation uses shared schemas."
    ]
  },
  {
    name: "viji-phase-08-wacli",
    title: "Phase 8 wacli Adapter Hardening",
    description:
      "Implement or review Viji Helper Phase 8 wacli adapter hardening. Use for apps/wa-adapter-wacli, typed command wrappers, command-output parsers, opt-in live WhatsApp tests, auth store persistence, send text/file experiments, and adapter reliability reports.",
    goal:
      "Harden live personal WhatsApp automation through `wacli` after the adapter contract exists.",
    read: ["docs/DEV_GUIDE.md", "docs/09_IMPLEMENTATION_PHASES.md", "docs/08_CHAT_CONTEXT_RECOVERY.md"],
    workflow: [
      "Keep all `wacli` execution inside `apps/wa-adapter-wacli`.",
      "Wrap `doctor`, `auth`, sync/poll, list/search, send text, send file, media download, and adapter-owned mark-read commands.",
      "Parse machine-readable output only; fixture-test every parser.",
      "Persist auth/store data under `${VIJI_DATA_ROOT}/wacli/store`.",
      "Keep live WhatsApp smoke tests opt-in and never commit real payloads."
    ],
    guardrails: [
      "Do not use browser automation unless the docs and user direction change.",
      "Do not let other services shell out to `wacli`.",
      "Do not fake read receipts in Postgres; use `wacli-mark-read` or a future adapter equivalent.",
      "Do not commit QR data, phone numbers, JIDs, message bodies, or auth stores."
    ],
    checks: ["Run parser and wrapper fixture tests; run opt-in smoke tests only when explicitly enabled.", ...baseChecks],
    review: [
      "Classify failures as auth, network, backoff, send, store lock, storage, or unknown.",
      "Verify restart persistence with SSD store paths.",
      "Write the continue-or-switch adapter decision in docs."
    ]
  },
  {
    name: "viji-phase-09-reconnect",
    title: "Phase 9 Reconnect Recovery",
    description:
      "Implement or review Viji Helper Phase 9 reconnect and history work. Use for startup recovery, reconnect checkpoints, missed-message replay, all-available allowlisted history backfill, context freshness, sync cursors, and rolling summaries.",
    goal:
      "Make chat context durable across disconnects, reconnects, restarts, and interrupted backfills.",
    read: ["docs/DEV_GUIDE.md", "docs/08_CHAT_CONTEXT_RECOVERY.md", "docs/09_IMPLEMENTATION_PHASES.md", "docs/ERD.md"],
    workflow: [
      "Run adapter health/auth checks before processing inbound messages after startup or reconnect.",
      "Recover missed messages before generating new replies.",
      "Update message inserts and sync cursors transactionally.",
      "Mark context `fresh` only when recovery can prove the allowlisted chat is current.",
      "Keep backfill resumable and idempotent."
    ],
    guardrails: [
      "Do not auto-send while context is stale.",
      "Do not replace retained recent messages with summaries.",
      "Do not download broad media during backfill outside quota-controlled jobs."
    ],
    checks: ["Run redacted reconnect, replay, backfill resume, and duplicate-replay fixture tests.", ...baseChecks],
    review: [
      "Verify cursor semantics for latest, oldest backfilled, media, and reconnect checkpoints.",
      "Verify duplicate replay cannot create duplicate messages or drafts.",
      "Verify backfill progress is visible through CLI/API."
    ]
  },
  {
    name: "viji-phase-10-media-sync",
    title: "Phase 10 Media Sync",
    description:
      "Implement or review Viji Helper Phase 10 media work. Use for allowlisted media download queues, msg_message_media, msg_media_download_jobs, file asset linkage, quota checks, resumable downloads, and storage warning behavior.",
    goal:
      "Download allowlisted chat media safely without exceeding the SSD allocation.",
    read: ["docs/DEV_GUIDE.md", "docs/04_STORAGE_PROFILE.md", "docs/09_IMPLEMENTATION_PHASES.md", "docs/ERD.md"],
    workflow: [
      "Queue media downloads only for allowlisted conversations.",
      "Store downloaded media under `${VIJI_DATA_ROOT}/wacli/media`.",
      "Link media metadata to `res_file_assets` only after safe storage.",
      "Pause media downloads on storage warning and block writes on storage critical.",
      "Make media jobs resumable and duplicate-safe."
    ],
    guardrails: [
      "Do not let paths escape the configured data root.",
      "Do not download non-allowlisted media.",
      "Do not let large media starve DB, logs, model, or backup allocations."
    ],
    checks: ["Run media queue, duplicate prevention, path safety, and storage warning tests.", ...baseChecks],
    review: [
      "Verify all file paths are normalized and rooted.",
      "Verify media retry state is explicit.",
      "Verify storage guard integration blocks unsafe writes."
    ]
  },
  {
    name: "viji-phase-11-local-llm",
    title: "Phase 11 Local LLM",
    description:
      "Implement or review Viji Helper Phase 11 local inference work. Use for apps/llm-proxy, Docker-only llama.cpp profiles, model health checks, generation endpoints, embedding endpoints, model path configuration, timeouts, and token limits.",
    goal:
      "Replace the deterministic test LLM stub with local Docker inference while preserving safety controls.",
    read: ["docs/DEV_GUIDE.md", "docs/04_STORAGE_PROFILE.md", "docs/09_IMPLEMENTATION_PHASES.md"],
    workflow: [
      "Keep model files under `${VIJI_DATA_ROOT}/models`; never copy models into images.",
      "Expose generation through `apps/llm-proxy` or shared client interfaces.",
      "Add health checks for missing model, timeout, and unavailable runtime.",
      "Record failed agent runs and do not send on model failure.",
      "Keep prompt and token limits explicit and testable."
    ],
    guardrails: [
      "Do not use cloud LLMs for the core path.",
      "Do not leak hidden prompts, local paths, or secrets in generated replies.",
      "Do not hide CPU-only latency tradeoffs."
    ],
    checks: ["Run local LLM proxy tests with missing/test model paths and opt-in real model smoke tests.", ...baseChecks],
    review: [
      "Verify missing model enters `IDLE_MODEL_MISSING`.",
      "Verify drafts still start with `[Pratiksha]`.",
      "Verify model runtime state appears in status surfaces."
    ]
  },
  {
    name: "viji-phase-12-resources",
    title: "Phase 12 Resource Catalog",
    description:
      "Implement or review Viji Helper Phase 12 resource-catalog work. Use for res_file_assets, res_resources, local indexing, tags and aliases, document extraction, resource match planning, previews, and recipient-confirmed file sharing.",
    goal:
      "Let the assistant propose shareable resources without authorizing sends by itself.",
    read: ["docs/DEV_GUIDE.md", "docs/09_IMPLEMENTATION_PHASES.md", "docs/ERD.md"],
    workflow: [
      "Register resources with title, aliases, description, sensitivity, active state, allowlist, and recipient-confirmation requirements.",
      "Index only configured local resource roots unless docs expand the source model.",
      "Extract text for supported file types where feasible.",
      "Let the LLM recommend resources but require policy and Vijayalakshmi's exact-file confirmation to share.",
      "Show enough metadata for wrong-file prevention before recipient confirmation."
    ],
    guardrails: [
      "Do not send files without exact-file recipient confirmation.",
      "Do not allow file paths outside configured roots.",
      "Do not treat restricted or missing files as shareable."
    ],
    checks: ["Run resource registration, match planning, missing-file, and recipient-confirmed send tests.", ...baseChecks],
    review: [
      "Verify false-match risk is handled with exact filenames and recipient confirmation.",
      "Verify disallowed resources are blocked or clarified in chat, not sent.",
      "Verify resource sends reuse outbound policy gates."
    ]
  },
  {
    name: "viji-phase-14-dashboard",
    title: "Phase 14 Dashboard",
    description:
      "Implement or review Viji Helper Phase 14 dashboard work. Use for onboarding, operational status, adapter health, conversation timeline, pending recipient confirmations, storage quota, sync/backfill/media status, resource catalog views, audit logs, and settings.",
    goal:
      "Provide a visual operations dashboard after backend and CLI behavior are stable.",
    read: ["docs/DEV_GUIDE.md", "docs/09_IMPLEMENTATION_PHASES.md", "docs/PROJECT_STRUCTURE.md"],
    workflow: [
      "Build an operations surface, not a marketing page.",
      "Prefer user job labels over implementation labels: Home, Assistant, Files, Chats, Sync, Settings, Logs.",
      "Use blue as the primary dashboard accent and support light/dark theme switching.",
      "Use icons for primary navigation and commands, and keep modern motion/decorative effects readable in degraded states.",
      "Keep logs last in the navigation, group audit events by category, and include a raw Docker container log stream for debugging each Viji Helper container/service.",
      "Dashboard uploads must land under `VIJI_RESOURCE_ROOT/staged`, register through the normal resource API, and preserve WhatsApp-only file-send confirmation.",
      "Keep UI data access through API routes.",
      "Show pending recipient confirmations and their expiry state.",
      "Show storage, context stale, adapter auth, and idle states prominently.",
      "Show resource metadata before recipient confirmation.",
      "Keep `VIJI_API_TOKEN` server-side through the dashboard proxy."
    ],
    guardrails: [
      "Do not display secrets, QR data, auth stores, raw unredacted adapter payloads, or hidden prompts outside the dedicated raw container logs troubleshooting area.",
      "Do not connect the dashboard directly to Postgres.",
      "Do not obscure degraded states behind decorative UI.",
      "Do not expose a dashboard approval path for file/resource sends.",
      "Do not make raw JSON or internal IDs the primary UI outside the dedicated troubleshooting area. Put technical detail behind disclosure controls."
    ],
    checks: ["node --test tests/dashboard/phase14-dashboard.test.mjs", "Run dashboard tests and verify UI against API/CLI state.", ...baseChecks],
    review: [
      "Verify core workflows are ergonomic and visible.",
      "Verify degraded states are clear.",
      "Verify dashboard and CLI report the same status.",
      "Verify normal controls are understandable without knowing database, queue, or adapter internals."
    ]
  },
  {
    name: "viji-phase-14-observability",
    title: "Future Observability",
    description:
      "Implement or review Viji Helper future observability work. Use for structured JSON logs, correlation IDs, Prometheus metrics, Loki shipping, Grafana dashboards, CLI log fallback, redaction, and viji_ metric naming.",
    goal:
      "Make normal and degraded behavior visible through visual dashboards and CLI workflows.",
    read: ["docs/DEV_GUIDE.md", "docs/09_IMPLEMENTATION_PHASES.md", "docs/PROJECT_STRUCTURE.md"],
    workflow: [
      "Emit structured logs with correlation IDs.",
      "Expose Prometheus metrics for storage, adapter, sync, drafts, outbox, LLM, and context freshness.",
      "Use the `viji_` metric prefix.",
      "Ship redacted logs to Loki and surface them in Grafana.",
      "Provide CLI log tail fallback for operations."
    ],
    guardrails: [
      "Do not log message bodies by default.",
      "Do not log secrets, QR data, tokens, auth stores, or raw unredacted adapter payloads.",
      "Do not let logging fill the SSD without retention controls."
    ],
    checks: ["Run logging, metric naming, redaction, and dashboard provisioning tests.", ...baseChecks],
    review: [
      "Verify logs and metrics are useful during idle/degraded flows.",
      "Verify correlation IDs span API, worker, adapter, and LLM paths.",
      "Verify dashboards avoid private content."
    ]
  },
  {
    name: "viji-phase-15-backup",
    title: "Phase 15 Backup and Retention",
    description:
      "Implement or review Viji Helper Phase 15 recovery work. Use for Postgres backups, restore checks, retention jobs, media cache pruning, vector cleanup, audit retention, backup storage under pgbackups, and storage-warning cleanup behavior.",
    goal:
      "Keep the local-first system recoverable and bounded under the 200 GB allocation.",
    read: ["docs/DEV_GUIDE.md", "docs/04_STORAGE_PROFILE.md", "docs/09_IMPLEMENTATION_PHASES.md", "docs/ERD.md"],
    workflow: [
      "Create compressed Postgres backups under `${VIJI_DATA_ROOT}/pgbackups`.",
      "Validate backups with restore checks in an isolated environment.",
      "Implement retention without deleting pinned resources or required context.",
      "Prune caches and old generated artifacts before risky data.",
      "Audit retention and restore actions."
    ],
    guardrails: [
      "Do not include secrets in backups unless explicitly designed and documented.",
      "Do not let retention break idempotency or context recovery.",
      "Do not delete pinned resources or current summaries."
    ],
    checks: ["Run backup, restore-check, and retention safety tests.", ...baseChecks],
    review: [
      "Verify restore can answer basic status queries.",
      "Verify retention order matches storage profile.",
      "Verify backup files stay on the SSD data root."
    ]
  },
  {
    name: "viji-phase-16-chaos",
    title: "Phase 16 Failure and Chaos",
    description:
      "Implement or review Viji Helper Phase 16 failure testing. Use for external-drive-missing tests, storage warning/full, DB unavailable, LLM unavailable, WhatsApp auth/network failures, duplicate inbound events, interrupted backfill, media failures, and no-unsafe-send proof.",
    goal:
      "Prove failures enter visible idle/degraded states instead of unsafe sends.",
    read: ["docs/DEV_GUIDE.md", "docs/09_IMPLEMENTATION_PHASES.md", "docs/08_CHAT_CONTEXT_RECOVERY.md"],
    workflow: [
      "Create failure tests around every outbound path.",
      "Assert idle/degraded states are visible in CLI and dashboard.",
      "Use bounded retries and backoff for recoverable failures.",
      "Audit operator actions and automated blocks.",
      "Update runbooks for recovery steps."
    ],
    guardrails: [
      "Do not allow any failure scenario to send without policy permission or required recipient confirmation.",
      "Do not create unbounded retry loops.",
      "Do not hide failure state from operators."
    ],
    checks: ["Run the failure suite and confirm no unsafe sends occur.", ...baseChecks],
    review: [
      "Verify each failure prefers idle over risky fallback behavior.",
      "Verify recovery paths are documented.",
      "Verify duplicate inbound and interrupted jobs are idempotent."
    ]
  },
  {
    name: "viji-phase-17-trial",
    title: "Phase 17 Local Trial",
    description:
      "Implement or review Viji Helper Phase 17 controlled trial work. Use for unattended text trial checklists, prompt tuning notes, model latency reports, adapter reliability reports, resource-catalog accuracy notes, and decision records about auto-send readiness.",
    goal:
      "Run controlled unattended trusted-contact text usage and tune behavior while resource sends require recipient confirmation.",
    read: ["docs/DEV_GUIDE.md", "docs/09_IMPLEMENTATION_PHASES.md", "docs/08_CHAT_CONTEXT_RECOVERY.md"],
    workflow: [
      "Keep live behavior within trusted-contact policy gates unless the user explicitly changes direction.",
      "Track draft usefulness, `[Pratiksha]` prefix consistency, duplicate prevention, reconnect reliability, and storage usage.",
      "Record prompt tuning and model latency observations.",
      "Record adapter reliability and resource false-match observations.",
      "End with a trusted-contact auto mode reliability note."
    ],
    guardrails: [
      "Do not enable broad auto-send during trial.",
      "Do not tune using committed real private messages.",
      "Do not ignore storage, CPU, or adapter reliability regressions."
    ],
    checks: ["Run trial checklist plus normal test/typecheck gates before changing modes.", ...baseChecks],
    review: [
      "Verify real use did not create duplicate replies.",
      "Verify reconnect recovery worked after restart.",
      "Verify storage stayed within budget."
    ]
  },
  {
    name: "viji-phase-18-skills",
    title: "Phase 18 Project Skills",
    description:
      "Create or maintain Viji Helper project Codex skills. Use when adding phase skills, updating this local skill pack, validating SKILL.md files, preparing installation into Codex skills, or aligning skills with DEV_GUIDE, ERD, and the implementation phase plan.",
    goal:
      "Keep project-specific Codex skills compact, current, and safe to use for future phase work.",
    read: ["docs/DEV_GUIDE.md", "docs/09_IMPLEMENTATION_PHASES.md", "docs/10_CODEX_SKILLS.md"],
    workflow: [
      "Use `scripts/generate-project-skills.mjs` as the source for generated phase skill bodies.",
      "Keep each skill concise and point to project docs instead of duplicating long design content.",
      "Validate every skill with `corepack pnpm skills:validate` after generation; use `quick_validate.py` too when Python has `PyYAML` available.",
      "Install globally only when the user wants automatic discovery; otherwise keep project-local.",
      "Update `docs/10_CODEX_SKILLS.md` when the skill map changes."
    ],
    guardrails: [
      "Do not put secrets, private contact data, or real message examples in skills.",
      "Do not add README or extra docs inside skill folders.",
      "Do not let skills contradict the developer guide or ERD."
    ],
    checks: ["node scripts/generate-project-skills.mjs", "corepack pnpm skills:validate"],
    review: [
      "Verify descriptions trigger on the right phase tasks.",
      "Verify agent metadata remains short and accurate.",
      "Verify global installation instructions require a Codex restart."
    ]
  }
];

function list(items) {
  return items.map((item) => `- ${item}`).join("\n");
}

function renderSkill(skill) {
  return `---\nname: ${skill.name}\ndescription: ${skill.description}\n---\n\n# ${skill.title}\n\n## Goal\n\n${skill.goal}\n\n## Required Context\n\n${skill.name === "viji-project-guardrails" ? "Read:" : "Start with $viji-project-guardrails when available, then read:"}\n\n${list(skill.read.map((path) => `[${path}](${projectRoot}/${path})`))}\n\n## Workflow\n\n${list(skill.workflow)}\n\n## Guardrails\n\n${list(skill.guardrails)}\n\n## Acceptance Checks\n\n${list(skill.checks)}\n\n## Review Focus\n\n${list(skill.review)}\n`;
}

for (const skill of skills) {
  const skillDir = join(skillsRoot, skill.name);
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(join(skillDir, "SKILL.md"), renderSkill(skill));
}

console.log(`Generated ${skills.length} Viji Helper skills in ${skillsRoot}`);
