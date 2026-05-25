import assert from "node:assert/strict";
import test from "node:test";

const { resolveLiveWorkerStorageGate } = await import(
  "../../scripts/lib/live-worker-runtime.mjs"
);

const testDataRoot = "/tmp/pratiksha-test-root";
const testSentinelPath = `${testDataRoot}/.viji-helper-root`;

test("Phase 17 live worker storage gate requires data root and sentinel", () => {
  const existingPaths = new Set([
    "/tmp/pratiksha-test-root",
    "/tmp/pratiksha-test-root/.viji-helper-root"
  ]);
  const gate = resolveLiveWorkerStorageGate(
    {
      VIJI_DATA_ROOT: "/tmp/pratiksha-test-root",
  const existingPaths = new Set([testDataRoot, testSentinelPath]);
  const gate = resolveLiveWorkerStorageGate(
    {
      VIJI_DATA_ROOT: testDataRoot,
      VIJI_SENTINEL_FILE: ".viji-helper-root"
    },
    (path) => existingPaths.has(path)
  );

  assert.deepEqual(gate, {
    dataRoot: "/tmp/pratiksha-test-root",
    sentinelPath: "/tmp/pratiksha-test-root/.viji-helper-root",
    dataRoot: testDataRoot,
    sentinelPath: testSentinelPath,
    dataRootAvailable: true,
    sentinelAvailable: true,
    available: true
  });
});

test("Phase 17 live worker storage gate idles when sentinel disappears", () => {
  const gate = resolveLiveWorkerStorageGate(
    {
      VIJI_DATA_ROOT: "/tmp/pratiksha-test-root",
      VIJI_SENTINEL_FILE: ".viji-helper-root"
    },
    (path) => path === "/tmp/pratiksha-test-root"
      VIJI_DATA_ROOT: testDataRoot,
      VIJI_SENTINEL_FILE: ".viji-helper-root"
    },
    (path) => path === testDataRoot
  );

  assert.equal(gate.dataRootAvailable, true);
  assert.equal(gate.sentinelAvailable, false);
  assert.equal(gate.available, false);
});

test("Phase 17 live worker storage gate supports absolute sentinel paths", () => {
  const gate = resolveLiveWorkerStorageGate(
    {
      VIJI_DATA_ROOT: "/tmp/pratiksha-test-root",
      VIJI_SENTINEL_FILE: "/tmp/viji-sentinel"
    },
    (path) => path === "/tmp/pratiksha-test-root" || path === "/tmp/viji-sentinel"
      VIJI_DATA_ROOT: testDataRoot,
      VIJI_SENTINEL_FILE: "/tmp/viji-sentinel"
    },
    (path) => path === testDataRoot || path === "/tmp/viji-sentinel"
  );

  assert.equal(gate.sentinelPath, "/tmp/viji-sentinel");
  assert.equal(gate.available, true);
});
