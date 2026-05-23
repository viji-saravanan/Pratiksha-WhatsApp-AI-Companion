import "./lib/load-env.mjs";
import { createPgPool } from "../packages/db/dist/index.js";
import { runLiveAllowlistPoll } from "../apps/worker/dist/index.js";
import { createWacliClient } from "../apps/wa-adapter-wacli/dist/index.js";

const channelAccountId =
  process.env.VIJI_DEFAULT_CHANNEL_ACCOUNT_ID ||
  "00000000-0000-4000-8000-000000000003";

const pool = createPgPool();

try {
  const result = await runLiveAllowlistPoll(pool, {
    channelAccountId,
    adapter: createWacliClient(),
    contactLimit: positiveInteger(process.env.VIJI_LIVE_INGEST_CONTACT_LIMIT, 100),
    chatSearchLimit: positiveInteger(
      process.env.VIJI_LIVE_INGEST_CHAT_SEARCH_LIMIT,
      5
    ),
    messageLimit: positiveInteger(process.env.VIJI_LIVE_INGEST_MESSAGE_LIMIT, 25)
  });

  process.stdout.write(`${JSON.stringify(redactResult(result), null, 2)}\n`);
  if (result.status === "failed") {
    process.exitCode = 2;
  }
} finally {
  await pool.end();
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function redactResult(result) {
  return {
    ...result,
    contacts: result.contacts.map((contact) => ({
      ...contact,
      contactId: "[redacted-id]",
      chatId: contact.chatId ? "[redacted-chat]" : undefined,
      syncRun: contact.syncRun
        ? {
            syncRunId: "[redacted-id]",
            state: contact.syncRun.state,
            kind: contact.syncRun.kind,
            messagesSeen: contact.syncRun.messagesSeen,
            messagesImported: contact.syncRun.messagesImported
          }
        : undefined
    }))
  };
}
