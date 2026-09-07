#!/usr/bin/env node
// Verify-step wrapper — ROUND 16.20 factoring submit-queue linkage fix.
// See scripts/verify-factoring-submit-queue-uses-authoritative-assignment.mjs for the actual checks.
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const target = path.join(__dirname, "..", "verify-factoring-submit-queue-uses-authoritative-assignment.mjs");
const result = spawnSync(process.execPath, [target], { stdio: "inherit" });
process.exit(result.status ?? 1);
