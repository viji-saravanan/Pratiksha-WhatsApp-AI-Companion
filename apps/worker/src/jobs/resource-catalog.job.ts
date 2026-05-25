import { createStableIdempotencyKey } from "@viji/core";
import {
  createRepositories,
  type AgentDraftRecord,
  type AgentRunRecord,
  type DbExecutor,
  type ResourceProposalWithOptions
} from "@viji/db";
import type { EmbeddingClient } from "@viji/ai";
import {
  formatResourceSuggestionText,
  rankResourceCandidates
} from "@viji/resources";
import { ensureAssistantReplyPrefix, type AppLogger } from "@viji/shared";
import { findSemanticResourceMatches } from "./resource-semantic.job.js";

export type CreateResourceSuggestionDraftResult =
  | {
      status: "suggested";
      run: AgentRunRecord;
      draft: AgentDraftRecord;
      proposal: ResourceProposalWithOptions;
    }
  | {
      status: "not_found";
      run: AgentRunRecord;
      draft: AgentDraftRecord;
    };

export interface CreateResourceSuggestionDraftInput {
  triggerMessageId: string;
  queryText?: string;
  modelName?: string;
  now?: Date;
  maxCandidates?: number;
  env?: NodeJS.ProcessEnv;
  embeddingClient?: EmbeddingClient;
  logger?: AppLogger;
}

function suggestionPromptHash(parts: readonly string[]): string {
  return createStableIdempotencyKey(["resource-suggestion", ...parts]);
}

export async function createResourceSuggestionDraftForInboundMessage(
  db: DbExecutor,
  input: CreateResourceSuggestionDraftInput
): Promise<CreateResourceSuggestionDraftResult> {
  const repositories = createRepositories(db);
  const message = await repositories.messages.findInboundMessageForDraft(
    input.triggerMessageId
  );

  if (!message) {
    throw new Error(`Inbound message not found for resource suggestion: ${input.triggerMessageId}`);
  }

  const queryText = input.queryText ?? message.body ?? "";
  const run = await repositories.agentRuns.createStartedRun({
    conversationId: message.conversationId,
    triggerMessageId: message.messageId,
    modelName: input.modelName ?? "resource-catalog-local",
    promptHash: suggestionPromptHash([message.messageId, queryText]),
    contextState: message.conversationContextState === "fresh" ? "fresh" : "partial"
  });
  const resources = await repositories.resources.listSearchableFileResources({
    contactId: message.senderContactId,
    limit: 200
  });
  const semanticMatches = await findSemanticResourceMatches(db, {
    queryText,
    contactId: message.senderContactId,
    agentRunId: run.agentRunId,
    env: input.env,
    embeddingClient: input.embeddingClient,
    logger: input.logger
  });
  const candidates = rankResourceCandidates(resources, queryText, {
    limit: input.maxCandidates ?? 5,
    semanticMatches
  });
  const body = ensureAssistantReplyPrefix(formatResourceSuggestionText(candidates));
  const draft = await repositories.drafts.createDraft({
    conversationId: message.conversationId,
    triggerMessageId: message.messageId,
    sourceAgentRunId: run.agentRunId,
    body,
    confidence: candidates.length > 0 ? Math.min(0.95, candidates[0].score / 20) : 0.25,
    policyState: candidates.length > 0 ? "confirm_resource" : "candidate",
    decidedAt: input.now ?? new Date()
  });
  const finishedRun = await repositories.agentRuns.markDrafted({
    agentRunId: run.agentRunId,
    inputTokens: Math.max(1, Math.ceil(queryText.trim().split(/\s+/).length * 1.2)),
    outputTokens: Math.max(1, Math.ceil(body.trim().split(/\s+/).length * 1.2)),
    latencyMs: 0
  });

  if (candidates.length === 0) {
    await repositories.auditEvents.recordAuditEvent({
      type: "resource.suggestion_not_found",
      severity: "info",
      contactId: message.senderContactId,
      conversationId: message.conversationId,
      detail: {
        draftId: draft.agentDraftId,
        triggerMessageId: message.messageId
      }
    });

    return {
      status: "not_found",
      run: finishedRun,
      draft
    };
  }

  const proposal = await repositories.resources.createResourceProposal({
    agentDraftId: draft.agentDraftId,
    conversationId: message.conversationId,
    triggerMessageId: message.messageId,
    queryText,
    options: candidates.map((candidate) => ({
      resourceId: candidate.resourceId,
      rank: candidate.rank,
      score: candidate.score
    }))
  });

  await repositories.auditEvents.recordAuditEvent({
    type: "resource.suggestion_created",
    severity: "info",
    contactId: message.senderContactId,
    conversationId: message.conversationId,
    detail: {
      draftId: draft.agentDraftId,
      proposalId: proposal.proposal.resourceProposalId,
      optionCount: proposal.options.length
    }
  });

  return {
    status: "suggested",
    run: finishedRun,
    draft,
    proposal
  };
}
