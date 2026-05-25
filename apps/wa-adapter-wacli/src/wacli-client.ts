import { spawn } from "node:child_process";
import {
  callFailure,
  callSuccess,
  ERROR_CODES,
  type ExternalCallMetadata,
  type ExternalCallResult
} from "@viji/shared";
import type {
  WhatsAppAdapter,
  WhatsAppAuthOptions,
  WhatsAppDownloadMediaOptions,
  WhatsAppDoctorOptions,
  WhatsAppListChatsOptions,
  WhatsAppListMessagesOptions,
  WhatsAppMarkReadOptions,
  WhatsAppSearchMessagesOptions,
  WhatsAppSendFileOptions,
  WhatsAppSendTextOptions,
  WhatsAppSyncOptions
} from "@viji/whatsapp";
import { getWacliAdapterConfig, type WacliAdapterConfig } from "./config.js";
import {
  classifyWacliFailureText,
  parseWacliAuthStatus,
  parseWacliChats,
  parseWacliDoctor,
  parseWacliJsonOutput,
  parseWacliMarkRead,
  parseWacliMediaDownload,
  parseWacliMessages,
  parseWacliSend,
  parseWacliSync
} from "./wacli-parsers.js";

export interface WacliProcessResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

export interface WacliProcessOptions {
  timeoutMs?: number;
}

export type WacliProcessRunner = (
  command: string,
  args: readonly string[],
  options?: WacliProcessOptions
) => Promise<WacliProcessResult>;

type Parser<TValue> = (payload: unknown) => TValue;

export function createWacliClient(
  configOverrides: Partial<WacliAdapterConfig> = {},
  runner: WacliProcessRunner = runWacliProcess
): WhatsAppAdapter {
  const config = resolveWacliConfig(configOverrides);

  return {
    doctor(options: WhatsAppDoctorOptions = {}) {
      return runWacliJson(
        config,
        ["doctor", ...(options.connect ? ["--connect"] : [])],
        "doctor",
        parseWacliDoctor,
        runner
      );
    },

    authStatus() {
      return runWacliJson(
        config,
        ["auth", "status"],
        "auth.status",
        parseWacliAuthStatus,
        runner
      );
    },

    auth(options: WhatsAppAuthOptions = {}) {
      return runWacliJson(
        config,
        ["auth", ...authSyncFlags(options)],
        "auth",
        parseWacliSync,
        runner
      );
    },

    sync(options: WhatsAppSyncOptions = {}) {
      return runWacliJson(
        {
          ...config,
          timeout: config.syncTimeout
        },
        ["sync", ...syncFlags(options)],
        "sync",
        parseWacliSync,
        runner
      );
    },

    listChats(options: WhatsAppListChatsOptions = {}) {
      const args = ["chats", "list"];
      pushOptionalFlag(args, "--query", options.query);
      pushOptionalNumberFlag(args, "--limit", options.limit);
      return runWacliJson(config, args, "chats.list", parseWacliChats, runner);
    },

    listMessages(options: WhatsAppListMessagesOptions = {}) {
      const args = ["messages", "list"];
      pushMessageWindowFlags(args, options);
      return runWacliJson(
        config,
        args,
        "messages.list",
        parseWacliMessages,
        runner
      );
    },

    searchMessages(options: WhatsAppSearchMessagesOptions) {
      const args = ["messages", "search", options.query];
      pushMessageWindowFlags(args, options);
      pushOptionalFlag(args, "--from", options.from);
      pushOptionalFlag(args, "--type", options.type);
      return runWacliJson(
        config,
        args,
        "messages.search",
        parseWacliMessages,
        runner
      );
    },

    sendText(options: WhatsAppSendTextOptions) {
      if (!config.liveSendEnabled) {
        return Promise.resolve(
          callFailure(
            ERROR_CODES.system.notImplemented,
            "Live wacli sends are disabled. Set VIJI_WACLI_LIVE_SEND_ENABLED=true only during an approved live-send run.",
            {
              component: "wa-adapter-wacli",
              operation: "send.text"
            }
          )
        );
      }

      return runWacliJson(
        config,
        ["send", "text", "--to", options.to, "--message", options.message],
        "send.text",
        parseWacliSend,
        runner
      );
    },

    sendFile(options: WhatsAppSendFileOptions) {
      if (!config.liveSendEnabled) {
        return Promise.resolve(
          callFailure(
            ERROR_CODES.system.notImplemented,
            "Live wacli file sends are disabled. Set VIJI_WACLI_LIVE_SEND_ENABLED=true only during an approved live-send run.",
            {
              component: "wa-adapter-wacli",
              operation: "send.file"
            }
          )
        );
      }

      const args = ["send", "file", "--to", options.to, "--file", options.filePath];
      pushOptionalFlag(args, "--caption", options.caption);
      pushOptionalFlag(args, "--filename", options.filename);
      pushOptionalFlag(args, "--mime", options.mime);
      return runWacliJson(config, args, "send.file", parseWacliSend, runner);
    },

    downloadMedia(options: WhatsAppDownloadMediaOptions) {
      const args = [
        "media",
        "download",
        "--chat",
        options.chatId,
        "--id",
        options.messageId
      ];
      pushOptionalFlag(args, "--output", options.output);
      return runWacliJson(
        config,
        args,
        "media.download",
        parseWacliMediaDownload,
        runner
      );
    },

    markRead(options: WhatsAppMarkReadOptions) {
      if (!config.markReadEnabled) {
        return Promise.resolve(
          callFailure(
            ERROR_CODES.system.notImplemented,
            "Live WhatsApp mark-read is disabled. Set VIJI_WACLI_MARK_READ_ENABLED=true to send read receipts after replies.",
            {
              component: "wa-adapter-wacli",
              operation: "messages.mark_read"
            }
          )
        );
      }

      const args = ["--chat", options.chatId];
      for (const messageId of options.messageIds) {
        pushOptionalFlag(args, "--id", messageId);
      }
      pushOptionalFlag(args, "--sender", options.senderId);
      pushOptionalFlag(args, "--timestamp", options.timestamp?.toISOString());
      return runWacliJson(
        {
          ...config,
          bin: config.markReadBin,
          timeout: config.markReadTimeout
        },
        args,
        "messages.mark_read",
        parseWacliMarkRead,
        runner
      );
    }
  };
}

export function buildWacliArgs(
  config: Pick<WacliAdapterConfig, "storePath" | "timeout">,
  commandArgs: readonly string[]
): string[] {
  return [
    ...commandArgs,
    "--json",
    "--store",
    config.storePath,
    "--timeout",
    config.timeout
  ];
}

export function resolveWacliConfig(
  overrides: Partial<WacliAdapterConfig> = {}
): WacliAdapterConfig {
  return {
    ...getWacliAdapterConfig(),
    ...overrides
  };
}

async function runWacliJson<TValue>(
  config: WacliAdapterConfig,
  commandArgs: readonly string[],
  operation: string,
  parser: Parser<TValue>,
  runner: WacliProcessRunner
): Promise<ExternalCallResult<TValue>> {
  const startedAt = Date.now();
  const metadata = {
    component: "wa-adapter-wacli",
    operation
  };
  const args = buildWacliArgs(config, commandArgs);
  const result = await runner(config.bin, args, {
    timeoutMs: parseWacliTimeoutMs(config.timeout)
  });
  const durationMs = Date.now() - startedAt;
  const callMetadata = { ...metadata, durationMs };

  if (result.exitCode !== 0) {
    return classifyWacliFailure(result.stderr || result.stdout, operation, callMetadata);
  }

  try {
    const parsed = parseWacliJsonOutput(result.stdout);
    const value = parser(parsed);
    return callSuccess(value, callMetadata);
  } catch (error) {
    return classifyWacliFailure(
      error instanceof Error ? error.message : String(error),
      operation,
      callMetadata,
      {
        stdoutPrefix: result.stdout.slice(0, 160),
        stderrPrefix: result.stderr.slice(0, 160)
      }
    );
  }
}

function classifyWacliFailure(
  output: string,
  operation: string,
  metadata: ExternalCallMetadata,
  details: Record<string, unknown> = {}
): ExternalCallResult<never> {
  const text = output || "wacli command failed";
  const classification = classifyWacliFailureText(text, operation);
  return callFailure(classification.code, text, metadata, {
    retryable: classification.retryable,
    details: {
      failureClass: classification.failureClass,
      ...details
    }
  });
}

function authSyncFlags(options: WhatsAppAuthOptions): string[] {
  const args: string[] = [];
  pushBooleanFlag(args, "--download-media", options.downloadMedia);
  pushBooleanFlag(args, "--follow", options.follow);
  pushOptionalFlag(args, "--idle-exit", options.idleExit);
  return args;
}

function syncFlags(options: WhatsAppSyncOptions): string[] {
  const args = authSyncFlags(options);
  pushBooleanFlag(args, "--once", options.once);
  pushBooleanFlag(args, "--refresh-contacts", options.refreshContacts);
  pushBooleanFlag(args, "--refresh-groups", options.refreshGroups);
  return args;
}

function pushMessageWindowFlags(
  args: string[],
  options: WhatsAppListMessagesOptions
): void {
  pushOptionalFlag(args, "--chat", options.chatId);
  pushOptionalNumberFlag(args, "--limit", options.limit);
  pushOptionalFlag(args, "--after", options.after);
  pushOptionalFlag(args, "--before", options.before);
}

function pushBooleanFlag(
  args: string[],
  flag: string,
  enabled: boolean | undefined
): void {
  if (enabled) {
    args.push(flag);
  }
}

function pushOptionalFlag(
  args: string[],
  flag: string,
  value: string | undefined
): void {
  if (value !== undefined && value !== "") {
    args.push(flag, value);
  }
}

function pushOptionalNumberFlag(
  args: string[],
  flag: string,
  value: number | undefined
): void {
  if (value !== undefined) {
    args.push(flag, String(value));
  }
}

export function parseWacliTimeoutMs(timeout: string): number | undefined {
  const trimmed = timeout.trim().toLowerCase();
  const match = trimmed.match(/^(\d+(?:\.\d+)?)(ms|s|m)?$/);
  if (!match) {
    return undefined;
  }

  const value = Number(match[1]);
  if (!Number.isFinite(value) || value <= 0) {
    return undefined;
  }

  const unit = match[2] ?? "s";
  const multiplier = unit === "ms" ? 1 : unit === "m" ? 60_000 : 1000;
  return Math.max(1, Math.floor(value * multiplier));
}

export function runWacliProcess(
  command: string,
  args: readonly string[],
  options: WacliProcessOptions = {}
): Promise<WacliProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let forceKillTimer: NodeJS.Timeout | undefined;
    const timeout =
      options.timeoutMs !== undefined
        ? setTimeout(() => {
            timedOut = true;
            stderr += `\nwacli parent timeout after ${options.timeoutMs}ms`;
            child.kill("SIGTERM");
            forceKillTimer = setTimeout(() => {
              if (child.exitCode === null) {
                child.kill("SIGKILL");
              }
            }, 500);
          }, options.timeoutMs)
        : undefined;

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      if (timeout) {
        clearTimeout(timeout);
      }
      if (forceKillTimer) {
        clearTimeout(forceKillTimer);
      }
      reject(error);
    });
    child.on("close", (exitCode) => {
      if (timeout) {
        clearTimeout(timeout);
      }
      if (forceKillTimer) {
        clearTimeout(forceKillTimer);
      }
      resolve({ exitCode: timedOut ? 124 : exitCode, stdout, stderr });
    });
  });
}
