import {
  createRepositories,
  withTransaction,
  type AgentOutboundJobRecord,
  type DbExecutor
} from "@viji/db";
import {
  evaluateOutboundPolicy,
  type PolicyDecision,
  type PolicyHealthInputs,
  type PolicyMode
} from "@viji/policy";
import { ERROR_CODES } from "@viji/shared";

import type {
  OutboundDispatcher,
  OutboundSendIntent
} from "./outbound-dispatcher.interface.js";

const DEFAULT_HEALTH: PolicyHealthInputs = {
  storage: "healthy",
  database: "healthy",
  adapter: "healthy",
  model: "healthy"
};

export interface DispatchNextOutboundJobInput {
  dispatcher: OutboundDispatcher;
  defaultMode?: PolicyMode;
  globalKillSwitch?: boolean;
  health?: Partial<PolicyHealthInputs>;
}

export type DispatchNextOutboundJobResult =
  | { status: "idle" }
  | {
      status: "blocked";
      job: AgentOutboundJobRecord;
      policyDecision: PolicyDecision;
    }
  | { status: "sent"; job: AgentOutboundJobRecord }
  | {
      status: "failed";
      job: AgentOutboundJobRecord;
      retryable: boolean;
      errorCode: string;
    };

function toPolicyMode(conversationState: string, defaultMode: PolicyMode): PolicyMode {
  if (conversationState === "paused") {
    return "paused";
  }

  if (conversationState === "ignored" || conversationState === "archived") {
    return "idle";
  }

  return defaultMode;
}

function payloadString(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

async function evaluatePolicyForDispatch(
  db: DbExecutor,
  job: AgentOutboundJobRecord,
  input: DispatchNextOutboundJobInput
): Promise<PolicyDecision> {
  const repositories = createRepositories(db);
  const draft = job.sourceDraftId
    ? await repositories.drafts.findDraftForOutbound(job.sourceDraftId)
    : null;

  if (!draft) {
    return {
      allowed: false,
      action: "block",
      outcome: "blocked",
      reasons: ["resource_missing"],
      code: ERROR_CODES.system.invalidState
    };
  }

  const common = {
    contact: {
      isAllowlisted: draft.recipientIsAllowlisted === true,
      trustLevel: draft.recipientTrustLevel ?? "low"
    },
    conversation: {
      mode: toPolicyMode(
        draft.conversationState,
        input.defaultMode ?? (job.kind === "resource_send" ? "confirm_resource" : "auto")
      ),
      contextState: draft.conversationContextState,
      isPaused: draft.conversationState === "paused"
    },
    health: {
      ...DEFAULT_HEALTH,
      ...input.health
    },
    globalKillSwitch: input.globalKillSwitch ?? false
  };

  if (job.kind === "resource_send") {
    const resourceId = payloadString(job.payload, "resourceId");
    const registeredFileName = payloadString(job.payload, "registeredFileName");

    return evaluateOutboundPolicy({
      ...common,
      intent: {
        kind: "resource_send"
      },
      resource: {
        resourceId,
        registeredFileName,
        isAllowedForContact: Boolean(resourceId && registeredFileName),
        matchConfidence: resourceId && registeredFileName ? "exact" : "none",
        hasRecipientConfirmation: true,
        confirmedResourceId: resourceId,
        pendingConfirmationResourceId: resourceId
      }
    });
  }

  return evaluateOutboundPolicy({
    ...common,
    intent: {
      kind: "text_reply"
    }
  });
}

function toSendIntent(job: AgentOutboundJobRecord): OutboundSendIntent {
  return {
    outboundJobId: job.outboundJobId,
    idempotencyKey: job.idempotencyKey,
    kind: job.kind,
    conversationId: job.conversationId,
    sourceDraftId: job.sourceDraftId,
    payload: job.payload
  };
}

export async function dispatchNextOutboundJob(
  db: DbExecutor,
  input: DispatchNextOutboundJobInput
): Promise<DispatchNextOutboundJobResult> {
  const repositories = createRepositories(db);
  const nextJob = await repositories.outbox.findNextDispatchableJob();

  if (!nextJob) {
    return { status: "idle" };
  }

  const policyDecision = await evaluatePolicyForDispatch(db, nextJob, input);

  if (!policyDecision.allowed) {
    const blockedJob = await repositories.outbox.markBlocked({
      outboundJobId: nextJob.outboundJobId,
      blockedReason: policyDecision.reasons.join(",")
    });

    await repositories.auditEvents.recordAuditEvent({
      type: "outbox.dispatch_blocked",
      severity: "warn",
      conversationId: blockedJob.conversationId,
      detail: {
        outboundJobId: blockedJob.outboundJobId,
        code: policyDecision.code ?? null,
        reasons: policyDecision.reasons
      }
    });

    return {
      status: "blocked",
      job: blockedJob,
      policyDecision
    };
  }

  const sendingJob = await repositories.outbox.markSending(nextJob.outboundJobId);
  const attempt = await repositories.sendAttempts.createStartedAttempt({
    outboundJobId: sendingJob.outboundJobId,
    adapterType: input.dispatcher.adapterType
  });
  const dispatchResult = await input.dispatcher.dispatch(toSendIntent(sendingJob));

  if (!dispatchResult.ok) {
    await repositories.sendAttempts.finishAttempt({
      sendAttemptId: attempt.sendAttemptId,
      state: "failed",
      errorCode: dispatchResult.code,
      errorMessage: dispatchResult.message
    });
    const failedJob = await repositories.outbox.markFailed({
      outboundJobId: sendingJob.outboundJobId,
      blockedReason: dispatchResult.code
    });

    await repositories.auditEvents.recordAuditEvent({
      type: "outbox.send_failed",
      severity: "error",
      conversationId: failedJob.conversationId,
      detail: {
        outboundJobId: failedJob.outboundJobId,
        code: dispatchResult.code,
        retryable: dispatchResult.retryable
      }
    });

    return {
      status: "failed",
      job: failedJob,
      retryable: dispatchResult.retryable,
      errorCode: dispatchResult.code
    };
  }

  const sentJob = await withTransaction(
    db as Parameters<typeof withTransaction>[0],
    async (client) => {
      const txRepositories = createRepositories(client);

      await txRepositories.sendAttempts.finishAttempt({
        sendAttemptId: attempt.sendAttemptId,
        state: "succeeded",
        externalMessageId: dispatchResult.value.externalMessageId
      });
      const updatedJob = await txRepositories.outbox.markSent(
        sendingJob.outboundJobId
      );

      await txRepositories.messages.insertOutboundMessageIdempotent({
        conversationId: updatedJob.conversationId,
        externalMessageId:
          dispatchResult.value.externalMessageId ?? `outbox:${updatedJob.outboundJobId}`,
        type: updatedJob.kind === "resource_send" ? "document" : "text",
        body:
          updatedJob.kind === "resource_send"
            ? payloadString(updatedJob.payload, "registeredFileName")
            : payloadString(updatedJob.payload, "text"),
        bodyRedacted: false,
        status: "sent",
        sentAt: new Date()
      });

      if (updatedJob.sourceDraftId) {
        await txRepositories.drafts.updateDraftPolicyState({
          agentDraftId: updatedJob.sourceDraftId,
          policyState: "sent"
        });
      }

      await txRepositories.auditEvents.recordAuditEvent({
        type: "sent",
        severity: "info",
        conversationId: updatedJob.conversationId,
        detail: {
          outboundJobId: updatedJob.outboundJobId,
          kind: updatedJob.kind
        }
      });

      return updatedJob;
    }
  );

  return {
    status: "sent",
    job: sentJob
  };
}
