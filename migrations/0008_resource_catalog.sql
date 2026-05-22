CREATE TABLE IF NOT EXISTS res_resources (
  res_resource_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  backing_res_file_asset_id uuid
    REFERENCES res_file_assets (res_file_asset_id),
  res_resource_registered_file_name text NOT NULL,
  res_resource_title text NOT NULL,
  res_resource_aliases text[] NOT NULL DEFAULT ARRAY[]::text[],
  res_resource_description text,
  res_resource_content_summary text,
  res_resource_type text NOT NULL DEFAULT 'file',
  res_resource_sensitivity text NOT NULL DEFAULT 'normal',
  res_resource_allowed_contact_ids uuid[],
  res_resource_requires_recipient_confirmation boolean NOT NULL DEFAULT true,
  res_resource_is_active boolean NOT NULL DEFAULT true,
  res_resource_created_at timestamptz NOT NULL DEFAULT now(),
  res_resource_updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT res_resources_registered_file_name_nonempty_chk
    CHECK (length(btrim(res_resource_registered_file_name)) > 0),
  CONSTRAINT res_resources_title_nonempty_chk
    CHECK (length(btrim(res_resource_title)) > 0),
  CONSTRAINT res_resources_type_chk
    CHECK (res_resource_type IN ('file', 'link', 'note', 'template')),
  CONSTRAINT res_resources_sensitivity_chk
    CHECK (
      res_resource_sensitivity IN (
        'public',
        'normal',
        'private',
        'restricted'
      )
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS res_resources_registered_file_name_unique_idx
  ON res_resources (res_resource_registered_file_name);

CREATE INDEX IF NOT EXISTS res_resources_active_type_idx
  ON res_resources (res_resource_is_active, res_resource_type);

CREATE INDEX IF NOT EXISTS res_resources_allowed_contacts_idx
  ON res_resources USING gin (res_resource_allowed_contact_ids);

CREATE TABLE IF NOT EXISTS res_resource_proposals (
  res_resource_proposal_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_agent_draft_id uuid NOT NULL
    REFERENCES agent_drafts (agent_draft_id),
  target_msg_conversation_id uuid NOT NULL
    REFERENCES msg_conversations (msg_conversation_id),
  trigger_msg_message_id uuid NOT NULL
    REFERENCES msg_messages (msg_message_id),
  res_resource_proposal_query_text text NOT NULL,
  res_resource_proposal_state text NOT NULL DEFAULT 'pending',
  res_resource_proposal_created_at timestamptz NOT NULL DEFAULT now(),
  res_resource_proposal_updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT res_resource_proposals_state_chk
    CHECK (
      res_resource_proposal_state IN (
        'pending',
        'resolved',
        'expired',
        'blocked'
      )
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS res_resource_proposals_source_draft_unique_idx
  ON res_resource_proposals (source_agent_draft_id);

CREATE INDEX IF NOT EXISTS res_resource_proposals_conversation_state_idx
  ON res_resource_proposals (
    target_msg_conversation_id,
    res_resource_proposal_state,
    res_resource_proposal_created_at DESC
  );

CREATE TABLE IF NOT EXISTS res_resource_proposal_options (
  res_resource_proposal_option_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_res_resource_proposal_id uuid NOT NULL
    REFERENCES res_resource_proposals (res_resource_proposal_id),
  target_res_resource_id uuid NOT NULL
    REFERENCES res_resources (res_resource_id),
  res_resource_proposal_option_rank integer NOT NULL,
  res_resource_proposal_option_score numeric NOT NULL,
  res_resource_proposal_option_created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT res_resource_proposal_options_rank_positive_chk
    CHECK (res_resource_proposal_option_rank > 0),
  CONSTRAINT res_resource_proposal_options_score_nonnegative_chk
    CHECK (res_resource_proposal_option_score >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS res_resource_proposal_options_rank_unique_idx
  ON res_resource_proposal_options (
    parent_res_resource_proposal_id,
    res_resource_proposal_option_rank
  );

CREATE UNIQUE INDEX IF NOT EXISTS res_resource_proposal_options_resource_unique_idx
  ON res_resource_proposal_options (
    parent_res_resource_proposal_id,
    target_res_resource_id
  );
