import type { DbExecutor } from "../query.js";
import { queryOne, queryRequired } from "../query.js";

export interface BackfillJobRecord {
  backfillJobId: string;
  conversationId: string;
  state: "queued" | "running" | "paused" | "completed" | "failed" | "blocked";
  cursor: string | null;
  messagesImported: number;
}

export function createBackfillJobsRepository(db: DbExecutor) {
  return {
    async createBackfillJob(conversationId: string): Promise<BackfillJobRecord> {
      return queryRequired<BackfillJobRecord>(
        db,
        `
          INSERT INTO msg_history_backfill_jobs (
            target_msg_conversation_id
          ) VALUES ($1)
          RETURNING
            msg_history_backfill_job_id AS "backfillJobId",
            target_msg_conversation_id AS "conversationId",
            msg_history_backfill_job_state AS "state",
            msg_history_backfill_job_cursor AS "cursor",
            msg_history_backfill_job_messages_imported AS "messagesImported"
        `,
        [conversationId],
        "Failed to create backfill job"
      );
    },

    async updateBackfillJobState(input: {
      backfillJobId: string;
      state: BackfillJobRecord["state"];
      cursor?: string | null;
      messagesImported?: number;
      errorCode?: string | null;
      errorMessage?: string | null;
    }): Promise<BackfillJobRecord> {
      return queryRequired<BackfillJobRecord>(
        db,
        `
          UPDATE msg_history_backfill_jobs
          SET
            msg_history_backfill_job_state = $2,
            msg_history_backfill_job_cursor = COALESCE($3, msg_history_backfill_job_cursor),
            msg_history_backfill_job_messages_imported = COALESCE($4, msg_history_backfill_job_messages_imported),
            msg_history_backfill_job_error_code = $5,
            msg_history_backfill_job_error_message = $6,
            msg_history_backfill_job_started_at = CASE
              WHEN $2 = 'running' THEN COALESCE(msg_history_backfill_job_started_at, now())
              ELSE msg_history_backfill_job_started_at
            END,
            msg_history_backfill_job_updated_at = now(),
            msg_history_backfill_job_finished_at = CASE
              WHEN $2 IN ('completed', 'failed', 'blocked') THEN now()
              ELSE msg_history_backfill_job_finished_at
            END
          WHERE msg_history_backfill_job_id = $1
          RETURNING
            msg_history_backfill_job_id AS "backfillJobId",
            target_msg_conversation_id AS "conversationId",
            msg_history_backfill_job_state AS "state",
            msg_history_backfill_job_cursor AS "cursor",
            msg_history_backfill_job_messages_imported AS "messagesImported"
        `,
        [
          input.backfillJobId,
          input.state,
          input.cursor ?? null,
          input.messagesImported ?? null,
          input.errorCode ?? null,
          input.errorMessage ?? null
        ],
        "Failed to update backfill job"
      );
    },

    async findLatestBackfillJobForConversation(
      conversationId: string
    ): Promise<BackfillJobRecord | null> {
      return queryOne<BackfillJobRecord>(
        db,
        `
          SELECT
            msg_history_backfill_job_id AS "backfillJobId",
            target_msg_conversation_id AS "conversationId",
            msg_history_backfill_job_state AS "state",
            msg_history_backfill_job_cursor AS "cursor",
            msg_history_backfill_job_messages_imported AS "messagesImported"
          FROM msg_history_backfill_jobs
          WHERE target_msg_conversation_id = $1
          ORDER BY msg_history_backfill_job_created_at DESC
          LIMIT 1
        `,
        [conversationId]
      );
    },

    async listBackfillJobs(limit = 50): Promise<BackfillJobRecord[]> {
      const result = await db.query<BackfillJobRecord>(
        `
          SELECT
            msg_history_backfill_job_id AS "backfillJobId",
            target_msg_conversation_id AS "conversationId",
            msg_history_backfill_job_state AS "state",
            msg_history_backfill_job_cursor AS "cursor",
            msg_history_backfill_job_messages_imported AS "messagesImported"
          FROM msg_history_backfill_jobs
          ORDER BY msg_history_backfill_job_updated_at DESC
          LIMIT $1
        `,
        [limit]
      );

      return result.rows;
    }
  };
}
