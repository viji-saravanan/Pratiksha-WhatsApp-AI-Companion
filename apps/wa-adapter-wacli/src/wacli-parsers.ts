import { ERROR_CODES, type ErrorCode } from "@viji/shared";
import {
  normalizeWacliMessagesFromJson,
  type WacliNormalizationBatch
} from "@viji/whatsapp";

export type WacliFailureClass =
  | "auth"
  | "network"
  | "backoff"
  | "send"
  | "store_lock"
  | "storage"
  | "unknown";

export interface WacliFailureClassification {
  failureClass: WacliFailureClass;
  code: ErrorCode;
  retryable: boolean;
}

export interface WacliDoctorResult {
  storeDir: string | null;
  authenticated: boolean;
  connected: boolean;
  lockHeld: boolean;
  ftsEnabled: boolean | null;
  raw: Record<string, unknown>;
}

export interface WacliAuthStatusResult {
  storeDir: string | null;
  authenticated: boolean;
  connected: boolean;
  raw: Record<string, unknown>;
}

export interface WacliSyncResult {
  state: string;
  messagesSeen: number | null;
  messagesImported: number | null;
  raw: Record<string, unknown>;
}

export interface WacliChatRecord {
  chatId: string;
  name: string | null;
  type: "dm" | "group" | "unknown";
  lastMessageAt: Date | null;
  raw: Record<string, unknown>;
}

export interface WacliSendResult {
  externalMessageId: string | null;
  chatId: string | null;
  sentAt: Date | null;
  raw: Record<string, unknown>;
}

export interface WacliMediaDownloadResult {
  chatId: string | null;
  messageId: string | null;
  outputPath: string | null;
  mime: string | null;
  sizeBytes: number | null;
  raw: Record<string, unknown>;
}

export interface WacliMarkReadResult {
  chatId: string | null;
  messageIds: string[];
  markedAt: Date | null;
  raw: Record<string, unknown>;
}

export function parseWacliJsonOutput(stdout: string): unknown {
  const text = stdout.trim();
  if (text === "") {
    return {};
  }

  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    const jsonFragment = extractFirstJsonValue(text);
    if (!jsonFragment) {
      throw error;
    }
    return JSON.parse(jsonFragment) as unknown;
  }
}

function extractFirstJsonValue(text: string): string | null {
  let start = -1;
  let depth = 0;
  let opening = "";
  let closing = "";
  let inString = false;
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (start === -1) {
      if (char === "{" || char === "[") {
        start = index;
        opening = char;
        closing = char === "{" ? "}" : "]";
        depth = 1;
      }
      continue;
    }

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }

    if (char === opening) {
      depth += 1;
    } else if (char === closing) {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, index + 1);
      }
    }
  }

  return null;
}

export function unwrapWacliEnvelope(payload: unknown): unknown {
  const envelope = toRecord(payload);
  if (!envelope || !("success" in envelope)) {
    return payload;
  }

  if (envelope.success === true) {
    return envelope.data ?? {};
  }

  throw new Error(envelopeErrorMessage(envelope));
}

export function parseWacliDoctor(payload: unknown): WacliDoctorResult {
  const data = toRecord(unwrapWacliEnvelope(payload)) ?? {};
  return {
    storeDir: firstString(data, ["store_dir", "storeDir", "StoreDir", "store"]),
    authenticated: firstBoolean(data, ["authenticated", "auth", "logged_in"]) ?? false,
    connected: firstBoolean(data, ["connected", "online"]) ?? false,
    lockHeld: firstBoolean(data, ["lock_held", "lockHeld", "locked"]) ?? false,
    ftsEnabled: firstBoolean(data, ["fts_enabled", "ftsEnabled"]),
    raw: data
  };
}

export function parseWacliAuthStatus(payload: unknown): WacliAuthStatusResult {
  const data = toRecord(unwrapWacliEnvelope(payload)) ?? {};
  return {
    storeDir: firstString(data, ["store_dir", "storeDir", "StoreDir", "store"]),
    authenticated: firstBoolean(data, ["authenticated", "auth", "logged_in"]) ?? false,
    connected: firstBoolean(data, ["connected", "online"]) ?? false,
    raw: data
  };
}

export function parseWacliSync(payload: unknown): WacliSyncResult {
  const data = toRecord(unwrapWacliEnvelope(payload)) ?? {};
  return {
    state: firstString(data, ["state", "status"]) ?? "completed",
    messagesSeen: firstNumber(data, [
      "messages_seen",
      "messagesSeen",
      "seen",
      "scanned"
    ]),
    messagesImported: firstNumber(data, [
      "messages_imported",
      "messagesImported",
      "imported",
      "inserted"
    ]),
    raw: data
  };
}

export function parseWacliChats(payload: unknown): WacliChatRecord[] {
  return extractArray(unwrapWacliEnvelope(payload), ["chats", "items", "rows"]).flatMap(
    (entry) => {
      const raw = toRecord(entry);
      if (!raw) {
        return [];
      }

      const chatId = firstString(raw, [
        "jid",
        "JID",
        "id",
        "ID",
        "chat_jid",
        "chatJid",
        "ChatJID"
      ]);
      if (!chatId) {
        return [];
      }

      return [
        {
          chatId,
          name: firstString(raw, [
            "name",
            "Name",
            "title",
            "Title",
            "chat_name",
            "chatName",
            "ChatName"
          ]),
          type: classifyChatType(chatId, raw),
          lastMessageAt: firstDate(raw, [
            "last_message_at",
            "lastMessageAt",
            "LastMessageTS",
            "updated_at",
            "updatedAt",
            "UpdatedAt"
          ]),
          raw
        }
      ];
    }
  );
}

export function parseWacliMessages(payload: unknown): WacliNormalizationBatch {
  return normalizeWacliMessagesFromJson(payload);
}

export function parseWacliSend(payload: unknown): WacliSendResult {
  const data = toRecord(unwrapWacliEnvelope(payload)) ?? {};
  return {
    externalMessageId: firstString(data, [
      "id",
      "message_id",
      "messageId",
      "external_message_id",
      "externalMessageId"
    ]),
    chatId: firstString(data, ["chat_jid", "chatJid", "chat_id", "chatId", "to"]),
    sentAt: firstDate(data, ["sent_at", "sentAt", "timestamp", "time"]),
    raw: data
  };
}

export function parseWacliMediaDownload(payload: unknown): WacliMediaDownloadResult {
  const data = toRecord(unwrapWacliEnvelope(payload)) ?? {};
  return {
    chatId: firstString(data, ["chat_jid", "chatJid", "chat_id", "chatId"]),
    messageId: firstString(data, [
      "id",
      "message_id",
      "messageId",
      "external_message_id",
      "externalMessageId"
    ]),
    outputPath: firstString(data, ["output", "output_path", "outputPath", "file"]),
    mime: firstString(data, ["mime", "mime_type", "mimeType"]),
    sizeBytes: firstNumber(data, ["size_bytes", "sizeBytes", "bytes", "size"]),
    raw: data
  };
}

export function parseWacliMarkRead(payload: unknown): WacliMarkReadResult {
  const data = toRecord(unwrapWacliEnvelope(payload)) ?? {};
  return {
    chatId: firstString(data, ["chat_id", "chatId", "chat_jid", "chatJid"]),
    messageIds: firstStringArray(data, ["message_ids", "messageIds", "ids"]),
    markedAt: firstDate(data, ["marked_at", "markedAt", "timestamp", "time"]),
    raw: data
  };
}

export function classifyWacliFailureText(
  output: string,
  operation = ""
): WacliFailureClassification {
  const normalized = `${operation}\n${output}`.toLowerCase();
  if (
    normalized.includes("auth") ||
    normalized.includes("login") ||
    normalized.includes("not logged") ||
    normalized.includes("qr")
  ) {
    return {
      failureClass: "auth",
      code: ERROR_CODES.adapter.authRequired,
      retryable: false
    };
  }
  if (
    normalized.includes("store lock") ||
    normalized.includes("database is locked") ||
    normalized.includes("lock held") ||
    normalized.includes("locked")
  ) {
    return {
      failureClass: "store_lock",
      code: ERROR_CODES.adapter.storeLocked,
      retryable: true
    };
  }
  if (
    normalized.includes("backoff") ||
    normalized.includes("rate limit") ||
    normalized.includes("too many")
  ) {
    return {
      failureClass: "backoff",
      code: ERROR_CODES.adapter.backoffActive,
      retryable: true
    };
  }
  if (
    normalized.includes("timeout") ||
    normalized.includes("network") ||
    normalized.includes("connection") ||
    normalized.includes("connect:") ||
    normalized.includes("i/o timeout")
  ) {
    return {
      failureClass: "network",
      code: ERROR_CODES.adapter.networkUnavailable,
      retryable: true
    };
  }
  if (
    normalized.includes("no such file") ||
    normalized.includes("permission denied") ||
    normalized.includes("disk") ||
    normalized.includes("read-only file system") ||
    normalized.includes("store dir")
  ) {
    return {
      failureClass: "storage",
      code: ERROR_CODES.adapter.storageUnavailable,
      retryable: false
    };
  }
  if (
    operation.includes("send") ||
    normalized.includes("send failed") ||
    normalized.includes("failed to send")
  ) {
    return {
      failureClass: "send",
      code: ERROR_CODES.adapter.sendFailed,
      retryable: true
    };
  }

  return {
    failureClass: "unknown",
    code: ERROR_CODES.adapter.unknown,
    retryable: true
  };
}

function envelopeErrorMessage(envelope: Record<string, unknown>): string {
  if (typeof envelope.error === "string") {
    return envelope.error;
  }
  const error = toRecord(envelope.error);
  if (typeof error?.message === "string") {
    return error.message;
  }
  return "wacli command failed";
}

function extractArray(payload: unknown, keys: readonly string[]): unknown[] {
  if (Array.isArray(payload)) {
    return payload;
  }
  const record = toRecord(payload);
  if (!record) {
    return [];
  }
  for (const key of keys) {
    const value = record[key];
    if (Array.isArray(value)) {
      return value;
    }
  }
  return [];
}

function classifyChatType(
  chatId: string,
  raw: Record<string, unknown>
): WacliChatRecord["type"] {
  const type = firstString(raw, [
    "type",
    "Type",
    "kind",
    "Kind",
    "chat_type",
    "chatType",
    "ChatType"
  ])?.toLowerCase();
  if (type === "dm" || type === "direct" || chatId.endsWith("@s.whatsapp.net")) {
    return "dm";
  }
  if (type === "group" || chatId.endsWith("@g.us")) {
    return "group";
  }
  return "unknown";
}

function firstString(
  record: Record<string, unknown>,
  keys: readonly string[]
): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }
  return null;
}

function firstStringArray(
  record: Record<string, unknown>,
  keys: readonly string[]
): string[] {
  for (const key of keys) {
    const value = record[key];
    if (Array.isArray(value)) {
      return value.filter((entry): entry is string => typeof entry === "string");
    }
    if (typeof value === "string" && value.trim()) {
      return value
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean);
    }
  }
  return [];
}

function firstBoolean(
  record: Record<string, unknown>,
  keys: readonly string[]
): boolean | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "boolean") {
      return value;
    }
  }
  return null;
}

function firstNumber(
  record: Record<string, unknown>,
  keys: readonly string[]
): number | null {
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

function firstDate(
  record: Record<string, unknown>,
  keys: readonly string[]
): Date | null {
  for (const key of keys) {
    const parsed = parseDate(record[key]);
    if (parsed) {
      return parsed;
    }
  }
  return null;
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

function toRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}
