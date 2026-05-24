# Viji Helper

Local-first WhatsApp assistant for helping Vijayalakshmi Saravanan through your personal WhatsApp account. The assistant identity is **Pratiksha**, and send-bound replies use the `[Pratiksha]` prefix.

This repository currently includes implementation through Phase 18, with Phase 17 still in controlled live-trial status: SSD-first foundation, database schema/repositories, `wacli` ingestion contract, policy/draft/outbox flow, local authenticated API plus API-backed CLI, hardened live `wacli` auth/read-only smoke checks, reconnect/backfill recovery, Postgres-canonical live allowlist polling, local Ollama generation/embedding via `apps/llm-proxy`, safe local resource indexing, ranked file suggestions with WhatsApp-only recipient confirmation, received-media promotion, dashboard/observability, backup/retention, failure-safety tests, Compose-owned live worker runtime, and project skill guidance. Phase 17 is complete only after the controlled real-world trial report is accepted.

## Documents

- [Technical Design Document](docs/TDD.md)
- [Entity Relationship Design](docs/ERD.md)
- [Project Structure](docs/PROJECT_STRUCTURE.md)
- [Developer Guide](docs/DEV_GUIDE.md)
- [Overview](docs/00_OVERVIEW.md)
- [Storage Profile](docs/04_STORAGE_PROFILE.md)
- [Local LLM Runtime](docs/LOCAL_LLM.md)
- [Chat Context Recovery](docs/08_CHAT_CONTEXT_RECOVERY.md)
- [Implementation Phases](docs/09_IMPLEMENTATION_PHASES.md)
- [Codex Skill Pack](docs/10_CODEX_SKILLS.md)
- [Adapter Spike](docs/ADAPTER_SPIKE.md)

## Run And Stop

Run the full live assistant stack:

```bash
cd "/Volumes/Arya 1TB/VijiAI/workspace/viji-helper" && corepack pnpm stack:live:up
```

Stop the full stack before ejecting the SSD:

```bash
cd "/Volumes/Arya 1TB/VijiAI/workspace/viji-helper" && corepack pnpm stack:down
```

The live command first stops any stale Compose runtime, runs the WhatsApp store preflight, then starts Postgres, API, dashboard, LLM proxy, and the Docker-owned WhatsApp live worker. The preflight preserves `session.db`, backs up and removes only malformed disposable `wacli.db` cache files, warms missing/empty cache with a bounded `wacli sync --once`, checks `VIJI_WACLI_PREFLIGHT_REQUIRED_CHAT_QUERIES` when configured, and fails clearly if the WhatsApp auth/session database itself needs re-authentication. The stop command includes every Compose profile and removes orphaned containers, so no local Node server or stale Docker network keeps the SSD busy. Dashboard URL: `http://127.0.0.1:8788`.

For dashboard-only safe mode without live WhatsApp sends:

```bash
cd "/Volumes/Arya 1TB/VijiAI/workspace/viji-helper" && corepack pnpm stack:dashboard:up
```

Run a constrained Phase 17 self-test when only your own WhatsApp number is available:

```bash
cd "/Volumes/Arya 1TB/VijiAI/workspace/viji-helper" && VIJI_PHASE17_SELF_TEST_ENABLED=true corepack pnpm trial:self-test
```

This injects a redacted fresh inbound test event for the allowlisted `Myself` contact into Postgres, then the Docker live worker generates a Pratiksha reply and sends it through real `wacli`. It does not weaken the production rule: actual `from_me` WhatsApp messages never trigger auto-replies.

## Phase 0 Commands

```bash
corepack pnpm bootstrap:ssd
corepack pnpm check:storage:ssd
corepack pnpm test
corepack pnpm typecheck
docker compose config
docker compose build storage-guard
docker compose run --rm storage-guard
```

## Phase 1 Commands

```bash
node --test tests/migrations/phase1-migrations.test.mjs
node --test tests/**/*.test.mjs
corepack pnpm typecheck
docker compose config
```

## Phase 7 Commands

```bash
corepack pnpm typecheck
node --test tests/api-cli/phase7-api-cli.test.mjs
corepack pnpm api:start
corepack pnpm viji -- status
corepack pnpm viji -- confirmations
```

## Phase 8 Commands

```bash
corepack pnpm wa:auth:login
node --test tests/whatsapp/phase8-wacli-hardening.test.mjs
corepack pnpm wa:auth:status
VIJI_WACLI_LIVE_SMOKE_ENABLED=true corepack pnpm wa:doctor:smoke
VIJI_WACLI_LIVE_READ_SMOKE_ENABLED=true corepack pnpm wa:read:smoke
```

## Phase 9 Commands

```bash
node --test tests/whatsapp/phase9-reconnect-recovery.test.mjs
VIJI_WACLI_LIVE_RECOVERY_SMOKE_ENABLED=true corepack pnpm wa:recovery:smoke
corepack pnpm viji -- backfill status
```

## Phase 10 Commands

```bash
node --test tests/whatsapp/phase10-live-polling.test.mjs
corepack pnpm wa:ingest:once
```

## Phase 12 Commands

```bash
node --test tests/resources/phase12-resource-catalog.test.mjs
node --test tests/resources/phase12-resource-api-cli.test.mjs
corepack pnpm viji -- resources list
corepack pnpm viji -- resources index --scope library --yes
corepack pnpm viji -- resources register library/<file-name> --yes
```

Shareable files belong under `VIJI_RESOURCE_ROOT`, which defaults to `/Volumes/Arya 1TB/VijiAI/viji-files`. The CLI/API only register files that resolve under that root; arbitrary local paths and path escapes are rejected.

## Phase 13 Commands

```bash
node --test tests/whatsapp/phase13-media-sync.test.mjs
corepack pnpm wa:media:once
```

Allowlisted WhatsApp media downloads use `VIJI_WACLI_MEDIA_ROOT`, defaulting to `/Volumes/Arya 1TB/VijiAI/wacli/media`. Downloaded media is linked into `res_file_assets`; reusable received media must be promoted into `res_resources` before it can be proposed or sent again.

## Message Storage

Postgres is the canonical application store for WhatsApp messages, conversations, adapter events, sync cursors, drafts, outbox jobs, and audit records. The `wacli` store may still create SQLite files for its own auth/session/cache internals, but Viji Helper treats `wacli.db` as disposable adapter cache only; dashboard, CLI, worker, and AI context must read from Postgres. `corepack pnpm stack:live:up` automatically backs up malformed `wacli.db` files under `VIJI_WACLI_BACKUP_ROOT`, warms missing/empty cache before Docker starts, and preserves `session.db` so QR re-auth is not triggered unless the session database itself is missing or malformed.

Current live intake is poll-based. `corepack pnpm wa:ingest:once` polls allowlisted chats and imports new inbound and `from_me` messages into Postgres. `corepack pnpm stack:live:up` starts the Docker-owned live worker loop, which uses `VIJI_LIVE_POLL_INTERVAL_MS` as the target interval, refreshes the `wacli` store before polling when `VIJI_LIVE_SYNC_BEFORE_POLL_ENABLED=true`, and bounds each underlying `wacli` command with `VIJI_WACLI_TIMEOUT`. The live default target interval is `1000ms` with a reliability-first `12s` sync idle wait; successful live replies also call the adapter-owned `wacli-mark-read` helper so the inbound trigger or file-confirmation message is marked read after Pratiksha responds.

## Dashboard Commands

```bash
corepack pnpm dashboard:build
corepack pnpm dashboard:start
corepack pnpm stack:dashboard:up
corepack pnpm stack:live:up
corepack pnpm stack:down
```

For normal operation, use Compose as the lifecycle boundary. `corepack pnpm stack:dashboard:up` starts Postgres, API, and dashboard containers together, with the dashboard proxying the API through Docker service DNS at `http://api:8787`. `corepack pnpm stack:live:up` additionally starts the live worker with auto-reply and live-send enabled at command scope. `corepack pnpm stack:down` stops all project profiles before ejecting the SSD, so long-running Node servers and stale profile containers are not left holding files open on the external drive.

The dashboard serves at `http://127.0.0.1:8788` by default and proxies the API server-side. Browser assets do not contain `VIJI_API_TOKEN`; the dashboard service injects it server-side. `corepack pnpm dashboard:start` is for local development only and should not be used as the normal unattended runtime.

## Backup and Retention Commands

```bash
corepack pnpm backup:run -- --json
corepack pnpm restore:check -- --json
corepack pnpm retention:plan
corepack pnpm retention:apply -- --json
```

Backups are compressed Postgres custom-format dumps under `/Volumes/Arya 1TB/VijiAI/pgbackups`. Retention is dry-run by default and only prunes backup/tmp artifacts in the current implementation.

## Local AI Commands

```bash
corepack pnpm typecheck
node --test tests/ai/ollama-client.test.mjs
corepack pnpm ai:smoke
corepack pnpm llm-proxy:start
docker compose --profile ai up --build llm-proxy
```

## Current Direction

- Personal WhatsApp first, not WhatsApp Business.
- `wacli` is the preferred Phase 0/Phase 1 adapter candidate because it is local, scriptable, supports sync/search/send/file operations, and does not require a browser container.
- Local AI uses Ollama with `qwen3:4b-instruct-2507-q4_K_M` as the first real model on this Mac, with model files under `/Volumes/Arya 1TB/VijiAI/models/ollama`.
- Local embeddings use `mxbai-embed-large` through the same SSD-backed Ollama store.
- The adapter boundary stays pluggable so we can replace `wacli` with direct `whatsmeow`, Baileys, whatsapp-web.js, Evolution API, or the official WhatsApp Business Cloud API later.
- All heavy state, models, logs, database files, media, and backups are designed to live under `/Volumes/Arya 1TB/VijiAI` with a 200 GB maximum allocation.
- The active source workspace lives at `/Volumes/Arya 1TB/VijiAI/workspace/viji-helper`, so dependencies and build artifacts stay on the SSD too.
- Chat context must survive connect/reconnect by syncing, backfilling, and summarizing allowlisted WhatsApp conversations.
- If the external drive, network, WhatsApp session, database, or AI runtime is unavailable, the system should enter an explicit idle state rather than sending risky or partial replies.

## License

MIT. See [LICENSE](LICENSE).
