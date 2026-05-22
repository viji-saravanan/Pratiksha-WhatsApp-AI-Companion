CREATE TABLE IF NOT EXISTS policy_response_policies (
  policy_response_policy_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_core_contact_id uuid
    REFERENCES core_contacts (core_contact_id),
  target_msg_conversation_id uuid
    REFERENCES msg_conversations (msg_conversation_id),
  policy_response_policy_mode text NOT NULL,
  policy_response_policy_allow_file_sharing boolean NOT NULL DEFAULT false,
  policy_response_policy_max_auto_replies_per_hour integer NOT NULL DEFAULT 20,
  policy_response_policy_quiet_hours jsonb,
  policy_response_policy_created_at timestamptz NOT NULL DEFAULT now(),
  policy_response_policy_updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT policy_response_policies_scope_chk
    CHECK (
      (
        target_core_contact_id IS NOT NULL AND
        target_msg_conversation_id IS NULL
      ) OR (
        target_core_contact_id IS NULL AND
        target_msg_conversation_id IS NOT NULL
      )
    ),
  CONSTRAINT policy_response_policies_mode_chk
    CHECK (
      policy_response_policy_mode IN (
        'auto',
        'confirm_resource',
        'readonly',
        'paused'
      )
    ),
  CONSTRAINT policy_response_policies_max_auto_nonnegative_chk
    CHECK (policy_response_policy_max_auto_replies_per_hour >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS policy_response_policies_contact_unique_idx
  ON policy_response_policies (target_core_contact_id)
  WHERE target_core_contact_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS policy_response_policies_conversation_unique_idx
  ON policy_response_policies (target_msg_conversation_id)
  WHERE target_msg_conversation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS policy_response_policies_mode_idx
  ON policy_response_policies (policy_response_policy_mode);
