import { ERROR_CODES, VijiError } from "@viji/shared";

import type { LlmClient } from "./llm-client.interface.js";
import {
  createOllamaLlmClient,
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
