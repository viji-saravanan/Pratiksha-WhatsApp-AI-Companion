import "./load-env.mjs";
import { spawn } from "node:child_process";

function getPsqlInvocation() {
  const user = process.env.MIGRATION_POSTGRES_USER || process.env.POSTGRES_USER || "viji";
  const database = process.env.MIGRATION_POSTGRES_DB || process.env.POSTGRES_DB || "viji_helper";

  if (process.env.MIGRATION_DOCKER_CONTAINER) {
    return {
      command: "docker",
      args: [
        "exec",
        "-i",
        process.env.MIGRATION_DOCKER_CONTAINER,
        "psql",
        "-h",
        "127.0.0.1",
        "-U",
        user,
        "-d",
        database,
        "-v",
        "ON_ERROR_STOP=1",
        "-f",
        "-"
      ]
    };
  }

  if (process.env.MIGRATION_COMPOSE_SERVICE !== "host") {
    return {
      command: "docker",
      args: [
        "compose",
        "exec",
        "-T",
        process.env.MIGRATION_COMPOSE_SERVICE || "postgres",
        "psql",
        "-U",
        user,
        "-d",
        database,
        "-v",
        "ON_ERROR_STOP=1",
        "-f",
        "-"
      ]
    };
  }

  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required when MIGRATION_COMPOSE_SERVICE=host");
  }

  return {
    command: process.env.MIGRATION_PSQL_BIN || "psql",
    args: [process.env.DATABASE_URL, "-v", "ON_ERROR_STOP=1", "-f", "-"]
  };
}

export async function runSql(sql, label = "sql") {
  const invocation = getPsqlInvocation();
  const child = spawn(invocation.command, invocation.args, {
    cwd: process.cwd(),
    env: process.env
  });

  let stdout = "";
  let stderr = "";

  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  child.stdin.end(sql);

  const exitCode = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  });

  if (exitCode !== 0) {
    const command = [invocation.command, ...invocation.args].join(" ");
    throw new Error(
      [
        `Failed to run ${label} with exit code ${exitCode}`,
        `Command: ${command}`,
        stdout.trim() ? `stdout:\n${stdout.trim()}` : "",
        stderr.trim() ? `stderr:\n${stderr.trim()}` : ""
      ]
        .filter(Boolean)
        .join("\n")
    );
  }

  return stdout;
}
