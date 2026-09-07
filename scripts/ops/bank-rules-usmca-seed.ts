#!/usr/bin/env tsx
/**
 * BANK-RULES-USMCA (lead, 2026-09-06) — author the USMCA bank-feed categorization rules from the REAL
 * uncategorized lines, and refresh every for_review transaction's suggestion through the real route.
 *
 * Owner 2026-09-06: "CASH FLOW MUST HAVE ALL DATA … VENDORS AND CUSTOMERS … 3 CODERS ON MONEY … NOBODY IDLE."
 * Standing decision (law doc §2): the owner categorizes December 2025 → July 2026 himself. This script never
 * categorizes and never posts — it only writes SUGGESTIONS (suggested_vendor_id / suggested_account_id), which
 * the owner accepts or overrides row by row. Zero GL writes. Zero review_state changes.
 *
 * MEASURED BEFORE (Neon USMCA, bypass_rls, 2026-09-06 19:5xZ): 364 live bank lines, 15 carry a suggestion,
 * accounting.banking_rules has ONE USMCA row ("wire transfer fee" → 6300). Grouped by description shape:
 *   WIRE TRANSFER FEE 24 · LOVE'S TRAVEL STOP 20 · ORIG:FARO FACTORING wires 16 ($134,786.78 in) ·
 *   SOUTH TX TRUCK CE* 18 · FUEL AMERICA TRAV* 17 · DTOPS SINGLE CROS* 15 · T-MOBILE/CRICKET/NP WIRELESS 5 ·
 *   LOVE'S TIRE CARE 3 · UTILITY TRAILERS 2 · RUSH TRK CTR 1 · STELLANTIS FUNDIN 1 · CO DEPT OF PUBLIC 1 · APPLE 1.
 *
 * Every rule below maps to an account that EXISTS on the USMCA chart today and to a vendor that EXISTS in
 * mdata.vendors (USMCA) today — ids verified live. Lines whose account does not exist yet (Holiday Inn lodging,
 * Southern Sanitation yard service, Palos Garza customs broker) and lines that are the owner's call (ATM/cash,
 * Zelle to a person, checks, IH35 Transportation related-party wires) are deliberately NOT ruled — they are
 * listed in the report for the owner. Never a guessed account (law doc §3: "Uncategorized is the only fallback").
 *
 * Dry run (default): prints the rule set, which rules already exist, and the projected coverage.
 *   npx tsx scripts/ops/bank-rules-usmca-seed.ts
 * Apply (a coder with Neon writes runs this; the lead's seat cannot write production money rows):
 *   DATABASE_URL=<Neon prod> npx tsx scripts/ops/bank-rules-usmca-seed.ts --apply
 * Apply = POST /api/v1/banking/rules per missing rule (audited banking.rule_created), then
 *   POST /api/v1/banking/transactions/:id/refresh-suggestion for every USMCA for_review line (audited).
 */
import pg from "pg";
import { createIntegrationApp } from "../../apps/backend/test-helpers/http-app.js";
import { registerBankingP7Wave2Routes } from "../../apps/backend/src/banking/p7-wave2.routes.js";

export const USMCA_COMPANY_ID = "5c854333-6ea5-4faa-af31-67cb272fef80";
const OWNER_USER_ID = "e4117991-d2c0-406d-8cda-74e98d95bccd"; // identity.users tioperfumes07@gmail.com, role Owner

/** account_number on catalogs.accounts (USMCA) — resolved to ids live, never hardcoded ids. */
export type SeedRule = {
  key: string;
  description_contains: string;
  account_number: string;
  account_name: string;
  vendor_id: string | null;
  vendor_name: string | null;
  memo: string;
  priority: number;
};

/** Vendor ids read live from mdata.vendors (USMCA) 2026-09-06 19:5xZ. */
export const SEED_RULES: SeedRule[] = [
  { key: "loves-fuel", description_contains: "love's travel", account_number: "5000", account_name: "Fuel & Diesel", vendor_id: "5a529e97-5af6-4874-89c0-f300715101f2", vendor_name: "LOVES", memo: "Love's fuel card purchase", priority: 90 },
  { key: "loves-fuel-alt", description_contains: "loves travel", account_number: "5000", account_name: "Fuel & Diesel", vendor_id: "5a529e97-5af6-4874-89c0-f300715101f2", vendor_name: "LOVES", memo: "Love's fuel card purchase", priority: 90 },
  { key: "fuel-america", description_contains: "fuel america", account_number: "5000", account_name: "Fuel & Diesel", vendor_id: "aece329d-ef9d-4622-8281-1f1051ce8bf4", vendor_name: "Fuel America", memo: "Fuel America Travel Center, Laredo", priority: 90 },
  { key: "loves-tire", description_contains: "love's tire care", account_number: "5500", account_name: "Tires", vendor_id: "e94d9f75-8323-45e1-8663-3e738cf44273", vendor_name: "Loves Truck Care", memo: "Love's Tire Care", priority: 95 },
  { key: "south-tx-truck", description_contains: "south tx truck ce", account_number: "5400", account_name: "Truck Repairs & Maintenance", vendor_id: "ae444fb6-c9aa-4912-a4b0-c8a536f8e7f8", vendor_name: "South Tx Truck Centers", memo: "South Texas Truck Centers parts/service", priority: 90 },
  { key: "rush-truck", description_contains: "rush trk ctr", account_number: "5400", account_name: "Truck Repairs & Maintenance", vendor_id: "f47664ec-9642-4488-8cc5-586edb1bb0a5", vendor_name: "Rush Truck Center", memo: "Rush Truck Center parts/service", priority: 90 },
  { key: "utility-trailers", description_contains: "utility trailers lared", account_number: "5400", account_name: "Truck Repairs & Maintenance", vendor_id: "5eb77d67-0557-49a2-85cc-a29b8292c33f", vendor_name: "Utility Trailer Sales Southeast Texas,Inc", memo: "Utility Trailers Laredo trailer parts/service", priority: 90 },
  { key: "dtops", description_contains: "dtops single cros", account_number: "5700", account_name: "Permits & Licenses (IFTA/IRP/DOT)", vendor_id: "5c557250-fb0b-433a-acf0-3ca123266c29", vendor_name: "DTOPS", memo: "CBP DTOPS single-crossing user fee", priority: 90 },
  { key: "t-mobile", description_contains: "t-mobile", account_number: "6100", account_name: "Telephone & Communications", vendor_id: null, vendor_name: null, memo: "T-Mobile", priority: 80 },
  { key: "cricket", description_contains: "cricket", account_number: "6100", account_name: "Telephone & Communications", vendor_id: "987adc69-b487-499b-8c6b-fa34d01db2fb", vendor_name: "Cricket Wireless", memo: "Cricket Wireless", priority: 80 },
  { key: "np-wireless", description_contains: "np wireless", account_number: "6100", account_name: "Telephone & Communications", vendor_id: "31313a7c-6448-4398-bd93-7c7e849c1d73", vendor_name: "NP Wireless", memo: "NP Wireless", priority: 80 },
  { key: "apple", description_contains: "apple.com/bill", account_number: "6500", account_name: "Software & Subscriptions", vendor_id: "c373bef8-4169-43d1-b699-d31dfe9e09ee", vendor_name: "Apple", memo: "Apple subscription", priority: 80 },
  { key: "co-dps", description_contains: "co dept of public", account_number: "5700", account_name: "Permits & Licenses (IFTA/IRP/DOT)", vendor_id: null, vendor_name: null, memo: "Colorado Dept of Public Safety permit", priority: 80 },
  { key: "stellantis", description_contains: "stellantis fundin", account_number: "2400", account_name: "Equipment Loans / Notes Payable", vendor_id: null, vendor_name: null, memo: "Stellantis Financial vehicle note payment — split interest to 6810 at posting", priority: 80 },
  { key: "faro-wire-in", description_contains: "orig:faro factoring", account_number: "2150", account_name: "Factoring Advance", vendor_id: "a1f4c2b6-8e35-4f91-9c2d-6b7a58e0f3c4", vendor_name: "Faro Factoring", memo: "Factor advance wire — match to the factoring advance record first (ASC 860 secured borrowing)", priority: 95 },
];

/** Lines the script refuses to rule — the owner decides, and some need an account that does not exist yet. */
export const OWNER_DECIDES = [
  "HOLIDAY INN (3 lines, $344.53) — no lodging account on the USMCA chart; recommend 5800 Driver Lodging & Travel (COGS), then a rule.",
  "SOUTHERN SANITATION (2, $700.00) — yard/portable sanitation service; recommend 6230 Yard, Utilities & Facilities, then a rule.",
  "PALOS GARZA F (1, $124.80) — Mexican customs broker/forwarder; recommend 5320 Customs Broker & Border Fees (COGS), then a rule.",
  "ORIG:IH 35 TRANSPORTATION wires in (5, $21,509.37, July) — related-party funds; 2410 Owner/Related-Party Loan Payable vs 1270 repayment — owner names the direction.",
  "WIRE TRANSFER CREDIT ON (10, $52,356.74) and COUNTER CREDIT / TELLER CREDIT (7, $52,680.00) — customer or factor receipts: matched to invoices/advances by the match engine, never categorized by rule.",
  "CHECK IMAGE / CASHED CHECK HOLD (11, $16,594.75) and PMNT SENT (4, $4,449.31) — driver settlement payments: matched to settlements (2170 Driver Net-Pay Clearing) once close posts to clearing, never a rule.",
  "BKOFAMERICA ATM / BC WITHDRWL (6, $7,200.00) and ZELLE PAYMENT TO LAURA MUNOZ (2, $1,800.00) — cash and person payments: owner decides per line.",
  "TW SERVICES INC (3, $2,180.00) · WWW.MERITLOGISTICS (2, $139.36) · F#MFXT (2, $139.36) · BB LAREDO (1, $43.50) — vendor unknown to the chart; owner names them.",
];

const apply = process.argv.includes("--apply");

type TxnRow = { id: string; description: string | null; amount_cents: string; is_credit: boolean };

function ruleMatchesText(rule: SeedRule, text: string | null): boolean {
  return (text ?? "").toLowerCase().includes(rule.description_contains.toLowerCase());
}

async function main() {
  console.log(`bank-rules-usmca-seed — ${SEED_RULES.length} rules authored from the live description shapes; ${OWNER_DECIDES.length} shapes left to the owner.`);
  for (const r of SEED_RULES) console.log(`  [${r.priority}] "${r.description_contains}" -> ${r.account_number} ${r.account_name}${r.vendor_name ? ` · vendor ${r.vendor_name}` : ""}`);
  console.log("");
  console.log("OWNER DECIDES (no rule written):");
  for (const line of OWNER_DECIDES) console.log(`  - ${line}`);

  if (!process.env.DATABASE_URL) {
    console.log("\nNo DATABASE_URL — static dry-run only (rule set printed). Set DATABASE_URL to measure coverage; add --apply to write.");
    return 0;
  }

  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  const client = await pool.connect();
  let txns: TxnRow[] = [];
  let existing: { description_contains: string | null }[] = [];
  const accountIds = new Map<string, string>();
  try {
    await client.query("BEGIN");
    await client.query(`SELECT set_config('app.bypass_rls','lucia',true)`);
    const acc = await client.query<{ id: string; account_number: string }>(
      `SELECT id::text, account_number FROM catalogs.accounts WHERE operating_company_id = $1::uuid AND deactivated_at IS NULL AND account_number = ANY($2::text[])`,
      [USMCA_COMPANY_ID, [...new Set(SEED_RULES.map((r) => r.account_number))]]
    );
    for (const a of acc.rows) accountIds.set(a.account_number, a.id);
    const missing = SEED_RULES.map((r) => r.account_number).filter((n) => !accountIds.has(n));
    if (missing.length) throw new Error(`accounts missing on the USMCA chart: ${[...new Set(missing)].join(", ")} — never guess; stop.`);
    const vend = await client.query<{ id: string }>(
      `SELECT id::text FROM mdata.vendors WHERE operating_company_id = $1::uuid AND id = ANY($2::uuid[])`,
      [USMCA_COMPANY_ID, SEED_RULES.map((r) => r.vendor_id).filter(Boolean)]
    );
    const vendorIds = new Set(vend.rows.map((v) => v.id));
    const badVendors = SEED_RULES.filter((r) => r.vendor_id && !vendorIds.has(r.vendor_id));
    if (badVendors.length) throw new Error(`vendor ids not found in USMCA mdata.vendors: ${badVendors.map((r) => r.key).join(", ")}`);
    existing = (
      await client.query<{ description_contains: string | null }>(
        `SELECT description_contains FROM accounting.banking_rules WHERE operating_company_id = $1::uuid AND is_active = true`,
        [USMCA_COMPANY_ID]
      )
    ).rows;
    txns = (
      await client.query<TxnRow>(
        `SELECT id::text, description, amount_cents::text, is_credit FROM banking.bank_transactions
         WHERE operating_company_id = $1::uuid AND voided_at IS NULL AND review_state = 'for_review'`,
        [USMCA_COMPANY_ID]
      )
    ).rows;
    await client.query("ROLLBACK");
  } finally {
    client.release();
  }

  const have = new Set(existing.map((e) => (e.description_contains ?? "").toLowerCase()));
  const toCreate = SEED_RULES.filter((r) => !have.has(r.description_contains.toLowerCase()));
  let covered = 0;
  const perRule = new Map<string, number>();
  for (const t of txns) {
    const hit = SEED_RULES.find((r) => ruleMatchesText(r, t.description));
    if (hit) {
      covered += 1;
      perRule.set(hit.key, (perRule.get(hit.key) ?? 0) + 1);
    }
  }
  console.log("");
  console.log(`LIVE: ${txns.length} USMCA for_review lines · ${existing.length} active rule(s) today · ${toCreate.length} rule(s) to create · projected coverage ${covered}/${txns.length} (${txns.length ? Math.round((covered / txns.length) * 100) : 0}%)`);
  for (const [k, n] of perRule) console.log(`  ${k}: ${n} line(s)`);

  if (!apply) {
    console.log("\nDRY-RUN — zero writes. Re-run with --apply to create the rules through POST /api/v1/banking/rules and refresh every for_review suggestion.");
    await pool.end();
    return 0;
  }

  process.env.IH35_TEST_AUTH_BYPASS = "1";
  const app = await createIntegrationApp(async (a) => {
    await registerBankingP7Wave2Routes(a);
  });
  const headers = {
    "x-test-auth": Buffer.from(JSON.stringify({ id: OWNER_USER_ID, role: "Owner", email: "tioperfumes07@gmail.com" }), "utf8").toString("base64url"),
    "content-type": "application/json",
  };
  const report: string[] = [];
  for (const r of toCreate) {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/banking/rules",
      headers,
      payload: {
        operating_company_id: USMCA_COMPANY_ID,
        priority: r.priority,
        description_contains: r.description_contains,
        then_vendor_id: r.vendor_id ?? undefined,
        then_account_id: accountIds.get(r.account_number),
        then_memo_template: r.memo,
      },
    });
    report.push(`${res.statusCode < 300 ? "OK  " : "FAIL"} rule ${r.key} "${r.description_contains}" -> ${r.account_number} :: ${res.statusCode} ${res.statusCode >= 300 ? res.body.slice(0, 160) : ""}`);
  }
  let refreshed = 0;
  let refreshFailed = 0;
  for (const t of txns) {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/banking/transactions/${t.id}/refresh-suggestion`,
      headers,
      payload: { operating_company_id: USMCA_COMPANY_ID },
    });
    if (res.statusCode < 300) refreshed += 1;
    else refreshFailed += 1;
  }
  await app.close();

  const c2 = await pool.connect();
  let after = 0;
  try {
    await c2.query(`SELECT set_config('app.bypass_rls','lucia',true)`);
    const r = await c2.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM banking.bank_transactions WHERE operating_company_id = $1::uuid AND voided_at IS NULL AND review_state = 'for_review' AND suggested_account_id IS NOT NULL`,
      [USMCA_COMPANY_ID]
    );
    after = Number(r.rows[0]?.n ?? 0);
  } finally {
    c2.release();
    await pool.end();
  }
  console.log("");
  for (const line of report) console.log(line);
  console.log(`\nrefresh-suggestion: ${refreshed} ok · ${refreshFailed} failed · lines with a suggestion now: ${after}/${txns.length}`);
  console.log("Nothing categorized, nothing posted, review_state untouched — suggestions only.");
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
