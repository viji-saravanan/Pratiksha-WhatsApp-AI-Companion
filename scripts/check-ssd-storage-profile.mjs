import { spawnSync } from "node:child_process";

const result = spawnSync("node", ["scripts/check-storage-profile.mjs"], {
  cwd: process.cwd(),
  stdio: "inherit",
  env: {
    ...process.env,
    VIJI_DATA_ROOT: "/Volumes/Arya 1TB/VijiAI",
    VIJI_STORAGE_PROFILE: "large-200gb"
  }
});

process.exit(result.status ?? 1);

