import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { assertSuccess, run } from "../helpers/disposable-postgres.mjs";

const build = run("corepack", [
  "pnpm",
  "--filter",
  "@viji/wa-adapter-wacli",
  "build"
]);
assertSuccess(build, "build @viji/wa-adapter-wacli");

const {
  buildWacliArgs,
  classifyWacliFailureText,
  createWacliClient,
  parseWacliAuthStatus,
  parseWacliChats,
  parseWacliDoctor,
  parseWacliJsonOutput,
  parseWacliMarkRead,
  parseWacliMediaDownload,
  parseWacliMessages,
  parseWacliSend,
  parseWacliSync,
  parseWacliTimeoutMs,
  runLiveReadSmokeFromEnv,
  runLiveSendSmokeFromEnv,
  runWacliProcess
} = await import("../../apps/wa-adapter-wacli/dist/index.js");

function fixture(name) {
  return JSON.parse(readFileSync(`fixtures/wacli/${name}`, "utf8"));
}

function createRunner(stdoutPayload, exitCode = 0, stderr = "") {
  const calls = [];
  return {
    calls,
    runner: async (command, args) => {
      calls.push({ command, args });
      return {
        exitCode,
        stdout:
          typeof stdoutPayload === "string"
            ? stdoutPayload
            : JSON.stringify(stdoutPayload),
        stderr
      };
    }
  };
}

function createRoutingRunner(routes) {
  const calls = [];
  return {
    calls,
    runner: async (command, args) => {
      calls.push({ command, args });
      const route = routes.find(({ startsWith }) =>
        startsWith.every((value, index) => args[index] === value)
      );
      if (!route) {
        return {
          exitCode: 1,
          stdout: "",
          stderr: `No fixture route for ${command} ${args.join(" ")}`
        };
      }
      return {
        exitCode: route.exitCode ?? 0,
        stdout:
          typeof route.stdout === "string"
            ? route.stdout
            : JSON.stringify(route.stdout),
        stderr: route.stderr ?? ""
      };
    }
  };
}

function testConfig(overrides = {}) {
  return {
    bin: "wacli",
    storePath: "/data/pratiksha/wacli/store",
    timeout: "30s",
    syncTimeout: "75s",
    liveSmokeEnabled: false,
    liveReadSmokeEnabled: false,
    liveReadSmokeQuery: "Vijayalakshmi Saravanan",
    liveReadSmokeChatLimit: 5,
    liveReadSmokeMessageLimit: 5,
    markReadBin: "wacli-mark-read",
    markReadEnabled: true,
    markReadTimeout: "5s",
    liveSendEnabled: false,
    liveSendSmokeEnabled: false,
    liveSendSmokeTo: "",
    liveSendSmokeMessage: "Synthetic smoke test.",
    ...overrides
  };
}

async function readSourceTree(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const chunks = [];

  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      chunks.push(await readSourceTree(path));
    } else if (entry.isFile() && path.endsWith(".ts")) {
      chunks.push(await readFile(path, "utf8"));
    }
  }

  return chunks.join("\n");
}

test("Phase 8 fixture parsers normalize wacli command outputs", () => {
  const doctor = parseWacliDoctor(fixture("doctor-ok-redacted.json"));
  assert.equal(doctor.storeDir, "/data/pratiksha/wacli/store");
  assert.equal(doctor.authenticated, true);
  assert.equal(doctor.connected, true);
  assert.equal(doctor.lockHeld, false);

  const auth = parseWacliAuthStatus(fixture("auth-status-redacted.json"));
  assert.equal(auth.authenticated, false);
  assert.equal(auth.connected, false);

  const chats = parseWacliChats(fixture("chats-list-redacted.json"));
  assert.equal(chats.length, 2);
  assert.equal(chats[0].chatId, "vijayalakshmi.saravanan.redacted@s.whatsapp.net");
  assert.equal(chats[1].type, "group");

  const liveShapeChats = parseWacliChats(
    fixture("chats-list-live-shape-redacted.json")
  );
  assert.equal(liveShapeChats.length, 1);
  assert.equal(
    liveShapeChats[0].chatId,
    "vijayalakshmi.saravanan.redacted@s.whatsapp.net"
  );
  assert.equal(liveShapeChats[0].type, "dm");
  assert.equal(liveShapeChats[0].lastMessageAt.toISOString(), "2026-05-01T10:05:00.000Z");

  const messages = parseWacliMessages(fixture("messages-search-redacted.json"));
  assert.equal(messages.rejected.length, 0);
  assert.equal(messages.messages.length, 1);
  assert.equal(messages.messages[0].senderDisplayName, "Vijayalakshmi Saravanan");

  const liveShapeMessages = parseWacliMessages(
    fixture("messages-list-live-shape-redacted.json")
  );
  assert.equal(liveShapeMessages.rejected.length, 0);
  assert.equal(liveShapeMessages.messages.length, 2);
  assert.equal(liveShapeMessages.messages[0].externalMessageId, "wamid.redacted.vijayalakshmi.live.0001");
  assert.equal(liveShapeMessages.messages[0].fromMe, false);
  assert.equal(liveShapeMessages.messages[1].fromMe, true);

  const sync = parseWacliSync(fixture("sync-once-redacted.json"));
  assert.equal(sync.state, "completed");
  assert.equal(sync.messagesSeen, 3);
  assert.equal(sync.messagesImported, 1);

  const sentText = parseWacliSend(fixture("send-text-redacted.json"));
  assert.equal(sentText.externalMessageId, "wamid.redacted.outbound.text.0001");

  const sentFile = parseWacliSend(fixture("send-file-redacted.json"));
  assert.equal(sentFile.externalMessageId, "wamid.redacted.outbound.file.0001");

  const media = parseWacliMediaDownload(fixture("media-download-redacted.json"));
  assert.equal(media.messageId, "wamid.redacted.vijayalakshmi.media.0001");
  assert.equal(media.mime, "application/pdf");
  assert.equal(media.sizeBytes, 12345);

  const readReceipt = parseWacliMarkRead({
    success: true,
    data: {
      chatId: "vijayalakshmi.saravanan.redacted@s.whatsapp.net",
      messageIds: ["wamid.redacted.vijayalakshmi.live.0001"],
      markedAt: "2026-05-01T10:06:00.000Z"
    }
  });
  assert.equal(
    readReceipt.chatId,
    "vijayalakshmi.saravanan.redacted@s.whatsapp.net"
  );
  assert.deepEqual(readReceipt.messageIds, [
    "wamid.redacted.vijayalakshmi.live.0001"
  ]);
  assert.equal(readReceipt.markedAt.toISOString(), "2026-05-01T10:06:00.000Z");

  assert.throws(
    () => parseWacliDoctor(fixture("error-auth-required-redacted.json")),
    /auth required/
  );
});

test("wacli failure classification covers Phase 8 failure classes", () => {
  assert.deepEqual(classifyWacliFailureText("auth required: login first"), {
    failureClass: "auth",
    code: "adapter.auth_required",
    retryable: false
  });
  assert.deepEqual(classifyWacliFailureText("database is locked by another sync"), {
    failureClass: "store_lock",
    code: "adapter.store_locked",
    retryable: true
  });
  assert.deepEqual(classifyWacliFailureText("rate limit backoff active"), {
    failureClass: "backoff",
    code: "adapter.backoff_active",
    retryable: true
  });
  assert.deepEqual(classifyWacliFailureText("network i/o timeout"), {
    failureClass: "network",
    code: "adapter.network_unavailable",
    retryable: true
  });
  assert.deepEqual(classifyWacliFailureText("permission denied opening store dir"), {
    failureClass: "storage",
    code: "adapter.storage_unavailable",
    retryable: false
  });
  assert.deepEqual(classifyWacliFailureText("recipient rejected send", "send.text"), {
    failureClass: "send",
    code: "adapter.send_failed",
    retryable: true
  });
  assert.deepEqual(classifyWacliFailureText("unexpected adapter failure"), {
    failureClass: "unknown",
    code: "adapter.unknown",
    retryable: true
  });
});

test("wacli parser extracts JSON from noisy sync output", () => {
  const parsed = parseWacliJsonOutput(
    "Connected.\n" +
      "{\"success\":true,\"data\":{\"state\":\"completed\",\"messages_imported\":2},\"error\":null}\n" +
      "Idle for 2s, exiting.\n"
  );
  const sync = parseWacliSync(parsed);

  assert.equal(sync.state, "completed");
  assert.equal(sync.messagesImported, 2);
});

test("typed wacli wrappers build live command shapes and gate sends", async () => {
  assert.deepEqual(
    buildWacliArgs(testConfig(), ["doctor"]),
    [
      "doctor",
      "--json",
      "--store",
      "/data/pratiksha/wacli/store",
      "--timeout",
      "30s"
    ]
  );

  const disabled = createRunner(fixture("send-text-redacted.json"));
  const disabledSend = await createWacliClient(testConfig(), disabled.runner).sendText({
    to: "vijayalakshmi.saravanan.redacted@s.whatsapp.net",
    message: "Synthetic disabled send."
  });
  assert.equal(disabledSend.ok, false);
  assert.equal(disabledSend.code, "system.not_implemented");
  assert.equal(disabled.calls.length, 0);

  const liveText = createRunner(fixture("send-text-redacted.json"));
  const textResult = await createWacliClient(
    testConfig({ liveSendEnabled: true }),
    liveText.runner
  ).sendText({
    to: "vijayalakshmi.saravanan.redacted@s.whatsapp.net",
    message: "Synthetic live-send shape only."
  });
  assert.equal(textResult.ok, true);
  assert.deepEqual(liveText.calls[0].args, [
    "send",
    "text",
    "--to",
    "vijayalakshmi.saravanan.redacted@s.whatsapp.net",
    "--message",
    "Synthetic live-send shape only.",
    "--json",
    "--store",
    "/data/pratiksha/wacli/store",
    "--timeout",
    "30s"
  ]);

  const liveFile = createRunner(fixture("send-file-redacted.json"));
  const fileResult = await createWacliClient(
    testConfig({ liveSendEnabled: true }),
    liveFile.runner
  ).sendFile({
    to: "vijayalakshmi.saravanan.redacted@s.whatsapp.net",
    filePath: "/data/pratiksha/viji-files/library/redacted.pdf",
    filename: "redacted.pdf",
    caption: "Synthetic caption.",
    mime: "application/pdf"
  });
  assert.equal(fileResult.ok, true);
  assert.deepEqual(liveFile.calls[0].args, [
    "send",
    "file",
    "--to",
    "vijayalakshmi.saravanan.redacted@s.whatsapp.net",
    "--file",
    "/data/pratiksha/viji-files/library/redacted.pdf",
    "--caption",
    "Synthetic caption.",
    "--filename",
    "redacted.pdf",
    "--mime",
    "application/pdf",
    "--json",
    "--store",
    "/data/pratiksha/wacli/store",
    "--timeout",
    "30s"
  ]);

  const disabledMarkRead = createRunner({
    success: true,
    data: { messageIds: ["wamid.redacted.vijayalakshmi.live.0001"] }
  });
  const disabledMarkReadResult = await createWacliClient(
    testConfig({ markReadEnabled: false }),
    disabledMarkRead.runner
  ).markRead({
    chatId: "vijayalakshmi.saravanan.redacted@s.whatsapp.net",
    messageIds: ["wamid.redacted.vijayalakshmi.live.0001"]
  });
  assert.equal(disabledMarkReadResult.ok, false);
  assert.equal(disabledMarkRead.calls.length, 0);

  const liveMarkRead = createRunner({
    success: true,
    data: {
      chatId: "vijayalakshmi.saravanan.redacted@s.whatsapp.net",
      messageIds: ["wamid.redacted.vijayalakshmi.live.0001"],
      markedAt: "2026-05-01T10:06:00.000Z"
    }
  });
  const markReadResult = await createWacliClient(
    testConfig({
      markReadEnabled: true,
      markReadBin: "wacli-mark-read",
      markReadTimeout: "5s"
    }),
    liveMarkRead.runner
  ).markRead({
    chatId: "vijayalakshmi.saravanan.redacted@s.whatsapp.net",
    messageIds: ["wamid.redacted.vijayalakshmi.live.0001"],
    timestamp: new Date("2026-05-01T10:06:00.000Z")
  });
  assert.equal(markReadResult.ok, true);
  assert.deepEqual(liveMarkRead.calls[0].args, [
    "--chat",
    "vijayalakshmi.saravanan.redacted@s.whatsapp.net",
    "--id",
    "wamid.redacted.vijayalakshmi.live.0001",
    "--timestamp",
    "2026-05-01T10:06:00.000Z",
    "--json",
    "--store",
    "/data/pratiksha/wacli/store",
    "--timeout",
    "5s"
  ]);
  assert.equal(liveMarkRead.calls[0].command, "wacli-mark-read");
});

test("wacli process runner enforces parent-side timeouts", async () => {
  assert.equal(parseWacliTimeoutMs("30s"), 30_000);
  assert.equal(parseWacliTimeoutMs("250ms"), 250);
  assert.equal(parseWacliTimeoutMs("1m"), 60_000);

  const result = await runWacliProcess(
    process.execPath,
    ["-e", "setTimeout(() => {}, 1000)"],
    { timeoutMs: 25 }
  );

  assert.equal(result.exitCode, 124);
  assert.match(result.stderr, /parent timeout/);
});

test("typed wacli wrappers cover auth, sync, chat, message, and media commands", async () => {
  const authStatus = createRunner(fixture("auth-status-redacted.json"));
  await createWacliClient(testConfig(), authStatus.runner).authStatus();
  assert.deepEqual(authStatus.calls[0].args.slice(0, 2), ["auth", "status"]);

  const syncOnce = createRunner(fixture("sync-once-redacted.json"));
  await createWacliClient(testConfig(), syncOnce.runner).sync({
    once: true,
    idleExit: "5s",
    refreshContacts: true
  });
  assert.deepEqual(syncOnce.calls[0].args.slice(0, 7), [
    "sync",
    "--idle-exit",
    "5s",
    "--once",
    "--refresh-contacts",
    "--json",
    "--store"
  ]);
  assert.deepEqual(syncOnce.calls[0].args.slice(-2), ["--timeout", "75s"]);

  const chats = createRunner(fixture("chats-list-redacted.json"));
  await createWacliClient(testConfig(), chats.runner).listChats({
    query: "Vijayalakshmi",
    limit: 5
  });
  assert.deepEqual(chats.calls[0].args.slice(0, 6), [
    "chats",
    "list",
    "--query",
    "Vijayalakshmi",
    "--limit",
    "5"
  ]);

  const search = createRunner(fixture("messages-search-redacted.json"));
  await createWacliClient(testConfig(), search.runner).searchMessages({
    query: "marksheet",
    chatId: "vijayalakshmi.saravanan.redacted@s.whatsapp.net",
    type: "document",
    limit: 3
  });
  assert.deepEqual(search.calls[0].args.slice(0, 9), [
    "messages",
    "search",
    "marksheet",
    "--chat",
    "vijayalakshmi.saravanan.redacted@s.whatsapp.net",
    "--limit",
    "3",
    "--type",
    "document"
  ]);

  const media = createRunner(fixture("media-download-redacted.json"));
  await createWacliClient(testConfig(), media.runner).downloadMedia({
    chatId: "vijayalakshmi.saravanan.redacted@s.whatsapp.net",
    messageId: "wamid.redacted.vijayalakshmi.media.0001",
    output: "/data/pratiksha/wacli/media"
  });
  assert.deepEqual(media.calls[0].args.slice(0, 8), [
    "media",
    "download",
    "--chat",
    "vijayalakshmi.saravanan.redacted@s.whatsapp.net",
    "--id",
    "wamid.redacted.vijayalakshmi.media.0001",
    "--output",
    "/data/pratiksha/wacli/media"
  ]);
});

test("live send smoke is skipped unless explicit send flags and recipient are set", async () => {
  const skippedByDefault = await runLiveSendSmokeFromEnv({
    ...process.env,
    VIJI_WACLI_LIVE_SEND_ENABLED: "false",
    VIJI_WACLI_LIVE_SEND_SMOKE_ENABLED: "false"
  });
  assert.equal(skippedByDefault.status, "skipped");

  const skippedWithoutSend = await runLiveSendSmokeFromEnv({
    ...process.env,
    VIJI_WACLI_LIVE_SEND_ENABLED: "false",
    VIJI_WACLI_LIVE_SEND_SMOKE_ENABLED: "true",
    VIJI_WACLI_LIVE_SEND_SMOKE_TO: "vijayalakshmi.saravanan.redacted@s.whatsapp.net"
  });
  assert.equal(skippedWithoutSend.status, "skipped");
});

test("live read smoke is opt-in and returns only redacted chat/message summary", async () => {
  const skippedByDefault = await runLiveReadSmokeFromEnv({
    ...process.env,
    VIJI_WACLI_LIVE_READ_SMOKE_ENABLED: "false"
  });
  assert.equal(skippedByDefault.status, "skipped");

  const routed = createRoutingRunner([
    {
      startsWith: ["chats", "list"],
      stdout: fixture("chats-list-live-shape-redacted.json")
    },
    {
      startsWith: ["messages", "list"],
      stdout: fixture("messages-list-live-shape-redacted.json")
    }
  ]);
  const smoke = await runLiveReadSmokeFromEnv(
    {
      ...process.env,
      VIJI_WACLI_LIVE_READ_SMOKE_ENABLED: "true",
      VIJI_WACLI_LIVE_READ_SMOKE_QUERY: "Vijayalakshmi Saravanan",
      VIJI_WACLI_LIVE_READ_SMOKE_CHAT_LIMIT: "5",
      VIJI_WACLI_LIVE_READ_SMOKE_MESSAGE_LIMIT: "5"
    },
    (config) => createWacliClient(config, routed.runner)
  );

  assert.equal(smoke.status, "passed");
  assert.equal(smoke.summary.targetMatched, true);
  assert.equal(smoke.summary.selectedChatType, "dm");
  assert.equal(smoke.summary.messageSampleCount, 2);
  assert.equal(smoke.summary.inboundSampleCount, 1);
  assert.equal(smoke.summary.outboundSampleCount, 1);
  assert.equal(smoke.summary.selectedChatHash.length, 12);
  assert.equal(routed.calls.length, 2);

  const serialized = JSON.stringify(smoke);
  assert.equal(serialized.includes("wamid."), false);
  assert.equal(serialized.includes("@s.whatsapp.net"), false);
  assert.equal(serialized.includes("Synthetic redacted"), false);

  const malformed = createRoutingRunner([
    {
      startsWith: ["chats", "list"],
      stdout: "not-json-with-private-debug"
    }
  ]);
  const failed = await runLiveReadSmokeFromEnv(
    {
      ...process.env,
      VIJI_WACLI_LIVE_READ_SMOKE_ENABLED: "true",
      VIJI_WACLI_LIVE_READ_SMOKE_QUERY: "Vijayalakshmi Saravanan"
    },
    (config) => createWacliClient(config, malformed.runner)
  );
  assert.equal(failed.status, "failed");
  assert.equal(JSON.stringify(failed).includes("not-json-with-private-debug"), false);
});

test("only wa-adapter-wacli owns wacli execution", async () => {
  const nonAdapterSource = [
    await readSourceTree("apps/api/src"),
    await readSourceTree("apps/cli/src"),
    await readSourceTree("apps/worker/src"),
    await readSourceTree("packages/policy/src"),
    await readSourceTree("packages/ai/src")
  ].join("\n");

  assert.equal(/child_process|spawn\(/.test(nonAdapterSource), false);
});
