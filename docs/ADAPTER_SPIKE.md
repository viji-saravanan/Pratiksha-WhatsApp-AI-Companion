# Adapter Spike: `wacli`

## Decision

Continue with `wacli` for the next implementation phase.

Reason:

- The installed host binary is available at `/opt/homebrew/bin/wacli`.
- `wacli --help` exposes the required Phase 8 command surface: `doctor`, `auth`, `sync`, `chats`, `messages`, `send text`, `send file`, and `media download`.
- Every required command supports `--json`, `--store`, and `--timeout`, which makes it suitable for typed wrapper execution.
- The local store path can be forced to `/Volumes/Arya 1TB/VijiAI/wacli/store`, keeping WhatsApp state on the SSD.

## Observed Host State

Command:

```bash
wacli version --json
wacli doctor --json --store "/Volumes/Arya 1TB/VijiAI/wacli/store" --timeout 5s
```

Observed on 2026-05-02:

- `wacli` version: `0.6.0`
- Store path: `/Volumes/Arya 1TB/VijiAI/wacli/store`
- Store lock held: `false`
- Authenticated: `true`
- Connected: `false`
- FTS enabled: `false`

`wacli` 0.2.0 returned a WhatsApp client-outdated auth error, so the host binary was upgraded through Homebrew before live QR linking. No real WhatsApp messages, phone numbers, JIDs, QR data, or auth stores were committed.

## Implemented Wrapper Surface

Phase 8 wraps these command shapes inside `apps/wa-adapter-wacli` only:

- `wacli doctor --json --store <ssd-store> --timeout <duration>`
- `wacli auth status --json --store <ssd-store> --timeout <duration>`
- `wacli auth [--download-media] [--follow] [--idle-exit <duration>] --json --store <ssd-store> --timeout <duration>`
- `wacli sync [--once] [--download-media] [--follow] [--idle-exit <duration>] [--refresh-contacts] [--refresh-groups] --json --store <ssd-store> --timeout <duration>`
- `wacli chats list [--query <text>] [--limit <n>] --json --store <ssd-store> --timeout <duration>`
- `wacli messages list [--chat <jid>] [--limit <n>] [--after <time>] [--before <time>] --json --store <ssd-store> --timeout <duration>`
- `wacli messages search <query> [--chat <jid>] [--from <jid>] [--type <media-type>] [--limit <n>] [--after <time>] [--before <time>] --json --store <ssd-store> --timeout <duration>`
- `wacli send text --to <recipient> --message <text> --json --store <ssd-store> --timeout <duration>`
- `wacli send file --to <recipient> --file <path> [--caption <text>] [--filename <name>] [--mime <mime>] --json --store <ssd-store> --timeout <duration>`
- `wacli media download --chat <jid> --id <message-id> [--output <path>] --json --store <ssd-store> --timeout <duration>`

Live sends are blocked unless `VIJI_WACLI_LIVE_SEND_ENABLED=true`.

## Failure Classes

The wrapper classifies failures into:

- `auth`
- `network`
- `backoff`
- `send`
- `store_lock`
- `storage`
- `unknown`

These map to centralized shared error codes in `packages/shared`.

## Manual Smoke Checklist

Doctor smoke, opt-in:

```bash
VIJI_WACLI_LIVE_SMOKE_ENABLED=true corepack pnpm --filter @viji/wa-adapter-wacli doctor:smoke
```

Redacted read-only smoke, opt-in:

```bash
VIJI_WACLI_LIVE_READ_SMOKE_ENABLED=true \
VIJI_WACLI_LIVE_READ_SMOKE_QUERY="Vijayalakshmi Saravanan" \
corepack pnpm --filter @viji/wa-adapter-wacli read:smoke
```

This reports only match counts, DM/group type, a short stable chat hash, message sample counts, and latest timestamp. It must not print message bodies, phone numbers, or JIDs.

Redacted recovery smoke, opt-in:

```bash
VIJI_WACLI_LIVE_RECOVERY_SMOKE_ENABLED=true \
VIJI_WACLI_LIVE_READ_SMOKE_QUERY="Vijayalakshmi Saravanan" \
corepack pnpm --filter @viji/wa-adapter-wacli recovery:smoke
```

This uses the same redacted output contract as read smoke and optionally accepts `VIJI_WACLI_LIVE_RECOVERY_SMOKE_AFTER` to verify an adapter reconnect window.

Auth status, non-send:

```bash
corepack pnpm --filter @viji/wa-adapter-wacli auth:status
```

Live send smoke, opt-in and explicit recipient:

```bash
VIJI_WACLI_LIVE_SEND_ENABLED=true \
VIJI_WACLI_LIVE_SEND_SMOKE_ENABLED=true \
VIJI_WACLI_LIVE_SEND_SMOKE_TO="<explicit-recipient-jid-or-phone>" \
corepack pnpm --filter @viji/wa-adapter-wacli send:smoke
```

Do not use a real recipient in committed docs, tests, or fixtures.

## Remaining Work

- Phase 9 reconnect recovery and one-page resumable backfill are implemented.
- Phase 13 added media-specific sync jobs, but Phase 21 must wire those jobs into unattended Docker runtime so queued media is downloaded without a manual one-shot command.
- File sharing calls `send file` only after a registered resource and the WhatsApp requester confirms the exact pending proposal.

## 2026-05-23 Repo-Wide Review Update

`wacli` remains the current stable implementation path. The wrapper now has parent-side timeouts and the runtime stays behind the adapter boundary, but it is still a subprocess/request-response adapter.

The review identified a future Phase 20 spike for persistent WhatsApp behavior. That spike should evaluate whether a direct persistent socket implementation can provide:

- Lower live-message latency.
- Fewer repeated command launches.
- Native message, media, receipt, and reconnect events.
- More reliable mark-read and ack handling.

Guardrails for that spike:

- Do not replace `wacli` until the new adapter passes recovery, duplicate-prevention, media, and send-gate tests.
- Keep canonical messages, media links, jobs, drafts, and audit records in Postgres.
- Keep auth/session state on the SSD under `VIJI_DATA_ROOT`.
- Keep sends behind policy, outbox, idempotency, and WhatsApp-recipient confirmation.
- Keep `wacli` as rollback until the persistent adapter is proven in a controlled trial.
