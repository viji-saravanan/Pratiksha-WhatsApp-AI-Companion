import type { DbExecutor } from "../query.js";
import { queryRequired } from "../query.js";

export interface AuditEventRecord {
  auditEventId: string;
  type: string;
  severity: "info" | "warn" | "error" | "critical";
  detail: Record<string, unknown>;
  createdAt?: Date;
}

export function createAuditEventsRepository(db: DbExecutor) {
  return {
    async recordAuditEvent(input: {
      type: string;
      severity?: AuditEventRecord["severity"];
      detail?: Record<string, unknown>;
      actorPersonId?: string | null;
      contactId?: string | null;
      conversationId?: string | null;
    }): Promise<AuditEventRecord> {
      return queryRequired<AuditEventRecord>(
        db,
        `
          INSERT INTO ops_audit_events (
            actor_core_person_id,
            scope_core_contact_id,
            scope_msg_conversation_id,
            ops_audit_event_type,
            ops_audit_event_severity,
            ops_audit_event_detail
          ) VALUES ($1, $2, $3, $4, $5, $6::jsonb)
          RETURNING
            ops_audit_event_id AS "auditEventId",
            ops_audit_event_type AS "type",
            ops_audit_event_severity AS "severity",
            ops_audit_event_detail AS "detail"
        `,
        [
          input.actorPersonId ?? null,
          input.contactId ?? null,
          input.conversationId ?? null,
          input.type,
          input.severity ?? "info",
          JSON.stringify(input.detail ?? {})
        ],
        "Failed to record audit event"
      );
    },

    async listAuditEvents(limit = 50): Promise<AuditEventRecord[]> {
      const result = await db.query<AuditEventRecord>(
        `
          SELECT
            ops_audit_event_id AS "auditEventId",
            ops_audit_event_type AS "type",
            ops_audit_event_severity AS "severity",
            ops_audit_event_detail AS "detail",
            ops_audit_event_created_at AS "createdAt"
          FROM ops_audit_events
          ORDER BY ops_audit_event_created_at DESC
          LIMIT $1
        `,
        [limit]
      );

      return result.rows;
    }
  };
}
