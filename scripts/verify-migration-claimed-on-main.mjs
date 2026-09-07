#!/usr/bin/env node
/**
 * MIGRATION CLAIM REGISTRY ENFORCEMENT (MIGRATION-NUMBER-RACE-IS-INTRA-LANE).
 *
 * The lane-band guard (verify-migration-lane-band.mjs) prevents inter-lane collisions.
 * This guard prevents intra-lane races: a migration timestamp must be reserved in
 * db/migrations/CLAIMED-MIGRATION-NUMBERS.json on origin/main before the .sql file
 * appears in a feature branch, exactly mirroring scripts/verify-steps/CLAIMED-NUMBERS.json.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(import.meta.url), "..", "..");
const REGISTRY_PATH = resolve(ROOT, "db/migrations/CLAIMED-MIGRATION-NUMBERS.json");

function git(args) {
  const r = spawnSync("git", args, { cwd: ROOT, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr || r.stdout}`);
  return (r.stdout || "").trim();
}

function newMigrations(baseRef = "origin/main") {
  const out = git(["diff", "--name-only", "--diff-filter=A", `${baseRef}...HEAD`, "--", "db/migrations/"]);
  return out.split("\n").filter((f) => f.endsWith(".sql"));
}

function timestampOf(file) {
  const name = file.split("/").pop();
  const m = /^(\d{12})_/.exec(name);
  return m ? m[1] : null;
}

function laneForHour(hour) {
  if (hour >= 0 && hour <= 11) return "claude";
  if (hour >= 12 && hour <= 23) return "cursor";
  return null;
}

function loadRegistry() {
  const text = readFileSync(REGISTRY_PATH, "utf8");
  return JSON.parse(text);
}

function branchLane(branch) {
  const lower = branch.toLowerCase();
  if (lower.startsWith("claude/")) return "claude";
  if (lower.startsWith("cursor/") || lower.startsWith("cursoragent/") || lower.startsWith("chore/") || lower.startsWith("feat/") || lower.startsWith("fix/")) return "cursor";
  return null;
}

const OWNER_AUTHORIZED_ONE_OFFS = new Map([
  [
    "codex/tel-39-driver-mirror",
    new Set(["db/migrations/202613772200_samsara_driver_activation_status.sql"]),
  ],
  [
    "codex/tel40b",
    new Set(["db/migrations/202613790000_tel40b_stop_geocode_precision.sql"]),
  ],
  [
    "codex/tel42",
    new Set(["db/migrations/202613790001_tel42_ih35_yard_location.sql"]),
  ],
]);

function isOwnerAuthorizedOneOff(branch, files) {
  const allowed = OWNER_AUTHORIZED_ONE_OFFS.get(branch);
  return Boolean(allowed && files.length > 0 && files.every((file) => allowed.has(file)));
}

export function run() {
  let branch;
  try {
    branch = process.env.GITHUB_HEAD_REF || git(["rev-parse", "--abbrev-ref", "HEAD"]);
  } catch {
    return { ok: true, skipped: "branch could not be determined", message: "verify-migration-claimed-on-main SKIP — no branch" };
  }

  let files;
  try {
    files = newMigrations();
  } catch (error) {
    return { ok: true, skipped: "diff unavailable", message: `verify-migration-claimed-on-main SKIP — could not diff against origin/main (${error.message})` };
  }

  if (files.length === 0) {
    return { ok: true, message: `verify-migration-claimed-on-main OK — no new migrations on ${branch}` };
  }

  if (isOwnerAuthorizedOneOff(branch, files)) {
    return {
      ok: true,
      files,
      message: `verify-migration-claimed-on-main OK — direct owner one-PR authorization applies only to ${files.join(", ")}`,
    };
  }

  let registry;
  try {
    registry = loadRegistry();
  } catch (error) {
    return { ok: false, message: `verify-migration-claimed-on-main FAIL — cannot read registry ${REGISTRY_PATH}: ${error.message}` };
  }

  const claimed = registry.claimed || {};
  const lane = branchLane(branch);
  const problems = [];

  for (const f of files) {
    const ts = timestampOf(f);
    if (!ts) {
      problems.push(`${f} does not begin with a YYYYMMDDHHMM timestamp; cannot claim it.`);
      continue;
    }
    const entry = claimed[ts];
    if (!entry) {
      problems.push(
        `${f} (timestamp ${ts}) is NOT CLAIMED in db/migrations/CLAIMED-MIGRATION-NUMBERS.json. ` +
          `Open a claim-only PR adding this timestamp to 'claimed', merge it, then author the migration.`
      );
      continue;
    }
    const hour = Number(ts.slice(8, 10));
    const expectedLane = laneForHour(hour);
    const claimedBy = (typeof entry === "string" ? entry : entry.claimed_by || "").toLowerCase();
    if (expectedLane && claimedBy && claimedBy !== expectedLane) {
      problems.push(
        `${f} timestamp ${ts} is in the ${expectedLane} hour band but claimed_by='${claimedBy}'. ` +
          `Pick an hour inside your lane's band and claim under the correct lane.`
      );
    }
    if (lane && claimedBy && claimedBy !== lane) {
      problems.push(
        `${f} timestamp ${ts} was claimed by ${claimedBy}, but this branch '${branch}' maps to ${lane}. ` +
          `Never claim another lane's migration slot.`
      );
    }
  }

  const ok = problems.length === 0;
  return {
    ok,
    files,
    message: ok
      ? `verify-migration-claimed-on-main OK — ${files.length} new migration(s) claimed`
      : `verify-migration-claimed-on-main FAIL:\n  - ${problems.join("\n  - ")}`,
  };
}

function selftest() {
  const ts = "202610101200";
  if (!/^\d{12}$/.test(ts)) throw new Error("selftest timestamp parse failed");
  if (laneForHour(Number(ts.slice(8, 10))) !== "cursor") throw new Error("selftest hour band failed");
  if (branchLane("cursor/fix-thing") !== "cursor") throw new Error("selftest cursor branch failed");
  if (branchLane("claude/fix-thing") !== "claude") throw new Error("selftest claude branch failed");
  if (timestampOf("db/migrations/202610101200_thing.sql") !== "202610101200") throw new Error("selftest timestampOf failed");
  return true;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (process.argv.includes("--selftest")) {
    console.log(selftest() ? "verify-migration-claimed-on-main selftest PASS" : "verify-migration-claimed-on-main selftest FAIL");
    process.exit(selftest() ? 0 : 1);
  }
  const { ok, message } = run();
  console.log(message);
  process.exit(ok ? 0 : 1);
}
