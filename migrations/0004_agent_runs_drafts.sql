CREATE TABLE IF NOT EXISTS agent_runs (
  agent_run_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_msg_conversation_id uuid NOT NULL
    REFERENCES msg_conversations (msg_conversation_id),
  trigger_msg_message_id uuid NOT NULL
    REFERENCES msg_messages (msg_message_id),
  agent_run_state text NOT NULL DEFAULT 'started',
  agent_run_model_name text NOT NULL,
  agent_run_prompt_hash text NOT NULL,
  agent_run_context_state text NOT NULL,
  agent_run_latency_ms integer,
  agent_run_input_tokens integer,
  agent_run_output_tokens integer,
  agent_run_error_code text,
  agent_run_error_message text,
  agent_run_created_at timestamptz NOT NULL DEFAULT now(),
  agent_run_finished_at timestamptz,
  CONSTRAINT agent_runs_state_chk
    CHECK (agent_run_state IN ('started', 'drafted', 'blocked', 'failed')),
  CONSTRAINT agent_runs_context_state_chk
    CHECK (agent_run_context_state IN ('fresh', 'stale', 'partial')),
  CONSTRAINT agent_runs_latency_nonnegative_chk
    CHECK (agent_run_latency_ms IS NULL OR agent_run_latency_ms >= 0),
  CONSTRAINT agent_runs_input_tokens_nonnegative_chk
    CHECK (agent_run_input_tokens IS NULL OR agent_run_input_tokens >= 0),
  CONSTRAINT agent_runs_output_tokens_nonnegative_chk
    CHECK (agent_run_output_tokens IS NULL OR agent_run_output_tokens >= 0)
);

CREATE INDEX IF NOT EXISTS agent_runs_trigger_message_idx
  ON agent_runs (trigger_msg_message_id, agent_run_created_at DESC);

CREATE INDEX IF NOT EXISTS agent_runs_conversation_state_idx
  ON agent_runs (parent_msg_conversation_id, agent_run_state);

CREATE TABLE IF NOT EXISTS agent_drafts (
  agent_draft_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_msg_conversation_id uuid NOT NULL
    REFERENCES msg_conversations (msg_conversation_id),
  trigger_msg_message_id uuid NOT NULL
    REFERENCES msg_messages (msg_message_id),
  source_agent_run_id uuid NOT NULL
    REFERENCES agent_runs (agent_run_id),
  agent_draft_body text NOT NULL,
  agent_draft_confidence numeric,
  agent_draft_policy_state text NOT NULL DEFAULT 'candidate',
  agent_draft_decided_at timestamptz,
  agent_draft_created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agent_drafts_confidence_range_chk
    CHECK (
      agent_draft_confidence IS NULL OR
      (agent_draft_confidence >= 0 AND agent_draft_confidence <= 1)
    ),
  CONSTRAINT agent_drafts_policy_state_chk
    CHECK (
      agent_draft_policy_state IN (
        'candidate',
        'auto_allowed',
        'confirm_resource',
        'blocked',
        'sent',
        'expired'
      )
    )
);

CREATE INDEX IF NOT EXISTS agent_drafts_trigger_message_idx
  ON agent_drafts (trigger_msg_message_id, agent_draft_created_at DESC);

CREATE INDEX IF NOT EXISTS agent_drafts_run_idx
  ON agent_drafts (source_agent_run_id);
