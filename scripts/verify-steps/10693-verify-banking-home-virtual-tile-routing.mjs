#!/usr/bin/env node
// Verify-step wrapper — ROUND 16.19 Banking Home virtual-tile routing fix.
// See scripts/verify-banking-home-virtual-tile-routing.mjs for the actual checks.
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const target = path.join(__dirname, "..", "verify-banking-home-virtual-tile-routing.mjs");
const result = spawnSync(process.execPath, [target], { stdio: "inherit" });
process.exit(result.status ?? 1);
