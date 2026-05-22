import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";
import type { GuardCheck } from "./mount-check.js";

export type SentinelCheck = GuardCheck & {
  sentinelPath: string;
};

export async function checkSentinel(dataRoot: string, sentinelFile: string): Promise<SentinelCheck> {
  const sentinelPath = join(dataRoot, sentinelFile);

  try {
    await access(sentinelPath, constants.R_OK | constants.W_OK);
    return {
      name: "sentinel.rw",
      ok: true,
      message: `${sentinelPath} is readable and writable`,
      sentinelPath
    };
  } catch {
    return {
      name: "sentinel.rw",
      ok: false,
      message: `${sentinelPath} is missing or not writable`,
      sentinelPath
    };
  }
}
