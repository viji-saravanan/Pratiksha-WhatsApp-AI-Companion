import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer, type Server } from "node:http";
import { getRuntimePaths } from "@viji/config";
import {
  createRepositories,
  type DbExecutor,
  type MediaDownloadJobRecord,
  type ResponsePolicyMode
} from "@viji/db";
import {
  buildFileResourceRegistration,
  scanResourceDirectory,
  type ResourceIndexScope
} from "@viji/resources";
import { denyResourceProposal, understandFileResource } from "@viji/worker";
import {
  ERROR_CODES,
  getAssistantIdentity,
  renderPrometheusMetrics,
  toErrorMessage,
  type PrometheusMetricSample
} from "@viji/shared";
import { getApiStorageStatus } from "./storage-status.js";

export interface ApiAppOptions {
  db: DbExecutor;
  env?: NodeJS.ProcessEnv;
  token?: string;
}

interface ApiRequestContext {
  correlationId: string;
  url: URL;
  body: unknown;
}

type JsonValue = Record<string, unknown> | unknown[];
type OutboxApiJob = {
  outboundJobId: string;
  conversationId: string;
  sourceDraftId: string | null;
  kind: string;
  state: string;
  priority: number;
  scheduledAt: Date;
  idempotencyKey: string;
  blockedReason: string | null;
  sourceDraftPolicyState: string | null;
  payloadKeys: string[];
};

const VALID_POLICY_MODES = new Set<ResponsePolicyMode>([
  "auto",
  "confirm_resource",
  "readonly",
  "paused"
]);
const VALID_MEDIA_JOB_STATES = new Set<MediaDownloadJobRecord["state"]>([
  "queued",
  "running",
  "downloaded",
  "failed",
  "blocked",
  "skipped"
]);

function isResponsePolicyMode(value: unknown): value is ResponsePolicyMode {
  return typeof value === "string" && VALID_POLICY_MODES.has(value as ResponsePolicyMode);
}

function getHeaderValue(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function isAuthorized(request: IncomingMessage, token: string): boolean {
  const authorization = getHeaderValue(request, "authorization");
  const headerToken = getHeaderValue(request, "x-viji-api-token");
  return authorization === `Bearer ${token}` || headerToken === token;
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  if (request.method === "GET" || request.method === "HEAD") {
    return {};
  }

  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) {
    return {};
  }

  return JSON.parse(raw) as unknown;
}

function sendJson(
  response: ServerResponse,
  statusCode: number,
  correlationId: string,
  payload: JsonValue
): void {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "x-correlation-id": correlationId
  });
  response.end(JSON.stringify({ correlationId, ...payload }));
}

function sendText(
  response: ServerResponse,
  statusCode: number,
  contentType: string,
  body: string
): void {
  response.writeHead(statusCode, {
    "content-type": contentType
  });
  response.end(body);
}

function badRequest(message: string): Error {
  const error = new Error(message);
  error.name = "BadRequest";
  return error;
}

function requireObject(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw badRequest("Expected JSON object body");
  }

  return body as Record<string, unknown>;
}

function parseLimit(url: URL, defaultLimit: number): number {
  const raw = url.searchParams.get("limit");
  if (!raw) {
    return defaultLimit;
  }

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 200) {
    throw badRequest("limit must be an integer from 1 to 200");
  }

  return parsed;
}

function requireStringField(body: Record<string, unknown>, field: string): string {
  const value = body[field];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw badRequest(`${field} must be a non-empty string`);
  }

  return value.trim();
}

function optionalStringField(
  body: Record<string, unknown>,
  field: string
): string | undefined {
  const value = body[field];
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string" || value.trim().length === 0) {
    throw badRequest(`${field} must be a non-empty string`);
  }

  return value.trim();
}

function optionalNullableStringField(
  body: Record<string, unknown>,
  field: string
): string | null | undefined {
  if (body[field] === null) {
    return null;
  }

  return optionalStringField(body, field);
}

function optionalStringArrayField(
  body: Record<string, unknown>,
  field: string
): string[] | undefined {
  const value = body[field];
  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw badRequest(`${field} must be an array of strings`);
  }

  return Array.from(
    new Set(
      value
        .map((item) => item.trim())
        .filter((item) => item.length > 0)
    )
  );
}

function optionalBooleanField(
  body: Record<string, unknown>,
  field: string
): boolean | undefined {
  const value = body[field];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "boolean") {
    throw badRequest(`${field} must be a boolean`);
  }

  return value;
}

function parseBodyLimit(body: Record<string, unknown>, defaultLimit: number): number {
  const value = body.limit;
  if (value === undefined) {
    return defaultLimit;
  }

  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > 200) {
    throw badRequest("limit must be an integer from 1 to 200");
  }

  return value as number;
}

async function extractResourceContentIfEnabled(input: {
  db: DbExecutor;
  resourceId: string;
  resourceRoot: string;
  enabled: boolean;
}): Promise<{
  status: string;
  chunkCount: number;
  error: string | null;
} | null> {
  if (!input.enabled) {
    return null;
  }

  const result = await understandFileResource(input.db, {
    resourceId: input.resourceId,
    resourceRoot: input.resourceRoot
  });

  return {
    status: result.status,
    chunkCount: result.chunkCount,
    error: result.error
  };
}

function parseResourceIndexScope(value: unknown): ResourceIndexScope | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (value === "inbox" || value === "library" || value === "staged") {
    return value;
  }

  throw badRequest("scope must be inbox, library, or staged");
}

function parseMediaJobState(value: unknown): MediaDownloadJobRecord["state"] | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  if (typeof value === "string" && VALID_MEDIA_JOB_STATES.has(value as MediaDownloadJobRecord["state"])) {
    return value as MediaDownloadJobRecord["state"];
  }

  throw badRequest("state must be queued, running, downloaded, failed, blocked, or skipped");
}

function redactOutboxJob(job: {
  outboundJobId: string;
  conversationId: string;
  sourceDraftId: string | null;
  kind: string;
  payload: Record<string, unknown>;
  state: string;
  priority: number;
  scheduledAt: Date;
  idempotencyKey: string;
  blockedReason: string | null;
  sourceDraftPolicyState: string | null;
}): OutboxApiJob {
  return {
    outboundJobId: job.outboundJobId,
    conversationId: job.conversationId,
    sourceDraftId: job.sourceDraftId,
    kind: job.kind,
    state: job.state,
    priority: job.priority,
    scheduledAt: job.scheduledAt,
    idempotencyKey: job.idempotencyKey,
    blockedReason: job.blockedReason,
    sourceDraftPolicyState: job.sourceDraftPolicyState,
    payloadKeys: Object.keys(job.payload).sort()
  };
}

async function buildDashboardSummary(
  options: ApiAppOptions
): Promise<Record<string, unknown>> {
  const runtimePaths = getRuntimePaths(options.env);
  const status = await buildStatus(options);
  const assistantIdentity = getAssistantIdentity(options.env);

  return {
    status,
    runtime: {
      assistantName: assistantIdentity.name,
      assistantReplyPrefix: assistantIdentity.replyPrefix,
      dataRoot: runtimePaths.dataRoot,
      resourceRoot: runtimePaths.resourceRoot,
      wacliMediaRoot: runtimePaths.wacliMedia,
      wacliStoreConfigured: Boolean(runtimePaths.wacliStore),
      defaultReplyMode: options.env?.VIJI_DEFAULT_REPLY_MODE ?? "auto",
      autoReplyEnabled: options.env?.VIJI_AUTO_REPLY_ENABLED === "true",
      liveSendEnabled: options.env?.VIJI_WACLI_LIVE_SEND_ENABLED === "true",
      liveSync: buildLiveRuntimeStatus(options.env),
      liveReadSmokeEnabled:
        options.env?.VIJI_WACLI_LIVE_READ_SMOKE_ENABLED === "true",
      liveRecoverySmokeEnabled:
        options.env?.VIJI_WACLI_LIVE_RECOVERY_SMOKE_ENABLED === "true",
      liveSendSmokeEnabled:
        options.env?.VIJI_WACLI_LIVE_SEND_SMOKE_ENABLED === "true",
      llmProvider: options.env?.VIJI_LLM_PROVIDER ?? "ollama",
      llmModel: options.env?.VIJI_OLLAMA_MODEL ?? null,
      embeddingModel: options.env?.VIJI_OLLAMA_EMBEDDING_MODEL ?? null
    }
  };
}

async function getDatabaseHealth(db: DbExecutor): Promise<"healthy" | "unavailable"> {
  try {
    await db.query("SELECT 1");
    return "healthy";
  } catch {
    return "unavailable";
  }
}

function numberFromEnv(
  env: NodeJS.ProcessEnv | undefined,
  name: string,
  fallback: number
): number {
  const parsed = Number(env?.[name]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function buildLiveRuntimeStatus(env: NodeJS.ProcessEnv | undefined): Record<string, unknown> {
  return {
    pollIntervalMs: numberFromEnv(env, "VIJI_LIVE_POLL_INTERVAL_MS", 1000),
    syncBeforePollEnabled: env?.VIJI_LIVE_SYNC_BEFORE_POLL_ENABLED === "true",
    syncSchedulerEnabled: env?.VIJI_LIVE_SYNC_SCHEDULER_ENABLED !== "false",
    startupSyncEnabled: env?.VIJI_LIVE_STARTUP_SYNC_ENABLED !== "false",
    syncIntervalMs: numberFromEnv(env, "VIJI_LIVE_SYNC_INTERVAL_MS", 60_000),
    syncRetryMinMs: numberFromEnv(env, "VIJI_LIVE_SYNC_RETRY_MIN_MS", 15_000),
    syncRetryMaxMs: numberFromEnv(env, "VIJI_LIVE_SYNC_RETRY_MAX_MS", 300_000),
    syncIdleExit: env?.VIJI_LIVE_SYNC_IDLE_EXIT ?? "12s",
    mediaDrainEnabled: env?.VIJI_LIVE_MEDIA_DRAIN_ENABLED !== "false",
    mediaDrainLimitPerCycle: numberFromEnv(
      env,
      "VIJI_LIVE_MEDIA_DRAIN_LIMIT_PER_CYCLE",
      3
    ),
    mediaAutoPromoteEnabled:
      env?.VIJI_LIVE_MEDIA_AUTO_PROMOTE_ENABLED !== "false"
  };
}

async function buildStatus(options: ApiAppOptions): Promise<Record<string, unknown>> {
  const repositories = createRepositories(options.db);
  const [database, storage] = await Promise.all([
    getDatabaseHealth(options.db),
    getApiStorageStatus(options.env)
  ]);

  if (database !== "healthy") {
    return {
      database,
      storage,
      policy: {
        defaultMode: options.env?.VIJI_DEFAULT_REPLY_MODE ?? "auto",
        policies: []
      },
      live: buildLiveRuntimeStatus(options.env),
      counts: {
        conversations: 0,
        pendingConfirmations: 0,
        blockedJobs: 0,
        recentSyncRuns: 0,
        activeBackfillJobs: 0,
        activeMediaDownloadJobs: 0
      },
      contextStates: {},
      degraded: true,
      degradedReasons: ["database_unavailable"]
    };
  }

  const [
    conversations,
    policies,
    pendingConfirmations,
    blockedJobs,
    recentSyncRuns,
    activeBackfillJobs,
    mediaDownloadJobs
  ] = await Promise.all([
    repositories.conversations.listConversations(50),
    repositories.policies.listPolicies(50),
    repositories.drafts.listDrafts({ policyState: "confirm_resource", limit: 50 }),
    repositories.outbox.listJobs({ state: "blocked", limit: 50 }),
    repositories.syncRuns.listRecentSyncRuns(10),
    repositories.backfillJobs.listBackfillJobs(50),
    repositories.mediaJobs.listMediaDownloadJobs({ limit: 100 })
  ]);

  const contextStates = conversations.reduce<Record<string, number>>((counts, item) => {
    counts[item.contextState] = (counts[item.contextState] ?? 0) + 1;
    return counts;
  }, {});

  return {
    database,
    storage,
    policy: {
      defaultMode: options.env?.VIJI_DEFAULT_REPLY_MODE ?? "auto",
      policies
    },
    live: buildLiveRuntimeStatus(options.env),
    counts: {
      conversations: conversations.length,
      pendingConfirmations: pendingConfirmations.length,
      blockedJobs: blockedJobs.length,
      recentSyncRuns: recentSyncRuns.length,
      activeBackfillJobs: activeBackfillJobs.filter(
        (job) => job.state === "queued" || job.state === "running" || job.state === "paused"
      ).length,
      activeMediaDownloadJobs: mediaDownloadJobs.filter(
        (job) => job.state === "queued" || job.state === "running"
      ).length
    },
    contextStates
  };
}

function numberField(record: Record<string, unknown>, field: string): number {
  const value = record[field];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

async function buildMetrics(options: ApiAppOptions): Promise<string> {
  const status = await buildStatus(options);
  const storage = status.storage as { state?: string; usedBytes?: number; freeBytes?: number } | undefined;
  const counts = status.counts as Record<string, unknown> | undefined;
  const contextStates = status.contextStates as Record<string, unknown> | undefined;
  const live = status.live as Record<string, unknown> | undefined;
  const database = String(status.database ?? "unknown");
  const storageState = storage?.state ?? "unknown";
  const samples: PrometheusMetricSample[] = [
    {
      name: "viji_api_up",
      help: "Viji API process is responding to metrics scrapes.",
      type: "gauge",
      value: 1
    },
    {
      name: "viji_database_health",
      help: "Database health by state, where 1 is the current state.",
      type: "gauge",
      labels: { state: database },
      value: 1
    },
    {
      name: "viji_storage_state",
      help: "Storage state by label, where 1 is the current state.",
      type: "gauge",
      labels: { state: storageState },
      value: 1
    },
    {
      name: "viji_storage_used_bytes",
      help: "Bytes currently used under the Viji data root.",
      type: "gauge",
      value: Number(storage?.usedBytes ?? 0)
    },
    {
      name: "viji_storage_free_bytes",
      help: "Bytes available on the filesystem that hosts the Viji data root.",
      type: "gauge",
      value: Number(storage?.freeBytes ?? 0)
    },
    {
      name: "viji_conversations_total",
      help: "Count of known conversations returned by status.",
      type: "gauge",
      value: numberField(counts ?? {}, "conversations")
    },
    {
      name: "viji_pending_confirmations_total",
      help: "Count of resource confirmations waiting for WhatsApp recipient confirmation.",
      type: "gauge",
      value: numberField(counts ?? {}, "pendingConfirmations")
    },
    {
      name: "viji_blocked_jobs_total",
      help: "Count of currently blocked outbound jobs.",
      type: "gauge",
      value: numberField(counts ?? {}, "blockedJobs")
    },
    {
      name: "viji_recent_sync_runs_total",
      help: "Count of recent sync runs visible in status.",
      type: "gauge",
      value: numberField(counts ?? {}, "recentSyncRuns")
    },
    {
      name: "viji_active_backfill_jobs_total",
      help: "Count of queued, running, or paused backfill jobs.",
      type: "gauge",
      value: numberField(counts ?? {}, "activeBackfillJobs")
    },
    {
      name: "viji_active_media_download_jobs_total",
      help: "Count of queued or running media download jobs.",
      type: "gauge",
      value: numberField(counts ?? {}, "activeMediaDownloadJobs")
    },
    {
      name: "viji_live_poll_interval_ms",
      help: "Configured target live worker poll interval in milliseconds.",
      type: "gauge",
      value: numberField(live ?? {}, "pollIntervalMs")
    },
    {
      name: "viji_live_sync_interval_ms",
      help: "Configured scheduled adapter sync interval in milliseconds.",
      type: "gauge",
      value: numberField(live ?? {}, "syncIntervalMs")
    },
    {
      name: "viji_live_sync_scheduler_enabled",
      help: "Whether scheduled live sync is enabled.",
      type: "gauge",
      value: live?.syncSchedulerEnabled === false ? 0 : 1
    },
    {
      name: "viji_live_sync_before_poll_enabled",
      help: "Whether every live poll cycle forces a pre-poll adapter sync.",
      type: "gauge",
      value: live?.syncBeforePollEnabled === true ? 1 : 0
    },
    {
      name: "viji_live_media_drain_enabled",
      help: "Whether live worker media queue draining is enabled.",
      type: "gauge",
      value: live?.mediaDrainEnabled === false ? 0 : 1
    }
  ];

  for (const [state, value] of Object.entries(contextStates ?? {})) {
    samples.push({
      name: "viji_context_state_total",
      help: "Conversation count by context freshness state.",
      type: "gauge",
      labels: { state },
      value: typeof value === "number" && Number.isFinite(value) ? value : 0
    });
  }

  return renderPrometheusMetrics(samples);
}

async function handleRoute(
  options: ApiAppOptions,
  request: IncomingMessage,
  context: ApiRequestContext
): Promise<{ statusCode: number; payload: JsonValue }> {
  const repositories = createRepositories(options.db);
  const method = request.method ?? "GET";
  const path = context.url.pathname;

  if (method === "GET" && path === "/health") {
    return {
      statusCode: 200,
      payload: {
        ok: true,
        database: await getDatabaseHealth(options.db)
      }
    };
  }

  if (method === "GET" && path === "/status") {
    return {
      statusCode: 200,
      payload: await buildStatus(options)
    };
  }

  if (method === "GET" && path === "/dashboard/summary") {
    return {
      statusCode: 200,
      payload: await buildDashboardSummary(options)
    };
  }

  if (method === "GET" && path === "/storage/status") {
    return {
      statusCode: 200,
      payload: {
        storage: await getApiStorageStatus(options.env)
      }
    };
  }

  if (method === "GET" && path === "/sync/status") {
    return {
      statusCode: 200,
      payload: {
        syncRuns: await repositories.syncRuns.listRecentSyncRuns(
          parseLimit(context.url, 20)
        ),
        backfillJobs: await repositories.backfillJobs.listBackfillJobs(
          parseLimit(context.url, 20)
        )
      }
    };
  }

  if (method === "GET" && path === "/backfill/status") {
    return {
      statusCode: 200,
      payload: {
        backfillJobs: await repositories.backfillJobs.listBackfillJobs(
          parseLimit(context.url, 20)
        )
      }
    };
  }

  if (method === "GET" && path === "/media/jobs") {
    return {
      statusCode: 200,
      payload: {
        mediaJobs: await repositories.mediaJobs.listMediaDownloadJobs({
          state: parseMediaJobState(context.url.searchParams.get("state")),
          limit: parseLimit(context.url, 50)
        })
      }
    };
  }

  if (method === "GET" && path === "/conversations") {
    return {
      statusCode: 200,
      payload: {
        conversations: await repositories.conversations.listConversations(
          parseLimit(context.url, 50)
        )
      }
    };
  }

  if (method === "GET" && path === "/drafts") {
    return {
      statusCode: 200,
      payload: {
        drafts: await repositories.drafts.listDrafts({
          limit: parseLimit(context.url, 50)
        })
      }
    };
  }

  if (method === "GET" && path === "/confirmations") {
    return {
      statusCode: 200,
      payload: {
        confirmations: await repositories.drafts.listDrafts({
          policyState: "confirm_resource",
          limit: parseLimit(context.url, 50)
        })
      }
    };
  }

  if (method === "GET" && path === "/outbox") {
    const state = context.url.searchParams.get("state");
    return {
      statusCode: 200,
      payload: {
        jobs: (
          await repositories.outbox.listJobs({
            state:
              state === "queued" ||
              state === "sending" ||
              state === "sent" ||
              state === "failed" ||
              state === "cancelled" ||
              state === "blocked"
                ? state
                : undefined,
            limit: parseLimit(context.url, 50)
          })
        ).map(redactOutboxJob)
      }
    };
  }

  if (method === "GET" && path === "/audit") {
    return {
      statusCode: 200,
      payload: {
        auditEvents: await repositories.auditEvents.listAuditEvents(
          parseLimit(context.url, 50)
        )
      }
    };
  }

  if (method === "GET" && path === "/resources") {
    return {
      statusCode: 200,
      payload: {
        resources: await repositories.resources.listSearchableFileResources({
          limit: parseLimit(context.url, 100)
        })
      }
    };
  }

  if (method === "POST" && path === "/resources/register") {
    const body = requireObject(context.body);
    const runtimePaths = getRuntimePaths(options.env);
    const draft = await buildFileResourceRegistration({
      resourceRoot: runtimePaths.resourceRoot,
      filePath: requireStringField(body, "path"),
      title: optionalStringField(body, "title"),
      aliases: optionalStringArrayField(body, "aliases"),
      description: optionalNullableStringField(body, "description")
    });
    const resource = await repositories.resources.registerFileResource(draft);
    const extraction = await extractResourceContentIfEnabled({
      db: options.db,
      resourceId: resource.resourceId,
      resourceRoot: runtimePaths.resourceRoot,
      enabled: optionalBooleanField(body, "extractContent") ?? true
    });

    await repositories.auditEvents.recordAuditEvent({
      type: "resource.registered",
      severity: "info",
      detail: {
        resourceId: resource.resourceId,
        registeredFileName: resource.registeredFileName,
        mimeType: draft.mimeType,
        sizeBytes: draft.sizeBytes
      }
    });

    return {
      statusCode: 201,
      payload: {
        resource,
        extraction
      }
    };
  }

  if (method === "POST" && path === "/resources/index") {
    const body = requireObject(context.body);
    const runtimePaths = getRuntimePaths(options.env);
    const scope = parseResourceIndexScope(body.scope);
    const drafts = await scanResourceDirectory({
      resourceRoot: runtimePaths.resourceRoot,
      scope,
      limit: parseBodyLimit(body, 100)
    });
    const resources = await Promise.all(
      drafts.map((draft) => repositories.resources.registerFileResource(draft))
    );
    const extractContent = optionalBooleanField(body, "extractContent") ?? true;
    const extractions = [];
    if (extractContent) {
      for (const resource of resources) {
        extractions.push({
          resourceId: resource.resourceId,
          ...(await extractResourceContentIfEnabled({
            db: options.db,
            resourceId: resource.resourceId,
            resourceRoot: runtimePaths.resourceRoot,
            enabled: true
          }))
        });
      }
    }

    await repositories.auditEvents.recordAuditEvent({
      type: "resource.indexed",
      severity: "info",
      detail: {
        count: resources.length,
        scope: scope ?? "all",
        extracted: extractions.length
      }
    });

    return {
      statusCode: 200,
      payload: {
        count: resources.length,
        resources,
        extractions
      }
    };
  }

  if (method === "GET" && path === "/policy") {
    return {
      statusCode: 200,
      payload: {
        policies: await repositories.policies.listPolicies(parseLimit(context.url, 50))
      }
    };
  }

  if (method === "POST" && path === "/policy/mode") {
    const body = requireObject(context.body);
    const mode = body.mode;
    if (!isResponsePolicyMode(mode)) {
      throw badRequest("mode must be auto, confirm_resource, readonly, or paused");
    }

    const result = await repositories.policies.setAllowlistedContactPoliciesMode(mode);
    await repositories.auditEvents.recordAuditEvent({
      type: "policy.mode_changed",
      severity: "info",
      detail: { ...result }
    });
    return {
      statusCode: 200,
      payload: {
        policy: result
      }
    };
  }

  const confirmMatch = path.match(/^\/confirmations\/([^/]+)\/confirm$/);
  if (method === "POST" && confirmMatch) {
    return {
      statusCode: 409,
      payload: {
        error: {
          code: ERROR_CODES.policy.recipientConfirmationRequired,
          message:
            "Resource confirmation must arrive from the allowlisted WhatsApp recipient, not the dashboard or API.",
          agentDraftId: confirmMatch[1]
        }
      }
    };
  }

  const denyMatch = path.match(/^\/confirmations\/([^/]+)\/deny$/);
  if (method === "POST" && denyMatch) {
    const result = await denyResourceProposal(options.db, {
      agentDraftId: denyMatch[1]
    });
    return {
      statusCode: 200,
      payload: {
        result
      }
    };
  }

  return {
    statusCode: 404,
    payload: {
      error: {
        code: ERROR_CODES.system.invalidState,
        message: `Route not found: ${method} ${path}`
      }
    }
  };
}

export function createApiServer(options: ApiAppOptions): Server {
  const token = options.token || options.env?.VIJI_API_TOKEN || "change-me-api-token";

  return createServer(async (request, response) => {
    const correlationId =
      getHeaderValue(request, "x-correlation-id") || randomUUID();
    const host = getHeaderValue(request, "host") || "127.0.0.1";
    const url = new URL(request.url || "/", `http://${host}`);

    try {
      if (request.method === "GET" && url.pathname === "/metrics") {
        sendText(
          response,
          200,
          "text/plain; version=0.0.4; charset=utf-8",
          await buildMetrics(options)
        );
        return;
      }

      if (!isAuthorized(request, token)) {
        sendJson(response, 401, correlationId, {
          error: {
            code: ERROR_CODES.system.invalidConfig,
            message: "Unauthorized"
          }
        });
        return;
      }

      const body = await readJsonBody(request);
      const routeResult = await handleRoute(options, request, {
        correlationId,
        url,
        body
      });
      sendJson(response, routeResult.statusCode, correlationId, routeResult.payload);
    } catch (error) {
      const statusCode = error instanceof Error && error.name === "BadRequest" ? 400 : 500;
      sendJson(response, statusCode, correlationId, {
        error: {
          code:
            statusCode === 400
              ? ERROR_CODES.system.invalidConfig
              : ERROR_CODES.system.invalidState,
          message: toErrorMessage(error)
        }
      });
    }
  });
}
