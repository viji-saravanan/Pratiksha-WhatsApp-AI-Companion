import type { DbExecutor } from "../query.js";
import { queryOne, queryRequired } from "../query.js";

export type AgentOutboundJobKind = "text_reply" | "resource_send";
export type AgentOutboundJobState =
  | "queued"
  | "sending"
  | "sent"
  | "failed"
  | "cancelled"
  | "blocked";

export interface AgentOutboundJobRecord {
  outboundJobId: string;
  conversationId: string;
  sourceDraftId: string | null;
  kind: AgentOutboundJobKind;
  payload: Record<string, unknown>;
  state: AgentOutboundJobState;
  priority: number;
  scheduledAt: Date;
  idempotencyKey: string;
  blockedReason: string | null;
}

export interface AgentOutboundJobListRecord extends AgentOutboundJobRecord {
  sourceDraftPolicyState: string | null;
}

export interface CreateQueuedOutboundJobInput {
  conversationId: string;
  sourceDraftId?: string | null;
  kind: AgentOutboundJobKind;
  payload?: Record<string, unknown>;
  priority?: number;
  scheduledAt?: Date;
  idempotencyKey: string;
}

export type IdempotentOutboundJobResult =
  | { status: "inserted"; job: AgentOutboundJobRecord }
  | { status: "existing"; job: AgentOutboundJobRecord };

function outboundJobReturningSql(): string {
  return `
    agent_outbound_job_id AS "outboundJobId",
    target_msg_conversation_id AS "conversationId",
    source_agent_draft_id AS "sourceDraftId",
    agent_outbound_job_kind AS "kind",
    agent_outbound_job_payload AS "payload",
    agent_outbound_job_state AS "state",
    agent_outbound_job_priority AS "priority",
    agent_outbound_job_scheduled_at AS "scheduledAt",
    agent_outbound_job_idempotency_key AS "idempotencyKey",
    agent_outbound_job_blocked_reason AS "blockedReason"
  `;
}

export function createOutboxRepository(db: DbExecutor) {
  return {
    async createQueuedJobIdempotent(
      input: CreateQueuedOutboundJobInput
    ): Promise<IdempotentOutboundJobResult> {
      const inserted = await queryOne<AgentOutboundJobRecord>(
        db,
        `
          INSERT INTO agent_outbound_jobs (
            target_msg_conversation_id,
            source_agent_draft_id,
            agent_outbound_job_kind,
            agent_outbound_job_payload,
            agent_outbound_job_state,
            agent_outbound_job_priority,
            agent_outbound_job_scheduled_at,
            agent_outbound_job_idempotency_key
          ) VALUES ($1, $2, $3, $4::jsonb, 'queued', $5, COALESCE($6, now()), $7)
          ON CONFLICT (agent_outbound_job_idempotency_key) DO NOTHING
          RETURNING ${outboundJobReturningSql()}
        `,
        [
          input.conversationId,
          input.sourceDraftId ?? null,
          input.kind,
          JSON.stringify(input.payload ?? {}),
          input.priority ?? 100,
          input.scheduledAt ?? null,
          input.idempotencyKey
        ]
      );

      if (inserted) {
        return { status: "inserted", job: inserted };
      }

      const existing = await queryRequired<AgentOutboundJobRecord>(
        db,
        `
          SELECT ${outboundJobReturningSql()}
          FROM agent_outbound_jobs
          WHERE agent_outbound_job_idempotency_key = $1
        `,
        [input.idempotencyKey],
        "Failed to load existing outbound job"
      );

      return { status: "existing", job: existing };
    },

    async findJobById(
      outboundJobId: string
    ): Promise<AgentOutboundJobRecord | null> {
      return queryOne<AgentOutboundJobRecord>(
        db,
        `
          SELECT ${outboundJobReturningSql()}
          FROM agent_outbound_jobs
          WHERE agent_outbound_job_id = $1
        `,
        [outboundJobId]
      );
    },

    async findNextDispatchableJob(): Promise<AgentOutboundJobRecord | null> {
      return queryOne<AgentOutboundJobRecord>(
        db,
        `
          SELECT ${outboundJobReturningSql()}
          FROM agent_outbound_jobs
          WHERE agent_outbound_job_state IN ('queued', 'failed')
            AND agent_outbound_job_scheduled_at <= now()
          ORDER BY
            agent_outbound_job_priority ASC,
            agent_outbound_job_scheduled_at ASC,
            agent_outbound_job_created_at ASC
          LIMIT 1
        `
      );
    },

    async markSending(
      outboundJobId: string
    ): Promise<AgentOutboundJobRecord> {
      return queryRequired<AgentOutboundJobRecord>(
        db,
        `
          UPDATE agent_outbound_jobs
          SET
            agent_outbound_job_state = 'sending',
            agent_outbound_job_blocked_reason = NULL,
            agent_outbound_job_updated_at = now()
          WHERE agent_outbound_job_id = $1
          RETURNING ${outboundJobReturningSql()}
        `,
        [outboundJobId],
        "Failed to mark outbound job sending"
      );
    },

    async markSent(outboundJobId: string): Promise<AgentOutboundJobRecord> {
      return queryRequired<AgentOutboundJobRecord>(
        db,
        `
          UPDATE agent_outbound_jobs
          SET
            agent_outbound_job_state = 'sent',
            agent_outbound_job_blocked_reason = NULL,
            agent_outbound_job_updated_at = now()
          WHERE agent_outbound_job_id = $1
          RETURNING ${outboundJobReturningSql()}
        `,
        [outboundJobId],
        "Failed to mark outbound job sent"
      );
    },

    async markFailed(input: {
      outboundJobId: string;
      blockedReason?: string | null;
    }): Promise<AgentOutboundJobRecord> {
      return queryRequired<AgentOutboundJobRecord>(
        db,
        `
          UPDATE agent_outbound_jobs
          SET
            agent_outbound_job_state = 'failed',
            agent_outbound_job_blocked_reason = $2,
            agent_outbound_job_updated_at = now()
          WHERE agent_outbound_job_id = $1
          RETURNING ${outboundJobReturningSql()}
        `,
        [input.outboundJobId, input.blockedReason ?? null],
        "Failed to mark outbound job failed"
      );
    },

    async markBlocked(input: {
      outboundJobId: string;
      blockedReason: string;
    }): Promise<AgentOutboundJobRecord> {
      return queryRequired<AgentOutboundJobRecord>(
        db,
        `
          UPDATE agent_outbound_jobs
          SET
            agent_outbound_job_state = 'blocked',
            agent_outbound_job_blocked_reason = $2,
            agent_outbound_job_updated_at = now()
          WHERE agent_outbound_job_id = $1
          RETURNING ${outboundJobReturningSql()}
        `,
        [input.outboundJobId, input.blockedReason],
        "Failed to mark outbound job blocked"
      );
    },

    async listJobs(input: {
      state?: AgentOutboundJobState;
      limit?: number;
    } = {}): Promise<AgentOutboundJobListRecord[]> {
      const values: unknown[] = [];
      const filters: string[] = [];

      if (input.state) {
        values.push(input.state);
        filters.push(`agent_outbound_jobs.agent_outbound_job_state = $${values.length}`);
      }

      values.push(input.limit ?? 50);
      const limitPlaceholder = `$${values.length}`;
      const result = await db.query<AgentOutboundJobListRecord>(
        `
          SELECT
            agent_outbound_jobs.agent_outbound_job_id AS "outboundJobId",
            agent_outbound_jobs.target_msg_conversation_id AS "conversationId",
            agent_outbound_jobs.source_agent_draft_id AS "sourceDraftId",
            agent_outbound_jobs.agent_outbound_job_kind AS "kind",
            agent_outbound_jobs.agent_outbound_job_payload AS "payload",
            agent_outbound_jobs.agent_outbound_job_state AS "state",
            agent_outbound_jobs.agent_outbound_job_priority AS "priority",
            agent_outbound_jobs.agent_outbound_job_scheduled_at AS "scheduledAt",
            agent_outbound_jobs.agent_outbound_job_idempotency_key AS "idempotencyKey",
            agent_outbound_jobs.agent_outbound_job_blocked_reason AS "blockedReason",
            agent_drafts.agent_draft_policy_state AS "sourceDraftPolicyState"
          FROM agent_outbound_jobs
          LEFT JOIN agent_drafts
            ON agent_drafts.agent_draft_id =
              agent_outbound_jobs.source_agent_draft_id
          ${filters.length > 0 ? `WHERE ${filters.join(" AND ")}` : ""}
          ORDER BY agent_outbound_jobs.agent_outbound_job_created_at DESC
          LIMIT ${limitPlaceholder}
        `,
        values
      );

      return result.rows;
    }
  };
}
