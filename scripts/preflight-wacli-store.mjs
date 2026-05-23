#!/usr/bin/env node
import "./lib/load-env.mjs";

import { preflightWacliStore } from "./lib/wacli-store-preflight.mjs";

const result = await preflightWacliStore();

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);

if (result.status !== "completed") {
  process.exitCode = 1;
}
