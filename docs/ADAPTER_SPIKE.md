# Adapter Spike: WhatsApp Runtime

## Phase 20 Decision

Decision: keep `wacli` as the production adapter for now, and introduce a
typed event-stream adapter contract behind `packages/whatsapp`.

Reason:

- The current `wacli` path has already passed live self-test, reconnect,
  duplicate-prevention, outbox, mark-read, and policy gates.
- Switching runtime adapters before an event-stream implementation exists would
  risk unsafe sends and lost canonical state.
- A persistent-socket adapter is still the right direction for lower latency,
  richer media/receipt events, and lower subprocess churn.

Phase 20 is therefore a spike and boundary phase. It does not replace the live
runtime. It defines the interface that a direct persistent adapter must satisfy
before it can be wired into the worker.

## Sources Checked

- [`wacli sync` docs](https://wacli.sh/sync.html): the hosted docs describe
  continuous follow mode, app-state recovery, `--events`, and `--webhook`.
- [`wacli` overview](https://wacli.sh/): documents the local SQLite store,
  WhatsApp Web linked-device model, and upstream `whatsmeow` dependency.
- [Baileys receiving updates](https://baileys.wiki/docs/socket/receiving-updates/):
  documents event-emitter updates such as messages, receipts, chats, contacts,
  groups, and calls.
- [Baileys GitHub](https://github.com/WhiskeySockets/Baileys): describes
  Baileys as a WebSocket-based TypeScript library for WhatsApp Web.
- [`whatsmeow` Go docs](https://pkg.go.dev/github.com/go-whatsapp/whatsmeow):
  documents `AddEventHandler`, message/receipt event handling, `Connect`, and
  helper builders for replies, reactions, revokes, history requests, and
  unavailable-message requests.

## Local Capability Check

Observed on 2026-05-24:

```bash
/opt/homebrew/bin/wacli version --json
/opt/homebrew/bin/wacli sync --help
docker compose run --rm --no-deps live-worker sh -lc 'wacli version --json; wacli sync --help'
```

Result:

- Host `/opt/homebrew/bin/wacli` reports `0.6.0`.
- Docker `live-worker` reports `0.5.0`.
- Both local help outputs expose `sync --follow` and `--idle-exit`.
- Neither local help output exposes `--events` or `--webhook` yet, even though
  the hosted docs now describe those flags.

Implication:

- The current Docker runtime cannot depend on `wacli --events` or
  `wacli --webhook` until the packaged binary is verified to expose them.
- The adapter contract should still support events, because both the hosted
  `wacli` direction and direct socket libraries point there.

## Option Comparison

| Option | Strengths | Risks | Fit |
| --- | --- | --- | --- |
| Current `wacli` subprocess adapter | Proven in this repo, simple rollback, store stays on SSD, command timeout and send gates already tested | Poll/sync latency, repeated subprocess startup, cache/store lock behavior, limited receipt/event surface | Keep as production baseline |
| `wacli sync --follow` with events/webhook | Lowest migration cost if local binary exposes documented flags; could preserve `wacli` auth/store model | Not available in the currently packaged binaries; webhook delivery is best-effort; still depends on `wacli` store semantics | Re-check after binary upgrade |
| Direct `whatsmeow` daemon | Persistent socket, native Go event handlers, same upstream family as `wacli`, rich message/receipt/media/reconnect surface | New Go service, auth/session lifecycle must be implemented carefully, more recovery testing needed | Best candidate for Phase 20B prototype |
| Baileys bridge | TypeScript ecosystem, WebSocket event emitter, rich message/receipt/chat/contact events | Separate auth-store model, more Node runtime pressure, upstream breaking changes, must prove Docker/SSD storage and reconnection | Viable fallback/prototype if `whatsmeow` cost is too high |
| WhatsApp Business Cloud API | Official webhook model and stable business semantics | User is not using WhatsApp Business; different account/product model; not suitable for personal WhatsApp automation | Out of scope |

## Event-Stream Contract

`packages/whatsapp` now defines `WhatsAppStreamingAdapter` as an optional
extension of `WhatsAppAdapter`.

Required event classes:

- `message`: normalized message payload for live, history, and backfill events.
- `receipt`: server ack, delivered, read, played, delete, or unknown receipt
  updates.
- `media`: media availability/download status for images, documents, audio,
  video, and future voice notes.
- `connection`: connecting, connected, disconnected, reconnecting,
  auth-required, or degraded state.
- `history_sync`: startup, backfill, idle, completion, and failure signals.
- `call`: call metadata surfaced as ignored/audited events.
- `adapter_error`: retryable and non-retryable adapter failures.

Boundary rules:

- The event-stream adapter may emit events only. It must not draft, approve, or
  send replies directly.
- Inbound events still flow through the existing allowlist, ingestion,
  policy, draft, outbox, and dispatch paths.
- File sends still require the WhatsApp requester to confirm the exact pending
  proposal. The dashboard/API owner path remains non-authoritative.
- Canonical messages, media links, jobs, drafts, sync state, and audit records
  stay in Postgres.
- Adapter auth/session state stays under `VIJI_DATA_ROOT`.
- Local cache files are operational adapter state only; they are never the
  application source of truth.

## Recommended Phase 20B Prototype

Prototype a direct `whatsmeow` daemon behind the new event-stream contract.

Implementation outline:

1. Add `apps/wa-adapter-whatsmeow` as a separate Docker service, disabled by
   default.
2. Store auth/session files under `${VIJI_DATA_ROOT}/whatsmeow`.
3. Expose a local-only event stream to the worker over stdin/stdout NDJSON,
   Unix socket, or HTTP server-sent events.
4. Normalize every event into `WhatsAppEventEnvelope`.
5. Reuse existing worker ingestion, media, mark-read, outbox, and policy code.
6. Keep `wacli` as the active rollback path until recovery and live tests pass.

Prototype acceptance gates:

- Startup after Docker restart does not require QR re-auth unless the session is
  invalid.
- Inbound live messages reach Postgres without a one-shot sync window.
- Receipts and mark-read events are observable and audited.
- Media availability creates the same queued media-download state used by Phase
  21.
- Duplicate live, history, and reconnect events do not duplicate messages or
  outbound jobs.
- Network loss enters degraded/reconnecting state and does not send unsafe
  replies.
- Live sends still pass through outbox idempotency and policy.

## Rollback

`wacli` remains the supported production adapter until a persistent adapter
passes the above gates in a controlled trial.

Rollback must be one configuration change:

```bash
VIJI_WHATSAPP_ADAPTER=wacli
```

Do not remove `wacli` scripts, tests, or docs until the replacement adapter has
completed a separate live trial and code review.
