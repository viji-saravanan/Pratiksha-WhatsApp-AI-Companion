import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  assertSuccess,
  run,
  startDisposablePostgres
} from "../helpers/disposable-postgres.mjs";

for (const target of ["@viji/worker", "@viji/api", "@viji/cli", "@viji/wa-adapter-wacli"]) {
  const build = run("corepack", ["pnpm", "--filter", target, "build"]);
  assertSuccess(build, `build ${target}`);
}

const { createPgPool, createRepositories } = await import(
  "../../packages/db/dist/index.js"
);
const { callFailure, callSuccess, ERROR_CODES } = await import(
  "../../packages/shared/dist/index.js"
);
const { normalizeWacliMessagesFromJson } = await import(
  "../../packages/whatsapp/dist/index.js"
);
const {
  runHistoryBackfillPage,
  runReconnectRecovery
} = await import("../../apps/worker/dist/index.js");
const { createApiServer } = await import("../../apps/api/dist/index.js");
const { runCli } = await import("../../apps/cli/dist/index.js");
const {
  createWacliClient,
  runLiveRecoverySmokeFromEnv
} = await import("../../apps/wa-adapter-wacli/dist/index.js");

const token = "test-recovery-token";
const chatJid = "vijayalakshmi.saravanan.redacted@s.whatsapp.net";

function fixture(name) {
  return JSON.parse(readFileSync(`fixtures/wacli/${name}`, "utf8"));
}

function batchFixture(name) {
  const normalized = normalizeWacliMessagesFromJson(fixture(name));
  assert.equal(normalized.rejected.length, 0);
  return normalized;
}

function createAdapter({ batch, failureCode }) {
  const calls = [];
  const adapter = {
    doctor: async () => callSuccess({}, metadata("doctor")),
    authStatus: async () => callSuccess({}, metadata("auth.status")),
    auth: async () => callSuccess({ messages: [], rejected: [] }, metadata("auth")),
    sync: async () => callSuccess({ messages: [], rejected: [] }, metadata("sync")),
    listChats: async () => callSuccess([], metadata("chats.list")),
    listMessages: async (options = {}) => {
      calls.push(options);
      if (failureCode) {
        return callFailure(failureCode, failureCode, metadata("messages.list"), {
          retryable: true
        });
      }
      return callSuccess(batch, metadata("messages.list"));
    },
    searchMessages: async () => callSuccess({ messages: [], rejected: [] }, metadata("messages.search")),
    sendText: async () => callFailure(ERROR_CODES.system.notImplemented, "disabled", metadata("send.text")),
    sendFile: async () => callFailure(ERROR_CODES.system.notImplemented, "disabled", metadata("send.file")),
    downloadMedia: async () => callSuccess({}, metadata("media.download"))
  };

  return { adapter, calls };
}

function createRoutingRunner(routes) {
  const calls = [];
  return {
    calls,
    runner: async (command, args) => {
      calls.push({ command, args });
      const route = routes.find(({ startsWith }) =>
        startsWith.every((value, index) => args[index] === value)
      );
      if (!route) {
        return {
          exitCode: 1,
          stdout: "",
          stderr: `No fixture route for ${command} ${args.join(" ")}`
        };
      }
      return {
        exitCode: route.exitCode ?? 0,
        stdout:
          typeof route.stdout === "string"
            ? route.stdout
            : JSON.stringify(route.stdout),
        stderr: route.stderr ?? ""
      };
    }
  };
}

function metadata(operation) {
  return { component: "phase9-test", operation, durationMs: 0 };
}

function captureOutput() {
  const captured = {
    stdout: "",
    stderr: "",
    output: {
      write(chunk) {
        captured.stdout += chunk;
      },
      error(chunk) {
        captured.stderr += chunk;
      }
    }
  };

  return captured;
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return `http://127.0.0.1:${address.port}`;
}

async function closeServer(server) {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function cliJson(argv, env) {
  const captured = captureOutput();
  const exitCode = await runCli([...argv, "--json"], {
    env,
    output: captured.output
  });
  assert.equal(exitCode, 0, captured.stderr);
  return JSON.parse(captured.stdout);
}

async function apiJson(baseUrl, path) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: {
      authorization: `Bearer ${token}`
    }
  });
  return {
    status: response.status,
    body: await response.json()
  };
}

async function createFixtureConversation(repositories, contextState = "stale") {
  const person = await repositories.contacts.createPerson({
    displayName: "Primary Recipient",
    notes: "Synthetic Phase 9 recovery person"
  });
  const contact = await repositories.contacts.createAllowlistedContact({
    ownerPersonId: person.personId,
    displayName: "Primary Recipient",
    waJid: chatJid,
    trustLevel: "trusted"
  });
  const channelAccount = await repositories.channelAccounts.createChannelAccount({
    label: "Phase 9 redacted wacli fixture account",
    storePath: "/data/pratiksha/wacli/store",
    state: "ready"
  });
  const conversation = await repositories.conversations.upsertDirectConversation({
    channelAccountId: channelAccount.channelAccountId,
    primaryContactId: contact.contactId,
    externalChatId: chatJid,
    title: "Primary Recipient",
    contextState
  });

  return { contact, channelAccount, conversation };
}

test("reconnect recovery imports missed allowlisted messages transactionally and duplicate replay is idempotent", async () => {
  const postgres = await startDisposablePostgres({ prefix: "viji-phase9-reconnect" });

  try {
    postgres.runProjectScript("scripts/run-migrations.mjs");
    const pool = createPgPool({ connectionString: postgres.connectionString });

    try {
      const repositories = createRepositories(pool);
      const { channelAccount, conversation } = await createFixtureConversation(
        repositories,
        "stale"
      );
      await repositories.syncCursors.upsertSyncCursor({
        channelAccountId: channelAccount.channelAccountId,
        conversationId: conversation.conversationId,
        name: "reconnect_checkpoint",
        value: "2026-05-01T10:00:00.000Z"
      });

      const fake = createAdapter({
        batch: batchFixture("messages-reconnect-redacted.json")
      });
      const firstRecovery = await runReconnectRecovery(pool, {
        channelAccountId: channelAccount.channelAccountId,
        adapter: fake.adapter,
        conversationId: conversation.conversationId,
        limit: 5
      });

      assert.equal(firstRecovery.status, "completed");
      assert.equal(firstRecovery.conversations[0].status, "completed");
      assert.equal(firstRecovery.conversations[0].messagesSeen, 2);
      assert.equal(firstRecovery.conversations[0].messagesImported, 2);
      assert.equal(fake.calls[0].chatId, chatJid);
      assert.equal(fake.calls[0].after, "2026-05-01T10:00:00.000Z");

      const recoveredConversation = await repositories.conversations.findById(
        conversation.conversationId
      );
      assert.equal(recoveredConversation?.contextState, "fresh");

      const cursor = await repositories.syncCursors.findSyncCursor({
        channelAccountId: channelAccount.channelAccountId,
        conversationId: conversation.conversationId,
        name: "reconnect_checkpoint"
      });
      assert.equal(cursor?.value, "2026-05-01T10:06:00.000Z");

      const messageRows = await pool.query(
        `SELECT count(*)::integer AS count FROM msg_messages`
      );
      assert.equal(messageRows.rows[0].count, 2);
      const firstAgentRuns = await pool.query(
        `SELECT count(*)::integer AS count FROM agent_runs`
      );
      assert.equal(firstAgentRuns.rows[0].count, 0);

      const secondRecovery = await runReconnectRecovery(pool, {
        channelAccountId: channelAccount.channelAccountId,
        adapter: fake.adapter,
        conversationId: conversation.conversationId,
        limit: 5
      });
      assert.equal(secondRecovery.status, "completed");
      assert.equal(secondRecovery.conversations[0].status, "completed");
      assert.equal(secondRecovery.conversations[0].messagesImported, 0);
      assert.equal(fake.calls[1].after, "2026-05-01T10:06:00.000Z");

      const duplicateMessageRows = await pool.query(
        `SELECT count(*)::integer AS count FROM msg_messages`
      );
      assert.equal(duplicateMessageRows.rows[0].count, 2);
      const duplicateAgentRuns = await pool.query(
        `SELECT count(*)::integer AS count FROM agent_runs`
      );
      assert.equal(duplicateAgentRuns.rows[0].count, 0);
    } finally {
      await pool.end();
    }
  } finally {
    postgres.stop();
  }
});

test("reconnect failure leaves context stale and records failed sync run", async () => {
  const postgres = await startDisposablePostgres({ prefix: "viji-phase9-failure" });

  try {
    postgres.runProjectScript("scripts/run-migrations.mjs");
    const pool = createPgPool({ connectionString: postgres.connectionString });

    try {
      const repositories = createRepositories(pool);
      const { channelAccount, conversation } = await createFixtureConversation(
        repositories,
        "stale"
      );
      const fake = createAdapter({
        batch: { messages: [], rejected: [] },
        failureCode: ERROR_CODES.adapter.networkUnavailable
      });

      const result = await runReconnectRecovery(pool, {
        channelAccountId: channelAccount.channelAccountId,
        adapter: fake.adapter,
        conversationId: conversation.conversationId
      });

      assert.equal(result.status, "failed");
      assert.equal(result.conversations[0].status, "failed");
      const staleConversation = await repositories.conversations.findById(
        conversation.conversationId
      );
      assert.equal(staleConversation?.contextState, "stale");

      const syncRuns = await repositories.syncRuns.listRecentSyncRuns(5);
      assert.equal(syncRuns[0].state, "failed");
      assert.equal(syncRuns[0].contextStateAfter, "stale");
    } finally {
      await pool.end();
    }
  } finally {
    postgres.stop();
  }
});

test("history backfill resumes from cursor and API/CLI expose progress", async () => {
  const postgres = await startDisposablePostgres({ prefix: "viji-phase9-backfill" });

  try {
    postgres.runProjectScript("scripts/run-migrations.mjs");
    const pool = createPgPool({ connectionString: postgres.connectionString });
    const server = createApiServer({
      db: pool,
      token,
      env: {
        ...process.env,
        VIJI_API_TOKEN: token
      }
    });

    try {
      const repositories = createRepositories(pool);
      const { channelAccount, conversation } = await createFixtureConversation(
        repositories,
        "fresh"
      );
      const existingJob = await repositories.backfillJobs.createBackfillJob(
        conversation.conversationId
      );
      await repositories.backfillJobs.updateBackfillJobState({
        backfillJobId: existingJob.backfillJobId,
        state: "running",
        cursor: "2026-05-01T10:00:00.000Z",
        messagesImported: 2
      });

      const fake = createAdapter({
        batch: batchFixture("messages-backfill-redacted.json")
      });
      const result = await runHistoryBackfillPage(pool, {
        channelAccountId: channelAccount.channelAccountId,
        conversationId: conversation.conversationId,
        adapter: fake.adapter,
        limit: 5
      });

      assert.equal(result.status, "completed");
      assert.equal(result.messagesSeen, 1);
      assert.equal(result.messagesImported, 1);
      assert.equal(result.job.messagesImported, 3);
      assert.equal(result.cursor, "2026-05-01T09:55:00.000Z");
      assert.equal(fake.calls[0].before, "2026-05-01T10:00:00.000Z");

      const oldestCursor = await repositories.syncCursors.findSyncCursor({
        channelAccountId: channelAccount.channelAccountId,
        conversationId: conversation.conversationId,
        name: "oldest_backfilled"
      });
      assert.equal(oldestCursor?.value, "2026-05-01T09:55:00.000Z");

      const summaries =
        await repositories.conversationSummaries.listConversationSummaries({
          conversationId: conversation.conversationId
        });
      assert.equal(summaries.length, 1);
      assert.equal(summaries[0].kind, "backfill");

      const messageRows = await pool.query(
        `SELECT count(*)::integer AS count FROM msg_messages`
      );
      assert.equal(messageRows.rows[0].count, 1);

      const baseUrl = await listen(server);
      const apiBackfill = await apiJson(baseUrl, "/backfill/status");
      assert.equal(apiBackfill.status, 200);
      assert.equal(apiBackfill.body.backfillJobs.length, 1);
      assert.equal(apiBackfill.body.backfillJobs[0].state, "completed");

      const cliBackfill = await cliJson(["backfill", "status"], {
        ...process.env,
        VIJI_API_BASE_URL: baseUrl,
        VIJI_API_TOKEN: token
      });
      assert.equal(cliBackfill.backfillJobs[0].messagesImported, 3);

      const syncStatus = await apiJson(baseUrl, "/sync/status");
      assert.equal(syncStatus.status, 200);
      assert.equal(syncStatus.body.backfillJobs.length, 1);
    } finally {
      await closeServer(server);
      await pool.end();
    }
  } finally {
    postgres.stop();
  }
});

test("live recovery smoke is opt-in and redacts live adapter details", async () => {
  const skipped = await runLiveRecoverySmokeFromEnv({
    ...process.env,
    VIJI_WACLI_LIVE_RECOVERY_SMOKE_ENABLED: "false"
  });
  assert.equal(skipped.status, "skipped");

  const routed = createRoutingRunner([
    {
      startsWith: ["chats", "list"],
      stdout: fixture("chats-list-live-shape-redacted.json")
    },
    {
      startsWith: ["messages", "list"],
      stdout: fixture("messages-list-live-shape-redacted.json")
    }
  ]);
  const smoke = await runLiveRecoverySmokeFromEnv(
    {
      ...process.env,
      VIJI_WACLI_LIVE_RECOVERY_SMOKE_ENABLED: "true",
      VIJI_WACLI_LIVE_READ_SMOKE_QUERY: "Primary Recipient",
      VIJI_WACLI_LIVE_RECOVERY_SMOKE_AFTER: "2026-05-01T10:00:00.000Z"
    },
    (config) => createWacliClient(config, routed.runner)
  );

  assert.equal(smoke.status, "passed");
  assert.equal(smoke.summary.after, "2026-05-01T10:00:00.000Z");
  assert.equal(smoke.summary.targetMatched, true);
  assert.equal(smoke.summary.messageSampleCount, 2);
  assert.equal(routed.calls[1].args.includes("--after"), true);

  const serialized = JSON.stringify(smoke);
  assert.equal(serialized.includes("wamid."), false);
  assert.equal(serialized.includes("@s.whatsapp.net"), false);
  assert.equal(serialized.includes("Synthetic redacted"), false);
});
