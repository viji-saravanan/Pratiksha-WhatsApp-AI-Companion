import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";
import { getRuntimePaths, getStorageProfile } from "@viji/config";
import { getDirectoryUsageBytes, getFilesystemAvailableBytes } from "@viji/core";

export interface ApiStorageStatus {
  state: "healthy" | "warning" | "critical" | "missing" | "unwritable";
  dataRoot: string;
  sentinelPath: string;
  profileName: string;
  usedBytes: number;
  freeBytes: number;
  quotaLimitBytes: number;
}

async function canAccess(path: string, mode: number): Promise<boolean> {
  try {
    await access(path, mode);
    return true;
  } catch {
    return false;
  }
}

export async function getApiStorageStatus(
  env: NodeJS.ProcessEnv = process.env
): Promise<ApiStorageStatus> {
  const paths = getRuntimePaths(env);
  const sentinelPath = join(paths.dataRoot, paths.sentinelFile);
  const profileName = env.VIJI_STORAGE_PROFILE || "large-200gb";
  const profile = getStorageProfile(profileName);
  const mountOk = await canAccess(paths.dataRoot, constants.F_OK);
  const sentinelOk = await canAccess(sentinelPath, constants.R_OK | constants.W_OK);

  if (!mountOk) {
    return {
      state: "missing",
      dataRoot: paths.dataRoot,
      sentinelPath,
      profileName: profile.name,
      usedBytes: 0,
      freeBytes: 0,
      quotaLimitBytes: profile.quotaLimitBytes
    };
  }

  if (!sentinelOk) {
    return {
      state: "unwritable",
      dataRoot: paths.dataRoot,
      sentinelPath,
      profileName: profile.name,
      usedBytes: 0,
      freeBytes: 0,
      quotaLimitBytes: profile.quotaLimitBytes
    };
  }

  const usedBytes = await getDirectoryUsageBytes(paths.dataRoot);
  const freeBytes = await getFilesystemAvailableBytes(paths.dataRoot);
  const critical =
    usedBytes >= profile.criticalUsedBytes || freeBytes <= profile.criticalFreeBytes;
  const warning =
    usedBytes >= profile.warningUsedBytes || freeBytes <= profile.warningFreeBytes;

  return {
    state: critical ? "critical" : warning ? "warning" : "healthy",
    dataRoot: paths.dataRoot,
    sentinelPath,
    profileName: profile.name,
    usedBytes,
    freeBytes,
    quotaLimitBytes: profile.quotaLimitBytes
  };
}
