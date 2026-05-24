import "./lib/load-env.mjs";
import { mkdir, open } from "node:fs/promises";
import { join, resolve } from "node:path";

const defaultDataRoot = "/Volumes/Arya 1TB/VijiAI";
const dataRoot = resolve(process.env.VIJI_DATA_ROOT || defaultDataRoot);
const sentinelFile = process.env.VIJI_SENTINEL_FILE || ".viji-helper-root";

const requiredDirectories = [
  "config",
  "config/secrets",
  "postgres",
  "pgbackups",
  "wacli/store",
  "wacli/media",
  "models",
  "knowledge/inbox",
  "knowledge/processed",
  "knowledge/failed",
  "viji-files/inbox",
  "viji-files/library",
  "viji-files/staged",
  "viji-files/thumbnails",
  "viji-files/manifests",
  "viji-files/tmp",
  "logs/app",
  "logs/adapter",
  "logs/llm",
  "grafana",
  "prometheus",
  "loki",
  "tmp",
  "workspace/viji-helper"
];

function assertSafeRoot(rootPath) {
  if (rootPath === "/" || rootPath === "/Volumes" || rootPath === "/Volumes/Arya 1TB") {
    throw new Error(`Refusing to bootstrap unsafe VIJI_DATA_ROOT: ${rootPath}`);
  }
}

async function touch(path) {
  const handle = await open(path, "a");
  await handle.close();
}

assertSafeRoot(dataRoot);

await mkdir(dataRoot, { recursive: true });
for (const directory of requiredDirectories) {
  await mkdir(join(dataRoot, directory), { recursive: true });
}

const sentinelPath = join(dataRoot, sentinelFile);
await touch(sentinelPath);

console.log(
  JSON.stringify(
    {
      dataRoot,
      sentinelPath,
      directoriesCreatedOrVerified: requiredDirectories.length
    },
    null,
    2
  )
);
