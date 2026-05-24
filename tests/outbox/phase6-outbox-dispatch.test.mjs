import assert from "node:assert/strict";
import test from "node:test";

import {
  assertSuccess,
  run,
  startDisposablePostgres
} from "../helpers/disposable-postgres.mjs";
import {
  countRows,
  createVijayalakshmiFixtureHarness
} from "../helpers/redacted-vijayalakshmi-fixture.mjs";

const build = run("corepack", ["pnpm", "--filter", "@viji/worker", "build"]);
assertSuccess(build, "build @viji/worker");

const { createDeterministicTestLlmClient } = await import(
  "../../packages/ai/dist/index.js"
);
const { createPgPool, createRepositories } = await import(
  "../../packages/db/dist/index.js"
);
const {
  confirmResourceProposal,
  confirmResourceProposalFromInboundMessage,
  createRecordedOutboundDispatcher,
  createWacliOutboundDispatcher,
  denyResourceProposal,
  dispatchNextOutboundJob,
  generateDraftForInboundMessage,
  queuePolicyPermittedTextDraft
} = await import("../../apps/worker/dist/index.js");

function createDisposablePool(connectionString) {
  const pool = createPgPool({ connectionString });
  pool.on("error", () => {
    // Disposable Postgres containers are stopped at test teardown. Under full-suite
    // load, pg can emit an idle-client shutdown error after pool.end().
  });
  return pool;
}

async function createFreshDraft(pool, externalMessageId) {
  const repositories = createRepositories(pool);
  const harness = await createVijayalakshmiFixtureHarness(repositories);
  const inbound = await harness.createInboundMessage({
    externalMessageId
  });
  const result = await generateDraftForInboundMessage(pool, {
    triggerMessageId: inbound.messageId,
    llmClient: createDeterministicTestLlmClient(),
    now: new Date("2026-05-01T10:00:30.000Z")
  });

  assert.equal(result.status, "drafted");
  return {
    repositories,
    harness,
    draft: result.draft
  };
}

async function attemptRows(pool) {
  const result = await pool.query(`
    SELECT
      agent_send_attempt_number AS "attemptNumber",
      agent_send_attempt_state AS "state",
      agent_send_attempt_error_code AS "errorCode"
    FROM agent_send_attempts
    ORDER BY agent_send_attempt_number ASC
  `);

  return result.rows;
}

test("policy-permitted text reply queues once and dispatch records one send intent", async () => {
  const postgres = await startDisposablePostgres({ prefix: "viji-phase6-text" });

  try {
    postgres.runProjectScript("scripts/run-migrations.mjs");
    const pool = createDisposablePool(postgres.connectionString);

    try {
      const { draft } = await createFreshDraft(
        pool,
        "wamid.redacted.vijayalakshmi.phase6-text"
      );
      const firstQueue = await queuePolicyPermittedTextDraft(pool, {
        agentDraftId: draft.agentDraftId,
        now: new Date("2026-05-01T10:00:45.000Z")
      });
      const secondQueue = await queuePolicyPermittedTextDraft(pool, {
        agentDraftId: draft.agentDraftId,
        now: new Date("2026-05-01T10:00:45.000Z")
      });

      assert.equal(firstQueue.status, "queued");
      assert.equal(firstQueue.queueStatus, "inserted");
      assert.equal(secondQueue.status, "queued");
      assert.equal(secondQueue.queueStatus, "existing");
      assert.equal(firstQueue.job.idempotencyKey, secondQueue.job.idempotencyKey);
      assert.equal(await countRows(pool, "agent_outbound_jobs"), 1);

      const dispatcher = createRecordedOutboundDispatcher();
      const dispatch = await dispatchNextOutboundJob(pool, { dispatcher });

      assert.equal(dispatch.status, "sent");
      assert.equal(dispatcher.intents.length, 1);
      assert.equal(dispatcher.intents[0].kind, "text_reply");
      assert.equal(await countRows(pool, "agent_send_attempts"), 1);

      const auditText = (
        await pool.query("SELECT ops_audit_event_detail::text AS detail FROM ops_audit_events")
      ).rows
        .map((row) => row.detail)
        .join("\n");
      assert.equal(auditText.includes(draft.body), false);
    } finally {
      await pool.end();
    }
  } finally {
    postgres.stop();
  }
});

test("successful live text replies mark the inbound trigger message read", async () => {
  const postgres = await startDisposablePostgres({ prefix: "viji-phase6-mark-read" });

  try {
    postgres.runProjectScript("scripts/run-migrations.mjs");
    const pool = createDisposablePool(postgres.connectionString);

    try {
      const externalMessageId = "wamid.redacted.vijayalakshmi.phase6-mark-read";
      const { draft } = await createFreshDraft(pool, externalMessageId);
      const queued = await queuePolicyPermittedTextDraft(pool, {
        agentDraftId: draft.agentDraftId,
        now: new Date("2026-05-01T10:00:45.000Z")
      });
      assert.equal(queued.status, "queued");

      const sentTexts = [];
      const markReadCalls = [];
      const adapter = {
        async sendText(options) {
          sentTexts.push(options);
          return {
            ok: true,
            value: {
              externalMessageId: "wamid.redacted.outbound.phase6-mark-read"
            },
            metadata: {
              component: "test-wacli-adapter",
              operation: "send.text"
            }
          };
        },
        async markRead(options) {
          markReadCalls.push(options);
          return {
            ok: true,
            value: {
              messageIds: options.messageIds
            },
            metadata: {
              component: "test-wacli-adapter",
              operation: "messages.mark_read"
            }
          };
        }
      };
      const dispatcher = createWacliOutboundDispatcher(pool, adapter);
      const dispatch = await dispatchNextOutboundJob(pool, { dispatcher });

      assert.equal(dispatch.status, "sent");
      assert.equal(sentTexts.length, 1);
      assert.equal(markReadCalls.length, 1);
      assert.deepEqual(markReadCalls[0].messageIds, [externalMessageId]);

      const auditTypes = (
        await pool.query(`
          SELECT ops_audit_event_type AS type
          FROM ops_audit_events
          ORDER BY ops_audit_event_created_at ASC
        `)
      ).rows.map((row) => row.type);
      assert.ok(auditTypes.includes("whatsapp.mark_read_sent"));
    } finally {
      await pool.end();
    }
  } finally {
    postgres.stop();
  }
});

test("mark-read failures do not convert successful sends into failed jobs", async () => {
  const postgres = await startDisposablePostgres({
    prefix: "viji-phase6-mark-read-fail"
  });

  try {
    postgres.runProjectScript("scripts/run-migrations.mjs");
    const pool = createDisposablePool(postgres.connectionString);

    try {
      const { draft } = await createFreshDraft(
        pool,
        "wamid.redacted.vijayalakshmi.phase6-mark-read-fail"
      );
      await queuePolicyPermittedTextDraft(pool, {
        agentDraftId: draft.agentDraftId,
        now: new Date("2026-05-01T10:00:45.000Z")
      });

      const adapter = {
        async sendText() {
          return {
            ok: true,
            value: {
              externalMessageId: "wamid.redacted.outbound.phase6-mark-read-fail"
            },
            metadata: {
              component: "test-wacli-adapter",
              operation: "send.text"
            }
          };
        },
        async markRead() {
          return {
            ok: false,
            code: "adapter.network_unavailable",
            message: "Synthetic mark-read network failure",
            retryable: true,
            metadata: {
              component: "test-wacli-adapter",
              operation: "messages.mark_read"
            }
          };
        }
      };
      const dispatch = await dispatchNextOutboundJob(pool, {
        dispatcher: createWacliOutboundDispatcher(pool, adapter)
      });

      assert.equal(dispatch.status, "sent");
      const auditTypes = (
        await pool.query(`
          SELECT ops_audit_event_type AS type
          FROM ops_audit_events
          ORDER BY ops_audit_event_created_at ASC
        `)
      ).rows.map((row) => row.type);
      assert.ok(auditTypes.includes("whatsapp.mark_read_failed"));
    } finally {
      await pool.end();
    }
  } finally {
    postgres.stop();
  }
});

test("denied resource proposal never queues an outbound job", async () => {
  const postgres = await startDisposablePostgres({ prefix: "viji-phase6-deny" });

  try {
    postgres.runProjectScript("scripts/run-migrations.mjs");
    const pool = createDisposablePool(postgres.connectionString);

    try {
      const repositories = createRepositories(pool);
      const harness = await createVijayalakshmiFixtureHarness(repositories);
      const proposal = await harness.createResourceProposalDraft({
        externalMessageId: "wamid.redacted.vijayalakshmi.resource-deny"
      });
      const denied = await denyResourceProposal(pool, {
        agentDraftId: proposal.agentDraftId,
        now: new Date("2026-05-01T10:01:00.000Z")
      });

      assert.equal(denied.status, "denied");
      assert.equal(await countRows(pool, "agent_outbound_jobs"), 0);
    } finally {
      await pool.end();
    }
  } finally {
    postgres.stop();
  }
});

test("recipient-confirmed resource proposal queues once despite duplicate confirmation", async () => {
  const postgres = await startDisposablePostgres({ prefix: "viji-phase6-resource" });

  try {
    postgres.runProjectScript("scripts/run-migrations.mjs");
    const pool = createDisposablePool(postgres.connectionString);

    try {
      const repositories = createRepositories(pool);
      const harness = await createVijayalakshmiFixtureHarness(repositories);
      const proposal = await harness.createResourceProposalDraft({
        externalMessageId: "wamid.redacted.vijayalakshmi.resource-confirm"
      });
      const firstConfirm = await confirmResourceProposal(pool, {
        agentDraftId: proposal.agentDraftId,
        resourceId: "res-file-marksheet",
        registeredFileName: "marksheet.pdf",
        now: new Date("2026-05-01T10:01:00.000Z")
      });
      const secondConfirm = await confirmResourceProposal(pool, {
        agentDraftId: proposal.agentDraftId,
        resourceId: "res-file-marksheet",
        registeredFileName: "marksheet.pdf",
        now: new Date("2026-05-01T10:01:05.000Z")
      });

      assert.equal(firstConfirm.status, "queued");
      assert.equal(firstConfirm.queueStatus, "inserted");
      assert.equal(secondConfirm.status, "queued");
      assert.equal(secondConfirm.queueStatus, "existing");
      assert.equal(await countRows(pool, "agent_outbound_jobs"), 1);

      const dispatcher = createRecordedOutboundDispatcher();
      const dispatch = await dispatchNextOutboundJob(pool, {
        dispatcher,
        defaultMode: "confirm_resource"
      });

      assert.equal(dispatch.status, "sent");
      assert.equal(dispatcher.intents.length, 1);
      assert.equal(dispatcher.intents[0].kind, "resource_send");
      assert.deepEqual(dispatcher.intents[0].payload, {
        resourceId: "res-file-marksheet",
        registeredFileName: "marksheet.pdf"
      });
    } finally {
      await pool.end();
    }
  } finally {
    postgres.stop();
  }
});

test("WhatsApp inbound confirmation queues resource sends without dashboard approval", async () => {
  const postgres = await startDisposablePostgres({ prefix: "viji-phase6-wa-confirm" });

  try {
    postgres.runProjectScript("scripts/run-migrations.mjs");
    const pool = createDisposablePool(postgres.connectionString);

    try {
      const repositories = createRepositories(pool);
      const harness = await createVijayalakshmiFixtureHarness(repositories);
      const proposal = await harness.createResourceProposalDraft({
        externalMessageId: "wamid.redacted.vijayalakshmi.resource-wa-confirm",
        draftBody: "[Pratiksha] Do you mean marksheet.pdf?"
      });
      const adapterEvent =
        await repositories.adapterEvents.insertAdapterEventIdempotent({
          channelAccountId: harness.channelAccount.channelAccountId,
          type: "message.received",
          externalEventId: "event:redacted-resource-wa-confirm",
          payload: { redacted: true }
        });
      const confirmation =
        await repositories.messages.insertInboundMessageIdempotent({
          conversationId: proposal.conversationId,
          senderContactId: harness.contact.contactId,
          adapterEventId: adapterEvent.event.adapterEventId,
          externalMessageId: "wamid.redacted.vijayalakshmi.resource-wa-yes",
          body: "yes",
          receivedAt: new Date("2026-05-01T10:01:00.000Z")
        });

      const confirmed = await confirmResourceProposalFromInboundMessage(pool, {
        agentDraftId: proposal.agentDraftId,
        confirmationMessageId: confirmation.message.messageId,
        resourceId: "res-file-marksheet",
        registeredFileName: "marksheet.pdf",
        now: new Date("2026-05-01T10:01:05.000Z")
      });

      assert.equal(confirmed.status, "queued");
      assert.equal(confirmed.queueStatus, "inserted");
      assert.equal(await countRows(pool, "agent_outbound_jobs"), 1);
      assert.equal(
        confirmed.job.payload.confirmationMessageId,
        confirmation.message.messageId
      );
    } finally {
      await pool.end();
    }
  } finally {
    postgres.stop();
  }
});

test("WhatsApp inbound confirmation can resolve a pending file prompt after the text-reply freshness window", async () => {
  const postgres = await startDisposablePostgres({
    prefix: "viji-phase6-wa-confirm-aged"
  });

  try {
    postgres.runProjectScript("scripts/run-migrations.mjs");
    const pool = createDisposablePool(postgres.connectionString);

    try {
      const repositories = createRepositories(pool);
      const harness = await createVijayalakshmiFixtureHarness(repositories);
      const proposal = await harness.createResourceProposalDraft({
        externalMessageId: "wamid.redacted.vijayalakshmi.resource-wa-confirm-aged",
        draftBody: "[Pratiksha] Do you mean marksheet.pdf?",
        receivedAt: "2026-05-01T10:00:00.000Z"
      });
      const adapterEvent =
        await repositories.adapterEvents.insertAdapterEventIdempotent({
          channelAccountId: harness.channelAccount.channelAccountId,
          type: "message.received",
          externalEventId: "event:redacted-resource-wa-confirm-aged",
          payload: { redacted: true }
        });
      const confirmation =
        await repositories.messages.insertInboundMessageIdempotent({
          conversationId: proposal.conversationId,
          senderContactId: harness.contact.contactId,
          adapterEventId: adapterEvent.event.adapterEventId,
          externalMessageId: "wamid.redacted.vijayalakshmi.resource-wa-yes-aged",
          body: "yes",
          receivedAt: new Date("2026-05-01T10:07:00.000Z")
        });

      const confirmed = await confirmResourceProposalFromInboundMessage(pool, {
        agentDraftId: proposal.agentDraftId,
        confirmationMessageId: confirmation.message.messageId,
        resourceId: "res-file-marksheet",
        registeredFileName: "marksheet.pdf",
        now: new Date("2026-05-01T10:07:05.000Z")
      });

      assert.equal(confirmed.status, "queued");
      assert.equal(confirmed.queueStatus, "inserted");
      assert.equal(await countRows(pool, "agent_outbound_jobs"), 1);
    } finally {
      await pool.end();
    }
  } finally {
    postgres.stop();
  }
});

test("failed send records attempt and the failed job remains retryable", async () => {
  const postgres = await startDisposablePostgres({ prefix: "viji-phase6-retry" });

  try {
    postgres.runProjectScript("scripts/run-migrations.mjs");
    const pool = createDisposablePool(postgres.connectionString);

    try {
      const { draft } = await createFreshDraft(
        pool,
        "wamid.redacted.vijayalakshmi.phase6-retry"
      );
      await queuePolicyPermittedTextDraft(pool, {
        agentDraftId: draft.agentDraftId,
        now: new Date("2026-05-01T10:00:45.000Z")
      });

      const failingDispatcher = createRecordedOutboundDispatcher({
        fail: true,
        retryable: true,
        errorMessage: "Synthetic retryable send failure"
      });
      const failedDispatch = await dispatchNextOutboundJob(pool, {
        dispatcher: failingDispatcher
      });

      assert.equal(failedDispatch.status, "failed");
      assert.equal(failedDispatch.retryable, true);
      assert.equal(failedDispatch.job.state, "failed");
      assert.deepEqual(await attemptRows(pool), [
        {
          attemptNumber: 1,
          state: "failed",
          errorCode: "adapter.command_failed"
        }
      ]);

      const recoveryDispatcher = createRecordedOutboundDispatcher();
      const retryDispatch = await dispatchNextOutboundJob(pool, {
        dispatcher: recoveryDispatcher
      });

      assert.equal(retryDispatch.status, "sent");
      assert.equal(recoveryDispatcher.intents.length, 1);
      assert.deepEqual(await attemptRows(pool), [
        {
          attemptNumber: 1,
          state: "failed",
          errorCode: "adapter.command_failed"
        },
        {
          attemptNumber: 2,
          state: "succeeded",
          errorCode: null
        }
      ]);
    } finally {
      await pool.end();
    }
  } finally {
    postgres.stop();
  }
});
