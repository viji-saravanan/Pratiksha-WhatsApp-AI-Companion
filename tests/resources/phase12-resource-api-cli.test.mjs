import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  assertSuccess,
  run,
  startDisposablePostgres
} from "../helpers/disposable-postgres.mjs";

const buildApi = run("corepack", ["pnpm", "--filter", "@viji/api", "build"]);
assertSuccess(buildApi, "build @viji/api");
const buildCli = run("corepack", ["pnpm", "--filter", "@viji/cli", "build"]);
assertSuccess(buildCli, "build @viji/cli");

const { createPgPool } = await import("../../packages/db/dist/index.js");
const { createApiServer } = await import("../../apps/api/dist/index.js");
const { runCli } = await import("../../apps/cli/dist/index.js");

const token = "phase12-resource-api-token";

function captureOutput() {
  const captured = {
    stdout: "",
    stderr: "",
    output: {
      write(chunk) {
        captured.stdout += chunk;
      },
      error(chunk) {
        captured.stderr += chunk;
      }
    }
  };

  return captured;
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  assert.ok(address && typeof address === "object");
  return `http://127.0.0.1:${address.port}`;
}

async function closeServer(server) {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function apiJson(baseUrl, path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? "GET",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json"
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {})
  });

  return {
    status: response.status,
    body: await response.json()
  };
}

async function cliJson(argv, env) {
  const captured = captureOutput();
  const exitCode = await runCli([...argv, "--json"], {
    env,
    output: captured.output
  });

  assert.equal(exitCode, 0, captured.stderr);
  return JSON.parse(captured.stdout);
}

test("resource API and CLI index viji-files and reject escaped paths", async () => {
  const postgres = await startDisposablePostgres({
    prefix: "viji-phase12-resource-api"
  });

  try {
    postgres.runProjectScript("scripts/run-migrations.mjs");
    const pool = createPgPool({ connectionString: postgres.connectionString });
    const tempRoot = await mkdtemp(join(tmpdir(), "viji-phase12-resources-"));
    const resourceRoot = join(tempRoot, "viji-files");
    const libraryRoot = join(resourceRoot, "library");
    await mkdir(libraryRoot, { recursive: true });
    await writeFile(
      join(libraryRoot, "viji_profile.txt"),
      "Vijayalakshmi profile, resume, portfolio, and education notes.",
      "utf8"
    );
    await writeFile(
      join(libraryRoot, "viji_12_marksheet.txt"),
      "Vijayalakshmi twelfth standard marksheet with physics and maths marks.",
      "utf8"
    );
    await writeFile(join(tempRoot, "outside.txt"), "outside file", "utf8");

    const server = createApiServer({
      db: pool,
      token,
      env: {
        ...process.env,
        VIJI_API_TOKEN: token,
        VIJI_DATA_ROOT: tempRoot,
        VIJI_RESOURCE_ROOT: resourceRoot,
        VIJI_STORAGE_PROFILE: "large-200gb"
      }
    });

    try {
      const baseUrl = await listen(server);
      const cliEnv = {
        ...process.env,
        VIJI_API_BASE_URL: baseUrl,
        VIJI_API_TOKEN: token
      };

      const indexed = await apiJson(baseUrl, "/resources/index", {
        method: "POST",
        body: {
          scope: "library"
        }
      });
      assert.equal(indexed.status, 200);
      assert.equal(indexed.body.count, 2);
      assert.deepEqual(
        indexed.body.resources.map((resource) => resource.registeredFileName),
        ["viji_12_marksheet.txt", "viji_profile.txt"]
      );
      assert.match(
        indexed.body.resources[0].contentSummary,
        /twelfth standard marksheet/
      );
      assert.equal("storageUri" in indexed.body.resources[0], false);

      const listed = await cliJson(["resources", "list"], cliEnv);
      assert.equal(listed.resources.length, 2);

      const registered = await cliJson(
        [
          "resources",
          "register",
          "library/viji_12_marksheet.txt",
          "--alias",
          "12th marksheet",
          "--title",
          "Viji 12th Marksheet",
          "--yes"
        ],
        cliEnv
      );
      assert.equal(registered.resource.registeredFileName, "viji_12_marksheet.txt");
      assert.ok(registered.resource.aliases.includes("12th marksheet"));
      assert.equal(registered.resource.title, "Viji 12th Marksheet");

      const rejected = captureOutput();
      const rejectedExit = await runCli(
        ["resources", "register", "../outside.txt", "--yes", "--json"],
        {
          env: cliEnv,
          output: rejected.output
        }
      );
      assert.equal(rejectedExit, 1);
      assert.match(rejected.stderr, /Resource path must stay under resource root/);

      const outsideRows = await pool.query(`
        SELECT count(*)::integer AS count
        FROM res_file_assets
        WHERE res_file_asset_storage_uri LIKE '%outside.txt'
      `);
      assert.equal(outsideRows.rows[0].count, 0);
    } finally {
      await closeServer(server);
      await pool.end();
    }
  } finally {
    postgres.stop();
  }
});
