import { getRuntimePaths } from "@viji/config";

export interface WacliAdapterConfig {
  bin: string;
  markReadBin: string;
  markReadEnabled: boolean;
  markReadTimeout: string;
  storePath: string;
  timeout: string;
  liveSmokeEnabled: boolean;
  liveReadSmokeEnabled: boolean;
  liveReadSmokeQuery: string;
  liveReadSmokeChatLimit: number;
  liveReadSmokeMessageLimit: number;
  liveRecoverySmokeEnabled: boolean;
  liveRecoverySmokeAfter: string;
  liveSendEnabled: boolean;
  liveSendSmokeEnabled: boolean;
  liveSendSmokeTo: string;
  liveSendSmokeMessage: string;
}

export function getWacliAdapterConfig(
  env: NodeJS.ProcessEnv = process.env
): WacliAdapterConfig {
  const paths = getRuntimePaths(env);
  return {
    bin: env.VIJI_WACLI_BIN || "wacli",
    markReadBin: env.VIJI_WACLI_MARK_READ_BIN || "wacli-mark-read",
    markReadEnabled: env.VIJI_WACLI_MARK_READ_ENABLED !== "false",
    markReadTimeout: env.VIJI_WACLI_MARK_READ_TIMEOUT || "5s",
    storePath: paths.wacliStore,
    timeout: env.VIJI_WACLI_TIMEOUT || "30s",
    liveSmokeEnabled: env.VIJI_WACLI_LIVE_SMOKE_ENABLED === "true",
    liveReadSmokeEnabled: env.VIJI_WACLI_LIVE_READ_SMOKE_ENABLED === "true",
    liveReadSmokeQuery:
      env.VIJI_WACLI_LIVE_READ_SMOKE_QUERY || "Primary Recipient",
    liveReadSmokeChatLimit: positiveInteger(
      env.VIJI_WACLI_LIVE_READ_SMOKE_CHAT_LIMIT,
      5
    ),
    liveReadSmokeMessageLimit: positiveInteger(
      env.VIJI_WACLI_LIVE_READ_SMOKE_MESSAGE_LIMIT,
      5
    ),
    liveRecoverySmokeEnabled:
      env.VIJI_WACLI_LIVE_RECOVERY_SMOKE_ENABLED === "true",
    liveRecoverySmokeAfter: env.VIJI_WACLI_LIVE_RECOVERY_SMOKE_AFTER || "",
    liveSendEnabled: env.VIJI_WACLI_LIVE_SEND_ENABLED === "true",
    liveSendSmokeEnabled: env.VIJI_WACLI_LIVE_SEND_SMOKE_ENABLED === "true",
    liveSendSmokeTo: env.VIJI_WACLI_LIVE_SEND_SMOKE_TO || "",
    liveSendSmokeMessage:
      env.VIJI_WACLI_LIVE_SEND_SMOKE_MESSAGE ||
      "Pratiksha live send smoke test."
  };
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}
