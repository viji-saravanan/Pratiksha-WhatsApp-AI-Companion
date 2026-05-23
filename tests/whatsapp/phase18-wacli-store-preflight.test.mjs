import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const { preflightWacliStore, resolveWacliStorePreflightConfig } = await import(
  "../../scripts/lib/wacli-store-preflight.mjs"
);

test("wacli store preflight preserves session and rebuilds malformed cache", async () => {
  const root = await mkdtemp(join(tmpdir(), "viji-wacli-preflight-"));
  try {
    const storePath = join(root, "wacli", "store");
    const backupRoot = join(root, "wacli", "backup");
    await mkdir(storePath, { recursive: true });
    await writeFile(join(storePath, "session.db"), "session");
    await writeFile(join(storePath, "wacli.db"), "cache");
    await writeFile(join(storePath, "wacli.db-wal"), "wal");

    const result = await preflightWacliStore({
      config: {
        storePath,
        backupRoot,
        timestamp: "20260523T104800Z",
        warmupEnabled: false
      },
      sqliteIntegrityCheck: async (filePath) => {
        if (filePath.endsWith("session.db")) {
          return { status: "ok", filePath };
        }
        return { status: "malformed", filePath, output: "database disk image is malformed" };
      }
    });

    assert.equal(result.status, "completed");
    assert.equal(result.actions[0].type, "cache_rebuilt");
    assert.equal(existsSync(join(storePath, "session.db")), true);
    assert.equal(existsSync(join(storePath, "wacli.db")), false);
    assert.equal(existsSync(join(storePath, "wacli.db-wal")), false);
    assert.equal(
      await readFile(
        join(backupRoot, "wacli.db.20260523T104800Z.corrupt"),
        "utf8"
      ),
      "cache"
    );
    assert.equal(
      await readFile(
        join(backupRoot, "wacli.db-wal.20260523T104800Z.corrupt"),
        "utf8"
      ),
      "wal"
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("wacli store preflight fails without modifying malformed session", async () => {
  const root = await mkdtemp(join(tmpdir(), "viji-wacli-preflight-"));
  try {
    const storePath = join(root, "wacli", "store");
    const backupRoot = join(root, "wacli", "backup");
    await mkdir(storePath, { recursive: true });
    await writeFile(join(storePath, "session.db"), "bad-session");
    await writeFile(join(storePath, "wacli.db"), "cache");

    const result = await preflightWacliStore({
      config: { storePath, backupRoot, warmupEnabled: false },
      sqliteIntegrityCheck: async (filePath) => {
        if (filePath.endsWith("session.db")) {
          return { status: "malformed", filePath, output: "bad session" };
        }
        return { status: "ok", filePath };
      }
    });

    assert.equal(result.status, "failed");
    assert.equal(result.reason, "session_malformed");
    assert.equal(await readFile(join(storePath, "session.db"), "utf8"), "bad-session");
    assert.equal(await readFile(join(storePath, "wacli.db"), "utf8"), "cache");
    assert.equal(existsSync(backupRoot), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("wacli store preflight allows missing disposable cache", async () => {
  const root = await mkdtemp(join(tmpdir(), "viji-wacli-preflight-"));
  try {
    const storePath = join(root, "wacli", "store");
    await mkdir(storePath, { recursive: true });
    await writeFile(join(storePath, "session.db"), "session");

    const result = await preflightWacliStore({
      config: {
        storePath,
        backupRoot: join(root, "wacli", "backup"),
        warmupEnabled: false
      },
      sqliteIntegrityCheck: async (filePath) => {
        if (filePath.endsWith("session.db")) {
          return { status: "ok", filePath };
        }
        return { status: "missing", filePath };
      }
    });

    assert.equal(result.status, "completed");
    assert.equal(result.actions[0].type, "cache_missing");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("wacli store preflight resolves backup root beside store by default", () => {
  const config = resolveWacliStorePreflightConfig({
    VIJI_DATA_ROOT: "/tmp/pratiksha-data"
  });

  assert.equal(config.storePath, "/tmp/pratiksha-data/wacli/store");
  assert.equal(config.backupRoot, "/tmp/pratiksha-data/wacli/backup");
});

test("wacli store preflight warms empty cache before live startup", async () => {
  const root = await mkdtemp(join(tmpdir(), "viji-wacli-preflight-"));
  try {
    const storePath = join(root, "wacli", "store");
    await mkdir(storePath, { recursive: true });
    await writeFile(join(storePath, "session.db"), "session");
    await writeFile(join(storePath, "wacli.db"), "empty-cache");
    let statsCalls = 0;
    const warmCalls = [];

    const result = await preflightWacliStore({
      config: {
        storePath,
        backupRoot: join(root, "wacli", "backup"),
        warmupEnabled: true
      },
      sqliteIntegrityCheck: async (filePath) => ({ status: "ok", filePath }),
      sqliteCacheStats: async (filePath) => {
        statsCalls += 1;
        return statsCalls === 1
          ? { status: "ok", filePath, chats: 0, messages: 0 }
          : { status: "ok", filePath, chats: 2, messages: 12 };
      },
      warmCache: async (config) => {
        warmCalls.push(config.storePath);
        return { status: "ok" };
      }
    });

    assert.equal(result.status, "completed");
    assert.equal(result.actions[0].type, "cache_empty");
    assert.equal(result.actions[1].type, "cache_warmed");
    assert.deepEqual(warmCalls, [storePath]);
    assert.deepEqual(result.cacheStats, {
      status: "ok",
      filePath: join(storePath, "wacli.db"),
      chats: 2,
      messages: 12
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("wacli store preflight fails startup when required warm-up fails", async () => {
  const root = await mkdtemp(join(tmpdir(), "viji-wacli-preflight-"));
  try {
    const storePath = join(root, "wacli", "store");
    await mkdir(storePath, { recursive: true });
    await writeFile(join(storePath, "session.db"), "session");

    const result = await preflightWacliStore({
      config: {
        storePath,
        backupRoot: join(root, "wacli", "backup"),
        warmupEnabled: true
      },
      sqliteIntegrityCheck: async (filePath) =>
        filePath.endsWith("session.db")
          ? { status: "ok", filePath }
          : { status: "missing", filePath },
      warmCache: async () => ({ status: "failed", exitCode: 1 })
    });

    assert.equal(result.status, "failed");
    assert.equal(result.reason, "cache_warm_failed");
    assert.equal(result.actions[0].type, "cache_missing");
    assert.equal(result.actions[1].type, "cache_warm_failed");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("wacli store preflight accepts timed-out warm-up if cache became usable", async () => {
  const root = await mkdtemp(join(tmpdir(), "viji-wacli-preflight-"));
  try {
    const storePath = join(root, "wacli", "store");
    await mkdir(storePath, { recursive: true });
    await writeFile(join(storePath, "session.db"), "session");
    let warmed = false;

    const result = await preflightWacliStore({
      config: {
        storePath,
        backupRoot: join(root, "wacli", "backup"),
        warmupEnabled: true
      },
      sqliteIntegrityCheck: async (filePath) =>
        filePath.endsWith("session.db") || warmed
          ? { status: "ok", filePath }
          : { status: "missing", filePath },
      sqliteCacheStats: async (filePath) => {
        return { status: "ok", filePath, chats: 2, messages: 3 };
      },
      warmCache: async () => {
        warmed = true;
        return { status: "timeout", error: "ETIMEDOUT" };
      }
    });

    assert.equal(result.status, "completed");
    assert.equal(result.actions[0].type, "cache_missing");
    assert.equal(result.actions[1].type, "cache_warm_failed");
    assert.equal(result.actions[2].type, "cache_warm_partial_success");
    assert.deepEqual(result.cacheStats, {
      status: "ok",
      filePath: join(storePath, "wacli.db"),
      chats: 2,
      messages: 3
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("wacli store preflight requires configured allowlisted chat matches", async () => {
  const root = await mkdtemp(join(tmpdir(), "viji-wacli-preflight-"));
  try {
    const storePath = join(root, "wacli", "store");
    await mkdir(storePath, { recursive: true });
    await writeFile(join(storePath, "session.db"), "session");
    await writeFile(join(storePath, "wacli.db"), "cache");
    let requiredCheckCalls = 0;

    const result = await preflightWacliStore({
      config: {
        storePath,
        backupRoot: join(root, "wacli", "backup"),
        warmupEnabled: true
      },
      sqliteIntegrityCheck: async (filePath) => ({ status: "ok", filePath }),
      sqliteCacheStats: async (filePath) => ({
        status: "ok",
        filePath,
        chats: 2,
        messages: 3
      }),
      requiredChatCheck: async () => {
        requiredCheckCalls += 1;
        return requiredCheckCalls === 1
          ? {
              status: "missing",
              queries: [{ query: "required@lid", status: "missing", matches: 0 }]
            }
          : {
              status: "ok",
              queries: [{ query: "required@lid", status: "matched", matches: 1 }]
            };
      },
      warmCache: async () => ({ status: "ok" })
    });

    assert.equal(result.status, "completed");
    assert.equal(result.actions[0].type, "required_chat_missing");
    assert.equal(result.actions[1].type, "cache_warmed");
    assert.equal(result.requiredChats.status, "ok");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
