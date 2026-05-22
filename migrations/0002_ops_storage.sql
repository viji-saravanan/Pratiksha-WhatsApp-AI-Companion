CREATE TABLE IF NOT EXISTS ops_storage_profiles (
  ops_storage_profile_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ops_storage_profile_name text NOT NULL UNIQUE,
  ops_storage_profile_quota_limit_bytes bigint NOT NULL,
  ops_storage_profile_warning_used_bytes bigint NOT NULL,
  ops_storage_profile_critical_used_bytes bigint NOT NULL,
  ops_storage_profile_warning_free_bytes bigint NOT NULL,
  ops_storage_profile_critical_free_bytes bigint NOT NULL,
  ops_storage_profile_retention_policy jsonb NOT NULL DEFAULT '{}'::jsonb,
  ops_storage_profile_is_active boolean NOT NULL DEFAULT false,
  ops_storage_profile_created_at timestamptz NOT NULL DEFAULT now(),
  ops_storage_profile_updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ops_storage_profiles_one_active_idx
  ON ops_storage_profiles (ops_storage_profile_is_active)
  WHERE ops_storage_profile_is_active = true;

CREATE TABLE IF NOT EXISTS ops_system_components (
  ops_system_component_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ops_system_component_name text NOT NULL UNIQUE,
  ops_system_component_type text NOT NULL,
  ops_system_component_created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ops_storage_usage_snapshots (
  ops_storage_usage_snapshot_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  storage_profile_ops_storage_profile_id uuid NOT NULL
    REFERENCES ops_storage_profiles (ops_storage_profile_id),
  source_ops_system_component_id uuid
    REFERENCES ops_system_components (ops_system_component_id),
  ops_storage_usage_snapshot_path_label text NOT NULL,
  ops_storage_usage_snapshot_path_uri text NOT NULL,
  ops_storage_usage_snapshot_used_bytes bigint NOT NULL,
  ops_storage_usage_snapshot_free_bytes bigint NOT NULL,
  ops_storage_usage_snapshot_quota_limit_bytes bigint NOT NULL,
  ops_storage_usage_snapshot_state text NOT NULL,
  ops_storage_usage_snapshot_checked_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ops_storage_usage_snapshots_checked_at_idx
  ON ops_storage_usage_snapshots (ops_storage_usage_snapshot_checked_at DESC);

CREATE INDEX IF NOT EXISTS ops_storage_usage_snapshots_path_checked_at_idx
  ON ops_storage_usage_snapshots (
    ops_storage_usage_snapshot_path_label,
    ops_storage_usage_snapshot_checked_at DESC
  );

CREATE INDEX IF NOT EXISTS ops_storage_usage_snapshots_state_checked_at_idx
  ON ops_storage_usage_snapshots (
    ops_storage_usage_snapshot_state,
    ops_storage_usage_snapshot_checked_at DESC
  );

CREATE TABLE IF NOT EXISTS ops_system_states (
  ops_system_state_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_ops_system_component_id uuid NOT NULL
    REFERENCES ops_system_components (ops_system_component_id),
  ops_system_state_state text NOT NULL,
  ops_system_state_reason_code text NOT NULL,
  ops_system_state_detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  ops_system_state_started_at timestamptz NOT NULL DEFAULT now(),
  ops_system_state_ended_at timestamptz
);

CREATE INDEX IF NOT EXISTS ops_system_states_current_idx
  ON ops_system_states (source_ops_system_component_id, ops_system_state_reason_code)
  WHERE ops_system_state_ended_at IS NULL;

CREATE TABLE IF NOT EXISTS ops_health_checks (
  ops_health_check_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_ops_system_component_id uuid NOT NULL
    REFERENCES ops_system_components (ops_system_component_id),
  ops_health_check_name text NOT NULL,
  ops_health_check_status text NOT NULL,
  ops_health_check_latency_ms integer,
  ops_health_check_message text,
  ops_health_check_checked_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ops_health_checks_component_checked_at_idx
  ON ops_health_checks (
    source_ops_system_component_id,
    ops_health_check_checked_at DESC
  );
