import type { DbExecutor } from "../query.js";
import { queryOne, queryRequired } from "../query.js";

export type SyncCursorName =
  | "latest_message"
  | "oldest_backfilled"
  | "media_checkpoint"
  | "reconnect_checkpoint";

export interface SyncCursorRecord {
  syncCursorId: string;
  channelAccountId: string;
  conversationId: string | null;
  name: SyncCursorName;
  value: string;
}

export interface UpsertSyncCursorInput {
  channelAccountId: string;
  conversationId?: string | null;
  name: SyncCursorName;
  value: string;
}

export function createSyncCursorsRepository(db: DbExecutor) {
  return {
    async upsertSyncCursor(input: UpsertSyncCursorInput): Promise<SyncCursorRecord> {
      const conversationId = input.conversationId ?? null;
      if (conversationId) {
        return queryRequired<SyncCursorRecord>(
          db,
          `
            INSERT INTO ops_sync_cursors (
              source_core_channel_account_id,
              target_msg_conversation_id,
              ops_sync_cursor_name,
              ops_sync_cursor_value
            ) VALUES ($1, $2, $3, $4)
            ON CONFLICT (
              source_core_channel_account_id,
              target_msg_conversation_id,
              ops_sync_cursor_name
            ) WHERE target_msg_conversation_id IS NOT NULL
            DO UPDATE SET
              ops_sync_cursor_value = excluded.ops_sync_cursor_value,
              ops_sync_cursor_updated_at = now()
            RETURNING
              ops_sync_cursor_id AS "syncCursorId",
              source_core_channel_account_id AS "channelAccountId",
              target_msg_conversation_id AS "conversationId",
              ops_sync_cursor_name AS "name",
              ops_sync_cursor_value AS "value"
          `,
          [input.channelAccountId, conversationId, input.name, input.value],
          "Failed to upsert conversation sync cursor"
        );
      }

      return queryRequired<SyncCursorRecord>(
        db,
        `
          INSERT INTO ops_sync_cursors (
            source_core_channel_account_id,
            target_msg_conversation_id,
            ops_sync_cursor_name,
            ops_sync_cursor_value
          ) VALUES ($1, NULL, $2, $3)
          ON CONFLICT (
            source_core_channel_account_id,
            ops_sync_cursor_name
          ) WHERE target_msg_conversation_id IS NULL
          DO UPDATE SET
            ops_sync_cursor_value = excluded.ops_sync_cursor_value,
            ops_sync_cursor_updated_at = now()
          RETURNING
            ops_sync_cursor_id AS "syncCursorId",
            source_core_channel_account_id AS "channelAccountId",
            target_msg_conversation_id AS "conversationId",
            ops_sync_cursor_name AS "name",
            ops_sync_cursor_value AS "value"
        `,
        [input.channelAccountId, input.name, input.value],
        "Failed to upsert account sync cursor"
      );
    },

    async findSyncCursor(input: {
      channelAccountId: string;
      conversationId?: string | null;
      name: SyncCursorName;
    }): Promise<SyncCursorRecord | null> {
      const conversationId = input.conversationId ?? null;
      return queryOne<SyncCursorRecord>(
        db,
        `
          SELECT
            ops_sync_cursor_id AS "syncCursorId",
            source_core_channel_account_id AS "channelAccountId",
            target_msg_conversation_id AS "conversationId",
            ops_sync_cursor_name AS "name",
            ops_sync_cursor_value AS "value"
          FROM ops_sync_cursors
          WHERE source_core_channel_account_id = $1
            AND ops_sync_cursor_name = $2
            AND (
              ($3::uuid IS NULL AND target_msg_conversation_id IS NULL) OR
              target_msg_conversation_id = $3::uuid
            )
        `,
        [input.channelAccountId, input.name, conversationId]
      );
    }
  };
}
