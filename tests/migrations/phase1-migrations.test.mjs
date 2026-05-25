import assert from "node:assert/strict";
import { startDisposablePostgres } from "../helpers/disposable-postgres.mjs";

const postgres = await startDisposablePostgres({ prefix: "viji-phase1" });
const { psql, psqlFails, runProjectScript } = postgres;

try {
  runProjectScript("scripts/run-migrations.mjs");
  runProjectScript("scripts/run-migrations.mjs");
  runProjectScript("scripts/seed-dev-data.mjs", {
    VIJI_TEST_ALLOWLIST_MYSELF_ENABLED: "false",
    VIJI_ALLOWLIST_VIJI_DISPLAY_NAME: "Vijayalakshmi Saravanan",
    VIJI_ALLOWLIST_VIJI_PHONE_E164: "",
    VIJI_ALLOWLIST_VIJI_WA_JID: ""
  });
  runProjectScript("scripts/seed-dev-data.mjs", {
    VIJI_TEST_ALLOWLIST_MYSELF_ENABLED: "false",
    VIJI_ALLOWLIST_VIJI_DISPLAY_NAME: "Vijayalakshmi Saravanan",
    VIJI_ALLOWLIST_VIJI_PHONE_E164: "",
    VIJI_ALLOWLIST_VIJI_WA_JID: ""
  });

  const requiredTables = [
    "core_people",
    "core_contacts",
    "core_channel_accounts",
    "msg_conversations",
    "msg_messages",
    "msg_message_media",
    "msg_message_media_transcripts",
    "msg_conversation_summaries",
    "msg_history_backfill_jobs",
    "msg_media_download_jobs",
    "agent_runs",
    "agent_drafts",
    "agent_outbound_jobs",
    "agent_send_attempts",
    "policy_response_policies",
    "kb_knowledge_sources",
    "kb_documents",
    "kb_document_chunks",
    "res_file_assets",
    "ops_adapter_events",
    "ops_sync_cursors",
    "ops_sync_runs",
    "ops_audit_events",
    "ops_storage_profiles",
    "ops_storage_usage_snapshots",
    "ops_system_components",
    "ops_system_states",
    "ops_health_checks"
  ];

  const tableRows = psql(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = ANY (ARRAY[${requiredTables.map((table) => `'${table}'`).join(",")}])
    ORDER BY table_name;
  `)
    .split("\n")
    .filter(Boolean);
  assert.deepEqual(tableRows, [...requiredTables].sort());

  const genericColumns = psql(`
    SELECT table_name || '.' || column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = ANY (ARRAY[${requiredTables.map((table) => `'${table}'`).join(",")}])
      AND column_name IN ('id', 'name', 'state', 'created_at', 'updated_at')
    ORDER BY table_name, column_name;
  `);
  assert.equal(genericColumns, "");

  const allowedSemanticColumns = new Set([
    "owner_core_person_id",
    "owner_core_channel_account_id",
    "primary_core_contact_id",
    "source_core_channel_account_id",
    "source_ops_system_component_id",
    "parent_msg_conversation_id",
    "parent_msg_message_id",
    "parent_msg_message_media_id",
    "parent_msg_conversation_id",
    "sender_core_contact_id",
    "reply_to_msg_message_id",
    "adapter_ops_adapter_event_id",
    "backing_res_file_asset_id",
    "from_msg_message_id",
    "to_msg_message_id",
    "target_msg_conversation_id",
    "target_msg_message_media_id",
    "target_agent_outbound_job_id",
    "target_core_contact_id",
    "target_msg_conversation_id",
    "oldest_seen_msg_message_id",
    "trigger_msg_message_id",
    "source_agent_run_id",
    "source_agent_draft_id",
    "actor_core_person_id",
    "scope_core_contact_id",
    "scope_msg_conversation_id",
    "storage_profile_ops_storage_profile_id",
    "source_kb_knowledge_source_id",
    "original_res_file_asset_id",
    "parent_kb_document_id"
  ]);

  const tableStems = new Map([
    ["core_people", "core_person_"],
    ["core_contacts", "core_contact_"],
    ["core_channel_accounts", "core_channel_account_"],
    ["msg_conversations", "msg_conversation_"],
    ["msg_messages", "msg_message_"],
    ["msg_message_media", "msg_message_media_"],
    ["msg_message_media_transcripts", "msg_message_media_transcript_"],
    ["msg_conversation_summaries", "msg_conversation_summary_"],
    ["msg_history_backfill_jobs", "msg_history_backfill_job_"],
    ["msg_media_download_jobs", "msg_media_download_job_"],
    ["agent_runs", "agent_run_"],
    ["agent_drafts", "agent_draft_"],
    ["agent_outbound_jobs", "agent_outbound_job_"],
    ["agent_send_attempts", "agent_send_attempt_"],
    ["policy_response_policies", "policy_response_policy_"],
    ["kb_knowledge_sources", "kb_knowledge_source_"],
    ["kb_documents", "kb_document_"],
    ["kb_document_chunks", "kb_document_chunk_"],
    ["res_file_assets", "res_file_asset_"],
    ["ops_adapter_events", "ops_adapter_event_"],
    ["ops_sync_cursors", "ops_sync_cursor_"],
    ["ops_sync_runs", "ops_sync_run_"],
    ["ops_audit_events", "ops_audit_event_"],
    ["ops_storage_profiles", "ops_storage_profile_"],
    ["ops_storage_usage_snapshots", "ops_storage_usage_snapshot_"],
    ["ops_system_components", "ops_system_component_"],
    ["ops_system_states", "ops_system_state_"],
    ["ops_health_checks", "ops_health_check_"]
  ]);

  const columnRows = psql(`
    SELECT table_name || E'\t' || column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = ANY (ARRAY[${requiredTables.map((table) => `'${table}'`).join(",")}])
    ORDER BY table_name, ordinal_position;
  `)
    .split("\n")
    .filter(Boolean)
    .map((row) => row.split("\t"));

  const unexpectedColumns = columnRows
    .filter(([table, column]) => {
      return !column.startsWith(tableStems.get(table)) && !allowedSemanticColumns.has(column);
    })
    .map(([table, column]) => `${table}.${column}`);

  assert.deepEqual(unexpectedColumns, []);

  const seedRow = psql(`
    SELECT
      core_contact_display_name,
      core_contact_phone_e164 IS NULL,
      core_contact_wa_jid IS NULL,
      core_contact_is_allowlisted,
      core_contact_trust_level
    FROM core_contacts
    WHERE core_contact_id = '00000000-0000-4000-8000-000000000002';
  `);
  assert.equal(seedRow, "Vijayalakshmi Saravanan\tt\tt\tt\ttrusted");

  const seedCount = psql(`
    SELECT count(*)
    FROM core_contacts
    WHERE core_contact_display_name = 'Vijayalakshmi Saravanan';
  `);
  assert.equal(seedCount, "1");

  const localTestContactCountBeforeOptIn = psql(`
    SELECT count(*)
    FROM core_contacts
    WHERE core_contact_display_name = 'Myself';
  `);
  assert.equal(localTestContactCountBeforeOptIn, "0");

  runProjectScript("scripts/seed-dev-data.mjs", {
    VIJI_TEST_ALLOWLIST_MYSELF_ENABLED: "false",
    VIJI_ALLOWLIST_VIJI_DISPLAY_NAME: "Vijayalakshmi Saravanan",
    VIJI_ALLOWLIST_VIJI_PHONE_E164: "+10000000001",
    VIJI_ALLOWLIST_VIJI_WA_JID: "10000000001@s.whatsapp.net"
  });

  const vijiAddressSeedRow = psql(`
    SELECT
      core_contact_display_name,
      core_contact_phone_e164,
      core_contact_wa_jid,
      core_contact_is_allowlisted,
      core_contact_trust_level
    FROM core_contacts
    WHERE core_contact_id = '00000000-0000-4000-8000-000000000002';
  `);
  assert.equal(
    vijiAddressSeedRow,
    "Vijayalakshmi Saravanan\t+10000000001\t10000000001@s.whatsapp.net\tt\ttrusted"
  );

  runProjectScript("scripts/seed-dev-data.mjs", {
    VIJI_TEST_ALLOWLIST_MYSELF_ENABLED: "true",
    VIJI_TEST_ALLOWLIST_MYSELF_DISPLAY_NAME: "Myself",
    VIJI_TEST_ALLOWLIST_MYSELF_PHONE_E164: "+10000000000",
    VIJI_TEST_ALLOWLIST_MYSELF_WA_JID: "10000000000@s.whatsapp.net"
  });
  runProjectScript("scripts/seed-dev-data.mjs", {
    VIJI_TEST_ALLOWLIST_MYSELF_ENABLED: "true",
    VIJI_TEST_ALLOWLIST_MYSELF_DISPLAY_NAME: "Myself",
    VIJI_TEST_ALLOWLIST_MYSELF_PHONE_E164: "+10000000000",
    VIJI_TEST_ALLOWLIST_MYSELF_WA_JID: "10000000000@s.whatsapp.net"
  });

  const localTestSeedRow = psql(`
    SELECT
      core_contact_display_name,
      core_contact_phone_e164,
      core_contact_wa_jid,
      core_contact_is_allowlisted,
      core_contact_trust_level
    FROM core_contacts
    WHERE core_contact_id = '00000000-0000-4000-8000-000000000005';
  `);
  assert.equal(
    localTestSeedRow,
    "Myself\t+10000000000\t10000000000@s.whatsapp.net\tt\ttrusted"
  );

  const localTestSeedCount = psql(`
    SELECT count(*)
    FROM core_contacts
    WHERE core_contact_display_name = 'Myself';
  `);
  assert.equal(localTestSeedCount, "1");

  psql(`
    INSERT INTO msg_conversations (
      msg_conversation_id,
      owner_core_channel_account_id,
      primary_core_contact_id,
      msg_conversation_external_chat_id,
      msg_conversation_type,
      msg_conversation_title,
      msg_conversation_state,
      msg_conversation_context_state
    ) VALUES (
      '10000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000003',
      '00000000-0000-4000-8000-000000000002',
      'synthetic-chat',
      'dm',
      'Synthetic Vijayalakshmi Chat',
      'active',
      'fresh'
    );

    INSERT INTO ops_adapter_events (
      ops_adapter_event_id,
      source_core_channel_account_id,
      ops_adapter_event_type,
      ops_adapter_event_external_event_id,
      ops_adapter_event_payload
    ) VALUES (
      '10000000-0000-4000-8000-000000000002',
      '00000000-0000-4000-8000-000000000003',
      'message',
      'synthetic-event-1',
      '{"redacted": true}'::jsonb
    );

    INSERT INTO msg_messages (
      msg_message_id,
      parent_msg_conversation_id,
      sender_core_contact_id,
      adapter_ops_adapter_event_id,
      msg_message_external_message_id,
      msg_message_direction,
      msg_message_type,
      msg_message_body,
      msg_message_body_redacted,
      msg_message_status,
      msg_message_received_at
    ) VALUES (
      '10000000-0000-4000-8000-000000000003',
      '10000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000002',
      '10000000-0000-4000-8000-000000000002',
      'synthetic-message-1',
      'inbound',
      'text',
      'Synthetic test message',
      false,
      'received',
      now()
    );

    INSERT INTO msg_message_media (
      msg_message_media_id,
      parent_msg_message_id,
      msg_message_media_external_media_id,
      msg_message_media_mime_type,
      msg_message_media_file_name,
      msg_message_media_size_bytes,
      msg_message_media_download_state
    ) VALUES (
      '10000000-0000-4000-8000-000000000004',
      '10000000-0000-4000-8000-000000000003',
      'synthetic-media-1',
      'image/png',
      'synthetic.png',
      128,
      'queued'
    );

    INSERT INTO msg_media_download_jobs (
      msg_media_download_job_id,
      target_msg_message_media_id,
      target_msg_conversation_id,
      msg_media_download_job_state
    ) VALUES (
      '10000000-0000-4000-8000-000000000005',
      '10000000-0000-4000-8000-000000000004',
      '10000000-0000-4000-8000-000000000001',
      'queued'
    );

    INSERT INTO ops_sync_cursors (
      ops_sync_cursor_id,
      source_core_channel_account_id,
      target_msg_conversation_id,
      ops_sync_cursor_name,
      ops_sync_cursor_value
    ) VALUES (
      '10000000-0000-4000-8000-000000000006',
      '00000000-0000-4000-8000-000000000003',
      NULL,
      'reconnect_checkpoint',
      'cursor-1'
    );

    INSERT INTO ops_sync_cursors (
      ops_sync_cursor_id,
      source_core_channel_account_id,
      target_msg_conversation_id,
      ops_sync_cursor_name,
      ops_sync_cursor_value
    ) VALUES (
      '10000000-0000-4000-8000-000000000007',
      '00000000-0000-4000-8000-000000000003',
      '10000000-0000-4000-8000-000000000001',
      'latest_message',
      'cursor-2'
    );
  `);

  assert.notEqual(
    psqlFails(`
      INSERT INTO msg_messages (
        parent_msg_conversation_id,
        msg_message_external_message_id,
        msg_message_direction,
        msg_message_type,
        msg_message_status
      ) VALUES (
        '10000000-0000-4000-8000-000000000001',
        'synthetic-message-1',
        'inbound',
        'text',
        'received'
      );
    `).status,
    0
  );

  assert.notEqual(
    psqlFails(`
      INSERT INTO ops_adapter_events (
        source_core_channel_account_id,
        ops_adapter_event_type,
        ops_adapter_event_external_event_id,
        ops_adapter_event_payload
      ) VALUES (
        '00000000-0000-4000-8000-000000000003',
        'message',
        'synthetic-event-1',
        '{"redacted": true}'::jsonb
      );
    `).status,
    0
  );

  assert.notEqual(
    psqlFails(`
      INSERT INTO msg_media_download_jobs (
        target_msg_message_media_id,
        target_msg_conversation_id,
        msg_media_download_job_state
      ) VALUES (
        '10000000-0000-4000-8000-000000000004',
        '10000000-0000-4000-8000-000000000001',
        'queued'
      );
    `).status,
    0
  );

  assert.notEqual(
    psqlFails(`
      INSERT INTO ops_sync_cursors (
        source_core_channel_account_id,
        target_msg_conversation_id,
        ops_sync_cursor_name,
        ops_sync_cursor_value
      ) VALUES (
        '00000000-0000-4000-8000-000000000003',
        NULL,
        'reconnect_checkpoint',
        'cursor-duplicate'
      );
    `).status,
    0
  );

  assert.notEqual(
    psqlFails(`
      INSERT INTO ops_sync_cursors (
        source_core_channel_account_id,
        target_msg_conversation_id,
        ops_sync_cursor_name,
        ops_sync_cursor_value
      ) VALUES (
        '00000000-0000-4000-8000-000000000003',
        '10000000-0000-4000-8000-000000000001',
        'latest_message',
        'cursor-duplicate'
      );
    `).status,
    0
  );
} finally {
  postgres.stop();
}
