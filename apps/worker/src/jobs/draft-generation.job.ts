import {
  buildDraftPrompt,
  ensureAiPrefix,
  type LlmClient
} from "@viji/ai";
import {
  createRepositories,
  type AgentDraftRecord,
  type AgentDraftPolicyState,
  type AgentRunContextState,
  type AgentRunRecord,
  type DbExecutor,
  type InboundMessageForDraftRecord
} from "@viji/db";
import {
  evaluateOutboundPolicy,
  type PolicyDecision,
  type PolicyHealthInputs,
  type PolicyMode
} from "@viji/policy";
import {
  ERROR_CODES,
  getAssistantIdentity,
  isVijiError,
  toErrorMessage
} from "@viji/shared";

export interface GenerateDraftForInboundMessageInput {
  triggerMessageId: string;
  llmClient: LlmClient;
  modelName?: string;
  defaultMode?: PolicyMode;
  globalKillSwitch?: boolean;
  health?: Partial<PolicyHealthInputs>;
  maxMessageAgeSeconds?: number;
  now?: Date;
}

export type GenerateDraftForInboundMessageResult =
  | {
      status: "drafted";
      run: AgentRunRecord;
      draft: AgentDraftRecord;
      policyDecision: PolicyDecision;
    }
  | {
      status: "blocked";
      run: AgentRunRecord;
      policyDecision: PolicyDecision;
    }
  | {
      status: "failed";
      run: AgentRunRecord;
      errorCode: string;
      errorMessage: string;
    };

const DEFAULT_MODEL_NAME = "deterministic-test-llm";

const DEFAULT_HEALTH: PolicyHealthInputs = {
  storage: "healthy",
  database: "healthy",
  adapter: "healthy",
  model: "healthy"
};

function toAgentRunContextState(
  contextState: InboundMessageForDraftRecord["conversationContextState"]
): AgentRunContextState {
  if (contextState === "fresh" || contextState === "stale") {
    return contextState;
  }

  return "partial";
}

function toPolicyMode(
  message: InboundMessageForDraftRecord,
  defaultMode: PolicyMode
): PolicyMode {
  if (message.conversationState === "paused") {
    return "paused";
  }

  if (message.conversationState === "ignored" || message.conversationState === "archived") {
    return "idle";
  }

  return defaultMode;
}

function calculateMessageAgeSeconds(
  message: InboundMessageForDraftRecord,
  now: Date
): number | undefined {
  if (!message.receivedAt) {
    return undefined;
  }

  return Math.max(0, Math.floor((now.getTime() - message.receivedAt.getTime()) / 1000));
}

function errorCodeFromUnknown(error: unknown): string {
  if (isVijiError(error)) {
    return error.code;
  }

  return ERROR_CODES.system.invalidState;
}

function draftPolicyStateFromDecision(
  decision: PolicyDecision
): AgentDraftPolicyState {
  if (decision.allowed && decision.action === "allow_text") {
    return "auto_allowed";
  }

  if (decision.action === "require_resource_confirmation") {
    return "confirm_resource";
  }

  if (!decision.allowed) {
    return "blocked";
  }

  return "candidate";
}

export async function generateDraftForInboundMessage(
  db: DbExecutor,
  input: GenerateDraftForInboundMessageInput
): Promise<GenerateDraftForInboundMessageResult> {
  const repositories = createRepositories(db);
  const message = await repositories.messages.findInboundMessageForDraft(
    input.triggerMessageId
  );

  if (!message) {
    throw new Error(`Inbound message not found for draft: ${input.triggerMessageId}`);
  }

  const now = input.now ?? new Date();
  const modelName = input.modelName ?? DEFAULT_MODEL_NAME;
  const assistantIdentity = getAssistantIdentity();
  const prompt = buildDraftPrompt({
    assistantName: assistantIdentity.name,
    contactDisplayName: message.senderDisplayName ?? "Allowlisted contact",
    contextState: message.conversationContextState,
    latestUserMessage: message.body ?? "[non-text inbound message]"
  });

  let run = await repositories.agentRuns.createStartedRun({
    conversationId: message.conversationId,
    triggerMessageId: message.messageId,
    modelName,
    promptHash: prompt.promptHash,
    contextState: toAgentRunContextState(message.conversationContextState)
  });

  const policyDecision = evaluateOutboundPolicy({
    intent: {
      kind: "text_reply",
      messageAgeSeconds: calculateMessageAgeSeconds(message, now),
      maxMessageAgeSeconds: input.maxMessageAgeSeconds ?? 300
    },
    contact: {
      isAllowlisted: message.senderIsAllowlisted === true,
      trustLevel: message.senderTrustLevel ?? "low"
    },
    conversation: {
      mode: toPolicyMode(message, input.defaultMode ?? "auto"),
      contextState: message.conversationContextState,
      isPaused: message.conversationState === "paused"
    },
    health: {
      ...DEFAULT_HEALTH,
      ...input.health
    },
    globalKillSwitch: input.globalKillSwitch ?? false
  });

  if (!policyDecision.allowed) {
    run = await repositories.agentRuns.markBlocked({
      agentRunId: run.agentRunId,
      inputTokens: prompt.inputTokens,
      outputTokens: 0,
      errorCode: policyDecision.code ?? ERROR_CODES.system.invalidState,
      errorMessage: policyDecision.reasons.join(",")
    });

    await repositories.auditEvents.recordAuditEvent({
      type: "agent.run_blocked",
      severity: "warn",
      contactId: message.senderContactId,
      conversationId: message.conversationId,
      detail: {
        reasons: policyDecision.reasons,
        code: policyDecision.code ?? null
      }
    });

    return {
      status: "blocked",
      run,
      policyDecision
    };
  }

  try {
    const llmResult = await input.llmClient.generateDraft({
      prompt: prompt.prompt,
      modelName,
      promptHash: prompt.promptHash
    });
    const draftBody = ensureAiPrefix(llmResult.text);
    const draft = await repositories.drafts.createDraft({
      conversationId: message.conversationId,
      triggerMessageId: message.messageId,
      sourceAgentRunId: run.agentRunId,
      body: draftBody,
      confidence: llmResult.confidence ?? null,
      policyState: draftPolicyStateFromDecision(policyDecision),
      decidedAt: now
    });

    run = await repositories.agentRuns.markDrafted({
      agentRunId: run.agentRunId,
      latencyMs: llmResult.latencyMs,
      inputTokens: llmResult.inputTokens,
      outputTokens: llmResult.outputTokens
    });

    await repositories.auditEvents.recordAuditEvent({
      type: "agent.draft_created",
      severity: "info",
      contactId: message.senderContactId,
      conversationId: message.conversationId,
      detail: {
        draftId: draft.agentDraftId,
        policyState: draft.policyState
      }
    });

    return {
      status: "drafted",
      run,
      draft,
      policyDecision
    };
  } catch (error) {
    const errorCode = errorCodeFromUnknown(error);
    const errorMessage = toErrorMessage(error);
    run = await repositories.agentRuns.markFailed({
      agentRunId: run.agentRunId,
      inputTokens: prompt.inputTokens,
      outputTokens: 0,
      errorCode,
      errorMessage
    });

    await repositories.auditEvents.recordAuditEvent({
      type: "agent.run_failed",
      severity: "error",
      contactId: message.senderContactId,
      conversationId: message.conversationId,
      detail: {
        code: errorCode,
        message: errorMessage
      }
    });

    return {
      status: "failed",
      run,
      errorCode,
      errorMessage
    };
  }
}
