export type WhatsAppAdapterType = "wacli";

export type NormalizedConversationType = "dm" | "group";

export type NormalizedMessageType =
  | "text"
  | "image"
  | "video"
  | "audio"
  | "document"
  | "system";

export interface NormalizedMessageMedia {
  externalMediaId: string | null;
  mimeType: string;
  fileName: string | null;
  sizeBytes: number | null;
}

export interface NormalizedInboundMessage {
  adapterType: WhatsAppAdapterType;
  externalEventId: string;
  externalMessageId: string;
  externalChatId: string;
  conversationType: NormalizedConversationType;
  conversationTitle: string;
  senderDisplayName: string | null;
  senderWaJid: string | null;
  fromMe: boolean;
  quotedExternalMessageId: string | null;
  quotedParticipantWaJid: string | null;
  messageType: NormalizedMessageType;
  media: NormalizedMessageMedia | null;
  body: string | null;
  bodyRedacted: boolean;
  receivedAt: Date;
  raw: Record<string, unknown>;
}

export interface RejectedInboundPayload {
  reason:
    | "missing_message_id"
    | "missing_chat_id"
    | "unsupported_payload_shape";
  raw: Record<string, unknown>;
}
