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

export type MessageMediaTranscriptStatus =
  | "pending"
  | "transcribed"
  | "low_confidence"
  | "failed"
  | "unsupported";

export interface MessageMediaTranscriptRecord {
  messageMediaTranscriptId: string;
  messageMediaId: string;
  status: MessageMediaTranscriptStatus;
  text: string | null;
  language: string | null;
  confidence: string | null;
  durationMs: number | null;
  modelName: string | null;
  errorCode: string | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface MessageMediaTranscriptListRecord
  extends MessageMediaTranscriptRecord {
  messageId: string;
  conversationId: string;
  externalMessageId: string;
  mimeType: string;
  fileName: string | null;
  sizeBytes: string | null;
  messageBody: string | null;
}

export interface MessageMediaTranscriptionCandidateRecord
  extends MessageMediaRecord {
  conversationId: string;
  externalMessageId: string;
  storageUri: string;
  assetMimeType: string;
  messageBody: string | null;
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

function messageMediaTranscriptReturningSql(table = ""): string {
  const prefix = table ? `${table}.` : "";
  return `
    ${prefix}msg_message_media_transcript_id AS "messageMediaTranscriptId",
    ${prefix}parent_msg_message_media_id AS "messageMediaId",
    ${prefix}msg_message_media_transcript_status AS "status",
    ${prefix}msg_message_media_transcript_text AS "text",
    ${prefix}msg_message_media_transcript_language AS "language",
    ${prefix}msg_message_media_transcript_confidence AS "confidence",
    ${prefix}msg_message_media_transcript_duration_ms AS "durationMs",
    ${prefix}msg_message_media_transcript_model_name AS "modelName",
    ${prefix}msg_message_media_transcript_error_code AS "errorCode",
    ${prefix}msg_message_media_transcript_metadata AS "metadata",
    ${prefix}msg_message_media_transcript_created_at AS "createdAt",
    ${prefix}msg_message_media_transcript_updated_at AS "updatedAt"
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

    async findMessageMediaForTranscription(
      messageMediaId: string
    ): Promise<MessageMediaTranscriptionCandidateRecord | null> {
      return queryOne<MessageMediaTranscriptionCandidateRecord>(
        db,
        `
          SELECT
            ${messageMediaReturningSql()},
            msg_messages.parent_msg_conversation_id AS "conversationId",
            msg_messages.msg_message_external_message_id AS "externalMessageId",
            msg_messages.msg_message_body AS "messageBody",
            res_file_assets.res_file_asset_storage_uri AS "storageUri",
            res_file_assets.res_file_asset_mime_type AS "assetMimeType"
          FROM msg_message_media
          INNER JOIN msg_messages
            ON msg_messages.msg_message_id =
              msg_message_media.parent_msg_message_id
          INNER JOIN res_file_assets
            ON res_file_assets.res_file_asset_id =
              msg_message_media.backing_res_file_asset_id
          WHERE msg_message_media.msg_message_media_id = $1
        `,
        [messageMediaId]
      );
    },

    async findDownloadedAudioMediaForTranscription(input: {
      limit?: number;
    } = {}): Promise<MessageMediaTranscriptionCandidateRecord[]> {
      const result = await db.query<MessageMediaTranscriptionCandidateRecord>(
        `
          SELECT
            ${messageMediaReturningSql()},
            msg_messages.parent_msg_conversation_id AS "conversationId",
            msg_messages.msg_message_external_message_id AS "externalMessageId",
            msg_messages.msg_message_body AS "messageBody",
            res_file_assets.res_file_asset_storage_uri AS "storageUri",
            res_file_assets.res_file_asset_mime_type AS "assetMimeType"
          FROM msg_message_media
          INNER JOIN msg_messages
            ON msg_messages.msg_message_id =
              msg_message_media.parent_msg_message_id
          INNER JOIN res_file_assets
            ON res_file_assets.res_file_asset_id =
              msg_message_media.backing_res_file_asset_id
          LEFT JOIN msg_message_media_transcripts
            ON msg_message_media_transcripts.parent_msg_message_media_id =
              msg_message_media.msg_message_media_id
          WHERE msg_message_media.msg_message_media_download_state = 'downloaded'
            AND msg_message_media.msg_message_media_mime_type LIKE 'audio/%'
            AND msg_message_media_transcripts.msg_message_media_transcript_id IS NULL
          ORDER BY msg_message_media.msg_message_media_created_at ASC
          LIMIT $1
        `,
        [input.limit ?? 10]
      );

      return result.rows;
    },

    async findMessageMediaTranscript(
      messageMediaId: string
    ): Promise<MessageMediaTranscriptRecord | null> {
      return queryOne<MessageMediaTranscriptRecord>(
        db,
        `
          SELECT ${messageMediaTranscriptReturningSql()}
          FROM msg_message_media_transcripts
          WHERE parent_msg_message_media_id = $1
        `,
        [messageMediaId]
      );
    },

    async upsertMessageMediaTranscript(input: {
      messageMediaId: string;
      status: MessageMediaTranscriptStatus;
      text?: string | null;
      language?: string | null;
      confidence?: number | null;
      durationMs?: number | null;
      modelName?: string | null;
      errorCode?: string | null;
      metadata?: Record<string, unknown>;
    }): Promise<MessageMediaTranscriptRecord> {
      return queryRequired<MessageMediaTranscriptRecord>(
        db,
        `
          INSERT INTO msg_message_media_transcripts (
            parent_msg_message_media_id,
            msg_message_media_transcript_status,
            msg_message_media_transcript_text,
            msg_message_media_transcript_language,
            msg_message_media_transcript_confidence,
            msg_message_media_transcript_duration_ms,
            msg_message_media_transcript_model_name,
            msg_message_media_transcript_error_code,
            msg_message_media_transcript_metadata
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
          ON CONFLICT (parent_msg_message_media_id) DO UPDATE
          SET
            msg_message_media_transcript_status =
              EXCLUDED.msg_message_media_transcript_status,
            msg_message_media_transcript_text =
              EXCLUDED.msg_message_media_transcript_text,
            msg_message_media_transcript_language =
              EXCLUDED.msg_message_media_transcript_language,
            msg_message_media_transcript_confidence =
              EXCLUDED.msg_message_media_transcript_confidence,
            msg_message_media_transcript_duration_ms =
              EXCLUDED.msg_message_media_transcript_duration_ms,
            msg_message_media_transcript_model_name =
              EXCLUDED.msg_message_media_transcript_model_name,
            msg_message_media_transcript_error_code =
              EXCLUDED.msg_message_media_transcript_error_code,
            msg_message_media_transcript_metadata =
              EXCLUDED.msg_message_media_transcript_metadata,
            msg_message_media_transcript_updated_at = now()
          RETURNING ${messageMediaTranscriptReturningSql()}
        `,
        [
          input.messageMediaId,
          input.status,
          input.text ?? null,
          input.language ?? null,
          input.confidence ?? null,
          input.durationMs ?? null,
          input.modelName ?? null,
          input.errorCode ?? null,
          JSON.stringify(input.metadata ?? {})
        ],
        "Failed to upsert message media transcript"
      );
    },

    async applyTranscriptToInboundAudioMessage(input: {
      messageMediaId: string;
      transcriptText: string;
    }): Promise<MessageRecord | null> {
      return queryOne<MessageRecord>(
        db,
        `
          UPDATE msg_messages
          SET msg_message_body = $2
          FROM msg_message_media
          WHERE msg_message_media.msg_message_media_id = $1
            AND msg_message_media.parent_msg_message_id =
              msg_messages.msg_message_id
            AND msg_messages.msg_message_direction = 'inbound'
            AND msg_messages.msg_message_type = 'audio'
            AND msg_messages.msg_message_body IS NULL
          RETURNING ${messageReturningSql()}
        `,
        [input.messageMediaId, input.transcriptText]
      );
    },

    async listMessageMediaTranscripts(input: {
      limit?: number;
      status?: MessageMediaTranscriptStatus;
    } = {}): Promise<MessageMediaTranscriptListRecord[]> {
      const values: unknown[] = [input.limit ?? 50];
      const statusFilter = input.status
        ? "WHERE msg_message_media_transcript_status = $2"
        : "";
      if (input.status) {
        values.push(input.status);
      }

      const result = await db.query<MessageMediaTranscriptListRecord>(
        `
          SELECT
            ${messageMediaTranscriptReturningSql("msg_message_media_transcripts")},
            msg_message_media.parent_msg_message_id AS "messageId",
            msg_messages.parent_msg_conversation_id AS "conversationId",
            msg_messages.msg_message_external_message_id AS "externalMessageId",
            msg_messages.msg_message_body AS "messageBody",
            msg_message_media.msg_message_media_mime_type AS "mimeType",
            msg_message_media.msg_message_media_file_name AS "fileName",
            msg_message_media.msg_message_media_size_bytes AS "sizeBytes"
          FROM msg_message_media_transcripts
          INNER JOIN msg_message_media
            ON msg_message_media.msg_message_media_id =
              msg_message_media_transcripts.parent_msg_message_media_id
          INNER JOIN msg_messages
            ON msg_messages.msg_message_id =
              msg_message_media.parent_msg_message_id
          ${statusFilter}
          ORDER BY
            msg_message_media_transcripts.msg_message_media_transcript_updated_at DESC,
            msg_message_media_transcripts.msg_message_media_transcript_created_at DESC
          LIMIT $1
        `,
        values
      );

      return result.rows;
    },

    async countMessageMediaTranscriptsByStatus(): Promise<
      Record<MessageMediaTranscriptStatus, number>
    > {
      const result = await db.query<{ status: MessageMediaTranscriptStatus; count: string }>(
        `
          SELECT
            msg_message_media_transcript_status AS "status",
            count(*) AS "count"
          FROM msg_message_media_transcripts
          GROUP BY msg_message_media_transcript_status
        `
      );
      const counts: Record<MessageMediaTranscriptStatus, number> = {
        pending: 0,
        transcribed: 0,
        low_confidence: 0,
        failed: 0,
        unsupported: 0
      };
      for (const row of result.rows) {
        counts[row.status] = Number(row.count);
      }

      return counts;
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
