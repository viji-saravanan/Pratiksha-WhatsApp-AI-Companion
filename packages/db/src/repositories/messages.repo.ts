import type { DbExecutor } from "../query.js";
import { queryOne, queryRequired } from "../query.js";

export interface MessageRecord {
  messageId: string;
  conversationId: string;
  senderContactId: string | null;
  adapterEventId: string | null;
  externalMessageId: string;
  direction: "inbound" | "outbound";
  type: "text" | "image" | "video" | "audio" | "document" | "system";
  body: string | null;
  bodyRedacted: boolean;
  status: "received" | "drafted" | "queued" | "sent" | "failed" | "ignored";
}

export interface InboundMessageForDraftRecord extends MessageRecord {
  receivedAt: Date | null;
  conversationState: "active" | "paused" | "archived" | "ignored";
  conversationContextState: "fresh" | "stale" | "recovering" | "unknown";
  senderDisplayName: string | null;
  senderIsAllowlisted: boolean | null;
  senderTrustLevel: "low" | "normal" | "trusted" | null;
}

export interface InboundMessageAutomationCandidateRecord
  extends InboundMessageForDraftRecord {
  agentRunCount: number;
}

export interface MessageMediaRecord {
  messageMediaId: string;
  messageId: string;
  fileAssetId: string | null;
  externalMediaId: string | null;
  mimeType: string;
  fileName: string | null;
  sizeBytes: string | null;
  downloadState: "not_requested" | "queued" | "downloaded" | "failed" | "blocked";
}

export interface MessageMediaPromotionRecord extends MessageMediaRecord {
  conversationId: string;
  senderContactId: string | null;
  senderDisplayName: string | null;
  messageBody: string | null;
  receivedAt: Date | null;
}

export interface InsertInboundMessageInput {
  conversationId: string;
  senderContactId?: string | null;
  adapterEventId?: string | null;
  externalMessageId: string;
  replyToExternalMessageId?: string | null;
  adapterMetadata?: Record<string, unknown>;
  type?: MessageRecord["type"];
  body?: string | null;
  bodyRedacted?: boolean;
  receivedAt?: Date;
}

export interface InsertOutboundMessageInput {
  conversationId: string;
  adapterEventId?: string | null;
  externalMessageId: string;
  replyToExternalMessageId?: string | null;
  adapterMetadata?: Record<string, unknown>;
  type?: MessageRecord["type"];
  body?: string | null;
  bodyRedacted?: boolean;
  status?: Extract<MessageRecord["status"], "queued" | "sent" | "failed">;
  sentAt?: Date;
}

export interface AddMessageMediaInput {
  messageId: string;
  externalMediaId?: string | null;
  mimeType: string;
  fileName?: string | null;
  sizeBytes?: number | null;
  downloadState?: MessageMediaRecord["downloadState"];
}

export type IdempotentMessageResult =
  | { status: "inserted"; message: MessageRecord }
  | { status: "existing"; message: MessageRecord };

function messageReturningSql(): string {
  return `
    msg_message_id AS "messageId",
    parent_msg_conversation_id AS "conversationId",
    sender_core_contact_id AS "senderContactId",
    adapter_ops_adapter_event_id AS "adapterEventId",
    msg_message_external_message_id AS "externalMessageId",
    msg_message_direction AS "direction",
    msg_message_type AS "type",
    msg_message_body AS "body",
    msg_message_body_redacted AS "bodyRedacted",
    msg_message_status AS "status"
  `;
}

function messageMediaReturningSql(): string {
  return `
    msg_message_media_id AS "messageMediaId",
    parent_msg_message_id AS "messageId",
    backing_res_file_asset_id AS "fileAssetId",
    msg_message_media_external_media_id AS "externalMediaId",
    msg_message_media_mime_type AS "mimeType",
    msg_message_media_file_name AS "fileName",
    msg_message_media_size_bytes AS "sizeBytes",
    msg_message_media_download_state AS "downloadState"
  `;
}

export function createMessagesRepository(db: DbExecutor) {
  return {
    async insertInboundMessageIdempotent(
      input: InsertInboundMessageInput
    ): Promise<IdempotentMessageResult> {
      const inserted = await queryOne<MessageRecord>(
        db,
        `
          INSERT INTO msg_messages (
            parent_msg_conversation_id,
            sender_core_contact_id,
            adapter_ops_adapter_event_id,
            reply_to_msg_message_id,
            msg_message_external_message_id,
            msg_message_direction,
            msg_message_type,
            msg_message_body,
            msg_message_body_redacted,
            msg_message_adapter_metadata,
            msg_message_status,
            msg_message_received_at
          ) VALUES (
            $1,
            $2,
            $3,
            (
              SELECT msg_message_id
              FROM msg_messages
              WHERE parent_msg_conversation_id = $1
                AND msg_message_external_message_id = $4
              LIMIT 1
            ),
            $5,
            'inbound',
            $6,
            $7,
            $8,
            $9::jsonb,
            'received',
            $10
          )
          ON CONFLICT (
            parent_msg_conversation_id,
            msg_message_external_message_id
          ) DO NOTHING
          RETURNING ${messageReturningSql()}
        `,
        [
          input.conversationId,
          input.senderContactId ?? null,
          input.adapterEventId ?? null,
          input.replyToExternalMessageId ?? null,
          input.externalMessageId,
          input.type ?? "text",
          input.body ?? null,
          input.bodyRedacted ?? false,
          JSON.stringify(input.adapterMetadata ?? {}),
          input.receivedAt ?? new Date()
        ]
      );

      if (inserted) {
        await db.query(
          `
            UPDATE msg_conversations
            SET
              msg_conversation_last_message_at = COALESCE($2, now()),
              msg_conversation_updated_at = now()
            WHERE msg_conversation_id = $1
          `,
          [input.conversationId, input.receivedAt ?? null]
        );
        return { status: "inserted", message: inserted };
      }

      const existing = await queryRequired<MessageRecord>(
        db,
        `
          SELECT ${messageReturningSql()}
          FROM msg_messages
          WHERE parent_msg_conversation_id = $1
            AND msg_message_external_message_id = $2
        `,
        [input.conversationId, input.externalMessageId],
        "Failed to load existing inbound message"
      );

      return { status: "existing", message: existing };
    },

    async insertOutboundMessageIdempotent(
      input: InsertOutboundMessageInput
    ): Promise<IdempotentMessageResult> {
      const inserted = await queryOne<MessageRecord>(
        db,
        `
          INSERT INTO msg_messages (
            parent_msg_conversation_id,
            sender_core_contact_id,
            adapter_ops_adapter_event_id,
            reply_to_msg_message_id,
            msg_message_external_message_id,
            msg_message_direction,
            msg_message_type,
            msg_message_body,
            msg_message_body_redacted,
            msg_message_adapter_metadata,
            msg_message_status,
            msg_message_sent_at
          ) VALUES (
            $1,
            NULL,
            $2,
            (
              SELECT msg_message_id
              FROM msg_messages
              WHERE parent_msg_conversation_id = $1
                AND msg_message_external_message_id = $3
              LIMIT 1
            ),
            $4,
            'outbound',
            $5,
            $6,
            $7,
            $8::jsonb,
            $9,
            $10
          )
          ON CONFLICT (
            parent_msg_conversation_id,
            msg_message_external_message_id
          ) DO NOTHING
          RETURNING ${messageReturningSql()}
        `,
        [
          input.conversationId,
          input.adapterEventId ?? null,
          input.replyToExternalMessageId ?? null,
          input.externalMessageId,
          input.type ?? "text",
          input.body ?? null,
          input.bodyRedacted ?? false,
          JSON.stringify(input.adapterMetadata ?? {}),
          input.status ?? "sent",
          input.sentAt ?? new Date()
        ]
      );

      if (inserted) {
        await db.query(
          `
            UPDATE msg_conversations
            SET
              msg_conversation_last_message_at = COALESCE($2, now()),
              msg_conversation_updated_at = now()
            WHERE msg_conversation_id = $1
          `,
          [input.conversationId, input.sentAt ?? null]
        );
        return { status: "inserted", message: inserted };
      }

      const existing = await queryRequired<MessageRecord>(
        db,
        `
          SELECT ${messageReturningSql()}
          FROM msg_messages
          WHERE parent_msg_conversation_id = $1
            AND msg_message_external_message_id = $2
        `,
        [input.conversationId, input.externalMessageId],
        "Failed to load existing outbound message"
      );

      return { status: "existing", message: existing };
    },

    async linkReplyToExternalMessageId(input: {
      messageId: string;
      conversationId: string;
      replyToExternalMessageId: string;
    }): Promise<void> {
      await db.query(
        `
          UPDATE msg_messages AS current_message
          SET reply_to_msg_message_id = quoted_message.msg_message_id
          FROM msg_messages AS quoted_message
          WHERE current_message.msg_message_id = $1
            AND current_message.parent_msg_conversation_id = $2
            AND current_message.reply_to_msg_message_id IS NULL
            AND quoted_message.parent_msg_conversation_id = $2
            AND quoted_message.msg_message_external_message_id = $3
        `,
        [
          input.messageId,
          input.conversationId,
          input.replyToExternalMessageId
        ]
      );
    },

    async addMessageMedia(input: AddMessageMediaInput): Promise<MessageMediaRecord> {
      return queryRequired<MessageMediaRecord>(
        db,
        `
          INSERT INTO msg_message_media (
            parent_msg_message_id,
            msg_message_media_external_media_id,
            msg_message_media_mime_type,
            msg_message_media_file_name,
            msg_message_media_size_bytes,
            msg_message_media_download_state
          ) VALUES ($1, $2, $3, $4, $5, $6)
          RETURNING ${messageMediaReturningSql()}
        `,
        [
          input.messageId,
          input.externalMediaId ?? null,
          input.mimeType,
          input.fileName ?? null,
          input.sizeBytes ?? null,
          input.downloadState ?? "queued"
        ],
        "Failed to add message media"
      );
    },

    async updateMessageMediaDownloadState(input: {
      messageMediaId: string;
      state: MessageMediaRecord["downloadState"];
    }): Promise<MessageMediaRecord> {
      return queryRequired<MessageMediaRecord>(
        db,
        `
          UPDATE msg_message_media
          SET msg_message_media_download_state = $2
          WHERE msg_message_media_id = $1
          RETURNING ${messageMediaReturningSql()}
        `,
        [input.messageMediaId, input.state],
        "Failed to update message media download state"
      );
    },

    async linkMessageMediaFileAsset(input: {
      messageMediaId: string;
      fileAssetId: string;
    }): Promise<MessageMediaRecord> {
      return queryRequired<MessageMediaRecord>(
        db,
        `
          UPDATE msg_message_media
          SET
            backing_res_file_asset_id = $2,
            msg_message_media_download_state = 'downloaded'
          WHERE msg_message_media_id = $1
          RETURNING ${messageMediaReturningSql()}
        `,
        [input.messageMediaId, input.fileAssetId],
        "Failed to link message media file asset"
      );
    },

    async findMessageMediaForPromotion(
      messageMediaId: string
    ): Promise<MessageMediaPromotionRecord | null> {
      return queryOne<MessageMediaPromotionRecord>(
        db,
        `
          SELECT
            ${messageMediaReturningSql()},
            msg_messages.parent_msg_conversation_id AS "conversationId",
            msg_messages.sender_core_contact_id AS "senderContactId",
            core_contacts.core_contact_display_name AS "senderDisplayName",
            msg_messages.msg_message_body AS "messageBody",
            msg_messages.msg_message_received_at AS "receivedAt"
          FROM msg_message_media
          INNER JOIN msg_messages
            ON msg_messages.msg_message_id =
              msg_message_media.parent_msg_message_id
          LEFT JOIN core_contacts
            ON core_contacts.core_contact_id =
              msg_messages.sender_core_contact_id
          WHERE msg_message_media.msg_message_media_id = $1
        `,
        [messageMediaId]
      );
    },

    async findInboundMessageForDraft(
      messageId: string
    ): Promise<InboundMessageForDraftRecord | null> {
      return queryOne<InboundMessageForDraftRecord>(
        db,
        `
          SELECT
            msg_messages.msg_message_id AS "messageId",
            msg_messages.parent_msg_conversation_id AS "conversationId",
            msg_messages.sender_core_contact_id AS "senderContactId",
            msg_messages.adapter_ops_adapter_event_id AS "adapterEventId",
            msg_messages.msg_message_external_message_id AS "externalMessageId",
            msg_messages.msg_message_direction AS "direction",
            msg_messages.msg_message_type AS "type",
            msg_messages.msg_message_body AS "body",
            msg_messages.msg_message_body_redacted AS "bodyRedacted",
            msg_messages.msg_message_status AS "status",
            msg_messages.msg_message_received_at AS "receivedAt",
            msg_conversations.msg_conversation_state AS "conversationState",
            msg_conversations.msg_conversation_context_state AS "conversationContextState",
            core_contacts.core_contact_display_name AS "senderDisplayName",
            core_contacts.core_contact_is_allowlisted AS "senderIsAllowlisted",
            core_contacts.core_contact_trust_level AS "senderTrustLevel"
          FROM msg_messages
          INNER JOIN msg_conversations
            ON msg_conversations.msg_conversation_id =
              msg_messages.parent_msg_conversation_id
          LEFT JOIN core_contacts
            ON core_contacts.core_contact_id =
              msg_messages.sender_core_contact_id
          WHERE msg_messages.msg_message_id = $1
            AND msg_messages.msg_message_direction = 'inbound'
        `,
        [messageId]
      );
    },

    async listInboundMessagesNeedingAutomation(input: {
      limit?: number;
    } = {}): Promise<InboundMessageAutomationCandidateRecord[]> {
      const result = await db.query<InboundMessageAutomationCandidateRecord>(
        `
          SELECT
            msg_messages.msg_message_id AS "messageId",
            msg_messages.parent_msg_conversation_id AS "conversationId",
            msg_messages.sender_core_contact_id AS "senderContactId",
            msg_messages.adapter_ops_adapter_event_id AS "adapterEventId",
            msg_messages.msg_message_external_message_id AS "externalMessageId",
            msg_messages.msg_message_direction AS "direction",
            msg_messages.msg_message_type AS "type",
            msg_messages.msg_message_body AS "body",
            msg_messages.msg_message_body_redacted AS "bodyRedacted",
            msg_messages.msg_message_status AS "status",
            msg_messages.msg_message_received_at AS "receivedAt",
            msg_conversations.msg_conversation_state AS "conversationState",
            msg_conversations.msg_conversation_context_state AS "conversationContextState",
            core_contacts.core_contact_display_name AS "senderDisplayName",
            core_contacts.core_contact_is_allowlisted AS "senderIsAllowlisted",
            core_contacts.core_contact_trust_level AS "senderTrustLevel",
            COUNT(agent_runs.agent_run_id)::integer AS "agentRunCount"
          FROM msg_messages
          INNER JOIN msg_conversations
            ON msg_conversations.msg_conversation_id =
              msg_messages.parent_msg_conversation_id
          INNER JOIN core_contacts
            ON core_contacts.core_contact_id =
              msg_messages.sender_core_contact_id
          LEFT JOIN agent_runs
            ON agent_runs.trigger_msg_message_id = msg_messages.msg_message_id
          WHERE msg_messages.msg_message_direction = 'inbound'
            AND msg_messages.msg_message_status = 'received'
            AND msg_messages.msg_message_body IS NOT NULL
            AND core_contacts.core_contact_is_allowlisted = true
            AND msg_conversations.msg_conversation_state = 'active'
          GROUP BY
            msg_messages.msg_message_id,
            msg_conversations.msg_conversation_id,
            core_contacts.core_contact_id
          HAVING COUNT(agent_runs.agent_run_id) = 0
          ORDER BY
            msg_messages.msg_message_received_at ASC NULLS LAST,
            msg_messages.msg_message_created_at ASC
          LIMIT $1
        `,
        [input.limit ?? 25]
      );

      return result.rows;
    }
  };
}
