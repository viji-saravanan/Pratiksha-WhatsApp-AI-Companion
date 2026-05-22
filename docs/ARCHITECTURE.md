# Architecture

Pratiksha is structured as a local-first Docker application. The owner-facing dashboard talks to the API; the API and worker share the same Postgres database; and local model calls are isolated behind the LLM proxy.

## Services

| Service | Purpose |
| --- | --- |
| `dashboard` | Visual control room, logs, uploads, and safe owner actions. |
| `api` | Status, resource, policy, conversation, audit, and dashboard endpoints. |
| `worker` | Draft generation, resource matching, confirmations, and outbound job orchestration. |
| `llm-proxy` | Thin Ollama proxy with bounded local generation settings. |
| `storage-guard` | Data root, sentinel, quota, and free-space checks. |
| `postgres` | Canonical state store with pgvector support. |

## State Boundaries

- Postgres stores canonical conversations, messages, resources, drafts, jobs, policies, and audit events.
- The configured data root stores large files, local model data, backups, temporary files, and operational caches.
- The file repository is only indexed through resource APIs, so matching can use registered filenames, aliases, summaries, and metadata.

## Branch Split

The main branch is the reviewable core: dashboard, API, worker, Postgres, resources, local LLM, and storage. Live WhatsApp adapter code is staged separately so pairing, reconnect, media, and read-receipt behavior can be reviewed without mixing it into the first public baseline.
