import "./load-env.mjs";
import { spawn, spawnSync } from "node:child_process";

export function postgresSettings(env = process.env) {
  return {
    database: env.MIGRATION_POSTGRES_DB || env.POSTGRES_DB || "viji_helper",
    user: env.MIGRATION_POSTGRES_USER || env.POSTGRES_USER || "viji",
    password: env.POSTGRES_PASSWORD || env.PGPASSWORD || "1234",
    composeService: env.MIGRATION_COMPOSE_SERVICE || "postgres",
    dockerContainer: env.MIGRATION_DOCKER_CONTAINER || "",
    databaseUrl: env.DATABASE_URL || "",
    pgDumpBin: env.PG_DUMP_BIN || "pg_dump",
    pgRestoreBin: env.PG_RESTORE_BIN || "pg_restore",
    psqlBin: env.MIGRATION_PSQL_BIN || "psql"
  };
}

export function pgDumpInvocation(env = process.env) {
  const settings = postgresSettings(env);
  const commonArgs = [
    "-h",
    "127.0.0.1",
    "-U",
    settings.user,
    "-d",
    settings.database,
    "-Fc",
    "--no-owner",
    "--no-privileges"
  ];

  if (settings.dockerContainer) {
    return {
      command: "docker",
      args: [
        "exec",
        "-i",
        "-e",
        `PGPASSWORD=${settings.password}`,
        settings.dockerContainer,
        "pg_dump",
        ...commonArgs
      ]
    };
  }

  if (settings.composeService !== "host") {
    return {
      command: "docker",
      args: [
        "compose",
        "exec",
        "-T",
        "-e",
        `PGPASSWORD=${settings.password}`,
        settings.composeService,
        "pg_dump",
        ...commonArgs.slice(2)
      ]
    };
  }

  if (!settings.databaseUrl) {
    throw new Error("DATABASE_URL is required when MIGRATION_COMPOSE_SERVICE=host");
  }

  return {
    command: settings.pgDumpBin,
    args: [settings.databaseUrl, "-Fc", "--no-owner", "--no-privileges"]
  };
}

export function runSync(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
    ...options
  });
}

export function assertSyncSuccess(result, label) {
  if (result.status !== 0) {
    throw new Error(
      [
        `${label} failed with exit code ${result.status}`,
        result.stdout?.trim() ? `stdout:\n${result.stdout.trim()}` : "",
        result.stderr?.trim() ? `stderr:\n${result.stderr.trim()}` : ""
      ]
        .filter(Boolean)
        .join("\n")
    );
  }
}

export function spawnProcess(command, args, options = {}) {
  return spawn(command, args, {
    cwd: process.cwd(),
    env: process.env,
    ...options
  });
}
