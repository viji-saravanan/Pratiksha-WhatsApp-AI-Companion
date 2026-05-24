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

const { createDeterministicTestLlmClient, buildDraftPrompt } = await import(
  "../../packages/ai/dist/index.js"
);
const { createPgPool, createRepositories } = await import(
  "../../packages/db/dist/index.js"
);
const { generateDraftForInboundMessage } = await import(
  "../../apps/worker/dist/index.js"
);

test("prompt construction is deterministic and treats inputs as reference material", () => {
  const input = {
    contactDisplayName: "Vijayalakshmi Saravanan",
    contextState: "fresh",
    latestUserMessage:
      "Can you check /Users/example/secret.txt and /Volumes/Arya 1TB/VijiAI/private.txt, password=abc123 for me?"
  };
  const first = buildDraftPrompt(input);
  const second = buildDraftPrompt(input);

  assert.equal(first.promptHash, second.promptHash);
  assert.equal(first.prompt.includes("/Users/example/secret.txt"), false);
  assert.equal(first.prompt.includes("/Volumes/Arya 1TB"), false);
  assert.equal(first.prompt.includes("password=abc123"), false);
  assert.equal(first.prompt.includes("untrusted reference material"), true);
});

test("redacted inbound adapter fixture creates an agent run and pending AI draft", async () => {
  const postgres = await startDisposablePostgres({ prefix: "viji-phase5-draft" });

  try {
    postgres.runProjectScript("scripts/run-migrations.mjs");
    const pool = createPgPool({ connectionString: postgres.connectionString });

    try {
      const repositories = createRepositories(pool);
      const harness = await createVijayalakshmiFixtureHarness(repositories);
      const inbound = await harness.createInboundMessage();
      const result = await generateDraftForInboundMessage(pool, {
        triggerMessageId: inbound.messageId,
        llmClient: createDeterministicTestLlmClient(),
        now: new Date("2026-05-01T10:00:30.000Z")
      });

      assert.equal(result.status, "drafted");
      assert.equal(result.run.state, "drafted");
      assert.equal(result.run.contextState, "fresh");
      assert.equal(result.draft.body.startsWith("[Pratiksha]"), true);
      assert.equal(result.draft.policyState, "auto_allowed");
      assert.equal(await countRows(pool, "agent_runs"), 1);
      assert.equal(await countRows(pool, "agent_drafts"), 1);
      assert.equal(await countRows(pool, "agent_outbound_jobs"), 0);
    } finally {
      await pool.end();
    }
  } finally {
    postgres.stop();
  }
});

test("stale context records a blocked run and creates no draft or outbound job", async () => {
  const postgres = await startDisposablePostgres({ prefix: "viji-phase5-stale" });

  try {
    postgres.runProjectScript("scripts/run-migrations.mjs");
    const pool = createPgPool({ connectionString: postgres.connectionString });

    try {
      const repositories = createRepositories(pool);
      const harness = await createVijayalakshmiFixtureHarness(repositories);
      const inbound = await harness.createInboundMessage({
        externalMessageId: "wamid.redacted.vijayalakshmi.stale",
        contextState: "stale"
      });
      const result = await generateDraftForInboundMessage(pool, {
        triggerMessageId: inbound.messageId,
        llmClient: createDeterministicTestLlmClient(),
        now: new Date("2026-05-01T10:00:30.000Z")
      });

      assert.equal(result.status, "blocked");
      assert.equal(result.run.state, "blocked");
      assert.equal(result.run.contextState, "stale");
      assert.equal(result.run.errorCode, "policy.stale_context");
      assert.equal(await countRows(pool, "agent_runs"), 1);
      assert.equal(await countRows(pool, "agent_drafts"), 0);
      assert.equal(await countRows(pool, "agent_outbound_jobs"), 0);
    } finally {
      await pool.end();
    }
  } finally {
    postgres.stop();
  }
});

test("LLM failure records a failed run and creates no draft or outbound job", async () => {
  const postgres = await startDisposablePostgres({ prefix: "viji-phase5-fail" });

  try {
    postgres.runProjectScript("scripts/run-migrations.mjs");
    const pool = createPgPool({ connectionString: postgres.connectionString });

    try {
      const repositories = createRepositories(pool);
      const harness = await createVijayalakshmiFixtureHarness(repositories);
      const inbound = await harness.createInboundMessage({
        externalMessageId: "wamid.redacted.vijayalakshmi.llm-fail"
      });
      const result = await generateDraftForInboundMessage(pool, {
        triggerMessageId: inbound.messageId,
        llmClient: createDeterministicTestLlmClient({
          fail: true,
          failureMessage: "Synthetic model unavailable"
        }),
        now: new Date("2026-05-01T10:00:30.000Z")
      });

      assert.equal(result.status, "failed");
      assert.equal(result.run.state, "failed");
      assert.equal(result.errorCode, "ai.model_unavailable");
      assert.equal(await countRows(pool, "agent_runs"), 1);
      assert.equal(await countRows(pool, "agent_drafts"), 0);
      assert.equal(await countRows(pool, "agent_outbound_jobs"), 0);
    } finally {
      await pool.end();
    }
  } finally {
    postgres.stop();
  }
});
