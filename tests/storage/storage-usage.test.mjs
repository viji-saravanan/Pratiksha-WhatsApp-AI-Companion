import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

async function withTempDataRoot(testFn) {
  const root = await mkdtemp(join(tmpdir(), "viji-storage-"));
  try {
    await writeFile(join(root, ".viji-helper-root"), "");
    await testFn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

await withTempDataRoot(async (root) => {
  await rm(join(root, ".viji-helper-root"), { force: true });

  const result = spawnSync("node", ["scripts/bootstrap-ssd-root.mjs"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      VIJI_DATA_ROOT: root
    }
  });

  assert.equal(result.status, 0, result.stderr);

  const report = JSON.parse(result.stdout);
  assert.equal(report.dataRoot, root);
  assert.equal(report.sentinelPath, join(root, ".viji-helper-root"));
  assert.ok((await stat(join(root, ".viji-helper-root"))).isFile());
  assert.ok((await stat(join(root, "wacli", "store"))).isDirectory());
  assert.ok((await stat(join(root, "knowledge", "processed"))).isDirectory());
  assert.ok((await stat(join(root, "viji-files", "inbox"))).isDirectory());
  assert.ok((await stat(join(root, "viji-files", "library"))).isDirectory());
  assert.ok((await stat(join(root, "viji-files", "staged"))).isDirectory());
  assert.ok((await stat(join(root, "viji-files", "thumbnails"))).isDirectory());
  assert.ok((await stat(join(root, "viji-files", "manifests"))).isDirectory());
  assert.ok((await stat(join(root, "viji-files", "tmp"))).isDirectory());
});

await withTempDataRoot(async (root) => {
  await writeFile(join(root, "small.txt"), "abc");
  await mkdir(join(root, ".pnpm-store"));
  await writeFile(join(root, ".pnpm-store", "cache.bin"), Buffer.alloc(1024 * 1024));
  await mkdir(join(root, "dist"));
  await writeFile(join(root, "dist", "bundle.js"), Buffer.alloc(1024 * 1024));
  await writeFile(join(root, "tsconfig.tsbuildinfo"), Buffer.alloc(1024 * 1024));

  const result = spawnSync("node", ["scripts/check-storage-profile.mjs"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      VIJI_DATA_ROOT: root,
      VIJI_STORAGE_PROFILE: "custom-env",
      VIJI_QUOTA_LIMIT_BYTES: String(10 * 1024 * 1024),
      VIJI_WARNING_USED_BYTES: String(8 * 1024 * 1024),
      VIJI_CRITICAL_USED_BYTES: String(9 * 1024 * 1024),
      VIJI_WARNING_FREE_BYTES: "1",
      VIJI_CRITICAL_FREE_BYTES: "1"
    }
  });

  assert.equal(result.status, 0, result.stderr);

  const report = JSON.parse(result.stdout);
  assert.equal(report.dataRoot, root);
  assert.equal(report.profileName, "custom-env");
  assert.equal(report.state, "healthy");
  assert.ok(
    report.usedBytes < 1024 * 100,
    "package cache and generated build output should be excluded from project usage"
  );
  assert.ok(report.freeBytes > 0);
});

await withTempDataRoot(async (root) => {
  const result = spawnSync("node", ["scripts/check-storage-profile.mjs"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      VIJI_DATA_ROOT: root,
      VIJI_STORAGE_PROFILE: "not-a-profile"
    }
  });

  assert.equal(result.status, 2);
  assert.match(result.stderr, /Unknown storage profile/);
});
