import assert from "node:assert/strict";
import {
  assertSuccess,
  run,
  startDisposablePostgres
} from "../helpers/disposable-postgres.mjs";

const build = run("corepack", ["pnpm", "--filter", "@viji/db", "build"]);
assertSuccess(build, "build @viji/db");

const { createPgPool, createRepositories, withTransaction } = await import(
  "../../packages/db/dist/index.js"
);

const postgres = await startDisposablePostgres({ prefix: "viji-phase2" });

try {
  postgres.runProjectScript("scripts/run-migrations.mjs");

  const pool = createPgPool({ connectionString: postgres.connectionString });

  try {
    const repositories = createRepositories(pool);

    const person = await repositories.contacts.createPerson({
      displayName: "Vijayalakshmi Saravanan",
      notes: "Synthetic repository test person"
    });
    assert.equal(person.displayName, "Vijayalakshmi Saravanan");

    const contact = await repositories.contacts.createAllowlistedContact({
      ownerPersonId: person.personId,
      displayName: "Vijayalakshmi Saravanan",
      trustLevel: "trusted"
    });
    assert.equal(contact.isAllowlisted, true);
    assert.equal(contact.trustLevel, "trusted");

    const foundContact =
      await repositories.contacts.findAllowlistedContactByDisplayName(
        "Vijayalakshmi Saravanan"
      );
    assert.equal(foundContact?.contactId, contact.contactId);

    const channelAccount =
      await repositories.channelAccounts.createChannelAccount({
        label: "Repository test personal WhatsApp",
        storePath: "/Volumes/Arya 1TB/VijiAI/wacli/store",
        state: "auth_required"
      });
    assert.equal(channelAccount.adapterType, "wacli");

    const conversation =
      await repositories.conversations.upsertDirectConversation({
        channelAccountId: channelAccount.channelAccountId,
        primaryContactId: contact.contactId,
        externalChatId: "repo-test-chat",
        title: "Repository Test Chat",
        contextState: "fresh"
      });
    assert.equal(conversation.type, "dm");

    const sameConversation =
      await repositories.conversations.upsertDirectConversation({
        channelAccountId: channelAccount.channelAccountId,
        primaryContactId: contact.contactId,
        externalChatId: "repo-test-chat",
        title: "Repository Test Chat Updated",
        contextState: "recovering"
      });
    assert.equal(sameConversation.conversationId, conversation.conversationId);
    assert.equal(sameConversation.contextState, "recovering");

    const foundConversation =
      await repositories.conversations.findByExternalChatId(
        channelAccount.channelAccountId,
        "repo-test-chat"
      );
    assert.equal(foundConversation?.conversationId, conversation.conversationId);

    const adapterEvent =
      await repositories.adapterEvents.insertAdapterEventIdempotent({
        channelAccountId: channelAccount.channelAccountId,
        type: "message",
        externalEventId: "repo-event-1",
        payload: { redacted: true, source: "fixture" }
      });
    assert.equal(adapterEvent.status, "inserted");

    const duplicateAdapterEvent =
      await repositories.adapterEvents.insertAdapterEventIdempotent({
        channelAccountId: channelAccount.channelAccountId,
        type: "message",
        externalEventId: "repo-event-1",
        payload: { redacted: true, source: "changed" }
      });
    assert.equal(duplicateAdapterEvent.status, "existing");
    assert.equal(
      duplicateAdapterEvent.event.adapterEventId,
      adapterEvent.event.adapterEventId
    );

    const inboundMessage =
      await repositories.messages.insertInboundMessageIdempotent({
        conversationId: conversation.conversationId,
        senderContactId: contact.contactId,
        adapterEventId: adapterEvent.event.adapterEventId,
        externalMessageId: "repo-message-1",
        body: "Synthetic repository test message",
        receivedAt: new Date("2026-05-01T00:00:00.000Z")
      });
    assert.equal(inboundMessage.status, "inserted");
    assert.equal(inboundMessage.message.body, "Synthetic repository test message");

    const duplicateMessage =
      await repositories.messages.insertInboundMessageIdempotent({
        conversationId: conversation.conversationId,
        senderContactId: contact.contactId,
        adapterEventId: adapterEvent.event.adapterEventId,
        externalMessageId: "repo-message-1",
        body: "Changed body should not overwrite",
        receivedAt: new Date("2026-05-01T00:01:00.000Z")
      });
    assert.equal(duplicateMessage.status, "existing");
    assert.equal(duplicateMessage.message.messageId, inboundMessage.message.messageId);
    assert.equal(duplicateMessage.message.body, "Synthetic repository test message");

    await withTransaction(pool, async (client) => {
      const txRepositories = createRepositories(client);
      await txRepositories.messages.insertInboundMessageIdempotent({
        conversationId: conversation.conversationId,
        senderContactId: contact.contactId,
        externalMessageId: "repo-message-2",
        body: "Transactional synthetic message",
        receivedAt: new Date("2026-05-01T00:02:00.000Z")
      });
      await txRepositories.syncCursors.upsertSyncCursor({
        channelAccountId: channelAccount.channelAccountId,
        conversationId: conversation.conversationId,
        name: "latest_message",
        value: "repo-message-2"
      });
    });

    const cursor = await repositories.syncCursors.findSyncCursor({
      channelAccountId: channelAccount.channelAccountId,
      conversationId: conversation.conversationId,
      name: "latest_message"
    });
    assert.equal(cursor?.value, "repo-message-2");

    await assert.rejects(
      withTransaction(pool, async (client) => {
        const txRepositories = createRepositories(client);
        await txRepositories.syncCursors.upsertSyncCursor({
          channelAccountId: channelAccount.channelAccountId,
          conversationId: conversation.conversationId,
          name: "latest_message",
          value: "rolled-back-cursor"
        });
        throw new Error("force rollback");
      }),
      /force rollback/
    );

    const cursorAfterRollback = await repositories.syncCursors.findSyncCursor({
      channelAccountId: channelAccount.channelAccountId,
      conversationId: conversation.conversationId,
      name: "latest_message"
    });
    assert.equal(cursorAfterRollback?.value, "repo-message-2");

    const syncRun = await repositories.syncRuns.createSyncRun({
      channelAccountId: channelAccount.channelAccountId,
      conversationId: conversation.conversationId,
      kind: "live"
    });
    const finishedSyncRun = await repositories.syncRuns.finishSyncRun({
      syncRunId: syncRun.syncRunId,
      state: "completed",
      messagesSeen: 2,
      messagesImported: 2,
      contextStateAfter: "fresh"
    });
    assert.equal(finishedSyncRun.state, "completed");
    assert.equal(finishedSyncRun.messagesImported, 2);

    const backfillJob = await repositories.backfillJobs.createBackfillJob(
      conversation.conversationId
    );
    const completedBackfillJob =
      await repositories.backfillJobs.updateBackfillJobState({
        backfillJobId: backfillJob.backfillJobId,
        state: "completed",
        cursor: "oldest-message",
        messagesImported: 10
      });
    assert.equal(completedBackfillJob.state, "completed");
    assert.equal(completedBackfillJob.messagesImported, 10);

    const media = await repositories.messages.addMessageMedia({
      messageId: inboundMessage.message.messageId,
      externalMediaId: "repo-media-1",
      mimeType: "image/png",
      fileName: "repo.png",
      sizeBytes: 128
    });
    const mediaJob = await repositories.mediaJobs.createMediaDownloadJobIdempotent({
      messageMediaId: media.messageMediaId,
      conversationId: conversation.conversationId
    });
    assert.equal(mediaJob.status, "inserted");

    const duplicateMediaJob =
      await repositories.mediaJobs.createMediaDownloadJobIdempotent({
        messageMediaId: media.messageMediaId,
        conversationId: conversation.conversationId
      });
    assert.equal(duplicateMediaJob.status, "existing");
    assert.equal(
      duplicateMediaJob.job.mediaDownloadJobId,
      mediaJob.job.mediaDownloadJobId
    );

    const auditEvent = await repositories.auditEvents.recordAuditEvent({
      type: "repository.test",
      severity: "info",
      contactId: contact.contactId,
      conversationId: conversation.conversationId,
      detail: { redacted: true, body: "[redacted]" }
    });
    assert.equal(auditEvent.type, "repository.test");
    assert.deepEqual(auditEvent.detail, { redacted: true, body: "[redacted]" });
  } finally {
    await pool.end();
  }
} finally {
  postgres.stop();
}
