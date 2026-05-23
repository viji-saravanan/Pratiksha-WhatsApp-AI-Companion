import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, rename } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

const DEFAULT_HOST_DATA_ROOT = "./.pratiksha-data";
const CACHE_DB_FILES = [
  "wacli.db",
  "wacli.db-wal",
  "wacli.db-shm",
  "wacli.db-journal"
];

export function resolveWacliStorePreflightConfig(env = process.env) {
  const dataRoot =
    env.VIJI_DATA_ROOT ||
    env.PRATIKSHA_HOST_DATA_ROOT ||
    DEFAULT_HOST_DATA_ROOT;
  const storePath = resolve(
    env.VIJI_WACLI_STORE || join(dataRoot, "wacli", "store")
  );
  const backupRoot = resolve(
    env.VIJI_WACLI_BACKUP_ROOT || join(storePath, "..", "backup")
  );

  return {
    storePath,
    backupRoot,
    sqliteBin: env.VIJI_SQLITE_BIN || "sqlite3",
    wacliBin: env.VIJI_WACLI_BIN || "wacli",
    timestamp: env.VIJI_WACLI_PREFLIGHT_TIMESTAMP || timestampForFile(),
    warmupEnabled: env.VIJI_WACLI_PREFLIGHT_SYNC_ENABLED !== "false",
    warmupIdleExit: env.VIJI_WACLI_PREFLIGHT_SYNC_IDLE_EXIT || "30s",
    warmupMaxReconnect:
      env.VIJI_WACLI_PREFLIGHT_SYNC_MAX_RECONNECT || "45s",
    warmupRefreshContacts:
      env.VIJI_WACLI_PREFLIGHT_SYNC_REFRESH_CONTACTS !== "false",
    warmupRefreshGroups:
      env.VIJI_WACLI_PREFLIGHT_SYNC_REFRESH_GROUPS === "true",
    warmupTimeoutMs: positiveInteger(
      env.VIJI_WACLI_PREFLIGHT_SYNC_TIMEOUT_MS,
      90000
    ),
    requiredChatQueries: commaSeparated(
      env.VIJI_WACLI_PREFLIGHT_REQUIRED_CHAT_QUERIES
    ),
    requiredChatCheckTimeoutMs: positiveInteger(
      env.VIJI_WACLI_PREFLIGHT_CHAT_CHECK_TIMEOUT_MS,
      15000
    )
  };
}

export async function preflightWacliStore(input = {}) {
  const config = {
    ...resolveWacliStorePreflightConfig(input.env),
    ...input.config
  };
  const pathExists = input.pathExists ?? existsSync;
  const sqliteIntegrityCheck =
    input.sqliteIntegrityCheck ?? defaultSqliteIntegrityCheck;
  const sqliteCacheStats = input.sqliteCacheStats ?? defaultSqliteCacheStats;
  const warmCache = input.warmCache ?? defaultWarmWacliCache;
  const requiredChatCheck =
    input.requiredChatCheck ?? defaultRequiredChatCheck;
  const moveFile = input.moveFile ?? rename;
  const makeDirectory = input.makeDirectory ?? mkdir;

  const sessionDb = join(config.storePath, "session.db");
  const cacheDb = join(config.storePath, "wacli.db");
  const actions = [];

  if (!pathExists(config.storePath)) {
    return failed("store_missing", {
      storePath: config.storePath,
      backupRoot: config.backupRoot,
      actions,
      message: "WhatsApp store directory is missing. Run corepack pnpm wa:auth:login first."
    });
  }

  const sessionCheck = await sqliteIntegrityCheck(sessionDb, config);
  if (sessionCheck.status === "missing") {
    return failed("session_missing", {
      storePath: config.storePath,
      backupRoot: config.backupRoot,
      actions,
      message: "WhatsApp session.db is missing. Run corepack pnpm wa:auth:login first."
    });
  }
  if (sessionCheck.status !== "ok") {
    return failed("session_malformed", {
      storePath: config.storePath,
      backupRoot: config.backupRoot,
      actions,
      message:
        "WhatsApp session.db is malformed. It was not modified; re-authentication may be required.",
      sessionCheck
    });
  }

  const cacheCheck = await sqliteIntegrityCheck(cacheDb, config);
  if (cacheCheck.status === "ok") {
    const cacheStats = await sqliteCacheStats(cacheDb, config);
    if (isEmptyCache(cacheStats)) {
      actions.push({
        type: "cache_empty",
        file: cacheDb,
        message:
          "wacli.db cache has no chats or messages; preflight will run a bounded sync before startup."
      });
      return warmCacheIfNeeded({
        config,
        actions,
        warmCache,
        sqliteIntegrityCheck,
        sqliteCacheStats,
        requiredChatCheck,
        sessionCheck,
        cacheStatus: "empty"
      });
    }

    const requiredChats = await requiredChatCheck(config);
    if (requiredChats.status !== "skipped" && requiredChats.status !== "ok") {
      actions.push({
        type: "required_chat_missing",
        result: requiredChats,
        message:
          "wacli cache is healthy but does not contain required allowlisted chats yet."
      });
      return warmCacheIfNeeded({
        config,
        actions,
        warmCache,
        sqliteIntegrityCheck,
        sqliteCacheStats,
        requiredChatCheck,
        sessionCheck,
        cacheStatus: "required_chat_missing"
      });
    }

    return completed({
      storePath: config.storePath,
      backupRoot: config.backupRoot,
      actions,
      sessionStatus: sessionCheck.status,
      cacheStatus: cacheCheck.status,
      cacheStats,
      requiredChats
    });
  }
  if (cacheCheck.status === "missing") {
    actions.push({
      type: "cache_missing",
      file: cacheDb,
      message: "wacli.db cache is missing; wacli will rebuild it during sync."
    });
    return warmCacheIfNeeded({
      config,
      actions,
      warmCache,
      sqliteIntegrityCheck,
      sqliteCacheStats,
      requiredChatCheck,
      sessionCheck,
      cacheStatus: cacheCheck.status
    });
  }

  const backedUp = [];
  await makeDirectory(config.backupRoot, { recursive: true });
  for (const fileName of CACHE_DB_FILES) {
    const source = join(config.storePath, fileName);
    if (!pathExists(source)) {
      continue;
    }
    const target = join(
      config.backupRoot,
      `${basename(fileName)}.${config.timestamp}.corrupt`
    );
    await moveFile(source, target);
    backedUp.push({ source, target });
  }

  actions.push({
    type: "cache_rebuilt",
    reason: cacheCheck.status,
    message:
      "Malformed disposable wacli cache was backed up and removed; wacli will rebuild it during sync.",
    files: backedUp
  });

  return warmCacheIfNeeded({
    config,
    actions,
    warmCache,
    sqliteIntegrityCheck,
    sqliteCacheStats,
    requiredChatCheck,
    sessionCheck,
    cacheStatus: cacheCheck.status
  });
}

async function warmCacheIfNeeded(input) {
  const {
    config,
    actions,
    warmCache,
    sqliteIntegrityCheck,
    sqliteCacheStats,
    requiredChatCheck,
    sessionCheck,
    cacheStatus
  } = input;
  const cacheDb = join(config.storePath, "wacli.db");

  if (!config.warmupEnabled) {
    actions.push({
      type: "cache_warmup_skipped",
      message:
        "wacli cache warm-up is disabled; live worker may idle until a later sync fills the cache."
    });
    return completed({
      storePath: config.storePath,
      backupRoot: config.backupRoot,
      actions,
      sessionStatus: sessionCheck.status,
      cacheStatus
    });
  }

  const warmup = await warmCache(config);
  actions.push({
    type: warmup.status === "ok" ? "cache_warmed" : "cache_warm_failed",
    result: warmup
  });

  if (warmup.status !== "ok") {
    const partialCheck = await sqliteIntegrityCheck(cacheDb, config);
    const partialStats =
      partialCheck.status === "ok"
        ? await sqliteCacheStats(cacheDb, config)
        : { status: "unavailable" };
    const partialRequiredChats =
      partialCheck.status === "ok" && !isEmptyCache(partialStats)
        ? await requiredChatCheck(config)
        : { status: "skipped", queries: [] };
    if (
      partialCheck.status === "ok" &&
      !isEmptyCache(partialStats) &&
      (partialRequiredChats.status === "skipped" ||
        partialRequiredChats.status === "ok")
    ) {
      actions.push({
        type: "cache_warm_partial_success",
        message:
          "wacli warm-up did not exit cleanly, but the rebuilt cache is healthy and contains pollable rows.",
        cacheStats: partialStats
      });
      return completed({
        storePath: config.storePath,
        backupRoot: config.backupRoot,
        actions,
        sessionStatus: sessionCheck.status,
        cacheStatus,
        cacheStats: partialStats,
        requiredChats: partialRequiredChats
      });
    }

    return failed("cache_warm_failed", {
      storePath: config.storePath,
      backupRoot: config.backupRoot,
      actions,
      message:
        "wacli cache warm-up failed. WhatsApp auth may be stale or the network may be unavailable.",
      cacheCheck: partialCheck,
      cacheStats: partialStats,
      requiredChats: partialRequiredChats
    });
  }

  const warmedCheck = await sqliteIntegrityCheck(cacheDb, config);
  if (warmedCheck.status !== "ok") {
    return failed("cache_warm_malformed", {
      storePath: config.storePath,
      backupRoot: config.backupRoot,
      actions,
      message:
        "wacli cache warm-up finished but the rebuilt wacli.db is not healthy.",
      cacheCheck: warmedCheck
    });
  }

  const warmedStats = await sqliteCacheStats(cacheDb, config);
  if (isEmptyCache(warmedStats)) {
    return failed("cache_warm_empty", {
      storePath: config.storePath,
      backupRoot: config.backupRoot,
      actions,
      message:
        "wacli cache warm-up finished but no chats/messages were available to poll.",
      cacheStats: warmedStats
    });
  }

  const requiredChats = await requiredChatCheck(config);
  if (requiredChats.status !== "skipped" && requiredChats.status !== "ok") {
    return failed("required_chat_missing", {
      storePath: config.storePath,
      backupRoot: config.backupRoot,
      actions,
      message:
        "wacli cache warm-up finished but required allowlisted chats are still missing.",
      cacheStats: warmedStats,
      requiredChats
    });
  }

  return completed({
    storePath: config.storePath,
    backupRoot: config.backupRoot,
    actions,
    sessionStatus: sessionCheck.status,
    cacheStatus,
    cacheStats: warmedStats,
    requiredChats
  });
}

function completed(result) {
  return {
    status: "completed",
    ...result
  };
}

function failed(reason, result) {
  return {
    status: "failed",
    reason,
    ...result
  };
}

function defaultSqliteIntegrityCheck(filePath, config) {
  if (!existsSync(filePath)) {
    return { status: "missing", filePath };
  }

  const result = spawnSync(
    config.sqliteBin,
    [filePath, "PRAGMA integrity_check;"],
    {
      encoding: "utf8",
      timeout: 10000
    }
  );

  if (result.error) {
    return {
      status: result.error.code === "ENOENT" ? "sqlite_missing" : "check_failed",
      filePath,
      error: result.error.message
    };
  }

  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim();
  if (result.status === 0 && output === "ok") {
    return { status: "ok", filePath };
  }

  return {
    status: "malformed",
    filePath,
    exitCode: result.status,
    output
  };
}

function defaultSqliteCacheStats(filePath, config) {
  if (!existsSync(filePath)) {
    return { status: "missing", filePath };
  }

  const result = spawnSync(
    config.sqliteBin,
    [filePath, "select count(*) from chats; select count(*) from messages;"],
    {
      encoding: "utf8",
      timeout: 10000
    }
  );

  if (result.error) {
    return {
      status: result.error.code === "ENOENT" ? "sqlite_missing" : "check_failed",
      filePath,
      error: result.error.message
    };
  }
  if (result.status !== 0) {
    return {
      status: "query_failed",
      filePath,
      exitCode: result.status,
      output: `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim()
    };
  }

  const values = String(result.stdout ?? "")
    .trim()
    .split(/\r?\n/)
    .map((line) => Number(line.trim()));

  if (values.length < 2 || values.some((value) => !Number.isFinite(value))) {
    return {
      status: "query_failed",
      filePath,
      output: String(result.stdout ?? "").trim()
    };
  }

  return {
    status: "ok",
    filePath,
    chats: values[0],
    messages: values[1]
  };
}

function defaultWarmWacliCache(config) {
  const args = [
    "sync",
    "--once",
    "--idle-exit",
    config.warmupIdleExit,
    "--max-reconnect",
    config.warmupMaxReconnect
  ];
  if (config.warmupRefreshContacts) {
    args.push("--refresh-contacts");
  }
  if (config.warmupRefreshGroups) {
    args.push("--refresh-groups");
  }
  args.push("--json", "--store", config.storePath);

  const result = spawnSync(config.wacliBin, args, {
    encoding: "utf8",
    timeout: config.warmupTimeoutMs
  });

  if (result.error) {
    return {
      status: result.error.code === "ETIMEDOUT" ? "timeout" : "failed",
      command: config.wacliBin,
      args,
      error: result.error.message
    };
  }

  return {
    status: result.status === 0 ? "ok" : "failed",
    command: config.wacliBin,
    args,
    exitCode: result.status,
    stdout: String(result.stdout ?? "").slice(-2000),
    stderr: String(result.stderr ?? "").slice(-2000)
  };
}

function defaultRequiredChatCheck(config) {
  if (config.requiredChatQueries.length === 0) {
    return { status: "skipped", queries: [] };
  }

  const queries = config.requiredChatQueries.map((query) => {
    const args = [
      "chats",
      "list",
      "--query",
      query,
      "--limit",
      "5",
      "--json",
      "--store",
      config.storePath
    ];
    const result = spawnSync(config.wacliBin, args, {
      encoding: "utf8",
      timeout: config.requiredChatCheckTimeoutMs
    });

    if (result.error) {
      return {
        query,
        status: result.error.code === "ETIMEDOUT" ? "timeout" : "failed",
        error: result.error.message
      };
    }
    if (result.status !== 0) {
      return {
        query,
        status: "failed",
        exitCode: result.status,
        output: `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim()
      };
    }

    const matches = countWacliChats(result.stdout);
    return {
      query,
      status: matches > 0 ? "matched" : "missing",
      matches
    };
  });

  return {
    status: queries.every((query) => query.status === "matched")
      ? "ok"
      : "missing",
    queries
  };
}

function countWacliChats(stdout) {
  try {
    const payload = JSON.parse(stdout);
    if (Array.isArray(payload?.data)) {
      return payload.data.length;
    }
    if (Array.isArray(payload?.data?.chats)) {
      return payload.data.chats.length;
    }
  } catch {
    return 0;
  }
  return 0;
}

function isEmptyCache(stats) {
  return stats.status === "ok" && stats.chats === 0 && stats.messages === 0;
}

function commaSeparated(value) {
  return String(value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function timestampForFile(date = new Date()) {
  return date.toISOString().replaceAll(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}
