import type { DbExecutor } from "../query.js";
import { queryOne, queryRequired } from "../query.js";

export type AgentDraftPolicyState =
  | "candidate"
  | "auto_allowed"
  | "confirm_resource"
  | "blocked"
  | "sent"
  | "expired";

export interface AgentDraftRecord {
  agentDraftId: string;
  conversationId: string;
  triggerMessageId: string;
  sourceAgentRunId: string;
  body: string;
  confidence: string | null;
  policyState: AgentDraftPolicyState;
  decidedAt: Date | null;
}

export interface AgentDraftForOutboundRecord extends AgentDraftRecord {
  conversationState: "active" | "paused" | "archived" | "ignored";
  conversationContextState: "fresh" | "stale" | "recovering" | "unknown";
  triggerReceivedAt: Date | null;
  recipientContactId: string | null;
  recipientIsAllowlisted: boolean | null;
  recipientTrustLevel: "low" | "normal" | "trusted" | null;
}

export interface AgentDraftListRecord extends AgentDraftRecord {
  recipientContactId: string | null;
  recipientDisplayName: string | null;
  conversationTitle: string;
}

export interface CreateAgentDraftInput {
  conversationId: string;
  triggerMessageId: string;
  sourceAgentRunId: string;
  body: string;
  confidence?: number | null;
  policyState?: AgentDraftPolicyState;
  decidedAt?: Date | null;
}

export function createDraftsRepository(db: DbExecutor) {
  return {
    async createDraft(input: CreateAgentDraftInput): Promise<AgentDraftRecord> {
      return queryRequired<AgentDraftRecord>(
        db,
        `
          INSERT INTO agent_drafts (
            parent_msg_conversation_id,
            trigger_msg_message_id,
            source_agent_run_id,
            agent_draft_body,
            agent_draft_confidence,
            agent_draft_policy_state,
            agent_draft_decided_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7)
          RETURNING
            agent_draft_id AS "agentDraftId",
            parent_msg_conversation_id AS "conversationId",
            trigger_msg_message_id AS "triggerMessageId",
            source_agent_run_id AS "sourceAgentRunId",
            agent_draft_body AS "body",
            agent_draft_confidence AS "confidence",
            agent_draft_policy_state AS "policyState",
            agent_draft_decided_at AS "decidedAt"
        `,
        [
          input.conversationId,
          input.triggerMessageId,
          input.sourceAgentRunId,
          input.body,
          input.confidence ?? null,
          input.policyState ?? "candidate",
          input.decidedAt ?? null
        ],
        "Failed to create agent draft"
      );
    },

    async findDraftForOutbound(
      agentDraftId: string
    ): Promise<AgentDraftForOutboundRecord | null> {
      return queryOne<AgentDraftForOutboundRecord>(
        db,
        `
          SELECT
            agent_drafts.agent_draft_id AS "agentDraftId",
            agent_drafts.parent_msg_conversation_id AS "conversationId",
            agent_drafts.trigger_msg_message_id AS "triggerMessageId",
            agent_drafts.source_agent_run_id AS "sourceAgentRunId",
            agent_drafts.agent_draft_body AS "body",
            agent_drafts.agent_draft_confidence AS "confidence",
            agent_drafts.agent_draft_policy_state AS "policyState",
            agent_drafts.agent_draft_decided_at AS "decidedAt",
            msg_conversations.msg_conversation_state AS "conversationState",
            msg_conversations.msg_conversation_context_state AS "conversationContextState",
            msg_messages.msg_message_received_at AS "triggerReceivedAt",
            msg_messages.sender_core_contact_id AS "recipientContactId",
            core_contacts.core_contact_is_allowlisted AS "recipientIsAllowlisted",
            core_contacts.core_contact_trust_level AS "recipientTrustLevel"
          FROM agent_drafts
          INNER JOIN msg_conversations
            ON msg_conversations.msg_conversation_id =
              agent_drafts.parent_msg_conversation_id
          INNER JOIN msg_messages
            ON msg_messages.msg_message_id =
              agent_drafts.trigger_msg_message_id
          LEFT JOIN core_contacts
            ON core_contacts.core_contact_id =
              msg_messages.sender_core_contact_id
          WHERE agent_drafts.agent_draft_id = $1
        `,
        [agentDraftId]
      );
    },

    async updateDraftPolicyState(input: {
      agentDraftId: string;
      policyState: AgentDraftPolicyState;
      decidedAt?: Date | null;
    }): Promise<AgentDraftRecord> {
      return queryRequired<AgentDraftRecord>(
        db,
        `
          UPDATE agent_drafts
          SET
            agent_draft_policy_state = $2,
            agent_draft_decided_at = $3
          WHERE agent_draft_id = $1
          RETURNING
            agent_draft_id AS "agentDraftId",
            parent_msg_conversation_id AS "conversationId",
            trigger_msg_message_id AS "triggerMessageId",
            source_agent_run_id AS "sourceAgentRunId",
            agent_draft_body AS "body",
            agent_draft_confidence AS "confidence",
            agent_draft_policy_state AS "policyState",
            agent_draft_decided_at AS "decidedAt"
        `,
        [
          input.agentDraftId,
          input.policyState,
          input.decidedAt ?? new Date()
        ],
        "Failed to update agent draft policy state"
      );
    },

    async listDrafts(input: {
      policyState?: AgentDraftPolicyState;
      limit?: number;
    } = {}): Promise<AgentDraftListRecord[]> {
      const values: unknown[] = [];
      const filters: string[] = [];

      if (input.policyState) {
        values.push(input.policyState);
        filters.push(`agent_drafts.agent_draft_policy_state = $${values.length}`);
      }

      values.push(input.limit ?? 50);
      const limitPlaceholder = `$${values.length}`;
      const result = await db.query<AgentDraftListRecord>(
        `
          SELECT
            agent_drafts.agent_draft_id AS "agentDraftId",
            agent_drafts.parent_msg_conversation_id AS "conversationId",
            agent_drafts.trigger_msg_message_id AS "triggerMessageId",
            agent_drafts.source_agent_run_id AS "sourceAgentRunId",
            agent_drafts.agent_draft_body AS "body",
            agent_drafts.agent_draft_confidence AS "confidence",
            agent_drafts.agent_draft_policy_state AS "policyState",
            agent_drafts.agent_draft_decided_at AS "decidedAt",
            msg_messages.sender_core_contact_id AS "recipientContactId",
            core_contacts.core_contact_display_name AS "recipientDisplayName",
            msg_conversations.msg_conversation_title AS "conversationTitle"
          FROM agent_drafts
          INNER JOIN msg_messages
            ON msg_messages.msg_message_id =
              agent_drafts.trigger_msg_message_id
          INNER JOIN msg_conversations
            ON msg_conversations.msg_conversation_id =
              agent_drafts.parent_msg_conversation_id
          LEFT JOIN core_contacts
            ON core_contacts.core_contact_id =
              msg_messages.sender_core_contact_id
          ${filters.length > 0 ? `WHERE ${filters.join(" AND ")}` : ""}
          ORDER BY agent_drafts.agent_draft_created_at DESC
          LIMIT ${limitPlaceholder}
        `,
        values
      );

      return result.rows;
    }
  };
}
