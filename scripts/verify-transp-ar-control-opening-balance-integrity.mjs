#!/usr/bin/env node
// TRANSP-AR-CONTROL-NEGATIVE-BALANCE (docs/audit/GUARD-WORKORDERS.md, filed CC-1 2026-09-07) —
// "TRANSP's live ar_control GL account nets to -$961,983.52 ... do not assume it's a bug OR
// assume it's fine — trace it first."
//
// TRACED LIVE (CC-1 2026-09-07, Neon bypass_rls=lucia, prod):
//   - ar_control role account for TRANSP = catalogs.accounts id 3bfa6640-cfab-4dae-b03d-8989f49ad910
//     (account_number QBO-45, "Accounts Receivable (A/R)").
//   - EVERY posting ever made against that account for TRANSP was pulled and grouped. Exactly ONE
//     journal_entry_postings row explains the entire -$961,983.52 net: a CREDIT of $961,983.52 on
//     journal_entry_uuid 69acbf78-4f76-4df0-a728-6371bd416f0d, line_sequence 15, memo "Opening
//     balance — QBO Balance Sheet 12/31/2024 (signed-actual, NI rolled to RE)" — the owner-entered
//     opening JE (docs/specs/qbo-parity/OPENING-BALANCE-TIEOUT-CEREMONY-2026-07-04.md §1 documents
//     this EXACT figure, months before it was posted: "Accounts Receivable | -$538,278.66 (native
//     A/R -$961,983.52 + 2 misclassified 'Unauthorized Expenses' ...)"). This is a faithful,
//     already-reviewed mirror of the real (troubled) QBO Balance Sheet at 12/31/2024 — signed-actual
//     means the owner deliberately captured the TRUE sign off the source report, not a naive
//     all-assets-are-debits assumption. NOT a data-entry sign bug.
//   - Every OTHER posting ever made against this account for TRANSP (2 real TMS-native rows: one
//     $5.00 invoice debit + its own $5.00 customer_payment credit, i.e. one fully-paid, fully-tied
//     invoice) nets to exactly $0.00. TMS's own live posting engine has ZERO defect here.
//   - Verdict: NOT A DEFECT. Filed here as a permanent guard so this diagnosis stays true — the
//     opening-balance line is owner-entered (never touch it; void-not-delete) and any FUTURE
//     material movement against ar_control outside that one line is exactly the kind of thing this
//     investigation would have caught, so it must never silently regress into "just noise again."
//
// Read-only. Run: node scripts/verify-transp-ar-control-opening-balance-integrity.mjs [--selftest]
//   DATABASE_URL=<prod> node scripts/verify-transp-ar-control-opening-balance-integrity.mjs

const LABEL = "verify-transp-ar-control-opening-balance-integrity";
const TRANSP = "91e0bf0a-133f-4ce8-a734-2586cfa66d96";
const AR_CONTROL_ACCOUNT_ID = "3bfa6640-cfab-4dae-b03d-8989f49ad910";
const OPENING_JE_UUID = "69acbf78-4f76-4df0-a728-6371bd416f0d";
const EXPECTED_OPENING_LINE = { debit_or_credit: "credit", amount_cents: 96198352 };
// Materiality bound for everything else hitting ar_control — today it is exactly $0 (one paid,
// tied invoice). $10,000 gives real future TMS-native AR activity room to post without a false
// alarm on every dollar, while still catching a real unexplained swing.
const NON_OPENING_MATERIALITY_BOUND_CENTS = 1_000_000; // $10,000.00

/** Pure classifier — kept separate from I/O so --selftest exercises the real logic. */
export function classifyArControlIntegrity({ openingLine, nonOpeningNetCents }) {
  const failures = [];
  if (!openingLine) {
    failures.push(
      `owner-entered opening-balance line (JE ${OPENING_JE_UUID}, line 15) is MISSING from ar_control — ` +
        `void-not-delete violation, an owner-entered opening balance must never disappear`
    );
  } else {
    if (openingLine.debit_or_credit !== EXPECTED_OPENING_LINE.debit_or_credit) {
      failures.push(
        `opening-balance ar_control line side changed: expected ${EXPECTED_OPENING_LINE.debit_or_credit}, got ${openingLine.debit_or_credit}`
      );
    }
    if (openingLine.amount_cents !== EXPECTED_OPENING_LINE.amount_cents) {
      failures.push(
        `opening-balance ar_control line amount changed: expected ${EXPECTED_OPENING_LINE.amount_cents} cents, got ${openingLine.amount_cents} — ` +
          `this figure is owner-entered from the real QBO Balance Sheet 12/31/2024 and must never be silently edited`
      );
    }
  }
  if (Math.abs(nonOpeningNetCents) > NON_OPENING_MATERIALITY_BOUND_CENTS) {
    failures.push(
      `non-opening-balance activity against TRANSP ar_control net = ${nonOpeningNetCents} cents, ` +
        `beyond the $${(NON_OPENING_MATERIALITY_BOUND_CENTS / 100).toFixed(2)} tripwire — ` +
        `this account's non-opening net was $0.00 when diagnosed (2026-09-07); a real unexplained ` +
        `swing here would be exactly the posting-side defect this investigation ruled out then`
    );
  }
  return failures;
}

function selftest() {
  const cases = [
    {
      name: "healthy state (today's real live shape)",
      input: { openingLine: { debit_or_credit: "credit", amount_cents: 96198352 }, nonOpeningNetCents: 0 },
      expectFailures: 0,
    },
    {
      name: "opening line deleted",
      input: { openingLine: null, nonOpeningNetCents: 0 },
      expectFailures: 1,
    },
    {
      name: "opening line amount silently edited",
      input: { openingLine: { debit_or_credit: "credit", amount_cents: 1 }, nonOpeningNetCents: 0 },
      expectFailures: 1,
    },
    {
      name: "opening line side flipped",
      input: { openingLine: { debit_or_credit: "debit", amount_cents: 96198352 }, nonOpeningNetCents: 0 },
      expectFailures: 1,
    },
    {
      name: "unexplained $50,000 swing outside the opening line",
      input: { openingLine: { debit_or_credit: "credit", amount_cents: 96198352 }, nonOpeningNetCents: 5_000_000 },
      expectFailures: 1,
    },
    {
      name: "small real TMS-native activity stays under the tripwire",
      input: { openingLine: { debit_or_credit: "credit", amount_cents: 96198352 }, nonOpeningNetCents: 50_000 },
      expectFailures: 0,
    },
  ];
  let ok = true;
  for (const c of cases) {
    const failures = classifyArControlIntegrity(c.input);
    if (failures.length !== c.expectFailures) {
      console.error(
        `${LABEL}: SELFTEST FAIL — "${c.name}": expected ${c.expectFailures} failure(s), got ${failures.length}: ${JSON.stringify(failures)}`
      );
      ok = false;
    }
  }
  if (!ok) process.exit(1);
  console.log(`${LABEL}: SELFTEST PASS (${cases.length}/${cases.length} cases)`);
  process.exit(0);
}

if (process.argv.includes("--selftest")) selftest();

console.log(`${LABEL}: static OK — this is a live-data integrity guard, no source-file contract to check statically.`);

if (!process.env.DATABASE_URL) {
  console.log(`${LABEL}: DATABASE_URL not set — skipping the live check (static half still ran).`);
  console.log(`${LABEL}: to re-run live: DATABASE_URL=<prod> node ${process.argv[1]}`);
  process.exit(0);
}

const { Client } = await import("pg");
const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  await client.query("BEGIN");
  await client.query(`SELECT set_config('app.bypass_rls', 'lucia', true)`);
  const control = await client.query(`SELECT count(*)::int AS n FROM accounting.journal_entries`);
  if (control.rows[0].n === 0) {
    console.error(`${LABEL}: FAIL — je_control=0, this connection cannot see the ledger (masked read, not a verdict)`);
    process.exit(1);
  }

  const openingRes = await client.query(
    `SELECT debit_or_credit, amount_cents::bigint::int AS amount_cents
     FROM accounting.journal_entry_postings
     WHERE journal_entry_uuid = $1 AND account_id = $2 AND line_sequence = 15`,
    [OPENING_JE_UUID, AR_CONTROL_ACCOUNT_ID]
  );
  const openingLine = openingRes.rows[0] ?? null;

  const nonOpeningRes = await client.query(
    `SELECT COALESCE(SUM(CASE WHEN debit_or_credit = 'debit' THEN amount_cents ELSE -amount_cents END), 0)::bigint::int AS net_cents
     FROM accounting.journal_entry_postings
     WHERE operating_company_id = $1 AND account_id = $2 AND journal_entry_uuid != $3`,
    [TRANSP, AR_CONTROL_ACCOUNT_ID, OPENING_JE_UUID]
  );
  const nonOpeningNetCents = nonOpeningRes.rows[0].net_cents;

  await client.query("ROLLBACK");

  const failures = classifyArControlIntegrity({ openingLine, nonOpeningNetCents });
  if (failures.length > 0) {
    console.error(`${LABEL}: FAIL (je_control=${control.rows[0].n})`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log(
    `${LABEL}: PASS — opening-balance ar_control line intact (credit $${(EXPECTED_OPENING_LINE.amount_cents / 100).toFixed(2)}), ` +
      `non-opening net = $${(nonOpeningNetCents / 100).toFixed(2)} (je_control=${control.rows[0].n})`
  );
} finally {
  await client.end();
}
