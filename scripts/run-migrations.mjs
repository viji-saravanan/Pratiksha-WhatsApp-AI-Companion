import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { runSql } from "./lib/psql-runner.mjs";

const migrationsDir = process.env.VIJI_MIGRATIONS_DIR || "migrations";
const entries = await readdir(migrationsDir, { withFileTypes: true });
const migrationFiles = entries
  .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
  .map((entry) => entry.name)
  .sort();

if (migrationFiles.length === 0) {
  throw new Error(`No migration files found in ${migrationsDir}`);
}

for (const migrationFile of migrationFiles) {
  const migrationPath = join(migrationsDir, migrationFile);
  const sql = await readFile(migrationPath, "utf8");
  await runSql(sql, migrationFile);
  console.log(`applied ${migrationFile}`);
}
