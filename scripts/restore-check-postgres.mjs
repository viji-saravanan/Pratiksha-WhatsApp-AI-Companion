import "./lib/load-env.mjs";
import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  assertSyncSuccess,
  postgresSettings,
  runSync,
  spawnProcess
} from "./lib/postgres-process.mjs";

const args = process.argv.slice(2);
const jsonOutput = args.includes("--json");
const dataRoot = process.env.VIJI_DATA_ROOT || "/data/pratiksha";
const backupDir = process.env.VIJI_PGBACKUP_DIR || join(dataRoot, "pgbackups");
const image = process.env.VIJI_TEST_POSTGRES_IMAGE || "pgvector/pgvector:pg16";

function argValue(name) {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

function emit(payload) {
  console.log(JSON.stringify(payload, null, jsonOutput ? 2 : 0));
}

async function latestBackupPath() {
  const entries = await readdir(backupDir, { withFileTypes: true });
  const backups = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".dump")) {
      continue;
    }
    const path = join(backupDir, entry.name);
    backups.push({ path, mtimeMs: (await stat(path)).mtimeMs });
  }

  backups.sort((left, right) => right.mtimeMs - left.mtimeMs);
  if (!backups[0]) {
    throw new Error(`No .dump backup files found in ${backupDir}`);
  }
  return backups[0].path;
}

async function waitForPostgres(containerName, user, database) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const result = runSync("docker", [
      "exec",
      containerName,
      "pg_isready",
      "-h",
      "127.0.0.1",
      "-U",
      user,
      "-d",
      database
    ]);
    if (result.status === 0) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Timed out waiting for restore-check Postgres container");
}

function psql(containerName, settings, sql) {
  const result = runSync(
    "docker",
    [
      "exec",
      "-i",
      "-e",
      `PGPASSWORD=${settings.password}`,
      containerName,
      "psql",
      "-h",
      "127.0.0.1",
      "-U",
      settings.user,
      "-d",
      settings.database,
      "-v",
      "ON_ERROR_STOP=1",
      "-A",
      "-t",
      "-F",
      "\t",
      "-f",
      "-"
    ],
    { input: sql }
  );
  assertSyncSuccess(result, "restore-check psql");
  return result.stdout.trim();
}

async function pgRestore(containerName, settings, backupPath) {
  const child = spawnProcess(
    "docker",
    [
      "exec",
      "-i",
      "-e",
      `PGPASSWORD=${settings.password}`,
      containerName,
      "pg_restore",
      "-h",
      "127.0.0.1",
      "-U",
      settings.user,
      "-d",
      settings.database,
      "--no-owner",
      "--no-privileges"
    ],
    { stdio: ["pipe", "pipe", "pipe"] }
  );
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  createReadStream(backupPath).pipe(child.stdin);

  const exitCode = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  });
  if (exitCode !== 0) {
    throw new Error(`pg_restore failed with exit code ${exitCode}${stderr.trim() ? `: ${stderr.trim()}` : ""}`);
  }
}

async function runRestoreCheck() {
  const settings = postgresSettings({
    ...process.env,
    MIGRATION_POSTGRES_DB: process.env.MIGRATION_POSTGRES_DB || process.env.POSTGRES_DB || "viji_helper",
    MIGRATION_POSTGRES_USER: process.env.MIGRATION_POSTGRES_USER || process.env.POSTGRES_USER || "viji"
  });
  const backupPath = resolve(argValue("--backup") || (await latestBackupPath()));
  const backupStat = await stat(backupPath);
  const containerName = `viji-restore-check-${process.pid}-${Date.now()}`;
  const start = runSync("docker", [
    "run",
    "--rm",
    "-d",
    "--name",
    containerName,
    "-e",
    `POSTGRES_DB=${settings.database}`,
    "-e",
    `POSTGRES_USER=${settings.user}`,
    "-e",
    `POSTGRES_PASSWORD=${settings.password}`,
    image
  ]);
  assertSyncSuccess(start, "docker run restore-check postgres");

  try {
    await waitForPostgres(containerName, settings.user, settings.database);
    await pgRestore(containerName, settings, backupPath);
    const tableCheck = psql(
      containerName,
      settings,
      "SELECT to_regclass('public.msg_messages') IS NOT NULL, to_regclass('public.ops_audit_events') IS NOT NULL;"
    );
    const [hasMessages, hasAudit] = tableCheck.split("\t");
    const statusCheck = psql(
      containerName,
      settings,
      "SELECT count(*)::integer FROM msg_conversations;"
    );

    return {
      backupPath,
      sizeBytes: backupStat.size,
      restored: true,
      checks: {
        hasMessagesTable: hasMessages === "t",
        hasAuditTable: hasAudit === "t",
        conversationCount: Number(statusCheck || 0)
      }
    };
  } finally {
    runSync("docker", ["stop", containerName]);
  }
}

try {
  emit(await runRestoreCheck());
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (jsonOutput) {
    emit({ error: { message } });
  } else {
    console.error(message);
  }
  process.exit(1);
}
