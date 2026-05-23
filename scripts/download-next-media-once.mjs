import "./lib/load-env.mjs";
import { createPgPool } from "../packages/db/dist/index.js";
import { dispatchNextMediaDownloadJob } from "../apps/worker/dist/index.js";
import { createWacliClient } from "../apps/wa-adapter-wacli/dist/index.js";

const pool = createPgPool();

try {
  const result = await dispatchNextMediaDownloadJob(pool, {
    adapter: createWacliClient(),
    env: process.env
  });

  process.stdout.write(`${JSON.stringify(redactResult(result), null, 2)}\n`);
  if (result.status === "failed") {
    process.exitCode = 2;
  }
} finally {
  await pool.end();
}

function redactResult(result) {
  if ("job" in result) {
    return {
      ...result,
      ...(result.fileAssetId ? { fileAssetId: "[redacted-id]" } : {}),
      job: {
        ...result.job,
        mediaDownloadJobId: "[redacted-id]",
        messageMediaId: "[redacted-id]",
        conversationId: "[redacted-id]"
      }
    };
  }

  return result;
}
