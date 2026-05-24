import { join } from "node:path";
import {
  getContainerLogsConfigFromEnv,
  type ContainerLogsConfig
} from "@viji/shared";

export interface DashboardConfig {
  host: string;
  port: number;
  apiBaseUrl: string;
  apiToken: string;
  containerLogs: ContainerLogsConfig;
  upload: DashboardUploadConfig;
}

export interface DashboardUploadConfig {
  resourceRoot: string;
  maxBytes: number;
}

function parseInteger(
  value: string | undefined,
  defaultValue: number,
  minimum: number,
  maximum: number
): number {
  const parsed = Number(value ?? defaultValue);
  if (!Number.isInteger(parsed)) {
    return defaultValue;
  }

  return Math.min(maximum, Math.max(minimum, parsed));
}

export function getDashboardConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env
): DashboardConfig {
  return {
    host: env.VIJI_DASHBOARD_HOST || "127.0.0.1",
    port: Number(env.VIJI_DASHBOARD_PORT || 8788),
    apiBaseUrl: env.VIJI_DASHBOARD_API_BASE_URL || env.VIJI_API_BASE_URL || "http://127.0.0.1:8787",
    apiToken: env.VIJI_API_TOKEN || "local-dev-token",
    containerLogs: getContainerLogsConfigFromEnv(env),
    upload: {
      resourceRoot:
        env.VIJI_RESOURCE_ROOT ||
        join(env.VIJI_DATA_ROOT || "/Volumes/Arya 1TB/VijiAI", "viji-files"),
      maxBytes: parseInteger(env.VIJI_DASHBOARD_UPLOAD_MAX_BYTES, 52_428_800, 1, 524_288_000)
    }
  };
}
