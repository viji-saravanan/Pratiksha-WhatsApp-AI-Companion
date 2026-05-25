import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises";
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
const { transcribeAudioFile } = await import("../../packages/ai/dist/index.js");
const { hashFileSha256 } = await import("../../packages/resources/dist/index.js");
const {
  drainAudioTranscriptionQueue,
  getAudioTranscriptionDrainConfigFromEnv,
  transcribeDownloadedAudioMedia
} = await import("../../apps/worker/dist/index.js");

async function createTempDataRoot() {
  const dataRoot = await mkdtemp(join(tmpdir(), "viji-phase23-audio-"));
  const mediaRoot = join(dataRoot, "wacli", "media");
  await mkdir(mediaRoot, { recursive: true });
  await writeFile(join(dataRoot, ".viji-helper-root"), "ok", "utf8");

  return { dataRoot, mediaRoot };
}

async function seedConversation(repositories, dataRoot) {
  const person = await repositories.contacts.createPerson({
    displayName: "Vijayalakshmi Saravanan",
    notes: "Synthetic Phase 23 voice contact"
  });
  const contact = await repositories.contacts.createAllowlistedContact({
    ownerPersonId: person.personId,
    displayName: "Vijayalakshmi Saravanan",
    waJid: "vijayalakshmi.saravanan.redacted@s.whatsapp.net",
    trustLevel: "trusted"
  });
  const channelAccount =
    await repositories.channelAccounts.createChannelAccount({
      label: "Phase 23 voice account",
      storePath: join(dataRoot, "wacli", "store"),
      state: "ready"
    });
  const conversation = await repositories.conversations.upsertDirectConversation({
    channelAccountId: channelAccount.channelAccountId,
    primaryContactId: contact.contactId,
    externalChatId: "phase23-voice-chat",
    title: "Phase 23 voice chat",
    contextState: "fresh"
  });

  return { contact, conversation };
}

async function addDownloadedMedia(pool, repositories, dataRoot, input = {}) {
  const { contact, conversation } = await seedConversation(repositories, dataRoot);
  const message = await repositories.messages.insertInboundMessageIdempotent({
    conversationId: conversation.conversationId,
    senderContactId: contact.contactId,
    externalMessageId: input.externalMessageId ?? `phase23-${randomUUID()}`,
    type: input.messageType ?? "audio",
    body: input.body ?? null,
    receivedAt: new Date("2026-05-25T08:00:00Z")
  });
  const mediaDir = join(dataRoot, "wacli", "media", "phase23");
  await mkdir(mediaDir, { recursive: true });
  const fileName = input.fileName ?? "phase23-voice.ogg";
  const filePath = join(mediaDir, fileName);
  await writeFile(filePath, input.fileContents ?? "synthetic audio bytes", "utf8");
  const fileAsset = await repositories.resources.upsertFileAsset({
    storageUri: filePath,
    originalUri: `whatsapp://media/${fileName}`,
    checksumSha256: await hashFileSha256(filePath),
    mimeType: input.assetMimeType ?? input.mimeType ?? "audio/ogg",
    sizeBytes: Buffer.byteLength(input.fileContents ?? "synthetic audio bytes"),
    storageState: "available"
  });
  const media = await repositories.messages.addMessageMedia({
    messageId: message.message.messageId,
    externalMediaId: `wamid.redacted.phase23.${fileName}`,
    mimeType: input.mimeType ?? "audio/ogg",
    fileName,
    sizeBytes: Buffer.byteLength(input.fileContents ?? "synthetic audio bytes"),
    downloadState: "downloaded"
  });
  await repositories.messages.linkMessageMediaFileAsset({
    messageMediaId: media.messageMediaId,
    fileAssetId: fileAsset.fileAssetId
  });

  return { contact, conversation, message: message.message, media, filePath };
}

function speechConfig(dataRoot, overrides = {}) {
  return {
    enabled: true,
    command: "fake-stt",
    commandArgs: [],
    modelPath: join(dataRoot, "models", "whisper", "ggml-small.bin"),
    modelName: "fake local whisper",
    timeoutMs: 10_000,
    minConfidence: 0.65,
    maxAudioBytes: 26_214_400,
    tempRoot: join(dataRoot, "tmp", "stt"),
    ffmpegBin: "ffmpeg",
    transcodeToWav: false,
    ...overrides
  };
}

test("Phase 23 transcribes downloaded voice notes before they enter automation", async () => {
  const postgres = await startDisposablePostgres({
    prefix: "viji-phase23-voice"
  });

  try {
    postgres.runProjectScript("scripts/run-migrations.mjs");
    const pool = createPgPool({ connectionString: postgres.connectionString });
    const { dataRoot } = await createTempDataRoot();

    try {
      const repositories = createRepositories(pool);
      const { media, message, filePath } = await addDownloadedMedia(
        pool,
        repositories,
        dataRoot,
        { externalMessageId: "phase23-short-audio" }
      );

      assert.equal(
        (await repositories.messages.listInboundMessagesNeedingAutomation())
          .length,
        0
      );

      const drained = await drainAudioTranscriptionQueue(pool, {
        env: { VIJI_DATA_ROOT: dataRoot },
        speechToTextConfig: speechConfig(dataRoot),
        limitPerCycle: 2,
        async transcriber({ audioPath }) {
          assert.equal(audioPath, await realpath(filePath));
          return {
            text: "please send my tenth marksheet",
            language: "en",
            confidence: 0.91,
            durationMs: 2100,
            modelName: "fake local whisper",
            metadata: { fixture: "short-audio" }
          };
        }
      });

      assert.deepEqual(drained, {
        enabled: true,
        attempted: 1,
        transcribed: 1,
        lowConfidence: 0,
        unsupported: 0,
        failed: 0,
        idle: true
      });

      const transcript = await repositories.messages.findMessageMediaTranscript(
        media.messageMediaId
      );
      assert.equal(transcript.status, "transcribed");
      assert.equal(transcript.text, "please send my tenth marksheet");
      assert.equal(Number(transcript.confidence), 0.91);

      const candidates =
        await repositories.messages.listInboundMessagesNeedingAutomation();
      assert.equal(candidates.length, 1);
      assert.equal(candidates[0].messageId, message.messageId);
      assert.match(candidates[0].body, /Voice note transcript: please send/i);
    } finally {
      await pool.end();
    }
  } finally {
    postgres.stop();
  }
});

test("Phase 23 stores empty or low-confidence audio without creating an automation candidate", async () => {
  const postgres = await startDisposablePostgres({
    prefix: "viji-phase23-low"
  });

  try {
    postgres.runProjectScript("scripts/run-migrations.mjs");
    const pool = createPgPool({ connectionString: postgres.connectionString });
    const { dataRoot } = await createTempDataRoot();

    try {
      const repositories = createRepositories(pool);
      const { media } = await addDownloadedMedia(pool, repositories, dataRoot, {
        externalMessageId: "phase23-noisy-audio",
        fileName: "phase23-noisy.ogg"
      });

      const result = await transcribeDownloadedAudioMedia(
        pool,
        media.messageMediaId,
        {
          env: { VIJI_DATA_ROOT: dataRoot },
          speechToTextConfig: speechConfig(dataRoot),
          async transcriber() {
            return {
              text: "",
              language: "en",
              confidence: 0.21,
              durationMs: 1300,
              modelName: "fake local whisper",
              metadata: { fixture: "noisy-audio" }
            };
          }
        }
      );

      assert.equal(result.status, "low_confidence");
      assert.equal(result.transcript.status, "low_confidence");
      assert.equal(result.transcript.text, null);
      assert.equal(
        (await repositories.messages.listInboundMessagesNeedingAutomation())
          .length,
        0
      );
    } finally {
      await pool.end();
    }
  } finally {
    postgres.stop();
  }
});

test("Phase 23 rejects unsupported media and does not duplicate transcript rows", async () => {
  const postgres = await startDisposablePostgres({
    prefix: "viji-phase23-unsupported"
  });

  try {
    postgres.runProjectScript("scripts/run-migrations.mjs");
    const pool = createPgPool({ connectionString: postgres.connectionString });
    const { dataRoot } = await createTempDataRoot();

    try {
      const repositories = createRepositories(pool);
      const { media } = await addDownloadedMedia(pool, repositories, dataRoot, {
        externalMessageId: "phase23-document-media",
        mimeType: "application/pdf",
        assetMimeType: "application/pdf",
        messageType: "document",
        fileName: "phase23-document.pdf",
        fileContents: "%PDF synthetic"
      });

      const first = await transcribeDownloadedAudioMedia(
        pool,
        media.messageMediaId,
        {
          env: { VIJI_DATA_ROOT: dataRoot },
          speechToTextConfig: speechConfig(dataRoot),
          async transcriber() {
            throw new Error("unsupported MIME should not call the transcriber");
          }
        }
      );
      const second = await transcribeDownloadedAudioMedia(
        pool,
        media.messageMediaId,
        {
          env: { VIJI_DATA_ROOT: dataRoot },
          speechToTextConfig: speechConfig(dataRoot)
        }
      );

      assert.equal(first.status, "unsupported");
      assert.equal(second.status, "existing");
      assert.equal(
        Number(
          (
            await pool.query(
              "SELECT count(*) AS count FROM msg_message_media_transcripts"
            )
          ).rows[0].count
        ),
        1
      );
    } finally {
      await pool.end();
    }
  } finally {
    postgres.stop();
  }
});

test("Phase 23 exposes transcription drain config from environment", () => {
  assert.deepEqual(getAudioTranscriptionDrainConfigFromEnv({}), {
    enabled: false,
    limitPerCycle: 2,
    minConfidence: 0.65,
    modelName: "whisper.cpp small multilingual"
  });
  assert.deepEqual(
    getAudioTranscriptionDrainConfigFromEnv({
      VIJI_STT_ENABLED: "true",
      VIJI_LIVE_AUDIO_TRANSCRIPTION_LIMIT_PER_CYCLE: "4",
      VIJI_STT_MIN_CONFIDENCE: "0.72",
      VIJI_STT_MODEL_NAME: "whisper.cpp small multilingual"
    }),
    {
      enabled: true,
      limitPerCycle: 4,
      minConfidence: 0.72,
      modelName: "whisper.cpp small multilingual"
    }
  );
});

test("Phase 23 local STT adapter reads structured JSON from a configured command", async () => {
  const dataRoot = await mkdtemp(join(tmpdir(), "viji-phase23-stt-command-"));
  const audioPath = join(dataRoot, "voice.ogg");
  const fakeCommand = join(dataRoot, "fake-stt.mjs");
  await writeFile(audioPath, "synthetic audio", "utf8");
  await writeFile(
    fakeCommand,
    `
      import { existsSync } from "node:fs";
      const audio = process.argv[2];
      console.log(JSON.stringify({
        text: existsSync(audio) ? "adapter transcript" : "",
        language: "en",
        confidence: 0.88,
        duration_ms: 900,
        model_name: "fake command model"
      }));
    `,
    "utf8"
  );

  const result = await transcribeAudioFile({
    audioPath,
    config: speechConfig(dataRoot, {
      command: process.execPath,
      commandArgs: [fakeCommand, "{audio}"],
      transcodeToWav: false
    })
  });

  assert.equal(result.text, "adapter transcript");
  assert.equal(result.language, "en");
  assert.equal(result.confidence, 0.88);
  assert.equal(result.durationMs, 900);
  assert.equal(result.modelName, "fake command model");
  assert.equal(result.metadata.command, "node");
});
