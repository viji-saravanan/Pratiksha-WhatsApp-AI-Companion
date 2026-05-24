import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  assertSuccess,
  run,
  startDisposablePostgres
} from "../helpers/disposable-postgres.mjs";

const build = run("corepack", ["pnpm", "--filter", "@viji/worker", "build"]);
assertSuccess(build, "build @viji/worker");

const { createPgPool, createRepositories } = await import(
  "../../packages/db/dist/index.js"
);
const { callSuccess } = await import("../../packages/shared/dist/index.js");
const { normalizeWacliMessagesFromJson } = await import(
  "../../packages/whatsapp/dist/index.js"
);
const {
  createResourceSuggestionDraftForInboundMessage,
  dispatchNextMediaDownloadJob,
  ingestNormalizedInboundMessages,
  promoteDownloadedMessageMediaToResource
} = await import("../../apps/worker/dist/index.js");

const fixture = JSON.parse(
  await readFile("fixtures/wacli/messages-media-redacted.json", "utf8")
);
const normalized = normalizeWacliMessagesFromJson(fixture);

function metadata(operation) {
  return {
    component: "phase13-media-test",
    operation
  };
}

async function createTempDataRoot() {
  const dataRoot = await mkdtemp(join(tmpdir(), "viji-phase13-media-"));
  const mediaRoot = join(dataRoot, "wacli", "media");
  await mkdir(mediaRoot, { recursive: true });
  await writeFile(join(dataRoot, ".viji-helper-root"), "ok", "utf8");

  return { dataRoot, mediaRoot };
}

async function addQueuedMedia(repositories, message, suffix) {
  const media = await repositories.messages.addMessageMedia({
    messageId: message.messageId,
    externalMediaId: `wamid.redacted.vijayalakshmi.media.${suffix}`,
    mimeType: "image/jpeg",
    fileName: `queued-${suffix}.jpg`,
    sizeBytes: 21,
    downloadState: "queued"
  });
  const job = await repositories.mediaJobs.createMediaDownloadJobIdempotent({
    messageMediaId: media.messageMediaId,
    conversationId: message.conversationId
  });

  return { media, job: job.job };
}

test("Phase 13 queues, downloads, and promotes allowlisted received media", async () => {
  assert.equal(normalized.rejected.length, 0);
  assert.equal(normalized.messages.length, 2);
  assert.equal(normalized.messages[0].messageType, "image");
  assert.deepEqual(normalized.messages[0].media, {
    externalMediaId: "wamid.redacted.vijayalakshmi.media.1001",
    mimeType: "image/jpeg",
    fileName: "viji_passport_photo.jpg",
    sizeBytes: 21
  });

  const postgres = await startDisposablePostgres({
    prefix: "viji-phase13-media"
  });

  try {
    postgres.runProjectScript("scripts/run-migrations.mjs");
    const pool = createPgPool({ connectionString: postgres.connectionString });
    const { dataRoot, mediaRoot } = await createTempDataRoot();

    try {
      const repositories = createRepositories(pool);
      const person = await repositories.contacts.createPerson({
        displayName: "Vijayalakshmi Saravanan",
        notes: "Synthetic Phase 13 media contact"
      });
      const contact = await repositories.contacts.createAllowlistedContact({
        ownerPersonId: person.personId,
        displayName: "Vijayalakshmi Saravanan",
        waJid: "vijayalakshmi.saravanan.redacted@s.whatsapp.net",
        trustLevel: "trusted"
      });
      const channelAccount =
        await repositories.channelAccounts.createChannelAccount({
          label: "Phase 13 media account",
          storePath: join(dataRoot, "wacli", "store"),
          state: "ready"
        });

      const firstIngest = await ingestNormalizedInboundMessages(pool, {
        channelAccountId: channelAccount.channelAccountId,
        messages: normalized.messages
      });
      const inserted = firstIngest.find((result) => result.status === "inserted");
      assert.ok(inserted);
      assert.equal(inserted.messageMedia.mimeType, "image/jpeg");
      assert.equal(inserted.mediaDownloadJob.state, "queued");
      assert.equal(
        firstIngest.filter(
          (result) =>
            result.status === "ignored" &&
            result.reason === "contact_not_allowlisted"
        ).length,
        1
      );

      const duplicateIngest = await ingestNormalizedInboundMessages(pool, {
        channelAccountId: channelAccount.channelAccountId,
        messages: normalized.messages
      });
      assert.equal(
        duplicateIngest.filter((result) => result.status === "existing").length,
        1
      );
      const mediaCount = await pool.query(`
        SELECT count(*)::integer AS count
        FROM msg_message_media
      `);
      assert.equal(mediaCount.rows[0].count, 1);

      const downloadedPath = join(mediaRoot, "viji_passport_photo.jpg");
      await writeFile(downloadedPath, "synthetic image bytes", "utf8");
      const calls = [];
      const adapter = {
        async downloadMedia(options) {
          calls.push(options);
          return callSuccess(
            {
              outputPath: downloadedPath,
              mime: "image/jpeg",
              sizeBytes: 21
            },
            metadata("media.download")
          );
        }
      };

      const downloaded = await dispatchNextMediaDownloadJob(pool, {
        adapter,
        storageStateOverride: "healthy",
        env: {
          ...process.env,
          VIJI_DATA_ROOT: dataRoot,
          VIJI_WACLI_MEDIA_ROOT: mediaRoot,
          VIJI_STORAGE_PROFILE: "large-200gb"
        }
      });
      assert.equal(downloaded.status, "downloaded");
      assert.equal(calls.length, 1);
      assert.equal(
        calls[0].messageId,
        "wamid.redacted.vijayalakshmi.media.1001"
      );

      const mediaAfterDownload = await pool.query(`
        SELECT
          msg_message_media_download_state AS "downloadState",
          backing_res_file_asset_id AS "fileAssetId"
        FROM msg_message_media
      `);
      assert.equal(mediaAfterDownload.rows[0].downloadState, "downloaded");
      assert.ok(mediaAfterDownload.rows[0].fileAssetId);

      const promoted = await promoteDownloadedMessageMediaToResource(pool, {
        messageMediaId: inserted.messageMedia.messageMediaId
      });
      assert.equal(promoted.status, "promoted");
      assert.ok(promoted.resource.allowedContactIds.includes(contact.contactId));
      assert.equal(promoted.resource.requiresRecipientConfirmation, true);
      assert.match(promoted.resource.contentSummary, /passport photo/);

      const request = await repositories.messages.insertInboundMessageIdempotent({
        conversationId: inserted.message.conversationId,
        senderContactId: contact.contactId,
        externalMessageId: "wamid.redacted.vijayalakshmi.media-request",
        body: "Can you send the passport photo again?",
        receivedAt: new Date("2026-05-01T10:05:00.000Z")
      });
      const proposal = await createResourceSuggestionDraftForInboundMessage(pool, {
        triggerMessageId: request.message.messageId,
        now: new Date("2026-05-01T10:05:30.000Z")
      });
      assert.equal(proposal.status, "suggested");
      assert.match(proposal.draft.body, /Do you mean/);
      assert.match(proposal.draft.body, /passport_photo|passport photo/i);

      const blocked = await addQueuedMedia(repositories, inserted.message, "blocked");
      const blockedAdapter = {
        async downloadMedia() {
          throw new Error("adapter should not be called while storage is warning");
        }
      };
      const blockedResult = await dispatchNextMediaDownloadJob(pool, {
        adapter: blockedAdapter,
        storageStateOverride: "warning",
        env: {
          ...process.env,
          VIJI_DATA_ROOT: dataRoot,
          VIJI_WACLI_MEDIA_ROOT: mediaRoot
        }
      });
      assert.equal(blockedResult.status, "blocked");
      assert.equal(blockedResult.reason, "storage_warning");
      assert.equal(blockedResult.job.mediaDownloadJobId, blocked.job.mediaDownloadJobId);

      const outside = await mkdtemp(join(tmpdir(), "viji-phase13-outside-"));
      const outsideFile = join(outside, "outside.jpg");
      await writeFile(outsideFile, "outside bytes", "utf8");
      await addQueuedMedia(repositories, inserted.message, "escape");
      const escapeResult = await dispatchNextMediaDownloadJob(pool, {
        adapter: {
          async downloadMedia() {
            return callSuccess(
              {
                outputPath: outsideFile,
                mime: "image/jpeg",
                sizeBytes: 13
              },
              metadata("media.download")
            );
          }
        },
        storageStateOverride: "healthy",
        env: {
          ...process.env,
          VIJI_DATA_ROOT: dataRoot,
          VIJI_WACLI_MEDIA_ROOT: mediaRoot,
          VIJI_STORAGE_PROFILE: "large-200gb"
        }
      });
      assert.equal(escapeResult.status, "blocked");
      assert.equal(escapeResult.reason, "media_path_invalid");
    } finally {
      await pool.end();
    }
  } finally {
    postgres.stop();
  }
});
