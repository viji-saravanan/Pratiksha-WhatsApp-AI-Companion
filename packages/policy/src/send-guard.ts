import { ERROR_CODES, type ErrorCode } from "@viji/shared";

import { findBlockingDependency } from "./idle-state.js";
import type {
  EvaluateOutboundPolicyInput,
  PolicyDecision,
  PolicyDecisionAction,
  PolicyDecisionOutcome,
  PolicyDecisionReason
} from "./types.js";

export interface CreateDecisionInput {
  allowed: boolean;
  action: PolicyDecisionAction;
  outcome: PolicyDecisionOutcome;
  reasons: PolicyDecisionReason[];
  code?: ErrorCode;
}

export function createPolicyDecision(input: CreateDecisionInput): PolicyDecision {
  return {
    allowed: input.allowed,
    action: input.action,
    outcome: input.outcome,
    reasons: input.reasons,
    ...(input.code ? { code: input.code } : {})
  };
}

export function createAllowedDecision(
  action: PolicyDecisionAction,
  reasons: PolicyDecisionReason[]
): PolicyDecision {
  return createPolicyDecision({
    allowed: true,
    action,
    outcome: "allowed",
    reasons: ["policy_passed", ...reasons]
  });
}

export function createBlockedDecision(
  reason: PolicyDecisionReason,
  code: ErrorCode,
  action: PolicyDecisionAction = "block"
): PolicyDecision {
  return createPolicyDecision({
    allowed: false,
    action,
    outcome: "blocked",
    reasons: [reason],
    code
  });
}

export function createIgnoredDecision(
  reason: PolicyDecisionReason,
  code: ErrorCode
): PolicyDecision {
  return createPolicyDecision({
    allowed: false,
    action: "ignore",
    outcome: "ignored",
    reasons: [reason],
    code
  });
}

export function createConfirmationRequiredDecision(
  reasons: PolicyDecisionReason[] = ["resource_confirmation_required"]
): PolicyDecision {
  return createPolicyDecision({
    allowed: false,
    action: "require_resource_confirmation",
    outcome: "confirmation_required",
    reasons,
    code: ERROR_CODES.policy.recipientConfirmationRequired
  });
}

export function createClarificationDecision(
  reasons: PolicyDecisionReason[]
): PolicyDecision {
  return createPolicyDecision({
    allowed: false,
    action: "ask_clarification",
    outcome: "clarification_required",
    reasons,
    code: ERROR_CODES.policy.resourceMatchAmbiguous
  });
}

export function evaluateSendGuard(
  input: EvaluateOutboundPolicyInput
): PolicyDecision | null {
  if (input.globalKillSwitch) {
    return createBlockedDecision(
      "global_kill_switch",
      ERROR_CODES.policy.globalKillSwitch
    );
  }

  if (!input.contact.isAllowlisted) {
    return createIgnoredDecision(
      "contact_not_allowlisted",
      ERROR_CODES.policy.contactNotAllowed
    );
  }

  if (input.conversation.isPaused || input.conversation.mode === "paused") {
    return createBlockedDecision(
      input.conversation.mode === "paused" ? "mode_paused" : "conversation_paused",
      ERROR_CODES.policy.conversationPaused
    );
  }

  if (input.conversation.mode === "readonly") {
    return createBlockedDecision("mode_readonly", ERROR_CODES.policy.readonlyMode);
  }

  if (input.conversation.mode === "idle") {
    return createBlockedDecision("mode_idle", ERROR_CODES.policy.idleMode);
  }

  if (input.conversation.contextState !== "fresh") {
    return createBlockedDecision(
      "context_not_fresh",
      ERROR_CODES.policy.staleContext
    );
  }

  const blockingDependency = findBlockingDependency(input.health);
  if (blockingDependency) {
    return createBlockedDecision(blockingDependency.reason, blockingDependency.code);
  }

  if (
    input.intent.messageAgeSeconds !== undefined &&
    input.intent.maxMessageAgeSeconds !== undefined &&
    input.intent.messageAgeSeconds > input.intent.maxMessageAgeSeconds
  ) {
    return createBlockedDecision(
      "message_too_old",
      ERROR_CODES.policy.messageTooOld
    );
  }

  if (input.idempotencyKeyAlreadySent) {
    return createBlockedDecision(
      "duplicate_outbound",
      ERROR_CODES.policy.duplicateOutbound
    );
  }

  return null;
}
