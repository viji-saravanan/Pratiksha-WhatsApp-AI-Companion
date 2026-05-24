import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

function run(command, args) {
  return spawnSync(command, args, {
    cwd: resolve("."),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
}

function assertSuccess(result, label) {
  assert.equal(result.status, 0, `${label}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
}

test("dashboard Compose profile owns API and Postgres lifecycle", async () => {
  const result = run("docker", ["compose", "--profile", "dashboard", "config", "--format", "json"]);
  assertSuccess(result, "docker compose dashboard config");
  const config = JSON.parse(result.stdout);

  assert.ok(config.services.api, "api service must exist");
  assert.ok(config.services.dashboard, "dashboard service must exist");
  assert.ok(config.services.postgres, "postgres service must exist");
  assert.match(
    JSON.stringify(config.services.api.build),
    /infra\/docker\/api\.Dockerfile/
  );
  assert.equal(config.services.dashboard.environment.VIJI_DASHBOARD_API_BASE_URL, "http://api:8787");
  assert.equal(config.services.api.environment.DATABASE_URL, "postgres://viji:1234@postgres:5432/viji_helper");
  assert.ok(config.services.api.depends_on.postgres, "api should wait for postgres");
  assert.ok(config.services.dashboard.depends_on.api, "dashboard should wait for api");
  assert.ok(config.services.postgres.healthcheck, "postgres should have a healthcheck");
});

test("documented environment defaults use Compose service DNS for container networking", async () => {
  const example = await readFile(".env.example", "utf8");
  const local = await readFile(".env", "utf8");

  assert.match(example, /VIJI_DASHBOARD_DOCKER_API_BASE_URL="http:\/\/api:8787"/);
  assert.match(local, /VIJI_DASHBOARD_DOCKER_API_BASE_URL="http:\/\/api:8787"/);
  assert.match(example, /DATABASE_DOCKER_URL="postgres:\/\/viji:1234@postgres:5432\/viji_helper"/);
  assert.match(local, /DATABASE_DOCKER_URL="postgres:\/\/viji:1234@postgres:5432\/viji_helper"/);
  assert.match(example, /VIJI_LIVE_SYNC_BEFORE_POLL_ENABLED="false"/);
  assert.match(local, /VIJI_LIVE_SYNC_BEFORE_POLL_ENABLED="false"/);
  assert.match(example, /VIJI_LIVE_SYNC_SCHEDULER_ENABLED="true"/);
  assert.match(local, /VIJI_LIVE_SYNC_SCHEDULER_ENABLED="true"/);
});

test("live Compose profile owns the WhatsApp automation worker lifecycle", async () => {
  const result = run("docker", ["compose", "--profile", "live", "config", "--format", "json"]);
  assertSuccess(result, "docker compose live config");
  const config = JSON.parse(result.stdout);
  const liveWorker = config.services["live-worker"];

  assert.ok(liveWorker, "live-worker service must exist");
  assert.match(
    JSON.stringify(liveWorker.build),
    /infra\/docker\/live-worker\.Dockerfile/
  );
  assert.ok(liveWorker.depends_on.postgres, "live worker should wait for postgres");
  assert.equal(liveWorker.environment.DATABASE_URL, "postgres://viji:1234@postgres:5432/viji_helper");
  assert.equal(liveWorker.environment.VIJI_WACLI_BIN, "/usr/local/bin/wacli");
  assert.equal(liveWorker.environment.VIJI_WACLI_TIMEOUT, "30s");
  assert.equal(liveWorker.environment.VIJI_WACLI_SYNC_TIMEOUT, "75s");
  assert.equal(liveWorker.environment.VIJI_LIVE_POLL_INTERVAL_MS, "1000");
  assert.equal(liveWorker.environment.VIJI_LIVE_SYNC_BEFORE_POLL_ENABLED, "false");
  assert.equal(liveWorker.environment.VIJI_LIVE_SYNC_SCHEDULER_ENABLED, "true");
  assert.equal(liveWorker.environment.VIJI_LIVE_STARTUP_SYNC_ENABLED, "true");
  assert.equal(liveWorker.environment.VIJI_LIVE_SYNC_INTERVAL_MS, "60000");
  assert.equal(liveWorker.environment.VIJI_LIVE_SYNC_RETRY_MIN_MS, "15000");
  assert.equal(liveWorker.environment.VIJI_LIVE_SYNC_RETRY_MAX_MS, "300000");
  assert.equal(liveWorker.environment.VIJI_LIVE_SYNC_JITTER_RATIO, "0.15");
  assert.equal(liveWorker.environment.VIJI_LIVE_SYNC_IDLE_EXIT, "12s");
  assert.equal(liveWorker.environment.VIJI_AUTO_REPLY_ENABLED, "false");
  assert.equal(liveWorker.environment.VIJI_WACLI_LIVE_SEND_ENABLED, "false");

  const packageJson = JSON.parse(await readFile("package.json", "utf8"));
  assert.match(packageJson.scripts["stack:live:up"], /--profile live/);
  assert.match(packageJson.scripts["stack:live:up"], /VIJI_AUTO_REPLY_ENABLED=true/);
  assert.match(packageJson.scripts["stack:live:up"], /VIJI_WACLI_LIVE_SEND_ENABLED=true/);
  assert.match(packageJson.scripts["stack:down"], /--profile dashboard/);
  assert.match(packageJson.scripts["stack:down"], /--profile app/);
  assert.match(packageJson.scripts["stack:down"], /--profile live/);
  assert.match(packageJson.scripts["stack:down"], /--remove-orphans/);
});
