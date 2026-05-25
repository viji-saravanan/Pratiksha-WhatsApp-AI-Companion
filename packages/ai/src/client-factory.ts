import { ERROR_CODES, VijiError } from "@viji/shared";

import type { EmbeddingClient } from "./embedding-client.interface.js";
import type { LlmClient } from "./llm-client.interface.js";
import {
  createOllamaLlmClient,
  embedTextWithOllama,
  getOllamaLlmConfigFromEnv
} from "./ollama-client.js";
import { createDeterministicTestLlmClient } from "./test-llm-client.js";

export type LlmProvider = "deterministic" | "ollama";

function normalizeProvider(value: string | undefined): LlmProvider {
  const normalized = (value || "deterministic").trim().toLowerCase();
  if (normalized === "deterministic" || normalized === "test") {
    return "deterministic";
  }

  if (normalized === "ollama") {
    return "ollama";
  }

  throw new VijiError({
    code: ERROR_CODES.system.invalidConfig,
    message: `Unsupported VIJI_LLM_PROVIDER: ${value}`
  });
}

export function getLlmModelNameFromEnv(
  env: NodeJS.ProcessEnv = process.env
): string {
  const provider = normalizeProvider(env.VIJI_LLM_PROVIDER);
  if (provider === "ollama") {
    return getOllamaLlmConfigFromEnv(env).model;
  }

  return env.VIJI_TEST_LLM_MODEL || "deterministic-test-llm";
}

export function createLlmClientFromEnv(
  env: NodeJS.ProcessEnv = process.env
): LlmClient {
  const provider = normalizeProvider(env.VIJI_LLM_PROVIDER);
  if (provider === "ollama") {
    return createOllamaLlmClient(getOllamaLlmConfigFromEnv(env));
  }

  return createDeterministicTestLlmClient({
    modelName: getLlmModelNameFromEnv(env)
  });
}

function deterministicVector(text: string, dimensions: number): number[] {
  const vector = Array.from({ length: dimensions }, () => 0);
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  for (const token of tokens.length > 0 ? tokens : [text]) {
    let hash = 2166136261;
    for (const char of token) {
      hash ^= char.charCodeAt(0);
      hash = Math.imul(hash, 16777619);
    }
    const index = Math.abs(hash) % dimensions;
    vector[index] += 1;
  }

  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  return magnitude > 0 ? vector.map((value) => value / magnitude) : vector;
}

export function createEmbeddingClientFromEnv(
  env: NodeJS.ProcessEnv = process.env
): EmbeddingClient {
  const provider = normalizeProvider(env.VIJI_LLM_PROVIDER);
  if (provider === "ollama") {
    const config = getOllamaLlmConfigFromEnv(env);
    return {
      async embedText(input) {
        return embedTextWithOllama(config, input);
      }
    };
  }

  const dimensions = Number(env.VIJI_TEST_EMBEDDING_DIMENSIONS ?? 16);
  const safeDimensions = Number.isInteger(dimensions) && dimensions > 0
    ? dimensions
    : 16;
  return {
    async embedText(input) {
      return {
        modelName: input.modelName ?? env.VIJI_TEST_EMBEDDING_MODEL ?? "deterministic-test-embedding",
        vector: deterministicVector(input.text, safeDimensions),
        dimensions: safeDimensions,
        latencyMs: 0,
        inputTokens: Math.max(1, input.text.trim().split(/\s+/).filter(Boolean).length)
      };
    }
  };
}
