import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildPgClientConfig } from "../../lib/pg-connection-options.js";
import { DETECTOR_REGISTRY } from "./detector.service.js";

/**
 * Anomaly-detector phantom-relation guard. The detector service threw Postgres 42P01/42703 on every run
 * because it referenced relations/columns that don't exist (the schema it was coded against never matched
 * reality). Real fixes: dispatch.loads → mdata.loads, safety.dvir_reports → safety.dvir_submissions
 * (has_major_defect), is_dispatch_blocked → archived_at; fuel-off-route + pm-due are safe no-ops (no data
 * source). This guard:
 *  (1) fails if ANY backend SQL selects FROM/JOIN a known phantom relation, and
 *  (2) proves the disabled detectors are safe no-ops (return [] without touching the DB).
 */

// schema.table names that DO NOT EXIST — real targets given in the comment above.
// NOTE: dispatch.loads + safety.dvir_reports are ALSO referenced by ~8 other backend files (factoring,
// search-indexer, alerts, smoke-probe, wf-050 gate) — a separate systemic bug surfaced + flagged for Jorge;
// this guard is scoped to the detector service it ships with so it stays green and bites on regression here.
const PHANTOM_RELATIONS = ["fuel.transactions", "dispatch.loads", "safety.dvir_reports"];

const DETECTOR_SRC = join(dirname(fileURLToPath(import.meta.url)), "detector.service.ts");

describe("anomaly detector — phantom-relation guard", () => {
  it("the detector service selects FROM/JOIN no known phantom relation", () => {
    const src = readFileSync(DETECTOR_SRC, "utf8");
    const offenders: string[] = [];
    for (const rel of PHANTOM_RELATIONS) {
      const esc = rel.replace(/[.]/g, "\\.");
      // SQL-context only (FROM/JOIN/INTO/UPDATE <relation>) — not prose mentions in comments.
      if (new RegExp(`\\b(from|join|into|update)\\s+${esc}\\b`, "i").test(src)) offenders.push(rel);
    }
    expect(offenders, `detector references phantom relations: ${offenders.join(", ")}`).toEqual([]);
  });

  for (const name of ["fuel_off_route_geo", "pm_due_advisory"]) {
    it(`${name} detector is a safe no-op (returns [] without a DB call)`, async () => {
      const detector = DETECTOR_REGISTRY[name];
      expect(detector).toBeTypeOf("function");
      const client = {
        query: async () => {
          throw new Error("detector must NOT query the DB while disabled");
        },
      };
      const findings = await detector(client as never, "00000000-0000-0000-0000-000000000000", {});
      expect(findings).toEqual([]);
    });
  }
});

/**
 * ROUND 16.4 (owner 2026-09-06 21:15Z) — Render logs every cadence: detectDvirMajorOpen threw
 * Postgres 42P10 "for SELECT DISTINCT, ORDER BY expressions must appear in select list" (a CAST in
 * the select list, `d.id::text AS dvir_id`, is a different expression than the bare `d.id` the
 * ORDER BY clause used), then "current transaction is aborted" cascaded across every other rule.
 * detectInactiveDriverAssignment had the identical bug. Runs only in CI (GITHUB_ACTIONS=true)
 * against a fully-migrated Postgres, same convention as settlement-payrun-close.db.test.ts.
 */
const describeIntegration = describe.skipIf(process.env.GITHUB_ACTIONS !== "true");
const NIL_UUID = "00000000-0000-0000-0000-000000000000";

describeIntegration("anomaly detector — SELECT DISTINCT / ORDER BY (real Postgres, 42P10 regression)", () => {
  let client: pg.Client;

  beforeAll(async () => {
    client = new pg.Client(buildPgClientConfig(process.env.DATABASE_URL!));
    await client.connect();
  });

  afterAll(async () => {
    await client.end();
  });

  it("dvir_major_open_unit executes without 42P10 (empty result on a nil company is fine — proving it PARSES/RUNS is the point)", async () => {
    const detector = DETECTOR_REGISTRY.dvir_major_open_unit;
    await expect(detector(client, NIL_UUID, {})).resolves.toEqual([]);
  });

  it("inactive_driver_assignment executes without 42P10", async () => {
    const detector = DETECTOR_REGISTRY.inactive_driver_assignment;
    await expect(detector(client, NIL_UUID, {})).resolves.toEqual([]);
  });

  it("the ORIGINAL (unfixed) shape genuinely throws 42P10 — proves this is a real Postgres rule, not a guessed fix", async () => {
    await expect(
      client.query(
        `SELECT DISTINCT d.unit_id::text AS unit_id, d.id::text AS dvir_id
           FROM safety.dvir_submissions d
          WHERE d.operating_company_id = $1::uuid AND d.has_major_defect = true
          ORDER BY d.id`,
        [NIL_UUID]
      )
    ).rejects.toMatchObject({ code: "42P10" });
  });
});
