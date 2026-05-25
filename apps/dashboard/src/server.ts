import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer, type Server } from "node:http";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ERROR_CODES, isDirectNodeEntrypoint, toErrorMessage } from "@viji/shared";
import { renderPrometheusMetrics } from "@viji/shared";
import { getDashboardConfigFromEnv, type DashboardConfig } from "./config.js";
import {
  createDockerContainerLogsReader,
  type ContainerLogsReader
} from "./container-logs.js";
import { saveDashboardResourceUpload } from "./resource-upload.js";

export interface DashboardServerOptions {
  assetRoot?: string;
  containerLogsReader?: ContainerLogsReader;
}

interface ProxyDecision {
  allowed: boolean;
  statusCode?: number;
  payload?: Record<string, unknown>;
}

const DEFAULT_ASSET_ROOT = fileURLToPath(new URL("./assets", import.meta.url));
const STATIC_FILES = new Map<string, { fileName: string; contentType: string }>([
  ["/", { fileName: "index.html", contentType: "text/html; charset=utf-8" }],
  ["/index.html", { fileName: "index.html", contentType: "text/html; charset=utf-8" }],
  ["/styles.css", { fileName: "styles.css", contentType: "text/css; charset=utf-8" }],
  ["/app.js", { fileName: "app.js", contentType: "application/javascript; charset=utf-8" }]
]);
const SAFE_GET_PATHS = new Set([
  "/health",
  "/status",
  "/dashboard/summary",
  "/storage/status",
  "/sync/status",
  "/backfill/status",
  "/media/jobs",
  "/media/transcripts",
  "/conversations",
  "/drafts",
  "/confirmations",
  "/outbox",
  "/audit",
  "/resources",
  "/policy"
]);

function parseTail(url: URL, defaultTail: number): number {
  const raw = url.searchParams.get("tail");
  if (!raw) {
    return defaultTail;
  }

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 1000) {
    throw new Error("tail must be an integer from 1 to 1000");
  }

  return parsed;
}

function getHeaderValue(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function sendJson(
  response: ServerResponse,
  statusCode: number,
  payload: Record<string, unknown>
): void {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8"
  });
  response.end(JSON.stringify(payload));
}

function getProxyDecision(method: string, upstreamPath: string): ProxyDecision {
  if (method === "GET" && SAFE_GET_PATHS.has(upstreamPath)) {
    return { allowed: true };
  }

  if (method === "POST" && /^\/confirmations\/[^/]+\/confirm$/.test(upstreamPath)) {
    return {
      allowed: false,
      statusCode: 409,
      payload: {
        error: {
          code: ERROR_CODES.policy.recipientConfirmationRequired,
          message:
            "Resource confirmation must arrive from Vijayalakshmi in WhatsApp. The dashboard can inspect or deny only."
        }
      }
    };
  }

  if (
    method === "POST" &&
    (upstreamPath === "/policy/mode" ||
      upstreamPath === "/resources/index" ||
      upstreamPath === "/resources/register" ||
      /^\/confirmations\/[^/]+\/deny$/.test(upstreamPath))
  ) {
    return { allowed: true };
  }

  return {
    allowed: false,
    statusCode: 405,
    payload: {
      error: {
        code: ERROR_CODES.system.invalidState,
        message: `Dashboard proxy does not allow ${method} ${upstreamPath}`
      }
    }
  };
}

async function readBody(
  request: IncomingMessage,
  maxBytes = Number.POSITIVE_INFINITY
): Promise<Buffer | undefined> {
  if (request.method === "GET" || request.method === "HEAD") {
    return undefined;
  }

  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.byteLength;
    if (totalBytes > maxBytes) {
      throw new Error(`Request body exceeds ${maxBytes} bytes.`);
    }
    chunks.push(buffer);
  }

  return Buffer.concat(chunks);
}

async function serveStatic(
  response: ServerResponse,
  assetRoot: string,
  path: string
): Promise<void> {
  const asset = STATIC_FILES.get(path);
  if (!asset) {
    sendJson(response, 404, {
      error: {
        code: ERROR_CODES.system.invalidState,
        message: "Dashboard asset not found"
      }
    });
    return;
  }

  const filePath = resolve(assetRoot, asset.fileName);
  const body = await readFile(filePath);
  response.writeHead(200, {
    "content-type": asset.contentType,
    "cache-control": "no-store"
  });
  response.end(body);
}

async function proxyApiRequest(
  config: DashboardConfig,
  request: IncomingMessage,
  response: ServerResponse,
  url: URL
): Promise<void> {
  const method = request.method ?? "GET";
  const upstreamPath = url.pathname.replace(/^\/api/, "") || "/";
  const decision = getProxyDecision(method, upstreamPath);
  if (!decision.allowed) {
    sendJson(response, decision.statusCode ?? 405, decision.payload ?? {});
    return;
  }

  const upstreamUrl = new URL(upstreamPath + url.search, config.apiBaseUrl);
  const body = await readBody(request);
  const headers: Record<string, string> = {
    authorization: `Bearer ${config.apiToken}`,
    "x-correlation-id": getHeaderValue(request, "x-correlation-id") || randomUUID()
  };
  const contentType = getHeaderValue(request, "content-type");
  if (contentType) {
    headers["content-type"] = contentType;
  }

  const upstreamResponse = await fetch(upstreamUrl, {
    method,
    headers,
    body: body && body.byteLength > 0 ? body.toString("utf8") : undefined
  });
  const responseBody = Buffer.from(await upstreamResponse.arrayBuffer());
  response.writeHead(upstreamResponse.status, {
    "content-type":
      upstreamResponse.headers.get("content-type") || "application/json; charset=utf-8",
    "x-dashboard-proxy": "viji-helper"
  });
  response.end(responseBody);
}

async function serveContainerLogs(
  config: DashboardConfig,
  reader: ContainerLogsReader,
  response: ServerResponse,
  url: URL
): Promise<void> {
  const service = url.searchParams.get("service") || "all";
  const tail = parseTail(url, config.containerLogs.defaultTail);
  const payload = await reader.read({ service, tail });
  sendJson(response, 200, { containerLogs: payload });
}

function serveMetrics(response: ServerResponse): void {
  response.writeHead(200, {
    "content-type": "text/plain; version=0.0.4; charset=utf-8"
  });
  response.end(
    renderPrometheusMetrics([
      {
        name: "viji_dashboard_up",
        help: "Viji dashboard process is responding to metrics scrapes.",
        type: "gauge",
        value: 1
      }
    ])
  );
}

async function serveResourceUpload(
  config: DashboardConfig,
  request: IncomingMessage,
  response: ServerResponse
): Promise<void> {
  const body = await readBody(request, config.upload.maxBytes);
  if (!body) {
    throw new Error("Upload request body is empty.");
  }

  const upload = await saveDashboardResourceUpload(
    config.upload,
    getHeaderValue(request, "content-type"),
    body
  );
  const upstreamUrl = new URL("/resources/register", config.apiBaseUrl);
  const upstreamResponse = await fetch(upstreamUrl, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.apiToken}`,
      "content-type": "application/json; charset=utf-8",
      "x-correlation-id": getHeaderValue(request, "x-correlation-id") || randomUUID()
    },
    body: JSON.stringify({
      path: upload.relativePath,
      title: upload.title,
      aliases: upload.aliases,
      description: upload.description
    })
  });
  const payload = Buffer.from(await upstreamResponse.arrayBuffer());
  response.writeHead(upstreamResponse.status, {
    "content-type":
      upstreamResponse.headers.get("content-type") || "application/json; charset=utf-8",
    "x-dashboard-proxy": "viji-helper"
  });
  response.end(payload);
}

export function createDashboardServer(
  config: DashboardConfig = getDashboardConfigFromEnv(),
  options: DashboardServerOptions = {}
): Server {
  const assetRoot = options.assetRoot || DEFAULT_ASSET_ROOT;
  const containerLogsReader =
    options.containerLogsReader || createDockerContainerLogsReader(config.containerLogs);

  return createServer(async (request, response) => {
    const host = getHeaderValue(request, "host") || `${config.host}:${config.port}`;
    const url = new URL(request.url || "/", `http://${host}`);

    try {
      if (request.method === "GET" && url.pathname === "/metrics") {
        serveMetrics(response);
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/resources/upload") {
        await serveResourceUpload(config, request, response);
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/container-logs") {
        await serveContainerLogs(config, containerLogsReader, response, url);
        return;
      }

      if (url.pathname.startsWith("/api/")) {
        await proxyApiRequest(config, request, response, url);
        return;
      }

      await serveStatic(response, assetRoot, url.pathname);
    } catch (error) {
      sendJson(response, 502, {
        error: {
          code: ERROR_CODES.system.invalidState,
          message: `Dashboard request failed: ${toErrorMessage(error)}`
        }
      });
    }
  });
}

if (isDirectNodeEntrypoint(import.meta.url)) {
  const config = getDashboardConfigFromEnv();
  createDashboardServer(config).listen(config.port, config.host, () => {
    console.log(`Viji dashboard listening on http://${config.host}:${config.port}`);
  });
}
