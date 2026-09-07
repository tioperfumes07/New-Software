#!/usr/bin/env node
// Verify-step wrapper — ROUND 16.20 Customers/Vendors sample-data quarantine fix.
// See scripts/verify-customers-vendors-sample-data-quarantine.mjs for the actual checks.
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const target = path.join(__dirname, "..", "verify-customers-vendors-sample-data-quarantine.mjs");
const result = spawnSync(process.execPath, [target], { stdio: "inherit" });
process.exit(result.status ?? 1);
