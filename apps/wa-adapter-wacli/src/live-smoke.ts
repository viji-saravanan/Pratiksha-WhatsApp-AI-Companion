import { createHash } from "node:crypto";
import type { ExternalCallFailure, ExternalCallResult } from "@viji/shared";
import type { NormalizedInboundMessage, WhatsAppAdapter } from "@viji/whatsapp";
import { getWacliAdapterConfig } from "./config.js";
import type { WacliAdapterConfig } from "./config.js";
import { createWacliClient } from "./wacli-client.js";
import type { WacliChatRecord } from "./wacli-parsers.js";

export type LiveDoctorSmokeResult =
  | { status: "skipped"; reason: string }
  | { status: "passed"; result: unknown }
  | { status: "failed"; result: unknown };

export type LiveSendSmokeResult = LiveDoctorSmokeResult;

export interface LiveReadSmokeSummary {
  query: string;
  chatMatches: number;
  targetMatched: boolean;
  selectedChatHash: string | null;
  selectedChatType: WacliChatRecord["type"] | null;
  messageSampleCount: number;
  inboundSampleCount: number;
  outboundSampleCount: number;
  latestMessageAt: string | null;
}

export type LiveReadSmokeResult =
  | { status: "skipped"; reason: string }
  | { status: "passed"; summary: LiveReadSmokeSummary }
  | { status: "failed"; result: SanitizedExternalCallFailure };

export interface LiveRecoverySmokeSummary extends LiveReadSmokeSummary {
  after: string | null;
}

export type LiveRecoverySmokeResult =
  | { status: "skipped"; reason: string }
  | { status: "passed"; summary: LiveRecoverySmokeSummary }
  | { status: "failed"; result: SanitizedExternalCallFailure };

export type WacliClientFactory = (config: WacliAdapterConfig) => WhatsAppAdapter;

export type SanitizedExternalCallFailure = Pick<
  ExternalCallFailure,
  "ok" | "code" | "retryable" | "metadata" | "details"
>;

export async function runLiveDoctorSmokeFromEnv(
  env: NodeJS.ProcessEnv = process.env
): Promise<LiveDoctorSmokeResult> {
  const config = getWacliAdapterConfig(env);
  if (!config.liveSmokeEnabled) {
    return {
      status: "skipped",
      reason: "Set VIJI_WACLI_LIVE_SMOKE_ENABLED=true to run live wacli checks."
    };
  }

  const result = await createWacliClient(config).doctor({ connect: false });
  if (result.ok) {
    return { status: "passed", result };
  }
  return { status: "failed", result };
}

export async function runLiveReadSmokeFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  createClient: WacliClientFactory = createWacliClient
): Promise<LiveReadSmokeResult> {
  const config = getWacliAdapterConfig(env);
  if (!config.liveReadSmokeEnabled) {
    return {
      status: "skipped",
      reason:
        "Set VIJI_WACLI_LIVE_READ_SMOKE_ENABLED=true to run redacted live read checks."
    };
  }

  const client = createClient(config);
  const summary = await buildReadSummary(config, client);
  if (!summary.ok) {
    return { status: "failed", result: summary.result };
  }
  return { status: "passed", summary: summary.value };
}

export async function runLiveRecoverySmokeFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  createClient: WacliClientFactory = createWacliClient
): Promise<LiveRecoverySmokeResult> {
  const config = getWacliAdapterConfig(env);
  if (!config.liveRecoverySmokeEnabled) {
    return {
      status: "skipped",
      reason:
        "Set VIJI_WACLI_LIVE_RECOVERY_SMOKE_ENABLED=true to run redacted live recovery checks."
    };
  }

  const client = createClient(config);
  const summary = await buildReadSummary(
    config,
    client,
    config.liveRecoverySmokeAfter || undefined
  );
  if (!summary.ok) {
    return { status: "failed", result: summary.result };
  }
  return {
    status: "passed",
    summary: {
      ...summary.value,
      after: config.liveRecoverySmokeAfter || null
    }
  };
}

type ReadSummaryResult =
  | { ok: true; value: LiveReadSmokeSummary }
  | { ok: false; result: SanitizedExternalCallFailure };

async function buildReadSummary(
  config: WacliAdapterConfig,
  client: WhatsAppAdapter,
  after?: string
): Promise<ReadSummaryResult> {
  const chatsResult = await client.listChats({
    query: config.liveReadSmokeQuery,
    limit: config.liveReadSmokeChatLimit
  });
  if (!chatsResult.ok) {
    return { ok: false, result: sanitizeFailure(chatsResult) };
  }

  const chats = asChatRecords(chatsResult.value);
  const selectedChat = chats.find((chat) => chat.type === "dm") ?? chats[0];
  if (!selectedChat) {
    return {
      ok: true,
      value: {
        query: config.liveReadSmokeQuery,
        chatMatches: 0,
        targetMatched: false,
        selectedChatHash: null,
        selectedChatType: null,
        messageSampleCount: 0,
        inboundSampleCount: 0,
        outboundSampleCount: 0,
        latestMessageAt: null
      }
    };
  }

  const messagesResult = await client.listMessages({
    chatId: selectedChat.chatId,
    after,
    limit: config.liveReadSmokeMessageLimit
  });
  if (!messagesResult.ok) {
    return { ok: false, result: sanitizeFailure(messagesResult) };
  }

  const messages = asMessages(messagesResult.value);
  return {
    ok: true,
    value: {
      query: config.liveReadSmokeQuery,
      chatMatches: chats.length,
      targetMatched: true,
      selectedChatHash: stableHash(selectedChat.chatId),
      selectedChatType: selectedChat.type,
      messageSampleCount: messages.length,
      inboundSampleCount: messages.filter((message) => !message.fromMe).length,
      outboundSampleCount: messages.filter((message) => message.fromMe).length,
      latestMessageAt: latestMessageTime(messages)
    }
  };
}

export async function runLiveSendSmokeFromEnv(
  env: NodeJS.ProcessEnv = process.env
): Promise<LiveSendSmokeResult> {
  const config = getWacliAdapterConfig(env);
  if (!config.liveSendSmokeEnabled) {
    return {
      status: "skipped",
      reason:
        "Set VIJI_WACLI_LIVE_SEND_SMOKE_ENABLED=true to run a live wacli send smoke test."
    };
  }
  if (!config.liveSendEnabled) {
    return {
      status: "skipped",
      reason:
        "Set VIJI_WACLI_LIVE_SEND_ENABLED=true together with the smoke flag to permit a live send."
    };
  }
  if (!config.liveSendSmokeTo) {
    return {
      status: "skipped",
      reason: "Set VIJI_WACLI_LIVE_SEND_SMOKE_TO to the explicit smoke-test recipient."
    };
  }

  const result = await createWacliClient(config).sendText({
    to: config.liveSendSmokeTo,
    message: config.liveSendSmokeMessage
  });
  if (result.ok) {
    return { status: "passed", result };
  }
  return { status: "failed", result };
}

function asChatRecords(value: unknown): WacliChatRecord[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(isChatRecord);
}

function isChatRecord(value: unknown): value is WacliChatRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Partial<WacliChatRecord>;
  return typeof record.chatId === "string" && typeof record.type === "string";
}

function asMessages(value: unknown): NormalizedInboundMessage[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return [];
  }
  const messages = (value as { messages?: unknown }).messages;
  if (!Array.isArray(messages)) {
    return [];
  }
  return messages.filter(isNormalizedMessage);
}

function isNormalizedMessage(value: unknown): value is NormalizedInboundMessage {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Partial<NormalizedInboundMessage>;
  return typeof record.externalMessageId === "string" && record.receivedAt instanceof Date;
}

function latestMessageTime(messages: NormalizedInboundMessage[]): string | null {
  const timestamps = messages
    .map((message) => message.receivedAt.getTime())
    .filter((timestamp) => Number.isFinite(timestamp));
  if (timestamps.length === 0) {
    return null;
  }
  return new Date(Math.max(...timestamps)).toISOString();
}

function stableHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

function sanitizeFailure(result: ExternalCallResult<unknown>): SanitizedExternalCallFailure {
  if (result.ok) {
    throw new Error("Cannot sanitize a successful external call as a failure.");
  }
  const failureClass =
    typeof result.details?.failureClass === "string"
      ? { failureClass: result.details.failureClass }
      : undefined;
  return {
    ok: false,
    code: result.code,
    retryable: result.retryable,
    metadata: result.metadata,
    ...(failureClass ? { details: failureClass } : {})
  };
}
