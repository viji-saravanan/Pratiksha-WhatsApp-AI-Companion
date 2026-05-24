import { lstat, readdir, statfs } from "node:fs/promises";
import { join } from "node:path";

export type DirectoryUsageOptions = {
  excludeNames?: ReadonlySet<string>;
  excludeSuffixes?: readonly string[];
};

const DEFAULT_EXCLUDED_NAMES = new Set([
  "node_modules",
  ".pnpm-store",
  ".git",
  "dist",
  "coverage",
  ".cache",
  ".turbo",
  ".DS_Store"
]);
const DEFAULT_EXCLUDED_SUFFIXES = [".tsbuildinfo"];
const STAT_BLOCK_BYTES = 512;

function allocatedBytes(stat: { blocks?: number; size: number }): number {
  return typeof stat.blocks === "number" && stat.blocks >= 0
    ? stat.blocks * STAT_BLOCK_BYTES
    : stat.size;
}

export async function getDirectoryUsageBytes(
  rootPath: string,
  options: DirectoryUsageOptions = {}
): Promise<number> {
  const excludeNames = options.excludeNames ?? DEFAULT_EXCLUDED_NAMES;
  const excludeSuffixes = options.excludeSuffixes ?? DEFAULT_EXCLUDED_SUFFIXES;
  let total = 0;
  const stack = [rootPath];

  while (stack.length > 0) {
    const currentPath = stack.pop();
    if (!currentPath) {
      continue;
    }

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
          excludeNames.has(entry.name) ||
          excludeSuffixes.some((suffix) => entry.name.endsWith(suffix))
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

export async function getFilesystemAvailableBytes(rootPath: string): Promise<number> {
  const stats = await statfs(rootPath);
  return stats.bavail * stats.bsize;
}
