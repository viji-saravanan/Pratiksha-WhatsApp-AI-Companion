import { isVijiError, toErrorDetails, toErrorMessage } from "./errors.js";

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogContext = Record<string, unknown>;

export interface LogSink {
  write(line: string): void;
}

export interface AppLogger {
  debug(event: string, context?: LogContext): void;
  info(event: string, context?: LogContext): void;
  warn(event: string, context?: LogContext): void;
  error(event: string, error?: unknown, context?: LogContext): void;
}

const REDACTED = "[redacted]";
const SENSITIVE_KEY_PATTERN =
  /(authorization|bearer|cookie|credential|databaseurl|password|postgrespassword|qr|secret|session|token)/i;
const PRIVATE_CONTENT_KEYS = new Set([
  "body",
  "caption",
  "latestusermessage",
  "messagebody",
  "prompt",
  "rawpayload",
  "rawtext",
  "response",
  "text"
]);

const defaultSink: LogSink = {
  write(line: string): void {
    console.error(line);
  }
};

export function createJsonLogger(
  component: string,
  sink: LogSink = defaultSink
): AppLogger {
  return {
    debug(event, context) {
      writeLog(sink, "debug", component, event, context);
    },
    info(event, context) {
      writeLog(sink, "info", component, event, context);
    },
    warn(event, context) {
      writeLog(sink, "warn", component, event, context);
    },
    error(event, error, context) {
      writeLog(sink, "error", component, event, {
        ...context,
        error: toErrorDetails(error),
        errorMessage: toErrorMessage(error),
        ...(isVijiError(error) ? { errorCode: error.code } : {})
      });
    }
  };
}

function writeLog(
  sink: LogSink,
  level: LogLevel,
  component: string,
  event: string,
  context: LogContext = {}
): void {
  const record = {
    timestamp: new Date().toISOString(),
    level,
    component,
    event,
    ...redactLogContext(context)
  };

  sink.write(`${safeStringify(record)}\n`);
}

export function redactLogContext(context: LogContext = {}): LogContext {
  return redactValue(context, 0) as LogContext;
}

function redactValue(value: unknown, depth: number): unknown {
  if (depth > 8) {
    return "[redacted:depth]";
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, depth + 1));
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        key,
        shouldRedactKey(key) ? REDACTED : redactValue(entry, depth + 1)
      ])
    );
  }

  if (typeof value === "string") {
    return redactSensitiveString(value);
  }

  return value;
}

function shouldRedactKey(key: string): boolean {
  const normalized = key.replaceAll(/[^a-zA-Z0-9]/g, "").toLowerCase();
  return SENSITIVE_KEY_PATTERN.test(normalized) || PRIVATE_CONTENT_KEYS.has(normalized);
}

function redactSensitiveString(value: string): string {
  if (/^Bearer\s+\S+/i.test(value)) {
    return REDACTED;
  }

  if (/^\+\d{8,15}$/.test(value)) {
    return REDACTED;
  }

  return value.replace(
    /(postgres(?:ql)?:\/\/[^:\s]+:)([^@\s]+)(@)/gi,
    `$1${REDACTED}$3`
  );
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify({
      timestamp: new Date().toISOString(),
      level: "error",
      component: "logger",
      event: "log_serialization_failed"
    });
  }
}
