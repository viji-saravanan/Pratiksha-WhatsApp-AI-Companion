import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const defaultPostgresImage = process.env.VIJI_TEST_POSTGRES_IMAGE || "pgvector/pgvector:pg16";
const defaultDatabase = "viji_helper";
const defaultUser = "viji";
const defaultPassword = "viji_test_password";

export function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
    ...options
  });
}

export function assertSuccess(result, label) {
  assert.equal(
    result.status,
    0,
    `${label} failed\nstdout:\n${result.stdout || ""}\nstderr:\n${result.stderr || ""}`
  );
}

async function waitForPostgres(containerName, user, database) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const result = run("docker", [
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
  throw new Error("Timed out waiting for disposable Postgres container");
}

function getMappedPort(containerName) {
  const result = run("docker", ["port", containerName, "5432/tcp"]);
  assertSuccess(result, "docker port postgres");
  const mapping = result.stdout.trim().split("\n")[0];
  const match = mapping.match(/:(\d+)$/);
  assert.ok(match, `Could not parse mapped Postgres port from '${mapping}'`);
  return match[1];
}

export async function startDisposablePostgres(options = {}) {
  const image = options.image || defaultPostgresImage;
  const database = options.database || defaultDatabase;
  const user = options.user || defaultUser;
  const password = options.password || defaultPassword;
  const prefix = options.prefix || "viji-postgres";
  const containerName = `${prefix}-${process.pid}-${Date.now()}`;

  const start = run("docker", [
    "run",
    "--rm",
    "-d",
    "--name",
    containerName,
    "-p",
    "127.0.0.1::5432",
    "-e",
    `POSTGRES_DB=${database}`,
    "-e",
    `POSTGRES_USER=${user}`,
    "-e",
    `POSTGRES_PASSWORD=${password}`,
    image
  ]);
  assertSuccess(start, "docker run postgres");

  await waitForPostgres(containerName, user, database);
  const port = getMappedPort(containerName);
  const connectionString = `postgres://${user}:${password}@127.0.0.1:${port}/${database}`;

  return {
    containerName,
    connectionString,
    database,
    user,
    password,
    psql(sql) {
      const result = run(
        "docker",
        [
          "exec",
          "-i",
          containerName,
          "psql",
          "-h",
          "127.0.0.1",
          "-U",
          user,
          "-d",
          database,
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
      assertSuccess(result, "psql");
      return result.stdout.trim();
    },
    psqlFails(sql) {
      return run(
        "docker",
        [
          "exec",
          "-i",
          containerName,
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
        ],
        { input: sql }
      );
    },
    runProjectScript(script, extraEnv = {}) {
      const result = run("node", [script], {
        env: {
          ...process.env,
          MIGRATION_DOCKER_CONTAINER: containerName,
          MIGRATION_POSTGRES_USER: user,
          MIGRATION_POSTGRES_DB: database,
          DATABASE_URL: connectionString,
          ...extraEnv
        }
      });
      assertSuccess(result, script);
      return result.stdout;
    },
    stop() {
      run("docker", ["stop", containerName]);
    }
  };
}
