export type LiveSyncReason = "startup" | "interval" | "retry" | "forced";

export interface LiveSyncSchedulerConfig {
  enabled: boolean;
  startupSyncEnabled: boolean;
  intervalMs: number;
  retryMinMs: number;
  retryMaxMs: number;
  jitterRatio: number;
}

export interface LiveSyncDecision {
  shouldSync: boolean;
  reason?: LiveSyncReason;
  nextSyncAtMs?: number;
  nextSyncInMs?: number;
  retryBackoffMs: number;
  lastStatus: "never" | "completed" | "failed";
}

export interface LiveSyncSchedulerSnapshot {
  enabled: boolean;
  startupSyncEnabled: boolean;
  intervalMs: number;
  retryMinMs: number;
  retryMaxMs: number;
  jitterRatio: number;
  nextSyncAtMs: number | null;
  retryBackoffMs: number;
  lastStatus: "never" | "completed" | "failed";
}

export interface LiveSyncScheduler {
  decide(nowMs?: number): LiveSyncDecision;
  record(status: "completed" | "failed" | "skipped", nowMs?: number): void;
  snapshot(nowMs?: number): LiveSyncSchedulerSnapshot;
}

const MIN_INTERVAL_MS = 250;

function positiveInteger(
  value: string | number | undefined,
  fallback: number
): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function ratio(value: string | number | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }
  return Math.min(parsed, 1);
}

function withJitter(
  baseMs: number,
  jitterRatio: number,
  random: () => number
): number {
  if (jitterRatio <= 0) {
    return Math.max(MIN_INTERVAL_MS, baseMs);
  }

  const offset = (random() * 2 - 1) * baseMs * jitterRatio;
  return Math.max(MIN_INTERVAL_MS, Math.round(baseMs + offset));
}

export function getLiveSyncSchedulerConfigFromEnv(
  env: NodeJS.ProcessEnv
): LiveSyncSchedulerConfig {
  const retryMinMs = positiveInteger(env.VIJI_LIVE_SYNC_RETRY_MIN_MS, 15_000);
  const retryMaxMs = Math.max(
    retryMinMs,
    positiveInteger(env.VIJI_LIVE_SYNC_RETRY_MAX_MS, 300_000)
  );

  return {
    enabled: env.VIJI_LIVE_SYNC_SCHEDULER_ENABLED !== "false",
    startupSyncEnabled: env.VIJI_LIVE_STARTUP_SYNC_ENABLED !== "false",
    intervalMs: positiveInteger(env.VIJI_LIVE_SYNC_INTERVAL_MS, 60_000),
    retryMinMs,
    retryMaxMs,
    jitterRatio: ratio(env.VIJI_LIVE_SYNC_JITTER_RATIO, 0.15)
  };
}

export function createLiveSyncScheduler(
  config: LiveSyncSchedulerConfig,
  options: { nowMs?: number; random?: () => number } = {}
): LiveSyncScheduler {
  const random = options.random ?? Math.random;
  let retryBackoffMs = config.retryMinMs;
  let lastStatus: LiveSyncDecision["lastStatus"] = "never";
  let nextSyncAtMs: number | null = config.enabled
    ? (options.nowMs ?? Date.now()) + (config.startupSyncEnabled ? 0 : config.intervalMs)
    : null;

  function decisionReason(): LiveSyncReason {
    if (lastStatus === "failed") {
      return "retry";
    }
    return lastStatus === "never" ? "startup" : "interval";
  }

  return {
    decide(nowMs = Date.now()): LiveSyncDecision {
      if (!config.enabled || nextSyncAtMs === null) {
        return {
          shouldSync: false,
          retryBackoffMs,
          lastStatus
        };
      }

      const nextSyncInMs = Math.max(0, nextSyncAtMs - nowMs);
      return {
        shouldSync: nextSyncInMs === 0,
        ...(nextSyncInMs === 0 ? { reason: decisionReason() } : {}),
        nextSyncAtMs,
        nextSyncInMs,
        retryBackoffMs,
        lastStatus
      };
    },

    record(status, nowMs = Date.now()): void {
      if (!config.enabled || nextSyncAtMs === null || status === "skipped") {
        return;
      }

      if (status === "completed") {
        lastStatus = "completed";
        retryBackoffMs = config.retryMinMs;
        nextSyncAtMs = nowMs + withJitter(config.intervalMs, config.jitterRatio, random);
        return;
      }

      lastStatus = "failed";
      nextSyncAtMs = nowMs + withJitter(retryBackoffMs, config.jitterRatio, random);
      retryBackoffMs = Math.min(config.retryMaxMs, retryBackoffMs * 2);
    },

    snapshot(): LiveSyncSchedulerSnapshot {
      return {
        ...config,
        nextSyncAtMs,
        retryBackoffMs,
        lastStatus
      };
    }
  };
}
