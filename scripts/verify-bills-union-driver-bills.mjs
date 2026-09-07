#!/usr/bin/env node
/** INV-01 canonical guard name. Delegates to the established full contract guard. */
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const target = path.join(root, "scripts", "verify-driver-bills-in-bills-page.mjs");
const args = process.argv.includes("--selftest") ? [target, "--selftest"] : [target];
const result = spawnSync(process.execPath, args, { cwd: root, encoding: "utf8" });
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
if (result.status !== 0) {
  console.error(`verify-bills-union-driver-bills FAIL — delegated contract exited ${result.status ?? "unknown"}`);
  process.exit(result.status ?? 1);
}
console.log(`verify-bills-union-driver-bills PASS${process.argv.includes("--selftest") ? " --selftest" : ""}`);
