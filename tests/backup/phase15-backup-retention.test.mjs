import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, stat, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { startDisposablePostgres } from "../helpers/disposable-postgres.mjs";

function runScript(script, env) {
  return spawnSync("node", [script, "--json"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ...env
    },
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024
  });
}

function assertSuccess(result, label) {
  assert.equal(
    result.status,
    0,
    `${label}\nerror:\n${result.error?.message || ""}\nsignal:\n${result.signal || ""}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
  );
}

function storageEnv(root) {
  return {
    VIJI_DATA_ROOT: root,
    VIJI_SENTINEL_FILE: ".viji-helper-root",
    VIJI_STORAGE_PROFILE: "custom-env",
    VIJI_QUOTA_LIMIT_BYTES: String(1024 ** 3),
    VIJI_WARNING_USED_BYTES: String(900 * 1024 ** 2),
    VIJI_CRITICAL_USED_BYTES: String(950 * 1024 ** 2),
    VIJI_WARNING_FREE_BYTES: "1",
    VIJI_CRITICAL_FREE_BYTES: "1",
    VIJI_PGBACKUP_DIR: join(root, "pgbackups")
  };
}

test("Phase 15 creates a compressed Postgres backup and restore-check validates it", async () => {
  const postgres = await startDisposablePostgres({
    prefix: "viji-phase15-backup"
  });
  const root = await mkdtemp(join(tmpdir(), "viji-phase15-backup-"));

  try {
    await writeFile(join(root, ".viji-helper-root"), "ok", "utf8");
    postgres.runProjectScript("scripts/run-migrations.mjs");
    postgres.psql(`
      INSERT INTO ops_audit_events (ops_audit_event_type, ops_audit_event_severity, ops_audit_event_detail)
      VALUES ('phase15.backup_test', 'info', '{"ok": true}'::jsonb);
    `);

    const env = {
      ...storageEnv(root),
      MIGRATION_DOCKER_CONTAINER: postgres.containerName,
      MIGRATION_POSTGRES_DB: postgres.database,
      MIGRATION_POSTGRES_USER: postgres.user,
      POSTGRES_PASSWORD: postgres.password
    };
    const backup = runScript("scripts/backup-postgres.mjs", env);
    assertSuccess(backup, "backup-postgres");
    const backupPayload = JSON.parse(backup.stdout);
    assert.match(backupPayload.backupPath, /pgbackups\/viji-postgres-.*\.dump$/);
    assert.equal(backupPayload.format, "pg_dump_custom");
    assert.ok((await stat(backupPayload.backupPath)).size > 0);

    const manifest = JSON.parse(await readFile(`${backupPayload.backupPath}.json`, "utf8"));
    assert.equal(manifest.checksumSha256, backupPayload.checksumSha256);

    const restore = spawnSync(
      "node",
      [
        "scripts/restore-check-postgres.mjs",
        "--json",
        "--backup",
        backupPayload.backupPath
      ],
      {
        cwd: process.cwd(),
        env: { ...process.env, ...env },
        encoding: "utf8",
        maxBuffer: 20 * 1024 * 1024
      }
    );
    assertSuccess(restore, "restore-check-postgres");
    const restorePayload = JSON.parse(restore.stdout);
    assert.equal(restorePayload.restored, true);
    assert.equal(restorePayload.checks.hasMessagesTable, true);
    assert.equal(restorePayload.checks.hasAuditTable, true);
  } finally {
    postgres.stop();
  }
});

test("Phase 15 retention sweep prunes only backups and temporary files", async () => {
  const root = await mkdtemp(join(tmpdir(), "viji-phase15-retention-"));
  const backupDir = join(root, "pgbackups");
  const tmpDir = join(root, "tmp");
  const resourceRoot = join(root, "viji-files");
  const resourceTmp = join(resourceRoot, "tmp");
  const library = join(resourceRoot, "library");
  await mkdir(backupDir, { recursive: true });
  await mkdir(tmpDir, { recursive: true });
  await mkdir(resourceTmp, { recursive: true });
  await mkdir(library, { recursive: true });

  const oldDate = new Date(Date.now() - 12 * 24 * 60 * 60 * 1000);
  for (const name of ["one.dump", "two.dump", "three.dump"]) {
    const path = join(backupDir, name);
    await writeFile(path, name, "utf8");
    await writeFile(`${path}.json`, "{}", "utf8");
    await utimes(path, oldDate, oldDate);
  }
  await writeFile(join(tmpDir, "old.tmp"), "old", "utf8");
  await utimes(join(tmpDir, "old.tmp"), oldDate, oldDate);
  await writeFile(join(resourceTmp, "old-resource.tmp"), "old", "utf8");
  await utimes(join(resourceTmp, "old-resource.tmp"), oldDate, oldDate);
  await writeFile(join(library, "keep.pdf"), "resource", "utf8");

  const env = {
    VIJI_DATA_ROOT: root,
    VIJI_RESOURCE_ROOT: resourceRoot,
    VIJI_PGBACKUP_DIR: backupDir,
    VIJI_BACKUP_KEEP_COUNT: "1",
    VIJI_RETENTION_TMP_MAX_AGE_DAYS: "7"
  };
  const plan = runScript("scripts/retention-sweep.mjs", env);
  assertSuccess(plan, "retention plan");
  const planPayload = JSON.parse(plan.stdout);
  assert.equal(planPayload.applied, false);
  assert.equal(planPayload.plannedDeletes.length, 6);
  assert.ok(planPayload.plannedDeletes.every((item) => !item.path.includes("/library/")));

  const apply = spawnSync("node", ["scripts/retention-sweep.mjs", "--json", "--apply"], {
    cwd: process.cwd(),
    env: { ...process.env, ...env },
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024
  });
  assertSuccess(apply, "retention apply");
  const applyPayload = JSON.parse(apply.stdout);
  assert.equal(applyPayload.applied, true);
  assert.equal((await stat(join(library, "keep.pdf"))).isFile(), true);
  await assert.rejects(() => stat(join(tmpDir, "old.tmp")));
  await assert.rejects(() => stat(join(resourceTmp, "old-resource.tmp")));
});
