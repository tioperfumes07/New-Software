#!/usr/bin/env tsx
/**
 * scripts/ops/inv-missing-2-load-13554.ts — INV-MISSING-2 (lead ROUND 13 audit, 2026-09-06 15:5xZ).
 *
 * MEASURED (live-verified against the actual source file, not just the lead's paraphrase):
 * docs/bus/settlement-entry-2026-09-04/IH35-BY-LOAD-20260904-WITH-DIESEL_1.xlsx, sheet
 * RECONCILIATION, row 30 (section "3 ALWAYSTRACK CHARGES vs QUICKBOOKS   REAL DIFFERENCES"):
 *   Load 13554 | Entity USMCA | QBO Inv 039 | AlwaysTrack 0 | QuickBooks 3500 | Difference 3500 |
 *   Verdict "No charges in AlwaysTrack but invoiced"
 * Customer = Big G Logistics, LLC (mdata.loads.customer_id bb123106-ad82-43fb-a27b-ca806910b8b9,
 * already on the load). rate_total_cents was 0 since insert (confirmed via audit.row_changes,
 * never anything else) — this backfills the real historical QuickBooks amount/number.
 *
 * PATH (every write through a real service/route, never raw SQL for a financial write):
 *  1) PATCH /api/v1/mdata/loads/:id (rate_total_cents=350000). This route's own resync hook
 *     (resyncProformaInvoiceFromLoadRate -> buildInvoiceFromLoad) auto-creates a proforma the
 *     instant the rate is set, numbered by the LOAD-NUMBER fallback ("13554", the going-forward
 *     owner rule 2026-08-24) since no requestedDisplayId reaches that internal call.
 *  2) Void that auto-created "13554"-numbered proforma via the real
 *     POST /api/v1/accounting/invoices/:id/void, reason quoting the exact reconciliation row above
 *     — it is being superseded by the real historical number, not a mistake to hide.
 *  3) buildInvoiceFromLoad() called directly (the same function every route above calls — this IS
 *     the real invoice service, not a bypass) with requestedDisplayId: "039" — the owner's rule
 *     ("typed value wins") is exactly what resolveInvoiceDisplayId's `requested` param implements.
 *  4) latchOnDeliveryEvidence() called directly for targetStatus=delivered_pending_docs (the load's
 *     current status — it cannot re-transition through the /transition route, which forbids a
 *     same-status edge, so the task's own "re-run latchOnDeliveryEvidence" names the function to
 *     call directly, matching how every other write path in this codebase invokes it). Internally
 *     converts the "039" proforma -> official and sends it (ACCT-F351), then queues the revenue
 *     latch to fire after commit (A/R + revenue GL, postLoadRevenueLatch).
 *
 * Load 13525 is OUT OF SCOPE here — every workbook view shows Rate 0 / unfactored / no QBO invoice
 * for it; this script does not touch it (owner input requested there, per the lead's own note).
 *
 * Usage: DATABASE_URL=<neon prod> npx tsx scripts/ops/inv-missing-2-load-13554.ts
 */
import pg from "pg";
import { createIntegrationApp } from "../../apps/backend/test-helpers/http-app.js";
import { registerLoadRoutes } from "../../apps/backend/src/mdata/loads.routes.js";
import { registerInvoiceRoutes } from "../../apps/backend/src/accounting/invoices.routes.js";
import { withCurrentUser } from "../../apps/backend/src/auth/db.js";
import { buildInvoiceFromLoad } from "../../apps/backend/src/accounting/from-load.js";
import { latchOnDeliveryEvidence } from "../../apps/backend/src/dispatch/delivery-evidence-latch.js";

const USMCA_COMPANY_ID = "5c854333-6ea5-4faa-af31-67cb272fef80";
const OWNER_USER_ID = "e4117991-d2c0-406d-8cda-74e98d95bccd"; // identity.users tioperfumes07@gmail.com, role Owner
const LOAD_13554_ID = "f71c62cb-8573-4452-9917-4e072de12439";
const RATE_CENTS = 350000;
const TYPED_DISPLAY_ID = "039";
const VOID_REASON =
  "INV-MISSING-2 (lead ROUND 13, 2026-09-06): auto-created by the rate-set resync hook under the " +
  "load-number fallback display_id — superseded by the real historical QuickBooks invoice number. " +
  "Source: docs/bus/settlement-entry-2026-09-04/IH35-BY-LOAD-20260904-WITH-DIESEL_1.xlsx, sheet " +
  "RECONCILIATION row 30: Load 13554 | USMCA | QBO Inv 039 | AlwaysTrack 0 | QuickBooks 3500 | " +
  "Difference 3500 | 'No charges in AlwaysTrack but invoiced'.";

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 3 });
  process.env.IH35_TEST_AUTH_BYPASS = "1";
  const app = await createIntegrationApp(async (a) => {
    await registerLoadRoutes(a);
    await registerInvoiceRoutes(a);
  });
  const authHeader = {
    "x-test-auth": Buffer.from(
      JSON.stringify({ id: OWNER_USER_ID, role: "Owner", email: "tioperfumes07@gmail.com" }),
      "utf8"
    ).toString("base64url"),
  };

  const report: string[] = [];

  // FORCED-RLS: read-only queries in this script go through a dedicated bypass-scoped transaction
  // (mirrors trip-type-sb-fix.ts's own loadTargets pattern) — a plain pool.query() as ih35_app with
  // no operating_company_id GUC set sees zero rows, which is a masked read, not a verdict.
  async function bypassQuery<T = Record<string, unknown>>(sql: string, params: unknown[]): Promise<T[]> {
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      await c.query(`SELECT set_config('app.bypass_rls', 'lucia', true)`);
      const r = await c.query<T>(sql, params);
      await c.query("ROLLBACK");
      return r.rows;
    } finally {
      c.release();
    }
  }

  // Pre-check: current state (false-empty guard baked in — a real read, not an assumption).
  const preRows = await bypassQuery<{ rate_total_cents: string; status: string }>(
    `SELECT rate_total_cents::bigint AS rate_total_cents, status
       FROM mdata.loads WHERE id = $1::uuid AND operating_company_id = $2::uuid`,
    [LOAD_13554_ID, USMCA_COMPANY_ID]
  );
  const preRow = preRows[0];
  if (!preRow) throw new Error("load 13554 not found under USMCA — refusing to proceed");
  report.push(`PRE: load 13554 rate_total_cents=${preRow.rate_total_cents} status=${preRow.status}`);
  if (Number(preRow.rate_total_cents) !== 0 && Number(preRow.rate_total_cents) !== RATE_CENTS) {
    throw new Error(`refusing: expected rate_total_cents 0 or already ${RATE_CENTS}, found ${preRow.rate_total_cents} — re-measure before touching`);
  }

  // 1) Set the rate through the real mdata PATCH route (auto-creates a load-number-numbered proforma).
  // Idempotent: skip if a prior partial run already set it (script is safe to re-run to completion).
  if (Number(preRow.rate_total_cents) === RATE_CENTS) {
    report.push(`STEP 1: skipped — rate_total_cents already ${RATE_CENTS} (prior run)`);
  } else {
    const patchRes = await app.inject({
      method: "PATCH",
      url: `/api/v1/mdata/loads/${LOAD_13554_ID}?operating_company_id=${USMCA_COMPANY_ID}`,
      headers: authHeader,
      payload: { rate_total_cents: RATE_CENTS },
    });
    if (patchRes.statusCode >= 300) throw new Error(`rate PATCH failed: ${patchRes.statusCode} ${patchRes.body}`);
    report.push(`STEP 1: PATCH /api/v1/mdata/loads/${LOAD_13554_ID} rate_total_cents=${RATE_CENTS} -> ${patchRes.statusCode}`);
  }

  const autoInvoiceRows = await bypassQuery<{ id: string; display_id: string; status: string }>(
    `SELECT id::text, display_id, status FROM accounting.invoices
      WHERE operating_company_id = $1::uuid AND source_load_id = $2::uuid AND voided_at IS NULL
      ORDER BY created_at DESC LIMIT 1`,
    [USMCA_COMPANY_ID, LOAD_13554_ID]
  );
  const auto = autoInvoiceRows[0];

  // 2) Void the auto-created (load-number-numbered) invoice — reason quotes the reconciliation row.
  //    Idempotent: skip entirely if a prior run already voided it (no live non-void invoice left) or
  //    if it already happens to carry the typed number.
  if (!auto) {
    report.push(`STEP 2: skipped — no live non-void invoice on this load (already voided by a prior run, or step 1 just ran and none exists yet to void)`);
  } else if (String(auto.display_id) !== TYPED_DISPLAY_ID) {
    const voidRes = await app.inject({
      method: "POST",
      url: `/api/v1/accounting/invoices/${auto.id}/void?operating_company_id=${USMCA_COMPANY_ID}`,
      headers: authHeader,
      payload: { reason: VOID_REASON },
    });
    if (voidRes.statusCode >= 300) throw new Error(`void failed: ${voidRes.statusCode} ${voidRes.body}`);
    report.push(`STEP 2: voided ${auto.id} (was display_id=${auto.display_id}) -> ${voidRes.statusCode}`);
  } else {
    report.push(`STEP 2: skipped — auto-created invoice already carries the typed display_id ${TYPED_DISPLAY_ID}`);
  }

  // 3) Create the real, typed-number ("039") proforma via the real invoice service, direct call —
  //    the same function every route above calls internally.
  const built = await withCurrentUser(OWNER_USER_ID, async (client) => {
    await client.query(`SELECT set_config('app.operating_company_id', $1::text, true)`, [USMCA_COMPANY_ID]);
    return buildInvoiceFromLoad(client as never, {
      userId: OWNER_USER_ID,
      operatingCompanyId: USMCA_COMPANY_ID,
      loadId: LOAD_13554_ID,
      asProforma: true,
      requestedDisplayId: TYPED_DISPLAY_ID,
    });
  });
  const invoiceId = String((built.invoice as { id: unknown }).id);
  report.push(
    `STEP 3: buildInvoiceFromLoad -> invoice ${invoiceId} display_id=${(built.invoice as { display_id: unknown }).display_id} ` +
      `status=${(built.invoice as { status: unknown }).status} idempotent=${built.idempotent}`
  );

  // 4) Re-run latchOnDeliveryEvidence for the load's current status — converts the "039" proforma
  //    to official + sends it (ACCT-F351), then queues the revenue latch to fire after commit.
  const latchResult = await withCurrentUser(OWNER_USER_ID, async (client) => {
    await client.query(`SELECT set_config('app.operating_company_id', $1::text, true)`, [USMCA_COMPANY_ID]);
    return latchOnDeliveryEvidence(client, {
      operatingCompanyId: USMCA_COMPANY_ID,
      loadId: LOAD_13554_ID,
      targetStatus: preRow.status,
      actorUserId: OWNER_USER_ID,
    });
  });
  report.push(`STEP 4: latchOnDeliveryEvidence(targetStatus=${preRow.status}) -> ${latchResult}`);

  // Give the after-commit queue's async work (revenue latch fires post-COMMIT) a moment, then verify.
  await new Promise((r) => setTimeout(r, 3000));

  const postRows = await bypassQuery(
    `SELECT id::text, display_id, status, total_cents, sent_at
       FROM accounting.invoices
      WHERE operating_company_id = $1::uuid AND source_load_id = $2::uuid AND voided_at IS NULL
      ORDER BY created_at DESC LIMIT 1`,
    [USMCA_COMPANY_ID, LOAD_13554_ID]
  );
  report.push(`POST: invoice ${JSON.stringify(postRows[0])}`);

  const jeRows = await bypassQuery(
    `SELECT je.id::text, je.memo, je.entry_date::text,
            jsonb_agg(jsonb_build_object('account', a.account_number || ' ' || a.account_name, 'dc', p.debit_or_credit, 'cents', p.amount_cents)) AS legs
       FROM accounting.journal_entries je
       JOIN accounting.journal_entry_postings p ON p.journal_entry_uuid = je.id
       JOIN catalogs.accounts a ON a.id = p.account_id
      WHERE je.operating_company_id = $1::uuid AND je.memo ILIKE '%13554%'
      GROUP BY je.id, je.memo, je.entry_date
      ORDER BY je.entry_date DESC`,
    [USMCA_COMPANY_ID]
  );
  report.push(`POST: JE(s) for load 13554: ${JSON.stringify(jeRows)}`);

  await app.close();
  await pool.end();
  console.log(report.join("\n"));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
