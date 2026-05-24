import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  assertSuccess,
  run
} from "../helpers/disposable-postgres.mjs";

const build = run("corepack", ["pnpm", "--filter", "@viji/worker", "build"]);
assertSuccess(build, "build @viji/worker");

const {
  createLiveSyncScheduler,
  getLiveSyncSchedulerConfigFromEnv
} = await import("../../apps/worker/dist/index.js");

test("Phase 19 scheduler syncs on startup, then waits for the interval", () => {
  const scheduler = createLiveSyncScheduler(
    {
      enabled: true,
      startupSyncEnabled: true,
      intervalMs: 60_000,
      retryMinMs: 15_000,
      retryMaxMs: 300_000,
      jitterRatio: 0
    },
    { nowMs: 1_000, random: () => 0.5 }
  );

  assert.deepEqual(scheduler.decide(1_000), {
    shouldSync: true,
    reason: "startup",
    nextSyncAtMs: 1_000,
    nextSyncInMs: 0,
    retryBackoffMs: 15_000,
    lastStatus: "never"
  });

  scheduler.record("completed", 1_200);

  assert.deepEqual(scheduler.decide(2_000), {
    shouldSync: false,
    nextSyncAtMs: 61_200,
    nextSyncInMs: 59_200,
    retryBackoffMs: 15_000,
    lastStatus: "completed"
  });
  assert.equal(scheduler.decide(61_200).reason, "interval");
});

test("Phase 19 scheduler backs off failed syncs without hammering the adapter", () => {
  const scheduler = createLiveSyncScheduler(
    {
      enabled: true,
      startupSyncEnabled: true,
      intervalMs: 60_000,
      retryMinMs: 10_000,
      retryMaxMs: 40_000,
      jitterRatio: 0
    },
    { nowMs: 0, random: () => 0.5 }
  );

  assert.equal(scheduler.decide(0).reason, "startup");
  scheduler.record("failed", 100);
  assert.equal(scheduler.decide(9_000).shouldSync, false);
  assert.deepEqual(scheduler.decide(10_100), {
    shouldSync: true,
    reason: "retry",
    nextSyncAtMs: 10_100,
    nextSyncInMs: 0,
    retryBackoffMs: 20_000,
    lastStatus: "failed"
  });

  scheduler.record("failed", 10_200);
  assert.equal(scheduler.decide(29_000).shouldSync, false);
  assert.equal(scheduler.decide(30_200).reason, "retry");
  assert.equal(scheduler.decide(30_200).retryBackoffMs, 40_000);
});

test("Phase 19 scheduler config uses hot-poll-safe defaults from env", () => {
  const config = getLiveSyncSchedulerConfigFromEnv({});

  assert.equal(config.enabled, true);
  assert.equal(config.startupSyncEnabled, true);
  assert.equal(config.intervalMs, 60_000);
  assert.equal(config.retryMinMs, 15_000);
  assert.equal(config.retryMaxMs, 300_000);
  assert.equal(config.jitterRatio, 0.15);
});

test("Phase 19 daemon advances retry backoff when a scheduled sync cycle throws", async () => {
  const source = await readFile("scripts/live-worker-daemon.mjs", "utf8");

  assert.match(source, /if \(shouldSync && !forceSyncEveryCycle\) \{\s*syncScheduler\.record\("failed"\);/);
  assert.match(source, /syncScheduler\.record\(result\.syncStatus\);/);
});
