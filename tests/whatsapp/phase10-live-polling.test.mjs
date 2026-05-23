import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  assertSuccess,
  run,
  startDisposablePostgres
} from "../helpers/disposable-postgres.mjs";

for (const target of ["@viji/worker", "@viji/wa-adapter-wacli"]) {
  const build = run("corepack", ["pnpm", "--filter", target, "build"]);
  assertSuccess(build, `build ${target}`);
}

const { createPgPool, createRepositories } = await import(
  "../../packages/db/dist/index.js"
);
const { callFailure, callSuccess, ERROR_CODES } = await import(
  "../../packages/shared/dist/index.js"
);
const { normalizeWacliMessagesFromJson } = await import(
  "../../packages/whatsapp/dist/index.js"
);
const { runLiveAllowlistPoll } = await import(
  "../../apps/worker/dist/index.js"
);

const chatJid = "vijayalakshmi.saravanan.redacted@s.whatsapp.net";

function fixture(name) {
  return JSON.parse(readFileSync(`fixtures/wacli/${name}`, "utf8"));
}

function batchFixture(name) {
  const normalized = normalizeWacliMessagesFromJson(fixture(name));
  assert.equal(normalized.rejected.length, 0);
  return normalized;
}

function metadata(operation) {
  return { component: "phase10-test", operation, durationMs: 0 };
}

function createPollingAdapter({
  batch,
  batchesByChatId,
  chats,
  chatsFailureCode,
  messagesFailureCode
} = {}) {
  const calls = {
    listChats: [],
    listMessages: []
  };
  const adapter = {
    doctor: async () => callSuccess({}, metadata("doctor")),
    authStatus: async () => callSuccess({}, metadata("auth.status")),
    auth: async () => callSuccess({ messages: [], rejected: [] }, metadata("auth")),
    sync: async () => callSuccess({ messages: [], rejected: [] }, metadata("sync")),
    listChats: async (options = {}) => {
      calls.listChats.push(options);
      if (chatsFailureCode) {
        return callFailure(chatsFailureCode, chatsFailureCode, metadata("chats.list"));
      }
      return callSuccess(
        chats ?? [{ chatId: chatJid, name: "Primary Recipient", type: "dm" }],
        metadata("chats.list")
      );
    },
    listMessages: async (options = {}) => {
      calls.listMessages.push(options);
      if (messagesFailureCode) {
        return callFailure(
          messagesFailureCode,
          messagesFailureCode,
          metadata("messages.list")
        );
      }
      return callSuccess(
        batchesByChatId?.[options.chatId] ?? batch,
        metadata("messages.list")
      );
    },
    searchMessages: async () =>
      callSuccess({ messages: [], rejected: [] }, metadata("messages.search")),
    sendText: async () =>
      callFailure(ERROR_CODES.system.notImplemented, "disabled", metadata("send.text")),
    sendFile: async () =>
      callFailure(ERROR_CODES.system.notImplemented, "disabled", metadata("send.file")),
    downloadMedia: async () => callSuccess({}, metadata("media.download"))
  };

  return { adapter, calls };
}

function normalizedTextBatch({ chatId, displayName, externalMessageId, body }) {
  return {
    messages: [
      {
        adapterType: "wacli",
        externalEventId: `wacli:${chatId}:${externalMessageId}`,
        externalMessageId,
        externalChatId: chatId,
        conversationType: "dm",
        conversationTitle: displayName,
        senderDisplayName: displayName,
        senderWaJid: chatId,
        fromMe: false,
        quotedExternalMessageId: null,
        quotedParticipantWaJid: null,
        messageType: "text",
        media: null,
        body,
        bodyRedacted: false,
        receivedAt: new Date("2026-05-01T10:00:00.000Z"),
        raw: {
          redacted: true
        }
      }
    ],
    rejected: []
  };
}

test("live allowlist poll stores inbound and from-me messages canonically in Postgres", async () => {
  const postgres = await startDisposablePostgres({ prefix: "viji-phase10-live" });

  try {
    postgres.runProjectScript("scripts/run-migrations.mjs");
    const pool = createPgPool({ connectionString: postgres.connectionString });

    try {
      const repositories = createRepositories(pool);
      const person = await repositories.contacts.createPerson({
        displayName: "Primary Recipient",
        notes: "Synthetic Phase 10 live poll person"
      });
      const contact = await repositories.contacts.createAllowlistedContact({
        ownerPersonId: person.personId,
        displayName: "Primary Recipient",
        waJid: chatJid,
        trustLevel: "trusted"
      });
      const channelAccount =
        await repositories.channelAccounts.createChannelAccount({
          label: "Phase 10 redacted live poll account",
          storePath: "/data/pratiksha/wacli/store",
          state: "ready"
        });

      const fake = createPollingAdapter({
        batch: batchFixture("messages-list-live-shape-redacted.json")
      });
      const firstPoll = await runLiveAllowlistPoll(pool, {
        channelAccountId: channelAccount.channelAccountId,
        adapter: fake.adapter,
        messageLimit: 5
      });

      assert.equal(firstPoll.status, "completed");
      assert.equal(firstPoll.contactsScanned, 1);
      assert.equal(firstPoll.messagesSeen, 2);
      assert.equal(firstPoll.messagesImported, 2);
      assert.equal(fake.calls.listChats[0].query, contact.waJid);
      assert.equal(fake.calls.listMessages[0].chatId, chatJid);

      const messages = await pool.query(`
        SELECT
          msg_message_external_message_id AS "externalMessageId",
          msg_message_direction AS "direction",
          msg_message_status AS "status"
        FROM msg_messages
        ORDER BY msg_message_external_message_id ASC
      `);
      assert.deepEqual(messages.rows, [
        {
          externalMessageId: "wamid.redacted.owner.live.0002",
          direction: "outbound",
          status: "sent"
        },
        {
          externalMessageId: "wamid.redacted.vijayalakshmi.live.0001",
          direction: "inbound",
          status: "received"
        }
      ]);

      const secondPoll = await runLiveAllowlistPoll(pool, {
        channelAccountId: channelAccount.channelAccountId,
        adapter: fake.adapter,
        messageLimit: 5
      });
      assert.equal(secondPoll.messagesImported, 0);

      const count = await pool.query(
        `SELECT count(*)::integer AS count FROM msg_messages`
      );
      assert.equal(count.rows[0].count, 2);
    } finally {
      await pool.end();
    }
  } finally {
    postgres.stop();
  }
});

test("live allowlist poll reads Primary Recipient and Myself in the same cycle", async () => {
  const postgres = await startDisposablePostgres({ prefix: "viji-phase10-dual" });

  try {
    postgres.runProjectScript("scripts/run-migrations.mjs");
    const pool = createPgPool({ connectionString: postgres.connectionString });

    try {
      const repositories = createRepositories(pool);
      const vijiPerson = await repositories.contacts.createPerson({
        displayName: "Primary Recipient",
        notes: "Synthetic Phase 10 primary contact"
      });
      const myselfPerson = await repositories.contacts.createPerson({
        displayName: "Myself",
        notes: "Synthetic Phase 10 test contact"
      });
      const vijiContact = await repositories.contacts.createAllowlistedContact({
        ownerPersonId: vijiPerson.personId,
        displayName: "Primary Recipient",
        waJid: "10000000001@s.whatsapp.net",
        trustLevel: "trusted"
      });
      const myselfContact = await repositories.contacts.createAllowlistedContact({
        ownerPersonId: myselfPerson.personId,
        displayName: "Myself",
        waJid: "10000000000@s.whatsapp.net",
        trustLevel: "trusted"
      });
      const channelAccount =
        await repositories.channelAccounts.createChannelAccount({
          label: "Phase 10 dual-contact live poll account",
          storePath: "/data/pratiksha/wacli/store",
          state: "ready"
        });

      const fake = createPollingAdapter({
        chats: [
          { chatId: vijiContact.waJid, name: vijiContact.displayName, type: "dm" },
          {
            chatId: myselfContact.waJid,
            name: myselfContact.displayName,
            type: "dm"
          }
        ],
        batchesByChatId: {
          [vijiContact.waJid]: normalizedTextBatch({
            chatId: vijiContact.waJid,
            displayName: vijiContact.displayName,
            externalMessageId: "wamid.redacted.viji.dual.0001",
            body: "Primary contact message"
          }),
          [myselfContact.waJid]: normalizedTextBatch({
            chatId: myselfContact.waJid,
            displayName: myselfContact.displayName,
            externalMessageId: "wamid.redacted.myself.dual.0001",
            body: "Self-test contact message"
          })
        }
      });

      const poll = await runLiveAllowlistPoll(pool, {
        channelAccountId: channelAccount.channelAccountId,
        adapter: fake.adapter,
        messageLimit: 5
      });

      assert.equal(poll.status, "completed");
      assert.equal(poll.contactsScanned, 2);
      assert.equal(poll.messagesSeen, 2);
      assert.equal(poll.messagesImported, 2);
      assert.deepEqual(
        fake.calls.listChats.map((call) => call.query).sort(),
        [myselfContact.waJid, vijiContact.waJid].sort()
      );
      assert.deepEqual(
        fake.calls.listMessages.map((call) => call.chatId).sort(),
        [myselfContact.waJid, vijiContact.waJid].sort()
      );

      const messages = await pool.query(`
        SELECT
          core_contacts.core_contact_display_name AS "displayName",
          count(*)::integer AS "messageCount"
        FROM msg_messages
        JOIN core_contacts
          ON core_contacts.core_contact_id = msg_messages.sender_core_contact_id
        GROUP BY core_contacts.core_contact_display_name
        ORDER BY core_contacts.core_contact_display_name ASC
      `);
      assert.deepEqual(messages.rows, [
        { displayName: "Myself", messageCount: 1 },
        { displayName: "Primary Recipient", messageCount: 1 }
      ]);
    } finally {
      await pool.end();
    }
  } finally {
    postgres.stop();
  }
});

test("live allowlist poll skips broad direct chat results without an exact match", async () => {
  const postgres = await startDisposablePostgres({ prefix: "viji-phase10-ambiguous" });

  try {
    postgres.runProjectScript("scripts/run-migrations.mjs");
    const pool = createPgPool({ connectionString: postgres.connectionString });

    try {
      const repositories = createRepositories(pool);
      const person = await repositories.contacts.createPerson({
        displayName: "Primary Recipient",
        notes: "Synthetic Phase 10 ambiguous chat person"
      });
      await repositories.contacts.createAllowlistedContact({
        ownerPersonId: person.personId,
        displayName: "Primary Recipient",
        phoneE164: "+10000000000",
        trustLevel: "trusted"
      });
      const channelAccount =
        await repositories.channelAccounts.createChannelAccount({
          label: "Phase 10 ambiguous live poll account",
          storePath: "/data/pratiksha/wacli/store",
          state: "ready"
        });

      const fake = createPollingAdapter({
        batch: batchFixture("messages-list-live-shape-redacted.json"),
        chats: [
          { chatId: "11111111111@s.whatsapp.net", name: "Unrelated Person", type: "dm" },
          { chatId: "22222222222@s.whatsapp.net", name: "Another Person", type: "dm" }
        ]
      });
      const poll = await runLiveAllowlistPoll(pool, {
        channelAccountId: channelAccount.channelAccountId,
        adapter: fake.adapter,
        messageLimit: 5
      });

      assert.equal(poll.status, "completed");
      assert.equal(poll.contactsScanned, 1);
      assert.equal(poll.messagesSeen, 0);
      assert.equal(poll.messagesImported, 0);
      assert.equal(poll.contacts[0].status, "skipped");
      assert.equal(poll.contacts[0].reason, "no_matching_chat");
      assert.equal(fake.calls.listMessages.length, 0);

      const count = await pool.query(
        `SELECT count(*)::integer AS count FROM msg_messages`
      );
      assert.equal(count.rows[0].count, 0);
    } finally {
      await pool.end();
    }
  } finally {
    postgres.stop();
  }
});
