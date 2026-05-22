import type {
  NormalizedInboundMessage,
  NormalizedMessageMedia,
  NormalizedMessageType,
  RejectedInboundPayload
} from "./types.js";

export type WacliNormalizationResult =
  | { ok: true; message: NormalizedInboundMessage }
  | { ok: false; rejected: RejectedInboundPayload };

export interface WacliNormalizationBatch {
  messages: NormalizedInboundMessage[];
  rejected: RejectedInboundPayload[];
}

export function normalizeWacliMessagesFromJson(
  payload: unknown
): WacliNormalizationBatch {
  const messages: NormalizedInboundMessage[] = [];
  const rejected: RejectedInboundPayload[] = [];

  for (const entry of extractWacliMessageEntries(payload)) {
    const normalized = normalizeWacliMessage(entry);
    if (normalized.ok) {
      messages.push(normalized.message);
    } else {
      rejected.push(normalized.rejected);
    }
  }

  return { messages, rejected };
}

export function normalizeWacliMessage(payload: unknown): WacliNormalizationResult {
  const raw = toRecord(payload);
  if (!raw) {
    return rejected("unsupported_payload_shape", payload);
  }

  const externalMessageId = firstString(raw, [
    ["id"],
    ["ID"],
    ["message_id"],
    ["messageId"],
    ["MsgID"],
    ["external_message_id"],
    ["message", "id"],
    ["message", "messageId"]
  ]);
  if (!externalMessageId) {
    return rejected("missing_message_id", raw);
  }

  const externalChatId = firstString(raw, [
    ["chat_jid"],
    ["chatJid"],
    ["ChatJID"],
    ["chat_id"],
    ["chatId"],
    ["chat", "jid"],
    ["chat", "id"],
    ["key", "remoteJid"]
  ]);
  if (!externalChatId) {
    return rejected("missing_chat_id", raw);
  }

  const senderWaJid = firstString(raw, [
    ["sender_jid"],
    ["senderJid"],
    ["SenderJID"],
    ["sender", "jid"],
    ["from"],
    ["participant"],
    ["key", "participant"]
  ]);
  const senderDisplayName =
    firstString(raw, [
      ["sender_name"],
      ["senderName"],
      ["push_name"],
      ["pushName"],
      ["sender", "name"],
      ["contact", "name"]
    ]) ?? null;
  const conversationTitle =
    firstString(raw, [
      ["chat_name"],
      ["chatName"],
      ["ChatName"],
      ["chat_title"],
      ["chatTitle"],
      ["chat", "name"],
      ["chat", "title"]
    ]) ??
    senderDisplayName ??
    externalChatId;
  const fromMe =
    firstBoolean(raw, [
      ["from_me"],
      ["fromMe"],
      ["FromMe"],
      ["is_from_me"],
      ["isFromMe"],
      ["key", "fromMe"]
    ]) ?? false;
  const quotedExternalMessageId = firstString(raw, [
    ["quoted_message_id"],
    ["quotedMessageId"],
    ["quoted_msg_id"],
    ["quotedMsgId"],
    ["quoted", "id"],
    ["quoted", "messageId"],
    ["quotedMessage", "id"],
    ["quotedMessage", "messageId"],
    ["reply_to_message_id"],
    ["replyToMessageId"],
    ["contextInfo", "stanzaId"],
    ["message", "contextInfo", "stanzaId"],
    ["message", "extendedTextMessage", "contextInfo", "stanzaId"],
    ["message", "imageMessage", "contextInfo", "stanzaId"],
    ["message", "videoMessage", "contextInfo", "stanzaId"],
    ["message", "documentMessage", "contextInfo", "stanzaId"],
    ["message", "audioMessage", "contextInfo", "stanzaId"]
  ]);
  const quotedParticipantWaJid = firstString(raw, [
    ["quoted_participant"],
    ["quotedParticipant"],
    ["quoted_sender_jid"],
    ["quotedSenderJid"],
    ["quoted", "participant"],
    ["quoted", "senderJid"],
    ["quotedMessage", "participant"],
    ["contextInfo", "participant"],
    ["message", "contextInfo", "participant"],
    ["message", "extendedTextMessage", "contextInfo", "participant"],
    ["message", "imageMessage", "contextInfo", "participant"],
    ["message", "videoMessage", "contextInfo", "participant"],
    ["message", "documentMessage", "contextInfo", "participant"],
    ["message", "audioMessage", "contextInfo", "participant"]
  ]);
  const isGroup =
    firstBoolean(raw, [
      ["is_group"],
      ["isGroup"],
      ["chat", "isGroup"]
    ]) ?? externalChatId.endsWith("@g.us");
  const body =
    firstString(raw, [
      ["text"],
      ["Text"],
      ["DisplayText"],
      ["Snippet"],
      ["body"],
      ["message"],
      ["content"],
      ["caption"],
      ["message", "text"],
      ["message", "body"],
      ["message", "conversation"],
      ["message", "caption"],
      ["message", "imageMessage", "caption"],
      ["message", "videoMessage", "caption"],
      ["message", "documentMessage", "caption"]
    ]) ?? null;
  const messageType = normalizeMessageType(
    firstString(raw, [
      ["type"],
      ["message_type"],
      ["messageType"],
      ["MediaType"],
      ["media_type"],
      ["mediaType"],
      ["message", "type"],
      ["message", "imageMessage", "mimetype"],
      ["message", "videoMessage", "mimetype"],
      ["message", "audioMessage", "mimetype"],
      ["message", "documentMessage", "mimetype"]
    ]),
    body
  );
  const media = normalizeMessageMedia(raw, messageType, externalMessageId);

  return {
    ok: true,
    message: {
      adapterType: "wacli",
      externalEventId: `wacli:${externalChatId}:${externalMessageId}`,
      externalMessageId,
      externalChatId,
      conversationType: isGroup ? "group" : "dm",
      conversationTitle,
      senderDisplayName,
      senderWaJid,
      fromMe,
      quotedExternalMessageId,
      quotedParticipantWaJid,
      messageType,
      media,
      body,
      bodyRedacted: false,
      receivedAt: firstDate(raw, [
        ["timestamp"],
        ["Timestamp"],
        ["time"],
        ["date"],
        ["received_at"],
        ["receivedAt"],
        ["message", "timestamp"]
      ]),
      raw
    }
  };
}

export function extractWacliMessageEntries(payload: unknown): unknown[] {
  if (Array.isArray(payload)) {
    return payload;
  }

  const root = toRecord(payload);
  if (!root) {
    return [payload];
  }

  const rootMessages = root.messages;
  if (Array.isArray(rootMessages)) {
    return rootMessages;
  }

  const data = toRecord(root.data);
  if (Array.isArray(root.data)) {
    return root.data;
  }
  if (data && Array.isArray(data.messages)) {
    return data.messages;
  }

  return [payload];
}

function rejected(
  reason: RejectedInboundPayload["reason"],
  payload: unknown
): WacliNormalizationResult {
  return {
    ok: false,
    rejected: {
      reason,
      raw: toRecord(payload) ?? { value: String(payload) }
    }
  };
}

function normalizeMessageType(
  rawType: string | null,
  body: string | null
): NormalizedMessageType {
  const type = rawType?.toLowerCase() ?? "";
  if (type.includes("image")) {
    return "image";
  }
  if (type.includes("video")) {
    return "video";
  }
  if (type.includes("audio") || type.includes("voice")) {
    return "audio";
  }
  if (type.includes("document") || type.includes("file")) {
    return "document";
  }
  if (type.includes("system")) {
    return "system";
  }
  return body ? "text" : "system";
}

function normalizeMessageMedia(
  raw: Record<string, unknown>,
  messageType: NormalizedMessageType,
  externalMessageId: string
): NormalizedMessageMedia | null {
  if (
    messageType !== "image" &&
    messageType !== "video" &&
    messageType !== "audio" &&
    messageType !== "document"
  ) {
    return null;
  }

  const mimeType =
    firstString(raw, [
      ["mime"],
      ["mime_type"],
      ["mimeType"],
      ["mimetype"],
      ["media", "mime"],
      ["media", "mime_type"],
      ["media", "mimeType"],
      ["message", "imageMessage", "mimetype"],
      ["message", "videoMessage", "mimetype"],
      ["message", "audioMessage", "mimetype"],
      ["message", "documentMessage", "mimetype"]
    ]) ?? defaultMimeType(messageType);

  return {
    externalMediaId:
      firstString(raw, [
        ["media_id"],
        ["mediaId"],
        ["external_media_id"],
        ["externalMediaId"],
        ["media", "id"],
        ["message", "mediaId"],
        ["message", "imageMessage", "id"],
        ["message", "videoMessage", "id"],
        ["message", "audioMessage", "id"],
        ["message", "documentMessage", "id"]
      ]) ?? externalMessageId,
    mimeType,
    fileName: firstString(raw, [
      ["file_name"],
      ["fileName"],
      ["filename"],
      ["media", "fileName"],
      ["media", "filename"],
      ["message", "fileName"],
      ["message", "documentMessage", "fileName"],
      ["message", "imageMessage", "fileName"],
      ["message", "videoMessage", "fileName"],
      ["message", "audioMessage", "fileName"]
    ]),
    sizeBytes: firstNumber(raw, [
      ["size_bytes"],
      ["sizeBytes"],
      ["bytes"],
      ["size"],
      ["file_length"],
      ["fileLength"],
      ["media", "sizeBytes"],
      ["media", "fileLength"],
      ["message", "fileLength"],
      ["message", "imageMessage", "fileLength"],
      ["message", "videoMessage", "fileLength"],
      ["message", "audioMessage", "fileLength"],
      ["message", "documentMessage", "fileLength"]
    ])
  };
}

function defaultMimeType(messageType: NormalizedMessageType): string {
  if (messageType === "image") {
    return "image/jpeg";
  }
  if (messageType === "video") {
    return "video/mp4";
  }
  if (messageType === "audio") {
    return "audio/ogg";
  }
  return "application/octet-stream";
}

function firstString(
  record: Record<string, unknown>,
  paths: readonly (readonly string[])[]
): string | null {
  for (const path of paths) {
    const value = getPath(record, path);
    if (typeof value === "string" && value.trim()) {
      return value;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }
  return null;
}

function firstBoolean(
  record: Record<string, unknown>,
  paths: readonly (readonly string[])[]
): boolean | null {
  for (const path of paths) {
    const value = getPath(record, path);
    if (typeof value === "boolean") {
      return value;
    }
  }
  return null;
}

function firstNumber(
  record: Record<string, unknown>,
  paths: readonly (readonly string[])[]
): number | null {
  for (const path of paths) {
    const value = getPath(record, path);
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "bigint") {
      return Number(value);
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

function firstDate(
  record: Record<string, unknown>,
  paths: readonly (readonly string[])[]
): Date {
  for (const path of paths) {
    const value = getPath(record, path);
    const parsed = parseDate(value);
    if (parsed) {
      return parsed;
    }
  }
  return new Date();
}

function parseDate(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const milliseconds = value < 10_000_000_000 ? value * 1000 : value;
    const date = new Date(milliseconds);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value === "string" && value.trim()) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return parseDate(numeric);
    }
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

function getPath(
  record: Record<string, unknown>,
  path: readonly string[]
): unknown {
  let current: unknown = record;
  for (const key of path) {
    const currentRecord = toRecord(current);
    if (!currentRecord || !(key in currentRecord)) {
      return undefined;
    }
    current = currentRecord[key];
  }
  return current;
}

function toRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}
