#!/usr/bin/env tsx
/**
 * cursor-fire-revrec-bill-backfill-usmca.mts — ROUND 16 healthz unblock (owner 2026-09-06: "you fix
 * them, we do not defer").
 *
 * ROOT CAUSE (measured live, Neon prod, RLS-bypassed): the DISP-01 two-event delivery latch fired
 * Event 1 (earn: DR Unbilled Revenue / CR Line-Haul Income) for 48 USMCA loads = $139,880.00, but
 * Event 2 (bill: DR A/R / CR Unbilled Revenue) NEVER fired for them — so GL A/R (11f4641f) = $0 while
 * the open-invoice subledger = $139,880.00. That is BOTH failing healthz critical checks at once:
 *   - ledger.ar_tieout            variance_cents = -13,988,000
 *   - ledger.posted_without_posting  count = 48 (sent TMS invoices with no invoice-tagged A/R posting)
 * All 48 invoices are `sent` (issued to the customer), so per OWNER DECISION B (2026-08-27) Event 2 is
 * owed: the receivable must move from Unbilled Revenue (1150) to A/R (1100). Event 2 did not fire
 * because these invoices were issued through a path that did not call fireRevrecLatchOnInvoiceIssued
 * (or were sent before earn existed, so the send-time bill call no-op'd on earn_missing_for_bill and
 * was never retried).
 *
 * FIX — REUSE THE EXISTING POSTER, NO NEW GL MATH: call postLoadRevenueLatch (the same Event-2 poster
 * the invoice-send trigger uses) with target_status='completed_docs_received' for each load. Its own
 * gates (already_posted, earn_missing_for_bill, missing_issued_invoice, invoice_gl_already_recognized,
 * trk_excluded, flag_off) decide whether it posts — so this is idempotent and safe to re-run. Event 2
 * tags its A/R leg source_transaction_type='invoice' (poster.service.ts:610-635), which is exactly
 * what ledger.posted_without_posting looks for, so both checks clear together.
 *
 * SELF-SELECTING: queries the unposted set itself (never a hardcoded id list), so a re-run only acts on
 * whatever still needs it. USMCA only. Real rows only (is_sample_data=false).
 *
 * Usage: DATABASE_URL=<neon-pooled> npx tsx scripts/ops/cursor-fire-revrec-bill-backfill-usmca.mts --apply
 */
import pg from "pg";
import { postLoadRevenueLatch } from "../../apps/backend/src/accounting/revrec-delivery-posting/poster.service.js";
import { companyBusinessDate } from "../../apps/backend/src/lib/company-business-date.js";

const USMCA = "5c854333-6ea5-4faa-af31-67cb272fef80";
const OWNER = "e4117991-d2c0-406d-8cda-74e98d95bccd";
const APPLY = process.argv.includes("--apply");

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 3 });
  const client = await pool.connect();
  let loads: Array<{ source_load_id: string; display_id: string; open_cents: string }> = [];
  try {
    await client.query(`SELECT set_config('app.bypass_rls','lucia',false)`);
    const res = await client.query<{ source_load_id: string; display_id: string; open_cents: string }>(
      `
      SELECT DISTINCT i.source_load_id::text AS source_load_id, i.display_id, i.amount_open_cents::text AS open_cents
        FROM accounting.invoices i
       WHERE i.operating_company_id = $1::uuid
         AND i.source_system = 'tms'
         AND i.voided_at IS NULL
         AND i.status IN ('sent', 'partial', 'paid')
         AND COALESCE(i.is_sample_data, false) = false
         AND i.source_load_id IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM accounting.journal_entry_postings p
            WHERE p.source_transaction_type = 'invoice' AND p.source_transaction_id = i.id::text
         )
       ORDER BY i.display_id
      `,
      [USMCA]
    );
    loads = res.rows;
  } finally {
    client.release();
  }

  const totalOpen = loads.reduce((s, l) => s + Number(l.open_cents), 0);
  console.log(
    `Found ${loads.length} sent TMS USMCA invoice(s) missing the Event-2 (bill) A/R JE — open total $${(totalOpen / 100).toFixed(2)}`
  );

  if (!APPLY) {
    for (const l of loads) console.log(`  DRY-RUN ${l.display_id} — load ${l.source_load_id} — $${(Number(l.open_cents) / 100).toFixed(2)}`);
    console.log("DRY-RUN — pass --apply to fire Event 2 (DR A/R / CR Unbilled Revenue) through the real poster");
    await pool.end();
    return;
  }

  let posted = 0;
  let skipped = 0;
  const skipReasons: Record<string, number> = {};
  for (const l of loads) {
    const r = await postLoadRevenueLatch({
      operating_company_id: USMCA,
      load_id: l.source_load_id,
      target_status: "completed_docs_received",
      entry_date_iso: companyBusinessDate(),
      actor_user_id: OWNER,
    });
    if (r.posted) {
      posted++;
      console.log(`POSTED ${l.display_id} — Event 2 bill JE ${r.journal_entry_id} — $${(Number(l.open_cents) / 100).toFixed(2)}`);
    } else {
      skipped++;
      skipReasons[r.reason ?? "unknown"] = (skipReasons[r.reason ?? "unknown"] ?? 0) + 1;
      console.log(`SKIP ${l.display_id} — ${r.reason}`);
    }
  }
  console.log(`DONE — posted=${posted} skipped=${skipped} ${JSON.stringify(skipReasons)}`);
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
