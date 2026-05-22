import {
  ensureAssistantReplyPrefix,
  ERROR_CODES,
  VijiError
} from "@viji/shared";

import { enforceDraftPolicyText } from "./safety.js";

export function ensureAiPrefix(text: string): string {
  const sanitized = enforceDraftPolicyText(text);
  if (!sanitized) {
    throw new VijiError({
      code: ERROR_CODES.ai.promptRejected,
      message: "LLM returned an empty draft"
    });
  }

  return ensureAssistantReplyPrefix(sanitized);
}
