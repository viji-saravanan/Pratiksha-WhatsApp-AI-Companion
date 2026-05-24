# Viji Helper Overview

## Locked Defaults

| Area | Decision |
| --- | --- |
| WhatsApp account type | Personal WhatsApp, not WhatsApp Business |
| First adapter | `wacli` spike first |
| Data root | `/Volumes/Arya 1TB/VijiAI` |
| Storage profile | `large-200gb` |
| Runtime | Docker on an always-on host with the SSD mounted |
| Assistant identity | Pratiksha |
| Reply launch mode | Unattended trusted-contact text auto-reply after safety gates pass |
| Reply marker | Prefix every AI-sent message with `[Pratiksha]` |
| Contacts | Vijayalakshmi Saravanan as primary; Myself retained as a local test contact |
| Chat history | Recover all available allowlisted history, best-effort |
| Chat media | Download allowlisted chat media with quota controls |
| Resource sharing | Ask Vijayalakshmi to confirm the exact matched file in WhatsApp before sending |

## Product Goal

Build Pratiksha, a local-first assistant that can help Vijayalakshmi Saravanan over WhatsApp when she messages you, including unattended text replies when the host is online and all safety gates pass. Keep `Myself` allowlisted for controlled development tests without treating actual `from_me` WhatsApp messages as inbound triggers. Later Pratiksha should understand a local file/resource catalog well enough to propose sending the right file, such as Vijayalakshmi's resume PDF, when she asks for it.

## Phase Map

| Phase | Outcome |
| --- | --- |
| Phase 0 | Validate `wacli`, auth persistence, sync, reconnect, backfill, media download, and send behavior |
| Phase 1 | Text-only assistant with local LLM, trusted-contact auto mode, dashboard, CLI, logs, and safe idle states |
| Phase 2 | Resource catalog with tags, aliases, extracted text, and recipient-confirmed file sending |
| Phase 3 | More connectors, richer resource sharing, and hardened backups/restore |

## Safety Defaults

- Unknown contacts are ignored.
- Auto-send is allowed only for explicitly allowlisted trusted contacts after policy, context, storage, DB, adapter, and model health checks pass.
- Stale context blocks auto-send.
- Storage full blocks unsafe writes and sends.
- File sharing requires exact-file confirmation in chat before sending.
- Real WhatsApp tests are opt-in.
