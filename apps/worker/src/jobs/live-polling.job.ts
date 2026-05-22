import {
  createRepositories,
  withTransaction,
  type ContactRecord,
  type SyncRunRecord
} from "@viji/db";
import { ERROR_CODES } from "@viji/shared";
import type { WhatsAppAdapter } from "@viji/whatsapp";
import { ingestNormalizedInboundMessages } from "./inbound-ingestion.job.js";
import {
  asNormalizationBatch,
  countImportedMessages,
  newestByReceivedAt
} from "./message-batch.js";

export type LivePollPool = Parameters<typeof withTransaction>[0];

export interface LiveAllowlistPollInput {
  channelAccountId: string;
  adapter: WhatsAppAdapter;
  contactLimit?: number;
  chatSearchLimit?: number;
  messageLimit?: number;
}

export interface LiveAllowlistContactPollResult {
  contactId: string;
  displayName: string;
  status: "completed" | "skipped" | "failed";
  reason?: "no_query" | "no_matching_chat";
  chatId?: string;
  syncRun?: SyncRunRecord;
  messagesSeen: number;
  messagesImported: number;
  errorCode?: string;
}

export interface LiveAllowlistPollResult {
  status: "completed" | "failed" | "skipped";
  contactsScanned: number;
  messagesSeen: number;
  messagesImported: number;
  contacts: LiveAllowlistContactPollResult[];
}

interface PollableChatRecord {
  chatId: string;
  name: string | null;
  type: "dm" | "group" | "unknown";
}

const DEFAULT_CONTACT_LIMIT = 100;
const DEFAULT_CHAT_SEARCH_LIMIT = 5;
const DEFAULT_MESSAGE_LIMIT = 25;

export async function runLiveAllowlistPoll(
  pool: LivePollPool,
  input: LiveAllowlistPollInput
): Promise<LiveAllowlistPollResult> {
  const repositories = createRepositories(pool);
  const contacts = await repositories.contacts.listAllowlistedContacts({
    limit: input.contactLimit ?? DEFAULT_CONTACT_LIMIT
  });

  if (contacts.length === 0) {
    return {
      status: "skipped",
      contactsScanned: 0,
      messagesSeen: 0,
      messagesImported: 0,
      contacts: []
    };
  }

  const results: LiveAllowlistContactPollResult[] = [];
  for (const contact of contacts) {
    results.push(
      await pollAllowlistedContact(pool, {
        ...input,
        contact,
        chatSearchLimit: input.chatSearchLimit ?? DEFAULT_CHAT_SEARCH_LIMIT,
        messageLimit: input.messageLimit ?? DEFAULT_MESSAGE_LIMIT
      })
    );
  }

  return {
    status: results.some((result) => result.status === "failed")
      ? "failed"
      : "completed",
    contactsScanned: contacts.length,
    messagesSeen: sum(results, "messagesSeen"),
    messagesImported: sum(results, "messagesImported"),
    contacts: results
  };
}

async function pollAllowlistedContact(
  pool: LivePollPool,
  input: LiveAllowlistPollInput & {
    contact: ContactRecord;
    chatSearchLimit: number;
    messageLimit: number;
  }
): Promise<LiveAllowlistContactPollResult> {
  const query = contactSearchQuery(input.contact);
  if (!query) {
    return skipped(input.contact, "no_query");
  }

  const chatsResult = await input.adapter.listChats({
    query,
    limit: input.chatSearchLimit
  });
  if (!chatsResult.ok) {
    return failed(input.contact, chatsResult.code);
  }

  const selectedChat = selectMatchingChat(asPollableChats(chatsResult.value), input.contact);
  if (!selectedChat) {
    return skipped(input.contact, "no_matching_chat");
  }

  const messagesResult = await input.adapter.listMessages({
    chatId: selectedChat.chatId,
    limit: input.messageLimit
  });
  if (!messagesResult.ok) {
    return failed(input.contact, messagesResult.code, selectedChat.chatId);
  }

  try {
    const batch = asNormalizationBatch(messagesResult.value);

    return withTransaction(pool, async (client) => {
      const repositories = createRepositories(client);
      const conversation = await repositories.conversations.upsertDirectConversation({
        channelAccountId: input.channelAccountId,
        primaryContactId: input.contact.contactId,
        externalChatId: selectedChat.chatId,
        title: selectedChat.name ?? input.contact.displayName,
        contextState: "fresh"
      });
      const syncRun = await repositories.syncRuns.createSyncRun({
        channelAccountId: input.channelAccountId,
        conversationId: conversation.conversationId,
        kind: "live"
      });
      const ingestionResults = await ingestNormalizedInboundMessages(client, {
        channelAccountId: input.channelAccountId,
        messages: batch.messages,
        recoveredContextState: "fresh"
      });
      const messagesImported = countImportedMessages(ingestionResults);
      const latestMessage = newestByReceivedAt(batch.messages);

      if (latestMessage) {
        await repositories.syncCursors.upsertSyncCursor({
          channelAccountId: input.channelAccountId,
          conversationId: conversation.conversationId,
          name: "latest_message",
          value: latestMessage.externalMessageId
        });
        await repositories.conversations.updateContextStateById({
          conversationId: conversation.conversationId,
          contextState: "fresh",
          lastSyncedAt: latestMessage.receivedAt
        });
      }

      const finishedSyncRun = await repositories.syncRuns.finishSyncRun({
        syncRunId: syncRun.syncRunId,
        state: "completed",
        messagesSeen: batch.messages.length,
        messagesImported,
        contextStateAfter: "fresh"
      });

      return {
        contactId: input.contact.contactId,
        displayName: input.contact.displayName,
        status: "completed",
        chatId: selectedChat.chatId,
        syncRun: finishedSyncRun,
        messagesSeen: batch.messages.length,
        messagesImported
      };
    });
  } catch {
    return failed(
      input.contact,
      ERROR_CODES.adapter.unknown,
      selectedChat.chatId
    );
  }
}

function contactSearchQuery(contact: ContactRecord): string | null {
  return contact.waJid ?? contact.phoneE164 ?? contact.displayName ?? null;
}

function selectMatchingChat(
  chats: readonly PollableChatRecord[],
  contact: ContactRecord
): PollableChatRecord | null {
  const directChats = chats.filter((chat) => chat.type !== "group");
  const exactJid = contact.waJid
    ? directChats.find((chat) => chat.chatId === contact.waJid)
    : null;
  if (exactJid) {
    return exactJid;
  }

  const phoneDigits = contact.phoneE164?.replaceAll(/\D/g, "");
  if (phoneDigits) {
    const phoneMatches = directChats.filter((chat) => chat.chatId.includes(phoneDigits));
    if (phoneMatches.length === 1) {
      return phoneMatches[0];
    }
  }

  const displayNameMatches = directChats.filter(
    (chat) => chat.name === contact.displayName
  );
  if (displayNameMatches.length === 1) {
    return displayNameMatches[0];
  }

  return null;
}

function asPollableChats(value: unknown): PollableChatRecord[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(isPollableChat);
}

function isPollableChat(value: unknown): value is PollableChatRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Partial<PollableChatRecord>;
  return (
    typeof record.chatId === "string" &&
    (record.name === null || typeof record.name === "string") &&
    (record.type === "dm" || record.type === "group" || record.type === "unknown")
  );
}

function skipped(
  contact: ContactRecord,
  reason: LiveAllowlistContactPollResult["reason"]
): LiveAllowlistContactPollResult {
  return {
    contactId: contact.contactId,
    displayName: contact.displayName,
    status: "skipped",
    reason,
    messagesSeen: 0,
    messagesImported: 0
  };
}

function failed(
  contact: ContactRecord,
  errorCode: string,
  chatId?: string
): LiveAllowlistContactPollResult {
  return {
    contactId: contact.contactId,
    displayName: contact.displayName,
    status: "failed",
    chatId,
    messagesSeen: 0,
    messagesImported: 0,
    errorCode
  };
}

function sum(
  results: readonly LiveAllowlistContactPollResult[],
  key: "messagesSeen" | "messagesImported"
): number {
  return results.reduce((total, result) => total + result[key], 0);
}
