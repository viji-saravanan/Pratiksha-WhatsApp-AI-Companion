import { ERROR_CODES } from "@viji/shared";

import {
  evaluateRecipientConfirmedResource,
  evaluateResourceConfirmationPrompt
} from "./recipient-confirmation-policy.js";
import {
  createAllowedDecision,
  createBlockedDecision,
  evaluateSendGuard
} from "./send-guard.js";
import type { EvaluateOutboundPolicyInput, PolicyDecision } from "./types.js";

function evaluateTextReplyPolicy(input: EvaluateOutboundPolicyInput): PolicyDecision {
  if (input.conversation.mode !== "auto") {
    return createBlockedDecision(
      "mode_confirm_resource_blocks_text",
      ERROR_CODES.policy.modeDoesNotAllowText
    );
  }

  if (input.contact.trustLevel !== "trusted") {
    return createBlockedDecision(
      "contact_not_trusted_for_auto",
      ERROR_CODES.policy.contactTrustInsufficient
    );
  }

  return createAllowedDecision("allow_text", ["text_auto_allowed"]);
}

export function evaluateOutboundPolicy(
  input: EvaluateOutboundPolicyInput
): PolicyDecision {
  const guardDecision = evaluateSendGuard(input);
  if (guardDecision) {
    return guardDecision;
  }

  if (input.intent.kind === "text_reply") {
    return evaluateTextReplyPolicy(input);
  }

  if (input.intent.kind === "resource_confirmation_prompt") {
    return evaluateResourceConfirmationPrompt(input.resource);
  }

  return evaluateRecipientConfirmedResource(input.resource);
}
