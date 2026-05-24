import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer, type Server } from "node:http";

import {
  createOllamaLlmClient,
  embedTextWithOllama,
  getOllamaLlmConfigFromEnv,
  getOllamaModelHealth
} from "@viji/ai";
import {
  ERROR_CODES,
  isVijiError,
  renderPrometheusMetrics,
  toErrorMessage
} from "@viji/shared";

export interface LlmProxyAppOptions {
  env?: NodeJS.ProcessEnv;
  token?: string;
  fetchImpl?: typeof fetch;
}

interface RequestContext {
  correlationId: string;
  url: URL;
  body: unknown;
}

type JsonPayload = Record<string, unknown> | unknown[];

function getHeaderValue(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function isAuthorized(request: IncomingMessage, token: string): boolean {
  const authorization = getHeaderValue(request, "authorization");
  const headerToken = getHeaderValue(request, "x-viji-llm-token");
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
  return raw ? (JSON.parse(raw) as unknown) : {};
}

function sendJson(
  response: ServerResponse,
  statusCode: number,
  correlationId: string,
  payload: JsonPayload
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

async function handleRoute(
  options: LlmProxyAppOptions,
  request: IncomingMessage,
  context: RequestContext
): Promise<{ statusCode: number; payload: JsonPayload }> {
  const method = request.method ?? "GET";
  const path = context.url.pathname;
  const config = getOllamaLlmConfigFromEnv(options.env);
  const ollamaConfig = {
    ...config,
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {})
  };

  if (method === "GET" && path === "/health") {
    const health = await getOllamaModelHealth(ollamaConfig);
    const embeddingHealth = await getOllamaModelHealth({
      ...ollamaConfig,
      model: config.embeddingModel ?? config.model
    });
    const ok = health.status === "healthy" && embeddingHealth.status === "healthy";
    return {
      statusCode: ok ? 200 : 503,
      payload: {
        ok,
        provider: "ollama",
        model: health,
        embeddingModel: embeddingHealth
      }
    };
  }

  if (method === "POST" && path === "/generate-draft") {
    const body = requireObject(context.body);
    const prompt = body.prompt;
    const promptHash = body.promptHash;
    const modelName = typeof body.modelName === "string" ? body.modelName : config.model;

    if (typeof prompt !== "string" || typeof promptHash !== "string") {
      throw badRequest("prompt and promptHash are required strings");
    }

    const llmClient = createOllamaLlmClient(ollamaConfig);
    const result = await llmClient.generateDraft({
      prompt,
      promptHash,
      modelName
    });

    return {
      statusCode: 200,
      payload: {
        draft: result
      }
    };
  }

  if (method === "POST" && path === "/embed") {
    const body = requireObject(context.body);
    const text = body.text;
    const modelName =
      typeof body.modelName === "string"
        ? body.modelName
        : config.embeddingModel ?? config.model;

    if (typeof text !== "string" || !text.trim()) {
      throw badRequest("text is required");
    }

    const result = await embedTextWithOllama(ollamaConfig, {
      text,
      modelName
    });

    return {
      statusCode: 200,
      payload: {
        embedding: result
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

export function createLlmProxyServer(options: LlmProxyAppOptions = {}): Server {
  const token = options.token || options.env?.VIJI_LLM_PROXY_TOKEN || "local-llm-token";

  return createServer(async (request, response) => {
    const correlationId =
      getHeaderValue(request, "x-correlation-id") || randomUUID();
    const host = getHeaderValue(request, "host") || "127.0.0.1";
    const url = new URL(request.url || "/", `http://${host}`);

    try {
      if (request.method === "GET" && url.pathname === "/metrics") {
        const config = getOllamaLlmConfigFromEnv(options.env);
        sendText(
          response,
          200,
          "text/plain; version=0.0.4; charset=utf-8",
          renderPrometheusMetrics([
            {
              name: "viji_llm_proxy_up",
              help: "Viji LLM proxy process is responding to metrics scrapes.",
              type: "gauge",
              value: 1
            },
            {
              name: "viji_llm_generation_model_configured",
              help: "Configured local generation model.",
              type: "gauge",
              labels: { model: config.model },
              value: 1
            },
            {
              name: "viji_llm_embedding_model_configured",
              help: "Configured local embedding model.",
              type: "gauge",
              labels: { model: config.embeddingModel ?? config.model },
              value: 1
            }
          ])
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
              : isVijiError(error)
                ? error.code
                : ERROR_CODES.system.invalidState,
          message: toErrorMessage(error)
        }
      });
    }
  });
}
