import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import {
  collectPhase17TrialStatus,
  renderPhase17TrialStatus
} from "../../scripts/phase17-trial-status.mjs";

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

function json(response, payload, statusCode = 200) {
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

test("Phase 17 trial status is computed from API payloads without leaking filenames", async () => {
  const requests = [];
  const server = createServer((request, response) => {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    requests.push({
      url: `${url.pathname}${url.search}`,
      authorization: request.headers.authorization
    });

    if (url.pathname === "/health") {
      json(response, { ok: true });
      return;
    }
    if (url.pathname === "/status") {
      json(response, {
        status: {
          database: "healthy",
          storage: { state: "healthy" },
          counts: { conversations: 2, pendingConfirmations: 1 }
        }
      });
      return;
    }
    if (url.pathname === "/dashboard/summary") {
      json(response, {
        status: {
          database: "healthy",
          storage: { state: "healthy", usedBytes: 10, quotaLimitBytes: 100 }
        },
        runtime: {
          defaultReplyMode: "auto",
          autoReplyEnabled: true,
          liveSendEnabled: true,
          llmProvider: "ollama",
          llmModel: "local-model-from-api"
        }
      });
      return;
    }
    if (url.pathname === "/storage/status") {
      json(response, { storage: { state: "healthy", usedBytes: 10, quotaLimitBytes: 100 } });
      return;
    }
    if (url.pathname === "/sync/status") {
      json(response, { syncRuns: [{ state: "completed" }] });
      return;
    }
    if (url.pathname === "/backfill/status") {
      json(response, { backfillJobs: [{ state: "completed" }] });
      return;
    }
    if (url.pathname === "/media/jobs") {
      json(response, { mediaJobs: [{ state: "downloaded", fileName: "private_media.png" }] });
      return;
    }
    if (url.pathname === "/conversations") {
      json(response, {
        conversations: [
          { contextState: "fresh", title: "Private chat one" },
          { contextState: "fresh", title: "Private chat two" }
        ]
      });
      return;
    }
    if (url.pathname === "/confirmations") {
      json(response, {
        confirmations: [
          {
            agentDraftId: "draft-redacted",
            body: "Do you mean private_file_name.pdf?"
          }
        ]
      });
      return;
    }
    if (url.pathname === "/outbox") {
      json(response, { jobs: [{ state: "sent" }, { state: "queued" }] });
      return;
    }
    if (url.pathname === "/resources") {
      json(response, {
        resources: [
          { registeredFileName: "private_file_name.pdf", title: "Private File" },
          { registeredFileName: "another_private_file.pdf", title: "Another Private File" }
        ]
      });
      return;
    }
    if (url.pathname === "/audit") {
      json(response, { auditEvents: [{ type: "resource.match.suggested" }] });
      return;
    }
    if (url.pathname === "/policy") {
      json(response, { policies: [{ mode: "auto" }] });
      return;
    }

    json(response, { error: { message: "not found" } }, 404);
  });

  try {
    const baseUrl = await listen(server);
    const report = await collectPhase17TrialStatus({
      env: {
        VIJI_API_BASE_URL: baseUrl,
        VIJI_API_TOKEN: "phase17-token",
        VIJI_LIVE_POLL_INTERVAL_MS: "5000"
      },
      now: new Date("2026-05-08T00:00:00.000Z")
    });
    const rendered = renderPhase17TrialStatus(report);

    assert.equal(report.readyForTrial, true);
    assert.equal(report.counts.resources, 2);
    assert.equal(report.counts.pendingConfirmations, 1);
    assert.equal(report.runtime.llmModel, "local-model-from-api");
    assert.equal(report.states.context.fresh, 2);
    assert.equal(
      requests.every((request) => request.authorization === "Bearer phase17-token"),
      true
    );
    assert.deepEqual(
      requests.map((request) => request.url).sort(),
      [
        "/audit?limit=50",
        "/backfill/status?limit=5",
        "/confirmations?limit=25",
        "/conversations?limit=25",
        "/dashboard/summary",
        "/health",
        "/media/jobs?limit=10",
        "/outbox?limit=25",
        "/policy?limit=50",
        "/resources?limit=100",
        "/status",
        "/storage/status",
        "/sync/status?limit=5"
      ].sort()
    );
    assert.equal(JSON.stringify(report).includes("private_file_name.pdf"), false);
    assert.equal(rendered.includes("private_file_name.pdf"), false);
    assert.match(rendered, /Ready for controlled trial: yes/);
  } finally {
    await closeServer(server);
  }
});

test("Phase 17 trial status blocks when API-reported runtime is not ready", async () => {
  const fetchImpl = async (url) => {
    const path = new URL(url).pathname;
    if (path === "/dashboard/summary") {
      return Response.json({
        status: {
          database: "healthy",
          storage: { state: "healthy" }
        },
        runtime: {
          defaultReplyMode: "readonly",
          autoReplyEnabled: false,
          liveSendEnabled: false
        }
      });
    }
    if (path === "/status") {
      return Response.json({ status: { database: "healthy", storage: { state: "healthy" } } });
    }
    if (path === "/storage/status") {
      return Response.json({ storage: { state: "healthy" } });
    }
    return Response.json({});
  };

  const report = await collectPhase17TrialStatus({
    env: {
      VIJI_API_BASE_URL: "http://127.0.0.1:9999",
      VIJI_API_TOKEN: "token"
    },
    fetchImpl,
    now: new Date("2026-05-08T00:00:00.000Z")
  });

  assert.equal(report.readyForTrial, false);
  assert.equal(report.gates.find((gate) => gate.name === "trial_mode").state, "block");
  assert.equal(report.gates.find((gate) => gate.name === "live_send").state, "block");
});
