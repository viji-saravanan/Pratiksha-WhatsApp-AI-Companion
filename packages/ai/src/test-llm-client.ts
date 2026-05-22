import { ERROR_CODES, VijiError } from "@viji/shared";

import type {
  GenerateDraftInput,
  GenerateDraftResult,
  LlmClient
} from "./llm-client.interface.js";

export interface DeterministicTestLlmOptions {
  modelName?: string;
  fail?: boolean;
  failureMessage?: string;
}

function latestMessagePreview(prompt: string): string {
  const marker = "Latest inbound message:\n";
  const index = prompt.lastIndexOf(marker);
  const raw = index === -1 ? prompt : prompt.slice(index + marker.length);
  return raw.trim().replace(/\s+/g, " ").slice(0, 120);
}

function countTokens(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

export function createDeterministicTestLlmClient(
  options: DeterministicTestLlmOptions = {}
): LlmClient {
  const modelName = options.modelName ?? "deterministic-test-llm";

  return {
    async generateDraft(input: GenerateDraftInput): Promise<GenerateDraftResult> {
      if (options.fail) {
        throw new VijiError({
          code: ERROR_CODES.ai.modelUnavailable,
          message: options.failureMessage ?? "Deterministic test LLM failed"
        });
      }

      const preview = latestMessagePreview(input.prompt);
      const text = `I can help with that. I understood your message as: ${preview}`;

      return {
        text,
        modelName,
        latencyMs: 0,
        inputTokens: countTokens(input.prompt),
        outputTokens: countTokens(text),
        confidence: 0.9
      };
    }
  };
}
