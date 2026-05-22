import {
  createRepositories,
  withTransaction,
  type BackfillJobRecord,
  type ConversationRecord,
  type SyncRunRecord
} from "@viji/db";
import { ERROR_CODES, toErrorMessage } from "@viji/shared";
import type { WacliNormalizationBatch, WhatsAppAdapter } from "@viji/whatsapp";
import { ingestNormalizedInboundMessages } from "./inbound-ingestion.job.js";
import {
  asNormalizationBatch,
  countImportedMessages,
  newestByReceivedAt,
  oldestByReceivedAt
} from "./message-batch.js";

export type RecoveryPool = Parameters<typeof withTransaction>[0];

export interface ReconnectRecoveryInput {
  channelAccountId: string;
  adapter: WhatsAppAdapter;
  conversationId?: string;
  limit?: number;
  now?: Date;
}

export type RecoveredConversationResult =
  | {
      status: "completed";
      conversationId: string;
      syncRun: SyncRunRecord;
      messagesSeen: number;
      messagesImported: number;
      checkpoint: string;
    }
  | {
      status: "failed";
      conversationId: string;
      syncRun: SyncRunRecord;
      errorCode: string;
    };

export interface ReconnectRecoveryResult {
  status: "completed" | "failed" | "skipped";
  conversations: RecoveredConversationResult[];
}

export interface HistoryBackfillInput {
  channelAccountId: string;
  conversationId: string;
  adapter: WhatsAppAdapter;
  limit?: number;
}

export type HistoryBackfillResult =
  | {
      status: "completed" | "paused";
      job: BackfillJobRecord;
      syncRun: SyncRunRecord;
      messagesSeen: number;
      messagesImported: number;
      cursor: string | null;
    }
  | {
      status: "failed";
      job: BackfillJobRecord;
      syncRun: SyncRunRecord;
      errorCode: string;
    };

const DEFAULT_PAGE_LIMIT = 50;

export async function runReconnectRecovery(
  pool: RecoveryPool,
  input: ReconnectRecoveryInput
): Promise<ReconnectRecoveryResult> {
  const repositories = createRepositories(pool);
  const conversations = await repositories.conversations.listRecoverableConversations({
    channelAccountId: input.channelAccountId,
    conversationId: input.conversationId ?? null,
    limit: input.conversationId ? 1 : 50
  });

  if (conversations.length === 0) {
    return { status: "skipped", conversations: [] };
  }

  const results: RecoveredConversationResult[] = [];
  for (const conversation of conversations) {
    results.push(
      await recoverConversation(pool, {
        ...input,
        conversation,
        limit: input.limit ?? DEFAULT_PAGE_LIMIT
      })
    );
  }

  return {
    status: results.some((result) => result.status === "failed")
      ? "failed"
      : "completed",
    conversations: results
  };
}

export async function runHistoryBackfillPage(
  pool: RecoveryPool,
  input: HistoryBackfillInput
): Promise<HistoryBackfillResult> {
  const repositories = createRepositories(pool);
  const conversation = await repositories.conversations.findById(
    input.conversationId
  );
  if (!conversation) {
    throw new Error(`Conversation not found for backfill: ${input.conversationId}`);
  }
  if (conversation.channelAccountId !== input.channelAccountId) {
    throw new Error("Backfill conversation does not belong to the channel account.");
  }

  const prepared = await withTransaction(pool, async (client) => {
    const txRepositories = createRepositories(client);
    const existing =
      await txRepositories.backfillJobs.findLatestBackfillJobForConversation(
        conversation.conversationId
      );
    const job =
      existing && existing.state !== "completed"
        ? existing
        : await txRepositories.backfillJobs.createBackfillJob(
            conversation.conversationId
          );
    const runningJob = await txRepositories.backfillJobs.updateBackfillJobState({
      backfillJobId: job.backfillJobId,
      state: "running"
    });
    const syncRun = await txRepositories.syncRuns.createSyncRun({
      channelAccountId: input.channelAccountId,
      conversationId: conversation.conversationId,
      kind: "backfill"
    });

    return { job: runningJob, syncRun };
  });

  const limit = input.limit ?? DEFAULT_PAGE_LIMIT;
  const messagesResult = await input.adapter.listMessages({
    chatId: conversation.externalChatId,
    before: prepared.job.cursor ?? undefined,
    limit
  });

  if (!messagesResult.ok) {
    return failBackfill(pool, {
      job: prepared.job,
      syncRun: prepared.syncRun,
      errorCode: messagesResult.code
    });
  }

  let batch: WacliNormalizationBatch;
  try {
    batch = asNormalizationBatch(messagesResult.value);
  } catch (error) {
    return failBackfill(pool, {
      job: prepared.job,
      syncRun: prepared.syncRun,
      errorCode: ERROR_CODES.adapter.unknown,
      errorMessage: toErrorMessage(error)
    });
  }

  return withTransaction(pool, async (client) => {
    const txRepositories = createRepositories(client);
    const ingestionResults = await ingestNormalizedInboundMessages(client, {
      channelAccountId: input.channelAccountId,
      messages: batch.messages,
      recoveredContextState: conversation.contextState
    });
    const messagesImported = countImportedMessages(ingestionResults);
    const oldestMessage = oldestByReceivedAt(batch.messages);
    const nextCursor = oldestMessage?.receivedAt.toISOString() ?? prepared.job.cursor;
    const nextState = batch.messages.length < limit ? "completed" : "paused";
    const totalImported = prepared.job.messagesImported + messagesImported;
    const job = await txRepositories.backfillJobs.updateBackfillJobState({
      backfillJobId: prepared.job.backfillJobId,
      state: nextState,
      cursor: nextCursor,
      messagesImported: totalImported
    });

    if (oldestMessage) {
      await txRepositories.syncCursors.upsertSyncCursor({
        channelAccountId: input.channelAccountId,
        conversationId: conversation.conversationId,
        name: "oldest_backfilled",
        value: oldestMessage.receivedAt.toISOString()
      });
    }

    if (batch.messages.length > 0) {
      await txRepositories.conversationSummaries.createConversationSummary({
        conversationId: conversation.conversationId,
        kind: "backfill",
        text: `Backfill imported ${messagesImported} new message(s) from ${batch.messages.length} recovered item(s).`,
        tokenCount: null
      });
    }

    const syncRun = await txRepositories.syncRuns.finishSyncRun({
      syncRunId: prepared.syncRun.syncRunId,
      state: "completed",
      messagesSeen: batch.messages.length,
      messagesImported,
      contextStateAfter: conversation.contextState
    });

    return {
      status: nextState,
      job,
      syncRun,
      messagesSeen: batch.messages.length,
      messagesImported,
      cursor: nextCursor
    };
  });
}

async function recoverConversation(
  pool: RecoveryPool,
  input: ReconnectRecoveryInput & {
    conversation: ConversationRecord;
    limit: number;
  }
): Promise<RecoveredConversationResult> {
  const prepared = await withTransaction(pool, async (client) => {
    const txRepositories = createRepositories(client);
    await txRepositories.conversations.updateContextStateById({
      conversationId: input.conversation.conversationId,
      contextState: "recovering"
    });
    const syncRun = await txRepositories.syncRuns.createSyncRun({
      channelAccountId: input.channelAccountId,
      conversationId: input.conversation.conversationId,
      kind: "reconnect"
    });
    const cursor = await txRepositories.syncCursors.findSyncCursor({
      channelAccountId: input.channelAccountId,
      conversationId: input.conversation.conversationId,
      name: "reconnect_checkpoint"
    });

    return { syncRun, cursor: cursor?.value ?? null };
  });

  const messagesResult = await input.adapter.listMessages({
    chatId: input.conversation.externalChatId,
    after: prepared.cursor ?? undefined,
    limit: input.limit
  });

  if (!messagesResult.ok) {
    return failReconnect(pool, {
      conversationId: input.conversation.conversationId,
      syncRun: prepared.syncRun,
      errorCode: messagesResult.code
    });
  }

  let batch: WacliNormalizationBatch;
  try {
    batch = asNormalizationBatch(messagesResult.value);
  } catch (error) {
    return failReconnect(pool, {
      conversationId: input.conversation.conversationId,
      syncRun: prepared.syncRun,
      errorCode: ERROR_CODES.adapter.unknown,
      errorMessage: toErrorMessage(error)
    });
  }

  return withTransaction(pool, async (client) => {
    const txRepositories = createRepositories(client);
    const ingestionResults = await ingestNormalizedInboundMessages(client, {
      channelAccountId: input.channelAccountId,
      messages: batch.messages,
      recoveredContextState: "fresh"
    });
    const imported = countImportedMessages(ingestionResults);
    const latestMessage = newestByReceivedAt(batch.messages);
    const checkpoint =
      latestMessage?.receivedAt.toISOString() ??
      prepared.cursor ??
      (input.now ?? new Date()).toISOString();

    if (latestMessage) {
      await txRepositories.syncCursors.upsertSyncCursor({
        channelAccountId: input.channelAccountId,
        conversationId: input.conversation.conversationId,
        name: "latest_message",
        value: latestMessage.externalMessageId
      });
    }

    await txRepositories.syncCursors.upsertSyncCursor({
      channelAccountId: input.channelAccountId,
      conversationId: input.conversation.conversationId,
      name: "reconnect_checkpoint",
      value: checkpoint
    });
    await txRepositories.conversations.updateContextStateById({
      conversationId: input.conversation.conversationId,
      contextState: "fresh",
      lastSyncedAt: new Date(checkpoint)
    });
    const syncRun = await txRepositories.syncRuns.finishSyncRun({
      syncRunId: prepared.syncRun.syncRunId,
      state: "completed",
      messagesSeen: batch.messages.length,
      messagesImported: imported,
      contextStateAfter: "fresh"
    });

    return {
      status: "completed",
      conversationId: input.conversation.conversationId,
      syncRun,
      messagesSeen: batch.messages.length,
      messagesImported: imported,
      checkpoint
    };
  });
}

async function failReconnect(
  pool: RecoveryPool,
  input: {
    conversationId: string;
    syncRun: SyncRunRecord;
    errorCode: string;
    errorMessage?: string;
  }
): Promise<RecoveredConversationResult> {
  return withTransaction(pool, async (client) => {
    const txRepositories = createRepositories(client);
    await txRepositories.conversations.updateContextStateById({
      conversationId: input.conversationId,
      contextState: "stale"
    });
    const syncRun = await txRepositories.syncRuns.finishSyncRun({
      syncRunId: input.syncRun.syncRunId,
      state: "failed",
      messagesSeen: 0,
      messagesImported: 0,
      contextStateAfter: "stale",
      errorCode: input.errorCode,
      errorMessage: input.errorMessage ?? input.errorCode
    });

    return {
      status: "failed",
      conversationId: input.conversationId,
      syncRun,
      errorCode: input.errorCode
    };
  });
}

async function failBackfill(
  pool: RecoveryPool,
  input: {
    job: BackfillJobRecord;
    syncRun: SyncRunRecord;
    errorCode: string;
    errorMessage?: string;
  }
): Promise<HistoryBackfillResult> {
  return withTransaction(pool, async (client) => {
    const txRepositories = createRepositories(client);
    const job = await txRepositories.backfillJobs.updateBackfillJobState({
      backfillJobId: input.job.backfillJobId,
      state: "failed",
      errorCode: input.errorCode,
      errorMessage: input.errorMessage ?? input.errorCode
    });
    const syncRun = await txRepositories.syncRuns.finishSyncRun({
      syncRunId: input.syncRun.syncRunId,
      state: "failed",
      messagesSeen: 0,
      messagesImported: 0,
      contextStateAfter: "stale",
      errorCode: input.errorCode,
      errorMessage: input.errorMessage ?? input.errorCode
    });

    return {
      status: "failed",
      job,
      syncRun,
      errorCode: input.errorCode
    };
  });
}
