import "./lib/load-env.mjs";
import { randomUUID } from "node:crypto";
import {
  createPgPool,
  createRepositories
} from "../packages/db/dist/index.js";

const enabled = process.env.VIJI_PHASE17_SELF_TEST_ENABLED === "true";
if (!enabled) {
  process.stderr.write(
    "Refusing to inject a Phase 17 self-test message. Set VIJI_PHASE17_SELF_TEST_ENABLED=true for this command only.\n"
  );
  process.exit(2);
}

const channelAccountId =
  process.env.VIJI_DEFAULT_CHANNEL_ACCOUNT_ID ||
  "00000000-0000-4000-8000-000000000003";
const displayName =
  process.env.VIJI_TEST_ALLOWLIST_MYSELF_DISPLAY_NAME || "Myself";
const body =
  process.env.VIJI_PHASE17_SELF_TEST_BODY ||
  "Phase 17 self-test: please reply with a short confirmation.";

const pool = createPgPool();

try {
  const repositories = createRepositories(pool);
  const contact = await repositories.contacts.findAllowlistedContactByDisplayName(
    displayName
  );

  if (!contact) {
    throw new Error(`Allowlisted self-test contact was not found: ${displayName}`);
  }

  if (!contact.waJid) {
    throw new Error(`Allowlisted self-test contact has no WhatsApp JID: ${displayName}`);
  }

  const conversation = await repositories.conversations.upsertDirectConversation({
    channelAccountId,
    primaryContactId: contact.contactId,
    externalChatId: contact.waJid,
    title: contact.displayName,
    contextState: "fresh"
  });
  const suffix = randomUUID();
  const adapterEvent = await repositories.adapterEvents.insertAdapterEventIdempotent({
    channelAccountId,
    type: "message.received",
    externalEventId: `phase17-self-test:${suffix}`,
    payload: {
      source: "phase17-self-test",
      redacted: true
    }
  });
  const message = await repositories.messages.insertInboundMessageIdempotent({
    conversationId: conversation.conversationId,
    senderContactId: contact.contactId,
    adapterEventId: adapterEvent.event.adapterEventId,
    externalMessageId: `phase17-self-test:${suffix}`,
    type: "text",
    body,
    bodyRedacted: false,
    receivedAt: new Date()
  });

  await repositories.auditEvents.recordAuditEvent({
    type: "phase17.self_test_injected",
    severity: "info",
    contactId: contact.contactId,
    conversationId: conversation.conversationId,
    detail: {
      messageId: message.message.messageId,
      inserted: message.status === "inserted",
      redacted: true
    }
  });

  process.stdout.write(
    `${JSON.stringify(
      {
        status: "queued_for_live_worker",
        contact: "[redacted-contact]",
        conversationId: "[redacted-id]",
        messageId: "[redacted-id]",
        inserted: message.status === "inserted"
      },
      null,
      2
    )}\n`
  );
} finally {
  await pool.end();
}
