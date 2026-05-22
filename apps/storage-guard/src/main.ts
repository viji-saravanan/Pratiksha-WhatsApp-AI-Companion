import { getRuntimePaths, getStorageProfile } from "@viji/config";
import { formatBytes } from "@viji/core";
import type { StorageGuardReport } from "@viji/schemas";
import { isDirectNodeEntrypoint } from "@viji/shared";
import { checkMount } from "./mount-check.js";
import { checkQuota } from "./quota-check.js";
import { checkSentinel } from "./sentinel-check.js";
import { summarizeStorageState } from "./state-publisher.js";

export async function runStorageGuard(): Promise<StorageGuardReport> {
  const paths = getRuntimePaths();
  const profile = getStorageProfile(process.env.VIJI_STORAGE_PROFILE);
  const mount = await checkMount(paths.dataRoot);
  const sentinel = await checkSentinel(paths.dataRoot, paths.sentinelFile);
  const quota = mount.ok ? await checkQuota(paths.dataRoot, profile) : null;

  const checks = [mount, sentinel];
  if (quota) {
    checks.push(...quota.checks);
  }

  const state = !mount.ok
    ? "missing"
    : !sentinel.ok
      ? "unwritable"
      : quota?.state ?? "critical";

  return {
    dataRoot: paths.dataRoot,
    sentinelPath: sentinel.sentinelPath,
    profileName: profile.name,
    state,
    usedBytes: quota?.usedBytes ?? 0,
    freeBytes: quota?.freeBytes ?? 0,
    quotaLimitBytes: profile.quotaLimitBytes,
    checks: checks.map((check) => ({
      name: check.name,
      ok: check.ok,
      message: check.message
    }))
  };
}

if (isDirectNodeEntrypoint(import.meta.url)) {
  const report = await runStorageGuard();
  console.log(JSON.stringify(report, null, 2));

  if (report.state === "healthy" || report.state === "warning") {
    console.error(
      `storage ${report.state}: ${formatBytes(report.usedBytes)} used, ${formatBytes(report.freeBytes)} free (${summarizeStorageState(report)})`
    );
    process.exit(0);
  }

  console.error(`storage ${report.state}: ${summarizeStorageState(report)}`);
  process.exit(2);
}
