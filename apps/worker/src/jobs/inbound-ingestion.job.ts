import type {
  AdapterEventRecord,
  AuditEventRecord,
  ContactRecord,
  ConversationRecord,
  DbExecutor,
  MediaDownloadJobRecord,
  MessageMediaRecord,
  MessageRecord
} from "@viji/db";
import { createRepositories } from "@viji/db";
import {
  redactWacliPayload,
  type NormalizedInboundMessage
} from "@viji/whatsapp";

export type IgnoredInboundReason =
  | "group"
  | "contact_not_allowlisted";

export type InboundIngestionResult =
  | {
      status: "inserted" | "existing";
      message: MessageRecord;
      messageMedia?: MessageMediaRecord;
      mediaDownloadJob?: MediaDownloadJobRecord;
      conversation: ConversationRecord;
      contact: ContactRecord;
      adapterEvent: AdapterEventRecord;
    }
  | {
      status: "ignored";
      reason: IgnoredInboundReason;
      duplicateEvent: boolean;
      adapterEvent: AdapterEventRecord;
      auditEvent?: AuditEventRecord;
    };

export interface IngestInboundMessagesInput {
  channelAccountId: string;
  messages: readonly NormalizedInboundMessage[];
  recoveredContextState?: ConversationRecord["contextState"];
}

export async function ingestNormalizedInboundMessages(
  db: DbExecutor,
  input: IngestInboundMessagesInput
): Promise<InboundIngestionResult[]> {
  const repositories = createRepositories(db);
  const results: InboundIngestionResult[] = [];

  for (const message of input.messages) {
    const adapterEvent = await repositories.adapterEvents.insertAdapterEventIdempotent({
      channelAccountId: input.channelAccountId,
      type: "message.received",
      externalEventId: message.externalEventId,
      payload: redactWacliPayload(message.raw)
    });

    if (message.conversationType === "group") {
      results.push(
        await ignored({
          reason: "group",
          message,
          adapterEvent: adapterEvent.event,
          duplicateEvent: adapterEvent.status === "existing",
          repositories
        })
      );
      continue;
    }

    const contact = await findAllowlistedContact(repositories, message);
    if (!contact) {
      results.push(
        await ignored({
          reason: "contact_not_allowlisted",
          message,
          adapterEvent: adapterEvent.event,
          duplicateEvent: adapterEvent.status === "existing",
          repositories
        })
      );
      continue;
    }

    const conversation = await repositories.conversations.upsertDirectConversation({
      channelAccountId: input.channelAccountId,
      primaryContactId: contact.contactId,
      externalChatId: message.externalChatId,
      title: message.conversationTitle,
      contextState: input.recoveredContextState ?? "fresh"
    });

    const storedMessage = message.fromMe
      ? await repositories.messages.insertOutboundMessageIdempotent({
          conversationId: conversation.conversationId,
          adapterEventId: adapterEvent.event.adapterEventId,
          externalMessageId: message.externalMessageId,
          replyToExternalMessageId: message.quotedExternalMessageId,
          adapterMetadata: messageAdapterMetadata(message),
          type: message.messageType,
          body: message.body,
          bodyRedacted: message.bodyRedacted,
          status: "sent",
          sentAt: message.receivedAt
        })
      : await repositories.messages.insertInboundMessageIdempotent({
          conversationId: conversation.conversationId,
          senderContactId: contact.contactId,
          adapterEventId: adapterEvent.event.adapterEventId,
          externalMessageId: message.externalMessageId,
          replyToExternalMessageId: message.quotedExternalMessageId,
          adapterMetadata: messageAdapterMetadata(message),
          type: message.messageType,
          body: message.body,
          bodyRedacted: message.bodyRedacted,
          receivedAt: message.receivedAt
        });

    if (message.quotedExternalMessageId) {
      await repositories.messages.linkReplyToExternalMessageId({
        messageId: storedMessage.message.messageId,
        conversationId: conversation.conversationId,
        replyToExternalMessageId: message.quotedExternalMessageId
      });
    }

    const queuedMedia =
      storedMessage.status === "inserted" && !message.fromMe && message.media
        ? await queueMessageMedia({
            repositories,
            message: storedMessage.message,
            normalized: message
          })
        : null;

    results.push({
      status: storedMessage.status,
      message: storedMessage.message,
      ...(queuedMedia
        ? {
            messageMedia: queuedMedia.messageMedia,
            mediaDownloadJob: queuedMedia.mediaDownloadJob
          }
        : {}),
      conversation,
      contact,
      adapterEvent: adapterEvent.event
    });
  }

  return results;
}

async function queueMessageMedia(input: {
  repositories: ReturnType<typeof createRepositories>;
  message: MessageRecord;
  normalized: NormalizedInboundMessage;
}): Promise<{
  messageMedia: MessageMediaRecord;
  mediaDownloadJob: MediaDownloadJobRecord;
}> {
  const media = input.normalized.media;
  if (!media) {
    throw new Error("Cannot queue missing media metadata");
  }

  const messageMedia = await input.repositories.messages.addMessageMedia({
    messageId: input.message.messageId,
    externalMediaId: media.externalMediaId,
    mimeType: media.mimeType,
    fileName: media.fileName,
    sizeBytes: media.sizeBytes,
    downloadState: "queued"
  });
  const mediaDownloadJob =
    await input.repositories.mediaJobs.createMediaDownloadJobIdempotent({
      messageMediaId: messageMedia.messageMediaId,
      conversationId: input.message.conversationId
    });

  await input.repositories.auditEvents.recordAuditEvent({
    type: "media.download_queued",
    severity: "info",
    conversationId: input.message.conversationId,
    detail: {
      messageMediaId: messageMedia.messageMediaId,
      mediaDownloadJobId: mediaDownloadJob.job.mediaDownloadJobId,
      queueStatus: mediaDownloadJob.status,
      mimeType: media.mimeType,
      hasFileName: Boolean(media.fileName),
      sizeBytes: media.sizeBytes
    }
  });

  return {
    messageMedia,
    mediaDownloadJob: mediaDownloadJob.job
  };
}

function messageAdapterMetadata(
  message: NormalizedInboundMessage
): Record<string, unknown> {
  return {
    ...(message.quotedExternalMessageId
      ? { quotedExternalMessageId: message.quotedExternalMessageId }
      : {}),
    ...(message.quotedParticipantWaJid ? { quotedParticipantWaJid: "[redacted-id]" } : {}),
    ...(message.media
      ? {
          media: {
            externalMediaId: message.media.externalMediaId ? "[redacted-id]" : null,
            mimeType: message.media.mimeType,
            fileName: message.media.fileName ? "[redacted-file-name]" : null,
            sizeBytes: message.media.sizeBytes
          }
        }
      : {})
  };
}

async function findAllowlistedContact(
  repositories: ReturnType<typeof createRepositories>,
  message: NormalizedInboundMessage
): Promise<ContactRecord | null> {
  const candidateJids = [message.senderWaJid, message.externalChatId].filter(
    (jid): jid is string => Boolean(jid)
  );

  for (const jid of candidateJids) {
    const contact = await repositories.contacts.findAllowlistedContactByWaJid(jid);
    if (contact) {
      return contact;
    }
  }

  const candidateNames = [
    message.senderDisplayName,
    message.conversationTitle
  ].filter((name): name is string => Boolean(name));

  for (const name of candidateNames) {
    const contact = await repositories.contacts.findAllowlistedContactByDisplayName(name);
    if (contact) {
      return contact;
    }
  }

  return null;
}

async function ignored(input: {
  reason: IgnoredInboundReason;
  message: NormalizedInboundMessage;
  adapterEvent: AdapterEventRecord;
  duplicateEvent: boolean;
  repositories: ReturnType<typeof createRepositories>;
}): Promise<InboundIngestionResult> {
  if (input.duplicateEvent) {
    return {
      status: "ignored",
      reason: input.reason,
      duplicateEvent: true,
      adapterEvent: input.adapterEvent
    };
  }

  const auditEvent = await input.repositories.auditEvents.recordAuditEvent({
    type: `adapter.message_ignored.${input.reason}`,
    severity: input.reason === "group" ? "info" : "warn",
    detail: {
      externalEventId: input.message.externalEventId,
      externalChatId: "[redacted-id]",
      senderWaJid: input.message.senderWaJid ? "[redacted-id]" : null,
      conversationType: input.message.conversationType,
      adapterPayload: redactWacliPayload(input.message.raw)
    }
  });

  return {
    status: "ignored",
    reason: input.reason,
    duplicateEvent: false,
    adapterEvent: input.adapterEvent,
    auditEvent
  };
}
