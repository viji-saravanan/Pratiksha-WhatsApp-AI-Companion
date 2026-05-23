import assert from "node:assert/strict";
import test from "node:test";

import {
  assertSuccess,
  run,
  startDisposablePostgres
} from "../helpers/disposable-postgres.mjs";
import {
  countRows,
  createPrimaryRecipientFixtureHarness
} from "../helpers/redacted-primary-recipient-fixture.mjs";

const build = run("corepack", ["pnpm", "--filter", "@viji/worker", "build"]);
assertSuccess(build, "build @viji/worker");

const { createPgPool, createRepositories } = await import(
  "../../packages/db/dist/index.js"
);
const {
  confirmSuggestedResourceFromInboundMessage,
  createResourceSuggestionDraftForInboundMessage
} = await import("../../apps/worker/dist/index.js");

async function addConfirmationMessage(repositories, harness, proposal, body, id) {
  const adapterEvent = await repositories.adapterEvents.insertAdapterEventIdempotent({
    channelAccountId: harness.channelAccount.channelAccountId,
    type: "message.received",
    externalEventId: `event:${id}`,
    payload: { redacted: true }
  });

  return repositories.messages.insertInboundMessageIdempotent({
    conversationId: proposal.draft.conversationId,
    senderContactId: harness.contact.contactId,
    adapterEventId: adapterEvent.event.adapterEventId,
    externalMessageId: id,
    body,
    receivedAt: new Date("2026-05-01T10:02:00.000Z")
  });
}

async function seedMarksheetResources(repositories, contactId) {
  await repositories.resources.registerFileResource({
    storageUri: "/data/pratiksha/viji-files/recipient_10_marksheet.pdf",
    checksumSha256: "sha256-phase12-10",
    mimeType: "application/pdf",
    sizeBytes: 1024,
    registeredFileName: "recipient_10_marksheet.pdf",
    title: "Recipient 10th marksheet",
    aliases: ["10th marksheet", "class 10 marksheet", "tenth marksheet"],
    description: "Primary Recipient's 10th standard marksheet PDF.",
    contentSummary: "10th standard marksheet for Primary Recipient.",
    allowedContactIds: [contactId]
  });
  await repositories.resources.registerFileResource({
    storageUri: "/data/pratiksha/viji-files/recipient_12_marksheet.pdf",
    checksumSha256: "sha256-phase12-12",
    mimeType: "application/pdf",
    sizeBytes: 2048,
    registeredFileName: "recipient_12_marksheet.pdf",
    title: "Recipient 12th marksheet",
    aliases: ["12th marksheet", "class 12 marksheet", "twelfth marksheet"],
    description: "Primary Recipient's 12th standard marksheet PDF.",
    contentSummary: "12th standard marksheet for Primary Recipient.",
    allowedContactIds: [contactId]
  });
}

test("resource catalog suggests similar filenames and accepts list-number confirmation", async () => {
  const postgres = await startDisposablePostgres({ prefix: "viji-phase12-resources" });

  try {
    postgres.runProjectScript("scripts/run-migrations.mjs");
    const pool = createPgPool({ connectionString: postgres.connectionString });

    try {
      const repositories = createRepositories(pool);
      const harness = await createPrimaryRecipientFixtureHarness(repositories);
      await seedMarksheetResources(repositories, harness.contact.contactId);
      const inbound = await harness.createInboundMessage({
        externalMessageId: "wamid.redacted.vijayalakshmi.phase12-marksheet",
        body: "can you send my marksheets"
      });

      const proposal = await createResourceSuggestionDraftForInboundMessage(pool, {
        triggerMessageId: inbound.messageId,
        now: new Date("2026-05-01T10:01:00.000Z")
      });

      assert.equal(proposal.status, "suggested");
      assert.match(proposal.draft.body, /Do you mean:/);
      assert.match(proposal.draft.body, /1\. recipient_10_marksheet\.pdf/);
      assert.match(proposal.draft.body, /2\. recipient_12_marksheet\.pdf/);

      const ambiguous = await addConfirmationMessage(
        repositories,
        harness,
        proposal,
        "yes",
        "wamid.redacted.vijayalakshmi.phase12-yes"
      );
      const ambiguousConfirm = await confirmSuggestedResourceFromInboundMessage(pool, {
        agentDraftId: proposal.draft.agentDraftId,
        confirmationMessageId: ambiguous.message.messageId,
        now: new Date("2026-05-01T10:02:05.000Z")
      });
      assert.equal(ambiguousConfirm.status, "blocked");
      assert.equal(await countRows(pool, "agent_outbound_jobs"), 0);

      const confirmation = await addConfirmationMessage(
        repositories,
        harness,
        proposal,
        "2",
        "wamid.redacted.vijayalakshmi.phase12-option-2"
      );
      const confirmed = await confirmSuggestedResourceFromInboundMessage(pool, {
        agentDraftId: proposal.draft.agentDraftId,
        confirmationMessageId: confirmation.message.messageId,
        now: new Date("2026-05-01T10:02:10.000Z")
      });

      assert.equal(confirmed.status, "queued");
      assert.equal(confirmed.queueStatus, "inserted");
      assert.equal(confirmed.job.payload.registeredFileName, "recipient_12_marksheet.pdf");
    } finally {
      await pool.end();
    }
  } finally {
    postgres.stop();
  }
});

test("resource catalog accepts descriptive confirmation such as 12th marksheet", async () => {
  const postgres = await startDisposablePostgres({
    prefix: "viji-phase12-descriptive"
  });

  try {
    postgres.runProjectScript("scripts/run-migrations.mjs");
    const pool = createPgPool({ connectionString: postgres.connectionString });

    try {
      const repositories = createRepositories(pool);
      const harness = await createPrimaryRecipientFixtureHarness(repositories);
      await seedMarksheetResources(repositories, harness.contact.contactId);
      const inbound = await harness.createInboundMessage({
        externalMessageId: "wamid.redacted.vijayalakshmi.phase12-description",
        body: "send marksheet"
      });

      const proposal = await createResourceSuggestionDraftForInboundMessage(pool, {
        triggerMessageId: inbound.messageId,
        now: new Date("2026-05-01T10:01:00.000Z")
      });
      assert.equal(proposal.status, "suggested");

      const confirmation = await addConfirmationMessage(
        repositories,
        harness,
        proposal,
        "12th marksheet",
        "wamid.redacted.vijayalakshmi.phase12-12th"
      );
      const confirmed = await confirmSuggestedResourceFromInboundMessage(pool, {
        agentDraftId: proposal.draft.agentDraftId,
        confirmationMessageId: confirmation.message.messageId,
        now: new Date("2026-05-01T10:02:10.000Z")
      });

      assert.equal(confirmed.status, "queued");
      assert.equal(confirmed.job.payload.registeredFileName, "recipient_12_marksheet.pdf");
    } finally {
      await pool.end();
    }
  } finally {
    postgres.stop();
  }
});

test("single-option resource prompt accepts yes after the text-reply freshness window", async () => {
  const postgres = await startDisposablePostgres({
    prefix: "viji-phase12-single-yes-aged"
  });

  try {
    postgres.runProjectScript("scripts/run-migrations.mjs");
    const pool = createPgPool({ connectionString: postgres.connectionString });

    try {
      const repositories = createRepositories(pool);
      const harness = await createPrimaryRecipientFixtureHarness(repositories);
      await repositories.resources.registerFileResource({
        storageUri: "/data/pratiksha/viji-files/recipient_marksheets.pdf",
        checksumSha256: "sha256-phase12-single-marksheets",
        mimeType: "application/pdf",
        sizeBytes: 4096,
        registeredFileName: "recipient_marksheets.pdf",
        title: "Recipient marksheets",
        aliases: ["marksheet", "marksheets"],
        description: "Combined marksheets for Primary Recipient.",
        contentSummary: "Primary Recipient marksheets PDF.",
        allowedContactIds: [harness.contact.contactId]
      });
      const inbound = await harness.createInboundMessage({
        externalMessageId: "wamid.redacted.vijayalakshmi.phase12-single-request",
        body: "send marksheet",
        receivedAt: "2026-05-01T10:00:00.000Z"
      });

      const proposal = await createResourceSuggestionDraftForInboundMessage(pool, {
        triggerMessageId: inbound.messageId,
        now: new Date("2026-05-01T10:01:00.000Z")
      });
      assert.equal(proposal.status, "suggested");
      assert.match(proposal.draft.body, /Do you mean recipient_marksheets\.pdf\?/);

      const confirmation = await addConfirmationMessage(
        repositories,
        harness,
        proposal,
        "yes",
        "wamid.redacted.vijayalakshmi.phase12-single-yes"
      );
      const confirmed = await confirmSuggestedResourceFromInboundMessage(pool, {
        agentDraftId: proposal.draft.agentDraftId,
        confirmationMessageId: confirmation.message.messageId,
        now: new Date("2026-05-01T10:07:05.000Z")
      });

      assert.equal(confirmed.status, "queued");
      assert.equal(confirmed.queueStatus, "inserted");
      assert.equal(confirmed.job.payload.registeredFileName, "recipient_marksheets.pdf");
    } finally {
      await pool.end();
    }
  } finally {
    postgres.stop();
  }
});
