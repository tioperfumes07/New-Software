#!/usr/bin/env tsx
/**
 * scripts/ops/split-seed-tours.ts — TOUR-SPLIT-PLAN (ROUND 9, CC-3, READ-ONLY this round).
 *
 * FACT: the settlement seed created ONE driver_finance.driver_settlements row per DRIVER (15 open
 * USMCA rows, S-13642…S-13656). The SIGNED source is one settlement per TRIP (5769…5787+, per the
 * "USMCA BY LOAD" sheet's col C). See docs/audit/TOUR-SPLIT-PLAN-2026-09-06.md for the full
 * mapping, the keep/carve rule (never repoint a HOLD load), and the open questions this script's
 * output cannot resolve on its own.
 *
 * WHAT THIS SCRIPT DOES (--dry-run, the ONLY mode that actually runs anything today):
 *   1. Reads docs/bus/settlement-entry-2026-09-04/IH35-BY-LOAD-20260904-WITH-DIESEL_1.xlsx's
 *      "USMCA BY LOAD" sheet — col C (Settl #) / col D (Load #), row type LOAD only.
 *   2. Reads live mdata.loads JOIN driver_finance.driver_settlements (read-only, BEGIN + lucia
 *      bypass + ROLLBACK — never a write) for the CURRENT presettlement_link_id of every load.
 *   3. For every mega-tour that carries more than one distinct signed settlement number, applies
 *      the keep/carve rule: whichever signed number owns one of the 8 HOLD loads keeps the
 *      existing settlement row (untouched); every OTHER signed number on that mega-tour is
 *      proposed as a NEW settlement, with its (non-HOLD) loads proposed to repoint. Where neither
 *      side owns a HOLD load, the numerically-lower settlement number is proposed to keep the row
 *      (arbitrary — flagged as such, see the plan doc §4.2).
 *   4. Prints the full per-settlement plan. Never calls a write.
 *
 * WHAT --apply WOULD DO, ONCE AUTHORIZED (NOT built here — this round is READ-ONLY):
 *   For a "KEEP" settlement: UPDATE driver_finance.driver_settlements SET source_document_ref = ...
 *   (a proposed additive column — see the plan doc §1a; does not exist yet, no migration authored).
 *   For a "NEW" settlement: the SAME real functions book-load.service.ts already calls at booking
 *   time — presettlement-link.service.ts's confirmPresettlementLink(client, {action:'create_new', ...})
 *   to mint the row (same allocateNextSettlementDisplayId sequence, same INSERT shape, same
 *   settlement_model='load_bookended' convention), immediately followed by
 *   confirmPresettlementLink(client, {action:'link_existing', override_settlement_id, ...}) for
 *   every other (non-HOLD) load that belongs to that same signed number — never a raw UPDATE of
 *   mdata.loads.presettlement_link_id, matching this repo's "no raw SQL for a financial write" law.
 *   This script does NOT import those functions for execution yet — there is nothing for --apply
 *   to call until the lead's ✔ authorizes it (see below) and source_document_ref exists.
 *
 * --apply IS HARD-REFUSED THIS ROUND. It requires the lead's ✔ quoted VERBATIM as the
 * LEAD_APPROVAL_QUOTE constant below (currently empty) — an empty/placeholder value always
 * refuses, regardless of the --apply flag. This is deliberate: the plan doc's own open questions
 * (§4) are not resolved, and no migration for source_document_ref has landed.
 *
 * Usage:
 *   DATABASE_URL=<Neon prod, read-only-equivalent — this script issues 0 writes> npx tsx scripts/ops/split-seed-tours.ts --dry-run
 *   npx tsx scripts/ops/split-seed-tours.ts --apply   (always refuses this round — see LEAD_APPROVAL_QUOTE)
 */
import ExcelJS from "exceljs";
import pg from "pg";

const USMCA_COMPANY_ID = "5c854333-6ea5-4faa-af31-67cb272fef80";
const XLSX_PATH = "docs/bus/settlement-entry-2026-09-04/IH35-BY-LOAD-20260904-WITH-DIESEL_1.xlsx";

// The owner's explicit never-touch list (docs/bus/ROUND-9-INSTRUCTIONS-ALL-SEATS-2026-09-06.md's
// own "Measured facts" line). A load in this set is NEVER a repoint target, in --dry-run's plan
// output or in any future --apply — the keep/carve rule below hard-codes this.
const HOLD_LOADS = new Set(["13512", "13513", "13520", "13528", "13532", "13535", "13536", "13537"]);

// Empty on purpose. --apply refuses unless this is set to the lead's ✔ quoted VERBATIM in a
// future PR (and even then, only after source_document_ref exists — see the plan doc §1a).
const LEAD_APPROVAL_QUOTE = "";

type SignedLoad = { settl: string; load: string; driver: string | null };

async function readSignedLoads(): Promise<SignedLoad[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(XLSX_PATH);
  const ws = wb.getWorksheet("USMCA BY LOAD");
  if (!ws) throw new Error(`"USMCA BY LOAD" sheet not found in ${XLSX_PATH}`);
  const out: SignedLoad[] = [];
  ws.eachRow((row) => {
    if (String(row.getCell(2).value ?? "") !== "LOAD") return;
    const settl = row.getCell(3).value;
    const load = row.getCell(4).value;
    if (settl == null || load == null) return; // not-yet-signed load — not in this plan's scope
    out.push({ settl: String(settl).trim(), load: String(load).trim(), driver: (row.getCell(12).value as string) ?? null });
  });
  return out;
}

type LiveLoadLink = { load_number: string; display_id: string; settlement_id: string; load_status: string; trip_type: string | null };

async function readLiveLinks(client: pg.Client): Promise<LiveLoadLink[]> {
  await client.query("BEGIN");
  await client.query(`SELECT set_config('app.bypass_rls', 'lucia', true)`);
  const res = await client.query<LiveLoadLink>(
    `
      SELECT l.load_number, ds.display_id, ds.id::text AS settlement_id, l.status::text AS load_status, l.trip_type
        FROM mdata.loads l
        JOIN driver_finance.driver_settlements ds ON ds.id = l.presettlement_link_id
       WHERE l.operating_company_id = $1
    `,
    [USMCA_COMPANY_ID]
  );
  await client.query("ROLLBACK");
  return res.rows;
}

type PlanRow = {
  settl: string;
  loads: string[];
  driver: string | null;
  currentDisplayId: string | null; // null when unlinked (e.g. settlement 5769's orphan load)
  action: "KEEP" | "NEW";
  reason: string;
};

function buildPlan(signed: SignedLoad[], live: LiveLoadLink[]): PlanRow[] {
  const liveByLoad = new Map(live.map((r) => [r.load_number, r]));

  // Group signed loads by settlement number.
  const bySettl = new Map<string, { driver: string | null; loads: string[] }>();
  for (const s of signed) {
    if (!bySettl.has(s.settl)) bySettl.set(s.settl, { driver: s.driver, loads: [] });
    bySettl.get(s.settl)!.loads.push(s.load);
  }

  // Group settlement numbers by their CURRENT mega-tour display_id (undefined -> orphan bucket).
  const megaTourOf = new Map<string, string | null>(); // settl -> current display_id (first load's)
  for (const [settl, info] of bySettl) {
    const displayIds = new Set(info.loads.map((l) => liveByLoad.get(l)?.display_id ?? null));
    megaTourOf.set(settl, [...displayIds][0] ?? null);
  }
  const settlsByMegaTour = new Map<string | null, string[]>();
  for (const [settl, displayId] of megaTourOf) {
    if (!settlsByMegaTour.has(displayId)) settlsByMegaTour.set(displayId, []);
    settlsByMegaTour.get(displayId)!.push(settl);
  }

  const plan: PlanRow[] = [];
  for (const [displayId, settls] of settlsByMegaTour) {
    if (displayId === null) {
      // Orphan(s) — no current link at all. Always a NEW settlement (nothing to keep).
      for (const settl of settls) {
        const info = bySettl.get(settl)!;
        plan.push({ settl, loads: info.loads, driver: info.driver, currentDisplayId: null, action: "NEW", reason: "no current presettlement_link_id — never linked (orphan)" });
      }
      continue;
    }
    if (settls.length === 1) {
      const settl = settls[0]!;
      const info = bySettl.get(settl)!;
      plan.push({ settl, loads: info.loads, driver: info.driver, currentDisplayId: displayId, action: "KEEP", reason: "only signed settlement number on this mega-tour" });
      continue;
    }
    // Multiple signed numbers share one mega-tour — apply the keep/carve rule.
    const holderOfHold = settls.find((settl) => bySettl.get(settl)!.loads.some((l) => HOLD_LOADS.has(l)));
    const keeper = holderOfHold ?? [...settls].sort((a, b) => Number(a) - Number(b))[0]!;
    for (const settl of settls) {
      const info = bySettl.get(settl)!;
      if (settl === keeper) {
        plan.push({
          settl,
          loads: info.loads,
          driver: info.driver,
          currentDisplayId: displayId,
          action: "KEEP",
          reason: holderOfHold ? "owns a HOLD load — never repointed" : "arbitrary (lower number) — no HOLD load either side, flag for lead override",
        });
      } else {
        const nonHoldLoads = info.loads.filter((l) => !HOLD_LOADS.has(l));
        if (nonHoldLoads.length !== info.loads.length) {
          throw new Error(`REFUSING TO PLAN: settlement ${settl} carves loads that include a HOLD load — this must never happen`);
        }
        plan.push({ settl, loads: nonHoldLoads, driver: info.driver, currentDisplayId: displayId, action: "NEW", reason: `carved out of ${displayId} (kept by settlement ${keeper})` });
      }
    }
  }
  return plan.sort((a, b) => Number(a.settl) - Number(b.settl));
}

function printPlan(plan: PlanRow[]) {
  console.log("=== TOUR-SPLIT-PLAN dry-run ===\n");
  let keepCount = 0;
  let newCount = 0;
  let repointedLoads = 0;
  for (const row of plan) {
    console.log(`Settlement ${row.settl} (${row.driver ?? "unknown driver"}) — loads: ${row.loads.join(", ")}`);
    console.log(`  current: ${row.currentDisplayId ?? "UNLINKED"}`);
    console.log(`  action:  ${row.action} — ${row.reason}`);
    console.log("");
    if (row.action === "KEEP") keepCount += 1;
    else {
      newCount += 1;
      repointedLoads += row.loads.length;
    }
  }
  console.log(`TOTAL: ${plan.length} signed settlement(s) — ${keepCount} KEEP in place (tag only), ${newCount} NEW (${repointedLoads} load(s) to repoint/link)`);
  const holdTouched = plan.filter((r) => r.action === "NEW" && r.loads.some((l) => HOLD_LOADS.has(l)));
  console.log(`HOLD-load safety check: ${holdTouched.length === 0 ? "PASS — no HOLD load appears in any NEW/repoint row" : "FAIL — " + JSON.stringify(holdTouched)}`);
}

async function main() {
  const apply = process.argv.includes("--apply");
  if (apply) {
    if (!LEAD_APPROVAL_QUOTE.trim()) {
      console.error("REFUSED: --apply requires the lead's ✔ quoted verbatim in LEAD_APPROVAL_QUOTE. Not set — this round is READ-ONLY.");
      process.exit(1);
    }
    console.error("REFUSED: --apply write path is not built yet (no source_document_ref migration, open questions in the plan doc §4 unresolved). This round is READ-ONLY regardless of LEAD_APPROVAL_QUOTE.");
    process.exit(1);
  }

  const signed = await readSignedLoads();
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const live = await readLiveLinks(client);
  await client.end();

  const plan = buildPlan(signed, live);
  printPlan(plan);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
