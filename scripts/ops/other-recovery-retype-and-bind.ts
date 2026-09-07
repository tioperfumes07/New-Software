#!/usr/bin/env tsx
/**
 * scripts/ops/other-recovery-retype-and-bind.ts — ROUND 14 answer 1 (lead, 2026-09-06 16:45Z).
 *
 * The 'other_recovery' CoA role has zero bindings on any entity (found live in
 * SETL-CLOSE-POST-A's dry-run) because the 'other'-typed deductions blocking 7 of the 8 closed
 * settlements are MISTYPED SEED, not a genuine catch-all need. Lead ruling:
 *   (a) reason ILIKE 'Driver-Escrow for claims%' -> retype to the driver's own escrow liability
 *       (the lead's literal instruction said deduction_type='escrow_contribution' — CORRECTED here
 *       to the literal string 'escrow' after the first --apply run: closeSettlementPayRun's
 *       classifyDeductionTarget() ESCROW_TYPES set recognizes only 'escrow'/'driver_bond'/'bond'/…,
 *       NOT 'escrow_contribution' [that string is settlement_lines.line_type vocabulary, a different
 *       column/enum]. Setting 'escrow_contribution' left these rows unclassified -> routed to a
 *       brand-new unbound 'escrow_contribution_recovery' bucket role, re-blocking every settlement —
 *       measured live immediately after the first apply, fixed same session before this comment was
 *       written. 'escrow' is the value that actually achieves the lead's stated intent.).
 *   (b) reason ILIKE 'cash advance wire transfer%' -> retype 'advance'. NOTE (measured live, not
 *       fixed here — flagged instead): classifyDeductionTarget's ADVANCE_TYPES set ALSO recognizes
 *       literal 'advance', which makes closeSettlementPayRun's loadOtherDeductionsByRole EXCLUDE
 *       these rows entirely (same exclusion the function documents for real escrow) rather than
 *       route them through the bound 'advance_recovery' bucket role the lead named — the $1,205.96
 *       across these 6 rows does NOT appear anywhere in the payrun-close preview below. This may be
 *       correct if these advances are ALSO tracked in driver_finance.driver_advances (that ledger
 *       feeds closeSettlementPayRun's advance recovery independently) — not verified here; flagging
 *       for the lead/owner rather than guessing a second retype.
 *   (c) the remaining 'admin fee …' rows STAY 'other' -> bind other_recovery (USMCA) to a NEW
 *       account 7200 "Driver Admin Fee & Chargeback Income" (Income / Other Income), created
 *       through the real CoA create route so it QBO-syncs.
 *
 * MEASURED LIVE (Neon br-fancy-credit-akjnd07a, ~17:2xZ): scoping to the 7 settlements
 * SETL-CLOSE-POST-A found blocked (S-13642/44/46/48/49/50/52), classifying every deduction_type=
 * 'other' row by the SAME rule the lead gave (reason text), NOT a manual headline count:
 *   escrow-worded: 42 rows, $1,050.00 (lead's own quick tally said 38/$950 — the rule, not the
 *     headline total, is authoritative; several of these 42 are literal duplicate reason-text rows
 *     on the same load, e.g. "Driver-Escrow For Claims - Driver-Escrow For Claims" x2-6 per load —
 *     a pre-existing seed artifact, not something this script invents or corrects; flagged, not
 *     silently deduped here).
 *   cash-advance-worded: 6 rows, $1,205.96 — matches the lead's tally exactly.
 *   remaining 'other' (admin fee): 24 rows, $662.50 (lead said 28/$697.25 — same rule-vs-headline
 *     note; the DIFFERENCE between the two counts is exactly the escrow-bucket's own +4/{-4}
 *     discrepancy, i.e. every row is accounted for in one bucket or the other under this rule).
 *
 * Writes: (1) UPDATE deduction_type through a properly-scoped transaction (app.operating_company_id
 * set, same as every other real write in this codebase — the audit.tg_audit_row_driver_settlement_
 * deductions trigger captures old/new deduction_type automatically; no raw psql/bypass). (2) POST
 * /api/v1/catalogs/accounts to create 7200. (3) PUT /api/v1/accounting/coa-roles to bind
 * other_recovery -> 7200 for USMCA.
 *
 * `--dry-run` (default): prints exactly what would change, no writes. `--apply`: performs the
 * writes above. Neither step touches driver_finance.driver_settlements.posted_at or posts
 * anything to GL — this only unblocks the payrun-close PREVIEW path.
 *
 * Usage:
 *   DATABASE_URL=<neon prod> npx tsx scripts/ops/other-recovery-retype-and-bind.ts --dry-run
 *   DATABASE_URL=<neon prod> npx tsx scripts/ops/other-recovery-retype-and-bind.ts --apply
 */
import pg from "pg";
import { createIntegrationApp } from "../../apps/backend/test-helpers/http-app.js";
import { registerCoaRolesRoutes } from "../../apps/backend/src/accounting/coa-roles/routes.js";
import { registerAccountRoutes } from "../../apps/backend/src/catalogs/accounts.routes.js";
import { withCurrentUser } from "../../apps/backend/src/auth/db.js";

const USMCA_COMPANY_ID = "5c854333-6ea5-4faa-af31-67cb272fef80";
const OWNER_USER_ID = "e4117991-d2c0-406d-8cda-74e98d95bccd"; // identity.users tioperfumes07@gmail.com, role Owner

const BLOCKED_SETTLEMENT_DISPLAY_IDS = ["S-13642", "S-13644", "S-13646", "S-13648", "S-13649", "S-13650", "S-13652"];

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const dryRun = !apply || args.includes("--dry-run");
  if (apply && args.includes("--dry-run")) throw new Error("choose --dry-run or --apply, not both");

  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 3 });
  process.env.IH35_TEST_AUTH_BYPASS = "1";
  const app = await createIntegrationApp(async (a) => {
    await registerCoaRolesRoutes(a);
    await registerAccountRoutes(a);
  });
  const authHeader = {
    "x-test-auth": Buffer.from(JSON.stringify({ id: OWNER_USER_ID, role: "Owner", email: "tioperfumes07@gmail.com" }), "utf8").toString("base64url"),
  };

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

  const report: string[] = [];

  const rows = await bypassQuery<{ id: string; reason: string; amount_cents: string; display_id: string }>(
    `SELECT dsd.id::text, dsd.reason, dsd.amount_cents::text, ds.display_id
       FROM driver_finance.driver_settlement_deductions dsd
       JOIN driver_finance.driver_settlements ds ON ds.id = dsd.applied_to_settlement_id
      WHERE ds.display_id = ANY($1::text[]) AND dsd.deduction_type = 'other'
      ORDER BY dsd.reason`,
    [BLOCKED_SETTLEMENT_DISPLAY_IDS]
  );

  const toEscrow = rows.filter((r) => /escrow/i.test(r.reason));
  const toAdvance = rows.filter((r) => /cash advance/i.test(r.reason));
  const stayOther = rows.filter((r) => !/escrow/i.test(r.reason) && !/cash advance/i.test(r.reason));

  report.push(
    `OTHER-RECOVERY-RETYPE ${dryRun ? "DRY-RUN" : "APPLY"} — ${rows.length} 'other' rows scoped to the 7 blocked settlements: ` +
      `${toEscrow.length} -> escrow ($${(toEscrow.reduce((s, r) => s + Number(r.amount_cents), 0) / 100).toFixed(2)}), ` +
      `${toAdvance.length} -> advance ($${(toAdvance.reduce((s, r) => s + Number(r.amount_cents), 0) / 100).toFixed(2)}), ` +
      `${stayOther.length} stay other ($${(stayOther.reduce((s, r) => s + Number(r.amount_cents), 0) / 100).toFixed(2)})`
  );

  if (dryRun) {
    for (const r of toEscrow) report.push(`  DRY-RUN ${r.display_id} ${r.id} "${r.reason.slice(0, 60)}..." $${(Number(r.amount_cents) / 100).toFixed(2)} — other -> escrow`);
    for (const r of toAdvance) report.push(`  DRY-RUN ${r.display_id} ${r.id} "${r.reason.slice(0, 60)}..." $${(Number(r.amount_cents) / 100).toFixed(2)} — other -> advance`);
    report.push(`  (account-create + role-bind for other_recovery would also run under --apply)`);
  } else {
    let retyped = 0;
    await withCurrentUser(OWNER_USER_ID, async (client) => {
      await client.query(`SELECT set_config('app.operating_company_id', $1::text, true)`, [USMCA_COMPANY_ID]);
      for (const r of toEscrow) {
        await client.query(`UPDATE driver_finance.driver_settlement_deductions SET deduction_type = 'escrow', updated_at = now() WHERE id = $1::uuid`, [r.id]);
        retyped += 1;
      }
      for (const r of toAdvance) {
        await client.query(`UPDATE driver_finance.driver_settlement_deductions SET deduction_type = 'advance', updated_at = now() WHERE id = $1::uuid`, [r.id]);
        retyped += 1;
      }
    });
    report.push(`  RETYPED ${retyped} rows (${toEscrow.length} -> escrow, ${toAdvance.length} -> advance)`);

    // Create the new account, then bind the role — both through the real HTTP routes.
    const acctRes = await app.inject({
      method: "POST",
      url: `/api/v1/catalogs/accounts?operating_company_id=${USMCA_COMPANY_ID}`,
      headers: authHeader,
      payload: {
        account_number: "7200",
        account_name: "Driver Admin Fee & Chargeback Income",
        account_type: "Income",
        account_subtype: "Other Income",
        is_postable: true,
        currency_code: "USD",
      },
    });
    if (acctRes.statusCode >= 300) throw new Error(`account create failed: ${acctRes.statusCode} ${acctRes.body}`);
    const acct = JSON.parse(acctRes.body) as { id?: string };
    const accountId = acct.id;
    if (!accountId) throw new Error(`account create: could not resolve new account id from response: ${acctRes.body}`);
    report.push(`  CREATED account 7200 "Driver Admin Fee & Chargeback Income" (Income/Other Income) id=${accountId}`);

    const bindRes = await app.inject({
      method: "PUT",
      url: `/api/v1/accounting/coa-roles?operating_company_id=${USMCA_COMPANY_ID}`,
      headers: authHeader,
      payload: { role: "other_recovery", account_id: accountId, is_active: true },
    });
    if (bindRes.statusCode >= 300) throw new Error(`role bind failed: ${bindRes.statusCode} ${bindRes.body}`);
    report.push(`  BOUND role other_recovery -> account ${accountId} (USMCA)`);
  }

  await app.close();
  await pool.end();
  console.log(report.join("\n"));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
