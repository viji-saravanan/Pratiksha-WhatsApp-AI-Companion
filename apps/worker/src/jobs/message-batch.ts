import type { InboundIngestionResult } from "./inbound-ingestion.job.js";
import type {
  NormalizedInboundMessage,
  WacliNormalizationBatch
} from "@viji/whatsapp";

export function asNormalizationBatch(value: unknown): WacliNormalizationBatch {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Adapter did not return a normalization batch.");
  }

  const record = value as Partial<WacliNormalizationBatch>;
  if (!Array.isArray(record.messages) || !Array.isArray(record.rejected)) {
    throw new Error("Adapter normalization batch is missing messages or rejected.");
  }

  return {
    messages: record.messages,
    rejected: record.rejected
  };
}

export function countImportedMessages(
  results: readonly InboundIngestionResult[]
): number {
  return results.filter((result) => result.status === "inserted").length;
}

export function newestByReceivedAt(
  messages: readonly NormalizedInboundMessage[]
): NormalizedInboundMessage | null {
  return [...messages].sort(
    (left, right) => right.receivedAt.getTime() - left.receivedAt.getTime()
  )[0] ?? null;
}

export function oldestByReceivedAt(
  messages: readonly NormalizedInboundMessage[]
): NormalizedInboundMessage | null {
  return [...messages].sort(
    (left, right) => left.receivedAt.getTime() - right.receivedAt.getTime()
  )[0] ?? null;
}
