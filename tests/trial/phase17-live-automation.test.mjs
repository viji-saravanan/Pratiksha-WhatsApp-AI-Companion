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
const { ERROR_CODES, callFailure, callSuccess } = await import(
  "../../packages/shared/dist/index.js"
);
const {
  createRecordedOutboundDispatcher,
  runLiveAutomationCycle
} = await import("../../apps/worker/dist/index.js");

function idleAdapter() {
  const metadata = { component: "test-whatsapp-adapter", operation: "test" };
  return {
    doctor: async () => callSuccess({}, metadata),
    authStatus: async () => callSuccess({}, metadata),
    auth: async () => callSuccess({}, metadata),
    sync: async () => callSuccess({}, metadata),
    listChats: async () => callSuccess([], metadata),
    listMessages: async () => callSuccess({ messages: [] }, metadata),
    searchMessages: async () => callSuccess({ messages: [] }, metadata),
    sendText: async () => callSuccess({ externalMessageId: "unused" }, metadata),
    sendFile: async () => callSuccess({ externalMessageId: "unused" }, metadata),
    downloadMedia: async () => callSuccess({}, metadata)
  };
}

const liveEnv = {
  VIJI_AUTO_REPLY_ENABLED: "true",
  VIJI_WACLI_LIVE_SEND_ENABLED: "true",
  VIJI_DEFAULT_REPLY_MODE: "auto",
  VIJI_LLM_PROVIDER: "deterministic",
  VIJI_TEST_LLM_MODEL: "deterministic-test-llm",
  VIJI_LIVE_SYNC_BEFORE_POLL_ENABLED: "false",
  VIJI_LIVE_AUTOMATION_BATCH_LIMIT: "10",
  VIJI_LIVE_DISPATCH_LIMIT_PER_CYCLE: "5"
};

test("Phase 17 live automation drafts, queues, dispatches, and does not duplicate", async () => {
  const postgres = await startDisposablePostgres({ prefix: "viji-phase17-live-text" });

  try {
    postgres.runProjectScript("scripts/run-migrations.mjs");
    const pool = createPgPool({ connectionString: postgres.connectionString });

    try {
      const repositories = createRepositories(pool);
      const harness = await createVijayalakshmiFixtureHarness(repositories);
      await harness.createInboundMessage({
        externalMessageId: "wamid.redacted.phase17-live-text",
        body: "Can you help me with the appointment time?",
        receivedAt: "2026-05-01T10:00:00.000Z"
      });
      const dispatcher = createRecordedOutboundDispatcher();

      const first = await runLiveAutomationCycle(pool, {
        channelAccountId: harness.channelAccount.channelAccountId,
        adapter: idleAdapter(),
        dispatcher,
        llmClient: createDeterministicTestLlmClient(),
        env: liveEnv,
        automationLimit: 10,
        dispatchLimit: 5,
        now: new Date("2026-05-01T10:01:00.000Z")
      });
      const second = await runLiveAutomationCycle(pool, {
        channelAccountId: harness.channelAccount.channelAccountId,
        adapter: idleAdapter(),
        dispatcher,
        llmClient: createDeterministicTestLlmClient(),
        env: liveEnv,
        automationLimit: 10,
        dispatchLimit: 5,
        now: new Date("2026-05-01T10:02:00.000Z")
      });

      assert.equal(first.draftsCreated, 1);
      assert.equal(first.syncStatus, "skipped");
      assert.equal(first.textJobsQueued, 1);
      assert.equal(first.jobsDispatched, 1);
      assert.equal(second.messagesConsidered, 0);
      assert.equal(dispatcher.intents.length, 1);
      assert.equal(dispatcher.intents[0].kind, "text_reply");
      assert.equal(await countRows(pool, "agent_drafts"), 1);
      assert.equal(await countRows(pool, "agent_outbound_jobs"), 1);
    } finally {
      await pool.end();
    }
  } finally {
    postgres.stop();
  }
});

test("Phase 17 live automation refreshes wacli before polling cached chats", async () => {
  const postgres = await startDisposablePostgres({ prefix: "viji-phase17-live-sync" });

  try {
    postgres.runProjectScript("scripts/run-migrations.mjs");
    const pool = createPgPool({ connectionString: postgres.connectionString });

    try {
      const repositories = createRepositories(pool);
      const harness = await createVijayalakshmiFixtureHarness(repositories);
      const calls = [];
      const metadata = { component: "test-whatsapp-adapter", operation: "test" };
      const adapter = {
        doctor: async () => callSuccess({}, metadata),
        authStatus: async () => callSuccess({}, metadata),
        auth: async () => callSuccess({}, metadata),
        sync: async (options) => {
          calls.push(["sync", options]);
          return callSuccess({ synced: true }, metadata);
        },
        listChats: async () => {
          calls.push(["listChats"]);
          return callSuccess(
            [
              {
                chatId: harness.contact.waJid,
                name: harness.contact.displayName,
                type: "dm"
              }
            ],
            metadata
          );
        },
        listMessages: async () => {
          calls.push(["listMessages"]);
          return callSuccess({ messages: [], rejected: [] }, metadata);
        },
        searchMessages: async () => callSuccess({ messages: [] }, metadata),
        sendText: async () => callSuccess({ externalMessageId: "unused" }, metadata),
        sendFile: async () => callSuccess({ externalMessageId: "unused" }, metadata),
        downloadMedia: async () => callSuccess({}, metadata)
      };

      const result = await runLiveAutomationCycle(pool, {
        channelAccountId: harness.channelAccount.channelAccountId,
        adapter,
        dispatcher: createRecordedOutboundDispatcher(),
        llmClient: createDeterministicTestLlmClient(),
        env: {
          ...liveEnv,
          VIJI_LIVE_SYNC_BEFORE_POLL_ENABLED: "true",
          VIJI_LIVE_SYNC_IDLE_EXIT: "3s",
          VIJI_LIVE_SYNC_REFRESH_CONTACTS: "true"
        },
        automationLimit: 10,
        dispatchLimit: 5,
        now: new Date("2026-05-01T10:01:00.000Z")
      });

      assert.equal(result.syncStatus, "completed");
      assert.equal(result.pollStatus, "completed");
      assert.deepEqual(
        calls.map((call) => call[0]),
        ["sync", "listChats", "listMessages"]
      );
      assert.deepEqual(calls[0][1], {
        once: true,
        idleExit: "3s",
        refreshContacts: true,
        refreshGroups: false
      });
    } finally {
      await pool.end();
    }
  } finally {
    postgres.stop();
  }
});

test("Phase 17 live automation skips stale-cache polling when live sync fails", async () => {
  const postgres = await startDisposablePostgres({ prefix: "viji-phase17-sync-failure" });

  try {
    postgres.runProjectScript("scripts/run-migrations.mjs");
    const pool = createPgPool({ connectionString: postgres.connectionString });

    try {
      const repositories = createRepositories(pool);
      const harness = await createVijayalakshmiFixtureHarness(repositories);
      const metadata = { component: "test-whatsapp-adapter", operation: "sync" };
      const adapter = {
        doctor: async () => callSuccess({}, metadata),
        authStatus: async () => callSuccess({}, metadata),
        auth: async () => callSuccess({}, metadata),
        sync: async () =>
          callFailure(ERROR_CODES.adapter.authRequired, "auth required", metadata),
        listChats: async () => {
          throw new Error("listChats must not run after sync failure");
        },
        listMessages: async () => {
          throw new Error("listMessages must not run after sync failure");
        },
        searchMessages: async () => callSuccess({ messages: [] }, metadata),
        sendText: async () => callSuccess({ externalMessageId: "unused" }, metadata),
        sendFile: async () => callSuccess({ externalMessageId: "unused" }, metadata),
        downloadMedia: async () => callSuccess({}, metadata)
      };

      const result = await runLiveAutomationCycle(pool, {
        channelAccountId: harness.channelAccount.channelAccountId,
        adapter,
        dispatcher: createRecordedOutboundDispatcher(),
        llmClient: createDeterministicTestLlmClient(),
        env: {
          ...liveEnv,
          VIJI_LIVE_SYNC_BEFORE_POLL_ENABLED: "true"
        },
        automationLimit: 10,
        dispatchLimit: 5,
        now: new Date("2026-05-01T10:01:00.000Z")
      });

      assert.equal(result.syncStatus, "failed");
      assert.equal(result.syncErrorCode, ERROR_CODES.adapter.authRequired);
      assert.equal(result.pollStatus, "sync_failed");
      assert.equal(result.messagesConsidered, 0);
      assert.equal(result.jobsDispatched, 0);
    } finally {
      await pool.end();
    }
  } finally {
    postgres.stop();
  }
});

test("Phase 17 live automation handles file suggestion and recipient list-number confirmation", async () => {
  const postgres = await startDisposablePostgres({ prefix: "viji-phase17-live-resource" });

  try {
    postgres.runProjectScript("scripts/run-migrations.mjs");
    const pool = createPgPool({ connectionString: postgres.connectionString });

    try {
      const repositories = createRepositories(pool);
      const harness = await createVijayalakshmiFixtureHarness(repositories);
      await repositories.resources.registerFileResource({
        storageUri: "/data/pratiksha/viji-files/library/viji_10_marksheet.pdf",
        checksumSha256: "a".repeat(64),
        mimeType: "application/pdf",
        sizeBytes: 1024,
        registeredFileName: "viji_10_marksheet.pdf",
        title: "Viji 10th marksheet",
        aliases: ["10th marksheet", "mark sheet"]
      });
      await repositories.resources.registerFileResource({
        storageUri: "/data/pratiksha/viji-files/library/viji_12_marksheet.pdf",
        checksumSha256: "b".repeat(64),
        mimeType: "application/pdf",
        sizeBytes: 1024,
        registeredFileName: "viji_12_marksheet.pdf",
        title: "Viji 12th marksheet",
        aliases: ["12th marksheet", "mark sheet"]
      });
      const request = await harness.createInboundMessage({
        externalMessageId: "wamid.redacted.phase17-live-resource-request",
        body: "Can you send my marksheet?",
        receivedAt: "2026-05-01T10:00:00.000Z"
      });
      const dispatcher = createRecordedOutboundDispatcher();

      const suggested = await runLiveAutomationCycle(pool, {
        channelAccountId: harness.channelAccount.channelAccountId,
        adapter: idleAdapter(),
        dispatcher,
        llmClient: createDeterministicTestLlmClient(),
        env: liveEnv,
        automationLimit: 10,
        dispatchLimit: 5,
        now: new Date("2026-05-01T10:01:00.000Z")
      });
      const adapterEvent =
        await repositories.adapterEvents.insertAdapterEventIdempotent({
          channelAccountId: harness.channelAccount.channelAccountId,
          type: "message.received",
          externalEventId: "event:wamid.redacted.phase17-live-resource-confirm",
          payload: { redacted: true }
        });
      await repositories.messages.insertInboundMessageIdempotent({
        conversationId: request.conversationId,
        senderContactId: harness.contact.contactId,
        adapterEventId: adapterEvent.event.adapterEventId,
        externalMessageId: "wamid.redacted.phase17-live-resource-confirm",
        body: "2",
        receivedAt: new Date("2026-05-01T10:01:00.000Z")
      });

      const confirmed = await runLiveAutomationCycle(pool, {
        channelAccountId: harness.channelAccount.channelAccountId,
        adapter: idleAdapter(),
        dispatcher,
        llmClient: createDeterministicTestLlmClient(),
        env: liveEnv,
        automationLimit: 10,
        dispatchLimit: 5,
        now: new Date("2026-05-01T10:02:00.000Z")
      });

      assert.equal(suggested.resourcePromptsCreated, 1);
      assert.equal(suggested.textJobsQueued, 1);
      assert.equal(suggested.jobsDispatched, 1);
      assert.equal(confirmed.confirmationsQueued, 1);
      assert.equal(confirmed.jobsDispatched, 1);
      assert.deepEqual(
        dispatcher.intents.map((intent) => intent.kind),
        ["text_reply", "resource_send"]
      );
      assert.equal(await countRows(pool, "res_resource_proposals"), 1);
      const proposalState = await pool.query(
        "SELECT res_resource_proposal_state AS state FROM res_resource_proposals"
      );
      assert.equal(proposalState.rows[0].state, "resolved");
    } finally {
      await pool.end();
    }
  } finally {
    postgres.stop();
  }
});
