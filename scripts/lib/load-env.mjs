import { readFileSync } from "node:fs";
import { join } from "node:path";

function parseEnvLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) {
    return null;
  }

  const separatorIndex = trimmed.indexOf("=");
  if (separatorIndex === -1) {
    return null;
  }

  const key = trimmed.slice(0, separatorIndex).trim();
  let value = trimmed.slice(separatorIndex + 1).trim();

  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }

  return { key, value };
}

export function loadDotEnv(envPath = join(process.cwd(), ".env")) {
  let contents;
  try {
    contents = readFileSync(envPath, "utf8");
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return;
    }
    throw error;
  }

  for (const line of contents.split(/\r?\n/)) {
    const entry = parseEnvLine(line);
    if (!entry || process.env[entry.key] !== undefined) {
      continue;
    }
    process.env[entry.key] = entry.value;
  }
}

loadDotEnv();
