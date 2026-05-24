import "./lib/load-env.mjs";
import { access, lstat, readdir, statfs } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";

const profiles = {
  "large-200gb": {
    quotaLimitBytes: 200 * 1024 ** 3,
    warningUsedBytes: 165 * 1024 ** 3,
    criticalUsedBytes: 185 * 1024 ** 3,
    warningFreeBytes: 25 * 1024 ** 3,
    criticalFreeBytes: 12 * 1024 ** 3
  },
  "small-100gb": {
    quotaLimitBytes: 100 * 1024 ** 3,
    warningUsedBytes: 80 * 1024 ** 3,
    criticalUsedBytes: 90 * 1024 ** 3,
    warningFreeBytes: 15 * 1024 ** 3,
    criticalFreeBytes: 8 * 1024 ** 3
  }
};

const dataRoot = process.env.VIJI_DATA_ROOT || "/Volumes/Arya 1TB/VijiAI";
const sentinelFile = process.env.VIJI_SENTINEL_FILE || ".viji-helper-root";
const profileName = process.env.VIJI_STORAGE_PROFILE || "large-200gb";
const profile = getProfile(profileName);

if (!profile) {
  console.error(`Unknown storage profile: ${profileName}`);
  process.exit(2);
}

const checks = [];
const excludedUsageNames = new Set([
  "node_modules",
  ".pnpm-store",
  ".git",
  "dist",
  "coverage",
  ".cache",
  ".turbo",
  ".DS_Store"
]);
const excludedUsageSuffixes = [".tsbuildinfo"];
const statBlockBytes = 512;

function allocatedBytes(fileStat) {
  return typeof fileStat.blocks === "number" && fileStat.blocks >= 0
    ? fileStat.blocks * statBlockBytes
    : fileStat.size;
}

function getProfile(name) {
  if (name === "custom-env") {
    return {
      quotaLimitBytes: Number(process.env.VIJI_QUOTA_LIMIT_BYTES),
      warningUsedBytes: Number(process.env.VIJI_WARNING_USED_BYTES),
      criticalUsedBytes: Number(process.env.VIJI_CRITICAL_USED_BYTES),
      warningFreeBytes: Number(process.env.VIJI_WARNING_FREE_BYTES),
      criticalFreeBytes: Number(process.env.VIJI_CRITICAL_FREE_BYTES)
    };
  }

  return profiles[name];
}

async function getDirectoryUsageBytes(rootPath) {
  let total = 0;
  const stack = [rootPath];

  while (stack.length > 0) {
    const currentPath = stack.pop();
    const currentStat = await lstat(currentPath);

    if (currentStat.isSymbolicLink()) {
      total += allocatedBytes(currentStat);
      continue;
    }

    if (currentStat.isDirectory()) {
      total += allocatedBytes(currentStat);
      const entries = await readdir(currentPath, { withFileTypes: true });
      for (const entry of entries) {
        if (
          excludedUsageNames.has(entry.name) ||
          excludedUsageSuffixes.some((suffix) => entry.name.endsWith(suffix))
        ) {
          continue;
        }
        stack.push(join(currentPath, entry.name));
      }
      continue;
    }

    total += allocatedBytes(currentStat);
  }

  return total;
}

async function pushAccessCheck(name, target, mode) {
  try {
    await access(target, mode);
    checks.push({ name, ok: true, message: `${target} is available` });
    return true;
  } catch {
    checks.push({ name, ok: false, message: `${target} is unavailable` });
    return false;
  }
}

const mountOk = await pushAccessCheck("mount.exists", dataRoot, constants.F_OK);
const sentinelPath = join(dataRoot, sentinelFile);
const sentinelOk = await pushAccessCheck("sentinel.rw", sentinelPath, constants.R_OK | constants.W_OK);

let usedBytes = 0;
let freeBytes = 0;
let state = "missing";

if (mountOk && sentinelOk) {
  const stats = await statfs(dataRoot);
  usedBytes = await getDirectoryUsageBytes(dataRoot);
  freeBytes = stats.bavail * stats.bsize;
  const critical = usedBytes >= profile.criticalUsedBytes || freeBytes <= profile.criticalFreeBytes;
  const warning = usedBytes >= profile.warningUsedBytes || freeBytes <= profile.warningFreeBytes;

  checks.push({
    name: "project_quota.warning",
    ok: !warning,
    message: warning
      ? "project usage or filesystem free space is at warning threshold"
      : "project usage and filesystem free space are below warning threshold"
  });
  checks.push({
    name: "project_quota.critical",
    ok: !critical,
    message: critical
      ? "project usage or filesystem free space is at critical threshold"
      : "project usage and filesystem free space are below critical threshold"
  });

  state = critical ? "critical" : warning ? "warning" : "healthy";
} else if (mountOk) {
  state = "unwritable";
}

const report = {
  dataRoot,
  sentinelPath,
  profileName,
  state,
  usedBytes,
  freeBytes,
  quotaLimitBytes: profile.quotaLimitBytes,
  checks
};

console.log(JSON.stringify(report, null, 2));
process.exit(state === "healthy" || state === "warning" ? 0 : 2);
