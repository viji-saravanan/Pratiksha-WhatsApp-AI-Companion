import { isDirectNodeEntrypoint } from "@viji/shared";
import { getWacliAdapterConfig } from "./config.js";
import {
  runLiveDoctorSmokeFromEnv,
  runLiveReadSmokeFromEnv,
  runLiveRecoverySmokeFromEnv,
  runLiveSendSmokeFromEnv
} from "./live-smoke.js";
import { createWacliClient } from "./wacli-client.js";
import { runInteractiveAuth } from "./operator-auth.js";

async function main(): Promise<void> {
  const command = process.argv[2] ?? "doctor-smoke";
  let result: unknown;

  if (command === "doctor-smoke") {
    result = await runLiveDoctorSmokeFromEnv();
  } else if (command === "read-smoke") {
    result = await runLiveReadSmokeFromEnv();
  } else if (command === "recovery-smoke") {
    result = await runLiveRecoverySmokeFromEnv();
  } else if (command === "send-text-smoke") {
    result = await runLiveSendSmokeFromEnv();
  } else if (command === "auth-status") {
    result = await createWacliClient(getWacliAdapterConfig()).authStatus();
  } else if (command === "auth-login") {
    result = await runInteractiveAuth();
  } else {
    throw new Error(
      `Unsupported wa-adapter-wacli command: ${command}. Supported commands: doctor-smoke, read-smoke, recovery-smoke, send-text-smoke, auth-status, auth-login.`
    );
  }

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (
    typeof result === "object" &&
    result !== null &&
    "status" in result &&
    result.status === "failed"
  ) {
    process.exitCode = 2;
  }
}

if (isDirectNodeEntrypoint(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.stack ?? error.message : String(error)}\n`
    );
    process.exitCode = 1;
  });
}
