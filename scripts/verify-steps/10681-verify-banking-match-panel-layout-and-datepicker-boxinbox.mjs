#!/usr/bin/env node
// Wires scripts/verify-banking-match-panel-layout-and-datepicker-boxinbox.mjs into the numbered verify-step CI lane.
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const target = path.join(__dirname, "..", "verify-banking-match-panel-layout-and-datepicker-boxinbox.mjs");
const args = process.argv.includes("--selftest") ? ["--selftest"] : [];
const result = spawnSync(process.execPath, [target, ...args], { stdio: "inherit" });
process.exit(result.status ?? 1);
