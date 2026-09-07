#!/usr/bin/env node
/**
 * verify-trip-type-local-enum.mjs
 *
 * TRIP-LOCAL-ENUM (owner order 2026-09-06): mdata.trip_type_enum ('NB' | 'TR' | 'SB' since
 * 202606181500) has no value for a Laredo->Laredo trip (no border crossing, no NB/TR/SB leg at
 * all). Law: Laredo->Laredo = LOCAL. One live load today: 13544.
 *
 * Pins 'LOCAL' in all three places it must agree, so none can silently drop it:
 *   1. db/migrations/202613850000_trip_type_local_enum.sql -- the additive
 *      ALTER TYPE mdata.trip_type_enum ADD VALUE 'LOCAL' AFTER 'SB'.
 *   2. apps/backend/src/dispatch/loads.routes.ts -- the dispatch load PATCH zod schema accepts
 *      "LOCAL" as a valid trip_type.
 *   3. apps/frontend/src/pages/dispatch/TripPairingBoardPage.tsx -- the Trip Pairing board's
 *      TRIP_COLOR map + legend render LOCAL (never a silent "—" for a real trip type).
 *
 * Static only (no DB). Usage:
 *   node scripts/verify-trip-type-local-enum.mjs
 *   node scripts/verify-trip-type-local-enum.mjs --selftest
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LABEL = "verify-trip-type-local-enum";
const MIGRATION_FILE = "db/migrations/202613850000_trip_type_local_enum.sql";
const PATCH_SCHEMA_FILE = "apps/backend/src/dispatch/loads.routes.ts";
const BOARD_FILE = "apps/frontend/src/pages/dispatch/TripPairingBoardPage.tsx";

function load(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

/** Pure checks -- takes source text so --selftest can inject fixtures. */
export function check({
  migration = load(MIGRATION_FILE),
  schema = load(PATCH_SCHEMA_FILE),
  board = load(BOARD_FILE),
} = {}) {
  const f = [];

  if (!/ALTER TYPE mdata\.trip_type_enum\s+ADD VALUE\s+(IF NOT EXISTS\s+)?'LOCAL'\s+AFTER\s+'SB'/i.test(migration)) {
    f.push(`${MIGRATION_FILE}: missing ALTER TYPE mdata.trip_type_enum ADD VALUE 'LOCAL' AFTER 'SB'`);
  }

  if (!/z\.enum\(\["NB",\s*"TR",\s*"SB",\s*"LOCAL"\]\)/.test(schema)) {
    f.push(`${PATCH_SCHEMA_FILE}: trip_type zod schema does not accept "LOCAL"`);
  }

  if (!/TRIP_COLOR:\s*Record<"NB"\s*\|\s*"TR"\s*\|\s*"SB"\s*\|\s*"LOCAL",\s*string>/.test(board)) {
    f.push(`${BOARD_FILE}: TRIP_COLOR map does not include LOCAL`);
  }
  if (!/LegendSwatch\s+color=\{TRIP_COLOR\.LOCAL\}/.test(board)) {
    f.push(`${BOARD_FILE}: legend does not render a LOCAL swatch`);
  }
  if (!/case\s+"LOCAL":/.test(board)) {
    f.push(`${BOARD_FILE}: the segment filter has no "LOCAL" case -- the board's LOCAL toggle would be dead`);
  }

  return f;
}

function selftest() {
  const goodMigration = "ALTER TYPE mdata.trip_type_enum ADD VALUE IF NOT EXISTS 'LOCAL' AFTER 'SB';";
  const goodSchema = 'trip_type: z.enum(["NB", "TR", "SB", "LOCAL"]).optional(),';
  const goodBoard = `
    const TRIP_COLOR: Record<"NB" | "TR" | "SB" | "LOCAL", string> = { NB: "#1F2A44", TR: "#64748b", SB: "#334155", LOCAL: "#0f172a" };
    <LegendSwatch color={TRIP_COLOR.LOCAL} label="LOCAL Laredo—Laredo" />
    case "LOCAL": return t.legs.some((l) => l.trip_type === "LOCAL");
  `;
  const baseline = check({ migration: goodMigration, schema: goodSchema, board: goodBoard });
  if (baseline.length) {
    console.error(`${LABEL} SELFTEST FAIL — good fixtures rejected: ${baseline.join(" | ")}`);
    process.exit(1);
  }

  const cases = [
    ["migration missing the ADD VALUE", { migration: "-- no alter type here", schema: goodSchema, board: goodBoard }],
    ["migration missing AFTER 'SB'", { migration: "ALTER TYPE mdata.trip_type_enum ADD VALUE 'LOCAL';", schema: goodSchema, board: goodBoard }],
    ["PATCH schema missing LOCAL", { migration: goodMigration, schema: 'trip_type: z.enum(["NB", "TR", "SB"]).optional(),', board: goodBoard }],
    ["board TRIP_COLOR missing LOCAL", { migration: goodMigration, schema: goodSchema, board: `const TRIP_COLOR: Record<"NB" | "TR" | "SB", string> = { NB: "x", TR: "y", SB: "z" };` }],
    ["board legend missing LOCAL swatch", { migration: goodMigration, schema: goodSchema, board: goodBoard.replace('<LegendSwatch color={TRIP_COLOR.LOCAL} label="LOCAL Laredo—Laredo" />', "") }],
    ["board segment filter missing LOCAL case", { migration: goodMigration, schema: goodSchema, board: goodBoard.replace('case "LOCAL": return t.legs.some((l) => l.trip_type === "LOCAL");', "") }],
  ];
  const escaped = [];
  for (const [name, fixtures] of cases) {
    if (check(fixtures).length === 0) escaped.push(name);
  }
  if (escaped.length) {
    console.error(`${LABEL} SELFTEST FAIL — escaped: ${escaped.join(", ")}`);
    process.exit(1);
  }
  console.log(`${LABEL} SELFTEST OK — ${cases.length}/${cases.length} plants rejected`);
}

if (process.argv.includes("--selftest")) {
  selftest();
} else {
  const findings = check();
  if (findings.length) {
    console.error(`${LABEL}: FAIL`);
    for (const e of findings) console.error("  ✗ " + e);
    process.exit(1);
  }
  console.log(`${LABEL}: OK — 'LOCAL' is pinned in the migration, the dispatch load PATCH schema, and the Trip Pairing board`);
}
