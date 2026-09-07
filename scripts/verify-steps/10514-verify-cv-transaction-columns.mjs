#!/usr/bin/env node
// Verify-step 10514 — wires verify-counterparty-transaction-columns-real.mjs into CI.
// CV-TRANSACTION-COLUMNS (inv #46): vendor/customer transaction columns render real joined data.
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const guard = path.join(ROOT, "scripts", "verify-counterparty-transaction-columns-real.mjs");

try {
  execFileSync("node", [guard], { stdio: "inherit", cwd: ROOT });
} catch {
  process.exit(1);
}
