import type { DbExecutor } from "../query.js";
import { queryRequired } from "../query.js";

export type ResponsePolicyMode = "auto" | "confirm_resource" | "readonly" | "paused";

export interface ResponsePolicyRecord {
  responsePolicyId: string;
  contactId: string | null;
  conversationId: string | null;
  mode: ResponsePolicyMode;
  allowFileSharing: boolean;
  maxAutoRepliesPerHour: number;
  quietHours: Record<string, unknown> | null;
}

export interface PolicyModeUpdateResult {
  mode: ResponsePolicyMode;
  affectedContacts: number;
  affectedConversations: number;
}

function policyReturningSql(): string {
  return `
    policy_response_policy_id AS "responsePolicyId",
    target_core_contact_id AS "contactId",
    target_msg_conversation_id AS "conversationId",
    policy_response_policy_mode AS "mode",
    policy_response_policy_allow_file_sharing AS "allowFileSharing",
    policy_response_policy_max_auto_replies_per_hour AS "maxAutoRepliesPerHour",
    policy_response_policy_quiet_hours AS "quietHours"
  `;
}

async function upsertContactPolicy(
  db: DbExecutor,
  input: {
    contactId: string;
    mode: ResponsePolicyMode;
    allowFileSharing?: boolean;
    maxAutoRepliesPerHour?: number;
    quietHours?: Record<string, unknown> | null;
  }
): Promise<ResponsePolicyRecord> {
  return queryRequired<ResponsePolicyRecord>(
    db,
    `
      INSERT INTO policy_response_policies (
        target_core_contact_id,
        policy_response_policy_mode,
        policy_response_policy_allow_file_sharing,
        policy_response_policy_max_auto_replies_per_hour,
        policy_response_policy_quiet_hours
      ) VALUES ($1, $2, $3, $4, $5::jsonb)
      ON CONFLICT (target_core_contact_id)
        WHERE target_core_contact_id IS NOT NULL
      DO UPDATE SET
        policy_response_policy_mode = excluded.policy_response_policy_mode,
        policy_response_policy_allow_file_sharing =
          excluded.policy_response_policy_allow_file_sharing,
        policy_response_policy_max_auto_replies_per_hour =
          excluded.policy_response_policy_max_auto_replies_per_hour,
        policy_response_policy_quiet_hours =
          excluded.policy_response_policy_quiet_hours,
        policy_response_policy_updated_at = now()
      RETURNING ${policyReturningSql()}
    `,
    [
      input.contactId,
      input.mode,
      input.allowFileSharing ?? false,
      input.maxAutoRepliesPerHour ?? 20,
      JSON.stringify(input.quietHours ?? null)
    ],
    "Failed to upsert contact policy"
  );
}

export function createPoliciesRepository(db: DbExecutor) {
  return {
    async upsertContactPolicy(input: {
      contactId: string;
      mode: ResponsePolicyMode;
      allowFileSharing?: boolean;
      maxAutoRepliesPerHour?: number;
      quietHours?: Record<string, unknown> | null;
    }): Promise<ResponsePolicyRecord> {
      return upsertContactPolicy(db, input);
    },

    async setAllowlistedContactPoliciesMode(
      mode: ResponsePolicyMode
    ): Promise<PolicyModeUpdateResult> {
      const contacts = await db.query<{ contactId: string }>(
        `
          SELECT core_contact_id AS "contactId"
          FROM core_contacts
          WHERE core_contact_is_allowlisted = true
        `
      );

      for (const contact of contacts.rows) {
        await upsertContactPolicy(db, {
          contactId: contact.contactId,
          mode
        });
      }

      let affectedConversations = 0;
      if (mode === "paused") {
        const result = await db.query(
          `
            UPDATE msg_conversations
            SET
              msg_conversation_state = 'paused',
              msg_conversation_updated_at = now()
            WHERE primary_core_contact_id IN (
              SELECT core_contact_id
              FROM core_contacts
              WHERE core_contact_is_allowlisted = true
            )
              AND msg_conversation_state = 'active'
          `
        );
        affectedConversations = result.rowCount ?? 0;
      } else if (mode === "auto" || mode === "confirm_resource") {
        const result = await db.query(
          `
            UPDATE msg_conversations
            SET
              msg_conversation_state = 'active',
              msg_conversation_updated_at = now()
            WHERE primary_core_contact_id IN (
              SELECT core_contact_id
              FROM core_contacts
              WHERE core_contact_is_allowlisted = true
            )
              AND msg_conversation_state = 'paused'
          `
        );
        affectedConversations = result.rowCount ?? 0;
      }

      return {
        mode,
        affectedContacts: contacts.rowCount ?? 0,
        affectedConversations
      };
    },

    async listPolicies(limit = 50): Promise<ResponsePolicyRecord[]> {
      const result = await db.query<ResponsePolicyRecord>(
        `
          SELECT ${policyReturningSql()}
          FROM policy_response_policies
          ORDER BY policy_response_policy_updated_at DESC
          LIMIT $1
        `,
        [limit]
      );

      return result.rows;
    }
  };
}
