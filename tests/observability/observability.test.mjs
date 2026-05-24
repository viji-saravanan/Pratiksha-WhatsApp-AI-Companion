import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  assertSuccess,
  run,
  startDisposablePostgres
} from "../helpers/disposable-postgres.mjs";

for (const target of ["@viji/shared", "@viji/api", "@viji/cli", "@viji/dashboard", "@viji/llm-proxy"]) {
  const build = run("corepack", ["pnpm", "--filter", target, "build"]);
  assertSuccess(build, `build ${target}`);
}

const {
  createJsonLogger,
  renderPrometheusMetrics
} = await import("../../packages/shared/dist/index.js");
const { createPgPool } = await import("../../packages/db/dist/index.js");
const { createApiServer } = await import("../../apps/api/dist/index.js");
const { createDashboardServer } = await import("../../apps/dashboard/dist/index.js");
const { createLlmProxyServer } = await import("../../apps/llm-proxy/dist/index.js");
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

test("structured JSON logger redacts secrets, phone numbers, prompts, and message bodies", () => {
  let line = "";
  const logger = createJsonLogger("observability-test", {
    write(chunk) {
      line += chunk;
    }
  });

  logger.info("sensitive.event", {
    token: "local-dev-token",
    authorization: "Bearer secret-token",
    phoneE164: "+10000000002",
    body: "private WhatsApp message",
    nested: {
      prompt: "hidden prompt text",
      databaseUrl: "postgres://viji:1234@localhost:5433/viji_helper"
    },
    safeCount: 2
  });

  const record = JSON.parse(line);
  assert.equal(record.component, "observability-test");
  assert.equal(record.event, "sensitive.event");
  assert.equal(record.safeCount, 2);
  assert.equal(record.token, "[redacted]");
  assert.equal(record.authorization, "[redacted]");
  assert.equal(record.phoneE164, "[redacted]");
  assert.equal(record.body, "[redacted]");
  assert.equal(record.nested.prompt, "[redacted]");
  assert.equal(record.nested.databaseUrl, "[redacted]");
  assert.equal(line.includes("private WhatsApp message"), false);
  assert.equal(line.includes("secret-token"), false);
  assert.equal(line.includes("+10000000002"), false);
});

test("Prometheus renderer enforces viji_ metric names and escapes labels", () => {
  const output = renderPrometheusMetrics([
    {
      name: "viji_test_metric_total",
      help: "Synthetic metric",
      type: "gauge",
      labels: {
        service: "api",
        detail: 'quoted"value'
      },
      value: 3
    }
  ]);

  assert.match(output, /# HELP viji_test_metric_total Synthetic metric/);
  assert.match(output, /# TYPE viji_test_metric_total gauge/);
  assert.match(output, /viji_test_metric_total\{detail="quoted\\"value",service="api"\} 3/);
  assert.throws(
    () =>
      renderPrometheusMetrics([
        {
          name: "unsafe_metric",
          help: "Bad metric",
          type: "gauge",
          value: 1
        }
      ]),
    /viji_/
  );
});

test("API, dashboard, and LLM proxy expose redacted metrics without auth", async () => {
  const postgres = await startDisposablePostgres({ prefix: "viji-observability" });

  try {
    postgres.runProjectScript("scripts/run-migrations.mjs");
    const pool = createPgPool({ connectionString: postgres.connectionString });
    const dataRoot = await mkdtemp(join(tmpdir(), "viji-observability-data-"));
    await writeFile(join(dataRoot, ".viji-helper-root"), "observability-test\n");
    const api = createApiServer({
      db: pool,
      token: "observability-token",
      env: {
        ...process.env,
        VIJI_DATA_ROOT: dataRoot,
        VIJI_STORAGE_PROFILE: "large-200gb"
      }
    });
    const dashboard = createDashboardServer({
      host: "127.0.0.1",
      port: 0,
      apiBaseUrl: "http://127.0.0.1:1",
      apiToken: "dashboard-token",
      containerLogs: {
        enabled: false,
        dockerSocketPath: "/var/run/docker.sock",
        composeProject: "viji-helper-test",
        defaultTail: 120,
        timeoutMs: 5000
      },
      upload: {
        resourceRoot: "/tmp/viji-helper-test-files",
        maxBytes: 1000
      }
    });
    const llm = createLlmProxyServer({
      token: "llm-token",
      env: {
        ...process.env,
        VIJI_OLLAMA_MODEL: "qwen3:redacted",
        VIJI_OLLAMA_EMBEDDING_MODEL: "mxbai-embed-large"
      }
    });

    try {
      const apiBaseUrl = await listen(api);
      const dashboardBaseUrl = await listen(dashboard);
      const llmBaseUrl = await listen(llm);

      const apiMetrics = await fetch(`${apiBaseUrl}/metrics`);
      assert.equal(apiMetrics.status, 200);
      const apiText = await apiMetrics.text();
      assert.match(apiText, /viji_api_up 1/);
      assert.match(apiText, /viji_database_health\{state="healthy"\} 1/);
      assert.match(apiText, /viji_storage_state\{state="healthy"\} 1/);
      assert.match(apiText, /viji_live_sync_scheduler_enabled 1/);
      assert.match(apiText, /viji_live_sync_before_poll_enabled 0/);
      assert.equal(/POSTGRES_PASSWORD|DATABASE_URL|local-dev-token|private WhatsApp/.test(apiText), false);

      const dashboardMetrics = await fetch(`${dashboardBaseUrl}/metrics`);
      assert.equal(dashboardMetrics.status, 200);
      assert.match(await dashboardMetrics.text(), /viji_dashboard_up 1/);

      const llmMetrics = await fetch(`${llmBaseUrl}/metrics`);
      assert.equal(llmMetrics.status, 200);
      const llmText = await llmMetrics.text();
      assert.match(llmText, /viji_llm_proxy_up 1/);
      assert.match(llmText, /viji_llm_generation_model_configured\{model="qwen3:redacted"\} 1/);
    } finally {
      await closeServer(llm);
      await closeServer(dashboard);
      await closeServer(api);
      await pool.end();
    }
  } finally {
    postgres.stop();
  }
});

test("CLI can show raw container logs through the shared reader fallback", async () => {
  const captured = captureOutput();
  const exitCode = await runCli(["logs", "containers", "--service", "api", "--tail", "50"], {
    output: captured.output,
    env: {
      ...process.env,
      VIJI_CONTAINER_LOGS_TAIL: "120"
    },
    containerLogsReader: {
      async read(options = {}) {
        return {
          enabled: true,
          project: "viji-helper-test",
          selectedService: options.service || "all",
          tail: options.tail || 120,
          generatedAt: "2026-05-08T00:00:00.000Z",
          services: [
            {
              service: "api",
              containerId: "container-1",
              containerName: "viji-helper-api-1",
              image: "viji-api",
              state: "running",
              status: "Up"
            }
          ],
          rawText: "===== api / viji-helper-api-1 =====\napi ready"
        };
      }
    }
  });

  assert.equal(exitCode, 0, captured.stderr);
  assert.match(captured.stdout, /selected service: api/);
  assert.match(captured.stdout, /tail: 50/);
  assert.match(captured.stdout, /api ready/);

  const jsonOutput = captureOutput();
  const jsonExitCode = await runCli(["logs", "containers", "--json"], {
    output: jsonOutput.output,
    containerLogsReader: {
      async read() {
        return {
          enabled: false,
          project: "viji-helper-test",
          selectedService: "all",
          tail: 120,
          generatedAt: "2026-05-08T00:00:00.000Z",
          services: [],
          rawText: "",
          unavailableReason: "disabled for test"
        };
      }
    }
  });

  assert.equal(jsonExitCode, 0, jsonOutput.stderr);
  assert.equal(JSON.parse(jsonOutput.stdout).containerLogs.unavailableReason, "disabled for test");
});

test("observability Docker and Grafana provisioning are present", async () => {
  const compose = await readFile("docker-compose.yml", "utf8");
  const prometheus = await readFile("infra/observability/prometheus.yml", "utf8");
  const promtail = await readFile("infra/observability/promtail-config.yml", "utf8");
  const datasources = await readFile(
    "infra/observability/grafana/provisioning/datasources/datasources.yml",
    "utf8"
  );
  const dashboard = await readFile(
    "infra/observability/grafana/dashboards/viji-helper-overview.json",
    "utf8"
  );

  assert.match(compose, /profiles: \["observability"\]/);
  assert.match(compose, /promtail:/);
  assert.match(compose, /GF_AUTH_ANONYMOUS_ENABLED/);
  assert.match(prometheus, /host\.docker\.internal:8787/);
  assert.match(prometheus, /host\.docker\.internal:8791/);
  assert.match(promtail, /loki:3100/);
  assert.match(datasources, /Viji Prometheus/);
  assert.match(datasources, /Viji Loki/);
  assert.match(dashboard, /viji_api_up/);
  assert.match(dashboard, /project=\\?"viji-helper\\?"/);
});
