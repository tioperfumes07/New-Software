#!/usr/bin/env node
/**
 * verify-step 8060 — CUR-2: Customers/Vendors Edit opens a side ParityDrawer, not a full page.
 * Cursor EVEN band (Rule 25). Runs the guard and its planted-defect self-test.
 */
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const GUARD = join(ROOT, "scripts", "verify-list-edit-in-drawer.mjs");

execFileSync(process.execPath, [GUARD], { stdio: "inherit" });
execFileSync(process.execPath, [GUARD, "--selftest"], { stdio: "inherit" });
