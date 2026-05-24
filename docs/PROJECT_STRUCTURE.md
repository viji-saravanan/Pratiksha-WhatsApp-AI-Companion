# Project Structure

## 1. Purpose

This document defines the intended repository layout before implementation starts. The structure is designed for a Dockerized, local-first WhatsApp assistant with a personal WhatsApp adapter, local AI runtime, knowledge base, file/resource sharing, dashboard, CLI, tests, and storage guardrails.

The initial implementation should create only the folders and services needed for the current phase. The full structure is still documented now so future features have an assigned home and do not become scattered.

## 2. Technology Baseline

Recommended baseline:

- Monorepo: `pnpm` workspace.
- Backend services: TypeScript on Node.js.
- API server: Fastify or equivalent lightweight HTTP framework.
- Worker: TypeScript queue/worker process.
- Dashboard: React + Vite.
- CLI: TypeScript command using the same API client package as the dashboard.
- Database: Postgres with pgvector.
- WhatsApp adapter: live `wacli` wrapper first.
- LLM runtime: Ollama or llama.cpp, isolated behind an internal client interface.
- Observability: Prometheus, Loki, Grafana.
- Tests: unit tests, contract tests, integration tests, redacted `wacli` fixture tests, and opt-in live adapter smoke tests.

Reasoning:

- TypeScript keeps API, worker, CLI, dashboard, shared schemas, and tests in one language.
- `wacli` remains an external tool wrapped by the adapter service.
- Python can be added later only if document extraction or ML tooling needs it.
- Direct Go code should be avoided except for adapter-owned helpers that expose missing `wacli` capabilities against the same WhatsApp session store, such as `tools/wacli-mark-read`.

## 3. Top-Level Layout

```text
viji-helper/
  README.md
  LICENSE
  .gitignore
  .editorconfig
  .env.example
  package.json
  pnpm-workspace.yaml
  tsconfig.base.json
  docker-compose.yml
  docker-compose.dev.yml
  Makefile

  apps/
    api/
    worker/
    dashboard/
    cli/
    wa-adapter-wacli/
    storage-guard/
    llm-proxy/

  packages/
    shared/
    config/
    core/
    db/
    schemas/
    observability/
    whatsapp/
    ai/
    kb/
    resources/
    policy/
    testing/

  infra/
    docker/
    postgres/
    grafana/
    prometheus/
    loki/
    scripts/

  migrations/
  scripts/
  tests/
  docs/
  skills/
  tools/
  fixtures/
  tmp/
```

## 4. `apps/`

Runtime applications live here. Each app should have its own `package.json`, `Dockerfile`, tests, and README once implemented.

```text
apps/
  api/
    src/
      server.ts
      app.ts
      routes/
        health.routes.ts
        status.routes.ts
        conversations.routes.ts
        drafts.routes.ts
        policies.routes.ts
        knowledge.routes.ts
        resources.routes.ts
        storage.routes.ts
        adapter.routes.ts
        audit.routes.ts
      middleware/
      plugins/
    test/
    Dockerfile
    package.json

  worker/
    src/
      main.ts
      jobs/
        inbound-message.job.ts
        draft-generation.job.ts
        outbox-queue.job.ts
        outbox-dispatch.job.ts
        outbound-dispatcher.interface.ts
        kb-ingestion.job.ts
        reconnect-recovery.job.ts
        history-backfill.job.ts
        media-download.job.ts
        conversation-summary.job.ts
        retention.job.ts
        backup.job.ts
      queues/
      schedulers/
    test/
    Dockerfile
    package.json

  dashboard/
    src/
      main.tsx
      app/
      pages/
        OnboardingPage.tsx
        StatusPage.tsx
        ConversationPage.tsx
        ConfirmationsPage.tsx
        KnowledgePage.tsx
        ResourcesPage.tsx
        LogsPage.tsx
        StoragePage.tsx
        SettingsPage.tsx
      components/
      lib/
      styles/
    test/
    Dockerfile
    package.json

  cli/
    src/
      main.ts
      commands/
        status.command.ts
        pause.command.ts
        resume.command.ts
        logs.command.ts
        conversation.command.ts
        confirmations.command.ts
        kb.command.ts
        storage.command.ts
        sync.command.ts
        context.command.ts
        media.command.ts
        wa.command.ts
        backup.command.ts
      output/
    test/
    package.json

  wa-adapter-wacli/
    src/
      index.ts
      main.ts
      config.ts
      wacli-client.ts
      inbound-ingestion.ts
      live-smoke.ts
      sync-runner.ts
      event-parser.ts
      send-text.ts
      send-file.ts
      backfill-history.ts
      download-media.ts
      doctor.ts
      auth.ts
      store-lock.ts
    test/
    Dockerfile
    package.json

  storage-guard/
    src/
      main.ts
      mount-check.ts
      quota-check.ts
      sentinel-check.ts
      state-publisher.ts
    test/
    Dockerfile
    package.json

  llm-proxy/
    src/
      main.ts
      model-health.ts
      generate.ts
      embeddings.ts
    test/
    Dockerfile
    package.json
```

### `api`

Owns HTTP API and dashboard/CLI-facing routes. It should not run long jobs directly.

Phase 7 implementation note:

- The current local API keeps routes in `apps/api/src/app.ts` while the surface is still small.
- Future dashboard/resource/knowledge expansion should split those handlers into the documented `routes/` modules without changing the API contract.
- The CLI in `apps/cli` talks only to the local API and does not import `@viji/db` or `pg`.

Responsibilities:

- Authentication for local admin UI.
- Status endpoint.
- Conversation browsing.
- Generated reply, policy decision, and recipient-confirmation browsing.
- Pause/resume/readonly policy updates.
- Knowledge and resource management endpoints.
- Audit/event browsing.

### `worker`

Owns background jobs and orchestration.

Responsibilities:

- Convert inbound messages into agent runs.
- Generate drafts.
- Dispatch policy-permitted and recipient-confirmed outbound jobs.
- Run ingestion and retention jobs.
- Enforce storage and idle states before doing work.

### `dashboard`

Owns visual operations.

Implementation:

- TypeScript Node service under `apps/dashboard`.
- Serves static browser assets from `apps/dashboard/src/assets`.
- Proxies allowed `/api/*` calls to `apps/api` and injects `VIJI_API_TOKEN` server-side.
- Blocks dashboard/API resource approvals; only WhatsApp recipient confirmation can approve a send.

Views:

- Onboarding and setup checklist.
- System status.
- WhatsApp adapter status.
- Conversation timeline.
- Pending recipient confirmations.
- Knowledge indexing.
- Resource library.
- Logs and audit events.
- Settings and kill switch.

### `cli`

Owns terminal operations. It should use the API where possible and local fallback reads only for emergency status/logs.

### `wa-adapter-wacli`

Owns all interaction with `wacli`. No other app should shell out to `wacli`.

Responsibilities:

- Run `wacli doctor`.
- Run `wacli auth`.
- Run sync or polling loop.
- Parse machine-readable output.
- Normalize inbound events.
- Send text and later files.
- Mark inbound trigger or recipient-confirmation messages read after successful replies through `wacli-mark-read`.
- Publish adapter health.

### `storage-guard`

Owns external-drive validation.

Responsibilities:

- Verify mount path.
- Verify sentinel file.
- Verify write access.
- Verify quota and free space.
- Publish `healthy`, `degraded`, or `idle` state.

### `llm-proxy`

Owns model runtime abstraction. It should hide whether the backend is Ollama or llama.cpp.

Responsibilities:

- Health check local model runtime.
- Generate chat completions.
- Generate embeddings.
- Enforce timeout and payload limits.

## 5. `packages/`

Shared code lives here. Packages should be small, boring, and dependency-conscious.

```text
packages/
  shared/
    src/
      error-codes.ts
      errors.ts
      logger.ts
      calls.ts
      node-entrypoint.ts

  config/
    src/
      env.ts
      paths.ts
      storage-profile.ts
      feature-flags.ts

  core/
    src/
      ids.ts
      time.ts
      result.ts
      redaction.ts

  db/
    src/
      client.ts
      transaction.ts
      repositories/
        contacts.repo.ts
        conversations.repo.ts
        messages.repo.ts
        agent-runs.repo.ts
        drafts.repo.ts
        outbox.repo.ts
        send-attempts.repo.ts
        knowledge.repo.ts
        resources.repo.ts
        storage.repo.ts
        system-state.repo.ts
        audit.repo.ts

  schemas/
    src/
      contacts.schema.ts
      messages.schema.ts
      drafts.schema.ts
      outbox.schema.ts
      adapter.schema.ts
      health.schema.ts
      knowledge.schema.ts
      resources.schema.ts
      storage.schema.ts

  observability/
    src/
      log-sinks.ts
      metrics.ts
      tracing.ts
      correlation.ts

  whatsapp/
    src/
      adapter.interface.ts
      redaction.ts
      types.ts
      wacli-normalizer.ts
      jid.ts
      normalizer.ts
      fixtures.ts

  ai/
    src/
      llm-client.interface.ts
      prompt-builder.ts
      safety.ts
      response-parser.ts

  kb/
    src/
      chunker.ts
      retriever.ts
      ingestion-types.ts
      source-policy.ts

  resources/
    src/
      resource-policy.ts
      file-inspector.ts
      share-planner.ts

  policy/
    src/
      types.ts
      reply-policy.ts
      idle-state.ts
      send-guard.ts
      recipient-confirmation-policy.ts

  testing/
    src/
      whatsapp-test-double.ts
      test-llm-stub.ts
      db-test-harness.ts
      factories.ts
```

Package boundaries:

- `packages/shared` owns cross-cutting primitives only: error codes, typed errors, structured logging helpers, external call result shapes, and small Node process helpers.
- `packages/policy` must not import adapter-specific code.
- `packages/ai` must not send messages.
- `packages/whatsapp` defines interfaces and normalization only.
- `apps/wa-adapter-wacli` is the only owner of `wacli` commands.
- `packages/db` owns database access and repositories.
- `packages/schemas` owns API and event validation schemas.
- `packages/observability` owns metrics, tracing, log sinks, and dashboard/exporter integration. It must reuse `packages/shared` logger records instead of inventing another logging shape.

Shared package rules:

- Put reusable cross-app primitives in `packages/shared` before creating app-local equivalents.
- Do not place domain workflows, database repositories, WhatsApp adapter logic, policy decisions, or AI prompt logic in `packages/shared`.
- Do not create duplicate helper functions under different names. Search `packages/shared`, `packages/core`, and the target package before adding a new helper.
- Prefer moving proven duplicate helpers into `packages/shared` when at least two apps or packages need the same behavior.
- Keep `packages/shared` dependency-light so every service can import it safely.

## 6. `infra/`

Infrastructure configuration lives here.

```text
infra/
  docker/
    api.Dockerfile
    worker.Dockerfile
    dashboard.Dockerfile
    cli.Dockerfile
    wa-adapter-wacli.Dockerfile
    storage-guard.Dockerfile
    llm-proxy.Dockerfile

  postgres/
    init/
      001_extensions.sql
    postgresql.conf

  grafana/
    provisioning/
      dashboards/
      datasources/
    dashboards/
      system-health.json
      whatsapp-adapter.json
      ai-runtime.json
      storage-quota.json
      knowledge-indexing.json

  prometheus/
    prometheus.yml
    rules/
      storage.rules.yml
      adapter.rules.yml
      worker.rules.yml

  loki/
    loki.yml

  scripts/
    bootstrap-external-drive.sh
    check-storage-profile.sh
    backup-postgres.sh
    restore-check.sh
    rotate-local-logs.sh
```

## 7. `migrations/`

Database migrations live here.

```text
migrations/
  0001_extensions.sql
  0002_ops_storage.sql
  0003_core_messages_ops.sql
  0004_agent_runs_drafts.sql
  0005_agent_outbox.sql
  0006_policy_response_policies.sql
  0007_resource_catalog.sql
  0008_retention_jobs.sql
```

Migration rules:

- Every schema change must have a migration.
- Migrations should be reversible when practical.
- Vector indexes should be added after enough data exists to justify them.
- Seed data should be separate from migrations.

## 8. `tests/`

Cross-service tests live here. App-specific unit tests remain beside each app/package.

```text
tests/
  contract/
    whatsapp-adapter.contract.test.ts
    llm-client.contract.test.ts
    api.contract.test.ts

  integration/
    postgres.migration.test.ts
    outbox-dispatch.test.ts
    storage-guard.test.ts
    kb-retrieval.test.ts

  e2e/
    wacli-fixture-text-reply.test.ts
    dry-run-mode.test.ts
    idle-disk-missing.test.ts
    duplicate-message.test.ts

  whatsapp/
    phase3-wacli-ingestion.test.mjs

  failure/
    network-down.test.ts
    db-down.test.ts
    model-missing.test.ts
    storage-low.test.ts
    auth-required.test.ts
```

Testing rules:

- Runtime WhatsApp implementation must use live `wacli`, not a fake adapter.
- Isolated WhatsApp test doubles are allowed only under tests where live sends would be unsafe.
- Live `wacli` tests should be opt-in and never run in CI by default.
- Failure tests must prove that unsafe sends do not happen.
- Storage quota tests must cover both warning and full/unwritable states.

## 9. `fixtures/`

Recorded sample data lives here.

```text
fixtures/
  wacli/
    doctor-ok.json
    doctor-auth-required.json
    messages-list-redacted.json
    messages-list.json
    send-text-ok.json
    send-text-failed.json

  messages/
    inbound-text.json
    inbound-duplicate.json
    inbound-non-allowlisted.json

  knowledge/
    sample-note.md
    sample-resource.txt
```

Rules:

- Fixtures must not contain real phone numbers or private message bodies.
- Redacted real-world shapes are allowed.
- Every adapter parser should have fixture coverage.

## 10. `docs/`

Design and operations documentation.

```text
  docs/
    00_OVERVIEW.md
    04_STORAGE_PROFILE.md
    08_CHAT_CONTEXT_RECOVERY.md
    09_IMPLEMENTATION_PHASES.md
    10_CODEX_SKILLS.md
    TDD.md
    ERD.md
    PROJECT_STRUCTURE.md
    DEV_GUIDE.md
    RUNBOOK.md
  STORAGE_PROFILE.md
  ADAPTER_SPIKE.md
  SECURITY.md
  BACKUP_RESTORE.md
  OPERATIONS.md
  DECISIONS/
    0001-personal-whatsapp-adapter.md
    0002-storage-profile.md
    0003-local-llm-runtime.md
```

Document inventory:

- `DEV_GUIDE.md`: binding implementation rules for generated and hand-written code.
- `00_OVERVIEW.md`: concise product and architecture defaults.
- `04_STORAGE_PROFILE.md`: 200 GB storage profile, thresholds, and directory layout.
- `08_CHAT_CONTEXT_RECOVERY.md`: reconnect, backfill, media sync, and context freshness rules.
- `09_IMPLEMENTATION_PHASES.md`: phase-by-phase implementation and acceptance plan.
- `10_CODEX_SKILLS.md`: project-local Codex skill pack map and usage rules.
- `RUNBOOK.md`: daily operation, pause/resume, auth renewal, recovery.
- `STORAGE_PROFILE.md`: exact 100 GB and 200 GB quota settings.
- `ADAPTER_SPIKE.md`: measured results from `wacli` and alternatives.
- `SECURITY.md`: local secrets, encryption, redaction, retention.
- `BACKUP_RESTORE.md`: backup schedule and restore tests.
- `OPERATIONS.md`: dashboard and CLI usage.

## 11. `skills/`

Project-local Codex skills for phase-specific implementation.

```text
skills/
  viji-project-guardrails/
    SKILL.md
    agents/openai.yaml
  viji-phase-00-foundation/
  ...
  viji-phase-18-skills/
```

Rules:

- Skills must stay concise and point back to `docs/` for detailed design content.
- Update skills through `scripts/generate-project-skills.mjs` and validate with `corepack pnpm skills:validate`.
- Do not put secrets, phone numbers, real WhatsApp messages, auth stores, or media in skills.
- Keep project-local skills as source; install globally only when the user wants Codex-wide discovery.

## 12. `tools/`

Developer utilities.

```text
tools/
  dev/
    wait-for-postgres.ts
    seed-dev-data.ts
    print-config.ts

  storage/
    estimate-usage.ts
    prune-old-vectors.ts
    prune-media-cache.ts
    verify-sentinel.ts

  adapter/
    inspect-wacli-store.ts
    replay-wacli-fixtures.ts

  wacli-mark-read/
    go.mod
    main.go

  release/
    build-images.sh
    smoke-test.sh
```

Rules:

- Tools can be less polished than apps, but must be safe by default.
- Destructive tools require explicit flags.
- No tool should write outside the configured workspace or external-drive root without a clear flag.

## 13. Runtime Volume Mapping

The Docker Compose file should map service volumes to the external drive.

Example logical mapping:

```text
${VIJI_DATA_ROOT}/postgres       -> postgres data
${VIJI_DATA_ROOT}/pgbackups      -> backup service
${VIJI_DATA_ROOT}/wacli/store    -> wacli auth and store
${VIJI_DATA_ROOT}/wacli/media    -> optional media cache
${VIJI_DATA_ROOT}/models         -> local model files
${VIJI_DATA_ROOT}/knowledge      -> source and processed documents
${VIJI_RESOURCE_ROOT}            -> shareable resource repository
${VIJI_DATA_ROOT}/logs           -> local log fallback
${VIJI_DATA_ROOT}/grafana        -> Grafana state
${VIJI_DATA_ROOT}/prometheus     -> Prometheus state
${VIJI_DATA_ROOT}/loki           -> Loki state
${VIJI_DATA_ROOT}/tmp            -> bounded temporary workspace
```

The internal disk should contain only:

- Optional backup/source checkout.
- Docker images and build cache.
- Optional local `.env` pointer to the external-drive root.

The active source checkout should live at:

```text
/Volumes/Arya 1TB/VijiAI/workspace/viji-helper
```

## 14. Storage Profiles

The implementation should support named storage profiles. `large-200gb` is the default because the SSD allocation can use up to 200 GB.

### `large-200gb`

Defaults:

- One primary quantized model.
- One fallback model.
- Optional one experimental model.
- Allowlisted chat media download enabled with quota controls.
- Raw adapter payload retention: 30 days.
- Application log retention: 14 days.
- Loki retention: 14 days.
- Postgres backups: 7 compressed backups.
- Larger resource catalog allowance.
- Warning threshold: 165 GB used or less than 25 GB free.
- Critical threshold: 185 GB used or less than 12 GB free.

### `small-100gb`

Defaults:

- One primary quantized model.
- One small fallback model.
- WhatsApp background media download disabled.
- Raw adapter payload retention: 14 days.
- Application log retention: 7 days.
- Loki retention: 7 days.
- Postgres backups: 3 compressed backups.
- Resource catalog limited to selected folders.
- Warning threshold: 80 GB used or less than 15 GB free.
- Critical threshold: 90 GB used or less than 8 GB free.

## 15. Configuration Files

Expected config files:

```text
.env.example
config/
  app.example.yaml
  storage.example.yaml
  policy.example.yaml
  models.example.yaml
  adapter.example.yaml
```

The real config should live under the external drive:

```text
/Volumes/Arya 1TB/VijiAI/config/
  .env
  app.yaml
  storage.yaml
  policy.yaml
  models.yaml
  adapter.yaml
  secrets/
```

Configuration rules:

- `.env.example` stays in git.
- Real `.env` and secrets do not.
- Storage profile must be explicit.
- Default data root is `/Volumes/Arya 1TB/VijiAI`.
- Default resource root is `/Volumes/Arya 1TB/VijiAI/viji-files`.
- Contact allowlist must be explicit.
- Auto-reply must be disabled unless explicitly enabled.

## 16. Implementation Order

Recommended order:

1. Create monorepo, package manager, linting, test runner, and Docker Compose skeleton.
2. Implement `storage-guard` and storage profiles.
3. Implement database migrations and repositories.
4. Implement live `wacli` adapter contract, redacted fixture tests, and opt-in smoke checks.
5. Implement API status routes and CLI `status`.
6. Implement `wa-adapter-wacli` spike.
7. Implement draft generation with a deterministic test LLM stub and later local inference.
8. Add local LLM runtime.
9. Add onboarding and operations dashboard.
10. Add auto-send behind explicit config and policy gates.
11. Add knowledge base ingestion.
12. Add resource sharing.
13. Add full observability dashboards.

## 17. Naming Rules

- Database tables use `snake_case` plural names with the prefixes defined in [ERD.md](ERD.md): `core_`, `msg_`, `agent_`, `kb_`, `res_`, `policy_`, and `ops_`.
- Database columns use table-stem prefixes for every physical column, such as `core_person_id`, `msg_conversation_title`, and `ops_sync_run_started_at`.
- TypeScript files use `kebab-case`.
- TypeScript classes and types use `PascalCase`.
- Environment variables use `VIJI_` prefix.
- Metrics use `viji_` prefix.
- Docker services use short lowercase names.
- Idle state reason codes use uppercase constants.

## 18. What Not To Put Where

- Do not put adapter-specific code inside `packages/policy`.
- Do not let the dashboard talk directly to Postgres.
- Do not let the worker shell out to `wacli`; use `wa-adapter-wacli`.
- Do not put large model files in the repository.
- Do not put real WhatsApp fixtures in git.
- Do not store secrets in source-controlled config.
- Do not let ingestion write outside the external-drive root.
