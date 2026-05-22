import type { ErrorCode } from "./error-codes.js";

export type ErrorDetails = Record<string, unknown>;

export interface VijiErrorOptions {
  code: ErrorCode;
  message: string;
  details?: ErrorDetails;
  cause?: unknown;
}

export class VijiError extends Error {
  readonly code: ErrorCode;
  readonly details?: ErrorDetails;

  constructor(options: VijiErrorOptions) {
    super(options.message, { cause: options.cause });
    this.name = "VijiError";
    this.code = options.code;
    this.details = options.details;
  }
}

export function isVijiError(error: unknown): error is VijiError {
  return error instanceof VijiError;
}

export function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  return "Unknown error";
}

export function toErrorDetails(error: unknown): ErrorDetails {
  if (isVijiError(error)) {
    return {
      code: error.code,
      message: error.message,
      ...(error.details ? { details: error.details } : {})
    };
  }

  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message
    };
  }

  return {
    message: toErrorMessage(error)
  };
}
