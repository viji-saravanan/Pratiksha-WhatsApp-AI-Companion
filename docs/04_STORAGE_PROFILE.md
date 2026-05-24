# Storage Profile

## Data Root

All heavy project state lives under:

```text
/Volumes/Arya 1TB/VijiAI
```

A sentinel file exists at:

```text
/Volumes/Arya 1TB/VijiAI/.viji-helper-root
```

## Default Profile: `large-200gb`

The SSD has more physical capacity, but this project should stay within a 200 GB allocation.

| Area | Budget | Notes |
| --- | ---: | --- |
| Local LLM models | 20 GB | Primary quantized model plus fallback |
| Postgres and pgvector | 30 GB | Messages, vectors, summaries, jobs, audit |
| `wacli` auth/cache | 10 GB | Adapter session/cache only; Postgres is canonical for app messages |
| Allowlisted chat media | 45 GB | Vijayalakshmi and future allowlisted contacts only |
| Resource catalog files | 45 GB | Manually curated files and indexed local folders |
| Logs and observability | 8 GB | App logs, Loki, Prometheus, Grafana |
| Backups | 20 GB | Compressed DB backups and restore checkpoints |
| Temporary workspace | 2 GB | Cleaned on startup and after failed jobs |
| Reserved free space | 20 GB | Required headroom for safe DB and adapter operation |

## Thresholds

| State | Trigger | Behavior |
| --- | --- | --- |
| Healthy | Below warning threshold | All enabled jobs may run |
| `DEGRADED_STORAGE_LOW` | 165 GB project usage or less than 25 GB filesystem free | Pause media downloads, indexing, and nonessential backups |
| `IDLE_STORAGE_FULL` | 185 GB project usage, less than 12 GB filesystem free, or writes fail | Block writes and outbound sends that need persistence |

## Directory Layout

```text
/Volumes/Arya 1TB/VijiAI/
  workspace/
    viji-helper/
  config/
  postgres/
  pgbackups/
  wacli/
    store/
    media/
  models/
  knowledge/
  viji-files/
    inbox/
    library/
    staged/
    thumbnails/
    manifests/
    tmp/
  logs/
  grafana/
  prometheus/
  loki/
  tmp/
```

## Rules

- Do not store heavy runtime state on the internal disk.
- Keep the active repo workspace under `/Volumes/Arya 1TB/VijiAI/workspace/viji-helper`.
- Keep pnpm's package store inside the SSD workspace via `.npmrc`.
- Exclude development caches and generated outputs such as `.pnpm-store`, `node_modules`, `.git`, `dist`, `coverage`, `.cache`, `.turbo`, and `*.tsbuildinfo` from project quota usage.
- Do not bake models or WhatsApp stores into Docker images.
- Do not read `wacli` SQLite files as application state; import allowlisted message windows into Postgres.
- Download media only for allowlisted chats.
- Keep media downloads resumable and quota-controlled.
- `VIJI_WACLI_MEDIA_ROOT` defaults to `${VIJI_DATA_ROOT}/wacli/media`; media download workers must reject adapter output paths outside that root.
- Keep old chat context through summaries when full text expires.
- Keep shareable resources under `VIJI_RESOURCE_ROOT`, defaulting to `/Volumes/Arya 1TB/VijiAI/viji-files`.
- Only files registered from the resource repository may be proposed for sharing; arbitrary Mac paths are not shareable.
- Use `viji-files/inbox` for manual drops, `viji-files/staged` for scanning, and `viji-files/library` for reviewed canonical files.

## Bootstrap

Create or verify the SSD directory layout with:

```bash
corepack pnpm bootstrap:ssd
```

The script is idempotent. It creates the expected category directories and touches the sentinel file without deleting existing data.
