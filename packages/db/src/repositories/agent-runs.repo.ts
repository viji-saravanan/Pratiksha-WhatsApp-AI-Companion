import type { DbExecutor } from "../query.js";
import { queryRequired } from "../query.js";

export type AgentRunState = "started" | "drafted" | "blocked" | "failed";
export type AgentRunContextState = "fresh" | "stale" | "partial";

export interface AgentRunRecord {
  agentRunId: string;
  conversationId: string;
  triggerMessageId: string;
  state: AgentRunState;
  modelName: string;
  promptHash: string;
  contextState: AgentRunContextState;
  latencyMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  errorCode: string | null;
  errorMessage: string | null;
}

export interface CreateAgentRunInput {
  conversationId: string;
  triggerMessageId: string;
  modelName: string;
  promptHash: string;
  contextState: AgentRunContextState;
}

export interface FinishAgentRunInput {
  agentRunId: string;
  latencyMs?: number | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  errorCode?: string | null;
  errorMessage?: string | null;
}

function agentRunReturningSql(): string {
  return `
    agent_run_id AS "agentRunId",
    parent_msg_conversation_id AS "conversationId",
    trigger_msg_message_id AS "triggerMessageId",
    agent_run_state AS "state",
    agent_run_model_name AS "modelName",
    agent_run_prompt_hash AS "promptHash",
    agent_run_context_state AS "contextState",
    agent_run_latency_ms AS "latencyMs",
    agent_run_input_tokens AS "inputTokens",
    agent_run_output_tokens AS "outputTokens",
    agent_run_error_code AS "errorCode",
    agent_run_error_message AS "errorMessage"
  `;
}

export function createAgentRunsRepository(db: DbExecutor) {
  return {
    async createStartedRun(input: CreateAgentRunInput): Promise<AgentRunRecord> {
      return queryRequired<AgentRunRecord>(
        db,
        `
          INSERT INTO agent_runs (
            parent_msg_conversation_id,
            trigger_msg_message_id,
            agent_run_state,
            agent_run_model_name,
            agent_run_prompt_hash,
            agent_run_context_state
          ) VALUES ($1, $2, 'started', $3, $4, $5)
          RETURNING ${agentRunReturningSql()}
        `,
        [
          input.conversationId,
          input.triggerMessageId,
          input.modelName,
          input.promptHash,
          input.contextState
        ],
        "Failed to create agent run"
      );
    },

    async markDrafted(input: FinishAgentRunInput): Promise<AgentRunRecord> {
      return queryRequired<AgentRunRecord>(
        db,
        `
          UPDATE agent_runs
          SET
            agent_run_state = 'drafted',
            agent_run_latency_ms = $2,
            agent_run_input_tokens = $3,
            agent_run_output_tokens = $4,
            agent_run_error_code = NULL,
            agent_run_error_message = NULL,
            agent_run_finished_at = now()
          WHERE agent_run_id = $1
          RETURNING ${agentRunReturningSql()}
        `,
        [
          input.agentRunId,
          input.latencyMs ?? null,
          input.inputTokens ?? null,
          input.outputTokens ?? null
        ],
        "Failed to mark agent run drafted"
      );
    },

    async markBlocked(input: FinishAgentRunInput): Promise<AgentRunRecord> {
      return queryRequired<AgentRunRecord>(
        db,
        `
          UPDATE agent_runs
          SET
            agent_run_state = 'blocked',
            agent_run_latency_ms = $2,
            agent_run_input_tokens = $3,
            agent_run_output_tokens = $4,
            agent_run_error_code = $5,
            agent_run_error_message = $6,
            agent_run_finished_at = now()
          WHERE agent_run_id = $1
          RETURNING ${agentRunReturningSql()}
        `,
        [
          input.agentRunId,
          input.latencyMs ?? null,
          input.inputTokens ?? null,
          input.outputTokens ?? null,
          input.errorCode ?? null,
          input.errorMessage ?? null
        ],
        "Failed to mark agent run blocked"
      );
    },

    async markFailed(input: FinishAgentRunInput): Promise<AgentRunRecord> {
      return queryRequired<AgentRunRecord>(
        db,
        `
          UPDATE agent_runs
          SET
            agent_run_state = 'failed',
            agent_run_latency_ms = $2,
            agent_run_input_tokens = $3,
            agent_run_output_tokens = $4,
            agent_run_error_code = $5,
            agent_run_error_message = $6,
            agent_run_finished_at = now()
          WHERE agent_run_id = $1
          RETURNING ${agentRunReturningSql()}
        `,
        [
          input.agentRunId,
          input.latencyMs ?? null,
          input.inputTokens ?? null,
          input.outputTokens ?? null,
          input.errorCode ?? null,
          input.errorMessage ?? null
        ],
        "Failed to mark agent run failed"
      );
    }
  };
}
