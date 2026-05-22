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
      total += currentStat.size;
      continue;
    }

    if (currentStat.isDirectory()) {
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

    total += currentStat.size;
  }

  return total;
}

export async function getFilesystemAvailableBytes(rootPath: string): Promise<number> {
  const stats = await statfs(rootPath);
  return stats.bavail * stats.bsize;
}
