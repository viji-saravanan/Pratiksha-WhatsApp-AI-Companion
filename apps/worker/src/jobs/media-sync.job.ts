import { constants } from "node:fs";
import { access, mkdir, rm, stat } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { getRuntimePaths, getStorageProfile } from "@viji/config";
import {
  getDirectoryUsageBytes,
  getFilesystemAvailableBytes
} from "@viji/core";
import {
  createRepositories,
  withTransaction,
  type ClaimedMediaDownloadJobRecord,
  type DbExecutor,
  type FileResourceRecord,
  type MediaDownloadJobRecord,
  type MessageMediaPromotionRecord
} from "@viji/db";
import {
  hashFileSha256,
  resolveResourcePathInsideRoot
} from "@viji/resources";
import {
  ERROR_CODES,
  toErrorMessage,
  type ExternalCallResult
} from "@viji/shared";
import type { WhatsAppAdapter } from "@viji/whatsapp";

export type MediaStorageState =
  | "healthy"
  | "warning"
  | "critical"
  | "missing"
  | "unwritable";

export interface MediaStorageStatus {
  state: MediaStorageState;
  mediaRoot: string;
  usedBytes: number;
  freeBytes: number;
}

export interface DispatchNextMediaDownloadJobInput {
  adapter: Pick<WhatsAppAdapter, "downloadMedia">;
  env?: NodeJS.ProcessEnv;
  storageStateOverride?: MediaStorageState;
}

export interface MediaDrainConfig {
  enabled: boolean;
  limitPerCycle: number;
  autoPromote: boolean;
}

export interface DrainMediaDownloadQueueInput
  extends DispatchNextMediaDownloadJobInput {
  limitPerCycle?: number;
  autoPromote?: boolean;
}

export type DispatchNextMediaDownloadJobResult =
  | { status: "idle" }
  | {
      status: "blocked";
      job: MediaDownloadJobRecord;
      reason: string;
    }
  | {
      status: "downloaded";
      job: MediaDownloadJobRecord;
      fileAssetId: string;
    }
  | {
      status: "failed";
      job: MediaDownloadJobRecord;
      errorCode: string;
    };

export type PromoteDownloadedMessageMediaResult =
  | { status: "promoted"; resource: FileResourceRecord }
  | { status: "blocked"; reason: string };

export interface DrainMediaDownloadQueueResult {
  attempted: number;
  downloaded: number;
  promoted: number;
  blocked: number;
  failed: number;
  promotionBlocked: number;
  idle: boolean;
}

async function canAccess(path: string, mode: number): Promise<boolean> {
  try {
    await access(path, mode);
    return true;
  } catch {
    return false;
  }
}

export async function getMediaStorageStatus(
  env: NodeJS.ProcessEnv = process.env
): Promise<MediaStorageStatus> {
  const paths = getRuntimePaths(env);
  const profile = getStorageProfile(env.VIJI_STORAGE_PROFILE || "large-200gb");
  const dataRootAvailable = await canAccess(paths.dataRoot, constants.F_OK);
  const sentinelAvailable = await canAccess(
    `${paths.dataRoot}/${paths.sentinelFile}`,
    constants.R_OK | constants.W_OK
  );

  if (!dataRootAvailable) {
    return {
      state: "missing",
      mediaRoot: paths.wacliMedia,
      usedBytes: 0,
      freeBytes: 0
    };
  }

  if (!sentinelAvailable) {
    return {
      state: "unwritable",
      mediaRoot: paths.wacliMedia,
      usedBytes: 0,
      freeBytes: 0
    };
  }

  try {
    await mkdir(paths.wacliMedia, { recursive: true });
    await access(paths.wacliMedia, constants.R_OK | constants.W_OK);
  } catch {
    return {
      state: "unwritable",
      mediaRoot: paths.wacliMedia,
      usedBytes: 0,
      freeBytes: 0
    };
  }

  const usedBytes = await getDirectoryUsageBytes(paths.dataRoot);
  const freeBytes = await getFilesystemAvailableBytes(paths.dataRoot);
  const critical =
    usedBytes >= profile.criticalUsedBytes || freeBytes <= profile.criticalFreeBytes;
  const warning =
    usedBytes >= profile.warningUsedBytes || freeBytes <= profile.warningFreeBytes;

  return {
    state: critical ? "critical" : warning ? "warning" : "healthy",
    mediaRoot: paths.wacliMedia,
    usedBytes,
    freeBytes
  };
}

function storageBlockReason(state: MediaStorageState): string | null {
  if (state === "healthy") {
    return null;
  }

  return `storage_${state}`;
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function getMediaDrainConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env
): MediaDrainConfig {
  return {
    enabled: env.VIJI_LIVE_MEDIA_DRAIN_ENABLED !== "false",
    limitPerCycle: positiveInteger(env.VIJI_LIVE_MEDIA_DRAIN_LIMIT_PER_CYCLE, 3),
    autoPromote: env.VIJI_LIVE_MEDIA_AUTO_PROMOTE_ENABLED !== "false"
  };
}

async function cleanupPartialMediaDirectory(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true }).catch(() => undefined);
}

function stringField(record: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }

  return null;
}

function numberField(record: Record<string, unknown>, keys: readonly string[]): number | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }

  return null;
}

function mediaDownloadValue(value: unknown): {
  outputPath: string | null;
  mime: string | null;
  sizeBytes: number | null;
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      outputPath: null,
      mime: null,
      sizeBytes: null
    };
  }

  const record = value as Record<string, unknown>;
  return {
    outputPath: stringField(record, ["outputPath", "output_path", "output", "file"]),
    mime: stringField(record, ["mime", "mimeType", "mime_type"]),
    sizeBytes: numberField(record, ["sizeBytes", "size_bytes", "bytes", "size"])
  };
}

async function blockMediaJob(input: {
  db: DbExecutor;
  job: Pick<ClaimedMediaDownloadJobRecord, "mediaDownloadJobId" | "messageMediaId">;
  reason: string;
}): Promise<MediaDownloadJobRecord> {
  const repositories = createRepositories(input.db);
  const blockedJob = await repositories.mediaJobs.markMediaDownloadJobBlocked({
    mediaDownloadJobId: input.job.mediaDownloadJobId,
    blockedReason: input.reason
  });
  await repositories.messages.updateMessageMediaDownloadState({
    messageMediaId: input.job.messageMediaId,
    state: "blocked"
  });
  await repositories.auditEvents.recordAuditEvent({
    type: "media.download_blocked",
    severity: "warn",
    conversationId: blockedJob.conversationId,
    detail: {
      mediaDownloadJobId: blockedJob.mediaDownloadJobId,
      messageMediaId: blockedJob.messageMediaId,
      reason: input.reason
    }
  });

  return blockedJob;
}

async function failMediaJob(input: {
  db: DbExecutor;
  job: Pick<ClaimedMediaDownloadJobRecord, "mediaDownloadJobId" | "messageMediaId">;
  errorCode: string;
  errorMessage: string;
}): Promise<MediaDownloadJobRecord> {
  const repositories = createRepositories(input.db);
  const failedJob = await repositories.mediaJobs.markMediaDownloadJobFailed({
    mediaDownloadJobId: input.job.mediaDownloadJobId,
    errorCode: input.errorCode,
    errorMessage: input.errorMessage
  });
  await repositories.messages.updateMessageMediaDownloadState({
    messageMediaId: input.job.messageMediaId,
    state: "failed"
  });
  await repositories.auditEvents.recordAuditEvent({
    type: "media.download_failed",
    severity: "error",
    conversationId: failedJob.conversationId,
    detail: {
      mediaDownloadJobId: failedJob.mediaDownloadJobId,
      messageMediaId: failedJob.messageMediaId,
      errorCode: input.errorCode
    }
  });

  return failedJob;
}

async function completeMediaJob(input: {
  db: DbExecutor;
  job: ClaimedMediaDownloadJobRecord;
  download: {
    outputPath: string;
    mime: string;
    sizeBytes: number;
  };
  mediaRoot: string;
}): Promise<{ job: MediaDownloadJobRecord; fileAssetId: string }> {
  const { fileRealPath } = await resolveResourcePathInsideRoot(
    input.mediaRoot,
    input.download.outputPath
  );
  const fileStat = await stat(fileRealPath);

  if (!fileStat.isFile()) {
    throw new Error("downloaded media output is not a file");
  }

  return withTransaction(
    input.db as Parameters<typeof withTransaction>[0],
    async (client) => {
      const repositories = createRepositories(client);
      const fileAsset = await repositories.resources.upsertFileAsset({
        storageUri: fileRealPath,
        originalUri: `whatsapp://media/${input.job.messageMediaId}`,
        checksumSha256: await hashFileSha256(fileRealPath),
        mimeType: input.download.mime,
        sizeBytes: fileStat.size,
        storageState: "available"
      });
      await repositories.messages.linkMessageMediaFileAsset({
        messageMediaId: input.job.messageMediaId,
        fileAssetId: fileAsset.fileAssetId
      });
      const downloadedJob =
        await repositories.mediaJobs.markMediaDownloadJobDownloaded(
          input.job.mediaDownloadJobId
        );
      await repositories.auditEvents.recordAuditEvent({
        type: "media.downloaded",
        severity: "info",
        conversationId: input.job.conversationId,
        detail: {
          mediaDownloadJobId: downloadedJob.mediaDownloadJobId,
          messageMediaId: downloadedJob.messageMediaId,
          fileAssetId: fileAsset.fileAssetId,
          mimeType: input.download.mime,
          sizeBytes: fileStat.size
        }
      });

      return {
        job: downloadedJob,
        fileAssetId: fileAsset.fileAssetId
      };
    }
  );
}

export async function dispatchNextMediaDownloadJob(
  db: DbExecutor,
  input: DispatchNextMediaDownloadJobInput
): Promise<DispatchNextMediaDownloadJobResult> {
  const repositories = createRepositories(db);
  const claimedJob = await repositories.mediaJobs.claimNextQueuedMediaDownloadJob();

  if (!claimedJob) {
    return { status: "idle" };
  }

  const storageStatus = input.storageStateOverride
    ? {
        state: input.storageStateOverride,
        mediaRoot: getRuntimePaths(input.env).wacliMedia,
        usedBytes: 0,
        freeBytes: 0
      }
    : await getMediaStorageStatus(input.env);
  const blockReason = storageBlockReason(storageStatus.state);
  if (blockReason) {
    return {
      status: "blocked",
      job: await blockMediaJob({
        db,
        job: claimedJob,
        reason: blockReason
      }),
      reason: blockReason
    };
  }

  const jobOutputRoot = join(
    storageStatus.mediaRoot,
    "incoming",
    claimedJob.mediaDownloadJobId
  );
  await mkdir(jobOutputRoot, { recursive: true });

  const downloadResult = (await input.adapter.downloadMedia({
    chatId: claimedJob.externalChatId,
    messageId: claimedJob.externalMediaId ?? claimedJob.externalMessageId,
    output: jobOutputRoot
  })) as ExternalCallResult<unknown>;

  if (!downloadResult.ok) {
    await cleanupPartialMediaDirectory(jobOutputRoot);
    return {
      status: "failed",
      job: await failMediaJob({
        db,
        job: claimedJob,
        errorCode: downloadResult.code,
        errorMessage: downloadResult.message
      }),
      errorCode: downloadResult.code
    };
  }

  const parsedDownload = mediaDownloadValue(downloadResult.value);
  if (!parsedDownload.outputPath) {
    await cleanupPartialMediaDirectory(jobOutputRoot);
    return {
      status: "failed",
      job: await failMediaJob({
        db,
        job: claimedJob,
        errorCode: ERROR_CODES.adapter.unsupportedPayload,
        errorMessage: "media download result did not include an output path"
      }),
      errorCode: ERROR_CODES.adapter.unsupportedPayload
    };
  }

  try {
    const completed = await completeMediaJob({
      db,
      job: claimedJob,
      mediaRoot: storageStatus.mediaRoot,
      download: {
        outputPath: parsedDownload.outputPath,
        mime: parsedDownload.mime ?? claimedJob.mimeType,
        sizeBytes:
          parsedDownload.sizeBytes ??
          (claimedJob.sizeBytes ? Number(claimedJob.sizeBytes) : 0)
      }
    });

    return {
      status: "downloaded",
      job: completed.job,
      fileAssetId: completed.fileAssetId
    };
  } catch (error) {
    await cleanupPartialMediaDirectory(jobOutputRoot);
    const blockedJob = await blockMediaJob({
      db,
      job: claimedJob,
      reason: "media_path_invalid"
    });

    await repositories.auditEvents.recordAuditEvent({
      type: "media.download_path_rejected",
      severity: "error",
      conversationId: claimedJob.conversationId,
      detail: {
        mediaDownloadJobId: claimedJob.mediaDownloadJobId,
        messageMediaId: claimedJob.messageMediaId,
        error: toErrorMessage(error)
      }
    });

    return {
      status: "blocked",
      job: blockedJob,
      reason: "media_path_invalid"
    };
  }
}

export async function drainMediaDownloadQueue(
  db: DbExecutor,
  input: DrainMediaDownloadQueueInput
): Promise<DrainMediaDownloadQueueResult> {
  const limit = Math.min(Math.max(input.limitPerCycle ?? 3, 0), 25);
  const autoPromote = input.autoPromote ?? true;
  const summary: DrainMediaDownloadQueueResult = {
    attempted: 0,
    downloaded: 0,
    promoted: 0,
    blocked: 0,
    failed: 0,
    promotionBlocked: 0,
    idle: false
  };

  for (let index = 0; index < limit; index += 1) {
    const result = await dispatchNextMediaDownloadJob(db, input);
    if (result.status === "idle") {
      summary.idle = true;
      break;
    }

    summary.attempted += 1;

    if (result.status === "downloaded") {
      summary.downloaded += 1;
      if (autoPromote) {
        const promoted = await promoteDownloadedMessageMediaToResource(db, {
          messageMediaId: result.job.messageMediaId
        });
        if (promoted.status === "promoted") {
          summary.promoted += 1;
        } else {
          summary.promotionBlocked += 1;
        }
      }
      continue;
    }

    if (result.status === "blocked") {
      summary.blocked += 1;
      continue;
    }

    summary.failed += 1;
  }

  return summary;
}

function extensionFromMime(mimeType: string): string {
  if (mimeType === "image/jpeg") {
    return ".jpg";
  }
  if (mimeType === "image/png") {
    return ".png";
  }
  if (mimeType === "image/webp") {
    return ".webp";
  }
  if (mimeType === "application/pdf") {
    return ".pdf";
  }
  if (mimeType === "video/mp4") {
    return ".mp4";
  }
  if (mimeType === "audio/ogg") {
    return ".ogg";
  }

  return "";
}

function safeFileName(value: string): string {
  const cleaned = value
    .replace(/[/\\:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || "whatsapp-media";
}

function resourceFileName(media: MessageMediaPromotionRecord): string {
  const sourceName =
    media.fileName && media.fileName.trim()
      ? safeFileName(basename(media.fileName))
      : `whatsapp-media${extensionFromMime(media.mimeType)}`;
  const extension = extname(sourceName) || extensionFromMime(media.mimeType);
  const baseName = extname(sourceName)
    ? sourceName.slice(0, -extname(sourceName).length)
    : sourceName;
  const date = (media.receivedAt ?? new Date()).toISOString().slice(0, 10);
  const shortId = media.messageMediaId.replace(/-/g, "").slice(0, 8);

  return safeFileName(`received-${date}-${shortId}-${baseName}${extension}`);
}

function mediaResourceSummary(media: MessageMediaPromotionRecord): string {
  const receivedAt = media.receivedAt?.toISOString() ?? "unknown date";
  const senderLabel = media.senderDisplayName ?? "the WhatsApp requester";
  const parts = [
    `WhatsApp ${media.mimeType} received from ${senderLabel} on ${receivedAt}.`,
    media.fileName ? `Original filename: ${media.fileName}.` : "",
    media.messageBody ? `Caption: ${media.messageBody.slice(0, 500)}` : ""
  ].filter(Boolean);

  return parts.join(" ");
}

export async function promoteDownloadedMessageMediaToResource(
  db: DbExecutor,
  input: { messageMediaId: string }
): Promise<PromoteDownloadedMessageMediaResult> {
  const repositories = createRepositories(db);
  const media = await repositories.messages.findMessageMediaForPromotion(
    input.messageMediaId
  );

  if (!media) {
    return { status: "blocked", reason: "media_not_found" };
  }

  if (media.downloadState !== "downloaded" || !media.fileAssetId) {
    return { status: "blocked", reason: "media_not_downloaded" };
  }

  const registeredFileName = resourceFileName(media);
  const resource = await repositories.resources.createFileResourceForAsset({
    fileAssetId: media.fileAssetId,
    registeredFileName,
    title: media.fileName
      ? `Received ${media.fileName}`
      : `Received WhatsApp media ${registeredFileName}`,
    aliases: [
      registeredFileName,
      media.fileName ?? "",
      "received media",
      "whatsapp media",
      media.mimeType,
      media.messageBody ?? ""
    ].filter((value) => value.trim().length > 0),
    description: `Previously received WhatsApp media from ${
      media.senderDisplayName ?? "the requester"
    }.`,
    contentSummary: mediaResourceSummary(media),
    allowedContactIds: media.senderContactId ? [media.senderContactId] : null,
    requiresRecipientConfirmation: true,
    isActive: true
  });

  await repositories.auditEvents.recordAuditEvent({
    type: "media.promoted_to_resource",
    severity: "info",
    contactId: media.senderContactId,
    conversationId: media.conversationId,
    detail: {
      messageMediaId: media.messageMediaId,
      resourceId: resource.resourceId,
      registeredFileName: resource.registeredFileName
    }
  });

  return {
    status: "promoted",
    resource
  };
}
