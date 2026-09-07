#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const target = path.join(__dirname, "..", "verify-factoring-chargebacks-fees-customer-uuid-cast.mjs");

execFileSync(process.execPath, [target, "--selftest"], { stdio: "inherit" });
execFileSync(process.execPath, [target], { stdio: "inherit" });
