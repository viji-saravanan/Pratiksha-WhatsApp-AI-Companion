CREATE TABLE IF NOT EXISTS core_people (
  core_person_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  core_person_display_name text NOT NULL,
  core_person_notes text,
  core_person_created_at timestamptz NOT NULL DEFAULT now(),
  core_person_updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS core_contacts (
  core_contact_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_core_person_id uuid NOT NULL
    REFERENCES core_people (core_person_id),
  core_contact_channel text NOT NULL,
  core_contact_display_name text NOT NULL,
  core_contact_phone_e164 text,
  core_contact_wa_jid text,
  core_contact_is_allowlisted boolean NOT NULL DEFAULT false,
  core_contact_trust_level text NOT NULL DEFAULT 'normal',
  core_contact_created_at timestamptz NOT NULL DEFAULT now(),
  core_contact_updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT core_contacts_channel_chk
    CHECK (core_contact_channel IN ('whatsapp_personal', 'whatsapp_business')),
  CONSTRAINT core_contacts_trust_level_chk
    CHECK (core_contact_trust_level IN ('low', 'normal', 'trusted'))
);

CREATE UNIQUE INDEX IF NOT EXISTS core_contacts_wa_jid_unique_idx
  ON core_contacts (core_contact_wa_jid)
  WHERE core_contact_wa_jid IS NOT NULL;

CREATE INDEX IF NOT EXISTS core_contacts_owner_idx
  ON core_contacts (owner_core_person_id);

CREATE INDEX IF NOT EXISTS core_contacts_channel_allowlisted_idx
  ON core_contacts (core_contact_channel, core_contact_is_allowlisted);

CREATE TABLE IF NOT EXISTS core_channel_accounts (
  core_channel_account_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  core_channel_account_channel text NOT NULL,
  core_channel_account_adapter_type text NOT NULL,
  core_channel_account_label text NOT NULL,
  core_channel_account_store_path text NOT NULL,
  core_channel_account_state text NOT NULL DEFAULT 'auth_required',
  core_channel_account_last_healthy_at timestamptz,
  core_channel_account_created_at timestamptz NOT NULL DEFAULT now(),
  core_channel_account_updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT core_channel_accounts_channel_chk
    CHECK (core_channel_account_channel IN ('whatsapp_personal')),
  CONSTRAINT core_channel_accounts_adapter_type_chk
    CHECK (
      core_channel_account_adapter_type IN (
        'wacli',
        'whatsmeow',
        'baileys',
        'wwebjs',
        'official_cloud'
      )
    ),
  CONSTRAINT core_channel_accounts_state_chk
    CHECK (
      core_channel_account_state IN (
        'ready',
        'auth_required',
        'backoff',
        'readonly',
        'disabled'
      )
    )
);

CREATE TABLE IF NOT EXISTS msg_conversations (
  msg_conversation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_core_channel_account_id uuid NOT NULL
    REFERENCES core_channel_accounts (core_channel_account_id),
  primary_core_contact_id uuid
    REFERENCES core_contacts (core_contact_id),
  msg_conversation_external_chat_id text NOT NULL,
  msg_conversation_type text NOT NULL,
  msg_conversation_title text NOT NULL,
  msg_conversation_state text NOT NULL DEFAULT 'active',
  msg_conversation_context_state text NOT NULL DEFAULT 'unknown',
  msg_conversation_last_message_at timestamptz,
  msg_conversation_last_synced_at timestamptz,
  msg_conversation_created_at timestamptz NOT NULL DEFAULT now(),
  msg_conversation_updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT msg_conversations_type_chk
    CHECK (msg_conversation_type IN ('dm', 'group')),
  CONSTRAINT msg_conversations_state_chk
    CHECK (msg_conversation_state IN ('active', 'paused', 'archived', 'ignored')),
  CONSTRAINT msg_conversations_context_state_chk
    CHECK (msg_conversation_context_state IN ('fresh', 'stale', 'recovering', 'unknown'))
);

CREATE UNIQUE INDEX IF NOT EXISTS msg_conversations_external_chat_unique_idx
  ON msg_conversations (
    owner_core_channel_account_id,
    msg_conversation_external_chat_id
  );

CREATE INDEX IF NOT EXISTS msg_conversations_primary_state_idx
  ON msg_conversations (primary_core_contact_id, msg_conversation_state);

CREATE INDEX IF NOT EXISTS msg_conversations_context_synced_idx
  ON msg_conversations (
    msg_conversation_context_state,
    msg_conversation_last_synced_at
  );

CREATE TABLE IF NOT EXISTS ops_adapter_events (
  ops_adapter_event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_core_channel_account_id uuid NOT NULL
    REFERENCES core_channel_accounts (core_channel_account_id),
  ops_adapter_event_type text NOT NULL,
  ops_adapter_event_external_event_id text,
  ops_adapter_event_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  ops_adapter_event_received_at timestamptz NOT NULL DEFAULT now(),
  ops_adapter_event_processed_at timestamptz
);

CREATE INDEX IF NOT EXISTS ops_adapter_events_source_received_idx
  ON ops_adapter_events (
    source_core_channel_account_id,
    ops_adapter_event_received_at
  );

CREATE UNIQUE INDEX IF NOT EXISTS ops_adapter_events_external_unique_idx
  ON ops_adapter_events (
    source_core_channel_account_id,
    ops_adapter_event_external_event_id
  )
  WHERE ops_adapter_event_external_event_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS msg_messages (
  msg_message_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_msg_conversation_id uuid NOT NULL
    REFERENCES msg_conversations (msg_conversation_id),
  sender_core_contact_id uuid
    REFERENCES core_contacts (core_contact_id),
  reply_to_msg_message_id uuid
    REFERENCES msg_messages (msg_message_id),
  adapter_ops_adapter_event_id uuid
    REFERENCES ops_adapter_events (ops_adapter_event_id),
  msg_message_external_message_id text NOT NULL,
  msg_message_direction text NOT NULL,
  msg_message_type text NOT NULL,
  msg_message_body text,
  msg_message_body_redacted boolean NOT NULL DEFAULT false,
  msg_message_status text NOT NULL,
  msg_message_sent_at timestamptz,
  msg_message_received_at timestamptz,
  msg_message_created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT msg_messages_direction_chk
    CHECK (msg_message_direction IN ('inbound', 'outbound')),
  CONSTRAINT msg_messages_type_chk
    CHECK (
      msg_message_type IN (
        'text',
        'image',
        'video',
        'audio',
        'document',
        'system'
      )
    ),
  CONSTRAINT msg_messages_status_chk
    CHECK (
      msg_message_status IN (
        'received',
        'drafted',
        'queued',
        'sent',
        'failed',
        'ignored'
      )
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS msg_messages_external_unique_idx
  ON msg_messages (
    parent_msg_conversation_id,
    msg_message_external_message_id
  );

CREATE INDEX IF NOT EXISTS msg_messages_conversation_created_idx
  ON msg_messages (parent_msg_conversation_id, msg_message_created_at DESC);

CREATE INDEX IF NOT EXISTS msg_messages_sender_received_idx
  ON msg_messages (sender_core_contact_id, msg_message_received_at DESC);

CREATE TABLE IF NOT EXISTS res_file_assets (
  res_file_asset_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  res_file_asset_storage_uri text NOT NULL,
  res_file_asset_original_uri text,
  res_file_asset_checksum_sha256 text NOT NULL,
  res_file_asset_mime_type text NOT NULL,
  res_file_asset_size_bytes bigint NOT NULL,
  res_file_asset_storage_state text NOT NULL DEFAULT 'available',
  res_file_asset_created_at timestamptz NOT NULL DEFAULT now(),
  res_file_asset_updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT res_file_assets_size_nonnegative_chk
    CHECK (res_file_asset_size_bytes >= 0),
  CONSTRAINT res_file_assets_storage_state_chk
    CHECK (
      res_file_asset_storage_state IN (
        'available',
        'missing',
        'quarantined',
        'deleted'
      )
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS res_file_assets_storage_uri_unique_idx
  ON res_file_assets (res_file_asset_storage_uri);

CREATE TABLE IF NOT EXISTS msg_message_media (
  msg_message_media_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_msg_message_id uuid NOT NULL
    REFERENCES msg_messages (msg_message_id),
  backing_res_file_asset_id uuid
    REFERENCES res_file_assets (res_file_asset_id),
  msg_message_media_external_media_id text,
  msg_message_media_mime_type text NOT NULL,
  msg_message_media_file_name text,
  msg_message_media_size_bytes bigint,
  msg_message_media_download_state text NOT NULL DEFAULT 'not_requested',
  msg_message_media_created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT msg_message_media_size_nonnegative_chk
    CHECK (
      msg_message_media_size_bytes IS NULL OR
      msg_message_media_size_bytes >= 0
    ),
  CONSTRAINT msg_message_media_download_state_chk
    CHECK (
      msg_message_media_download_state IN (
        'not_requested',
        'queued',
        'downloaded',
        'failed',
        'blocked'
      )
    )
);

CREATE INDEX IF NOT EXISTS msg_message_media_message_idx
  ON msg_message_media (parent_msg_message_id);

CREATE TABLE IF NOT EXISTS msg_conversation_summaries (
  msg_conversation_summary_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_msg_conversation_id uuid NOT NULL
    REFERENCES msg_conversations (msg_conversation_id),
  from_msg_message_id uuid
    REFERENCES msg_messages (msg_message_id),
  to_msg_message_id uuid
    REFERENCES msg_messages (msg_message_id),
  msg_conversation_summary_kind text NOT NULL,
  msg_conversation_summary_text text NOT NULL,
  msg_conversation_summary_token_count integer,
  msg_conversation_summary_created_at timestamptz NOT NULL DEFAULT now(),
  msg_conversation_summary_updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT msg_conversation_summaries_kind_chk
    CHECK (msg_conversation_summary_kind IN ('rolling', 'daily', 'manual', 'backfill')),
  CONSTRAINT msg_conversation_summaries_token_count_nonnegative_chk
    CHECK (
      msg_conversation_summary_token_count IS NULL OR
      msg_conversation_summary_token_count >= 0
    )
);

CREATE INDEX IF NOT EXISTS msg_conversation_summaries_kind_idx
  ON msg_conversation_summaries (
    parent_msg_conversation_id,
    msg_conversation_summary_kind
  );

CREATE INDEX IF NOT EXISTS msg_conversation_summaries_to_message_idx
  ON msg_conversation_summaries (
    parent_msg_conversation_id,
    to_msg_message_id
  );

CREATE TABLE IF NOT EXISTS msg_history_backfill_jobs (
  msg_history_backfill_job_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_msg_conversation_id uuid NOT NULL
    REFERENCES msg_conversations (msg_conversation_id),
  msg_history_backfill_job_state text NOT NULL DEFAULT 'queued',
  msg_history_backfill_job_cursor text,
  oldest_seen_msg_message_id uuid
    REFERENCES msg_messages (msg_message_id),
  msg_history_backfill_job_messages_imported integer NOT NULL DEFAULT 0,
  msg_history_backfill_job_error_code text,
  msg_history_backfill_job_error_message text,
  msg_history_backfill_job_started_at timestamptz,
  msg_history_backfill_job_finished_at timestamptz,
  msg_history_backfill_job_created_at timestamptz NOT NULL DEFAULT now(),
  msg_history_backfill_job_updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT msg_history_backfill_jobs_state_chk
    CHECK (
      msg_history_backfill_job_state IN (
        'queued',
        'running',
        'paused',
        'completed',
        'failed',
        'blocked'
      )
    ),
  CONSTRAINT msg_history_backfill_jobs_imported_nonnegative_chk
    CHECK (msg_history_backfill_job_messages_imported >= 0)
);

CREATE INDEX IF NOT EXISTS msg_history_backfill_jobs_conversation_state_idx
  ON msg_history_backfill_jobs (
    target_msg_conversation_id,
    msg_history_backfill_job_state
  );

CREATE TABLE IF NOT EXISTS msg_media_download_jobs (
  msg_media_download_job_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_msg_message_media_id uuid NOT NULL
    REFERENCES msg_message_media (msg_message_media_id),
  target_msg_conversation_id uuid NOT NULL
    REFERENCES msg_conversations (msg_conversation_id),
  msg_media_download_job_state text NOT NULL DEFAULT 'queued',
  msg_media_download_job_priority integer NOT NULL DEFAULT 100,
  msg_media_download_job_blocked_reason text,
  msg_media_download_job_error_code text,
  msg_media_download_job_error_message text,
  msg_media_download_job_created_at timestamptz NOT NULL DEFAULT now(),
  msg_media_download_job_updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT msg_media_download_jobs_state_chk
    CHECK (
      msg_media_download_job_state IN (
        'queued',
        'running',
        'downloaded',
        'failed',
        'blocked',
        'skipped'
      )
    )
);

CREATE INDEX IF NOT EXISTS msg_media_download_jobs_conversation_state_idx
  ON msg_media_download_jobs (
    target_msg_conversation_id,
    msg_media_download_job_state
  );

CREATE UNIQUE INDEX IF NOT EXISTS msg_media_download_jobs_media_unique_idx
  ON msg_media_download_jobs (target_msg_message_media_id);

CREATE TABLE IF NOT EXISTS ops_sync_cursors (
  ops_sync_cursor_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_core_channel_account_id uuid NOT NULL
    REFERENCES core_channel_accounts (core_channel_account_id),
  target_msg_conversation_id uuid
    REFERENCES msg_conversations (msg_conversation_id),
  ops_sync_cursor_name text NOT NULL,
  ops_sync_cursor_value text NOT NULL,
  ops_sync_cursor_updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ops_sync_cursors_name_chk
    CHECK (
      ops_sync_cursor_name IN (
        'latest_message',
        'oldest_backfilled',
        'media_checkpoint',
        'reconnect_checkpoint'
      )
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS ops_sync_cursors_conversation_unique_idx
  ON ops_sync_cursors (
    source_core_channel_account_id,
    target_msg_conversation_id,
    ops_sync_cursor_name
  )
  WHERE target_msg_conversation_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ops_sync_cursors_account_unique_idx
  ON ops_sync_cursors (
    source_core_channel_account_id,
    ops_sync_cursor_name
  )
  WHERE target_msg_conversation_id IS NULL;

CREATE TABLE IF NOT EXISTS ops_sync_runs (
  ops_sync_run_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_core_channel_account_id uuid NOT NULL
    REFERENCES core_channel_accounts (core_channel_account_id),
  target_msg_conversation_id uuid
    REFERENCES msg_conversations (msg_conversation_id),
  ops_sync_run_kind text NOT NULL,
  ops_sync_run_state text NOT NULL,
  ops_sync_run_messages_seen integer NOT NULL DEFAULT 0,
  ops_sync_run_messages_imported integer NOT NULL DEFAULT 0,
  ops_sync_run_context_state_after text NOT NULL DEFAULT 'unknown',
  ops_sync_run_error_code text,
  ops_sync_run_error_message text,
  ops_sync_run_started_at timestamptz NOT NULL DEFAULT now(),
  ops_sync_run_finished_at timestamptz,
  CONSTRAINT ops_sync_runs_kind_chk
    CHECK (ops_sync_run_kind IN ('startup', 'live', 'reconnect', 'backfill', 'media')),
  CONSTRAINT ops_sync_runs_state_chk
    CHECK (ops_sync_run_state IN ('started', 'completed', 'failed', 'blocked')),
  CONSTRAINT ops_sync_runs_messages_seen_nonnegative_chk
    CHECK (ops_sync_run_messages_seen >= 0),
  CONSTRAINT ops_sync_runs_messages_imported_nonnegative_chk
    CHECK (ops_sync_run_messages_imported >= 0),
  CONSTRAINT ops_sync_runs_context_state_after_chk
    CHECK (
      ops_sync_run_context_state_after IN (
        'fresh',
        'stale',
        'recovering',
        'unknown'
      )
    )
);

CREATE INDEX IF NOT EXISTS ops_sync_runs_source_kind_started_idx
  ON ops_sync_runs (
    source_core_channel_account_id,
    ops_sync_run_kind,
    ops_sync_run_started_at
  );

CREATE INDEX IF NOT EXISTS ops_sync_runs_conversation_state_idx
  ON ops_sync_runs (target_msg_conversation_id, ops_sync_run_state);

CREATE TABLE IF NOT EXISTS ops_audit_events (
  ops_audit_event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_core_person_id uuid
    REFERENCES core_people (core_person_id),
  scope_core_contact_id uuid
    REFERENCES core_contacts (core_contact_id),
  scope_msg_conversation_id uuid
    REFERENCES msg_conversations (msg_conversation_id),
  ops_audit_event_type text NOT NULL,
  ops_audit_event_severity text NOT NULL,
  ops_audit_event_detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  ops_audit_event_created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ops_audit_events_severity_chk
    CHECK (ops_audit_event_severity IN ('info', 'warn', 'error', 'critical'))
);

CREATE INDEX IF NOT EXISTS ops_audit_events_created_idx
  ON ops_audit_events (ops_audit_event_created_at DESC);

CREATE INDEX IF NOT EXISTS ops_audit_events_contact_created_idx
  ON ops_audit_events (scope_core_contact_id, ops_audit_event_created_at DESC);

CREATE INDEX IF NOT EXISTS ops_audit_events_conversation_created_idx
  ON ops_audit_events (scope_msg_conversation_id, ops_audit_event_created_at DESC);
