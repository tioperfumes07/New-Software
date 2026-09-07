#!/usr/bin/env node
/**
 * GUARD: a migration that voids a financial row must also reverse it, or say why not.
 *
 * CI-F31. PERMANENT LAW §4 and standing-order rule 5: **VOID = reversal; nothing is deletable.**
 * The application enforces it — `voidBill` posts an equal-and-opposite reversing JE in the SAME
 * transaction as the status flip, gated by VOID_ENFORCEMENT_ENABLED, which is ON for all three
 * entities on prod. **A migration bypasses all of that.** Direct SQL sets `voided_at`, no service
 * runs, no reversal is posted, and nothing fails.
 *
 * That is not hypothetical. Measured on the prod branch:
 *   · 202612230000 (ACCT-F142) voided 4 duplicate bills so a partial unique index could install.
 *     All four carry `voided_by_user_id IS NULL` — no actor. **6 posting lines, 0 reversed,
 *     $1,643.21 of expense and A/P still on the books.**
 *   · 202612330000 voided invoices as well. **2 voided invoices carry 4 posting lines, 0 reversed,
 *     $314.90 of revenue and A/R still on the books** — a residue no card had measured.
 *
 * Neither migration was careless. Both were correct remediations, well-reasoned in their own
 * comments. Nothing told their authors a reversal was required and nothing failed when it was
 * missing — which is precisely why this needs a guard rather than a reminder.
 *
 * WHY A DECLARED EXEMPTION IS ALLOWED. Some voids legitimately have nothing to reverse: a row that
 * never posted, or a pre-posting cleanup. Forbidding that outright would push authors to work
 * around the guard. So the rule is: reverse it, or SAY IN THE MIGRATION why there is nothing to
 * reverse. An explicit sentence in a reviewed file is the artifact an auditor can actually read.
 *
 * Run:  node scripts/verify-migration-void-posts-reversal.mjs [--selftest]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIGRATIONS = path.join(root, "db/migrations");
const LABEL = "verify-migration-void-posts-reversal";

/** Financial schemas whose rows carry GL postings. Voiding one of these implies a reversal. */
const FINANCIAL_SCHEMAS = ["accounting", "driver_finance", "factoring", "banking"];

/** The marker an author writes when a void genuinely has nothing to reverse. */
const EXEMPTION_RE = /VOID-REVERSAL-EXEMPT:/i;

/** Evidence that the migration DOES post reversals itself. */
const REVERSAL_RE =
  /reversed_by_line_id|reversal_of_line_id|reverses_je_id|reversed_by_je_id|INSERT\s+INTO\s+accounting\.journal_entr/i;

export function voidsFinancialRows(sql) {
  const clean = sql.replace(/--[^\n]*/g, "");
  const schemas = FINANCIAL_SCHEMAS.join("|");
  // An UPDATE on a financial table that assigns voided_at.
  const re = new RegExp(
    `UPDATE\\s+(?:${schemas})\\.[a-z_]+[\\s\\S]{0,800}?\\bSET\\b[\\s\\S]{0,800}?\\bvoided_at\\s*=`,
    "i"
  );
  return re.test(clean);
}

export function collectProblems(files, baseline) {
  const problems = [];
  for (const { name, sql } of files) {
    if (!voidsFinancialRows(sql)) continue;
    if (baseline.has(name)) continue;
    if (EXEMPTION_RE.test(sql)) continue;
    if (REVERSAL_RE.test(sql)) continue;
    problems.push(
      `${name} sets voided_at on a financial row but neither posts reversing entries nor declares ` +
        `VOID-REVERSAL-EXEMPT: <reason>. A migration is the one void path no service, flag or guard ` +
        `checks — this is how $1,643.21 of A/P and $314.90 of revenue were left on the books (CI-F31).`
    );
  }
  return problems;
}

/**
 * FROZEN BASELINE — the two migrations that already carry this defect. They are REAL and their
 * residue is real; they are baselined because they are APPLIED and immutable (editing an applied
 * migration breaks its checksum — see the never-edit-applied-migration rule), so the guard cannot
 * demand they change. The residue they left is an OWNER decision, tracked on the board.
 *
 * RATCHET, NOT AMNESTY: a NEW offender fails immediately. Never add an entry to make a build green.
 */
const BASELINE = new Set([
  "202612230000_bills_void_reason_and_tms_native_duplicate_guard.sql",
  "202612330000_void_state_authoritative_bills_invoices.sql",
]);

/**
 * MARKER-SYNC-ONLY — applied, immutable migrations whose UPDATE assigns voided_at but creates NO
 * new void and leaves NO unreversed residue, so listing them in BASELINE (which the comment above
 * explicitly reserves for REAL, owner-gated residue) would misrepresent them as offenders they are
 * not. Each entry here requires the SAME manual review BASELINE does — reading the full file and
 * confirming its UPDATE is scoped by `WHERE status = 'void'` (or equivalent) with no EARLIER
 * statement in the same file that could have just flipped a live row to 'void', so the WHERE clause
 * cannot be gamed into laundering a genuine new void through this exemption.
 *
 * ACCT-F5436 (2026-08-18): 202612480900_bills_sync_void_markers.sql. Its ONLY
 * data-mutating statement is `UPDATE accounting.bills SET voided_at = COALESCE(voided_at,
 * revoked_at), ... WHERE status = 'void' AND (voided_at IS NULL OR revoked_at IS NULL)` — it only
 * fills in whichever of the bill's TWO existing void-marker columns (voided_at/revoked_at) was left
 * NULL by whichever writer voided the row, on rows that were ALREADY status='void' before this
 * migration ran. It touches no amount_cents/paid_cents/total_amount, creates no row, and cannot
 * un-void or re-void anything (the WHERE clause requires status='void' already). Any reversal that
 * SHOULD have posted belongs to the ORIGINAL voiding writer — for the 4 rows this backfill actually
 * reaches (per the migration's own measured LIVE PROOF), that writer is 202612230000, already in
 * BASELINE above with its residue owner-gated there. This migration adds zero new residue.
 */
const MARKER_SYNC_ONLY = new Set(["202612480900_bills_sync_void_markers.sql"]);

/**
 * NEVER-POSTED-CONFIRMED — applied, immutable migrations whose voided table is NOT a subledger row
 * at all (never carries a GL posting in the first place), so "reverse it or say why not" resolves
 * to "there is nothing to reverse" — distinct from BASELINE (real residue, owner-gated) and
 * MARKER-SYNC-ONLY (residue belongs to an earlier writer already baselined there). Each entry here
 * requires live proof that zero `accounting.journal_entry_postings` rows were ever created from the
 * voided table, not just an assumption from its schema.
 *
 * GO-ACCT-01 (2026-09-07, CC-2 live-verify): 202613300700_go_acct_01_recon_sessions_void_status_and_unique.sql
 * voids 2 duplicate `banking.reconciliation_sessions` rows (stray 'open' sessions superseded by the
 * canonical 'reconciled' one for the same bank_account_id + period). A reconciliation session is a
 * WORKSHEET (statement_balance_cents/book_balance_cents/variance_cents) tracking whether a bank
 * statement period has been reconciled — it is never itself the source of a GL posting; the actual
 * bank-feed matches/adjustments that a reconciliation covers post through their own transaction
 * paths, independent of the session row's existence. Live-confirmed on prod (Neon, bypass_rls=lucia):
 * `SELECT count(*) FROM accounting.journal_entry_postings WHERE source_transaction_type ILIKE
 * '%recon%'` → 0 — no posting has ever referenced a reconciliation session, applied or not. The
 * migration's own UPDATE also never touches a `status = 'reconciled'` row (confirmed by reading the
 * WHERE clause), so no live financial figure was reclassified, only a duplicate worksheet retired.
 */
const NEVER_POSTED_CONFIRMED = new Set([
  "202613300700_go_acct_01_recon_sessions_void_status_and_unique.sql",
]);

if (process.argv.includes("--selftest")) {
  const failures = [];
  const voidSql = "UPDATE accounting.bills b\n SET voided_at = now(), void_reason = 'x'\n WHERE 1=1;";

  if (!voidsFinancialRows(voidSql)) failures.push("a financial void was NOT detected");
  if (voidsFinancialRows("UPDATE mdata.loads SET voided_at = now()")) {
    failures.push("a NON-financial schema was flagged — out of scope, would redden unrelated migrations");
  }
  if (voidsFinancialRows("UPDATE accounting.bills SET status = 'void'")) {
    failures.push("a status-only update with no voided_at was flagged");
  }
  // A comment mentioning voided_at must not trip detection.
  if (voidsFinancialRows("-- UPDATE accounting.bills SET voided_at = now()")) {
    failures.push("a COMMENTED-OUT void was detected — comments are stripped, this must not fire");
  }

  const none = new Set();
  if (collectProblems([{ name: "new.sql", sql: voidSql }], none).length !== 1) {
    failures.push("the CI-F31 defect verbatim was NOT caught");
  }
  if (collectProblems([{ name: "new.sql", sql: voidSql }], new Set(["new.sql"])).length !== 0) {
    failures.push("a baselined migration was still reported");
  }
  const exempt = voidSql + "\n-- VOID-REVERSAL-EXEMPT: these rows never posted to the GL.";
  if (collectProblems([{ name: "e.sql", sql: exempt }], none).length !== 0) {
    failures.push("a declared exemption was still reported");
  }
  const reverses = voidSql + "\nUPDATE accounting.journal_entry_postings SET reversed_by_line_id = $1;";
  if (collectProblems([{ name: "r.sql", sql: reverses }], none).length !== 0) {
    failures.push("a migration that DOES reverse was still reported");
  }
  // The two real offenders must be detected when the baseline is empty — proving the baseline is
  // load-bearing rather than decorative.
  const real = [];
  for (const n of BASELINE) {
    const p = path.join(MIGRATIONS, n);
    if (fs.existsSync(p)) real.push({ name: n, sql: fs.readFileSync(p, "utf8") });
  }
  if (real.length === 2 && collectProblems(real, none).length !== 2) {
    failures.push("the two REAL baselined offenders are not detected with an empty baseline");
  }

  // The marker-sync-only real file must ALSO be detected as an offender with an empty exemption
  // set (proves the exemption is load-bearing) and cleared once MARKER_SYNC_ONLY is applied.
  for (const n of MARKER_SYNC_ONLY) {
    const p = path.join(MIGRATIONS, n);
    if (!fs.existsSync(p)) continue;
    const entry = [{ name: n, sql: fs.readFileSync(p, "utf8") }];
    if (collectProblems(entry, none).length !== 1) {
      failures.push(`${n} was not detected with an empty exemption set — exemption would be decorative`);
    }
    if (collectProblems(entry, MARKER_SYNC_ONLY).length !== 0) {
      failures.push(`${n} was still reported once MARKER_SYNC_ONLY is applied`);
    }
  }

  // Same load-bearing proof for NEVER_POSTED_CONFIRMED: detected against an empty exemption set,
  // cleared once its own set is applied.
  for (const n of NEVER_POSTED_CONFIRMED) {
    const p = path.join(MIGRATIONS, n);
    if (!fs.existsSync(p)) continue;
    const entry = [{ name: n, sql: fs.readFileSync(p, "utf8") }];
    if (collectProblems(entry, none).length !== 1) {
      failures.push(`${n} was not detected with an empty exemption set — exemption would be decorative`);
    }
    if (collectProblems(entry, NEVER_POSTED_CONFIRMED).length !== 0) {
      failures.push(`${n} was still reported once NEVER_POSTED_CONFIRMED is applied`);
    }
  }

  if (failures.length) {
    console.error(`${LABEL} SELFTEST FAILED:`);
    for (const f of failures) console.error("  - " + f);
    process.exit(1);
  }
  console.log(
    `${LABEL} SELFTEST OK — detection, non-financial + status-only + commented-out correctly ignored, ` +
      `defect verbatim caught, baseline honoured, exemption honoured, real reversal honoured, both REAL ` +
      `BASELINE offenders detected against an empty baseline, the MARKER_SYNC_ONLY entry detected ` +
      `against an empty exemption set and cleared once applied`
  );
  process.exit(0);
}

const files = fs.existsSync(MIGRATIONS)
  ? fs
      .readdirSync(MIGRATIONS)
      .filter((f) => f.endsWith(".sql"))
      .map((f) => ({ name: f, sql: fs.readFileSync(path.join(MIGRATIONS, f), "utf8") }))
  : [];
const problems = collectProblems(files, new Set([...BASELINE, ...MARKER_SYNC_ONLY, ...NEVER_POSTED_CONFIRMED]));
if (problems.length) {
  console.error(`${LABEL} FAIL — ${problems.length} migration(s) void without reversing:`);
  for (const p of problems) console.error("  ✗ " + p);
  process.exit(1);
}
console.log(
  `${LABEL} OK — no NEW migration voids a financial row without posting reversals or declaring ` +
    `VOID-REVERSAL-EXEMPT (${BASELINE.size} known offenders baselined, their residue owner-gated; ` +
    `${MARKER_SYNC_ONLY.size} marker-sync-only migration(s) reviewed and confirmed to add no new residue; ` +
    `${NEVER_POSTED_CONFIRMED.size} migration(s) confirmed live to void a table that never posts to the GL).`
);
