import { runSql } from "./lib/psql-runner.mjs";

const dataRoot = process.env.VIJI_DATA_ROOT || "/data/pratiksha";
const wacliStore = process.env.VIJI_WACLI_STORE || `${dataRoot}/wacli/store`;

function sqlString(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

function sqlNullableString(value) {
  return value ? sqlString(value) : "NULL";
}

function optionalEnv(name) {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

function booleanEnv(name) {
  return process.env[name]?.trim().toLowerCase() === "true";
}

function deriveWaJidFromPhone(phoneE164) {
  if (!phoneE164) {
    return null;
  }

  const digits = phoneE164.replaceAll(/\D/g, "");
  return digits ? `${digits}@s.whatsapp.net` : null;
}

function vijiAllowlistSeed() {
  const displayName =
    optionalEnv("VIJI_ALLOWLIST_VIJI_DISPLAY_NAME") || "Primary Recipient";
  const phoneE164 = optionalEnv("VIJI_ALLOWLIST_VIJI_PHONE_E164");
  const waJid =
    optionalEnv("VIJI_ALLOWLIST_VIJI_WA_JID") || deriveWaJidFromPhone(phoneE164);

  return {
    displayName,
    phoneE164,
    waJid,
    notes:
      phoneE164 || waJid
        ? "Local dev seed; private contact address values are loaded from environment."
        : "Synthetic local dev seed; no real phone number, JID, or private message data."
  };
}

function createLocalTestAllowlistSql() {
  if (!booleanEnv("VIJI_TEST_ALLOWLIST_MYSELF_ENABLED")) {
    return "";
  }

  const displayName = optionalEnv("VIJI_TEST_ALLOWLIST_MYSELF_DISPLAY_NAME") || "Myself";
  const phoneE164 = optionalEnv("VIJI_TEST_ALLOWLIST_MYSELF_PHONE_E164");
  const waJid =
    optionalEnv("VIJI_TEST_ALLOWLIST_MYSELF_WA_JID") || deriveWaJidFromPhone(phoneE164);

  if (!phoneE164 && !waJid) {
    throw new Error(
      "VIJI_TEST_ALLOWLIST_MYSELF_ENABLED requires VIJI_TEST_ALLOWLIST_MYSELF_PHONE_E164 or VIJI_TEST_ALLOWLIST_MYSELF_WA_JID"
    );
  }

  return `
INSERT INTO core_people (
  core_person_id,
  core_person_display_name,
  core_person_notes
) VALUES (
  '00000000-0000-4000-8000-000000000004',
  ${sqlString(displayName)},
  'Local test allowlist contact from environment; private values are not stored in source.'
) ON CONFLICT (core_person_id) DO UPDATE SET
  core_person_display_name = excluded.core_person_display_name,
  core_person_notes = excluded.core_person_notes,
  core_person_updated_at = now();

INSERT INTO core_contacts (
  core_contact_id,
  owner_core_person_id,
  core_contact_channel,
  core_contact_display_name,
  core_contact_phone_e164,
  core_contact_wa_jid,
  core_contact_is_allowlisted,
  core_contact_trust_level
) VALUES (
  '00000000-0000-4000-8000-000000000005',
  '00000000-0000-4000-8000-000000000004',
  'whatsapp_personal',
  ${sqlString(displayName)},
  ${sqlNullableString(phoneE164)},
  ${sqlNullableString(waJid)},
  true,
  'trusted'
) ON CONFLICT (core_contact_id) DO UPDATE SET
  owner_core_person_id = excluded.owner_core_person_id,
  core_contact_channel = excluded.core_contact_channel,
  core_contact_display_name = excluded.core_contact_display_name,
  core_contact_phone_e164 = excluded.core_contact_phone_e164,
  core_contact_wa_jid = excluded.core_contact_wa_jid,
  core_contact_is_allowlisted = excluded.core_contact_is_allowlisted,
  core_contact_trust_level = excluded.core_contact_trust_level,
  core_contact_updated_at = now();
`;
}

const vijiSeed = vijiAllowlistSeed();

const sql = `
INSERT INTO core_people (
  core_person_id,
  core_person_display_name,
  core_person_notes
) VALUES (
  '00000000-0000-4000-8000-000000000001',
  ${sqlString(vijiSeed.displayName)},
  ${sqlString(vijiSeed.notes)}
) ON CONFLICT (core_person_id) DO UPDATE SET
  core_person_display_name = excluded.core_person_display_name,
  core_person_notes = excluded.core_person_notes,
  core_person_updated_at = now();

INSERT INTO core_contacts (
  core_contact_id,
  owner_core_person_id,
  core_contact_channel,
  core_contact_display_name,
  core_contact_phone_e164,
  core_contact_wa_jid,
  core_contact_is_allowlisted,
  core_contact_trust_level
) VALUES (
  '00000000-0000-4000-8000-000000000002',
  '00000000-0000-4000-8000-000000000001',
  'whatsapp_personal',
  ${sqlString(vijiSeed.displayName)},
  ${sqlNullableString(vijiSeed.phoneE164)},
  ${sqlNullableString(vijiSeed.waJid)},
  true,
  'trusted'
) ON CONFLICT (core_contact_id) DO UPDATE SET
  owner_core_person_id = excluded.owner_core_person_id,
  core_contact_channel = excluded.core_contact_channel,
  core_contact_display_name = excluded.core_contact_display_name,
  core_contact_phone_e164 = excluded.core_contact_phone_e164,
  core_contact_wa_jid = excluded.core_contact_wa_jid,
  core_contact_is_allowlisted = excluded.core_contact_is_allowlisted,
  core_contact_trust_level = excluded.core_contact_trust_level,
  core_contact_updated_at = now();

INSERT INTO core_channel_accounts (
  core_channel_account_id,
  core_channel_account_channel,
  core_channel_account_adapter_type,
  core_channel_account_label,
  core_channel_account_store_path,
  core_channel_account_state
) VALUES (
  '00000000-0000-4000-8000-000000000003',
  'whatsapp_personal',
  'wacli',
  'Local personal WhatsApp dev account',
  ${sqlString(wacliStore)},
  'auth_required'
) ON CONFLICT (core_channel_account_id) DO UPDATE SET
  core_channel_account_channel = excluded.core_channel_account_channel,
  core_channel_account_adapter_type = excluded.core_channel_account_adapter_type,
  core_channel_account_label = excluded.core_channel_account_label,
  core_channel_account_store_path = excluded.core_channel_account_store_path,
  core_channel_account_state = excluded.core_channel_account_state,
  core_channel_account_updated_at = now();

${createLocalTestAllowlistSql()}
`;

await runSql(sql, "seed-dev-data");
console.log("seeded synthetic dev data");
