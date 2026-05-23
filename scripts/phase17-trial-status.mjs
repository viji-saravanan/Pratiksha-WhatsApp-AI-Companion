#!/usr/bin/env node
import "./lib/load-env.mjs";

import { pathToFileURL } from "node:url";

const DEFAULT_API_BASE_URL = "http://127.0.0.1:8787";
const DEFAULT_API_TOKEN = "change-me-api-token";

const endpointSpecs = [
  ["health", "/health"],
  ["status", "/status"],
  ["summary", "/dashboard/summary"],
  ["storage", "/storage/status"],
  ["sync", "/sync/status?limit=5"],
  ["backfill", "/backfill/status?limit=5"],
  ["media", "/media/jobs?limit=10"],
  ["conversations", "/conversations?limit=25"],
  ["confirmations", "/confirmations?limit=25"],
  ["outbox", "/outbox?limit=25"],
  ["resources", "/resources?limit=100"],
  ["audit", "/audit?limit=50"],
  ["policy", "/policy?limit=50"]
];

export async function collectPhase17TrialStatus(options = {}) {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? new Date();
  const baseUrl = normalizeBaseUrl(env.VIJI_API_BASE_URL || DEFAULT_API_BASE_URL);
  const token = env.VIJI_API_TOKEN || DEFAULT_API_TOKEN;

  const results = await Promise.allSettled(
    endpointSpecs.map(async ([key, path]) => [key, await apiGet(fetchImpl, baseUrl, token, path)])
  );

  const payloads = {};
  const failures = [];
  for (const result of results) {
    if (result.status === "fulfilled") {
      payloads[result.value[0]] = result.value[1];
    } else {
      failures.push(result.reason?.message || "Unknown API failure");
    }
  }

  const status = payloads.status?.status || payloads.status || {};
  const summary = payloads.summary || {};
  const runtime = summary.runtime || status.runtime || {};
  const storage = payloads.storage?.storage || summary.status?.storage || status.storage || {};
  const conversations = arrayOf(payloads.conversations?.conversations);
  const confirmations = arrayOf(payloads.confirmations?.confirmations);
  const resources = arrayOf(payloads.resources?.resources);
  const mediaJobs = arrayOf(payloads.media?.mediaJobs);
  const outboxJobs = arrayOf(payloads.outbox?.jobs);
  const auditEvents = arrayOf(payloads.audit?.auditEvents);
  const policies = arrayOf(payloads.policy?.policies);
  const syncRuns = arrayOf(payloads.sync?.syncRuns);
  const backfillJobs = arrayOf(payloads.backfill?.backfillJobs);
  const contextStates = countBy(
    conversations.map((conversation) => String(conversation.contextState || "unknown"))
  );
  const outboxStates = countBy(outboxJobs.map((job) => String(job.state || "unknown")));
  const mediaStates = countBy(mediaJobs.map((job) => String(job.state || "unknown")));
  const syncStates = countBy(syncRuns.map((run) => String(run.state || "unknown")));
  const backfillStates = countBy(backfillJobs.map((job) => String(job.state || "unknown")));

  const gates = [
    gate("api", failures.length === 0, failures.length === 0 ? "All status endpoints responded." : `${failures.length} status endpoint(s) failed.`),
    gate("database", status.database === "healthy", `Database is ${status.database || "unknown"}.`),
    gate(
      "storage",
      storage.state === "healthy" || storage.state === "warning",
      `Storage is ${storage.state || "unknown"}.`
    ),
    gate(
      "context",
      conversations.length > 0 && Number(contextStates.stale || 0) === 0,
      `${conversations.length} trusted conversation(s), ${Number(contextStates.stale || 0)} stale.`
    ),
    gate(
      "local_ai",
      Boolean(runtime.llmModel),
      runtime.llmModel ? `Model reported: ${runtime.llmModel}.` : "No model reported by API."
    ),
    gate(
      "trial_mode",
      runtime.autoReplyEnabled === true && runtime.defaultReplyMode === "auto",
      `Auto reply=${String(runtime.autoReplyEnabled)}, mode=${String(runtime.defaultReplyMode || "unknown")}.`
    ),
    gate(
      "live_send",
      runtime.liveSendEnabled === true,
      `Live send=${String(runtime.liveSendEnabled)}.`
    ),
    gate(
      "resource_safety",
      true,
      `${confirmations.length} pending file confirmation(s); dashboard approval remains blocked by design.`
    )
  ];

  const blockingGates = gates.filter((item) => item.state === "block");
  const warningGates = gates.filter((item) => item.state === "warn");

  return {
    phase: "17-local-trial",
    generatedAt: now.toISOString(),
    apiBaseUrl: baseUrl,
    readyForTrial: blockingGates.length === 0,
    gates,
    counts: {
      conversations: conversations.length,
      resources: resources.length,
      pendingConfirmations: confirmations.length,
      policies: policies.length,
      mediaJobs: mediaJobs.length,
      auditEvents: auditEvents.length,
      outboxJobs: outboxJobs.length,
      endpointFailures: failures.length
    },
    states: {
      context: contextStates,
      outbox: outboxStates,
      media: mediaStates,
      sync: syncStates,
      backfill: backfillStates
    },
    runtime: {
      defaultReplyMode: runtime.defaultReplyMode || "unknown",
      autoReplyEnabled: runtime.autoReplyEnabled === true,
      liveSendEnabled: runtime.liveSendEnabled === true,
      llmProvider: runtime.llmProvider || "unknown",
      llmModel: runtime.llmModel || "unknown",
      livePollIntervalMs: Number(env.VIJI_LIVE_POLL_INTERVAL_MS || 1000)
    },
    recommendations: buildRecommendations(gates, warningGates),
    failures
  };
}

export function renderPhase17TrialStatus(report) {
  const lines = [
    "# Phase 17 Trial Status",
    "",
    `Generated: ${report.generatedAt}`,
    `API: ${report.apiBaseUrl}`,
    `Ready for controlled trial: ${report.readyForTrial ? "yes" : "no"}`,
    "",
    "## Gates",
    ...report.gates.map((item) => `- ${item.name}: ${item.state} - ${item.detail}`),
    "",
    "## Counts",
    ...Object.entries(report.counts).map(([key, value]) => `- ${key}: ${value}`),
    "",
    "## Runtime",
    ...Object.entries(report.runtime).map(([key, value]) => `- ${key}: ${value}`),
    "",
    "## Recommendations",
    ...(report.recommendations.length > 0
      ? report.recommendations.map((item) => `- ${item}`)
      : ["- No immediate tuning action from status data."])
  ];

  if (report.failures.length > 0) {
    lines.push("", "## API Failures", ...report.failures.map((item) => `- ${item}`));
  }

  return `${lines.join("\n")}\n`;
}

async function apiGet(fetchImpl, baseUrl, token, path) {
  const response = await fetchImpl(`${baseUrl}${path}`, {
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json"
    }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload?.error?.message || `HTTP ${response.status}`;
    throw new Error(`${path}: ${message}`);
  }

  return payload;
}

function normalizeBaseUrl(value) {
  return String(value || DEFAULT_API_BASE_URL).replace(/\/$/, "");
}

function arrayOf(value) {
  return Array.isArray(value) ? value : [];
}

function countBy(values) {
  return values.reduce((counts, value) => {
    counts[value] = (counts[value] || 0) + 1;
    return counts;
  }, {});
}

function gate(name, ok, detail) {
  return {
    name,
    state: ok ? "pass" : name === "resource_safety" ? "warn" : "block",
    detail
  };
}

function buildRecommendations(gates, warningGates) {
  const recommendations = [];
  for (const item of gates) {
    if (item.state === "block") {
      recommendations.push(`Resolve ${item.name}: ${item.detail}`);
    }
  }
  for (const item of warningGates) {
    recommendations.push(`Review ${item.name}: ${item.detail}`);
  }
  return recommendations;
}

async function main() {
  const json = process.argv.includes("--json");
  const report = await collectPhase17TrialStatus();
  process.stdout.write(json ? `${JSON.stringify(report, null, 2)}\n` : renderPhase17TrialStatus(report));
  process.exitCode = report.readyForTrial ? 0 : 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exit(2);
  });
}
