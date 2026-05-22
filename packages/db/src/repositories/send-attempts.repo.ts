import type { DbExecutor } from "../query.js";
import { queryRequired } from "../query.js";

export type AgentSendAttemptState = "started" | "succeeded" | "failed";

export interface AgentSendAttemptRecord {
  sendAttemptId: string;
  outboundJobId: string;
  adapterType: string;
  attemptNumber: number;
  state: AgentSendAttemptState;
  externalMessageId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
}

function sendAttemptReturningSql(): string {
  return `
    agent_send_attempt_id AS "sendAttemptId",
    target_agent_outbound_job_id AS "outboundJobId",
    agent_send_attempt_adapter_type AS "adapterType",
    agent_send_attempt_number AS "attemptNumber",
    agent_send_attempt_state AS "state",
    agent_send_attempt_external_message_id AS "externalMessageId",
    agent_send_attempt_error_code AS "errorCode",
    agent_send_attempt_error_message AS "errorMessage"
  `;
}

export function createSendAttemptsRepository(db: DbExecutor) {
  return {
    async createStartedAttempt(input: {
      outboundJobId: string;
      adapterType: string;
    }): Promise<AgentSendAttemptRecord> {
      return queryRequired<AgentSendAttemptRecord>(
        db,
        `
          WITH next_attempt AS (
            SELECT COALESCE(MAX(agent_send_attempt_number), 0) + 1 AS attempt_number
            FROM agent_send_attempts
            WHERE target_agent_outbound_job_id = $1
          )
          INSERT INTO agent_send_attempts (
            target_agent_outbound_job_id,
            agent_send_attempt_adapter_type,
            agent_send_attempt_number,
            agent_send_attempt_state
          )
          SELECT $1, $2, next_attempt.attempt_number, 'started'
          FROM next_attempt
          RETURNING ${sendAttemptReturningSql()}
        `,
        [input.outboundJobId, input.adapterType],
        "Failed to create send attempt"
      );
    },

    async finishAttempt(input: {
      sendAttemptId: string;
      state: Extract<AgentSendAttemptState, "succeeded" | "failed">;
      externalMessageId?: string | null;
      errorCode?: string | null;
      errorMessage?: string | null;
    }): Promise<AgentSendAttemptRecord> {
      return queryRequired<AgentSendAttemptRecord>(
        db,
        `
          UPDATE agent_send_attempts
          SET
            agent_send_attempt_state = $2,
            agent_send_attempt_external_message_id = $3,
            agent_send_attempt_error_code = $4,
            agent_send_attempt_error_message = $5,
            agent_send_attempt_finished_at = now()
          WHERE agent_send_attempt_id = $1
          RETURNING ${sendAttemptReturningSql()}
        `,
        [
          input.sendAttemptId,
          input.state,
          input.externalMessageId ?? null,
          input.errorCode ?? null,
          input.errorMessage ?? null
        ],
        "Failed to finish send attempt"
      );
    }
  };
}
