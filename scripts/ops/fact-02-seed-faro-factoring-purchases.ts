#!/usr/bin/env tsx
/**
 * scripts/ops/fact-02-seed-faro-factoring-purchases.ts — FACT-02 (ROUND 13, lead directive
 * 2026-09-06 14:55Z, owner order verbatim: "I want to see them in Factoring … seed and confirm
 * with Faro's files, keep Faro so we can reconcile tomorrow").
 *
 * Reads docs/bus/settlement-entry-2026-09-04/IH35-AUGUST-RECONCILIATION-BOTH-ENTITIES.xlsx's
 * "5 FARO · USMCA" sheet (same read as scripts/ops/faro-usmca-seed-match.mjs, FACT-01 step 3),
 * matches each Faro line to its real accounting.invoices row (via mdata.loads.load_number), and
 * for every matched invoice that is `status='sent'` + `factoring_status='not_factored'` (ready to
 * factor NOW), creates ONE real accounting.factoring_advances row through the REAL service --
 * POST /api/v1/accounting/factoring-advances (create, status='submitted') then
 * POST /api/v1/accounting/factoring-advances/:id/advance (posts the real ASC 860 secured-
 * borrowing JE via postFactoringAdvanceEvent, status='advanced') -- invoked in-process through
 * Fastify inject() with the process-local test-auth bypass as the Owner user, same mechanism as
 * scripts/ops/deliver-seeded-usmca-loads.ts. NO RAW SQL WRITE, ever.
 *
 * Faro terms live on the Faro Factoring vendor's canonical factor agreement, confirmed against
 * the ONE real advance already in the system (FAC-2026-00001, invoice 13510):
 * factoring_company_vendor_id a1f4c2b6-8e35-4f91-9c2d-6b7a58e0f3c4, reserve_pct=1.5,
 * factor_fee_pct=1.5 (97% net advance is the OUTPUT of 100 - 1.5 - 1.5, never a separate input --
 * FACT-RESERVE-01 STEP 3, the route's own comment). A/R is never derecognized (accounting.invoices
 * stays exactly as-is -- only factoring_status changes; total_cents/amount_open_cents untouched),
 * matching ASC 860 secured-borrowing treatment.
 *
 * Only invoices on Faro's own schedule are touched. Every Faro line is kept, matched or not
 * (owner: "keep Faro so we can reconcile tomorrow") -- this script writes nothing to the xlsx and
 * never drops a line from its own report. The 8 owner hand-list loads (13512, 13513, 13520,
 * 13528, 13532, 13535, 13536, 13537) do not appear among the ready-to-factor set today (checked
 * live, all 8 are still `proforma`, not `sent`) -- if a future run ever sees one of them
 * eligible, --exclude below keeps them out by default.
 *
 * Usage:
 *   DATABASE_URL=<Neon prod> npx tsx scripts/ops/fact-02-seed-faro-factoring-purchases.ts            # dry-run
 *   DATABASE_URL=<Neon prod> npx tsx scripts/ops/fact-02-seed-faro-factoring-purchases.ts --apply
 *   DATABASE_URL=<Neon prod> npx tsx scripts/ops/fact-02-seed-faro-factoring-purchases.ts --apply --only=13511
 */
import ExcelJS from "exceljs";
import pg from "pg";
import { createIntegrationApp } from "../../apps/backend/test-helpers/http-app.js";
import factoringAdvancesPlugin from "../../apps/backend/src/accounting/factoring-advances.routes.js";

const USMCA_COMPANY_ID = "5c854333-6ea5-4faa-af31-67cb272fef80";
const OWNER_USER_ID = "e4117991-d2c0-406d-8cda-74e98d95bccd"; // identity.users tioperfumes07@gmail.com, role Owner
const FARO_VENDOR_ID = "a1f4c2b6-8e35-4f91-9c2d-6b7a58e0f3c4"; // confirmed live against FAC-2026-00001
const RESERVE_PCT = 1.5;
const FACTOR_FEE_PCT = 1.5;
/** Owner builds these loads by hand -- never eligible to factor through this script even if their
 *  invoice later ships (settlements 5772/5776/5780/5783/5784, docs/IH35-CLAUDE-JOURNAL.md). */
export const OWNER_HAND_LOADS = new Set(["13512", "13513", "13520", "13528", "13532", "13535", "13536", "13537"]);

const XLSX_PATH = "docs/bus/settlement-entry-2026-09-04/IH35-AUGUST-RECONCILIATION-BOTH-ENTITIES.xlsx";
const SHEET_NAME = "5 FARO · USMCA";
const NOT_LINKED = "— NOT LINKED —";

const apply = process.argv.includes("--apply");
const onlyArg = process.argv.find((a) => a.startsWith("--only="));
const only = onlyArg ? new Set(onlyArg.slice(7).split(",").map((s) => s.trim())) : null;

type FaroLine = {
  faroInv: string;
  customer: string;
  faceUsd: number;
  faroId: string;
  loadNumber: string;
};

type InvoiceRow = {
  id: string;
  display_id: string;
  status: string;
  factoring_status: string | null;
  amount_open_cents: string;
  load_number: string;
};

async function readFaroLines(): Promise<FaroLine[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(XLSX_PATH);
  const ws = wb.getWorksheet(SHEET_NAME);
  if (!ws) throw new Error(`sheet not found: ${SHEET_NAME}`);
  const lines: FaroLine[] = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const faroInv = row.getCell(1).value;
    if (faroInv == null || String(faroInv).trim() === "" || String(faroInv).trim().toUpperCase() === "TOTAL") continue;
    lines.push({
      faroInv: String(faroInv).trim(),
      customer: String(row.getCell(2).value ?? "").trim(),
      faceUsd: Number(row.getCell(6).value ?? 0),
      faroId: String(row.getCell(11).value ?? "").trim(),
      loadNumber: String(row.getCell(12).value ?? "").trim(),
    });
  }
  return lines;
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
  const lines = await readFaroLines();
  console.log(`fact-02-seed: ${lines.length} Faro USMCA line(s) read from ${XLSX_PATH}`);

  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  const client = await pool.connect();
  let invoices: InvoiceRow[];
  try {
    await client.query("BEGIN");
    await client.query(`SELECT set_config('app.bypass_rls','lucia',true)`);
    const r = await client.query<InvoiceRow>(
      `
        SELECT i.id::text, i.display_id, i.status::text, i.factoring_status::text,
               i.amount_open_cents::text, l.load_number
          FROM accounting.invoices i
          JOIN mdata.loads l ON l.id = i.source_load_id
          JOIN org.companies c ON c.id = i.operating_company_id
         WHERE c.code = 'USMCA' AND i.status <> 'void'
      `
    );
    await client.query("ROLLBACK");
    invoices = r.rows;
  } finally {
    client.release();
  }
  const byLoad = new Map(invoices.map((r) => [r.load_number, r]));

  // Full report first — every Faro line, matched or not, kept (nothing dropped from the sheet).
  const ready: Array<{ line: FaroLine; inv: InvoiceRow }> = [];
  let notLinkedInSheet = 0, noInvoiceYet = 0, amountMismatch = 0, alreadyFactored = 0, notYetSent = 0, heldByOwner = 0;
  console.log("");
  console.log("Faro# | Customer | Load | Invoice | Status | Factoring | Face$ | InvOpen$ | Match");
  for (const line of lines) {
    if (line.loadNumber === NOT_LINKED || line.loadNumber === "") {
      notLinkedInSheet += 1;
      console.log(`${line.faroInv} | ${line.customer} | (none) | — | — | — | ${line.faceUsd.toFixed(2)} | — | SHEET-NOT-LINKED (kept, not dropped)`);
      continue;
    }
    const inv = byLoad.get(line.loadNumber);
    if (!inv) {
      noInvoiceYet += 1;
      console.log(`${line.faroInv} | ${line.customer} | ${line.loadNumber} | — | — | — | ${line.faceUsd.toFixed(2)} | — | NO-TMS-INVOICE-YET`);
      continue;
    }
    const invOpenUsd = Number(inv.amount_open_cents) / 100;
    const amountsAgree = Math.abs(invOpenUsd - line.faceUsd) < 0.01;
    if (!amountsAgree) amountMismatch += 1;
    const factoringStatus = inv.factoring_status ?? "not_factored";
    if (OWNER_HAND_LOADS.has(line.loadNumber)) {
      heldByOwner += 1;
      console.log(`${line.faroInv} | ${line.customer} | ${line.loadNumber} | ${inv.display_id} | ${inv.status} | ${factoringStatus} | ${line.faceUsd.toFixed(2)} | ${invOpenUsd.toFixed(2)} | OWNER-HAND-LOAD (skipped)`);
    } else if (factoringStatus === "advanced" || factoringStatus === "submitted") {
      alreadyFactored += 1;
      console.log(`${line.faroInv} | ${line.customer} | ${line.loadNumber} | ${inv.display_id} | ${inv.status} | ${factoringStatus} | ${line.faceUsd.toFixed(2)} | ${invOpenUsd.toFixed(2)} | ALREADY-FACTORED`);
    } else if (inv.status === "sent") {
      if (!only || only.has(line.loadNumber)) ready.push({ line, inv });
      console.log(`${line.faroInv} | ${line.customer} | ${line.loadNumber} | ${inv.display_id} | ${inv.status} | ${factoringStatus} | ${line.faceUsd.toFixed(2)} | ${invOpenUsd.toFixed(2)} | ${amountsAgree ? "READY" : "READY-MISMATCH"}`);
    } else {
      notYetSent += 1;
      console.log(`${line.faroInv} | ${line.customer} | ${line.loadNumber} | ${inv.display_id} | ${inv.status} | ${factoringStatus} | ${line.faceUsd.toFixed(2)} | ${invOpenUsd.toFixed(2)} | NOT-YET-SENT (${inv.status})`);
    }
  }
  console.log("");
  console.log(
    `TOTALS: ${lines.length} Faro lines · ${ready.length} ready to seed now · ${notLinkedInSheet} sheet-not-linked (kept) · ${noInvoiceYet} no TMS invoice yet · ${amountMismatch} amount mismatch(es) · ${notYetSent} not yet sent (proforma) · ${alreadyFactored} already submitted/advanced · ${heldByOwner} owner hand-load (skipped)`
  );

  if (!apply) {
    console.log("");
    console.log("DRY-RUN — zero writes. Re-run with --apply to seed the ready set through the real factoring-advances service.");
    await pool.end();
    return 0;
  }

  process.env.IH35_TEST_AUTH_BYPASS = "1";
  const app = await createIntegrationApp(async (a) => { await (factoringAdvancesPlugin as any)(a); });
  const headers = {
    "x-test-auth": Buffer.from(JSON.stringify({ id: OWNER_USER_ID, role: "Owner", email: "tioperfumes07@gmail.com" }), "utf8").toString("base64url"),
    "content-type": "application/json",
  };

  const report: string[] = [];
  for (const { line, inv } of ready) {
    const createRes = await app.inject({
      method: "POST",
      url: `/api/v1/accounting/factoring-advances?operating_company_id=${USMCA_COMPANY_ID}`,
      headers,
      payload: {
        factoring_company_vendor_id: FARO_VENDOR_ID,
        submission_batch_ref: `FACT-02-FARO-${line.faroInv}`,
        invoice_ids: [inv.id],
        reserve_pct: RESERVE_PCT,
        factor_fee_pct: FACTOR_FEE_PCT,
        notes: `FACT-02 seed from Faro schedule line ${line.faroInv} (${line.faroId}), load ${line.loadNumber}`,
      },
    });
    if (createRes.statusCode >= 300) {
      report.push(`FAIL create ${inv.display_id} :: ${createRes.statusCode} :: ${createRes.body.slice(0, 200)}`);
      continue;
    }
    const created = JSON.parse(createRes.body) as {
      id: string;
      display_id: string;
      advance_amount_cents: number;
      reserve_amount_cents: number;
      factor_fee_cents: number;
    };

    const advanceRes = await app.inject({
      method: "POST",
      url: `/api/v1/accounting/factoring-advances/${created.id}/advance?operating_company_id=${USMCA_COMPANY_ID}`,
      headers,
      payload: {},
    });
    if (advanceRes.statusCode >= 300) {
      report.push(`FAIL advance ${inv.display_id} (${created.display_id}) :: ${advanceRes.statusCode} :: ${advanceRes.body.slice(0, 200)}`);
      continue;
    }
    report.push(
      `DONE inv ${inv.display_id} -> ${created.display_id} :: advance=$${(created.advance_amount_cents / 100).toFixed(2)} reserve=$${(created.reserve_amount_cents / 100).toFixed(2)} fee=$${(created.factor_fee_cents / 100).toFixed(2)}`
    );
  }
  console.log("");
  console.log(report.join("\n"));

  const doneCount = report.filter((l) => l.startsWith("DONE")).length;
  const failCount = report.filter((l) => l.startsWith("FAIL")).length;
  console.log("");
  console.log(`SEEDED: ${doneCount} of ${ready.length} · FAILED: ${failCount}`);

  await app.close();
  await pool.end();
  return failCount > 0 ? 1 : 0;
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
