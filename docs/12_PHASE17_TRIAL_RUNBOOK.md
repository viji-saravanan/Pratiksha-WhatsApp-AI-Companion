# Phase 17 Trial Runbook

Phase 17 is a controlled local trial. It must use live API state, not screenshot fixtures or hardcoded file lists.

## Readiness Check

Run:

```bash
corepack pnpm trial:status
```

For machine-readable output:

```bash
corepack pnpm trial:status -- --json
```

The status command queries the local API for health, runtime, storage, conversations, confirmations, outbox, sync, media, resources, audit, and policy state. It intentionally reports counts and states only; it does not print registered filenames, message bodies, private media filenames, phone numbers, or tokens.

## Trial Gate

Do not start unattended trusted-contact trial mode until the status report says `Ready for controlled trial: yes`.

Required pass conditions:

- API and Postgres are reachable.
- Storage is `healthy` or `warning`.
- Trusted conversation context is fresh.
- Local AI model is reported by the API.
- Auto reply is enabled and default mode is `auto`.
- Live WhatsApp sending is enabled.
- File/resource sends remain gated by Vijayalakshmi's WhatsApp confirmation.

## Start Trial

Keep `.env` safe by default. It should keep `VIJI_AUTO_REPLY_ENABLED=false` and `VIJI_WACLI_LIVE_SEND_ENABLED=false`; the live trial command enables those values only for the Compose runtime.

Start the Compose-owned live runtime:

```bash
corepack pnpm stack:live:up
```

Then confirm readiness again:

```bash
corepack pnpm trial:status
```

The live command stops stale Compose containers, runs `corepack pnpm wa:store:preflight`, then starts the live runtime. The preflight preserves `session.db`, treats `wacli.db` as disposable cache, backs up malformed cache files under `VIJI_WACLI_BACKUP_ROOT`, warms missing/empty cache with a bounded `wacli sync --once`, and checks `VIJI_WACLI_PREFLIGHT_REQUIRED_CHAT_QUERIES` before Docker starts. If `session.db` is missing or malformed, or required allowlisted chats cannot be found after warm-up, startup stops with a clear action instead of entering a broken polling loop.

The live worker refreshes the `wacli` store, polls allowlisted chats on `VIJI_LIVE_POLL_INTERVAL_MS`, imports messages into Postgres, creates policy-checked drafts, dispatches through the Docker-contained `wacli` adapter, and sends a real mark-read receipt after successful replies when `VIJI_WACLI_MARK_READ_ENABLED=true`. Stopping Compose stops the live worker, API, dashboard, and Postgres so no local Node process keeps the SSD busy.

## Timing Model

`VIJI_LIVE_POLL_INTERVAL_MS` is the hot loop target for reading the local adapter cache and dispatching already-known work. With the current `wacli` adapter, truly fresh WhatsApp messages become visible only after a scheduled one-shot sync refreshes the local `wacli` store.

Default timing:

- `VIJI_LIVE_POLL_INTERVAL_MS=1000`
- `VIJI_LIVE_SYNC_INTERVAL_MS=60000`
- `VIJI_WACLI_TIMEOUT=30s` for normal chat/read/send commands
- `VIJI_WACLI_SYNC_TIMEOUT=75s` for one-shot syncs
- `VIJI_LIVE_SYNC_IDLE_EXIT=12s`

Operational meaning:

- A message already present in the `wacli` cache can be processed quickly by the hot loop.
- A message sent just after a scheduled sync can wait until the next sync interval, then wait for sync, model generation, dispatch, and mark-read.
- Lowering `VIJI_LIVE_SYNC_INTERVAL_MS` can reduce latency but increases command churn and laptop heat.
- Persistent-socket behavior belongs to Phase 20; do not claim the current `wacli` path has true push delivery.

## Latest Controlled Live Proof

Latest controlled test: 2026-05-24, allowlisted `Myself` contact.

Observed evidence:

- `corepack pnpm stack:live:up` started the Docker-owned live stack.
- `corepack pnpm trial:status` reported `Ready for controlled trial: yes`.
- Fresh inbound WhatsApp message received at `2026-05-24T10:00:54Z`.
- Imported into Postgres at `2026-05-24T10:01:35.616808Z`.
- Local Ollama draft completed in `4872ms`.
- Outbound text job queued at `2026-05-24T10:01:54.532107Z`.
- Real adapter mark-read audit recorded before the send audit.
- Outbound message recorded as sent at `2026-05-24T10:02:04.838341Z`.
- A second fresh message in the same sync window was also replied to once.
- Full test suite result after the live proof: `108` tests passed, `0` failed; `corepack pnpm typecheck` passed.

This is a working live result for the current adapter. It is also the evidence that Phase 20 is needed for lower latency and richer event handling.

## Self-Test Substitute

If Vijayalakshmi's WhatsApp is not available during development, the only safe substitute is the explicit self-test command:

```bash
VIJI_PHASE17_SELF_TEST_ENABLED=true corepack pnpm trial:self-test
```

This creates a fresh redacted inbound test event for the allowlisted `Myself` contact in Postgres. The live worker then uses the normal AI, policy, outbox, and real `wacli` send path. It does not make actual `from_me` WhatsApp messages eligible for auto-reply, because that would risk self-reply loops.

## Rollback

If any duplicate reply, wrong resource suggestion, adapter instability, or storage issue appears, pause the assistant:

```bash
corepack pnpm viji pause
```

For a full stop before ejecting the SSD:

```bash
corepack pnpm stack:down
```

Then capture status:

```bash
corepack pnpm trial:status -- --json
corepack pnpm viji logs containers --service all --tail 200
```

## Trial Notes

Record observations without private message bodies:

- Time window.
- Whether every assistant reply kept the `[Pratiksha]` prefix.
- Duplicate reply count.
- Reconnect/restart behavior.
- Average model latency from logs or audit metrics.
- CPU/memory pressure observed locally.
- SSD usage before and after.
- Resource matching misses, described without private filenames unless already registered test files.
- Whether received media reuse worked after promotion through the resource catalog.

## Exit Decision

At the end, choose one:

- Keep trusted-contact auto mode enabled.
- Keep the assistant in `confirm_resource` or `readonly`.
- Pause and tune prompts, resource ranking, adapter settings, or storage limits before retrying.
