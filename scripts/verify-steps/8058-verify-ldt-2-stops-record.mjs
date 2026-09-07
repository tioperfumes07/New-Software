#!/usr/bin/env node
// Verify-step 8058 — LDT-2 Stops record (read-only) + leg-miles/events pop-ups + edit→wizard.
// Cursor lane (even band). Claimed on origin/main in CLAIMED-NUMBERS.json before authoring (Rule 37).
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const guard = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "verify-ldt-2-stops-record.mjs");
for (const args of [[guard], [guard, "--selftest"]]) {
  const r = spawnSync(process.execPath, args, { stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status ?? 1);
}
