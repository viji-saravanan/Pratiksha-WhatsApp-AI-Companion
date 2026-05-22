import { getDirectoryUsageBytes, getFilesystemAvailableBytes } from "@viji/core";
import type { StorageProfile } from "@viji/config";
import type { StorageGuardState } from "@viji/schemas";
import type { GuardCheck } from "./mount-check.js";

export type QuotaReport = {
  state: Extract<StorageGuardState, "healthy" | "warning" | "critical">;
  usedBytes: number;
  freeBytes: number;
  checks: GuardCheck[];
};

export async function checkQuota(dataRoot: string, profile: StorageProfile): Promise<QuotaReport> {
  const usedBytes = await getDirectoryUsageBytes(dataRoot);
  const freeBytes = await getFilesystemAvailableBytes(dataRoot);

  const critical =
    usedBytes >= profile.criticalUsedBytes || freeBytes <= profile.criticalFreeBytes;
  const warning = usedBytes >= profile.warningUsedBytes || freeBytes <= profile.warningFreeBytes;

  const state = critical ? "critical" : warning ? "warning" : "healthy";

  return {
    state,
    usedBytes,
    freeBytes,
    checks: [
      {
        name: "project_quota.warning",
        ok: !warning,
        message: warning
          ? "project usage or filesystem free space is at warning threshold"
          : "project usage and filesystem free space are below warning threshold"
      },
      {
        name: "project_quota.critical",
        ok: !critical,
        message: critical
          ? "project usage or filesystem free space is at critical threshold"
          : "project usage and filesystem free space are below critical threshold"
      }
    ]
  };
}
