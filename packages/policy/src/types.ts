import type { ErrorCode } from "@viji/shared";

export type PolicyMode = "auto" | "confirm_resource" | "readonly" | "paused" | "idle";

export type PolicyContactTrustLevel = "low" | "normal" | "trusted";

export type PolicyContextState = "fresh" | "stale" | "recovering" | "unknown";

export type PolicyDependencyState =
  | "healthy"
  | "degraded"
  | "unavailable"
  | "idle"
  | "full";

export type PolicyDependencyName = "storage" | "database" | "adapter" | "model";

export interface PolicyHealthInputs {
  storage: PolicyDependencyState;
  database: PolicyDependencyState;
  adapter: PolicyDependencyState;
  model: PolicyDependencyState;
}

export interface PolicyContactInput {
  isAllowlisted: boolean;
  trustLevel: PolicyContactTrustLevel;
}

export interface PolicyConversationInput {
  mode: PolicyMode;
  contextState: PolicyContextState;
  isPaused?: boolean;
}

export type PolicyOutboundIntentKind =
  | "text_reply"
  | "resource_confirmation_prompt"
  | "resource_send";

export interface PolicyOutboundIntentInput {
  kind: PolicyOutboundIntentKind;
  messageAgeSeconds?: number;
  maxMessageAgeSeconds?: number;
}

export type ResourceMatchConfidence = "exact" | "high" | "low" | "none";

export interface PolicyResourceInput {
  resourceId?: string | null;
  registeredFileName?: string | null;
  isAllowedForContact: boolean;
  matchConfidence: ResourceMatchConfidence;
  hasRecipientConfirmation: boolean;
  confirmedResourceId?: string | null;
  pendingConfirmationResourceId?: string | null;
  confirmationExpired?: boolean;
}

export interface EvaluateOutboundPolicyInput {
  intent: PolicyOutboundIntentInput;
  contact: PolicyContactInput;
  conversation: PolicyConversationInput;
  health: PolicyHealthInputs;
  globalKillSwitch: boolean;
  resource?: PolicyResourceInput;
  idempotencyKeyAlreadySent?: boolean;
}

export type PolicyDecisionAction =
  | "allow_text"
  | "allow_resource_confirmation_prompt"
  | "allow_resource"
  | "require_resource_confirmation"
  | "ask_clarification"
  | "ignore"
  | "block";

export type PolicyDecisionOutcome =
  | "allowed"
  | "blocked"
  | "ignored"
  | "confirmation_required"
  | "clarification_required";

export type PolicyDecisionReason =
  | "policy_passed"
  | "text_auto_allowed"
  | "resource_confirmation_prompt_allowed"
  | "resource_confirmed"
  | "global_kill_switch"
  | "contact_not_allowlisted"
  | "contact_not_trusted_for_auto"
  | "conversation_paused"
  | "mode_readonly"
  | "mode_paused"
  | "mode_idle"
  | "mode_confirm_resource_blocks_text"
  | "context_not_fresh"
  | "storage_not_healthy"
  | "database_not_healthy"
  | "adapter_not_healthy"
  | "model_not_healthy"
  | "message_too_old"
  | "duplicate_outbound"
  | "resource_missing"
  | "resource_not_allowed"
  | "resource_match_not_exact"
  | "resource_confirmation_required"
  | "resource_confirmation_expired"
  | "resource_confirmation_mismatch";

export interface PolicyDecision {
  allowed: boolean;
  action: PolicyDecisionAction;
  outcome: PolicyDecisionOutcome;
  reasons: PolicyDecisionReason[];
  code?: ErrorCode;
}
