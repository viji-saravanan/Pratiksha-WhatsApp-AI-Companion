import { ERROR_CODES, VijiError } from "@viji/shared";

import type {
  GenerateDraftInput,
  GenerateDraftResult,
  LlmClient
} from "./llm-client.interface.js";
import { enforceDraftPolicyText } from "./safety.js";

export type OllamaModelHealthStatus = "healthy" | "missing" | "unavailable";

export interface OllamaLlmConfig {
  baseUrl: string;
  model: string;
  embeddingModel?: string;
  timeoutMs: number;
  temperature: number;
  numPredict: number;
  contextWindowTokens: number;
}

export interface OllamaLlmClientOptions extends OllamaLlmConfig {
  fetchImpl?: typeof fetch;
}

export interface OllamaModelHealth {
  status: OllamaModelHealthStatus;
  baseUrl: string;
  model: string;
  sizeBytes?: number;
  digest?: string;
  details?: Record<string, unknown>;
  errorCode?: string;
  errorMessage?: string;
}

export interface OllamaEmbeddingResult {
  modelName: string;
  vector: number[];
  dimensions: number;
  latencyMs: number;
  inputTokens?: number;
}

interface OllamaGenerateResponse {
  response?: string;
  prompt_eval_count?: number;
  eval_count?: number;
  error?: string;
}

interface StructuredDraftResponse {
  reply_text?: string;
  replyText?: string;
  intent?: string;
  resource_query?: string | null;
  resourceQuery?: string | null;
  confidence?: number;
  refusal_reason?: string | null;
  refusalReason?: string | null;
}

interface OllamaTagsResponse {
  models?: Array<{
    name?: string;
    model?: string;
    size?: number;
    digest?: string;
    details?: Record<string, unknown>;
  }>;
}

interface OllamaEmbedResponse {
  embeddings?: number[][];
  embedding?: number[];
  prompt_eval_count?: number;
}

const DEFAULT_BASE_URL = "http://127.0.0.1:11434";
const DEFAULT_MODEL = "qwen3:4b-instruct-2507-q4_K_M";
const DEFAULT_EMBEDDING_MODEL = "mxbai-embed-large";
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_TEMPERATURE = 0.2;
const DEFAULT_NUM_PREDICT = 160;
const DEFAULT_CONTEXT_WINDOW_TOKENS = 4096;
const DRAFT_RESPONSE_FORMAT = {
  type: "object",
  properties: {
    reply_text: { type: "string" },
    intent: {
      type: "string",
      enum: ["text_reply", "resource_request", "clarification", "refusal"]
    },
    resource_query: { type: ["string", "null"] },
    confidence: { type: "number" },
    refusal_reason: { type: ["string", "null"] }
  },
  required: ["reply_text", "intent"],
  additionalProperties: false
};

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

function parsePositiveInteger(
  raw: string | undefined,
  fallback: number,
  name: string
): number {
  if (!raw) {
    return fallback;
  }

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new VijiError({
      code: ERROR_CODES.system.invalidConfig,
      message: `${name} must be a positive integer`
    });
  }

  return parsed;
}

function parseNumberInRange(
  raw: string | undefined,
  fallback: number,
  name: string,
  min: number,
  max: number
): number {
  if (!raw) {
    return fallback;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw new VijiError({
      code: ERROR_CODES.system.invalidConfig,
      message: `${name} must be a number from ${min} to ${max}`
    });
  }

  return parsed;
}

function estimateTokens(text: string): number {
  const trimmed = text.trim();
  return trimmed ? Math.ceil(trimmed.split(/\s+/).length * 1.2) : 0;
}

function parseStructuredDraft(raw: string): {
  text: string;
  intent?: GenerateDraftResult["intent"];
  resourceQuery?: string | null;
  refusalReason?: string | null;
  confidence?: number;
} {
  try {
    const parsed = JSON.parse(raw) as StructuredDraftResponse;
    if (!parsed || typeof parsed !== "object") {
      return { text: raw };
    }

    const replyText = parsed.reply_text ?? parsed.replyText;
    if (typeof replyText !== "string" || !replyText.trim()) {
      return { text: raw };
    }

    const intent =
      parsed.intent === "text_reply" ||
      parsed.intent === "resource_request" ||
      parsed.intent === "clarification" ||
      parsed.intent === "refusal"
        ? parsed.intent
        : undefined;
    const resourceQuery = parsed.resource_query ?? parsed.resourceQuery ?? null;
    const refusalReason = parsed.refusal_reason ?? parsed.refusalReason ?? null;
    const confidence =
      typeof parsed.confidence === "number" &&
      Number.isFinite(parsed.confidence) &&
      parsed.confidence >= 0 &&
      parsed.confidence <= 1
        ? parsed.confidence
        : undefined;

    return {
      text: replyText,
      ...(intent ? { intent } : {}),
      resourceQuery:
        typeof resourceQuery === "string" && resourceQuery.trim()
          ? resourceQuery.trim()
          : null,
      refusalReason:
        typeof refusalReason === "string" && refusalReason.trim()
          ? refusalReason.trim()
          : null,
      ...(confidence !== undefined ? { confidence } : {})
    };
  } catch {
    return { text: raw };
  }
}

async function readJson<TValue>(
  response: Response,
  failureCode: typeof ERROR_CODES.ai.modelMissing | typeof ERROR_CODES.ai.modelUnavailable
): Promise<TValue> {
  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    throw new VijiError({
      code: failureCode,
      message: "Ollama returned invalid JSON",
      cause: error
    });
  }

  return body as TValue;
}

function errorCodeForOllamaFailure(
  status: number,
  message: string
): typeof ERROR_CODES.ai.modelMissing | typeof ERROR_CODES.ai.modelUnavailable {
  if (status === 404 || /not found|pull model/i.test(message)) {
    return ERROR_CODES.ai.modelMissing;
  }

  return ERROR_CODES.ai.modelUnavailable;
}

function asVijiModelUnavailable(error: unknown, baseUrl: string): VijiError {
  if (error instanceof VijiError) {
    return error;
  }

  const message = error instanceof Error ? error.message : "Unknown Ollama error";
  return new VijiError({
    code: ERROR_CODES.ai.modelUnavailable,
    message: `Ollama is unavailable at ${baseUrl}: ${message}`,
    cause: error
  });
}

function ollamaModelNameMatches(candidate: string | undefined, configured: string): boolean {
  if (!candidate) {
    return false;
  }

  return (
    candidate === configured ||
    (!configured.includes(":") && candidate === `${configured}:latest`)
  );
}

function createAbortController(timeoutMs: number): {
  controller: AbortController;
  cancel: () => void;
} {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  return {
    controller,
    cancel: () => clearTimeout(timeout)
  };
}

export function getOllamaLlmConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env
): OllamaLlmConfig {
  return {
    baseUrl: normalizeBaseUrl(env.VIJI_OLLAMA_BASE_URL || DEFAULT_BASE_URL),
    model: env.VIJI_OLLAMA_MODEL || DEFAULT_MODEL,
    embeddingModel: env.VIJI_OLLAMA_EMBEDDING_MODEL || DEFAULT_EMBEDDING_MODEL,
    timeoutMs: parsePositiveInteger(
      env.VIJI_OLLAMA_TIMEOUT_MS,
      DEFAULT_TIMEOUT_MS,
      "VIJI_OLLAMA_TIMEOUT_MS"
    ),
    temperature: parseNumberInRange(
      env.VIJI_OLLAMA_TEMPERATURE,
      DEFAULT_TEMPERATURE,
      "VIJI_OLLAMA_TEMPERATURE",
      0,
      2
    ),
    numPredict: parsePositiveInteger(
      env.VIJI_OLLAMA_NUM_PREDICT,
      DEFAULT_NUM_PREDICT,
      "VIJI_OLLAMA_NUM_PREDICT"
    ),
    contextWindowTokens: parsePositiveInteger(
      env.VIJI_OLLAMA_CONTEXT_WINDOW_TOKENS,
      DEFAULT_CONTEXT_WINDOW_TOKENS,
      "VIJI_OLLAMA_CONTEXT_WINDOW_TOKENS"
    )
  };
}

export async function getOllamaModelHealth(
  options: OllamaLlmClientOptions
): Promise<OllamaModelHealth> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const timeout = createAbortController(options.timeoutMs);

  try {
    const response = await fetchImpl(`${baseUrl}/api/tags`, {
      method: "GET",
      signal: timeout.controller.signal
    });

    if (!response.ok) {
      return {
        status: "unavailable",
        baseUrl,
        model: options.model,
        errorCode: ERROR_CODES.ai.modelUnavailable,
        errorMessage: `Ollama tags request failed with HTTP ${response.status}`
      };
    }

    const payload = await readJson<OllamaTagsResponse>(
      response,
      ERROR_CODES.ai.modelUnavailable
    );
    const model = (payload.models ?? []).find(
      (item) =>
        ollamaModelNameMatches(item.name, options.model) ||
        ollamaModelNameMatches(item.model, options.model)
    );

    if (!model) {
      return {
        status: "missing",
        baseUrl,
        model: options.model,
        errorCode: ERROR_CODES.ai.modelMissing,
        errorMessage: `Configured Ollama model is not pulled: ${options.model}`
      };
    }

    return {
      status: "healthy",
      baseUrl,
      model: options.model,
      ...(typeof model.size === "number" ? { sizeBytes: model.size } : {}),
      ...(model.digest ? { digest: model.digest } : {}),
      ...(model.details ? { details: model.details } : {})
    };
  } catch (error) {
    const vijiError = asVijiModelUnavailable(error, baseUrl);
    return {
      status: "unavailable",
      baseUrl,
      model: options.model,
      errorCode: vijiError.code,
      errorMessage: vijiError.message
    };
  } finally {
    timeout.cancel();
  }
}

function firstEmbeddingVector(payload: OllamaEmbedResponse): number[] {
  if (
    Array.isArray(payload.embeddings) &&
    Array.isArray(payload.embeddings[0]) &&
    payload.embeddings[0].every((value) => typeof value === "number")
  ) {
    return payload.embeddings[0];
  }

  if (
    Array.isArray(payload.embedding) &&
    payload.embedding.every((value) => typeof value === "number")
  ) {
    return payload.embedding;
  }

  throw new VijiError({
    code: ERROR_CODES.ai.modelUnavailable,
    message: "Ollama returned an invalid embedding response"
  });
}

export async function embedTextWithOllama(
  options: OllamaLlmClientOptions,
  input: { text: string; modelName?: string }
): Promise<OllamaEmbeddingResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const modelName = input.modelName ?? options.embeddingModel ?? options.model;
  const startedAt = Date.now();
  const timeout = createAbortController(options.timeoutMs);

  try {
    const response = await fetchImpl(`${baseUrl}/api/embed`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      signal: timeout.controller.signal,
      body: JSON.stringify({
        model: modelName,
        input: input.text
      })
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      const message = body || `HTTP ${response.status}`;
      throw new VijiError({
        code: errorCodeForOllamaFailure(response.status, message),
        message: `Ollama embedding failed: ${message}`
      });
    }

    const payload = await readJson<OllamaEmbedResponse>(
      response,
      ERROR_CODES.ai.modelUnavailable
    );
    const vector = firstEmbeddingVector(payload);

    return {
      modelName,
      vector,
      dimensions: vector.length,
      latencyMs: Date.now() - startedAt,
      ...(typeof payload.prompt_eval_count === "number"
        ? { inputTokens: payload.prompt_eval_count }
        : {})
    };
  } catch (error) {
    if (error instanceof VijiError) {
      throw error;
    }

    if (error instanceof Error && error.name === "AbortError") {
      throw new VijiError({
        code: ERROR_CODES.ai.modelUnavailable,
        message: `Ollama embedding timed out after ${options.timeoutMs}ms`,
        cause: error
      });
    }

    throw asVijiModelUnavailable(error, baseUrl);
  } finally {
    timeout.cancel();
  }
}

export function createOllamaLlmClient(options: OllamaLlmClientOptions): LlmClient {
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = normalizeBaseUrl(options.baseUrl);

  return {
    async generateDraft(input: GenerateDraftInput): Promise<GenerateDraftResult> {
      const startedAt = Date.now();
      const timeout = createAbortController(options.timeoutMs);

      try {
        const response = await fetchImpl(`${baseUrl}/api/generate`, {
          method: "POST",
          headers: {
            "content-type": "application/json"
          },
          signal: timeout.controller.signal,
          body: JSON.stringify({
            model: options.model,
            prompt: input.prompt,
            stream: false,
            format: DRAFT_RESPONSE_FORMAT,
            options: {
              temperature: options.temperature,
              num_predict: options.numPredict,
              num_ctx: options.contextWindowTokens
            }
          })
        });

        if (!response.ok) {
          const body = await response.text().catch(() => "");
          const message = body || `HTTP ${response.status}`;
          throw new VijiError({
            code: errorCodeForOllamaFailure(response.status, message),
            message: `Ollama generation failed: ${message}`
          });
        }

        const payload = await readJson<OllamaGenerateResponse>(
          response,
          ERROR_CODES.ai.modelUnavailable
        );

        if (payload.error) {
          throw new VijiError({
            code: errorCodeForOllamaFailure(500, payload.error),
            message: `Ollama generation failed: ${payload.error}`
          });
        }

        const structured = parseStructuredDraft(payload.response ?? "");
        const text = enforceDraftPolicyText(structured.text);
        if (!text) {
          throw new VijiError({
            code: ERROR_CODES.ai.promptRejected,
            message: "Ollama returned an empty draft"
          });
        }

        return {
          text,
          modelName: options.model,
          latencyMs: Date.now() - startedAt,
          inputTokens:
            typeof payload.prompt_eval_count === "number"
              ? payload.prompt_eval_count
              : estimateTokens(input.prompt),
          outputTokens:
            typeof payload.eval_count === "number"
              ? payload.eval_count
              : estimateTokens(text),
          confidence: structured.confidence ?? 0.75,
          ...(structured.intent ? { intent: structured.intent } : {}),
          ...(structured.resourceQuery !== undefined
            ? { resourceQuery: structured.resourceQuery }
            : {}),
          ...(structured.refusalReason !== undefined
            ? { refusalReason: structured.refusalReason }
            : {})
        };
      } catch (error) {
        if (error instanceof VijiError) {
          throw error;
        }

        if (error instanceof Error && error.name === "AbortError") {
          throw new VijiError({
            code: ERROR_CODES.ai.modelUnavailable,
            message: `Ollama generation timed out after ${options.timeoutMs}ms`,
            cause: error
          });
        }

        throw asVijiModelUnavailable(error, baseUrl);
      } finally {
        timeout.cancel();
      }
    }
  };
}
