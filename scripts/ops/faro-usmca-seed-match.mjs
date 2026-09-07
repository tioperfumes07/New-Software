#!/usr/bin/env node
/**
 * scripts/ops/faro-usmca-seed-match.mjs — FACT-01 step 3 (ROUND 11, owner: "SEED AND CONFIRM
 * WITH FARO'S FILES, KEEP FARO SO WE RECONCILE TOMORROW").
 *
 * Reads docs/bus/settlement-entry-2026-09-04/IH35-AUGUST-RECONCILIATION-BOTH-ENTITIES.xlsx's
 * "5 FARO · USMCA" sheet (Faro Inv # / Customer / Face USD / Escrow Rsv / Discount / Wire Fee /
 * Net Advance / Faro ID / Load #) and matches each line to the real accounting.invoices row for
 * that load (via mdata.loads.load_number), live on Neon (read-only, BEGIN + lucia bypass +
 * ROLLBACK — never a write). Prints the full match table: Faro line, load, matched invoice
 * (id/display_id/status/factoring_status), amount agreement (Face vs invoice total), and flags
 * any line the sheet itself marks "— NOT LINKED —" or that has no TMS invoice yet.
 *
 * DRY-RUN ONLY. This script issues ZERO writes. Keeps every Faro line — nothing is ever dropped
 * from the sheet, matched or not (the owner: "KEEP FARO so we reconcile tomorrow"). --apply (a
 * real batch-submit through the factoring UI/route for every matched, not-yet-factored invoice)
 * is a SEPARATE step, requires the lead's ✔ quoted verbatim, and is not built here — the actual
 * write for any one purchase goes through the same real /accounting/factoring "Submit Factoring
 * Batch" flow this round's first purchase (FAC-2026-00001, invoice 13510) used, never a raw SQL
 * INSERT into factoring.batch.
 *
 * Usage: DATABASE_URL=<Neon prod> node scripts/ops/faro-usmca-seed-match.mjs
 */
import ExcelJS from "exceljs";
import pg from "pg";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { buildPgClientConfig } = require("../lib/pg-connection-options.cjs");

const XLSX_PATH = "docs/bus/settlement-entry-2026-09-04/IH35-AUGUST-RECONCILIATION-BOTH-ENTITIES.xlsx";
const SHEET_NAME = "5 FARO · USMCA";
const NOT_LINKED = "— NOT LINKED —";

async function readFaroLines() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(XLSX_PATH);
  const ws = wb.getWorksheet(SHEET_NAME);
  if (!ws) throw new Error(`sheet not found: ${SHEET_NAME}`);
  const lines = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const faroInv = row.getCell(1).value;
    if (faroInv == null || String(faroInv).trim() === "" || String(faroInv).trim().toUpperCase() === "TOTAL") continue;
    lines.push({
      faroInv: String(faroInv).trim(),
      customer: String(row.getCell(2).value ?? "").trim(),
      faceUsd: Number(row.getCell(6).value ?? 0),
      escrowRsv: Number(row.getCell(7).value ?? 0),
      discount: Number(row.getCell(8).value ?? 0),
      wireFee: Number(row.getCell(9).value ?? 0),
      netAdvance: Number(row.getCell(10).value ?? 0),
      faroId: String(row.getCell(11).value ?? "").trim(),
      loadNumber: String(row.getCell(12).value ?? "").trim(),
    });
  }
  return lines;
}

async function main() {
  const connectionString = process.env.DATABASE_DIRECT_URL || process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("faro-usmca-seed-match: DATABASE_URL/DATABASE_DIRECT_URL required.");
    return 1;
  }

  const lines = await readFaroLines();
  console.log(`faro-usmca-seed-match: ${lines.length} Faro USMCA line(s) read from ${XLSX_PATH}`);

  const client = new pg.Client(buildPgClientConfig(connectionString));
  await client.connect();
  await client.query("BEGIN");
  await client.query("SELECT set_config('app.bypass_rls','lucia',true)");
  const res = await client.query(`
    SELECT i.id::text AS invoice_id, i.display_id, i.status, i.factoring_status,
           i.amount_open_cents, l.load_number
    FROM accounting.invoices i
    JOIN mdata.loads l ON l.id = i.source_load_id
    JOIN org.companies c ON c.id = i.operating_company_id
    WHERE c.code = 'USMCA' AND i.status <> 'void'
  `);
  await client.query("ROLLBACK");
  await client.end();

  const byLoad = new Map(res.rows.map((r) => [r.load_number, r]));

  let matched = 0;
  let notLinkedInSheet = 0;
  let noInvoiceYet = 0;
  let amountMismatch = 0;
  let readyToFactor = 0;
  let alreadyFactored = 0;
  let notYetSent = 0;

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
    matched += 1;
    const invOpenUsd = Number(inv.amount_open_cents) / 100;
    const amountsAgree = Math.abs(invOpenUsd - line.faceUsd) < 0.01;
    if (!amountsAgree) amountMismatch += 1;
    if (inv.factoring_status === "advanced" || inv.factoring_status === "submitted") alreadyFactored += 1;
    else if (inv.status === "sent") readyToFactor += 1;
    else notYetSent += 1;
    console.log(
      `${line.faroInv} | ${line.customer} | ${line.loadNumber} | ${inv.display_id} | ${inv.status} | ${inv.factoring_status} | ${line.faceUsd.toFixed(2)} | ${invOpenUsd.toFixed(2)} | ${amountsAgree ? "AGREE" : "MISMATCH"}`
    );
  }

  console.log("");
  console.log(
    `TOTALS: ${lines.length} Faro lines · ${matched} matched to a real TMS invoice · ${notLinkedInSheet} sheet-marked not-linked (kept) · ${noInvoiceYet} no TMS invoice yet · ${amountMismatch} amount mismatch(es) · ${readyToFactor} ready to factor now (sent, not_factored) · ${notYetSent} matched but invoice not yet sent (proforma) · ${alreadyFactored} already submitted/advanced`
  );
  console.log("DRY-RUN — zero writes. Every Faro line kept for tomorrow's reconciliation, matched or not.");
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
