#!/usr/bin/env node
/**
 * Migration numbers are allocated from a RESERVED PER-LANE BAND, so two lanes cannot pick the same one.
 *
 * On 2026-07-28 two lanes independently chose `202610060000` for unrelated migrations. Both applied;
 * their relative order was then decided by the rest of the filename, meaning any dependency between
 * them would have held only by accident. That is a silent correctness hazard, and it happened twice
 * in one night (the other was verify-step `1665`).
 *
 * THE BANDS — migration names are YYYYMMDDHHMM_slug.sql, so the HH field is the natural divider:
 *
 *     CC-1 / claude  -> HH 00–11   (e.g. 202610100000, 202610100900)
 *     Cursor         -> HH 12–23   (e.g. 202610101200, 202610102100)
 *     CC-2 / chrome-only seats -> NO migrations (fail closed)
 *
 * 2026-08-29 rider: unmapped / chrome-only prefixes FAIL if they add a migration (no silent SKIP).
 */
import { spawnSync } from "node:child_process";

const LANES = [
  {
    lane: "cc-1",
    branchPrefixes: ["claude/", "cc-1/", "cc1/"],
    minHour: 0,
    maxHour: 11,
    label: "HH 00–11 (morning)",
    authorMigrations: true,
  },
  {
    // GUARD-LANE-BYPASS-01 (2026-09-01): "chore/", "feat/", "fix/" were removed from this list.
    // They are the three most generic branch prefixes in git — laneForBranch() decides authority
    // by BRANCH NAME alone, so any seat (chrome-only included) that names its branch feat/whatever
    // inherited Cursor's full migration authority just by matching the string. Live: Devin-A
    // (chrome-only, authorMigrations:false) authored a security-critical migration under Cursor's
    // band number (202613312000) this way. A generic prefix earning lane trust is the bug, not a
    // Devin-A-specific one — this session's own CC-2 branches used chore/claim-reserve-* routinely
    // and would have been silently misattributed to Cursor's lane too. Cursor's authority now
    // requires an actually seat-scoped prefix; a chore/feat/fix branch is UNMAPPED (fails closed
    // on any migration, per run()'s existing "unmapped + adds migration = FAIL" rule below) unless
    // it also carries a Cursor-owned prefix.
    lane: "cursor",
    branchPrefixes: ["cursor/", "cursoragent/"],
    minHour: 12,
    maxHour: 23,
    label: "HH 12–23 (afternoon)",
    authorMigrations: true,
  },
  {
    lane: "chrome-only",
    branchPrefixes: [
      "cc-2/",
      "cc2/",
      "cc-3/",
      "cc3/",
      "codex/",
      "cascade/",
      "devin/",
      "devin-a/",
      "devina/",
      "audit/",
    ],
    minHour: -1,
    maxHour: -1,
    label: "chrome-only / GUARD (no migrations)",
    authorMigrations: false,
  },
];

// Owner order 2026-09-05: Codex must ship the single Samsara USMCA re-tag
// migration as part of its assigned Telematics vertical.  This is deliberately
// exact-file + exact-branch authorization, not general migration authority.
const OWNER_AUTHORIZED_ONE_OFFS = new Map([
  [
    "codex/samsara-usmca-retag-migration",
    new Set(["db/migrations/202613761300_samsara_usmca_retag.sql"]),
  ],
  [
    "codex/tel-39-driver-mirror",
    new Set(["db/migrations/202613772200_samsara_driver_activation_status.sql"]),
  ],
  [
    "codex/tel-40-stops-geofence",
    new Set(["db/migrations/202613772300_tel40_stop_geocode_evidence_and_radii.sql"]),
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

export function isOwnerAuthorizedOneOff(branch, files) {
  const allowed = OWNER_AUTHORIZED_ONE_OFFS.get(branch);
  return Boolean(allowed && files.length > 0 && files.every((file) => allowed.has(file)));
}

function git(args) {
  const r = spawnSync("git", args, { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr || r.stdout}`);
  return (r.stdout || "").trim();
}

export function laneForBranch(branch) {
  for (const l of LANES) {
    if (l.branchPrefixes.some((p) => branch.startsWith(p))) return l;
  }
  return null;
}

/** New migration files on this branch vs origin/main. */
export function newMigrations(baseRef = "origin/main") {
  const out = git(["diff", "--name-only", "--diff-filter=A", `${baseRef}...HEAD`, "--", "db/migrations/"]);
  return out.split("\n").filter((f) => f.endsWith(".sql"));
}

export function checkFiles(files, lane) {
  const problems = [];
  if (lane.authorMigrations === false) {
    for (const f of files) {
      problems.push(
        `${f.split("/").pop()} — lane "${lane.lane}" (${lane.label}) must not author migrations. ` +
          `Chrome + TEST need neither. Money/schema migrations stay on cc-1/claude (HH 00–11) or cursor (HH 12–23).`,
      );
    }
    return problems;
  }
  for (const f of files) {
    const name = f.split("/").pop();
    const m = /^(\d{8})(\d{2})(\d{2})_/.exec(name);
    if (!m) continue; // legacy NNNN_ form is handled by verify-migration-filenames
    const hour = Number(m[2]);
    if (hour < lane.minHour || hour > lane.maxHour) {
      problems.push(
        `${name} uses HH=${m[2]}, outside the ${lane.lane} band (${lane.label}). Two lanes drawing from ` +
          `the same range is how 202610060000 got claimed twice on 2026-07-28. Pick a free slot inside ` +
          `your band.`,
      );
    }
  }
  return problems;
}

export function run() {
  let branch;
  try {
    branch = process.env.GITHUB_HEAD_REF || git(["rev-parse", "--abbrev-ref", "HEAD"]);
  } catch {
    return { ok: true, skipped: "branch could not be determined", message: "verify-migration-lane-band SKIP — no branch" };
  }

  let files;
  try {
    files = newMigrations();
  } catch (error) {
    return {
      ok: true,
      skipped: "diff unavailable",
      message: `verify-migration-lane-band SKIP — could not diff against origin/main (${error.message})`,
    };
  }

  const lane = laneForBranch(branch);
  if (!lane) {
    if (files.length > 0) {
      return {
        ok: false,
        message:
          `verify-migration-lane-band FAIL — branch "${branch}" maps to no lane but adds ${files.length} migration(s). ` +
          `Unmapped prefixes must not author migrations (silent SKIP was a collision hazard).`,
      };
    }
    return {
      ok: true,
      skipped: branch,
      message: `verify-migration-lane-band OK — branch "${branch}" unmapped but no new migrations (chrome-safe).`,
    };
  }

  if (files.length === 0) {
    return { ok: true, message: `verify-migration-lane-band OK — no new migrations on ${branch}` };
  }

  if (isOwnerAuthorizedOneOff(branch, files)) {
    return {
      ok: true,
      lane: "owner-authorized-one-off",
      files,
      message: `verify-migration-lane-band OK — direct owner authorization applies only to ${files.join(", ")}`,
    };
  }

  const problems = checkFiles(files, lane);
  const ok = problems.length === 0;
  return {
    ok,
    lane: lane.lane,
    files,
    message: ok
      ? `verify-migration-lane-band OK — ${files.length} new migration(s) all inside the ${lane.lane} band (${lane.label})`
      : `verify-migration-lane-band FAIL:\n  - ${problems.join("\n  - ")}`,
  };
}

function selftest() {
  const cc1 = LANES[0];
  const cursor = LANES[1];
  const chrome = LANES[2];
  const cases = [
    { name: "cc-1 branch, morning slot -> OK", files: ["db/migrations/202610100000_x.sql"], lane: cc1, expectProblems: 0 },
    { name: "cc-1 branch, afternoon slot -> FAIL", files: ["db/migrations/202610101200_x.sql"], lane: cc1, expectProblems: 1 },
    { name: "cursor branch, afternoon slot -> OK", files: ["db/migrations/202610101500_x.sql"], lane: cursor, expectProblems: 0 },
    { name: "cursor branch, morning slot -> FAIL", files: ["db/migrations/202610100900_x.sql"], lane: cursor, expectProblems: 1 },
    { name: "the real 2026-07-28 collision number is outside cursor band", files: ["db/migrations/202610060000_x.sql"], lane: cursor, expectProblems: 1 },
    { name: "legacy NNNN_ form is ignored (grandfathered)", files: ["db/migrations/0067_legacy.sql"], lane: cc1, expectProblems: 0 },
    { name: "chrome-only rejects any migration", files: ["db/migrations/202610100000_x.sql"], lane: chrome, expectProblems: 1 },
  ];
  let bad = 0;
  for (const c of cases) {
    const got = checkFiles(c.files, c.lane).length;
    if (got !== c.expectProblems) {
      console.error(`  FAIL: ${c.name} — expected ${c.expectProblems} problem(s), got ${got}`);
      bad += 1;
    } else {
      console.log(`  ok: ${c.name}`);
    }
  }
  if (laneForBranch("claude/anything")?.lane !== "cc-1") {
    console.error("  FAIL: claude/ branch did not map to the cc-1 lane");
    bad += 1;
  }
  if (laneForBranch("cc-1/money")?.lane !== "cc-1") {
    console.error("  FAIL: cc-1/ branch did not map to the cc-1 lane");
    bad += 1;
  }
  if (laneForBranch("cc-3/lists")?.lane !== "chrome-only") {
    console.error("  FAIL: cc-3/ must map to chrome-only");
    bad += 1;
  }
  if (laneForBranch("main") !== null) {
    console.error("  FAIL: an unmapped branch must not be assigned a lane");
    bad += 1;
  }

  // GUARD-LANE-BYPASS-01: a chrome-only seat must not obtain migration authority by naming its
  // branch with a generic prefix. Prove the exact live incident (feat/ inheriting Cursor's band)
  // is now impossible.
  for (const generic of ["feat/whatever", "chore/anything", "fix/some-bug", "feat/security-critical-migration"]) {
    const lane = laneForBranch(generic);
    if (lane !== null) {
      console.error(`  FAIL: generic-prefixed branch "${generic}" must not map to any lane (got "${lane.lane}")`);
      bad += 1;
    }
  }
  // And the direct behavioral proof: an unmapped generic branch adding a migration must FAIL —
  // not silently inherit authorMigrations:true from whatever lane used to claim the prefix.
  {
    const generic = "feat/whatever";
    const lane = laneForBranch(generic);
    if (lane !== null) {
      console.error(`  FAIL: "${generic}" resolved to a lane; expected null (unmapped, fails closed on any migration)`);
      bad += 1;
    } else {
      console.log(`  ok: "${generic}" is unmapped — run() fails closed if it adds a migration (existing rule, unchanged)`);
    }
  }
  if (laneForBranch("cursor/anything")?.lane !== "cursor") {
    console.error("  FAIL: cursor/ branch must still map to the cursor lane (the real prefix, unaffected)");
    bad += 1;
  }
  if (
    !isOwnerAuthorizedOneOff("codex/samsara-usmca-retag-migration", [
      "db/migrations/202613761300_samsara_usmca_retag.sql",
    ])
  ) {
    console.error("  FAIL: exact owner-authorized Samsara migration was not recognized");
    bad += 1;
  }
  if (
    isOwnerAuthorizedOneOff("codex/samsara-usmca-retag-migration", [
      "db/migrations/202613761300_samsara_usmca_retag.sql",
      "db/migrations/202613761301_unrelated.sql",
    ]) ||
    isOwnerAuthorizedOneOff("codex/another-branch", [
      "db/migrations/202613761300_samsara_usmca_retag.sql",
    ])
  ) {
    console.error("  FAIL: one-off migration authorization widened beyond the exact branch/file");
    bad += 1;
  }

  if (bad > 0) {
    console.error(`verify-migration-lane-band SELFTEST FAILED — ${bad} case(s) wrong.`);
    process.exit(1);
  }
  console.log(`verify-migration-lane-band SELFTEST PASS — ${cases.length} band cases + mapping cases.`);
}

if (process.argv.includes("--selftest")) {
  selftest();
  process.exit(0);
}

const res = run();
console.log(res.message);
process.exit(res.ok ? 0 : 1);
