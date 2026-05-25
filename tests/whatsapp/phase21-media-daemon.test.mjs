import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
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
const { callFailure, callSuccess, ERROR_CODES } = await import(
  "../../packages/shared/dist/index.js"
);
const { normalizeWacliMessagesFromJson } = await import(
  "../../packages/whatsapp/dist/index.js"
);
const {
  drainMediaDownloadQueue,
  getMediaDrainConfigFromEnv,
  ingestNormalizedInboundMessages
} = await import("../../apps/worker/dist/index.js");

const fixture = JSON.parse(
  await readFile("fixtures/wacli/messages-media-redacted.json", "utf8")
);
const normalized = normalizeWacliMessagesFromJson(fixture);

function metadata(operation) {
  return {
    component: "phase21-media-test",
    operation
  };
}

async function createTempDataRoot() {
  const dataRoot = await mkdtemp(join(tmpdir(), "viji-phase21-media-"));
  const mediaRoot = join(dataRoot, "wacli", "media");
  await mkdir(mediaRoot, { recursive: true });
  await writeFile(join(dataRoot, ".viji-helper-root"), "ok", "utf8");

  return { dataRoot, mediaRoot };
}

async function seedAllowlistedMedia(db, repositories, dataRoot) {
  const person = await repositories.contacts.createPerson({
    displayName: "Vijayalakshmi Saravanan",
    notes: "Synthetic Phase 21 media contact"
  });
  const contact = await repositories.contacts.createAllowlistedContact({
    ownerPersonId: person.personId,
    displayName: "Vijayalakshmi Saravanan",
    waJid: "vijayalakshmi.saravanan.redacted@s.whatsapp.net",
    trustLevel: "trusted"
  });
  const channelAccount =
    await repositories.channelAccounts.createChannelAccount({
      label: "Phase 21 media account",
      storePath: join(dataRoot, "wacli", "store"),
      state: "ready"
    });

  const ingest = await ingestNormalizedInboundMessages(db, {
    channelAccountId: channelAccount.channelAccountId,
    messages: normalized.messages
  });
  const inserted = ingest.find((result) => result.status === "inserted");
  assert.ok(inserted);

  return { contact, inserted };
}

async function addQueuedMedia(repositories, message, suffix, options = {}) {
  const media = await repositories.messages.addMessageMedia({
    messageId: message.messageId,
    externalMediaId: `wamid.redacted.vijayalakshmi.phase21.${suffix}`,
    mimeType: options.mimeType ?? "image/jpeg",
    fileName: options.fileName ?? `phase21-${suffix}.jpg`,
    sizeBytes: options.sizeBytes ?? 21,
    downloadState: "queued"
  });
  const job = await repositories.mediaJobs.createMediaDownloadJobIdempotent({
    messageMediaId: media.messageMediaId,
    conversationId: message.conversationId
  });

  return { media, job: job.job };
}

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

test("Phase 21 drains queued media, stores files, and promotes reusable resources", async () => {
  const postgres = await startDisposablePostgres({
    prefix: "viji-phase21-media"
  });

  try {
    postgres.runProjectScript("scripts/run-migrations.mjs");
    const pool = createPgPool({ connectionString: postgres.connectionString });
    const { dataRoot, mediaRoot } = await createTempDataRoot();

    try {
      const repositories = createRepositories(pool);
      const { contact } = await seedAllowlistedMedia(pool, repositories, dataRoot);
      const mediaMessages = await pool.query(`
        SELECT
          msg_messages.msg_message_id AS "messageId",
          msg_messages.parent_msg_conversation_id AS "conversationId"
        FROM msg_messages
        INNER JOIN msg_message_media
          ON msg_message_media.parent_msg_message_id = msg_messages.msg_message_id
        LIMIT 1
      `);
      const mediaMessage = mediaMessages.rows[0];
      await addQueuedMedia(repositories, mediaMessage, "document", {
        mimeType: "application/pdf",
        fileName: "phase21-document.pdf",
        sizeBytes: 31
      });
      await addQueuedMedia(repositories, mediaMessage, "audio", {
        mimeType: "audio/ogg",
        fileName: "phase21-voice.ogg",
        sizeBytes: 41
      });
      const calls = [];
      const downloads = [
        {
          name: "viji_passport_photo.jpg",
          mime: "image/jpeg",
          bytes: "synthetic image bytes"
        },
        {
          name: "phase21-document.pdf",
          mime: "application/pdf",
          bytes: "synthetic pdf bytes"
        },
        {
          name: "phase21-voice.ogg",
          mime: "audio/ogg",
          bytes: "synthetic audio bytes"
        }
      ];
      const adapter = {
        async downloadMedia(options) {
          const download = downloads[calls.length];
          assert.ok(download);
          calls.push(options);
          const downloadedPath = join(options.output, download.name);
          await writeFile(downloadedPath, download.bytes, "utf8");
          return callSuccess(
            {
              outputPath: downloadedPath,
              mime: download.mime,
              sizeBytes: Buffer.byteLength(download.bytes)
            },
            metadata("media.download")
          );
        }
      };

      const drained = await drainMediaDownloadQueue(pool, {
        adapter,
        limitPerCycle: 4,
        autoPromote: true,
        storageStateOverride: "healthy",
        env: {
          ...process.env,
          VIJI_DATA_ROOT: dataRoot,
          VIJI_WACLI_MEDIA_ROOT: mediaRoot,
          VIJI_STORAGE_PROFILE: "large-200gb"
        }
      });

      assert.deepEqual(drained, {
        attempted: 3,
        downloaded: 3,
        promoted: 3,
        blocked: 0,
        failed: 0,
        promotionBlocked: 0,
        idle: true
      });
      assert.equal(calls.length, 3);
      assert.match(calls[0].output, /incoming/);

      const resources = await pool.query(`
        SELECT
          res_resource_allowed_contact_ids AS "allowedContactIds",
          res_resource_requires_recipient_confirmation AS "requiresRecipientConfirmation"
        FROM res_resources
      `);
      assert.equal(resources.rows.length, 3);
      for (const resource of resources.rows) {
        assert.ok(resource.allowedContactIds.includes(contact.contactId));
        assert.equal(resource.requiresRecipientConfirmation, true);
      }

      const secondDrain = await drainMediaDownloadQueue(pool, {
        adapter,
        limitPerCycle: 3,
        autoPromote: true,
        storageStateOverride: "healthy",
        env: {
          ...process.env,
          VIJI_DATA_ROOT: dataRoot,
          VIJI_WACLI_MEDIA_ROOT: mediaRoot
        }
      });
      assert.equal(secondDrain.attempted, 0);
      assert.equal(secondDrain.idle, true);
      assert.equal(calls.length, 3);
    } finally {
      await pool.end();
    }
  } finally {
    postgres.stop();
  }
});

test("Phase 21 media drain blocks storage-warning jobs and cleans failed partial files", async () => {
  const postgres = await startDisposablePostgres({
    prefix: "viji-phase21-media-failure"
  });

  try {
    postgres.runProjectScript("scripts/run-migrations.mjs");
    const pool = createPgPool({ connectionString: postgres.connectionString });
    const { dataRoot, mediaRoot } = await createTempDataRoot();

    try {
      const repositories = createRepositories(pool);
      const { inserted } = await seedAllowlistedMedia(pool, repositories, dataRoot);
      const warning = await drainMediaDownloadQueue(pool, {
        adapter: {
          async downloadMedia() {
            throw new Error("downloadMedia should not run while storage is warning");
          }
        },
        limitPerCycle: 1,
        storageStateOverride: "warning",
        env: {
          ...process.env,
          VIJI_DATA_ROOT: dataRoot,
          VIJI_WACLI_MEDIA_ROOT: mediaRoot
        }
      });
      assert.equal(warning.blocked, 1);
      assert.equal(warning.attempted, 1);

      await addQueuedMedia(repositories, inserted.message, "partial");
      let partialRoot = "";
      const failed = await drainMediaDownloadQueue(pool, {
        adapter: {
          async downloadMedia(options) {
            partialRoot = options.output;
            await writeFile(join(options.output, "partial.tmp"), "partial", "utf8");
            return callFailure(
              ERROR_CODES.adapter.networkUnavailable,
              "synthetic media network failure",
              metadata("media.download"),
              { retryable: true }
            );
          }
        },
        limitPerCycle: 1,
        storageStateOverride: "healthy",
        env: {
          ...process.env,
          VIJI_DATA_ROOT: dataRoot,
          VIJI_WACLI_MEDIA_ROOT: mediaRoot
        }
      });

      assert.equal(failed.failed, 1);
      assert.equal(await pathExists(partialRoot), false);
    } finally {
      await pool.end();
    }
  } finally {
    postgres.stop();
  }
});

test("Phase 21 media drain config defaults to unattended download and promotion", () => {
  assert.deepEqual(getMediaDrainConfigFromEnv({}), {
    enabled: true,
    limitPerCycle: 3,
    autoPromote: true
  });
  assert.deepEqual(
    getMediaDrainConfigFromEnv({
      VIJI_LIVE_MEDIA_DRAIN_ENABLED: "false",
      VIJI_LIVE_MEDIA_DRAIN_LIMIT_PER_CYCLE: "7",
      VIJI_LIVE_MEDIA_AUTO_PROMOTE_ENABLED: "false"
    }),
    {
      enabled: false,
      limitPerCycle: 7,
      autoPromote: false
    }
  );
});
