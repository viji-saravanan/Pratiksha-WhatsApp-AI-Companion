import { existsSync } from "node:fs";
import { isAbsolute, join } from "node:path";

const DEFAULT_DATA_ROOT = "/Volumes/Arya 1TB/VijiAI";
const DEFAULT_SENTINEL_FILE = ".viji-helper-root";

export function resolveLiveWorkerStorageGate(
  env = process.env,
  pathExists = existsSync
) {
  const dataRoot = env.VIJI_DATA_ROOT || DEFAULT_DATA_ROOT;
  const sentinelFile = env.VIJI_SENTINEL_FILE || DEFAULT_SENTINEL_FILE;
  const sentinelPath = isAbsolute(sentinelFile)
    ? sentinelFile
    : join(dataRoot, sentinelFile);
  const dataRootAvailable = pathExists(dataRoot);
  const sentinelAvailable = pathExists(sentinelPath);

  return {
    dataRoot,
    sentinelPath,
    dataRootAvailable,
    sentinelAvailable,
    available: dataRootAvailable && sentinelAvailable
  };
}
