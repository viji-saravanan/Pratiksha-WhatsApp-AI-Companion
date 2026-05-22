import type { DbExecutor } from "../query.js";
import { queryRequired } from "../query.js";

export interface ConversationSummaryRecord {
  conversationSummaryId: string;
  conversationId: string;
  fromMessageId: string | null;
  toMessageId: string | null;
  kind: "rolling" | "daily" | "manual" | "backfill";
  text: string;
  tokenCount: number | null;
}

export function createConversationSummariesRepository(db: DbExecutor) {
  return {
    async createConversationSummary(input: {
      conversationId: string;
      fromMessageId?: string | null;
      toMessageId?: string | null;
      kind: ConversationSummaryRecord["kind"];
      text: string;
      tokenCount?: number | null;
    }): Promise<ConversationSummaryRecord> {
      return queryRequired<ConversationSummaryRecord>(
        db,
        `
          INSERT INTO msg_conversation_summaries (
            parent_msg_conversation_id,
            from_msg_message_id,
            to_msg_message_id,
            msg_conversation_summary_kind,
            msg_conversation_summary_text,
            msg_conversation_summary_token_count
          ) VALUES ($1, $2, $3, $4, $5, $6)
          RETURNING
            msg_conversation_summary_id AS "conversationSummaryId",
            parent_msg_conversation_id AS "conversationId",
            from_msg_message_id AS "fromMessageId",
            to_msg_message_id AS "toMessageId",
            msg_conversation_summary_kind AS "kind",
            msg_conversation_summary_text AS "text",
            msg_conversation_summary_token_count AS "tokenCount"
        `,
        [
          input.conversationId,
          input.fromMessageId ?? null,
          input.toMessageId ?? null,
          input.kind,
          input.text,
          input.tokenCount ?? null
        ],
        "Failed to create conversation summary"
      );
    },

    async listConversationSummaries(input: {
      conversationId: string;
      limit?: number;
    }): Promise<ConversationSummaryRecord[]> {
      const result = await db.query<ConversationSummaryRecord>(
        `
          SELECT
            msg_conversation_summary_id AS "conversationSummaryId",
            parent_msg_conversation_id AS "conversationId",
            from_msg_message_id AS "fromMessageId",
            to_msg_message_id AS "toMessageId",
            msg_conversation_summary_kind AS "kind",
            msg_conversation_summary_text AS "text",
            msg_conversation_summary_token_count AS "tokenCount"
          FROM msg_conversation_summaries
          WHERE parent_msg_conversation_id = $1
          ORDER BY msg_conversation_summary_created_at DESC
          LIMIT $2
        `,
        [input.conversationId, input.limit ?? 20]
      );

      return result.rows;
    }
  };
}
