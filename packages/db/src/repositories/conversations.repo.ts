import type { DbExecutor } from "../query.js";
import { queryOne, queryRequired } from "../query.js";

export interface ConversationRecord {
  conversationId: string;
  channelAccountId: string;
  primaryContactId: string | null;
  externalChatId: string;
  type: "dm" | "group";
  title: string;
  state: "active" | "paused" | "archived" | "ignored";
  contextState: "fresh" | "stale" | "recovering" | "unknown";
}

export interface ConversationListRecord extends ConversationRecord {
  primaryContactDisplayName: string | null;
  lastMessageAt: Date | null;
}

export interface RecoverableConversationRecord extends ConversationRecord {
  primaryContactDisplayName: string;
  lastSyncedAt: Date | null;
}

export interface UpsertDirectConversationInput {
  channelAccountId: string;
  primaryContactId: string;
  externalChatId: string;
  title: string;
  contextState?: ConversationRecord["contextState"];
}

export function createConversationsRepository(db: DbExecutor) {
  return {
    async upsertDirectConversation(
      input: UpsertDirectConversationInput
    ): Promise<ConversationRecord> {
      return queryRequired<ConversationRecord>(
        db,
        `
          INSERT INTO msg_conversations (
            owner_core_channel_account_id,
            primary_core_contact_id,
            msg_conversation_external_chat_id,
            msg_conversation_type,
            msg_conversation_title,
            msg_conversation_state,
            msg_conversation_context_state
          ) VALUES ($1, $2, $3, 'dm', $4, 'active', $5)
          ON CONFLICT (
            owner_core_channel_account_id,
            msg_conversation_external_chat_id
          ) DO UPDATE SET
            primary_core_contact_id = excluded.primary_core_contact_id,
            msg_conversation_title = excluded.msg_conversation_title,
            msg_conversation_context_state = excluded.msg_conversation_context_state,
            msg_conversation_updated_at = now()
          RETURNING
            msg_conversation_id AS "conversationId",
            owner_core_channel_account_id AS "channelAccountId",
            primary_core_contact_id AS "primaryContactId",
            msg_conversation_external_chat_id AS "externalChatId",
            msg_conversation_type AS "type",
            msg_conversation_title AS "title",
            msg_conversation_state AS "state",
            msg_conversation_context_state AS "contextState"
        `,
        [
          input.channelAccountId,
          input.primaryContactId,
          input.externalChatId,
          input.title,
          input.contextState ?? "unknown"
        ],
        "Failed to upsert direct conversation"
      );
    },

    async findByExternalChatId(
      channelAccountId: string,
      externalChatId: string
    ): Promise<ConversationRecord | null> {
      return queryOne<ConversationRecord>(
        db,
        `
          SELECT
            msg_conversation_id AS "conversationId",
            owner_core_channel_account_id AS "channelAccountId",
            primary_core_contact_id AS "primaryContactId",
            msg_conversation_external_chat_id AS "externalChatId",
            msg_conversation_type AS "type",
            msg_conversation_title AS "title",
            msg_conversation_state AS "state",
            msg_conversation_context_state AS "contextState"
          FROM msg_conversations
          WHERE owner_core_channel_account_id = $1
            AND msg_conversation_external_chat_id = $2
        `,
        [channelAccountId, externalChatId]
      );
    },

    async findById(conversationId: string): Promise<ConversationRecord | null> {
      return queryOne<ConversationRecord>(
        db,
        `
          SELECT
            msg_conversation_id AS "conversationId",
            owner_core_channel_account_id AS "channelAccountId",
            primary_core_contact_id AS "primaryContactId",
            msg_conversation_external_chat_id AS "externalChatId",
            msg_conversation_type AS "type",
            msg_conversation_title AS "title",
            msg_conversation_state AS "state",
            msg_conversation_context_state AS "contextState"
          FROM msg_conversations
          WHERE msg_conversation_id = $1
        `,
        [conversationId]
      );
    },

    async listRecoverableConversations(input: {
      channelAccountId: string;
      conversationId?: string | null;
      limit?: number;
    }): Promise<RecoverableConversationRecord[]> {
      const result = await db.query<RecoverableConversationRecord>(
        `
          SELECT
            msg_conversations.msg_conversation_id AS "conversationId",
            msg_conversations.owner_core_channel_account_id AS "channelAccountId",
            msg_conversations.primary_core_contact_id AS "primaryContactId",
            msg_conversations.msg_conversation_external_chat_id AS "externalChatId",
            msg_conversations.msg_conversation_type AS "type",
            msg_conversations.msg_conversation_title AS "title",
            msg_conversations.msg_conversation_state AS "state",
            msg_conversations.msg_conversation_context_state AS "contextState",
            core_contacts.core_contact_display_name AS "primaryContactDisplayName",
            msg_conversations.msg_conversation_last_synced_at AS "lastSyncedAt"
          FROM msg_conversations
          INNER JOIN core_contacts
            ON core_contacts.core_contact_id =
              msg_conversations.primary_core_contact_id
          WHERE msg_conversations.owner_core_channel_account_id = $1
            AND msg_conversations.msg_conversation_type = 'dm'
            AND msg_conversations.msg_conversation_state = 'active'
            AND core_contacts.core_contact_is_allowlisted = true
            AND ($2::uuid IS NULL OR msg_conversations.msg_conversation_id = $2::uuid)
          ORDER BY
            msg_conversations.msg_conversation_last_synced_at ASC NULLS FIRST,
            msg_conversations.msg_conversation_updated_at ASC
          LIMIT $3
        `,
        [input.channelAccountId, input.conversationId ?? null, input.limit ?? 50]
      );

      return result.rows;
    },

    async listConversations(limit = 50): Promise<ConversationListRecord[]> {
      const result = await db.query<ConversationListRecord>(
        `
          SELECT
            msg_conversations.msg_conversation_id AS "conversationId",
            msg_conversations.owner_core_channel_account_id AS "channelAccountId",
            msg_conversations.primary_core_contact_id AS "primaryContactId",
            msg_conversations.msg_conversation_external_chat_id AS "externalChatId",
            msg_conversations.msg_conversation_type AS "type",
            msg_conversations.msg_conversation_title AS "title",
            msg_conversations.msg_conversation_state AS "state",
            msg_conversations.msg_conversation_context_state AS "contextState",
            core_contacts.core_contact_display_name AS "primaryContactDisplayName",
            msg_conversations.msg_conversation_last_message_at AS "lastMessageAt"
          FROM msg_conversations
          LEFT JOIN core_contacts
            ON core_contacts.core_contact_id =
              msg_conversations.primary_core_contact_id
          ORDER BY
            msg_conversations.msg_conversation_last_message_at DESC NULLS LAST,
            msg_conversations.msg_conversation_created_at DESC
          LIMIT $1
        `,
        [limit]
      );

      return result.rows;
    },

    async updateConversationStateById(input: {
      conversationId: string;
      state: ConversationRecord["state"];
    }): Promise<ConversationRecord> {
      return queryRequired<ConversationRecord>(
        db,
        `
          UPDATE msg_conversations
          SET
            msg_conversation_state = $2,
            msg_conversation_updated_at = now()
          WHERE msg_conversation_id = $1
          RETURNING
            msg_conversation_id AS "conversationId",
            owner_core_channel_account_id AS "channelAccountId",
            primary_core_contact_id AS "primaryContactId",
            msg_conversation_external_chat_id AS "externalChatId",
            msg_conversation_type AS "type",
            msg_conversation_title AS "title",
            msg_conversation_state AS "state",
            msg_conversation_context_state AS "contextState"
        `,
        [input.conversationId, input.state],
        "Failed to update conversation state"
      );
    },

    async updateContextStateById(input: {
      conversationId: string;
      contextState: ConversationRecord["contextState"];
      lastSyncedAt?: Date | null;
    }): Promise<ConversationRecord> {
      return queryRequired<ConversationRecord>(
        db,
        `
          UPDATE msg_conversations
          SET
            msg_conversation_context_state = $2,
            msg_conversation_last_synced_at = COALESCE($3, msg_conversation_last_synced_at),
            msg_conversation_updated_at = now()
          WHERE msg_conversation_id = $1
          RETURNING
            msg_conversation_id AS "conversationId",
            owner_core_channel_account_id AS "channelAccountId",
            primary_core_contact_id AS "primaryContactId",
            msg_conversation_external_chat_id AS "externalChatId",
            msg_conversation_type AS "type",
            msg_conversation_title AS "title",
            msg_conversation_state AS "state",
            msg_conversation_context_state AS "contextState"
        `,
        [input.conversationId, input.contextState, input.lastSyncedAt ?? null],
        "Failed to update conversation context state"
      );
    },

    async updateAllConversationStates(input: {
      fromStates: ConversationRecord["state"][];
      toState: ConversationRecord["state"];
    }): Promise<number> {
      const result = await db.query(
        `
          UPDATE msg_conversations
          SET
            msg_conversation_state = $2,
            msg_conversation_updated_at = now()
          WHERE msg_conversation_state = ANY($1::text[])
        `,
        [input.fromStates, input.toState]
      );

      return result.rowCount ?? 0;
    }
  };
}
