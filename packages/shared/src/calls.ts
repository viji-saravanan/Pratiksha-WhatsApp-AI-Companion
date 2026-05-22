import type { ErrorCode } from "./error-codes.js";
import type { ErrorDetails } from "./errors.js";

export interface ExternalCallMetadata {
  component: string;
  operation: string;
  durationMs?: number;
}

export interface ExternalCallSuccess<TValue> {
  ok: true;
  value: TValue;
  metadata: ExternalCallMetadata;
}

export interface ExternalCallFailure {
  ok: false;
  code: ErrorCode;
  message: string;
  retryable: boolean;
  metadata: ExternalCallMetadata;
  details?: ErrorDetails;
}

export type ExternalCallResult<TValue> =
  | ExternalCallSuccess<TValue>
  | ExternalCallFailure;

export function callSuccess<TValue>(
  value: TValue,
  metadata: ExternalCallMetadata
): ExternalCallSuccess<TValue> {
  return {
    ok: true,
    value,
    metadata
  };
}

export function callFailure(
  code: ErrorCode,
  message: string,
  metadata: ExternalCallMetadata,
  options: { retryable?: boolean; details?: ErrorDetails } = {}
): ExternalCallFailure {
  return {
    ok: false,
    code,
    message,
    retryable: options.retryable ?? false,
    metadata,
    ...(options.details ? { details: options.details } : {})
  };
}
