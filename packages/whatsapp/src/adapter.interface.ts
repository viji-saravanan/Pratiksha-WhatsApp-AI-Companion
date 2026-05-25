import type { ExternalCallResult } from "@viji/shared";
import type { NormalizedInboundMessage } from "./types.js";

export interface WhatsAppDoctorOptions {
  connect?: boolean;
}

export interface WhatsAppAuthOptions {
  downloadMedia?: boolean;
  follow?: boolean;
  idleExit?: string;
}

export interface WhatsAppSyncOptions extends WhatsAppAuthOptions {
  once?: boolean;
  refreshContacts?: boolean;
  refreshGroups?: boolean;
}

export interface WhatsAppListMessagesOptions {
  chatId?: string;
  limit?: number;
  after?: string;
  before?: string;
}

export interface WhatsAppSearchMessagesOptions extends WhatsAppListMessagesOptions {
  query: string;
  from?: string;
  type?: "image" | "video" | "audio" | "document";
}

export interface WhatsAppListChatsOptions {
  limit?: number;
  query?: string;
}

export interface WhatsAppSendTextOptions {
  to: string;
  message: string;
}

export interface WhatsAppSendFileOptions {
  to: string;
  filePath: string;
  caption?: string;
  filename?: string;
  mime?: string;
}

export interface WhatsAppDownloadMediaOptions {
  chatId: string;
  messageId: string;
  output?: string;
}

export interface WhatsAppMarkReadOptions {
  chatId: string;
  messageIds: string[];
  senderId?: string;
  timestamp?: Date;
}

export interface WhatsAppAdapter {
  doctor(options?: WhatsAppDoctorOptions): Promise<ExternalCallResult<unknown>>;
  authStatus(): Promise<ExternalCallResult<unknown>>;
  auth(options?: WhatsAppAuthOptions): Promise<ExternalCallResult<unknown>>;
  sync(options?: WhatsAppSyncOptions): Promise<ExternalCallResult<unknown>>;
  listChats(options?: WhatsAppListChatsOptions): Promise<ExternalCallResult<unknown>>;
  listMessages(
    options?: WhatsAppListMessagesOptions
  ): Promise<ExternalCallResult<unknown>>;
  searchMessages(
    options: WhatsAppSearchMessagesOptions
  ): Promise<ExternalCallResult<unknown>>;
  sendText(options: WhatsAppSendTextOptions): Promise<ExternalCallResult<unknown>>;
  sendFile(options: WhatsAppSendFileOptions): Promise<ExternalCallResult<unknown>>;
  downloadMedia(
    options: WhatsAppDownloadMediaOptions
  ): Promise<ExternalCallResult<unknown>>;
  markRead?(options: WhatsAppMarkReadOptions): Promise<ExternalCallResult<unknown>>;
}

export type WhatsAppEventAdapterKind = "wacli" | "whatsmeow" | "baileys_bridge";

export type WhatsAppConnectionState =
  | "connecting"
  | "connected"
  | "disconnected"
  | "reconnecting"
  | "auth_required"
  | "degraded";

export type WhatsAppReceiptType =
  | "server_ack"
  | "delivered"
  | "read"
  | "played"
  | "deleted"
  | "unknown";

export type WhatsAppHistorySyncPhase =
  | "started"
  | "batch"
  | "idle"
  | "completed"
  | "failed";

export type WhatsAppMediaEventStatus =
  | "queued"
  | "available"
  | "downloaded"
  | "failed";

export interface WhatsAppEventEnvelopeBase {
  adapterKind: WhatsAppEventAdapterKind;
  eventId: string;
  occurredAt: Date;
  receivedAt: Date;
  externalChatId?: string;
  externalMessageId?: string;
  redacted: boolean;
  raw?: unknown;
}

export interface WhatsAppMessageEventEnvelope
  extends WhatsAppEventEnvelopeBase {
  eventType: "message";
  deliveryMode: "live" | "history" | "backfill";
  message: NormalizedInboundMessage;
}

export interface WhatsAppReceiptEventEnvelope
  extends WhatsAppEventEnvelopeBase {
  eventType: "receipt";
  receiptType: WhatsAppReceiptType;
  externalMessageIds: string[];
  participantWaJid?: string | null;
}

export interface WhatsAppMediaEventEnvelope extends WhatsAppEventEnvelopeBase {
  eventType: "media";
  mediaStatus: WhatsAppMediaEventStatus;
  mimeType?: string | null;
  filename?: string | null;
  sizeBytes?: number | null;
}

export interface WhatsAppConnectionEventEnvelope
  extends WhatsAppEventEnvelopeBase {
  eventType: "connection";
  connectionState: WhatsAppConnectionState;
  reason?: string;
}

export interface WhatsAppHistorySyncEventEnvelope
  extends WhatsAppEventEnvelopeBase {
  eventType: "history_sync";
  phase: WhatsAppHistorySyncPhase;
  messagesSeen?: number;
  messagesStored?: number;
}

export interface WhatsAppCallEventEnvelope extends WhatsAppEventEnvelopeBase {
  eventType: "call";
  callStatus: "offer" | "accept" | "reject" | "timeout" | "missed" | "unknown";
  participantWaJid?: string | null;
}

export interface WhatsAppAdapterErrorEventEnvelope
  extends WhatsAppEventEnvelopeBase {
  eventType: "adapter_error";
  retryable: boolean;
  errorCode: string;
  message: string;
}

export type WhatsAppEventEnvelope =
  | WhatsAppMessageEventEnvelope
  | WhatsAppReceiptEventEnvelope
  | WhatsAppMediaEventEnvelope
  | WhatsAppConnectionEventEnvelope
  | WhatsAppHistorySyncEventEnvelope
  | WhatsAppCallEventEnvelope
  | WhatsAppAdapterErrorEventEnvelope;

export interface WhatsAppEventStreamOptions {
  includeHistory?: boolean;
  downloadMedia?: boolean;
  maxReconnectMs?: number;
  signal?: AbortSignal;
}

export interface WhatsAppEventSubscription {
  stop(): Promise<void>;
  closed: Promise<ExternalCallResult<{ reason: string }>>;
}

export type WhatsAppEventHandler = (
  event: WhatsAppEventEnvelope
) => Promise<void> | void;

export interface WhatsAppStreamingAdapter extends WhatsAppAdapter {
  subscribeEvents(
    handler: WhatsAppEventHandler,
    options?: WhatsAppEventStreamOptions
  ): Promise<ExternalCallResult<WhatsAppEventSubscription>>;
}

export function hasWhatsAppEventStream(
  adapter: WhatsAppAdapter
): adapter is WhatsAppStreamingAdapter {
  return (
    typeof (adapter as Partial<WhatsAppStreamingAdapter>).subscribeEvents ===
    "function"
  );
}
