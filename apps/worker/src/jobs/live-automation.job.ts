import {
  createStableIdempotencyKey
} from "@viji/core";
import { createRepositories, type DbExecutor } from "@viji/db";
import type { LlmClient } from "@viji/ai";
import { getLlmModelNameFromEnv } from "@viji/ai";
import { resolveResourceSelection } from "@viji/resources";
import { ERROR_CODES, type AppLogger } from "@viji/shared";
import type { WhatsAppAdapter } from "@viji/whatsapp";
import { generateDraftForInboundMessage } from "./draft-generation.job.js";
import { runLiveAllowlistPoll, type LivePollPool } from "./live-polling.job.js";
import type { OutboundDispatcher } from "./outbound-dispatcher.interface.js";
import {
  confirmSuggestedResourceFromInboundMessage,
  queuePolicyPermittedTextDraft
} from "./outbox-queue.job.js";
import { dispatchNextOutboundJob } from "./outbox-dispatch.job.js";
import { createResourceSuggestionDraftForInboundMessage } from "./resource-catalog.job.js";

export interface LiveAutomationCycleInput {
  channelAccountId: string;
  adapter: WhatsAppAdapter;
  dispatcher: OutboundDispatcher;
  llmClient: LlmClient;
  env?: NodeJS.ProcessEnv;
  logger?: AppLogger;
  contactLimit?: number;
  chatSearchLimit?: number;
  messageLimit?: number;
  automationLimit?: number;
  dispatchLimit?: number;
  now?: Date;
}

export interface LiveAutomationCycleResult {
  syncStatus: "completed" | "skipped" | "failed";
  syncErrorCode?: string;
  pollStatus: string;
  contactsScanned: number;
  messagesSeen: number;
  messagesImported: number;
  messagesConsidered: number;
  draftsCreated: number;
  resourcePromptsCreated: number;
  confirmationsQueued: number;
  textJobsQueued: number;
  jobsDispatched: number;
  jobsBlocked: number;
  jobsFailed: number;
}

function isAutoReplyEnabled(env: NodeJS.ProcessEnv): boolean {
  return env.VIJI_AUTO_REPLY_ENABLED === "true";
}

function isLiveSendEnabled(env: NodeJS.ProcessEnv): boolean {
  return env.VIJI_WACLI_LIVE_SEND_ENABLED === "true";
}

function positiveInteger(
  value: string | number | undefined,
  fallback: number
): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function isLiveSyncBeforePollEnabled(env: NodeJS.ProcessEnv): boolean {
  return env.VIJI_LIVE_SYNC_BEFORE_POLL_ENABLED !== "false";
}

function booleanFromEnv(value: string | undefined): boolean {
  return value === "true";
}

function looksLikeResourceRequest(body: string | null): boolean {
  const normalized = body?.toLowerCase() ?? "";
  return /\b(send|share|upload|forward|need|have|get|give)\b/.test(normalized) &&
    /\b(file|pdf|document|doc|marksheet|mark sheet|resume|photo|image|certificate|media)\b/.test(normalized);
}

function emptyCycleResult(input: {
  syncStatus: LiveAutomationCycleResult["syncStatus"];
  syncErrorCode?: string;
  pollStatus: string;
}): LiveAutomationCycleResult {
  return {
    syncStatus: input.syncStatus,
    ...(input.syncErrorCode ? { syncErrorCode: input.syncErrorCode } : {}),
    pollStatus: input.pollStatus,
    contactsScanned: 0,
    messagesSeen: 0,
    messagesImported: 0,
    messagesConsidered: 0,
    draftsCreated: 0,
    resourcePromptsCreated: 0,
    confirmationsQueued: 0,
    textJobsQueued: 0,
    jobsDispatched: 0,
    jobsBlocked: 0,
    jobsFailed: 0
  };
}

async function markMessageConsumed(input: {
  db: DbExecutor;
  messageId: string;
  conversationId: string;
  modelName: string;
  reason: string;
}): Promise<void> {
  const repositories = createRepositories(input.db);
  const run = await repositories.agentRuns.createStartedRun({
    conversationId: input.conversationId,
    triggerMessageId: input.messageId,
    modelName: input.modelName,
    promptHash: createStableIdempotencyKey([
      "live-automation-consumed",
      input.messageId,
      input.reason
    ]),
    contextState: "fresh"
  });
  await repositories.agentRuns.markBlocked({
    agentRunId: run.agentRunId,
    errorCode: ERROR_CODES.policy.recipientConfirmationRequired,
    errorMessage: input.reason,
    inputTokens: 0,
    outputTokens: 0
  });
}

async function handlePendingResourceConfirmation(input: {
  db: DbExecutor;
  messageId: string;
  conversationId: string;
  senderContactId: string | null;
  body: string | null;
  now: Date;
  modelName: string;
}): Promise<"queued" | "consumed" | "not_confirmation"> {
  const repositories = createRepositories(input.db);
  const proposal = await repositories.resources.findLatestPendingResourceProposalForConversation({
    conversationId: input.conversationId,
    contactId: input.senderContactId
  });

  if (!proposal) {
    return "not_confirmation";
  }

  const selection = resolveResourceSelection(
    input.body,
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

  if (selection.status === "no_match") {
    return "not_confirmation";
  }

  if (selection.status === "ambiguous") {
    await markMessageConsumed({
      db: input.db,
      messageId: input.messageId,
      conversationId: input.conversationId,
      modelName: input.modelName,
      reason: "ambiguous_resource_confirmation"
    });
    return "consumed";
  }

  const confirmed = await confirmSuggestedResourceFromInboundMessage(input.db, {
    agentDraftId: proposal.proposal.agentDraftId,
    confirmationMessageId: input.messageId,
    now: input.now
  });

  await markMessageConsumed({
    db: input.db,
    messageId: input.messageId,
    conversationId: input.conversationId,
    modelName: input.modelName,
    reason: confirmed.status === "queued"
      ? "resource_confirmation_queued"
      : "resource_confirmation_blocked"
  });

  return confirmed.status === "queued" ? "queued" : "consumed";
}

export async function runLiveAutomationCycle(
  db: LivePollPool,
  input: LiveAutomationCycleInput
): Promise<LiveAutomationCycleResult> {
  const env = input.env ?? process.env;
  const modelName = getLlmModelNameFromEnv(env);
  const defaultMode = env.VIJI_DEFAULT_REPLY_MODE === "readonly" ||
    env.VIJI_DEFAULT_REPLY_MODE === "paused" ||
    env.VIJI_DEFAULT_REPLY_MODE === "confirm_resource"
    ? env.VIJI_DEFAULT_REPLY_MODE
    : "auto";
  const globalKillSwitch = !isAutoReplyEnabled(env) || !isLiveSendEnabled(env);
  const now = input.now ?? new Date();
  let syncStatus: LiveAutomationCycleResult["syncStatus"] = "skipped";

  if (isLiveSyncBeforePollEnabled(env)) {
    const sync = await input.adapter.sync({
      once: true,
      idleExit: env.VIJI_LIVE_SYNC_IDLE_EXIT || "12s",
      refreshContacts: booleanFromEnv(env.VIJI_LIVE_SYNC_REFRESH_CONTACTS),
      refreshGroups: booleanFromEnv(env.VIJI_LIVE_SYNC_REFRESH_GROUPS)
    });

    if (!sync.ok) {
      const result = emptyCycleResult({
        syncStatus: "failed",
        syncErrorCode: sync.code,
        pollStatus: "sync_failed"
      });
      input.logger?.warn("live_automation.sync_failed", {
        syncErrorCode: sync.code,
        retryable: sync.retryable
      });
      input.logger?.info("live_automation.cycle_completed", { ...result });
      return result;
    }

    syncStatus = "completed";
  }

  const poll = await runLiveAllowlistPoll(db, {
    channelAccountId: input.channelAccountId,
    adapter: input.adapter,
    contactLimit: input.contactLimit,
    chatSearchLimit: input.chatSearchLimit,
    messageLimit: input.messageLimit
  });
  const repositories = createRepositories(db);
  const messages = await repositories.messages.listInboundMessagesNeedingAutomation({
    limit: input.automationLimit ?? positiveInteger(env.VIJI_LIVE_AUTOMATION_BATCH_LIMIT, 10)
  });

  let draftsCreated = 0;
  let resourcePromptsCreated = 0;
  let confirmationsQueued = 0;
  let textJobsQueued = 0;

  for (const message of messages) {
    const confirmation = await handlePendingResourceConfirmation({
      db,
      messageId: message.messageId,
      conversationId: message.conversationId,
      senderContactId: message.senderContactId,
      body: message.body,
      now,
      modelName
    });

    if (confirmation === "queued") {
      confirmationsQueued += 1;
      continue;
    }
    if (confirmation === "consumed") {
      continue;
    }

    if (looksLikeResourceRequest(message.body)) {
      const suggestion = await createResourceSuggestionDraftForInboundMessage(db, {
        triggerMessageId: message.messageId,
        queryText: message.body ?? "",
        modelName: "resource-catalog-local",
        now
      });
      resourcePromptsCreated += 1;
      const queued = await queuePolicyPermittedTextDraft(db, {
        agentDraftId: suggestion.draft.agentDraftId,
        defaultMode,
        globalKillSwitch,
        now
      });
      if (queued.status === "queued") {
        textJobsQueued += 1;
      }
      continue;
    }

    const draft = await generateDraftForInboundMessage(db, {
      triggerMessageId: message.messageId,
      llmClient: input.llmClient,
      modelName,
      defaultMode,
      globalKillSwitch,
      now
    });
    if (draft.status !== "drafted") {
      continue;
    }

    draftsCreated += 1;
    const queued = await queuePolicyPermittedTextDraft(db, {
      agentDraftId: draft.draft.agentDraftId,
      defaultMode,
      globalKillSwitch,
      now
    });
    if (queued.status === "queued") {
      textJobsQueued += 1;
    }
  }

  let jobsDispatched = 0;
  let jobsBlocked = 0;
  let jobsFailed = 0;
  const dispatchLimit =
    input.dispatchLimit ?? positiveInteger(env.VIJI_LIVE_DISPATCH_LIMIT_PER_CYCLE, 5);

  for (let index = 0; index < dispatchLimit; index += 1) {
    const dispatch = await dispatchNextOutboundJob(db, {
      dispatcher: input.dispatcher,
      defaultMode,
      globalKillSwitch
    });

    if (dispatch.status === "idle") {
      break;
    }
    if (dispatch.status === "sent") {
      jobsDispatched += 1;
    } else if (dispatch.status === "blocked") {
      jobsBlocked += 1;
    } else if (dispatch.status === "failed") {
      jobsFailed += 1;
    }
  }

  const result = {
    syncStatus,
    pollStatus: poll.status,
    contactsScanned: poll.contactsScanned,
    messagesSeen: poll.messagesSeen,
    messagesImported: poll.messagesImported,
    messagesConsidered: messages.length,
    draftsCreated,
    resourcePromptsCreated,
    confirmationsQueued,
    textJobsQueued,
    jobsDispatched,
    jobsBlocked,
    jobsFailed
  };

  input.logger?.info("live_automation.cycle_completed", { ...result });
  return result;
}
