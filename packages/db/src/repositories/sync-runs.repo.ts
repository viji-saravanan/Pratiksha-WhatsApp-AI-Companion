import type { DbExecutor } from "../query.js";
import { queryRequired } from "../query.js";

export interface SyncRunRecord {
  syncRunId: string;
  channelAccountId: string;
  conversationId: string | null;
  kind: "startup" | "live" | "reconnect" | "backfill" | "media";
  state: "started" | "completed" | "failed" | "blocked";
  messagesSeen: number;
  messagesImported: number;
  contextStateAfter: "fresh" | "stale" | "recovering" | "unknown";
}

export function createSyncRunsRepository(db: DbExecutor) {
  return {
    async createSyncRun(input: {
      channelAccountId: string;
      conversationId?: string | null;
      kind: SyncRunRecord["kind"];
    }): Promise<SyncRunRecord> {
      return queryRequired<SyncRunRecord>(
        db,
        `
          INSERT INTO ops_sync_runs (
            source_core_channel_account_id,
            target_msg_conversation_id,
            ops_sync_run_kind,
            ops_sync_run_state
          ) VALUES ($1, $2, $3, 'started')
          RETURNING
            ops_sync_run_id AS "syncRunId",
            source_core_channel_account_id AS "channelAccountId",
            target_msg_conversation_id AS "conversationId",
            ops_sync_run_kind AS "kind",
            ops_sync_run_state AS "state",
            ops_sync_run_messages_seen AS "messagesSeen",
            ops_sync_run_messages_imported AS "messagesImported",
            ops_sync_run_context_state_after AS "contextStateAfter"
        `,
        [input.channelAccountId, input.conversationId ?? null, input.kind],
        "Failed to create sync run"
      );
    },

    async finishSyncRun(input: {
      syncRunId: string;
      state: Extract<SyncRunRecord["state"], "completed" | "failed" | "blocked">;
      messagesSeen: number;
      messagesImported: number;
      contextStateAfter?: SyncRunRecord["contextStateAfter"];
      errorCode?: string | null;
      errorMessage?: string | null;
    }): Promise<SyncRunRecord> {
      return queryRequired<SyncRunRecord>(
        db,
        `
          UPDATE ops_sync_runs
          SET
            ops_sync_run_state = $2,
            ops_sync_run_messages_seen = $3,
            ops_sync_run_messages_imported = $4,
            ops_sync_run_context_state_after = $5,
            ops_sync_run_error_code = $6,
            ops_sync_run_error_message = $7,
            ops_sync_run_finished_at = now()
          WHERE ops_sync_run_id = $1
          RETURNING
            ops_sync_run_id AS "syncRunId",
            source_core_channel_account_id AS "channelAccountId",
            target_msg_conversation_id AS "conversationId",
            ops_sync_run_kind AS "kind",
            ops_sync_run_state AS "state",
            ops_sync_run_messages_seen AS "messagesSeen",
            ops_sync_run_messages_imported AS "messagesImported",
            ops_sync_run_context_state_after AS "contextStateAfter"
        `,
        [
          input.syncRunId,
          input.state,
          input.messagesSeen,
          input.messagesImported,
          input.contextStateAfter ?? "unknown",
          input.errorCode ?? null,
          input.errorMessage ?? null
        ],
        "Failed to finish sync run"
      );
    },

    async listRecentSyncRuns(limit = 20): Promise<SyncRunRecord[]> {
      const result = await db.query<SyncRunRecord>(
        `
          SELECT
            ops_sync_run_id AS "syncRunId",
            source_core_channel_account_id AS "channelAccountId",
            target_msg_conversation_id AS "conversationId",
            ops_sync_run_kind AS "kind",
            ops_sync_run_state AS "state",
            ops_sync_run_messages_seen AS "messagesSeen",
            ops_sync_run_messages_imported AS "messagesImported",
            ops_sync_run_context_state_after AS "contextStateAfter"
          FROM ops_sync_runs
          ORDER BY ops_sync_run_started_at DESC
          LIMIT $1
        `,
        [limit]
      );

      return result.rows;
    }
  };
}
