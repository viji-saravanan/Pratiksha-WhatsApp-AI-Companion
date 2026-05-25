import { getRuntimePaths } from "@viji/config";
import {
  getSpeechToTextConfigFromEnv,
  sanitizeReferenceText,
  transcribeAudioFile,
  type SpeechToTextConfig,
  type SpeechToTextResult
} from "@viji/ai";
import {
  createRepositories,
  withTransaction,
  type DbExecutor,
  type MessageMediaTranscriptRecord,
  type MessageMediaTranscriptionCandidateRecord
} from "@viji/db";
import { resolveResourcePathInsideRoot } from "@viji/resources";
import { ERROR_CODES, isVijiError, toErrorMessage } from "@viji/shared";

export interface AudioTranscriptionDrainConfig {
  enabled: boolean;
  limitPerCycle: number;
  minConfidence: number;
  modelName: string;
}

export interface TranscribeDownloadedAudioMediaInput {
  env?: NodeJS.ProcessEnv;
  speechToTextConfig?: SpeechToTextConfig;
  transcriber?: (input: {
    audioPath: string;
    config: SpeechToTextConfig;
  }) => Promise<SpeechToTextResult>;
}

export type TranscribeDownloadedAudioMediaResult =
  | {
      status: "transcribed" | "low_confidence" | "failed" | "unsupported";
      transcript: MessageMediaTranscriptRecord;
    }
  | { status: "existing"; transcript: MessageMediaTranscriptRecord }
  | { status: "disabled" }
  | { status: "not_found" };

export interface DrainAudioTranscriptionQueueResult {
  enabled: boolean;
  attempted: number;
  transcribed: number;
  lowConfidence: number;
  unsupported: number;
  failed: number;
  idle: boolean;
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function getAudioTranscriptionDrainConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env
): AudioTranscriptionDrainConfig {
  const speechConfig = getSpeechToTextConfigFromEnv(env);
  return {
    enabled: speechConfig.enabled,
    limitPerCycle: positiveInteger(
      env.VIJI_LIVE_AUDIO_TRANSCRIPTION_LIMIT_PER_CYCLE,
      2
    ),
    minConfidence: speechConfig.minConfidence,
    modelName: speechConfig.modelName
  };
}

function isAudioMedia(media: MessageMediaTranscriptionCandidateRecord): boolean {
  return (
    media.mimeType.toLowerCase().startsWith("audio/") ||
    media.assetMimeType.toLowerCase().startsWith("audio/")
  );
}

function transcriptBody(text: string): string {
  return `Voice note transcript: ${sanitizeReferenceText(text)}`;
}

async function recordTranscriptFailure(input: {
  db: DbExecutor;
  media: MessageMediaTranscriptionCandidateRecord;
  status: "failed" | "unsupported" | "low_confidence";
  errorCode: string;
  errorMessage?: string;
  text?: string | null;
  language?: string | null;
  confidence?: number | null;
  durationMs?: number | null;
  modelName?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<MessageMediaTranscriptRecord> {
  return withTransaction(input.db as Parameters<typeof withTransaction>[0], async (client) => {
    const repositories = createRepositories(client);
    const transcript = await repositories.messages.upsertMessageMediaTranscript({
      messageMediaId: input.media.messageMediaId,
      status: input.status,
      text: input.text ?? null,
      language: input.language ?? null,
      confidence: input.confidence ?? null,
      durationMs: input.durationMs ?? null,
      modelName: input.modelName ?? null,
      errorCode: input.errorCode,
      metadata: input.metadata ?? {}
    });
    await repositories.auditEvents.recordAuditEvent({
      type: "media.audio_transcription_degraded",
      severity: input.status === "failed" ? "error" : "warn",
      conversationId: input.media.conversationId,
      detail: {
        messageMediaId: input.media.messageMediaId,
        transcriptStatus: input.status,
        errorCode: input.errorCode,
        errorMessage: input.errorMessage
      }
    });

    return transcript;
  });
}

async function recordSuccessfulTranscript(input: {
  db: DbExecutor;
  media: MessageMediaTranscriptionCandidateRecord;
  result: SpeechToTextResult;
  status: "transcribed" | "low_confidence";
  errorCode?: string | null;
}): Promise<MessageMediaTranscriptRecord> {
  return withTransaction(input.db as Parameters<typeof withTransaction>[0], async (client) => {
    const repositories = createRepositories(client);
    const transcript = await repositories.messages.upsertMessageMediaTranscript({
      messageMediaId: input.media.messageMediaId,
      status: input.status,
      text: input.result.text || null,
      language: input.result.language,
      confidence: input.result.confidence,
      durationMs: input.result.durationMs,
      modelName: input.result.modelName,
      errorCode: input.errorCode ?? null,
      metadata: input.result.metadata
    });

    if (input.status === "transcribed") {
      await repositories.messages.applyTranscriptToInboundAudioMessage({
        messageMediaId: input.media.messageMediaId,
        transcriptText: transcriptBody(input.result.text)
      });
    }

    await repositories.auditEvents.recordAuditEvent({
      type:
        input.status === "transcribed"
          ? "media.audio_transcribed"
          : "media.audio_transcription_degraded",
      severity: input.status === "transcribed" ? "info" : "warn",
      conversationId: input.media.conversationId,
      detail: {
        messageMediaId: input.media.messageMediaId,
        transcriptStatus: input.status,
        confidence: input.result.confidence,
        modelName: input.result.modelName
      }
    });

    return transcript;
  });
}

export async function transcribeDownloadedAudioMedia(
  db: DbExecutor,
  messageMediaId: string,
  input: TranscribeDownloadedAudioMediaInput = {}
): Promise<TranscribeDownloadedAudioMediaResult> {
  const config = input.speechToTextConfig ?? getSpeechToTextConfigFromEnv(input.env);
  if (!config.enabled) {
    return { status: "disabled" };
  }

  const repositories = createRepositories(db);
  const existing = await repositories.messages.findMessageMediaTranscript(
    messageMediaId
  );
  if (existing && existing.status !== "pending") {
    return { status: "existing", transcript: existing };
  }

  const media = await repositories.messages.findMessageMediaForTranscription(
    messageMediaId
  );
  if (!media) {
    return { status: "not_found" };
  }

  if (!isAudioMedia(media)) {
    const transcript = await recordTranscriptFailure({
      db,
      media,
      status: "unsupported",
      errorCode: ERROR_CODES.adapter.unsupportedPayload,
      errorMessage: `Unsupported audio transcription MIME: ${media.mimeType}`
    });
    return { status: "unsupported", transcript };
  }

  await repositories.messages.upsertMessageMediaTranscript({
    messageMediaId,
    status: "pending",
    metadata: {
      modelName: config.modelName,
      minConfidence: config.minConfidence
    }
  });

  try {
    const paths = getRuntimePaths(input.env);
    const { fileRealPath } = await resolveResourcePathInsideRoot(
      paths.dataRoot,
      media.storageUri
    );
    const transcriber = input.transcriber ?? transcribeAudioFile;
    const result = await transcriber({
      audioPath: fileRealPath,
      config
    });
    const text = result.text.trim();
    const lowConfidence =
      !text ||
      (result.confidence !== null && result.confidence < config.minConfidence);
    const status = lowConfidence ? "low_confidence" : "transcribed";
    const transcript = await recordSuccessfulTranscript({
      db,
      media,
      result: {
        ...result,
        text
      },
      status,
      errorCode: lowConfidence ? ERROR_CODES.ai.promptRejected : null
    });

    return { status, transcript };
  } catch (error) {
    const errorCode = isVijiError(error)
      ? error.code
      : ERROR_CODES.ai.modelUnavailable;
    const transcript = await recordTranscriptFailure({
      db,
      media,
      status: "failed",
      errorCode,
      errorMessage: toErrorMessage(error)
    });

    return { status: "failed", transcript };
  }
}

export async function drainAudioTranscriptionQueue(
  db: DbExecutor,
  input: TranscribeDownloadedAudioMediaInput & { limitPerCycle?: number } = {}
): Promise<DrainAudioTranscriptionQueueResult> {
  const config = input.speechToTextConfig ?? getSpeechToTextConfigFromEnv(input.env);
  const limit = Math.min(Math.max(input.limitPerCycle ?? 2, 0), 10);
  const summary: DrainAudioTranscriptionQueueResult = {
    enabled: config.enabled,
    attempted: 0,
    transcribed: 0,
    lowConfidence: 0,
    unsupported: 0,
    failed: 0,
    idle: false
  };

  if (!config.enabled || limit === 0) {
    summary.idle = true;
    return summary;
  }

  const repositories = createRepositories(db);
  const candidates =
    await repositories.messages.findDownloadedAudioMediaForTranscription({
      limit
    });

  if (candidates.length === 0) {
    summary.idle = true;
    return summary;
  }

  for (const candidate of candidates) {
    const result = await transcribeDownloadedAudioMedia(
      db,
      candidate.messageMediaId,
      {
        ...input,
        speechToTextConfig: config
      }
    );
    if (result.status === "disabled" || result.status === "not_found") {
      continue;
    }
    if (result.status === "existing") {
      continue;
    }

    summary.attempted += 1;
    if (result.status === "transcribed") {
      summary.transcribed += 1;
    } else if (result.status === "low_confidence") {
      summary.lowConfidence += 1;
    } else if (result.status === "unsupported") {
      summary.unsupported += 1;
    } else {
      summary.failed += 1;
    }
  }

  summary.idle = candidates.length < limit;
  return summary;
}
