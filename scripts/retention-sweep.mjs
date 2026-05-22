import "./lib/load-env.mjs";
import { readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";

const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");
const jsonOutput = args.has("--json");
const dataRoot = process.env.VIJI_DATA_ROOT || "/data/pratiksha";
const resourceRoot = process.env.VIJI_RESOURCE_ROOT || join(dataRoot, "viji-files");
const backupDir = process.env.VIJI_PGBACKUP_DIR || join(dataRoot, "pgbackups");
const keepBackups = Number(process.env.VIJI_BACKUP_KEEP_COUNT || 7);
const tmpMaxAgeDays = Number(process.env.VIJI_RETENTION_TMP_MAX_AGE_DAYS || 7);

function emit(payload) {
  console.log(JSON.stringify(payload, null, jsonOutput ? 2 : 0));
}

async function listFiles(directory) {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
      if (!entry.isFile()) {
        continue;
      }
      const path = join(directory, entry.name);
      files.push({ path, name: entry.name, stat: await stat(path) });
    }
    return files;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

async function planBackupRetention() {
  const backups = (await listFiles(backupDir))
    .filter((file) => file.name.endsWith(".dump"))
    .sort((left, right) => right.stat.mtimeMs - left.stat.mtimeMs);
  const deletePaths = [];
  for (const backup of backups.slice(Math.max(0, keepBackups))) {
    deletePaths.push({
      path: backup.path,
      reason: `backup count exceeds VIJI_BACKUP_KEEP_COUNT=${keepBackups}`
    });
    deletePaths.push({
      path: `${backup.path}.json`,
      reason: "backup manifest paired with expired backup"
    });
  }

  return deletePaths;
}

async function planTmpRetention(directory) {
  const cutoff = Date.now() - tmpMaxAgeDays * 24 * 60 * 60 * 1000;
  const files = await listFiles(directory);
  return files
    .filter((file) => file.stat.mtimeMs < cutoff)
    .map((file) => ({
      path: file.path,
      reason: `temporary file older than ${tmpMaxAgeDays} days`
    }));
}

async function runRetention() {
  const plannedDeletes = [
    ...(await planBackupRetention()),
    ...(await planTmpRetention(join(dataRoot, "tmp"))),
    ...(await planTmpRetention(join(resourceRoot, "tmp")))
  ];
  const uniqueDeletes = Array.from(
    new Map(plannedDeletes.map((item) => [item.path, item])).values()
  );
  const deleted = [];

  if (apply) {
    for (const item of uniqueDeletes) {
      await rm(item.path, { force: true });
      deleted.push(item);
    }
  }

  return {
    applied: apply,
    keepBackups,
    tmpMaxAgeDays,
    plannedDeletes: uniqueDeletes,
    deleted,
    protectedRoots: {
      resourceRoot,
      postgres: join(dataRoot, "postgres"),
      wacliStore: join(dataRoot, "wacli", "store")
    }
  };
}

try {
  emit(await runRetention());
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (jsonOutput) {
    emit({ error: { message } });
  } else {
    console.error(message);
  }
  process.exit(1);
}
