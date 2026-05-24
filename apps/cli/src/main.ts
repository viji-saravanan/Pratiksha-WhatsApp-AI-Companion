#!/usr/bin/env node
import {
  createDockerContainerLogsReader,
  getContainerLogsConfigFromEnv,
  isDirectNodeEntrypoint,
  toErrorMessage,
  type ContainerLogsReader,
  type ContainerLogsSnapshot
} from "@viji/shared";
import { createCliApiClient, type CliApiClient } from "./api-client.js";
import { processOutput, writeJson, type CliOutput } from "./output.js";

export interface RunCliOptions {
  env?: NodeJS.ProcessEnv;
  output?: CliOutput;
  apiClient?: CliApiClient;
  containerLogsReader?: ContainerLogsReader;
}

function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}

function requireYes(args: string[]): void {
  if (!hasFlag(args, "--yes")) {
    throw new Error("This command changes local state. Re-run with --yes.");
  }
}

function shouldWriteJson(args: string[]): boolean {
  return hasFlag(args, "--json");
}

function flagValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) {
    return undefined;
  }

  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }

  return value;
}

function flagValues(args: string[], flag: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === flag) {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`${flag} requires a value`);
      }
      values.push(value);
      index += 1;
    }
  }

  return values;
}

function parseTailFlag(args: string[], defaultTail: number): number {
  const raw = flagValue(args, "--tail");
  if (!raw) {
    return defaultTail;
  }

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 1000) {
    throw new Error("--tail must be an integer from 1 to 1000");
  }

  return parsed;
}

function humanStatus(status: Record<string, unknown>): string {
  const storage = status.storage as { state?: string } | undefined;
  const database = status.database;
  const counts = status.counts as Record<string, unknown> | undefined;
  const contextStates = status.contextStates as Record<string, unknown> | undefined;
  const live = status.live as Record<string, unknown> | undefined;

  return [
    `database: ${String(database)}`,
    `storage: ${storage?.state ?? "unknown"}`,
    `live poll interval: ${String(live?.pollIntervalMs ?? "unknown")}ms`,
    `live sync: ${live?.syncSchedulerEnabled === false ? "disabled" : "scheduled"}${
      live?.syncBeforePollEnabled === true ? " + forced-before-poll" : ""
    }`,
    `live sync interval: ${String(live?.syncIntervalMs ?? "unknown")}ms`,
    `conversations: ${String(counts?.conversations ?? 0)}`,
    `pending confirmations: ${String(counts?.pendingConfirmations ?? 0)}`,
    `blocked jobs: ${String(counts?.blockedJobs ?? 0)}`,
    `context states: ${JSON.stringify(contextStates ?? {})}`
  ].join("\n");
}

function humanContainerLogs(snapshot: ContainerLogsSnapshot): string {
  if (!snapshot.enabled) {
    return snapshot.unavailableReason ?? "Container logs are disabled.";
  }

  if (snapshot.unavailableReason) {
    return snapshot.unavailableReason;
  }

  const services = snapshot.services
    .map((service) => `${service.service}: ${service.state} (${service.status})`)
    .join("\n");
  const header = [
    `project: ${snapshot.project}`,
    `selected service: ${snapshot.selectedService}`,
    `tail: ${snapshot.tail}`,
    services ? `services:\n${services}` : "services: none"
  ].join("\n");

  return `${header}\n\n${snapshot.rawText || "(no recent logs)"}`;
}

function humanResources(payload: Record<string, unknown>): string {
  const resources = Array.isArray(payload.resources) ? payload.resources : [];
  if (resources.length === 0) {
    return "registered resources: 0";
  }

  return [
    `registered resources: ${resources.length}`,
    ...resources.map((resource, index) => {
      const item = resource as { registeredFileName?: string; title?: string };
      return `${index + 1}. ${item.registeredFileName ?? "unknown"} - ${
        item.title ?? "untitled"
      }`;
    })
  ].join("\n");
}

async function writePayload(
  output: CliOutput,
  args: string[],
  payload: unknown,
  humanText?: string
): Promise<void> {
  if (shouldWriteJson(args)) {
    writeJson(output, payload);
    return;
  }

  output.write(`${humanText ?? JSON.stringify(payload, null, 2)}\n`);
}

export async function runCli(
  argv: string[] = process.argv.slice(2),
  options: RunCliOptions = {}
): Promise<number> {
  const output = options.output ?? processOutput;
  const apiClient = options.apiClient ?? createCliApiClient(options.env);
  const [command, subcommand] = argv;

  try {
    if (!command || command === "help" || command === "--help") {
      output.write(
        [
          "Usage:",
          "  viji status [--json]",
          "  viji pause --yes [--json]",
          "  viji resume --yes [--json]",
          "  viji readonly on|off --yes [--json]",
          "  viji storage status [--json]",
          "  viji sync status [--json]",
          "  viji backfill status [--json]",
          "  viji drafts [--json]",
          "  viji confirmations [--json]",
          "  viji resources list [--json]",
          "  viji resources index --yes [--scope inbox|library|staged] [--json]",
          "  viji resources register <path> --yes [--title <title>] [--alias <alias>] [--json]",
          "  viji logs containers [--service <service>|all] [--tail <lines>] [--json]",
          "  viji audit [--json]"
        ].join("\n") + "\n"
      );
      return 0;
    }

    if (command === "status") {
      const status = await apiClient.get<Record<string, unknown>>("/status");
      await writePayload(output, argv, status, humanStatus(status));
      return 0;
    }

    if (command === "pause") {
      requireYes(argv);
      const result = await apiClient.post<Record<string, unknown>>("/policy/mode", {
        mode: "paused"
      });
      await writePayload(output, argv, result, "paused allowlisted conversations");
      return 0;
    }

    if (command === "resume") {
      requireYes(argv);
      const result = await apiClient.post<Record<string, unknown>>("/policy/mode", {
        mode: "auto"
      });
      await writePayload(output, argv, result, "resumed allowlisted conversations");
      return 0;
    }

    if (command === "readonly") {
      requireYes(argv);
      if (subcommand !== "on" && subcommand !== "off") {
        throw new Error("readonly requires on or off");
      }
      const result = await apiClient.post<Record<string, unknown>>("/policy/mode", {
        mode: subcommand === "on" ? "readonly" : "auto"
      });
      await writePayload(
        output,
        argv,
        result,
        `readonly ${subcommand === "on" ? "enabled" : "disabled"}`
      );
      return 0;
    }

    if (command === "storage" && subcommand === "status") {
      const result = await apiClient.get<Record<string, unknown>>("/storage/status");
      await writePayload(output, argv, result);
      return 0;
    }

    if (command === "sync" && subcommand === "status") {
      const result = await apiClient.get<Record<string, unknown>>("/sync/status");
      await writePayload(output, argv, result);
      return 0;
    }

    if (command === "backfill" && subcommand === "status") {
      const result = await apiClient.get<Record<string, unknown>>("/backfill/status");
      await writePayload(output, argv, result);
      return 0;
    }

    if (command === "drafts") {
      const result = await apiClient.get<Record<string, unknown>>("/drafts");
      await writePayload(output, argv, result);
      return 0;
    }

    if (command === "confirmations") {
      const result = await apiClient.get<Record<string, unknown>>("/confirmations");
      await writePayload(output, argv, result);
      return 0;
    }

    if (command === "resources" && subcommand === "list") {
      const result = await apiClient.get<Record<string, unknown>>("/resources");
      await writePayload(output, argv, result, humanResources(result));
      return 0;
    }

    if (command === "resources" && subcommand === "index") {
      requireYes(argv);
      const scope = flagValue(argv, "--scope");
      if (scope && scope !== "inbox" && scope !== "library" && scope !== "staged") {
        throw new Error("--scope must be inbox, library, or staged");
      }

      const result = await apiClient.post<Record<string, unknown>>(
        "/resources/index",
        scope ? { scope } : {}
      );
      await writePayload(output, argv, result, humanResources(result));
      return 0;
    }

    if (command === "resources" && subcommand === "register") {
      requireYes(argv);
      const resourcePath = argv[2];
      if (!resourcePath || resourcePath.startsWith("--")) {
        throw new Error("resources register requires a path");
      }

      const result = await apiClient.post<Record<string, unknown>>(
        "/resources/register",
        {
          path: resourcePath,
          title: flagValue(argv, "--title"),
          aliases: flagValues(argv, "--alias")
        }
      );
      await writePayload(output, argv, result, "resource registered");
      return 0;
    }

    if (command === "logs" && subcommand === "containers") {
      const config = getContainerLogsConfigFromEnv(options.env);
      const reader =
        options.containerLogsReader ?? createDockerContainerLogsReader(config);
      const snapshot = await reader.read({
        service: flagValue(argv, "--service") || "all",
        tail: parseTailFlag(argv, config.defaultTail)
      });

      await writePayload(
        output,
        argv,
        { containerLogs: snapshot },
        humanContainerLogs(snapshot)
      );
      return 0;
    }

    if (command === "audit") {
      const result = await apiClient.get<Record<string, unknown>>("/audit");
      await writePayload(output, argv, result);
      return 0;
    }

    throw new Error(`Unknown command: ${argv.join(" ")}`);
  } catch (error) {
    output.error(`${toErrorMessage(error)}\n`);
    return 1;
  }
}

if (isDirectNodeEntrypoint(import.meta.url)) {
  void runCli().then((exitCode) => {
    process.exitCode = exitCode;
  });
}
