CREATE TABLE IF NOT EXISTS agent_outbound_jobs (
  agent_outbound_job_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_msg_conversation_id uuid NOT NULL
    REFERENCES msg_conversations (msg_conversation_id),
  source_agent_draft_id uuid
    REFERENCES agent_drafts (agent_draft_id),
  agent_outbound_job_kind text NOT NULL,
  agent_outbound_job_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  agent_outbound_job_state text NOT NULL DEFAULT 'queued',
  agent_outbound_job_priority integer NOT NULL DEFAULT 100,
  agent_outbound_job_scheduled_at timestamptz NOT NULL DEFAULT now(),
  agent_outbound_job_idempotency_key text NOT NULL,
  agent_outbound_job_blocked_reason text,
  agent_outbound_job_created_at timestamptz NOT NULL DEFAULT now(),
  agent_outbound_job_updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agent_outbound_jobs_kind_chk
    CHECK (agent_outbound_job_kind IN ('text_reply', 'resource_send')),
  CONSTRAINT agent_outbound_jobs_state_chk
    CHECK (
      agent_outbound_job_state IN (
        'queued',
        'sending',
        'sent',
        'failed',
        'cancelled',
        'blocked'
      )
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS agent_outbound_jobs_idempotency_unique_idx
  ON agent_outbound_jobs (agent_outbound_job_idempotency_key);

CREATE INDEX IF NOT EXISTS agent_outbound_jobs_state_scheduled_idx
  ON agent_outbound_jobs (
    agent_outbound_job_state,
    agent_outbound_job_scheduled_at,
    agent_outbound_job_priority
  );

CREATE INDEX IF NOT EXISTS agent_outbound_jobs_draft_idx
  ON agent_outbound_jobs (source_agent_draft_id);

CREATE TABLE IF NOT EXISTS agent_send_attempts (
  agent_send_attempt_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_agent_outbound_job_id uuid NOT NULL
    REFERENCES agent_outbound_jobs (agent_outbound_job_id),
  agent_send_attempt_adapter_type text NOT NULL,
  agent_send_attempt_number integer NOT NULL,
  agent_send_attempt_state text NOT NULL DEFAULT 'started',
  agent_send_attempt_external_message_id text,
  agent_send_attempt_error_code text,
  agent_send_attempt_error_message text,
  agent_send_attempt_started_at timestamptz NOT NULL DEFAULT now(),
  agent_send_attempt_finished_at timestamptz,
  CONSTRAINT agent_send_attempts_number_positive_chk
    CHECK (agent_send_attempt_number > 0),
  CONSTRAINT agent_send_attempts_state_chk
    CHECK (agent_send_attempt_state IN ('started', 'succeeded', 'failed'))
);

CREATE UNIQUE INDEX IF NOT EXISTS agent_send_attempts_job_number_unique_idx
  ON agent_send_attempts (
    target_agent_outbound_job_id,
    agent_send_attempt_number
  );

CREATE INDEX IF NOT EXISTS agent_send_attempts_job_started_idx
  ON agent_send_attempts (
    target_agent_outbound_job_id,
    agent_send_attempt_started_at DESC
  );
