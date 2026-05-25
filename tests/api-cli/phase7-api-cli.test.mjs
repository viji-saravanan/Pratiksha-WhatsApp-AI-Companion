import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  assertSuccess,
  run,
  startDisposablePostgres
} from "../helpers/disposable-postgres.mjs";
import {
  createVijayalakshmiFixtureHarness
} from "../helpers/redacted-vijayalakshmi-fixture.mjs";

const build = run("corepack", ["pnpm", "--filter", "@viji/api", "build"]);
assertSuccess(build, "build @viji/api");
const buildCli = run("corepack", ["pnpm", "--filter", "@viji/cli", "build"]);
assertSuccess(buildCli, "build @viji/cli");

const { createDeterministicTestLlmClient } = await import(
  "../../packages/ai/dist/index.js"
);
const { createPgPool, createRepositories } = await import(
  "../../packages/db/dist/index.js"
);
const {
  createRecordedOutboundDispatcher,
  dispatchNextOutboundJob,
  generateDraftForInboundMessage,
  queuePolicyPermittedTextDraft
} = await import("../../apps/worker/dist/index.js");
const { createApiServer } = await import("../../apps/api/dist/index.js");
const { runCli } = await import("../../apps/cli/dist/index.js");

const token = "phase7-test-token";

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

async function apiJson(baseUrl, path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? "GET",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...(options.headers ?? {})
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {})
  });

  return {
    status: response.status,
    body: await response.json()
  };
}

async function createFreshDraft(pool, harness, externalMessageId) {
  const inbound = await harness.createInboundMessage({
    externalMessageId
  });
  const result = await generateDraftForInboundMessage(pool, {
    triggerMessageId: inbound.messageId,
    llmClient: createDeterministicTestLlmClient(),
    now: new Date("2026-05-01T10:00:30.000Z")
  });

  assert.equal(result.status, "drafted");
  return result.draft;
}

async function readSourceTree(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const chunks = [];

  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      chunks.push(await readSourceTree(path));
    } else if (entry.isFile() && path.endsWith(".ts")) {
      chunks.push(await readFile(path, "utf8"));
    }
  }

  return chunks.join("\n");
}

test("Phase 7 source keeps CLI database-free and API payloads redacted", async () => {
  const cliSource = await readSourceTree("apps/cli/src");
  const apiSource = await readSourceTree("apps/api/src");

  assert.equal(/@viji\/db|from ["']pg["']|DATABASE_URL|createPgPool/.test(cliSource), false);
  assert.equal(/from ["']pg["']|ops_adapter_event_payload/.test(apiSource), false);
  assert.match(apiSource, /payloadKeys/);
});

test("local API and CLI expose redacted runtime operations", async () => {
  const postgres = await startDisposablePostgres({ prefix: "viji-phase7" });

  try {
    postgres.runProjectScript("scripts/run-migrations.mjs");
    const pool = createPgPool({ connectionString: postgres.connectionString });
    const dataRoot = await mkdtemp(join(tmpdir(), "viji-phase7-data-"));
    await writeFile(join(dataRoot, ".viji-helper-root"), "phase7-test\n");
    const server = createApiServer({
      db: pool,
      token,
      env: {
        ...process.env,
        VIJI_DATA_ROOT: dataRoot,
        VIJI_STORAGE_PROFILE: "large-200gb",
        VIJI_API_TOKEN: token
      }
    });

    try {
      const repositories = createRepositories(pool);
      const harness = await createVijayalakshmiFixtureHarness(repositories);
      const freshDraft = await createFreshDraft(
        pool,
        harness,
        "wamid.redacted.vijayalakshmi.phase7-fresh"
      );
      const proposal = await harness.createResourceProposalDraft({
        externalMessageId: "wamid.redacted.vijayalakshmi.phase7-resource",
        draftBody: "[Pratiksha] Do you mean phase7-marksheet.pdf?"
      });
      await harness.createInboundMessage({
        externalMessageId: "wamid.redacted.vijayalakshmi.phase7-stale",
        body: "Can you continue from earlier?",
        contextState: "stale"
      });
      const queued = await queuePolicyPermittedTextDraft(pool, {
        agentDraftId: freshDraft.agentDraftId,
        now: new Date("2026-05-01T10:01:00.000Z")
      });
      assert.equal(queued.status, "queued");
      const blockedDispatch = await dispatchNextOutboundJob(pool, {
        dispatcher: createRecordedOutboundDispatcher(),
        globalKillSwitch: true
      });
      assert.equal(blockedDispatch.status, "blocked");

      const baseUrl = await listen(server);
      const cliEnv = {
        ...process.env,
        VIJI_API_BASE_URL: baseUrl,
        VIJI_API_TOKEN: token
      };

      const unauthorized = await fetch(`${baseUrl}/status`);
      assert.equal(unauthorized.status, 401);

      const apiStatus = await apiJson(baseUrl, "/status");
      assert.equal(apiStatus.status, 200);
      assert.equal(apiStatus.body.database, "healthy");
      assert.equal(apiStatus.body.storage.state, "healthy");
      assert.equal(apiStatus.body.live.syncBeforePollEnabled, false);
      assert.equal(apiStatus.body.live.syncSchedulerEnabled, true);
      assert.equal(apiStatus.body.live.syncIntervalMs, 60_000);
      assert.equal(apiStatus.body.contextStates.stale, 1);
      assert.equal(apiStatus.body.counts.pendingConfirmations, 1);
      assert.equal(apiStatus.body.counts.blockedJobs, 1);
      assert.equal(apiStatus.body.counts.activeMediaDownloadJobs, 0);

      const cliStatus = await cliJson(["status"], cliEnv);
      assert.equal(cliStatus.database, apiStatus.body.database);
      assert.equal(cliStatus.storage.state, apiStatus.body.storage.state);
      assert.deepEqual(cliStatus.live, apiStatus.body.live);
      assert.deepEqual(cliStatus.counts, apiStatus.body.counts);
      assert.deepEqual(cliStatus.contextStates, apiStatus.body.contextStates);

      const drafts = await cliJson(["drafts"], cliEnv);
      assert.ok(drafts.drafts.some((item) => item.body.startsWith("[Pratiksha]")));

      const confirmations = await cliJson(["confirmations"], cliEnv);
      assert.equal(confirmations.confirmations.length, 1);
      assert.equal(confirmations.confirmations[0].agentDraftId, proposal.agentDraftId);
      assert.equal(confirmations.confirmations[0].policyState, "confirm_resource");

      const rejectedApiConfirm = await apiJson(
        baseUrl,
        `/confirmations/${proposal.agentDraftId}/confirm`,
        {
          method: "POST",
          body: {
            resourceId: "res-file-phase7-marksheet",
            registeredFileName: "phase7-marksheet.pdf"
          }
        }
      );
      assert.equal(rejectedApiConfirm.status, 409);
      assert.equal(
        rejectedApiConfirm.body.error.code,
        "policy.recipient_confirmation_required"
      );
      const queuedResourceJobs = await pool.query(`
        SELECT count(*)::integer AS count
        FROM agent_outbound_jobs
        WHERE agent_outbound_job_kind = 'resource_send'
      `);
      assert.equal(queuedResourceJobs.rows[0].count, 0);

      const outbox = await apiJson(baseUrl, "/outbox?state=blocked");
      assert.equal(outbox.status, 200);
      assert.equal(outbox.body.jobs.length, 1);
      assert.equal(outbox.body.jobs[0].state, "blocked");
      assert.equal("payload" in outbox.body.jobs[0], false);
      assert.deepEqual(outbox.body.jobs[0].payloadKeys, ["text"]);

      const audit = await cliJson(["audit"], cliEnv);
      assert.ok(
        audit.auditEvents.some((event) => event.type === "outbox.dispatch_blocked")
      );

      const syncStatus = await cliJson(["sync", "status"], cliEnv);
      assert.deepEqual(syncStatus.syncRuns, []);

      const mediaStatus = await cliJson(["media", "status"], cliEnv);
      assert.deepEqual(mediaStatus.mediaJobs, []);

      const storageStatus = await cliJson(["storage", "status"], cliEnv);
      assert.equal(storageStatus.storage.state, "healthy");

      const rejectedPause = captureOutput();
      assert.equal(
        await runCli(["pause"], { env: cliEnv, output: rejectedPause.output }),
        1
      );
      assert.match(rejectedPause.stderr, /--yes/);

      const paused = await cliJson(["pause", "--yes"], cliEnv);
      assert.equal(paused.policy.mode, "paused");
      assert.equal(paused.policy.affectedContacts, 1);

      const readonly = await cliJson(["readonly", "on", "--yes"], cliEnv);
      assert.equal(readonly.policy.mode, "readonly");

      const resumed = await cliJson(["resume", "--yes"], cliEnv);
      assert.equal(resumed.policy.mode, "auto");
    } finally {
      await closeServer(server);
      await pool.end();
    }
  } finally {
    postgres.stop();
  }
});

test("CLI status surfaces degraded storage without direct database access", async () => {
  const postgres = await startDisposablePostgres({ prefix: "viji-phase7-degraded" });

  try {
    postgres.runProjectScript("scripts/run-migrations.mjs");
    const pool = createPgPool({ connectionString: postgres.connectionString });
    const missingRoot = join(
      await mkdtemp(join(tmpdir(), "viji-phase7-")),
      "missing-data-root"
    );
    const server = createApiServer({
      db: pool,
      token,
      env: {
        ...process.env,
        VIJI_DATA_ROOT: missingRoot,
        VIJI_STORAGE_PROFILE: "large-200gb",
        VIJI_API_TOKEN: token
      }
    });

    try {
      const baseUrl = await listen(server);
      const status = await cliJson(["status"], {
        ...process.env,
        VIJI_API_BASE_URL: baseUrl,
        VIJI_API_TOKEN: token
      });

      assert.equal(status.database, "healthy");
      assert.equal(status.storage.state, "missing");
    } finally {
      await closeServer(server);
      await pool.end();
    }
  } finally {
    postgres.stop();
  }
});
