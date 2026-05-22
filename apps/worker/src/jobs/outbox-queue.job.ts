import { createStableIdempotencyKey } from "@viji/core";
import {
  createRepositories,
  type AgentDraftForOutboundRecord,
  type AgentOutboundJobRecord,
  type DbExecutor,
  type IdempotentOutboundJobResult
} from "@viji/db";
import {
  evaluateOutboundPolicy,
  type PolicyDecision,
  type PolicyHealthInputs,
  type PolicyMode
} from "@viji/policy";
import { resolveResourceSelection } from "@viji/resources";
import { ERROR_CODES } from "@viji/shared";

const DEFAULT_HEALTH: PolicyHealthInputs = {
  storage: "healthy",
  database: "healthy",
  adapter: "healthy",
  model: "healthy"
};
const DEFAULT_TEXT_REPLY_MAX_MESSAGE_AGE_SECONDS = 300;
const DEFAULT_RESOURCE_CONFIRMATION_MAX_MESSAGE_AGE_SECONDS = 86_400;

export interface QueuePolicyPermittedTextDraftInput {
  agentDraftId: string;
  defaultMode?: PolicyMode;
  globalKillSwitch?: boolean;
  health?: Partial<PolicyHealthInputs>;
  maxMessageAgeSeconds?: number;
  now?: Date;
}

export type QueueOutboundResult =
  | {
      status: "queued";
      queueStatus: IdempotentOutboundJobResult["status"];
      job: AgentOutboundJobRecord;
      policyDecision: PolicyDecision;
    }
  | {
      status: "blocked";
      policyDecision: PolicyDecision;
    };

export interface ConfirmResourceProposalInput extends QueuePolicyPermittedTextDraftInput {
  resourceId: string;
  registeredFileName: string;
  confirmationMessageId?: string;
  confirmationExpired?: boolean;
  allowPreviouslySentPrompt?: boolean;
}

export interface ConfirmResourceProposalFromInboundInput
  extends ConfirmResourceProposalInput {
  confirmationMessageId: string;
}

export interface ConfirmSuggestedResourceFromInboundInput
  extends QueuePolicyPermittedTextDraftInput {
  confirmationMessageId: string;
}

export type DenyResourceProposalResult = {
  status: "denied";
  agentDraftId: string;
};

function toPolicyMode(
  draft: AgentDraftForOutboundRecord,
  defaultMode: PolicyMode
): PolicyMode {
  if (draft.conversationState === "paused") {
    return "paused";
  }

  if (draft.conversationState === "ignored" || draft.conversationState === "archived") {
    return "idle";
  }

  return defaultMode;
}

function calculateMessageAgeSeconds(
  draft: AgentDraftForOutboundRecord,
  now: Date
): number | undefined {
  if (!draft.triggerReceivedAt) {
    return undefined;
  }

  return Math.max(0, Math.floor((now.getTime() - draft.triggerReceivedAt.getTime()) / 1000));
}

function redactedAuditDetail(
  decision: PolicyDecision,
  extra: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    code: decision.code ?? null,
    reasons: decision.reasons,
    ...extra
  };
}

function blockedConfirmationDecision(reason: string): PolicyDecision {
  return {
    allowed: false,
    action: "require_resource_confirmation",
    outcome: "confirmation_required",
    reasons: ["resource_confirmation_required"],
    code:
      reason === "resource_confirmation_mismatch"
        ? ERROR_CODES.policy.resourceConfirmationMismatch
        : ERROR_CODES.policy.recipientConfirmationRequired
  };
}

function isAffirmativeResourceConfirmation(body: string | null): boolean {
  const normalized = body?.trim().toLowerCase().replace(/[.!?]+$/g, "") ?? "";
  return [
    "yes",
    "yes please",
    "yeah",
    "yep",
    "correct",
    "that's right",
    "thats right",
    "confirm",
    "confirmed",
    "send it",
    "please send it"
  ].includes(normalized);
}

function draftMentionsRegisteredFile(
  draft: AgentDraftForOutboundRecord,
  registeredFileName: string
): boolean {
  return (
    /\bdo you mean\b/i.test(draft.body) &&
    draft.body.toLowerCase().includes(registeredFileName.toLowerCase())
  );
}

async function loadDraftForOutbound(
  db: DbExecutor,
  agentDraftId: string
): Promise<AgentDraftForOutboundRecord> {
  const repositories = createRepositories(db);
  const draft = await repositories.drafts.findDraftForOutbound(agentDraftId);

  if (!draft) {
    throw new Error(`Agent draft not found for outbound queue: ${agentDraftId}`);
  }

  return draft;
}

export async function queuePolicyPermittedTextDraft(
  db: DbExecutor,
  input: QueuePolicyPermittedTextDraftInput
): Promise<QueueOutboundResult> {
  const repositories = createRepositories(db);
  const draft = await loadDraftForOutbound(db, input.agentDraftId);
  const now = input.now ?? new Date();
  const idempotencyKey = createStableIdempotencyKey([
    "outbox",
    "text_reply",
    draft.agentDraftId,
    draft.triggerMessageId
  ]);
  const policyDecision = evaluateOutboundPolicy({
    intent: {
      kind: "text_reply",
      messageAgeSeconds: calculateMessageAgeSeconds(draft, now),
      maxMessageAgeSeconds:
        input.maxMessageAgeSeconds ?? DEFAULT_TEXT_REPLY_MAX_MESSAGE_AGE_SECONDS
    },
    contact: {
      isAllowlisted: draft.recipientIsAllowlisted === true,
      trustLevel: draft.recipientTrustLevel ?? "low"
    },
    conversation: {
      mode: toPolicyMode(draft, input.defaultMode ?? "auto"),
      contextState: draft.conversationContextState,
      isPaused: draft.conversationState === "paused"
    },
    health: {
      ...DEFAULT_HEALTH,
      ...input.health
    },
    globalKillSwitch: input.globalKillSwitch ?? false
  });

  if (!policyDecision.allowed) {
    await repositories.auditEvents.recordAuditEvent({
      type: "outbox.queue_blocked",
      severity: "warn",
      contactId: draft.recipientContactId,
      conversationId: draft.conversationId,
      detail: redactedAuditDetail(policyDecision, {
        draftId: draft.agentDraftId
      })
    });
    return {
      status: "blocked",
      policyDecision
    };
  }

  const queued = await repositories.outbox.createQueuedJobIdempotent({
    conversationId: draft.conversationId,
    sourceDraftId: draft.agentDraftId,
    kind: "text_reply",
    payload: {
      text: draft.body
    },
    idempotencyKey
  });

  await repositories.auditEvents.recordAuditEvent({
    type: "outbox.queued",
    severity: "info",
    contactId: draft.recipientContactId,
    conversationId: draft.conversationId,
    detail: {
      draftId: draft.agentDraftId,
      outboundJobId: queued.job.outboundJobId,
      kind: queued.job.kind,
      queueStatus: queued.status
    }
  });

  return {
    status: "queued",
    queueStatus: queued.status,
    job: queued.job,
    policyDecision
  };
}

export async function confirmResourceProposal(
  db: DbExecutor,
  input: ConfirmResourceProposalInput
): Promise<QueueOutboundResult> {
  const repositories = createRepositories(db);
  const draft = await loadDraftForOutbound(db, input.agentDraftId);
  const now = input.now ?? new Date();
  const idempotencyKey = createStableIdempotencyKey([
    "outbox",
    "resource_send",
    draft.agentDraftId,
    input.resourceId
  ]);
  const policyDecision = evaluateOutboundPolicy({
    intent: {
      kind: "resource_send",
      messageAgeSeconds: calculateMessageAgeSeconds(draft, now),
      maxMessageAgeSeconds:
        input.maxMessageAgeSeconds ??
        DEFAULT_RESOURCE_CONFIRMATION_MAX_MESSAGE_AGE_SECONDS
    },
    contact: {
      isAllowlisted: draft.recipientIsAllowlisted === true,
      trustLevel: draft.recipientTrustLevel ?? "low"
    },
    conversation: {
      mode: toPolicyMode(draft, input.defaultMode ?? "confirm_resource"),
      contextState: draft.conversationContextState,
      isPaused: draft.conversationState === "paused"
    },
    health: {
      ...DEFAULT_HEALTH,
      ...input.health
    },
    globalKillSwitch: input.globalKillSwitch ?? false,
    resource: {
      resourceId: input.resourceId,
      registeredFileName: input.registeredFileName,
      isAllowedForContact: true,
      matchConfidence: "exact",
      hasRecipientConfirmation: true,
      confirmedResourceId: input.resourceId,
      pendingConfirmationResourceId: input.resourceId,
      confirmationExpired: input.confirmationExpired ?? false
    }
  });

  const confirmationStateAllowsQueue =
    draft.policyState === "confirm_resource" ||
    draft.policyState === "auto_allowed" ||
    (input.allowPreviouslySentPrompt === true && draft.policyState === "sent");

  if (!policyDecision.allowed || !confirmationStateAllowsQueue) {
    await repositories.auditEvents.recordAuditEvent({
      type: "recipient_confirmed_resource_blocked",
      severity: "warn",
      contactId: draft.recipientContactId,
      conversationId: draft.conversationId,
      detail: redactedAuditDetail(policyDecision, {
        draftId: draft.agentDraftId,
        resourceId: input.resourceId
      })
    });
    return {
      status: "blocked",
      policyDecision
    };
  }

  const queued = await repositories.outbox.createQueuedJobIdempotent({
    conversationId: draft.conversationId,
    sourceDraftId: draft.agentDraftId,
    kind: "resource_send",
    payload: {
      resourceId: input.resourceId,
      registeredFileName: input.registeredFileName,
      ...(input.confirmationMessageId
        ? { confirmationMessageId: input.confirmationMessageId }
        : {})
    },
    idempotencyKey
  });

  await repositories.drafts.updateDraftPolicyState({
    agentDraftId: draft.agentDraftId,
    policyState: "auto_allowed",
    decidedAt: now
  });

  await repositories.auditEvents.recordAuditEvent({
    type: "recipient_confirmed_resource",
    severity: "info",
    contactId: draft.recipientContactId,
    conversationId: draft.conversationId,
    detail: {
      draftId: draft.agentDraftId,
      outboundJobId: queued.job.outboundJobId,
      resourceId: input.resourceId,
      queueStatus: queued.status
    }
  });

  return {
    status: "queued",
    queueStatus: queued.status,
    job: queued.job,
    policyDecision
  };
}

export async function confirmResourceProposalFromInboundMessage(
  db: DbExecutor,
  input: ConfirmResourceProposalFromInboundInput
): Promise<QueueOutboundResult> {
  const repositories = createRepositories(db);
  const draft = await loadDraftForOutbound(db, input.agentDraftId);
  const confirmation = await repositories.messages.findInboundMessageForDraft(
    input.confirmationMessageId
  );

  const confirmationMatches =
    confirmation &&
    confirmation.conversationId === draft.conversationId &&
    confirmation.senderContactId === draft.recipientContactId &&
    isAffirmativeResourceConfirmation(confirmation.body) &&
    draftMentionsRegisteredFile(draft, input.registeredFileName);

  if (!confirmationMatches) {
    const policyDecision = blockedConfirmationDecision(
      "resource_confirmation_mismatch"
    );
    await repositories.auditEvents.recordAuditEvent({
      type: "recipient_confirmed_resource_blocked",
      severity: "warn",
      contactId: draft.recipientContactId,
      conversationId: draft.conversationId,
      detail: redactedAuditDetail(policyDecision, {
        draftId: draft.agentDraftId,
        resourceId: input.resourceId,
        confirmationMessageId: input.confirmationMessageId
      })
    });
    return {
      status: "blocked",
      policyDecision
    };
  }

  return confirmResourceProposal(db, {
    ...input,
    allowPreviouslySentPrompt: true
  });
}

export async function confirmSuggestedResourceFromInboundMessage(
  db: DbExecutor,
  input: ConfirmSuggestedResourceFromInboundInput
): Promise<QueueOutboundResult> {
  const repositories = createRepositories(db);
  const draft = await loadDraftForOutbound(db, input.agentDraftId);
  const confirmation = await repositories.messages.findInboundMessageForDraft(
    input.confirmationMessageId
  );
  const proposal = await repositories.resources.findPendingResourceProposalForDraft(
    input.agentDraftId
  );
  const sameTrustedConversation =
    confirmation &&
    confirmation.conversationId === draft.conversationId &&
    confirmation.senderContactId === draft.recipientContactId;

  if (!sameTrustedConversation || !proposal) {
    const policyDecision = blockedConfirmationDecision(
      "resource_confirmation_mismatch"
    );
    await repositories.auditEvents.recordAuditEvent({
      type: "recipient_confirmed_resource_blocked",
      severity: "warn",
      contactId: draft.recipientContactId,
      conversationId: draft.conversationId,
      detail: redactedAuditDetail(policyDecision, {
        draftId: draft.agentDraftId,
        confirmationMessageId: input.confirmationMessageId,
        reason: proposal ? "wrong_conversation_or_sender" : "no_pending_resource_proposal"
      })
    });
    return {
      status: "blocked",
      policyDecision
    };
  }

  const selection = resolveResourceSelection(
    confirmation.body,
    proposal.options.map((option) => ({
      resourceId: option.resourceId,
      registeredFileName: option.registeredFileName,
      title: option.title,
      aliases: option.aliases,
      description: option.description,
      contentSummary: option.contentSummary,
      rank: option.rank,
      score: Number(option.score),
      matchedTerms: []
    }))
  );

  if (selection.status !== "resolved") {
    const policyDecision = blockedConfirmationDecision(
      "resource_confirmation_mismatch"
    );
    await repositories.auditEvents.recordAuditEvent({
      type: "recipient_confirmed_resource_blocked",
      severity: "warn",
      contactId: draft.recipientContactId,
      conversationId: draft.conversationId,
      detail: redactedAuditDetail(policyDecision, {
        draftId: draft.agentDraftId,
        proposalId: proposal.proposal.resourceProposalId,
        confirmationMessageId: input.confirmationMessageId,
        selectionStatus: selection.status
      })
    });
    return {
      status: "blocked",
      policyDecision
    };
  }

  const result = await confirmResourceProposal(db, {
    ...input,
    resourceId: selection.candidate.resourceId,
    registeredFileName: selection.candidate.registeredFileName,
    allowPreviouslySentPrompt: true
  });

  if (result.status === "queued") {
    await repositories.resources.markResourceProposalState({
      resourceProposalId: proposal.proposal.resourceProposalId,
      state: "resolved"
    });
  }

  return result;
}

export async function denyResourceProposal(
  db: DbExecutor,
  input: { agentDraftId: string; now?: Date }
): Promise<DenyResourceProposalResult> {
  const repositories = createRepositories(db);
  const draft = await loadDraftForOutbound(db, input.agentDraftId);

  await repositories.drafts.updateDraftPolicyState({
    agentDraftId: draft.agentDraftId,
    policyState: "blocked",
    decidedAt: input.now ?? new Date()
  });

  await repositories.auditEvents.recordAuditEvent({
    type: "recipient_denied_resource",
    severity: "info",
    contactId: draft.recipientContactId,
    conversationId: draft.conversationId,
    detail: {
      draftId: draft.agentDraftId
    }
  });

  return {
    status: "denied",
    agentDraftId: draft.agentDraftId
  };
}
