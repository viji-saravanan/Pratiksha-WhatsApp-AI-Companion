import { ERROR_CODES } from "@viji/shared";

import {
  createAllowedDecision,
  createBlockedDecision,
  createClarificationDecision,
  createConfirmationRequiredDecision
} from "./send-guard.js";
import type { PolicyDecision, PolicyResourceInput } from "./types.js";

function hasExactResourceMatch(resource: PolicyResourceInput): boolean {
  return (
    resource.matchConfidence === "exact" &&
    Boolean(resource.resourceId) &&
    Boolean(resource.registeredFileName)
  );
}

function evaluateResourceAddressability(
  resource: PolicyResourceInput | undefined
): PolicyDecision | null {
  if (!resource) {
    return createClarificationDecision(["resource_missing"]);
  }

  if (!resource.isAllowedForContact) {
    return createBlockedDecision(
      "resource_not_allowed",
      ERROR_CODES.policy.resourceNotAllowed
    );
  }

  if (!hasExactResourceMatch(resource)) {
    return createClarificationDecision(["resource_match_not_exact"]);
  }

  return null;
}

export function evaluateResourceConfirmationPrompt(
  resource: PolicyResourceInput | undefined
): PolicyDecision {
  const addressabilityDecision = evaluateResourceAddressability(resource);
  if (addressabilityDecision) {
    return addressabilityDecision;
  }

  return createAllowedDecision("allow_resource_confirmation_prompt", [
    "resource_confirmation_prompt_allowed",
    "resource_confirmation_required"
  ]);
}

export function evaluateRecipientConfirmedResource(
  resource: PolicyResourceInput | undefined
): PolicyDecision {
  const addressabilityDecision = evaluateResourceAddressability(resource);
  if (addressabilityDecision) {
    return addressabilityDecision;
  }

  const exactResource = resource as PolicyResourceInput & {
    resourceId: string;
    registeredFileName: string;
  };

  if (exactResource.confirmationExpired) {
    return createConfirmationRequiredDecision([
      "resource_confirmation_expired",
      "resource_confirmation_required"
    ]);
  }

  if (!exactResource.hasRecipientConfirmation) {
    return createConfirmationRequiredDecision();
  }

  if (
    !exactResource.confirmedResourceId ||
    exactResource.confirmedResourceId !== exactResource.resourceId
  ) {
    return createClarificationDecision(["resource_confirmation_mismatch"]);
  }

  if (
    exactResource.pendingConfirmationResourceId &&
    exactResource.pendingConfirmationResourceId !== exactResource.resourceId
  ) {
    return createClarificationDecision(["resource_confirmation_mismatch"]);
  }

  return createAllowedDecision("allow_resource", ["resource_confirmed"]);
}
