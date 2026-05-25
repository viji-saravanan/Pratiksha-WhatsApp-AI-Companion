import { readFileSync } from "node:fs";

export const redactedWacliFixture = JSON.parse(
  readFileSync("fixtures/wacli/messages-list-redacted.json", "utf8")
);

export const vijayalakshmiFixture = redactedWacliFixture.data.messages[0];

export async function createVijayalakshmiFixtureHarness(repositories) {
  const person = await repositories.contacts.createPerson({
    displayName: "Vijayalakshmi Saravanan",
    notes: "Synthetic fixture person"
  });
  const contact = await repositories.contacts.createAllowlistedContact({
    ownerPersonId: person.personId,
    displayName: vijayalakshmiFixture.sender_name,
    waJid: vijayalakshmiFixture.sender_jid,
    trustLevel: "trusted"
  });
  const channelAccount =
    await repositories.channelAccounts.createChannelAccount({
      label: "Redacted wacli fixture account",
      storePath: "/data/pratiksha/wacli/store",
      state: "ready"
    });

  async function createInboundMessage(options = {}) {
    const externalMessageId =
      options.externalMessageId ?? vijayalakshmiFixture.id;
    const conversation =
      await repositories.conversations.upsertDirectConversation({
        channelAccountId: channelAccount.channelAccountId,
        primaryContactId: contact.contactId,
        externalChatId: `${vijayalakshmiFixture.chat_jid}:${externalMessageId}`,
        title: vijayalakshmiFixture.chat_name,
        contextState: options.contextState ?? "fresh"
      });
    const adapterEvent =
      await repositories.adapterEvents.insertAdapterEventIdempotent({
        channelAccountId: channelAccount.channelAccountId,
        type: "message",
        externalEventId: `event:${externalMessageId}`,
        payload: { redacted: true, source: "redacted-fixture" }
      });
    const inbound =
      await repositories.messages.insertInboundMessageIdempotent({
        conversationId: conversation.conversationId,
        senderContactId: contact.contactId,
        adapterEventId: adapterEvent.event.adapterEventId,
        externalMessageId,
        body: options.body ?? vijayalakshmiFixture.text,
        receivedAt: new Date(options.receivedAt ?? vijayalakshmiFixture.timestamp)
      });

    return inbound.message;
  }

  async function createResourceProposalDraft(options = {}) {
    const inbound = await createInboundMessage({
      externalMessageId:
        options.externalMessageId ?? "wamid.redacted.vijayalakshmi.resource",
      body: options.body ?? "Can I have the marksheet?",
      receivedAt: options.receivedAt
    });
    const run = await repositories.agentRuns.createStartedRun({
      conversationId: inbound.conversationId,
      triggerMessageId: inbound.messageId,
      modelName: "deterministic-test-llm",
      promptHash: options.promptHash ?? "resource-proposal-prompt-hash",
      contextState: "fresh"
    });
    await repositories.agentRuns.markDrafted({
      agentRunId: run.agentRunId,
      inputTokens: 10,
      outputTokens: 8,
      latencyMs: 0
    });

    return repositories.drafts.createDraft({
      conversationId: inbound.conversationId,
      triggerMessageId: inbound.messageId,
      sourceAgentRunId: run.agentRunId,
      body: options.draftBody ?? "[Pratiksha] Do you mean marksheet.pdf?",
      confidence: 0.9,
      policyState: options.policyState ?? "confirm_resource",
      decidedAt: new Date("2026-05-01T10:00:30.000Z")
    });
  }

  return {
    contact,
    channelAccount,
    createInboundMessage,
    createResourceProposalDraft
  };
}

export async function countRows(pool, tableName) {
  const table = await pool.query(
    "SELECT to_regclass($1) AS \"tableName\"",
    [`public.${tableName}`]
  );
  if (!table.rows[0].tableName) {
    return 0;
  }

  const result = await pool.query(`SELECT count(*)::integer AS count FROM ${tableName}`);
  return result.rows[0].count;
}
