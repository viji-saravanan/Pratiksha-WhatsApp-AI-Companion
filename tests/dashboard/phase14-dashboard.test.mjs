import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
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

async function readTree(directory, extension) {
  const entries = await readdir(directory, { withFileTypes: true });
  const chunks = [];

  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      chunks.push(await readTree(path, extension));
    } else if (entry.isFile() && path.endsWith(extension)) {
      chunks.push(await readFile(path, "utf8"));
    }
  }

  return chunks.join("\n");
}

async function listen(server) {
  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });

  const address = server.address();
  assert.ok(address && typeof address === "object");
  return `http://127.0.0.1:${address.port}`;
}

async function closeServer(server) {
  await new Promise((resolveClose, reject) => {
    server.close((error) => (error ? reject(error) : resolveClose()));
  });
}

async function readRequestBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

const build = run("corepack", ["pnpm", "--filter", "@viji/dashboard", "build"]);
assertSuccess(build, "build @viji/dashboard");

const { createDashboardServer } = await import("../../apps/dashboard/dist/index.js");

test("Phase 14 dashboard browser assets do not expose secrets or approval calls", async () => {
  const assetSource = await readTree("apps/dashboard/src/assets", "");
  const html = await readFile("apps/dashboard/src/assets/index.html", "utf8");
  const appSource = await readFile("apps/dashboard/src/assets/app.js", "utf8");
  const serverSource = await readTree("apps/dashboard/src", ".ts");
  const sharedSource = await readTree("packages/shared/src", ".ts");

  assert.equal(/VIJI_API_TOKEN|DATABASE_URL|POSTGRES_PASSWORD|local-dev-token/.test(assetSource), false);
  assert.equal(/\/confirmations\/[^`"']+\/confirm/.test(assetSource), false);
  assert.match(assetSource, /WhatsApp-only approval|WhatsApp approval only/);
  assert.match(assetSource, /Plain-language status/);
  assert.match(html, /theme-toggle/);
  assert.match(html, /data-icon="home"/);
  assert.match(appSource, /Upload a file/);
  assert.match(appSource, /resource-upload-form/);
  assert.match(appSource, /function icon/);
  assert.match(assetSource, /@keyframes rise-in/);
  assert.match(appSource, /function categorizeLog/);
  assert.match(appSource, /function renderContainerLogServices/);
  assert.match(appSource, /function renderRawLogStream/);
  assert.match(appSource, /Raw container logs/);
  assert.match(appSource, /data-container-log-service/);
  assert.match(sharedSource, /Docker API/);
  assert.match(serverSource, /container-logs/);
  assert.match(appSource, /Safety", "Files", "WhatsApp", "AI", "Sync", "Storage", "System/);
  assert.match(assetSource, /data-theme="dark"/);
  assert.match(assetSource, /--primary: #2563eb/);
  assert.ok(
    html.indexOf('data-view="logs"') > html.indexOf('data-view="settings"'),
    "Logs should be the final navigation item"
  );
  assert.match(serverSource, /recipientConfirmationRequired/);
  assert.equal(/@viji\/db|from ["']pg["']|createPgPool/.test(serverSource), false);
});

test("dashboard serves static UI, injects API auth server-side, and blocks owner approval", async () => {
  const token = "phase14-dashboard-token";
  const upstreamRequests = [];
  const tempRoot = await mkdtemp(join(tmpdir(), "viji-dashboard-upload-"));
  const resourceRoot = join(tempRoot, "viji-files");
  const upstream = createServer(async (request, response) => {
    const body = await readRequestBody(request);
    upstreamRequests.push({
      method: request.method,
      url: request.url,
      authorization: request.headers.authorization,
      body
    });

    if (request.url === "/resources/register") {
      const payload = JSON.parse(body);
      response.writeHead(201, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({
        resource: {
          resourceId: "resource-uploaded",
          registeredFileName: payload.path.split("/").at(-1),
          title: payload.title,
          aliases: payload.aliases,
          storageState: "available"
        }
      }));
      return;
    }

    response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    if (request.url === "/policy/mode") {
      response.end(JSON.stringify({ policy: JSON.parse(body) }));
      return;
    }

    response.end(JSON.stringify({ ok: true, path: request.url }));
  });

  try {
    const upstreamBaseUrl = await listen(upstream);
    const dashboard = createDashboardServer({
      host: "127.0.0.1",
      port: 0,
      apiBaseUrl: upstreamBaseUrl,
      apiToken: token,
      containerLogs: {
        enabled: true,
        dockerSocketPath: "/var/run/docker.sock",
        composeProject: "viji-helper-test",
        defaultTail: 120,
        timeoutMs: 5000
      },
      upload: {
        resourceRoot,
        maxBytes: 1_000_000
      }
    }, {
      containerLogsReader: {
        async read(options = {}) {
          return {
            enabled: true,
            project: "viji-helper-test",
            selectedService: options.service || "all",
            tail: options.tail || 120,
            generatedAt: "2026-05-07T00:00:00.000Z",
            services: [
              {
                service: "postgres",
                containerId: "container-1",
                containerName: "viji-helper-postgres-1",
                image: "pgvector/pgvector:pg16",
                state: "running",
                status: "Up"
              }
            ],
            rawText: "===== postgres / viji-helper-postgres-1 =====\\npostgres ready"
          };
        }
      }
    });

    try {
      const dashboardBaseUrl = await listen(dashboard);

      const html = await fetch(`${dashboardBaseUrl}/`).then((response) => response.text());
      const appJs = await fetch(`${dashboardBaseUrl}/app.js`).then((response) => response.text());
      assert.match(html, /Pratiksha/);
      assert.equal(html.includes(token), false);
      assert.equal(appJs.includes(token), false);

      const proxied = await fetch(`${dashboardBaseUrl}/api/status`);
      assert.equal(proxied.status, 200);
      assert.equal(upstreamRequests.at(-1).authorization, `Bearer ${token}`);
      assert.equal(upstreamRequests.at(-1).url, "/status");

      const logs = await fetch(`${dashboardBaseUrl}/api/container-logs?service=postgres&tail=50`);
      assert.equal(logs.status, 200);
      const logsPayload = await logs.json();
      assert.equal(logsPayload.containerLogs.selectedService, "postgres");
      assert.equal(logsPayload.containerLogs.tail, 50);
      assert.match(logsPayload.containerLogs.rawText, /postgres ready/);
      assert.equal(
        upstreamRequests.some((request) => request.url?.startsWith("/container-logs")),
        false
      );

      const form = new FormData();
      form.set("file", new Blob(["uploaded profile notes"], { type: "text/plain" }), "Viji Upload Notes.txt");
      form.set("title", "Uploaded notes");
      form.set("aliases", "upload test, notes");
      const upload = await fetch(`${dashboardBaseUrl}/api/resources/upload`, {
        method: "POST",
        body: form
      });
      assert.equal(upload.status, 201);
      const uploadPayload = await upload.json();
      assert.equal(uploadPayload.resource.registeredFileName, "Viji_Upload_Notes.txt");
      const registerRequest = upstreamRequests.find((request) => request.url === "/resources/register");
      assert.ok(registerRequest);
      assert.equal(registerRequest.authorization, `Bearer ${token}`);
      assert.deepEqual(JSON.parse(registerRequest.body), {
        path: "staged/Viji_Upload_Notes.txt",
        title: "Uploaded notes",
        aliases: ["upload test", "notes"],
        description: null
      });
      assert.equal(
        (await stat(join(resourceRoot, "staged", "Viji_Upload_Notes.txt"))).isFile(),
        true
      );

      const blocked = await fetch(
        `${dashboardBaseUrl}/api/confirmations/draft-1/confirm`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}"
        }
      );
      assert.equal(blocked.status, 409);
      assert.equal(
        upstreamRequests.some((request) => request.url === "/confirmations/draft-1/confirm"),
        false
      );

      const mode = await fetch(`${dashboardBaseUrl}/api/policy/mode`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "readonly" })
      });
      assert.equal(mode.status, 200);
      assert.equal(upstreamRequests.at(-1).url, "/policy/mode");
      assert.equal(upstreamRequests.at(-1).authorization, `Bearer ${token}`);
      assert.deepEqual(JSON.parse(upstreamRequests.at(-1).body), { mode: "readonly" });
    } finally {
      await closeServer(dashboard);
    }
  } finally {
    await closeServer(upstream);
    await rm(tempRoot, { recursive: true, force: true });
  }
});
