import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function isDirectNodeEntrypoint(
  importMetaUrl: string,
  argv: readonly string[] = process.argv
): boolean {
  const entrypoint = argv[1];
  if (!entrypoint) {
    return false;
  }

  return fileURLToPath(importMetaUrl) === resolve(entrypoint);
}
