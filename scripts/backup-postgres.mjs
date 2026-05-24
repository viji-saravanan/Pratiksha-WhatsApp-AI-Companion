import "./lib/load-env.mjs";
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { finished } from "node:stream/promises";
import { pgDumpInvocation, spawnProcess, runSync, assertSyncSuccess } from "./lib/postgres-process.mjs";

const args = new Set(process.argv.slice(2));
const jsonOutput = args.has("--json");
const forceStorageWarning = args.has("--force-storage-warning");
const dataRoot = process.env.VIJI_DATA_ROOT || "/Volumes/Arya 1TB/VijiAI";
const backupDir = process.env.VIJI_PGBACKUP_DIR || join(dataRoot, "pgbackups");

function timestampForFile(date = new Date()) {
  return date.toISOString().replaceAll(":", "").replaceAll(".", "-");
}

function emit(payload) {
  console.log(JSON.stringify(payload, null, jsonOutput ? 2 : 0));
}

function checkStorage() {
  const result = runSync("node", ["scripts/check-storage-profile.mjs"]);
  assertSyncSuccess(result, "storage profile check");
  const report = JSON.parse(result.stdout);
  if (report.state !== "healthy" && !forceStorageWarning) {
    throw new Error(
      `Backups require healthy storage. Current storage state is ${report.state}; use --force-storage-warning only for an explicit recovery run.`
    );
  }

  return report;
}

async function runBackup() {
  const storage = checkStorage();
  await mkdir(backupDir, { recursive: true });
  const fileName = `viji-postgres-${timestampForFile()}.dump`;
  const backupPath = join(backupDir, fileName);
  const invocation = pgDumpInvocation();
  const child = spawnProcess(invocation.command, invocation.args, {
    stdio: ["ignore", "pipe", "pipe"]
  });
  const output = createWriteStream(backupPath, { flags: "wx" });
  let stderr = "";

  child.stdout.pipe(output);
  const outputFinished = finished(output);
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  const exitCode = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  });

  await outputFinished;

  if (exitCode !== 0) {
    throw new Error(`pg_dump failed with exit code ${exitCode}${stderr.trim() ? `: ${stderr.trim()}` : ""}`);
  }

  const body = await readFile(backupPath);
  const checksumSha256 = createHash("sha256").update(body).digest("hex");
  const fileStat = await stat(backupPath);
  const manifest = {
    backupPath,
    fileName,
    createdAt: new Date().toISOString(),
    sizeBytes: fileStat.size,
    checksumSha256,
    format: "pg_dump_custom",
    storageState: storage.state
  };
  await writeFile(`${backupPath}.json`, JSON.stringify(manifest, null, 2));

  return manifest;
}

try {
  emit(await runBackup());
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (jsonOutput) {
    emit({ error: { message } });
  } else {
    console.error(message);
  }
  process.exit(1);
}
