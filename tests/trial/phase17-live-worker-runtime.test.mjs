import assert from "node:assert/strict";
import test from "node:test";

const { resolveLiveWorkerStorageGate } = await import(
  "../../scripts/lib/live-worker-runtime.mjs"
);

test("Phase 17 live worker storage gate requires data root and sentinel", () => {
  const existingPaths = new Set([
    "/Volumes/Test/VijiAI",
    "/Volumes/Test/VijiAI/.viji-helper-root"
  ]);
  const gate = resolveLiveWorkerStorageGate(
    {
      VIJI_DATA_ROOT: "/Volumes/Test/VijiAI",
      VIJI_SENTINEL_FILE: ".viji-helper-root"
    },
    (path) => existingPaths.has(path)
  );

  assert.deepEqual(gate, {
    dataRoot: "/Volumes/Test/VijiAI",
    sentinelPath: "/Volumes/Test/VijiAI/.viji-helper-root",
    dataRootAvailable: true,
    sentinelAvailable: true,
    available: true
  });
});

test("Phase 17 live worker storage gate idles when sentinel disappears", () => {
  const gate = resolveLiveWorkerStorageGate(
    {
      VIJI_DATA_ROOT: "/Volumes/Test/VijiAI",
      VIJI_SENTINEL_FILE: ".viji-helper-root"
    },
    (path) => path === "/Volumes/Test/VijiAI"
  );

  assert.equal(gate.dataRootAvailable, true);
  assert.equal(gate.sentinelAvailable, false);
  assert.equal(gate.available, false);
});

test("Phase 17 live worker storage gate supports absolute sentinel paths", () => {
  const gate = resolveLiveWorkerStorageGate(
    {
      VIJI_DATA_ROOT: "/Volumes/Test/VijiAI",
      VIJI_SENTINEL_FILE: "/tmp/viji-sentinel"
    },
    (path) => path === "/Volumes/Test/VijiAI" || path === "/tmp/viji-sentinel"
  );

  assert.equal(gate.sentinelPath, "/tmp/viji-sentinel");
  assert.equal(gate.available, true);
});
