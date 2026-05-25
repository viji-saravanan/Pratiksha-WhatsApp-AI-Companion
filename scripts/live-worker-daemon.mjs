#!/usr/bin/env node
import "./lib/load-env.mjs";

import { createLlmClientFromEnv } from "../packages/ai/dist/index.js";
import { createPgPool } from "../packages/db/dist/index.js";
import { createJsonLogger } from "../packages/shared/dist/index.js";
import { createWacliClient } from "../apps/wa-adapter-wacli/dist/index.js";
import {
  createLiveSyncScheduler,
  createWacliOutboundDispatcher,
  drainAudioTranscriptionQueue,
  drainMediaDownloadQueue,
  getAudioTranscriptionDrainConfigFromEnv,
  getMediaDrainConfigFromEnv,
  getLiveSyncSchedulerConfigFromEnv,
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
const syncScheduler = createLiveSyncScheduler(
  getLiveSyncSchedulerConfigFromEnv(process.env)
);
const mediaDrainConfig = getMediaDrainConfigFromEnv(process.env);
const audioTranscriptionConfig =
  getAudioTranscriptionDrainConfigFromEnv(process.env);

logger.info("live_worker.started", {
  channelAccountId: "[redacted-id]",
  pollIntervalMs,
  syncScheduler: syncScheduler.snapshot(),
  mediaDrain: mediaDrainConfig,
  audioTranscription: audioTranscriptionConfig,
  autoReplyEnabled: process.env.VIJI_AUTO_REPLY_ENABLED === "true",
  liveSendEnabled: process.env.VIJI_WACLI_LIVE_SEND_ENABLED === "true"
});

try {
  while (!stopping) {
    const startedAt = Date.now();
    let shouldSync = false;
    let forceSyncEveryCycle = false;
    let mediaDrain = null;
    let mediaDrainDurationMs = null;
    let audioTranscription = null;
    let audioTranscriptionDurationMs = null;
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

      const syncDecision = syncScheduler.decide();
      forceSyncEveryCycle =
        process.env.VIJI_LIVE_SYNC_BEFORE_POLL_ENABLED === "true";
      shouldSync = forceSyncEveryCycle || syncDecision.shouldSync;
      const syncReason = forceSyncEveryCycle ? "forced" : syncDecision.reason;
      const result = await runLiveAutomationCycle(pool, {
        channelAccountId,
        adapter,
        dispatcher,
        llmClient,
        env: {
          ...process.env,
          VIJI_LIVE_SYNC_BEFORE_POLL_ENABLED: shouldSync ? "true" : "false"
        },
        logger,
        contactLimit: positiveInteger(process.env.VIJI_LIVE_INGEST_CONTACT_LIMIT, 100),
        chatSearchLimit: positiveInteger(
          process.env.VIJI_LIVE_INGEST_CHAT_SEARCH_LIMIT,
          5
        ),
        messageLimit: positiveInteger(process.env.VIJI_LIVE_INGEST_MESSAGE_LIMIT, 25),
        syncReason
      });
      if (shouldSync && !forceSyncEveryCycle) {
        syncScheduler.record(result.syncStatus);
      }
      if (mediaDrainConfig.enabled) {
        const mediaDrainStartedAt = Date.now();
        try {
          mediaDrain = await drainMediaDownloadQueue(pool, {
            adapter,
            env: process.env,
            limitPerCycle: mediaDrainConfig.limitPerCycle,
            autoPromote: mediaDrainConfig.autoPromote
          });
          mediaDrainDurationMs = Date.now() - mediaDrainStartedAt;
          if (mediaDrain.attempted > 0) {
            logger.info("live_worker.media_drain", {
              ...mediaDrain,
              durationMs: mediaDrainDurationMs
            });
          }
        } catch (error) {
          mediaDrainDurationMs = Date.now() - mediaDrainStartedAt;
          logger.error("live_worker.media_drain_failed", error, {
            durationMs: mediaDrainDurationMs
          });
        }
      }
      if (audioTranscriptionConfig.enabled) {
        const audioTranscriptionStartedAt = Date.now();
        try {
          audioTranscription = await drainAudioTranscriptionQueue(pool, {
            env: process.env,
            limitPerCycle: audioTranscriptionConfig.limitPerCycle
          });
          audioTranscriptionDurationMs = Date.now() - audioTranscriptionStartedAt;
          if (audioTranscription.attempted > 0) {
            logger.info("live_worker.audio_transcription", {
              ...audioTranscription,
              durationMs: audioTranscriptionDurationMs
            });
          }
        } catch (error) {
          audioTranscriptionDurationMs = Date.now() - audioTranscriptionStartedAt;
          logger.error("live_worker.audio_transcription_failed", error, {
            durationMs: audioTranscriptionDurationMs
          });
        }
      }
      logger.info("live_worker.cycle_timing", {
        cycleDurationMs: result.cycleDurationMs,
        syncDurationMs: result.syncDurationMs,
        mediaDrainDurationMs,
        mediaDrain,
        audioTranscriptionDurationMs,
        audioTranscription,
        syncStatus: result.syncStatus,
        syncReason: result.syncReason,
        effectivePollIntervalMs: Date.now() - startedAt,
        targetPollIntervalMs: pollIntervalMs,
        syncScheduler: syncScheduler.snapshot()
      });
    } catch (error) {
      if (shouldSync && !forceSyncEveryCycle) {
        syncScheduler.record("failed");
      }
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
