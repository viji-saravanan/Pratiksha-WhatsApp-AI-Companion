# Phase 17 Trial Report

## Status

Initial live gate passed. Phase 17 remains open until a fresh inbound WhatsApp message is observed and the assistant sends a policy-allowed reply with the `[Pratiksha]` prefix.

## Run

- Date: 2026-05-08.
- Runtime: Docker Compose `dashboard`, `app`, and `live` profiles.
- Stop command: `corepack pnpm stack:down`.
- Live flags: command-scoped through `corepack pnpm stack:live:up`; `.env` remains safe by default.
- Contacts: Vijayalakshmi Saravanan is primary; Myself remains allowlisted for controlled testing and development changes.
- Assistant identity: Pratiksha, using `[Pratiksha]` as the send-bound reply prefix.

## Gates

- API: pass.
- Postgres: pass.
- Storage: pass.
- Context freshness: pass.
- Local AI: pass with `qwen3:4b-instruct-2507-q4_K_M`.
- Live WhatsApp read smoke: pass, with one exact trusted DM match and redacted counts.
- Live send readiness: pass after command-scoped live enablement.
- Resource safety: pass; no dashboard/API approval path for file sends.

## Observation

- The live worker started inside Docker and stayed running.
- Repeated cycles scanned the two allowlisted contacts, Vijayalakshmi and Myself.
- Existing old messages were not sent replies.
- Outbox count remained zero during idle observation.
- No duplicate sends or worker failures were observed.
- Current automated verification: 86 Node tests passed, full TypeScript passed, Compose config passed, and 24 skills validated.

## Still Required

- Send or receive a fresh controlled test message and verify the assistant reply starts with `[Pratiksha]`.
- Restart the live stack and verify no duplicate reply is sent for already processed messages.
- Exercise a live file suggestion and Vijayalakshmi-side confirmation before any file send.
- Record latency, CPU/memory pressure, and SSD growth during a longer trial window.
- If Vijayalakshmi's WhatsApp remains unavailable, use `VIJI_PHASE17_SELF_TEST_ENABLED=true corepack pnpm trial:self-test` as a development substitute and keep the production inbound proof listed separately.

## Current Decision

Keep live trial mode available, but do not mark Phase 17 complete until the fresh-message and restart checks pass.
