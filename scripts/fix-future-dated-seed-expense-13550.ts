#!/usr/bin/env tsx
/**
 * EXP-DATE (owner ROUND 10 addendum 2, 2026-09-06 05:20Z) — measured live on Load costs → Expenses:
 * expense 13550-4 (LOVES, Fuel-DEF $42.38, memo embeds "inv 99460605 — 2026-09-27", settlement 5789)
 * carries transaction_date 2026-09-27 — a FUTURE date (load 13550 delivered 2026-08-28). Swept ALL
 * seeded USMCA expenses for transaction_date > now() OR > the load's delivery + 3 days: exactly ONE
 * match, this same row (no others).
 *
 * SOURCE-DOCUMENT EVIDENCE (never guessed): docs/bus/settlement-entry-2026-09-04/codex-extracted/
 * settlement-5789.json's own extraction note for load 13550: "the expense row for invoice 99460605
 * (DEF, $42.38) is printed with date 2026-09-27, while the matching fuel row for the SAME invoice is
 * printed with date 2026-08-27 -- this discrepancy is transcribed exactly as printed and was NOT
 * corrected." I.e. the SIGNED Company Settlement PDF itself has two different dates printed for the
 * SAME invoice number (99460605, same vendor LOVES, same location) — a genuine source-document typo,
 * faithfully transcribed by the seed rather than invented. The fuel_rows date (2026-08-27) is
 * corroborated: it falls inside the load's actual trip window (pickup 2026-08-26, delivery
 * 2026-08-28) while the expense_rows date (2026-09-27) falls a full month AFTER the settlement even
 * closed (end_date 2026-09-01) — not a plausible transaction date. Correcting the expense row's date
 * to match its own settlement's fuel_rows date for the SAME invoice is evidence-based, not a guess.
 *
 * FIX: the real PATCH /api/v1/expenses/:expenseId route refuses this edit outright — it hard-refuses
 * (`FAIL LOUD`) any expense whose status/posting_status is not draft/unposted, and this expense is
 * `status='posted', posting_status='posted'` (posted before ACC-50's open-tour-posts-nothing gate
 * shipped this round). There is no "edit a posted expense in place" endpoint (the route's own comment:
 * "the posted-and-open-period reverse+repost branch is a distinct, not-yet-built endpoint"). The real
 * path available is void (real POST .../void, reverses the JE through the existing posting engine) +
 * recreate (real POST /api/v1/expenses with the corrected date) + attempt repost (real POST
 * .../:id/post) — never a raw UPDATE of transaction_date on a posted row. If load 13550's tour is
 * still open when this runs, ACC-50's own gate correctly HOLDS the repost (posting_hold_reason=
 * 'tour_open') rather than posting it — that is the CORRECT current-law outcome (LAW §2: open tour
 * posts nothing), not a bug in this script; the original row's posted_at predates that gate.
 *
 * Usage:
 *   DATABASE_URL=<Neon prod> npx tsx scripts/fix-future-dated-seed-expense-13550.ts --dry-run
 *   DATABASE_URL=<Neon prod> npx tsx scripts/fix-future-dated-seed-expense-13550.ts --apply
 */
import pg from "pg";
import { createIntegrationApp } from "../apps/backend/test-helpers/http-app.js";
import { registerExpenseRoutes } from "../apps/backend/src/accounting/expenses.routes.js";

const USMCA_COMPANY_ID = "5c854333-6ea5-4faa-af31-67cb272fef80";
const OWNER_USER_ID = "e4117991-d2c0-406d-8cda-74e98d95bccd";
const OWNER_EMAIL = "tioperfumes07@gmail.com";

const OLD_EXPENSE_ID = "2d5f4c1b-9d3f-4f9f-b2a6-ae5d9be57549"; // 13550-4, transaction_date 2026-09-27 (wrong)
const LOAD_ID = "47c98671-d21d-4613-9faf-832030ab0798"; // load 13550
const CORRECT_DATE = "2026-08-27"; // matches settlement 5789's own fuel_rows entry for the SAME invoice 99460605
const VENDOR_ID = "5a529e97-5af6-4874-89c0-f300715101f2"; // LOVES
const FUEL_ACCOUNT_ID = "353fbd5b-d39c-4709-ac19-60cae52018f7"; // 5000 Fuel & Diesel
const PAYMENT_ACCOUNT_ID = "c7af1219-f6a6-4169-a2d8-8f556fb0c2f3"; // 1000 Bank of America - Operating (USMCA)
const AMOUNT_CENTS = 4238;
const CORRECTED_MEMO = "Fuel-DEF-Diesel Exhaust Fluid — 10465 LONESOME PINE TRAIL M, TN — inv 99460605 — 2026-08-27 — $42.38 (settlement 5789) [EXP-DATE correction: source PDF printed 2026-09-27 for this expense row but 2026-08-27 for the SAME invoice's fuel row; corrected to the internally-consistent date]";

async function main() {
  const apply = process.argv.includes("--apply");
  const pool = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await pool.connect();

  if (!apply) {
    await pool.query("BEGIN");
    await pool.query(`SELECT set_config('app.bypass_rls', 'lucia', true)`);
    const before = await pool.query(
      `SELECT expense_number, transaction_date::text, status, posting_status FROM accounting.expenses WHERE id = $1`,
      [OLD_EXPENSE_ID]
    );
    await pool.query("ROLLBACK");
    console.log("Current state:", JSON.stringify(before.rows[0]));
    console.log(`DRY-RUN | would void ${OLD_EXPENSE_ID} (13550-4, transaction_date 2026-09-27) and recreate with transaction_date ${CORRECT_DATE}. Re-run with --apply to execute.`);
    await pool.end();
    return;
  }

  // Idempotency: if OLD_EXPENSE_ID is already void, this correction already ran — report current
  // state and stop rather than voiding-an-already-void row (which the real /void route itself
  // refuses, 409 expense_already_void) or minting a second corrected duplicate.
  await pool.query("BEGIN");
  await pool.query(`SELECT set_config('app.bypass_rls', 'lucia', true)`);
  const already = await pool.query<{ status: string }>(`SELECT status FROM accounting.expenses WHERE id = $1`, [OLD_EXPENSE_ID]);
  await pool.query("ROLLBACK");
  if (already.rows[0]?.status === "void") {
    console.log(`${OLD_EXPENSE_ID} is already void — this correction already ran. Nothing to do.`);
    await pool.end();
    return;
  }

  process.env.IH35_TEST_AUTH_BYPASS = "1";
  const app = await createIntegrationApp(async (a) => {
    await registerExpenseRoutes(a);
  });
  const authHeader = { "x-test-auth": Buffer.from(JSON.stringify({ id: OWNER_USER_ID, role: "Owner", email: OWNER_EMAIL }), "utf8").toString("base64url") };

  const voidRes = await app.inject({
    method: "POST",
    url: `/api/v1/expenses/${OLD_EXPENSE_ID}/void`,
    headers: authHeader,
    payload: {
      operating_company_id: USMCA_COMPANY_ID,
      reason: "EXP-DATE: transaction_date 2026-09-27 is a future date and does not match this invoice's own fuel_rows entry (2026-08-27) on the same signed settlement 5789 — source-document date discrepancy, corrected via void+recreate (no PATCH path exists for a posted expense). Re-entered as 2026-08-27.",
    },
  });
  if (voidRes.statusCode >= 300) throw new Error(`void failed: ${voidRes.statusCode} ${voidRes.body}`);
  console.log(`voided ${OLD_EXPENSE_ID}: ${voidRes.body}`);

  const createRes = await app.inject({
    method: "POST",
    url: "/api/v1/expenses",
    headers: authHeader,
    payload: {
      operating_company_id: USMCA_COMPANY_ID,
      expense_date: CORRECT_DATE,
      amount_cents: AMOUNT_CENTS,
      vendor_uuid: VENDOR_ID,
      memo: CORRECTED_MEMO,
      payment_account_uuid: PAYMENT_ACCOUNT_ID,
      category_account_id: FUEL_ACCOUNT_ID,
      load_id: LOAD_ID,
      vendor_document_number: "99460605-L13550-4238-Fuel-DEF-Diesel-Ex",
    },
  });
  if (createRes.statusCode >= 300) throw new Error(`create failed: ${createRes.statusCode} ${createRes.body}`);
  const created = JSON.parse(createRes.body) as { expense_id?: string };
  const newExpenseId = created.expense_id;
  if (!newExpenseId) throw new Error(`could not read new expense id from create response: ${createRes.body}`);
  console.log(`created ${newExpenseId}: ${createRes.body}`);

  const postRes = await app.inject({
    method: "POST",
    url: `/api/v1/expenses/${newExpenseId}/post`,
    headers: authHeader,
    payload: { operating_company_id: USMCA_COMPANY_ID },
  });
  console.log(`post attempt for ${newExpenseId}: status=${postRes.statusCode} body=${postRes.body}`);
  if (postRes.statusCode < 300) {
    console.log("Posted successfully (load's tour was not open, or the hold does not apply).");
  } else {
    const parsed = JSON.parse(postRes.body) as { error?: string };
    if (parsed.error === "tour_open" || postRes.body.includes("tour_open")) {
      console.log("Held (posting_hold_reason='tour_open') — CORRECT per LAW §2 (open tour posts nothing); this load's tour has not closed.");
    } else {
      console.log(`Post did not succeed for a different reason — review: ${postRes.body}`);
    }
  }

  await pool.query("BEGIN");
  await pool.query(`SELECT set_config('app.bypass_rls', 'lucia', true)`);
  const after = await pool.query(
    `SELECT id::text, expense_number, transaction_date::text, status, posting_status, posting_hold_reason FROM accounting.expenses WHERE id = ANY($1)`,
    [[OLD_EXPENSE_ID, newExpenseId]]
  );
  await pool.query("ROLLBACK");
  console.log("\nFinal state:", JSON.stringify(after.rows, null, 1));

  await app.close();
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
