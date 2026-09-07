/**
 * FACT-MIRROR-BACKFILL (owner 2026-09-06) — one-time repair of the denormalized
 * mdata.customers.factoring_company_vendor_id mirror.
 *
 * ROOT CAUSE: factoring.customer_factor_assignment is the system of record (1,221 USMCA customers
 * assigned to Faro), but the denormalized mirror mdata.customers.factoring_company_vendor_id — the
 * column the "submit to Faro" queue (submission-queue.service.ts) and every AP/rollup consumer read —
 * was populated on exactly 1 of 1,235 customers. Result (measured live, RLS-bypassed): 28 sent,
 * Faro-assigned USMCA invoices ($79,680) never entered the submit queue and never got a factoring
 * advance. factor.service.ts assignCustomerToFactor now writes the mirror going forward; this repairs
 * the pre-existing rows.
 *
 * DETERMINISTIC, NOT A GUESS: the vendor is resolved from the effective canonical agreement
 * (factoring.canonical_factor_agreements.factor_vendor_id where factor_profile_id = the assignment's
 * factor_id, not voided, effective as-of today). Verified live: assignment.factor_id
 * 40b3690b-... = agreement.factor_profile_id 40b3690b-... -> factor_vendor_id a1f4c2b6-... (Faro
 * Factoring), effective 2026-08-07, full recourse. IDEMPOTENT: only rows whose mirror differs are
 * touched. No delete, no invented value.
 *
 * Usage:
 *   DATABASE_URL=<pooled, neondb_owner> npx tsx scripts/run-backfill-factoring-vendor-mirror-once.mts           # dry run
 *   DATABASE_URL=<pooled, neondb_owner> npx tsx scripts/run-backfill-factoring-vendor-mirror-once.mts --commit  # apply
 */
import pg from "pg";

const USMCA = "5c854333-6ea5-4faa-af31-67cb272fef80";
const COMMIT = process.argv.includes("--commit");
const dbUrl = process.env.DATABASE_URL || process.env.DATABASE_DIRECT_URL || "";
if (!dbUrl) throw new Error("DATABASE_URL or DATABASE_DIRECT_URL required");

const SELECT_CANDIDATES = `
  SELECT count(*)::int AS n
  FROM mdata.customers c
  JOIN factoring.customer_factor_assignment a
    ON a.customer_id = c.id
   AND a.operating_company_id = c.operating_company_id
   AND a.voided_at IS NULL
   AND a.effective_from <= now()::date
   AND (a.effective_to IS NULL OR a.effective_to > now()::date)
  JOIN factoring.canonical_factor_agreements cfa
    ON cfa.factor_profile_id = a.factor_id
   AND cfa.tenant_id = a.operating_company_id
   AND cfa.factor_vendor_id IS NOT NULL
   AND cfa.voided_at IS NULL
   AND cfa.effective_from <= now()::date
   AND (cfa.effective_to IS NULL OR cfa.effective_to > now()::date)
  WHERE c.operating_company_id = $1::uuid
    AND c.factoring_company_vendor_id IS DISTINCT FROM cfa.factor_vendor_id
`;

const UPDATE_MIRROR = `
  UPDATE mdata.customers c
  SET factoring_company_vendor_id = cfa.factor_vendor_id,
      updated_at = now()
  FROM factoring.customer_factor_assignment a
  JOIN factoring.canonical_factor_agreements cfa
    ON cfa.factor_profile_id = a.factor_id
   AND cfa.tenant_id = a.operating_company_id
   AND cfa.factor_vendor_id IS NOT NULL
   AND cfa.voided_at IS NULL
   AND cfa.effective_from <= now()::date
   AND (cfa.effective_to IS NULL OR cfa.effective_to > now()::date)
  WHERE a.customer_id = c.id
    AND a.operating_company_id = c.operating_company_id
    AND a.voided_at IS NULL
    AND a.effective_from <= now()::date
    AND (a.effective_to IS NULL OR a.effective_to > now()::date)
    AND c.operating_company_id = $1::uuid
    AND c.factoring_company_vendor_id IS DISTINCT FROM cfa.factor_vendor_id
`;

async function main() {
  const pool = new pg.Pool({ connectionString: dbUrl, max: 3 });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.bypass_rls', 'lucia', true)");
    await client.query("SELECT set_config('app.operating_company_id', $1, true)", [USMCA]);

    const before = await client.query<{ n: number }>(SELECT_CANDIDATES, [USMCA]);
    const candidates = before.rows[0]?.n ?? 0;
    console.log(`Customers needing mirror backfill (effective assignment, mirror differs): ${candidates}`);

    if (!COMMIT) {
      await client.query("ROLLBACK");
      console.log("DRY RUN — pass --commit to apply. No writes made.");
      return;
    }

    const res = await client.query(UPDATE_MIRROR, [USMCA]);
    await client.query("COMMIT");
    console.log(`COMMITTED: ${res.rowCount} customer mirror rows updated.`);

    await client.query("SELECT set_config('app.bypass_rls', 'lucia', true)");
    const after = await client.query<{ n: number }>(SELECT_CANDIDATES, [USMCA]);
    console.log(`Remaining out-of-sync after backfill (target 0): ${after.rows[0]?.n ?? "?"}`);
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
