import assert from "node:assert/strict";
import test from "node:test";

import {
  assertSuccess,
  run,
  startDisposablePostgres
} from "../helpers/disposable-postgres.mjs";
import {
  countRows,
  createVijayalakshmiFixtureHarness
} from "../helpers/redacted-vijayalakshmi-fixture.mjs";

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
    storageUri: "/Volumes/Arya 1TB/VijiAI/viji-files/viji_10_marksheet.pdf",
    checksumSha256: "sha256-phase12-10",
    mimeType: "application/pdf",
    sizeBytes: 1024,
    registeredFileName: "viji_10_marksheet.pdf",
    title: "Viji 10th marksheet",
    aliases: ["10th marksheet", "class 10 marksheet", "tenth marksheet"],
    description: "Vijayalakshmi's 10th standard marksheet PDF.",
    contentSummary: "10th standard marksheet for Vijayalakshmi.",
    allowedContactIds: [contactId]
  });
  await repositories.resources.registerFileResource({
    storageUri: "/Volumes/Arya 1TB/VijiAI/viji-files/viji_12_marksheet.pdf",
    checksumSha256: "sha256-phase12-12",
    mimeType: "application/pdf",
    sizeBytes: 2048,
    registeredFileName: "viji_12_marksheet.pdf",
    title: "Viji 12th marksheet",
    aliases: ["12th marksheet", "class 12 marksheet", "twelfth marksheet"],
    description: "Vijayalakshmi's 12th standard marksheet PDF.",
    contentSummary: "12th standard marksheet for Vijayalakshmi.",
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
      const harness = await createVijayalakshmiFixtureHarness(repositories);
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
      assert.match(proposal.draft.body, /1\. viji_10_marksheet\.pdf/);
      assert.match(proposal.draft.body, /2\. viji_12_marksheet\.pdf/);

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
      assert.equal(confirmed.job.payload.registeredFileName, "viji_12_marksheet.pdf");
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
      const harness = await createVijayalakshmiFixtureHarness(repositories);
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
      assert.equal(confirmed.job.payload.registeredFileName, "viji_12_marksheet.pdf");
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
      const harness = await createVijayalakshmiFixtureHarness(repositories);
      await repositories.resources.registerFileResource({
        storageUri: "/Volumes/Arya 1TB/VijiAI/viji-files/viji_marksheets.pdf",
        checksumSha256: "sha256-phase12-single-marksheets",
        mimeType: "application/pdf",
        sizeBytes: 4096,
        registeredFileName: "viji_marksheets.pdf",
        title: "Viji marksheets",
        aliases: ["marksheet", "marksheets"],
        description: "Combined marksheets for Vijayalakshmi.",
        contentSummary: "Vijayalakshmi marksheets PDF.",
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
      assert.match(proposal.draft.body, /Do you mean viji_marksheets\.pdf\?/);

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
      assert.equal(confirmed.job.payload.registeredFileName, "viji_marksheets.pdf");
    } finally {
      await pool.end();
    }
  } finally {
    postgres.stop();
  }
});
