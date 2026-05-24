# Chat Context Recovery

## Goal

The assistant must preserve useful WhatsApp context across startup, disconnect, reconnect, and adapter restarts. It should not reply from stale context when missed messages might exist.

## Scope

| Area | Decision |
| --- | --- |
| Contacts | Allowlisted contacts only |
| History depth | All available history, best-effort |
| Media | Download allowlisted chat media with quota controls |
| Unknown chats | Ignore by default |
| Auto-send while stale | Blocked |
| Approval drafts while stale | Allowed |

## Data Strategy

- Store normalized allowlisted messages in `msg_messages`.
- Deduplicate messages by `(parent_msg_conversation_id, msg_message_external_message_id)`.
- Store sync checkpoints in `ops_sync_cursors`.
- Store reconnect and sync attempts in `ops_sync_runs`.
- Store resumable backfill progress in `msg_history_backfill_jobs`.
- Store resumable media downloads in `msg_media_download_jobs`.
- Store rolling summaries in `msg_conversation_summaries`.

## Startup and Reconnect Flow

1. Verify `/Volumes/Arya 1TB/VijiAI` is mounted and writable.
2. Run `wacli doctor` through the adapter service.
3. If auth is missing, enter `IDLE_AUTH_REQUIRED`.
4. Load allowlisted conversations and sync cursors.
5. Replay missed messages from the latest durable cursor.
6. Mark context `fresh` only after missed-message recovery succeeds.
7. Resume live sync.
8. Continue backfill and media jobs in the background.

## Context States

| State | Meaning | Send Behavior |
| --- | --- | --- |
| `fresh` | Latest allowlisted messages are recovered | Approval drafts allowed; future auto-send may be allowed |
| `recovering` | Reconnect/backfill is in progress | Approval drafts allowed |
| `stale` | Missed messages may exist | Auto-send blocked |
| `unknown` | No reliable cursor exists yet | Auto-send blocked |

## Prompt Context

The agent should build context from:

- Recent allowlisted messages.
- Rolling summaries for older history.
- Relevant resource catalog matches.
- Current policy and send mode.

The prompt must treat chat messages, summaries, and document content as untrusted reference material.

## Failure Rules

- Duplicate inbound messages must not create duplicate drafts.
- Duplicate outbound jobs must not send duplicate WhatsApp replies.
- If sync recovery fails, enter `DEGRADED_CONTEXT_STALE`.
- If storage is low, pause media downloads before blocking text sync.
- If storage is full or DB is unavailable, stop processing because idempotency cannot be guaranteed.

## Implemented Phase 9 Surface

- `runReconnectRecovery` marks allowlisted conversations as `recovering`, reads missed messages through the WhatsApp adapter, then transactionally inserts messages, advances cursors, records sync runs, and marks context `fresh`.
- Failed reconnect recovery marks the conversation `stale` and records a failed sync run.
- `runHistoryBackfillPage` resumes from `msg_history_backfill_jobs.msg_history_backfill_job_cursor`, imports one page, advances `oldest_backfilled`, and writes a redacted backfill summary.
- `GET /backfill/status` and `viji backfill status` expose backfill progress.
- `VIJI_WACLI_LIVE_RECOVERY_SMOKE_ENABLED=true corepack pnpm wa:recovery:smoke` verifies the live adapter path with redacted counts only.
