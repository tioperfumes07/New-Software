#!/usr/bin/env tsx
/**
 * scripts/ops/backfill-invoice-dates-from-delivery.ts — CASH-FLOW-01 root cause #2 (owner order
 * 2026-09-06, ROUND 14): "due = invoice_date (delivery/conversion date) + customer terms." 39
 * USMCA sent invoices carry issue_date = their MINT day (not their real delivery), pushing every
 * due_date to a wrong, uniform 2026-10-05/06. Re-stamps them through the real, audited service
 * recomputeInvoiceDatesFromDelivery (apps/backend/src/accounting/invoice-date-recompute.service.ts)
 * -- never a raw UPDATE. Skips (no-op) any invoice whose recomputed dates already match, or that
 * has no delivery-stop data to recompute from (never invents a date).
 *
 * --dry-run independently re-derives the SAME real-delivery-stop values read-only (its own SELECT,
 * ROLLBACK, zero writes) purely to print the display_id/old-due/new-due preview table the owner
 * asked for; --apply calls the real service, which recomputes and writes.
 *
 * Usage:
 *   DATABASE_URL=<Neon prod> npx tsx scripts/ops/backfill-invoice-dates-from-delivery.ts --dry-run
 *   DATABASE_URL=<Neon prod> npx tsx scripts/ops/backfill-invoice-dates-from-delivery.ts --apply
 */
import { withCompanyScope } from "../../apps/backend/src/accounting/shared.js";
import { recomputeInvoiceDatesFromDelivery } from "../../apps/backend/src/accounting/invoice-date-recompute.service.js";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { buildPgClientConfig } = require("../lib/pg-connection-options.cjs");
const pg = require("pg");

const OWNER_USER_ID = "e4117991-d2c0-406d-8cda-74e98d95bccd"; // identity.users tioperfumes07@gmail.com, role Owner

type PreviewRow = {
  id: string;
  operating_company_id: string;
  display_id: string;
  old_issue_date: string;
  old_due_date: string;
  new_issue_date: string | null;
  new_due_date: string | null;
};

/** Read-only (BEGIN + lucia bypass + ROLLBACK) -- same real-delivery-stop derivation the service
 *  uses, computed here purely for the dry-run preview table. Zero writes. */
async function findCandidatesWithPreview(): Promise<PreviewRow[]> {
  const connectionString = process.env.DATABASE_DIRECT_URL || process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL/DATABASE_DIRECT_URL required");
  const client = new pg.Client(buildPgClientConfig(connectionString));
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.bypass_rls','lucia',true)");
    const res = await client.query(
      `
        SELECT
          i.id::text, i.operating_company_id::text, i.display_id,
          i.issue_date::text AS old_issue_date, i.due_date::text AS old_due_date,
          COALESCE(ds.at, NULL)::text AS delivery_stop_at,
          COALESCE(i.payment_terms_days, 30) AS payment_terms_days
        FROM accounting.invoices i
        JOIN org.companies c ON c.id = i.operating_company_id AND c.code = 'USMCA'
        LEFT JOIN LATERAL (
          SELECT COALESCE(ls.actual_arrival_at, ls.scheduled_arrival_at) AS at
          FROM mdata.load_stops ls
          WHERE ls.load_id = i.source_load_id AND ls.stop_type = 'delivery'
          ORDER BY ls.sequence_number DESC
          LIMIT 1
        ) ds ON true
        WHERE i.status = 'sent'
          AND i.voided_at IS NULL
          AND i.source_load_id IS NOT NULL
        ORDER BY i.display_id
      `
    );
    await client.query("ROLLBACK");
    return res.rows.map((r: Record<string, unknown>) => {
      const stopAt = r.delivery_stop_at ? String(r.delivery_stop_at).slice(0, 10) : null;
      const termsDays = Number(r.payment_terms_days ?? 30);
      const newDue = stopAt
        ? new Date(new Date(`${stopAt}T00:00:00.000Z`).getTime() + termsDays * 86400000).toISOString().slice(0, 10)
        : null;
      return {
        id: String(r.id),
        operating_company_id: String(r.operating_company_id),
        display_id: String(r.display_id),
        old_issue_date: String(r.old_issue_date).slice(0, 10),
        old_due_date: String(r.old_due_date).slice(0, 10),
        new_issue_date: stopAt,
        new_due_date: newDue,
      };
    });
  } finally {
    await client.end();
  }
}

async function main() {
  const apply = process.argv.includes("--apply");
  const candidates = await findCandidatesWithPreview();
  console.log(`backfill-invoice-dates-from-delivery: ${candidates.length} sent USMCA invoice(s) with a source load`);
  console.log("");
  console.log("display_id | old issue_date | new issue_date | old due_date | new due_date | preview");

  let wouldChange = 0;
  let wouldSkip = 0;
  for (const c of candidates) {
    const changes = c.new_issue_date && (c.new_issue_date !== c.old_issue_date || c.new_due_date !== c.old_due_date);
    if (changes) wouldChange += 1;
    else wouldSkip += 1;
    console.log(
      `${c.display_id} | ${c.old_issue_date} | ${c.new_issue_date ?? "—"} | ${c.old_due_date} | ${c.new_due_date ?? "—"} | ${
        !c.new_issue_date ? "SKIP (no delivery-stop data)" : changes ? "WOULD UPDATE" : "SKIP (already correct)"
      }`
    );
  }
  console.log("");
  console.log(`PREVIEW TOTALS: ${candidates.length} checked · ${wouldChange} would update · ${wouldSkip} would skip`);

  if (!apply) {
    console.log("DRY-RUN — zero writes. Re-run with --apply to write through the real service.");
    return;
  }

  console.log("");
  console.log("--apply: writing through recomputeInvoiceDatesFromDelivery...");
  let updated = 0;
  let skipped = 0;
  for (const c of candidates) {
    const result = await withCompanyScope(OWNER_USER_ID, c.operating_company_id, (client) =>
      recomputeInvoiceDatesFromDelivery(client, {
        operatingCompanyId: c.operating_company_id,
        invoiceId: c.id,
        actorUserId: OWNER_USER_ID,
      })
    );
    if (result.changed) {
      updated += 1;
      console.log(
        `UPDATED ${result.display_id} :: issue ${result.old_issue_date} -> ${result.new_issue_date} :: due ${result.old_due_date} -> ${result.new_due_date}`
      );
    } else {
      skipped += 1;
      console.log(`SKIP ${c.display_id} (${result.reason})`);
    }
  }
  console.log("");
  console.log(`APPLIED: ${candidates.length} checked · ${updated} updated · ${skipped} skipped`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
