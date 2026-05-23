#!/usr/bin/env node
import "./lib/load-env.mjs";

import { createLlmClientFromEnv } from "../packages/ai/dist/index.js";
import { createPgPool } from "../packages/db/dist/index.js";
import { createJsonLogger } from "../packages/shared/dist/index.js";
import { createWacliClient } from "../apps/wa-adapter-wacli/dist/index.js";
import {
  createWacliOutboundDispatcher,
  runLiveAutomationCycle
} from "../apps/worker/dist/index.js";
import { resolveLiveWorkerStorageGate } from "./lib/live-worker-runtime.mjs";

const logger = createJsonLogger("live-worker");
const channelAccountId =
  process.env.VIJI_DEFAULT_CHANNEL_ACCOUNT_ID ||
  "00000000-0000-4000-8000-000000000003";
const pollIntervalMs = positiveInteger(
  process.env.VIJI_LIVE_POLL_INTERVAL_MS,
  1000
);

let stopping = false;
process.on("SIGTERM", () => {
  stopping = true;
});
process.on("SIGINT", () => {
  stopping = true;
});

const pool = createPgPool();
const adapter = createWacliClient();
const dispatcher = createWacliOutboundDispatcher(pool, adapter);
const llmClient = createLlmClientFromEnv();

logger.info("live_worker.started", {
  channelAccountId: "[redacted-id]",
  pollIntervalMs,
  autoReplyEnabled: process.env.VIJI_AUTO_REPLY_ENABLED === "true",
  liveSendEnabled: process.env.VIJI_WACLI_LIVE_SEND_ENABLED === "true"
});

try {
  while (!stopping) {
    const startedAt = Date.now();
    try {
      const storage = resolveLiveWorkerStorageGate(process.env);
      if (!storage.available) {
        logger.warn("live_worker.storage_unavailable", {
          dataRootAvailable: storage.dataRootAvailable,
          sentinelAvailable: storage.sentinelAvailable
        });
        await sleep(pollIntervalMs);
        continue;
      }

      await runLiveAutomationCycle(pool, {
        channelAccountId,
        adapter,
        dispatcher,
        llmClient,
        logger,
        contactLimit: positiveInteger(process.env.VIJI_LIVE_INGEST_CONTACT_LIMIT, 100),
        chatSearchLimit: positiveInteger(
          process.env.VIJI_LIVE_INGEST_CHAT_SEARCH_LIMIT,
          5
        ),
        messageLimit: positiveInteger(process.env.VIJI_LIVE_INGEST_MESSAGE_LIMIT, 25)
      });
    } catch (error) {
      logger.error("live_worker.cycle_failed", error);
    }

    const remaining = Math.max(250, pollIntervalMs - (Date.now() - startedAt));
    await sleep(remaining);
  }
} finally {
  logger.info("live_worker.stopping");
  await pool.end();
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
