import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

for (const target of ["@viji/api", "@viji/cli", "@viji/worker"]) {
  const build = run("corepack", ["pnpm", "--filter", target, "build"]);
  assertSuccess(build, `build ${target}`);
}

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
  dispatchNextMediaDownloadJob,
  dispatchNextOutboundJob,
  generateDraftForInboundMessage,
  queuePolicyPermittedTextDraft,
  runLiveAllowlistPoll
} = await import("../../apps/worker/dist/index.js");
const { createApiServer } = await import("../../apps/api/dist/index.js");
const { runCli } = await import("../../apps/cli/dist/index.js");

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

async function cliJson(argv, env) {
  const captured = captureOutput();
  const exitCode = await runCli([...argv, "--json"], {
    env,
    output: captured.output
  });

  assert.equal(exitCode, 0, captured.stderr);
  return JSON.parse(captured.stdout);
}

function unavailableDb() {
  return {
    async query() {
      throw new Error("synthetic database unavailable");
    }
  };
}

async function createQueuedTextReply(pool, externalMessageId, existing = {}) {
  const repositories = existing.repositories ?? createRepositories(pool);
  const harness =
    existing.harness ?? (await createVijayalakshmiFixtureHarness(repositories));
  const inbound = await harness.createInboundMessage({
    externalMessageId
  });
  const draftResult = await generateDraftForInboundMessage(pool, {
    triggerMessageId: inbound.messageId,
    llmClient: createDeterministicTestLlmClient(),
    now: new Date("2026-05-01T10:00:30.000Z")
  });

  assert.equal(draftResult.status, "drafted");
  const queued = await queuePolicyPermittedTextDraft(pool, {
    agentDraftId: draftResult.draft.agentDraftId,
    now: new Date("2026-05-01T10:00:40.000Z")
  });
  assert.equal(queued.status, "queued");

  return { repositories, harness, inbound, draft: draftResult.draft };
}

test("Phase 16 API and CLI show degraded status when Postgres is unavailable", async () => {
  const missingRoot = join(
    await mkdtemp(join(tmpdir(), "viji-phase16-missing-root-")),
    "missing"
  );
  const token = "phase16-status-token";
  const api = createApiServer({
    db: unavailableDb(),
    token,
    env: {
      ...process.env,
      VIJI_DATA_ROOT: missingRoot,
      VIJI_STORAGE_PROFILE: "large-200gb",
      VIJI_API_TOKEN: token
    }
  });

  try {
    const baseUrl = await listen(api);
    const statusResponse = await fetch(`${baseUrl}/status`, {
      headers: {
        authorization: `Bearer ${token}`
      }
    });
    assert.equal(statusResponse.status, 200);
    const status = await statusResponse.json();
    assert.equal(status.database, "unavailable");
    assert.equal(status.storage.state, "missing");
    assert.equal(status.degraded, true);
    assert.deepEqual(status.degradedReasons, ["database_unavailable"]);

    const cliStatus = await cliJson(["status"], {
      ...process.env,
      VIJI_API_BASE_URL: baseUrl,
      VIJI_API_TOKEN: token
    });
    assert.equal(cliStatus.database, "unavailable");
    assert.equal(cliStatus.storage.state, "missing");

    const metrics = await fetch(`${baseUrl}/metrics`);
    assert.equal(metrics.status, 200);
    const metricsText = await metrics.text();
    assert.match(metricsText, /viji_database_health\{state="unavailable"\} 1/);
    assert.match(metricsText, /viji_storage_state\{state="missing"\} 1/);
  } finally {
    await closeServer(api);
  }
});

test("Phase 16 outbound dispatch blocks failures before adapter send", async () => {
  const postgres = await startDisposablePostgres({ prefix: "viji-phase16-outbox" });

  try {
    postgres.runProjectScript("scripts/run-migrations.mjs");
    const pool = createPgPool({ connectionString: postgres.connectionString });

    try {
      const failureCases = [
        {
          externalMessageId: "wamid.redacted.vijayalakshmi.phase16-storage",
          health: { storage: "full" },
          expectedCode: ERROR_CODES.storage.writeUnavailable
        },
        {
          externalMessageId: "wamid.redacted.vijayalakshmi.phase16-database",
          health: { database: "unavailable" },
          expectedCode: ERROR_CODES.database.unavailable
        },
        {
          externalMessageId: "wamid.redacted.vijayalakshmi.phase16-adapter",
          health: { adapter: "degraded" },
          expectedCode: ERROR_CODES.adapter.networkUnavailable
        },
        {
          externalMessageId: "wamid.redacted.vijayalakshmi.phase16-model",
          health: { model: "unavailable" },
          expectedCode: ERROR_CODES.ai.modelUnavailable
        }
      ];

      const repositories = createRepositories(pool);
      const harness = await createVijayalakshmiFixtureHarness(repositories);

      for (const item of failureCases) {
        await createQueuedTextReply(pool, item.externalMessageId, {
          repositories,
          harness
        });
        const dispatcher = createRecordedOutboundDispatcher();
        const result = await dispatchNextOutboundJob(pool, {
          dispatcher,
          health: item.health
        });

        assert.equal(result.status, "blocked");
        assert.equal(result.policyDecision.code, item.expectedCode);
        assert.equal(dispatcher.intents.length, 0);
      }

      assert.equal(await countRows(pool, "agent_send_attempts"), 0);
      const blockedJobs = await pool.query(`
        SELECT count(*)::integer AS count
        FROM agent_outbound_jobs
        WHERE agent_outbound_job_state = 'blocked'
      `);
      assert.equal(blockedJobs.rows[0].count, failureCases.length);
      const sentJobs = await pool.query(`
        SELECT count(*)::integer AS count
        FROM agent_outbound_jobs
        WHERE agent_outbound_job_state = 'sent'
      `);
      assert.equal(sentJobs.rows[0].count, 0);
    } finally {
      await pool.end();
    }
  } finally {
    postgres.stop();
  }
});

test("Phase 16 LLM failure and model health blocks create no outbound jobs", async () => {
  const postgres = await startDisposablePostgres({ prefix: "viji-phase16-llm" });

  try {
    postgres.runProjectScript("scripts/run-migrations.mjs");
    const pool = createPgPool({ connectionString: postgres.connectionString });

    try {
      const repositories = createRepositories(pool);
      const harness = await createVijayalakshmiFixtureHarness(repositories);
      const blockedMessage = await harness.createInboundMessage({
        externalMessageId: "wamid.redacted.vijayalakshmi.phase16-model-block"
      });
      const modelBlocked = await generateDraftForInboundMessage(pool, {
        triggerMessageId: blockedMessage.messageId,
        llmClient: createDeterministicTestLlmClient(),
        health: { model: "unavailable" },
        now: new Date("2026-05-01T10:00:30.000Z")
      });
      assert.equal(modelBlocked.status, "blocked");
      assert.equal(modelBlocked.policyDecision.code, ERROR_CODES.ai.modelUnavailable);

      const failedMessage = await harness.createInboundMessage({
        externalMessageId: "wamid.redacted.vijayalakshmi.phase16-llm-fail"
      });
      const failed = await generateDraftForInboundMessage(pool, {
        triggerMessageId: failedMessage.messageId,
        llmClient: {
          async generateDraft() {
            throw new Error("synthetic LLM unavailable");
          }
        },
        now: new Date("2026-05-01T10:01:30.000Z")
      });
      assert.equal(failed.status, "failed");

      assert.equal(await countRows(pool, "agent_outbound_jobs"), 0);
      assert.equal(await countRows(pool, "agent_drafts"), 0);
      const auditRows = await pool.query(`
        SELECT ops_audit_event_type AS type
        FROM ops_audit_events
        ORDER BY ops_audit_event_created_at ASC
      `);
      assert.deepEqual(
        auditRows.rows.map((row) => row.type),
        ["agent.run_blocked", "agent.run_failed"]
      );
    } finally {
      await pool.end();
    }
  } finally {
    postgres.stop();
  }
});

test("Phase 16 live polling adapter failures do not import messages or dispatch replies", async () => {
  const postgres = await startDisposablePostgres({ prefix: "viji-phase16-live" });

  try {
    postgres.runProjectScript("scripts/run-migrations.mjs");
    const pool = createPgPool({ connectionString: postgres.connectionString });

    try {
      const repositories = createRepositories(pool);
      const person = await repositories.contacts.createPerson({
        displayName: "Vijayalakshmi Saravanan",
        notes: "Synthetic Phase 16 live failure person"
      });
      await repositories.contacts.createAllowlistedContact({
        ownerPersonId: person.personId,
        displayName: "Vijayalakshmi Saravanan",
        phoneE164: "+10000000000",
        trustLevel: "trusted"
      });
      const channelAccount =
        await repositories.channelAccounts.createChannelAccount({
          label: "Phase 16 live failure account",
          storePath: "/Volumes/Arya 1TB/VijiAI/wacli/store",
          state: "auth_required"
        });

      const authRequiredPoll = await runLiveAllowlistPoll(pool, {
        channelAccountId: channelAccount.channelAccountId,
        adapter: {
          async listChats() {
            return callFailure(
              ERROR_CODES.adapter.authRequired,
              "synthetic auth required",
              { component: "phase16", operation: "chats.list" }
            );
          }
        },
        messageLimit: 5
      });

      assert.equal(authRequiredPoll.status, "failed");
      assert.equal(authRequiredPoll.contacts[0].errorCode, ERROR_CODES.adapter.authRequired);
      assert.equal(await countRows(pool, "msg_messages"), 0);
      assert.equal(await countRows(pool, "agent_outbound_jobs"), 0);

      const broadPoll = await runLiveAllowlistPoll(pool, {
        channelAccountId: channelAccount.channelAccountId,
        adapter: {
          async listChats() {
            return callSuccess(
              [
                { chatId: "11111111111@s.whatsapp.net", name: "Unrelated", type: "dm" },
                { chatId: "22222222222@s.whatsapp.net", name: "Another", type: "dm" }
              ],
              { component: "phase16", operation: "chats.list" }
            );
          },
          async listMessages() {
            throw new Error("listMessages should not run for ambiguous chats");
          }
        },
        messageLimit: 5
      });
      assert.equal(broadPoll.status, "completed");
      assert.equal(broadPoll.contacts[0].status, "skipped");
      assert.equal(broadPoll.contacts[0].reason, "no_matching_chat");
      assert.equal(await countRows(pool, "msg_messages"), 0);
    } finally {
      await pool.end();
    }
  } finally {
    postgres.stop();
  }
});

test("Phase 16 media download failures and storage blocks do not produce resources", async () => {
  const postgres = await startDisposablePostgres({ prefix: "viji-phase16-media" });

  try {
    postgres.runProjectScript("scripts/run-migrations.mjs");
    const pool = createPgPool({ connectionString: postgres.connectionString });

    try {
      const { repositories, inbound } = await createQueuedTextReply(
        pool,
        "wamid.redacted.vijayalakshmi.phase16-media-base"
      );
      const media = await repositories.messages.addMessageMedia({
        messageId: inbound.messageId,
        externalMediaId: "wamid.redacted.vijayalakshmi.phase16.media",
        mimeType: "image/jpeg",
        fileName: "phase16-media.jpg",
        sizeBytes: 100,
        downloadState: "queued"
      });
      await repositories.mediaJobs.createMediaDownloadJobIdempotent({
        messageMediaId: media.messageMediaId,
        conversationId: inbound.conversationId
      });

      const blocked = await dispatchNextMediaDownloadJob(pool, {
        adapter: {
          async downloadMedia() {
            throw new Error("downloadMedia should not run when storage is critical");
          }
        },
        storageStateOverride: "critical"
      });
      assert.equal(blocked.status, "blocked");
      assert.equal(blocked.reason, "storage_critical");

      const secondMedia = await repositories.messages.addMessageMedia({
        messageId: inbound.messageId,
        externalMediaId: "wamid.redacted.vijayalakshmi.phase16.media.fail",
        mimeType: "image/jpeg",
        fileName: "phase16-media-fail.jpg",
        sizeBytes: 100,
        downloadState: "queued"
      });
      await repositories.mediaJobs.createMediaDownloadJobIdempotent({
        messageMediaId: secondMedia.messageMediaId,
        conversationId: inbound.conversationId
      });
      const failed = await dispatchNextMediaDownloadJob(pool, {
        adapter: {
          async downloadMedia() {
            return callFailure(
              ERROR_CODES.adapter.commandFailed,
              "synthetic media failure",
              { component: "phase16", operation: "media.download" }
            );
          }
        },
        storageStateOverride: "healthy"
      });
      assert.equal(failed.status, "failed");
      assert.equal(failed.errorCode, ERROR_CODES.adapter.commandFailed);

      assert.equal(await countRows(pool, "res_resources"), 0);
      const downloaded = await pool.query(`
        SELECT count(*)::integer AS count
        FROM msg_message_media
        WHERE msg_message_media_download_state = 'downloaded'
      `);
      assert.equal(downloaded.rows[0].count, 0);
    } finally {
      await pool.end();
    }
  } finally {
    postgres.stop();
  }
});
