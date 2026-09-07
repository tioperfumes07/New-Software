#!/usr/bin/env node
/**
 * verify-fleet-sample-data-quarantine.mjs
 *
 * ROUND 16.19 TASK A (Claude Lead, 2026-09-06 23:5xZ): "1 unit with is_sample_data=true is
 * live/active/unquarantined in Fleet ... quarantine it through the real quarantine path (flag,
 * never hard-delete), confirm 0 sample-data units remain active in the live Fleet list."
 *
 * Measured live: not a single mis-set is_sample_data row (every is_sample_data=true row already
 * had deactivated_at set) — the real leak was TWO mdata.equipment (trailer) rows that were
 * genuine CI/agent fixtures ("CODEX-TEST-0033-TRAILER", "CODEX-RELAY-TRAILER-20260824") but
 * survived BOTH of Fleet's exclusion predicates: excludeDemoPhantomSql (name doesn't start with
 * SAM-/TEST/contain DEMO — it starts with "CODEX-") AND excludeSampleDataSql (is_sample_data was
 * never set on them). A genuine gap also existed one level deeper: mdata.equipment's PATCH route
 * (and mdata.units's) never exposed is_sample_data as a patchable field at all — mdata.vendors's
 * own FAC-10 quarantine field was the only entity with a real, audited flip-the-flag path. Fixed
 * both: (1) added is_sample_data to both PATCH schemas so quarantine now goes through the same
 * audited appendCrudAudit/buildPatchChanges path every other field uses, never a bare UPDATE, and
 * (2) flagged the 2 live leaks is_sample_data=true through that exact path.
 *
 * Static check: both equipment.routes.ts's updateEquipmentBodySchema and
 * unit-update-schema.ts's UNIT_PATCHABLE_FIELD_KEYS include is_sample_data — the quarantine path
 * is real and audited, not a one-off ops-script UPDATE that could never be repeated by a human.
 *
 * Live check: re-derives the EXACT Fleet exclusion predicate (excludeDemoPhantomSql AND
 * excludeSampleDataSql) independently in SQL for both mdata.units and mdata.equipment, and
 * asserts zero rows survive both predicates while still carrying an obvious CI/agent-fixture name
 * marker (codex/devin/cascade/claude/cursor/cc-/fixture/relay/legal/audit) — the exact shape of
 * the leak this guard exists to prevent from silently recurring.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LABEL = "verify-fleet-sample-data-quarantine";
const EQUIPMENT_ROUTES_FILE = "apps/backend/src/mdata/equipment.routes.ts";
const UNIT_SCHEMA_FILE = "apps/backend/src/mdata/unit-update-schema.ts";

function load(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

const REQUIRED_MARKERS = [
  [EQUIPMENT_ROUTES_FILE, "is_sample_data: z.boolean().optional()", "updateEquipmentBodySchema does not expose is_sample_data as PATCHable — no real quarantine path for trailers"],
  [EQUIPMENT_ROUTES_FILE, 'if ("is_sample_data" in b) add("is_sample_data", b.is_sample_data);', "equipment PATCH handler does not actually write is_sample_data even if schema allows it"],
  [UNIT_SCHEMA_FILE, '"is_sample_data",', "UNIT_PATCHABLE_FIELD_KEYS does not include is_sample_data — no real quarantine path for trucks"],
  [UNIT_SCHEMA_FILE, "is_sample_data: z.boolean(),", "unit-update-schema.ts's fieldSchemas map has no is_sample_data entry"],
];

export function check({
  equipmentRoutes = load(EQUIPMENT_ROUTES_FILE),
  unitSchema = load(UNIT_SCHEMA_FILE),
} = {}) {
  const sources = { [EQUIPMENT_ROUTES_FILE]: equipmentRoutes, [UNIT_SCHEMA_FILE]: unitSchema };
  const f = [];
  for (const [file, marker, msg] of REQUIRED_MARKERS) {
    if (!sources[file].includes(marker)) f.push(`${file}: ${msg}`);
  }
  return f;
}

function selftest() {
  const good = { equipmentRoutes: load(EQUIPMENT_ROUTES_FILE), unitSchema: load(UNIT_SCHEMA_FILE) };
  if (check(good).length) {
    console.error(`${LABEL} SELFTEST FAIL — good fixtures rejected: ${check(good).join(" | ")}`);
    process.exit(1);
  }

  let n = 0;
  const plants = [
    {
      name: "equipment PATCH schema no longer accepts is_sample_data",
      mutate: () => ({ ...good, equipmentRoutes: good.equipmentRoutes.replace("is_sample_data: z.boolean().optional()", "// stripped") }),
    },
    {
      name: "equipment PATCH handler no longer writes is_sample_data",
      mutate: () => ({
        ...good,
        equipmentRoutes: good.equipmentRoutes.replace(
          'if ("is_sample_data" in b) add("is_sample_data", b.is_sample_data);',
          "// stripped"
        ),
      }),
    },
    {
      name: "UNIT_PATCHABLE_FIELD_KEYS no longer lists is_sample_data",
      mutate: () => ({ ...good, unitSchema: good.unitSchema.replace('"is_sample_data",', "// stripped") }),
    },
    {
      name: "unit fieldSchemas no longer has an is_sample_data entry",
      mutate: () => ({ ...good, unitSchema: good.unitSchema.replace("is_sample_data: z.boolean(),", "// stripped") }),
    },
  ];
  for (const plant of plants) {
    n++;
    const bad = plant.mutate();
    if (check(bad).length === 0) {
      console.error(`${LABEL} SELFTEST FAIL — plant "${plant.name}" was not caught`);
      process.exit(1);
    }
  }
  console.log(`${LABEL} SELFTEST OK — ${n}/${n} plants rejected`);
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
  console.log(`${LABEL}: static OK — is_sample_data is a real, audited PATCH field on both mdata.units and mdata.equipment`);

  if (!process.env.DATABASE_URL && !process.env.DATABASE_DIRECT_URL) {
    console.log(`${LABEL}: DATABASE_URL not set — skipping the live re-check (static check above still ran).`);
    process.exit(0);
  }

  // LIVE check: independently re-derive the exact Fleet exclusion predicate (excludeDemoPhantomSql
  // AND excludeSampleDataSql, fleet-visibility.ts) for both tables and assert zero rows survive
  // both while still carrying an obvious CI/agent-fixture name marker — the exact leak shape this
  // guard exists to catch, never re-deriving business logic beyond that one live-caught pattern.
  const { Client } = await import("pg");
  const client = new Client({ connectionString: process.env.DATABASE_DIRECT_URL || process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SELECT set_config('app.bypass_rls','lucia',true)`);

    const fixtureNameClause = (col) =>
      `(${col} ILIKE '%codex%' OR ${col} ILIKE '%devin%' OR ${col} ILIKE '%cascade%' OR ${col} ILIKE '%claude%'
        OR ${col} ILIKE '%cursor%' OR ${col} ILIKE '%cc-%' OR ${col} ILIKE '%fixture%' OR ${col} ILIKE '%relay%'
        OR ${col} ILIKE '%legal%' OR ${col} ILIKE '%audit%')`;

    const liveFindings = [];
    let counts = {};
    try {
      const truckLeaks = await client.query(`
        SELECT unit_number FROM mdata.units
        WHERE unit_number NOT ILIKE 'SAM-%' AND unit_number NOT ILIKE 'TEST%' AND unit_number NOT ILIKE '%DEMO%'
          AND is_sample_data IS NOT TRUE
          AND deactivated_at IS NULL
          AND ${fixtureNameClause("unit_number")}
      `);
      const trailerLeaks = await client.query(`
        SELECT equipment_number FROM mdata.equipment
        WHERE equipment_number NOT ILIKE 'SAM-%' AND equipment_number NOT ILIKE 'TEST%' AND equipment_number NOT ILIKE '%DEMO%'
          AND is_sample_data IS NOT TRUE
          AND deactivated_at IS NULL
          AND ${fixtureNameClause("equipment_number")}
      `);
      counts = { truck_leaks: truckLeaks.rows.length, trailer_leaks: trailerLeaks.rows.length };
      if (truckLeaks.rows.length > 0) {
        liveFindings.push(`${truckLeaks.rows.length} active fixture-named truck(s) survive BOTH Fleet exclusion predicates: ${truckLeaks.rows.map((r) => r.unit_number).join(", ")}`);
      }
      if (trailerLeaks.rows.length > 0) {
        liveFindings.push(`${trailerLeaks.rows.length} active fixture-named trailer(s) survive BOTH Fleet exclusion predicates: ${trailerLeaks.rows.map((r) => r.equipment_number).join(", ")}`);
      }
    } catch (err) {
      liveFindings.push(`leak re-derivation query failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    await client.query("ROLLBACK");

    if (liveFindings.length) {
      console.error(`${LABEL}: LIVE FAIL`);
      for (const e of liveFindings) console.error("  ✗ " + e);
      process.exit(1);
    }
    console.log(`${LABEL}: LIVE OK — 0 sample-data units/trailers active and unquarantined in the live Fleet list.`, counts);
  } finally {
    await client.end();
  }
}
