import { spawn } from "node:child_process";

import { getWacliAdapterConfig } from "./config.js";

export interface InteractiveAuthResult {
  status: "completed" | "failed";
  exitCode: number | null;
  storePath: string;
}

export function runInteractiveAuth(
  env: NodeJS.ProcessEnv = process.env
): Promise<InteractiveAuthResult> {
  const config = getWacliAdapterConfig(env);
  const args = [
    "auth",
    "--store",
    config.storePath,
    "--timeout",
    config.timeout,
    "--idle-exit",
    config.timeout
  ];

  return new Promise((resolve, reject) => {
    const child = spawn(config.bin, args, {
      env,
      stdio: "inherit"
    });

    child.on("error", reject);
    child.on("close", (exitCode) => {
      resolve({
        status: exitCode === 0 ? "completed" : "failed",
        exitCode,
        storePath: config.storePath
      });
    });
  });
}
