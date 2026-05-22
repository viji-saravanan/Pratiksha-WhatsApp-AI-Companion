import type { DbExecutor } from "../query.js";
import { createAdapterEventsRepository } from "./adapter-events.repo.js";
import { createAgentRunsRepository } from "./agent-runs.repo.js";
import { createAuditEventsRepository } from "./audit-events.repo.js";
import { createBackfillJobsRepository } from "./backfill-jobs.repo.js";
import { createChannelAccountsRepository } from "./channel-accounts.repo.js";
import { createContactsRepository } from "./contacts.repo.js";
import { createConversationsRepository } from "./conversations.repo.js";
import { createConversationSummariesRepository } from "./conversation-summaries.repo.js";
import { createDraftsRepository } from "./drafts.repo.js";
import { createMediaJobsRepository } from "./media-jobs.repo.js";
import { createMessagesRepository } from "./messages.repo.js";
import { createOutboxRepository } from "./outbox.repo.js";
import { createPoliciesRepository } from "./policies.repo.js";
import { createResourcesRepository } from "./resources.repo.js";
import { createSendAttemptsRepository } from "./send-attempts.repo.js";
import { createSyncCursorsRepository } from "./sync-cursors.repo.js";
import { createSyncRunsRepository } from "./sync-runs.repo.js";

export function createRepositories(db: DbExecutor) {
  return {
    adapterEvents: createAdapterEventsRepository(db),
    agentRuns: createAgentRunsRepository(db),
    auditEvents: createAuditEventsRepository(db),
    backfillJobs: createBackfillJobsRepository(db),
    channelAccounts: createChannelAccountsRepository(db),
    contacts: createContactsRepository(db),
    conversations: createConversationsRepository(db),
    conversationSummaries: createConversationSummariesRepository(db),
    drafts: createDraftsRepository(db),
    mediaJobs: createMediaJobsRepository(db),
    messages: createMessagesRepository(db),
    outbox: createOutboxRepository(db),
    policies: createPoliciesRepository(db),
    resources: createResourcesRepository(db),
    sendAttempts: createSendAttemptsRepository(db),
    syncCursors: createSyncCursorsRepository(db),
    syncRuns: createSyncRunsRepository(db)
  };
}

export * from "./adapter-events.repo.js";
export * from "./agent-runs.repo.js";
export * from "./audit-events.repo.js";
export * from "./backfill-jobs.repo.js";
export * from "./channel-accounts.repo.js";
export * from "./contacts.repo.js";
export * from "./conversations.repo.js";
export * from "./conversation-summaries.repo.js";
export * from "./drafts.repo.js";
export * from "./media-jobs.repo.js";
export * from "./messages.repo.js";
export * from "./outbox.repo.js";
export * from "./policies.repo.js";
export * from "./resources.repo.js";
export * from "./send-attempts.repo.js";
export * from "./sync-cursors.repo.js";
export * from "./sync-runs.repo.js";
