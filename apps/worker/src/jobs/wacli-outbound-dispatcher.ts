import { existsSync } from "node:fs";
import type { DbExecutor } from "@viji/db";
import { createRepositories } from "@viji/db";
import {
  callFailure,
  callSuccess,
  ensureAssistantReplyPrefix,
  ERROR_CODES,
  toErrorDetails,
  type ExternalCallResult
} from "@viji/shared";
import type { WhatsAppAdapter } from "@viji/whatsapp";
import type {
  OutboundDispatcher,
  OutboundDispatchSuccess,
  OutboundSendIntent
} from "./outbound-dispatcher.interface.js";

function payloadString(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function externalMessageId(value: unknown): string | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  return typeof record.externalMessageId === "string"
    ? record.externalMessageId
    : null;
}

async function resolveReadReceiptTarget(input: {
  repositories: ReturnType<typeof createRepositories>;
  intent: OutboundSendIntent;
}): Promise<{ internalMessageId: string; externalMessageId: string } | null> {
  let triggerMessageId = payloadString(input.intent.payload, "confirmationMessageId");

  if (!triggerMessageId && input.intent.sourceDraftId) {
    const draft = await input.repositories.drafts.findDraftForOutbound(
      input.intent.sourceDraftId
    );
    triggerMessageId = draft?.triggerMessageId ?? null;
  }

  if (!triggerMessageId) {
    return null;
  }

  const message = await input.repositories.messages.findInboundMessageForDraft(
    triggerMessageId
  );
  if (!message) {
    return null;
  }

  return {
    internalMessageId: message.messageId,
    externalMessageId: message.externalMessageId
  };
}

async function markReadAfterSuccessfulDispatch(input: {
  repositories: ReturnType<typeof createRepositories>;
  adapter: WhatsAppAdapter;
  conversationId: string;
  conversationExternalChatId: string;
  conversationType: string;
  intent: OutboundSendIntent;
}): Promise<void> {
  if (!input.adapter.markRead || input.conversationType !== "dm") {
    return;
  }

  let target: { internalMessageId: string; externalMessageId: string } | null;
  try {
    target = await resolveReadReceiptTarget({
      repositories: input.repositories,
      intent: input.intent
    });
  } catch {
    return;
  }
  if (!target) {
    return;
  }

  const recordAudit = async (
    type: "whatsapp.mark_read_failed" | "whatsapp.mark_read_sent",
    severity: "info" | "warn",
    detail: Record<string, unknown>
  ): Promise<void> => {
    try {
      await input.repositories.auditEvents.recordAuditEvent({
        type,
        severity,
        conversationId: input.conversationId,
        detail
      });
    } catch {
      // Read receipts are a post-send courtesy. Audit failures must not turn a
      // successful external WhatsApp send into a failed outbound job.
    }
  };

  try {
    const result = await input.adapter.markRead({
      chatId: input.conversationExternalChatId,
      messageIds: [target.externalMessageId],
      timestamp: new Date()
    });

    if (!result.ok) {
      await recordAudit("whatsapp.mark_read_failed", "warn", {
        messageId: target.internalMessageId,
        code: result.code,
        retryable: result.retryable
      });
      return;
    }

    await recordAudit("whatsapp.mark_read_sent", "info", {
      messageId: target.internalMessageId
    });
  } catch (error) {
    await recordAudit("whatsapp.mark_read_failed", "warn", {
      messageId: target.internalMessageId,
      error: toErrorDetails(error)
    });
  }
}

export function createWacliOutboundDispatcher(
  db: DbExecutor,
  adapter: WhatsAppAdapter
): OutboundDispatcher {
  return {
    adapterType: "wacli",
    async dispatch(
      intent: OutboundSendIntent
    ): Promise<ExternalCallResult<OutboundDispatchSuccess>> {
      const repositories = createRepositories(db);
      const conversation = await repositories.conversations.findById(
        intent.conversationId
      );
      if (!conversation) {
        return callFailure(
          ERROR_CODES.system.invalidState,
          "Cannot dispatch outbound job because the conversation is missing.",
          {
            component: "worker",
            operation: "dispatch.wacli"
          },
          { retryable: false }
        );
      }

      if (intent.kind === "text_reply") {
        const message = payloadString(intent.payload, "text");
        if (!message) {
          return callFailure(
            ERROR_CODES.system.invalidState,
            "Cannot dispatch text reply without text payload.",
            {
              component: "worker",
              operation: "dispatch.wacli.text"
            },
            { retryable: false }
          );
        }

        const result = await adapter.sendText({
          to: conversation.externalChatId,
          message
        });
        if (!result.ok) {
          return result;
        }

        await markReadAfterSuccessfulDispatch({
          repositories,
          adapter,
          conversationId: conversation.conversationId,
          conversationExternalChatId: conversation.externalChatId,
          conversationType: conversation.type,
          intent
        });

        return callSuccess(
          { externalMessageId: externalMessageId(result.value) },
          result.metadata
        );
      }

      const resourceId = payloadString(intent.payload, "resourceId");
      if (!resourceId) {
        return callFailure(
          ERROR_CODES.system.invalidState,
          "Cannot dispatch resource send without resource id.",
          {
            component: "worker",
            operation: "dispatch.wacli.file"
          },
          { retryable: false }
        );
      }

      const resource = await repositories.resources.findFileResourceForSend(
        resourceId
      );
      if (!resource?.storageUri || !existsSync(resource.storageUri)) {
        return callFailure(
          ERROR_CODES.storage.writeUnavailable,
          "Cannot dispatch resource send because the registered file is unavailable.",
          {
            component: "worker",
            operation: "dispatch.wacli.file"
          },
          { retryable: false }
        );
      }

      const result = await adapter.sendFile({
        to: conversation.externalChatId,
        filePath: resource.storageUri,
        filename: resource.registeredFileName,
        mime: resource.mimeType ?? undefined,
        caption: ensureAssistantReplyPrefix("Sending the confirmed file.")
      });
      if (!result.ok) {
        return result;
      }

      await markReadAfterSuccessfulDispatch({
        repositories,
        adapter,
        conversationId: conversation.conversationId,
        conversationExternalChatId: conversation.externalChatId,
        conversationType: conversation.type,
        intent
      });

      return callSuccess(
        { externalMessageId: externalMessageId(result.value) },
        result.metadata
      );
    }
  };
}
