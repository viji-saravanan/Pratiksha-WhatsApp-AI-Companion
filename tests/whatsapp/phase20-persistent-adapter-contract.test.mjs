import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { assertSuccess, run } from "../helpers/disposable-postgres.mjs";

for (const target of ["@viji/whatsapp", "@viji/wa-adapter-wacli"]) {
  const build = run("corepack", ["pnpm", "--filter", target, "build"]);
  assertSuccess(build, `build ${target}`);
}

const { hasWhatsAppEventStream } = await import(
  "../../packages/whatsapp/dist/index.js"
);
const { createWacliClient } = await import(
  "../../apps/wa-adapter-wacli/dist/index.js"
);

test("Phase 20 keeps current wacli adapter on the request-response contract", () => {
  const wacli = createWacliClient(
    {
      storePath: "/data/pratiksha/wacli/store",
      liveSendEnabled: false
    },
    async () => ({ exitCode: 0, stdout: "{}", stderr: "" })
  );

  assert.equal(hasWhatsAppEventStream(wacli), false);
});

test("Phase 20 exposes an opt-in event-stream adapter guard", async () => {
  const streamingAdapter = {
    doctor: async () => ({ ok: true, value: {}, metadata: {} }),
    authStatus: async () => ({ ok: true, value: {}, metadata: {} }),
    auth: async () => ({ ok: true, value: {}, metadata: {} }),
    sync: async () => ({ ok: true, value: {}, metadata: {} }),
    listChats: async () => ({ ok: true, value: [], metadata: {} }),
    listMessages: async () => ({ ok: true, value: [], metadata: {} }),
    searchMessages: async () => ({ ok: true, value: [], metadata: {} }),
    sendText: async () => ({ ok: true, value: {}, metadata: {} }),
    sendFile: async () => ({ ok: true, value: {}, metadata: {} }),
    downloadMedia: async () => ({ ok: true, value: {}, metadata: {} }),
    subscribeEvents: async (handler) => {
      await handler({
        adapterKind: "whatsmeow",
        eventType: "connection",
        eventId: "phase20.synthetic.connection",
        occurredAt: new Date("2026-05-24T00:00:00.000Z"),
        receivedAt: new Date("2026-05-24T00:00:00.000Z"),
        redacted: true,
        connectionState: "connected"
      });

      return {
        ok: true,
        value: {
          stop: async () => {},
          closed: Promise.resolve({
            ok: true,
            value: { reason: "test-complete" },
            metadata: {}
          })
        },
        metadata: {}
      };
    }
  };

  const events = [];
  assert.equal(hasWhatsAppEventStream(streamingAdapter), true);
  const subscription = await streamingAdapter.subscribeEvents((event) => {
    events.push(event);
  });

  assert.equal(subscription.ok, true);
  assert.equal(events.length, 1);
  assert.equal(events[0].eventType, "connection");
  assert.equal(events[0].connectionState, "connected");
});

test("Phase 20 spike doc keeps production rollback and event classes explicit", async () => {
  const doc = await readFile("docs/ADAPTER_SPIKE.md", "utf8");

  assert.match(doc, /keep `wacli` as the production adapter/i);
  assert.match(doc, /Direct `whatsmeow` daemon/);
  assert.match(doc, /Baileys bridge/);
  assert.match(doc, /`wacli sync --follow` with events\/webhook/);
  for (const eventType of [
    "message",
    "receipt",
    "media",
    "connection",
    "history_sync",
    "call",
    "adapter_error"
  ]) {
    assert.match(doc, new RegExp("`" + eventType + "`"));
  }
  assert.match(doc, /VIJI_WHATSAPP_ADAPTER=wacli/);
});
