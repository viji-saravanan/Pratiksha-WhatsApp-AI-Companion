import type { DbExecutor } from "../query.js";
import { queryOne, queryRequired } from "../query.js";

export interface MediaDownloadJobRecord {
  mediaDownloadJobId: string;
  messageMediaId: string;
  conversationId: string;
  state: "queued" | "running" | "downloaded" | "failed" | "blocked" | "skipped";
  priority: number;
  blockedReason: string | null;
  errorCode: string | null;
  errorMessage: string | null;
}

export interface MediaDownloadJobListRecord extends MediaDownloadJobRecord {
  externalMessageId: string;
  mimeType: string;
  fileName: string | null;
  sizeBytes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ClaimedMediaDownloadJobRecord extends MediaDownloadJobRecord {
  externalChatId: string;
  externalMessageId: string;
  externalMediaId: string | null;
  mimeType: string;
  fileName: string | null;
  sizeBytes: string | null;
  senderContactId: string | null;
}

export type IdempotentMediaDownloadJobResult =
  | { status: "inserted"; job: MediaDownloadJobRecord }
  | { status: "existing"; job: MediaDownloadJobRecord };

export function createMediaJobsRepository(db: DbExecutor) {
  return {
    async listMediaDownloadJobs(input?: {
      limit?: number;
      state?: MediaDownloadJobRecord["state"];
    }): Promise<MediaDownloadJobListRecord[]> {
      const limit = input?.limit ?? 50;
      const values: unknown[] = [limit];
      const stateFilter = input?.state ? "WHERE msg_media_download_job_state = $2" : "";
      if (input?.state) {
        values.push(input.state);
      }

      const result = await db.query<MediaDownloadJobListRecord>(
        `
          SELECT
            msg_media_download_jobs.msg_media_download_job_id AS "mediaDownloadJobId",
            msg_media_download_jobs.target_msg_message_media_id AS "messageMediaId",
            msg_media_download_jobs.target_msg_conversation_id AS "conversationId",
            msg_media_download_jobs.msg_media_download_job_state AS "state",
            msg_media_download_jobs.msg_media_download_job_priority AS "priority",
            msg_media_download_jobs.msg_media_download_job_blocked_reason AS "blockedReason",
            msg_media_download_jobs.msg_media_download_job_error_code AS "errorCode",
            msg_media_download_jobs.msg_media_download_job_error_message AS "errorMessage",
            msg_media_download_jobs.msg_media_download_job_created_at AS "createdAt",
            msg_media_download_jobs.msg_media_download_job_updated_at AS "updatedAt",
            msg_messages.msg_message_external_message_id AS "externalMessageId",
            msg_message_media.msg_message_media_mime_type AS "mimeType",
            msg_message_media.msg_message_media_file_name AS "fileName",
            msg_message_media.msg_message_media_size_bytes AS "sizeBytes"
          FROM msg_media_download_jobs
          INNER JOIN msg_message_media
            ON msg_message_media.msg_message_media_id =
              msg_media_download_jobs.target_msg_message_media_id
          INNER JOIN msg_messages
            ON msg_messages.msg_message_id =
              msg_message_media.parent_msg_message_id
          ${stateFilter}
          ORDER BY
            msg_media_download_jobs.msg_media_download_job_updated_at DESC,
            msg_media_download_jobs.msg_media_download_job_created_at DESC
          LIMIT $1
        `,
        values
      );

      return result.rows;
    },

    async createMediaDownloadJobIdempotent(input: {
      messageMediaId: string;
      conversationId: string;
      priority?: number;
    }): Promise<IdempotentMediaDownloadJobResult> {
      const inserted = await queryOne<MediaDownloadJobRecord>(
        db,
        `
          INSERT INTO msg_media_download_jobs (
            target_msg_message_media_id,
            target_msg_conversation_id,
            msg_media_download_job_state,
            msg_media_download_job_priority
          ) VALUES ($1, $2, 'queued', $3)
          ON CONFLICT (target_msg_message_media_id) DO NOTHING
          RETURNING
            msg_media_download_job_id AS "mediaDownloadJobId",
            target_msg_message_media_id AS "messageMediaId",
            target_msg_conversation_id AS "conversationId",
            msg_media_download_job_state AS "state",
            msg_media_download_job_priority AS "priority",
            msg_media_download_job_blocked_reason AS "blockedReason",
            msg_media_download_job_error_code AS "errorCode",
            msg_media_download_job_error_message AS "errorMessage"
        `,
        [input.messageMediaId, input.conversationId, input.priority ?? 100]
      );

      if (inserted) {
        return { status: "inserted", job: inserted };
      }

      const existing = await queryRequired<MediaDownloadJobRecord>(
        db,
        `
          SELECT
            msg_media_download_job_id AS "mediaDownloadJobId",
            target_msg_message_media_id AS "messageMediaId",
            target_msg_conversation_id AS "conversationId",
            msg_media_download_job_state AS "state",
            msg_media_download_job_priority AS "priority",
            msg_media_download_job_blocked_reason AS "blockedReason",
            msg_media_download_job_error_code AS "errorCode",
            msg_media_download_job_error_message AS "errorMessage"
          FROM msg_media_download_jobs
          WHERE target_msg_message_media_id = $1
        `,
        [input.messageMediaId],
        "Failed to load existing media download job"
      );

      return { status: "existing", job: existing };
    },

    async claimNextQueuedMediaDownloadJob(): Promise<ClaimedMediaDownloadJobRecord | null> {
      return queryOne<ClaimedMediaDownloadJobRecord>(
        db,
        `
          WITH next_job AS (
            SELECT msg_media_download_job_id
            FROM msg_media_download_jobs
            WHERE msg_media_download_job_state = 'queued'
            ORDER BY
              msg_media_download_job_priority ASC,
              msg_media_download_job_created_at ASC
            LIMIT 1
          ),
          claimed AS (
            UPDATE msg_media_download_jobs
            SET
              msg_media_download_job_state = 'running',
              msg_media_download_job_updated_at = now()
            FROM next_job
            WHERE msg_media_download_jobs.msg_media_download_job_id =
              next_job.msg_media_download_job_id
            RETURNING msg_media_download_jobs.*
          )
          SELECT
            claimed.msg_media_download_job_id AS "mediaDownloadJobId",
            claimed.target_msg_message_media_id AS "messageMediaId",
            claimed.target_msg_conversation_id AS "conversationId",
            claimed.msg_media_download_job_state AS "state",
            claimed.msg_media_download_job_priority AS "priority",
            claimed.msg_media_download_job_blocked_reason AS "blockedReason",
            claimed.msg_media_download_job_error_code AS "errorCode",
            claimed.msg_media_download_job_error_message AS "errorMessage",
            msg_conversations.msg_conversation_external_chat_id AS "externalChatId",
            msg_messages.msg_message_external_message_id AS "externalMessageId",
            msg_messages.sender_core_contact_id AS "senderContactId",
            msg_message_media.msg_message_media_external_media_id AS "externalMediaId",
            msg_message_media.msg_message_media_mime_type AS "mimeType",
            msg_message_media.msg_message_media_file_name AS "fileName",
            msg_message_media.msg_message_media_size_bytes AS "sizeBytes"
          FROM claimed
          INNER JOIN msg_message_media
            ON msg_message_media.msg_message_media_id =
              claimed.target_msg_message_media_id
          INNER JOIN msg_messages
            ON msg_messages.msg_message_id =
              msg_message_media.parent_msg_message_id
          INNER JOIN msg_conversations
            ON msg_conversations.msg_conversation_id =
              claimed.target_msg_conversation_id
        `
      );
    },

    async markMediaDownloadJobDownloaded(
      mediaDownloadJobId: string
    ): Promise<MediaDownloadJobRecord> {
      return queryRequired<MediaDownloadJobRecord>(
        db,
        `
          UPDATE msg_media_download_jobs
          SET
            msg_media_download_job_state = 'downloaded',
            msg_media_download_job_blocked_reason = NULL,
            msg_media_download_job_error_code = NULL,
            msg_media_download_job_error_message = NULL,
            msg_media_download_job_updated_at = now()
          WHERE msg_media_download_job_id = $1
          RETURNING
            msg_media_download_job_id AS "mediaDownloadJobId",
            target_msg_message_media_id AS "messageMediaId",
            target_msg_conversation_id AS "conversationId",
            msg_media_download_job_state AS "state",
            msg_media_download_job_priority AS "priority",
            msg_media_download_job_blocked_reason AS "blockedReason",
            msg_media_download_job_error_code AS "errorCode",
            msg_media_download_job_error_message AS "errorMessage"
        `,
        [mediaDownloadJobId],
        "Failed to mark media download job downloaded"
      );
    },

    async markMediaDownloadJobFailed(input: {
      mediaDownloadJobId: string;
      errorCode: string;
      errorMessage: string;
    }): Promise<MediaDownloadJobRecord> {
      return queryRequired<MediaDownloadJobRecord>(
        db,
        `
          UPDATE msg_media_download_jobs
          SET
            msg_media_download_job_state = 'failed',
            msg_media_download_job_error_code = $2,
            msg_media_download_job_error_message = $3,
            msg_media_download_job_updated_at = now()
          WHERE msg_media_download_job_id = $1
          RETURNING
            msg_media_download_job_id AS "mediaDownloadJobId",
            target_msg_message_media_id AS "messageMediaId",
            target_msg_conversation_id AS "conversationId",
            msg_media_download_job_state AS "state",
            msg_media_download_job_priority AS "priority",
            msg_media_download_job_blocked_reason AS "blockedReason",
            msg_media_download_job_error_code AS "errorCode",
            msg_media_download_job_error_message AS "errorMessage"
        `,
        [input.mediaDownloadJobId, input.errorCode, input.errorMessage],
        "Failed to mark media download job failed"
      );
    },

    async markMediaDownloadJobBlocked(input: {
      mediaDownloadJobId: string;
      blockedReason: string;
    }): Promise<MediaDownloadJobRecord> {
      return queryRequired<MediaDownloadJobRecord>(
        db,
        `
          UPDATE msg_media_download_jobs
          SET
            msg_media_download_job_state = 'blocked',
            msg_media_download_job_blocked_reason = $2,
            msg_media_download_job_updated_at = now()
          WHERE msg_media_download_job_id = $1
          RETURNING
            msg_media_download_job_id AS "mediaDownloadJobId",
            target_msg_message_media_id AS "messageMediaId",
            target_msg_conversation_id AS "conversationId",
            msg_media_download_job_state AS "state",
            msg_media_download_job_priority AS "priority",
            msg_media_download_job_blocked_reason AS "blockedReason",
            msg_media_download_job_error_code AS "errorCode",
            msg_media_download_job_error_message AS "errorMessage"
        `,
        [input.mediaDownloadJobId, input.blockedReason],
        "Failed to mark media download job blocked"
      );
    }
  };
}
