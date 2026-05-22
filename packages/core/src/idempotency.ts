import { createHash } from "node:crypto";

export function createStableIdempotencyKey(parts: readonly string[]): string {
  const hash = createHash("sha256");

  for (const part of parts) {
    hash.update(part);
    hash.update("\x1f");
  }

  return `viji:${hash.digest("hex")}`;
}
