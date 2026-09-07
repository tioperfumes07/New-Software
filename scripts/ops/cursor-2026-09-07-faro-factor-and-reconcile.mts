#!/usr/bin/env tsx
/**
 * cursor-2026-09-07-faro-factor-and-reconcile.mts — owner 2026-09-07 ("close factoring with the same
 * real data as the Faro files; never defer").
 *
 * Faro's real purchase export (Downloads/export (3).csv) was reconciled to the USMCA app invoices by
 * PO == load W.O.# + exact amount (48 of 51 rows matched; derivation in
 * Downloads/faro_map_build.py). 20 of those 48 already carry a real factoring_advance (FAC-2026-00001..20).
 * This script closes the remaining ones through the REAL factoring service, then populates the empty
 * Faro reconciliation ledger (factor.faro_daily_imports).
 *
 * PHASE A — create + advance the 21 not-yet-factored matched invoices through the REAL routes
 *   POST /api/v1/accounting/factoring-advances            (reserve_pct=1.5, factor_fee_pct=1.5 — the
 *                                                           exact terms of FAC-2026-00001..20)
 *   POST /api/v1/accounting/factoring-advances/:id/advance (posts the ASC 860 secured-borrowing JE)
 *   — same mechanism as scripts/ops/fact-02-seed-faro-factoring-purchases.ts. NO RAW SQL on money.
 *   Idempotent: skips any invoice already 'advanced'/'submitted'.
 *   EXCLUDES the 8 OWNER_HAND_LOADS (fact-02): the owner builds those by hand; Faro shows it purchased
 *   7 of them, but overriding that explicit hold is the owner's call — reported, never auto-factored.
 *
 * PHASE B — commitFaroCsvImport with the 41-row reconcile CSV (the 20 existing + 21 new; held loads
 *   excluded) to write factor.faro_daily_imports and reconcile Faro actuals vs each advance
 *   (variance report). Funding already posted in Phase A / earlier => idempotent, no double-post.
 *   The flat $10 Faro wire fee (owner: separate expense, not folded into the 1.5%) surfaces as a
 *   per-advance fee variance, which is the correct reconciliation signal.
 *
 * Usage:
 *   DATABASE_URL=<neon-usmca> npx tsx scripts/ops/cursor-2026-09-07-faro-factor-and-reconcile.mts             # dry-run
 *   DATABASE_URL=<neon-usmca> npx tsx scripts/ops/cursor-2026-09-07-faro-factor-and-reconcile.mts --apply
 *   DATABASE_URL=<neon-usmca> npx tsx scripts/ops/cursor-2026-09-07-faro-factor-and-reconcile.mts --apply --phase=a
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";
import { createIntegrationApp } from "../../apps/backend/test-helpers/http-app.js";
import factoringAdvancesPlugin from "../../apps/backend/src/accounting/factoring-advances.routes.js";
import { registerFaroCsvImportRoutes } from "../../apps/backend/src/factoring/faro-csv-import.routes.js";

const USMCA = "5c854333-6ea5-4faa-af31-67cb272fef80";
const OWNER = "e4117991-d2c0-406d-8cda-74e98d95bccd";
const FARO_VENDOR_ID = "a1f4c2b6-8e35-4f91-9c2d-6b7a58e0f3c4"; // confirmed live against FAC-2026-00001
const RESERVE_PCT = 1.5;
const FACTOR_FEE_PCT = 1.5;
const APPLY = process.argv.includes("--apply");
const phaseArg = process.argv.find((a) => a.startsWith("--phase="));
const PHASE = phaseArg ? phaseArg.slice(8) : "ab";
const STATEMENT_DATE = "2026-09-04"; // last Faro purchase date in export (3).csv; <= company business date

const __dirname = dirname(fileURLToPath(import.meta.url));
const createIds: string[] = JSON.parse(readFileSync(join(__dirname, "cursor-2026-09-07-faro-create-ids.json"), "utf8"));
const reconcileCsv = readFileSync(join(__dirname, "cursor-2026-09-07-faro-import-reconcile.csv"), "utf8");

const auth = {
  "x-test-auth": Buffer.from(JSON.stringify({ id: OWNER, role: "Owner", email: "tioperfumes07@gmail.com" }), "utf8").toString("base64url"),
  "content-type": "application/json",
};

async function readInvoice(client: pg.PoolClient, displayId: string) {
  await client.query("BEGIN");
  try {
    await client.query(`SET LOCAL app.bypass_rls='lucia'`);
    const r = await client.query<{ id: string; status: string; factoring_status: string | null; total_cents: string }>(
      `SELECT id::text, status::text, factoring_status::text, total_cents::text
         FROM accounting.invoices
        WHERE operating_company_id=$1::uuid AND display_id=$2 AND status<>'void' LIMIT 1`,
      [USMCA, displayId]
    );
    await client.query("COMMIT");
    return r.rows[0] ?? null;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  }
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 3 });
  process.env.IH35_TEST_AUTH_BYPASS = "1";
  const app = await createIntegrationApp(async (a) => {
    await (factoringAdvancesPlugin as unknown as (x: typeof a) => Promise<void>)(a);
    await registerFaroCsvImportRoutes(a);
  });
  const client = await pool.connect();
  const report: string[] = [];
  try {
    // ---------- PHASE A ----------
    if (PHASE.includes("a")) {
      let done = 0, skip = 0, fail = 0;
      for (const displayId of createIds) {
        const inv = await readInvoice(client, displayId);
        if (!inv) { report.push(`A MISS ${displayId} — invoice not visible (deactivated customer RLS?)`); fail += 1; continue; }
        const fs = inv.factoring_status ?? "not_factored";
        if (fs === "advanced" || fs === "submitted") { skip += 1; continue; }
        if (inv.status !== "sent") { report.push(`A SKIP ${displayId} — status ${inv.status} (needs sent)`); continue; }
        if (!APPLY) { report.push(`A DRY-RUN ${displayId} — would create advance $${(Number(inv.total_cents)/100).toFixed(2)} @1.5/1.5 then /advance`); done += 1; continue; }
        const createRes = await app.inject({
          method: "POST", url: `/api/v1/accounting/factoring-advances?operating_company_id=${USMCA}`, headers: auth,
          payload: { factoring_company_vendor_id: FARO_VENDOR_ID, submission_batch_ref: `CURSOR-FARO-${displayId}`,
            invoice_ids: [inv.id], reserve_pct: RESERVE_PCT, factor_fee_pct: FACTOR_FEE_PCT,
            notes: `Faro reconciliation close 2026-09-07 — load ${displayId} (PO==W.O.# + exact amount match to Faro export)` },
        });
        if (createRes.statusCode >= 300) { report.push(`A FAIL create ${displayId} :: ${createRes.statusCode} ${createRes.body.slice(0,180)}`); fail += 1; continue; }
        const created = JSON.parse(createRes.body) as { id: string; display_id: string; advance_amount_cents: number; reserve_amount_cents: number; factor_fee_cents: number };
        const advanceRes = await app.inject({ method: "POST", url: `/api/v1/accounting/factoring-advances/${created.id}/advance?operating_company_id=${USMCA}`, headers: auth, payload: {} });
        if (advanceRes.statusCode >= 300) { report.push(`A FAIL advance ${displayId} (${created.display_id}) :: ${advanceRes.statusCode} ${advanceRes.body.slice(0,180)}`); fail += 1; continue; }
        report.push(`A DONE ${displayId} -> ${created.display_id} advance=$${(created.advance_amount_cents/100).toFixed(2)} reserve=$${(created.reserve_amount_cents/100).toFixed(2)} fee=$${(created.factor_fee_cents/100).toFixed(2)}`);
        done += 1;
      }
      report.push(`\nPHASE A ${APPLY ? "APPLIED" : "DRY-RUN"}: created=${done} skip(already)=${skip} fail=${fail}`);
    }

    // ---------- PHASE B ----------
    if (PHASE.includes("b")) {
      // Reconcile ONLY invoices that are actually 'advanced' now — never let the import flip a
      // proforma/not-yet-funded invoice to advanced with no funding JE (inconsistent GL).
      const header = reconcileCsv.split(/\r?\n/)[0];
      const bodyRows = reconcileCsv.split(/\r?\n/).slice(1).filter((l) => l.trim());
      const advancedSet = new Set<string>();
      await client.query("BEGIN");
      try {
        await client.query(`SET LOCAL app.bypass_rls='lucia'`);
        const adv = await client.query<{ display_id: string }>(
          `SELECT display_id FROM accounting.invoices WHERE operating_company_id=$1::uuid AND factoring_status='advanced' AND status<>'void'`,
          [USMCA]
        );
        await client.query("COMMIT");
        adv.rows.forEach((r) => advancedSet.add(r.display_id));
      } catch (e) { await client.query("ROLLBACK"); throw e; }
      const keep = bodyRows.filter((l) => advancedSet.has((l.split(",")[0] ?? "").trim()));
      const filteredCsv = [header, ...keep].join("\n");
      if (!APPLY) {
        report.push(`\nPHASE B DRY-RUN — would import ${keep.length} advanced-only rows (statement ${STATEMENT_DATE}) to populate factor.faro_daily_imports + reconcile.`);
      } else {
        const res = await app.inject({
          method: "POST", url: `/api/v1/factoring/import/faro`, headers: auth,
          payload: { operating_company_id: USMCA, csv_text: filteredCsv, statement_date: STATEMENT_DATE,
            statement_reference: "Faro purchase export 08/10-09/04 (cursor reconcile 2026-09-07)", source_filename: "export (3).csv" },
        });
        if (res.statusCode >= 300) report.push(`\nPHASE B FAIL — ${res.statusCode} ${res.body.slice(0,400)}`);
        else {
          const r = JSON.parse(res.body);
          report.push(`\nPHASE B DONE — import_id=${r.import_id} lines=${r.line_count} invoices_updated=${r.invoices_updated} reserve_movements=${r.reserve_movements} gl_enabled=${r.factoring_gl_posting_enabled} variances=${r.variance_count} incomplete=${r.incomplete_advance_count} funding_posts=${(r.funding_posts||[]).filter((p:any)=>p.posted).length}`);
        }
      }
    }
  } finally {
    client.release();
    await app.close();
    await pool.end();
  }
  console.log(report.join("\n"));
}
main().catch((e) => { console.error(e); process.exit(1); });
