import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  assertSuccess,
  run,
  startDisposablePostgres
} from "../helpers/disposable-postgres.mjs";

const build = run("corepack", [
  "pnpm",
  "--filter",
  "@viji/wa-adapter-wacli",
  "build"
]);
assertSuccess(build, "build @viji/wa-adapter-wacli");

const { createPgPool, createRepositories } = await import(
  "../../packages/db/dist/index.js"
);
const { normalizeWacliMessagesFromJson, redactWacliPayload } = await import(
  "../../packages/whatsapp/dist/index.js"
);
const {
  createWacliClient,
  ingestNormalizedInboundMessages,
  runLiveDoctorSmokeFromEnv
} = await import("../../apps/wa-adapter-wacli/dist/index.js");

const fixture = JSON.parse(
  readFileSync("fixtures/wacli/messages-list-redacted.json", "utf8")
);
const normalized = normalizeWacliMessagesFromJson(fixture);
const liveShapeFixture = JSON.parse(
  readFileSync("fixtures/wacli/messages-list-live-shape-redacted.json", "utf8")
);
const liveShapeNormalized = normalizeWacliMessagesFromJson(liveShapeFixture);

assert.equal(normalized.rejected.length, 0);
assert.equal(normalized.messages.length, 3);
assert.equal(
  normalized.messages[0].externalMessageId,
  "wamid.redacted.vijayalakshmi.0001"
);
assert.equal(normalized.messages[0].senderDisplayName, "Primary Recipient");
assert.equal(normalized.messages[2].conversationType, "group");
assert.equal(liveShapeNormalized.rejected.length, 0);
assert.equal(liveShapeNormalized.messages[1].fromMe, true);

const directlyRedacted = JSON.stringify(
  redactWacliPayload({
    conversation: "Synthetic direct conversation text must be redacted.",
    extendedTextMessage: {
      text: "Synthetic extended text must be redacted."
    }
  })
);
assert.equal(
  directlyRedacted.includes("Synthetic direct conversation text must be redacted."),
  false
);
assert.equal(
  directlyRedacted.includes("Synthetic extended text must be redacted."),
  false
);

const postgres = await startDisposablePostgres({ prefix: "viji-phase3" });

try {
  postgres.runProjectScript("scripts/run-migrations.mjs");

  const pool = createPgPool({ connectionString: postgres.connectionString });

  try {
    const repositories = createRepositories(pool);

    const person = await repositories.contacts.createPerson({
      displayName: "Primary Recipient",
      notes: "Synthetic Phase 3 test contact"
    });
    const contact = await repositories.contacts.createAllowlistedContact({
      ownerPersonId: person.personId,
      displayName: "Primary Recipient",
      waJid: "vijayalakshmi.saravanan.redacted@s.whatsapp.net",
      trustLevel: "trusted"
    });
    const foundByJid = await repositories.contacts.findAllowlistedContactByWaJid(
      "vijayalakshmi.saravanan.redacted@s.whatsapp.net"
    );
    assert.equal(foundByJid?.contactId, contact.contactId);

    const channelAccount =
      await repositories.channelAccounts.createChannelAccount({
        label: "Phase 3 redacted wacli fixture account",
        storePath: "/data/pratiksha/wacli/store",
        state: "auth_required"
      });

    const firstIngest = await ingestNormalizedInboundMessages(pool, {
      channelAccountId: channelAccount.channelAccountId,
      messages: normalized.messages
    });

    assert.equal(
      firstIngest.filter((result) => result.status === "inserted").length,
      1
    );
    assert.equal(
      firstIngest.filter(
        (result) => result.status === "ignored" && result.reason === "group"
      ).length,
      1
    );
    assert.equal(
      firstIngest.filter(
        (result) =>
          result.status === "ignored" &&
          result.reason === "contact_not_allowlisted"
      ).length,
      1
    );

    const secondIngest = await ingestNormalizedInboundMessages(pool, {
      channelAccountId: channelAccount.channelAccountId,
      messages: normalized.messages
    });
    assert.equal(
      secondIngest.filter((result) => result.status === "existing").length,
      1
    );
    assert.equal(
      secondIngest.filter(
        (result) => result.status === "ignored" && result.duplicateEvent
      ).length,
      2
    );

    const messages = await pool.query(`
      SELECT
        msg_message_external_message_id AS "externalMessageId",
        msg_message_body AS "body"
      FROM msg_messages
      ORDER BY msg_message_created_at ASC
    `);
    assert.equal(messages.rowCount, 1);
    assert.deepEqual(messages.rows[0], {
      externalMessageId: "wamid.redacted.vijayalakshmi.0001",
      body: "Synthetic redacted recipient request for Phase 3 ingestion."
    });

    const adapterEvents = await pool.query(`
      SELECT ops_adapter_event_payload::text AS payload
      FROM ops_adapter_events
      ORDER BY ops_adapter_event_received_at ASC
    `);
    assert.equal(adapterEvents.rowCount, 3);
    const adapterPayloadText = adapterEvents.rows
      .map((row) => row.payload)
      .join("\n");
    assert.equal(
      adapterPayloadText.includes(
        "Synthetic redacted recipient request for Phase 3 ingestion."
      ),
      false
    );
    assert.equal(
      adapterPayloadText.includes(
        "Synthetic redacted unknown-contact request that must be ignored."
      ),
      false
    );
    assert.equal(
      adapterPayloadText.includes("Synthetic redacted group request that must be ignored."),
      false
    );
    assert.equal(adapterPayloadText.includes("[redacted]"), true);

    const audits = await pool.query(`
      SELECT ops_audit_event_type AS "type"
      FROM ops_audit_events
      ORDER BY ops_audit_event_created_at ASC
    `);
    assert.deepEqual(
      audits.rows.map((row) => row.type).sort(),
      [
        "adapter.message_ignored.contact_not_allowlisted",
        "adapter.message_ignored.group"
      ]
    );

    const liveShapeIngest = await ingestNormalizedInboundMessages(pool, {
      channelAccountId: channelAccount.channelAccountId,
      messages: liveShapeNormalized.messages
    });
    assert.equal(
      liveShapeIngest.filter((result) => result.status === "inserted").length,
      2
    );

    const directionRows = await pool.query(`
      SELECT msg_message_direction AS "direction", msg_message_status AS "status"
      FROM msg_messages
      WHERE msg_message_external_message_id IN (
        'wamid.redacted.vijayalakshmi.live.0001',
        'wamid.redacted.owner.live.0002'
      )
      ORDER BY msg_message_external_message_id ASC
    `);
    assert.deepEqual(directionRows.rows, [
      { direction: "outbound", status: "sent" },
      { direction: "inbound", status: "received" }
    ]);

    const replyBatch = normalizeWacliMessagesFromJson({
      messages: [
        {
          id: "wamid.redacted.reply.base.inbound",
          chat_jid: "vijayalakshmi.saravanan.redacted@s.whatsapp.net",
          chat_name: "Primary Recipient",
          sender_jid: "vijayalakshmi.saravanan.redacted@s.whatsapp.net",
          sender_name: "Primary Recipient",
          text: "Synthetic base message.",
          timestamp: "2026-05-01T10:00:00.000Z"
        },
        {
          id: "wamid.redacted.reply.owner",
          chat_jid: "vijayalakshmi.saravanan.redacted@s.whatsapp.net",
          chat_name: "Primary Recipient",
          from_me: true,
          text: "Synthetic owner reply.",
          timestamp: "2026-05-01T10:01:00.000Z",
          message: {
            extendedTextMessage: {
              contextInfo: {
                stanzaId: "wamid.redacted.reply.base.inbound",
                participant: "vijayalakshmi.saravanan.redacted@s.whatsapp.net"
              }
            }
          }
        },
        {
          id: "wamid.redacted.reply.viji",
          chat_jid: "vijayalakshmi.saravanan.redacted@s.whatsapp.net",
          chat_name: "Primary Recipient",
          sender_jid: "vijayalakshmi.saravanan.redacted@s.whatsapp.net",
          sender_name: "Primary Recipient",
          text: "Synthetic recipient reply.",
          timestamp: "2026-05-01T10:02:00.000Z",
          message: {
            extendedTextMessage: {
              contextInfo: {
                stanzaId: "wamid.redacted.reply.owner",
                participant: "owner.redacted@s.whatsapp.net"
              }
            }
          }
        }
      ]
    });
    assert.equal(replyBatch.rejected.length, 0);
    assert.equal(
      replyBatch.messages[1].quotedExternalMessageId,
      "wamid.redacted.reply.base.inbound"
    );

    await ingestNormalizedInboundMessages(pool, {
      channelAccountId: channelAccount.channelAccountId,
      messages: replyBatch.messages
    });

    const replyRows = await pool.query(`
      SELECT
        reply.msg_message_external_message_id AS "replyExternalId",
        quoted.msg_message_external_message_id AS "quotedExternalId",
        reply.msg_message_direction AS "replyDirection"
      FROM msg_messages reply
      LEFT JOIN msg_messages quoted
        ON quoted.msg_message_id = reply.reply_to_msg_message_id
      WHERE reply.msg_message_external_message_id IN (
        'wamid.redacted.reply.owner',
        'wamid.redacted.reply.viji'
      )
      ORDER BY reply.msg_message_external_message_id ASC
    `);
    assert.deepEqual(replyRows.rows, [
      {
        replyExternalId: "wamid.redacted.reply.owner",
        quotedExternalId: "wamid.redacted.reply.base.inbound",
        replyDirection: "outbound"
      },
      {
        replyExternalId: "wamid.redacted.reply.viji",
        quotedExternalId: "wamid.redacted.reply.owner",
        replyDirection: "inbound"
      }
    ]);

    const skippedSmoke = await runLiveDoctorSmokeFromEnv({
      ...process.env,
      VIJI_WACLI_LIVE_SMOKE_ENABLED: "false"
    });
    assert.equal(skippedSmoke.status, "skipped");

    const disabledSend = await createWacliClient({
      bin: "wacli",
      storePath: "/data/pratiksha/wacli/store",
      timeout: "30s",
      liveSmokeEnabled: false
    }).sendText({
      to: "vijayalakshmi.saravanan.redacted@s.whatsapp.net",
      message: "Synthetic redacted outbound text that must not send in Phase 3."
    });
    assert.equal(disabledSend.ok, false);
    assert.equal(disabledSend.code, "system.not_implemented");
  } finally {
    await pool.end();
  }
} finally {
  postgres.stop();
}
