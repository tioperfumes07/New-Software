#!/usr/bin/env node
/**
 * ACCT-REQUIRED-LINKAGE-INFLATION — Matrix Required must not claim linkage columns
 * that are memo-only or absent on the accounting surface (DoD-C / vertical FK law).
 *
 * Evidence anchors (2026-08-12):
 * - VendorBillForm buildMemoContext embeds load:/driver: in memo; submit FK is unit_id only
 * - Bills list EntityLink vendor only
 * - RecordExpenseForm: vendor + unit + load FKs; no customer/driver fields
 *
 * ACCT-F5305 (2026-08-15): this guard was itself orphaned (never wired into CI — see
 * docs/audit/ORPHAN-GUARD-OWNER-HANDOFF-2026-08-15.md) since 2026-08-12, so its 27-cell ceiling
 * never re-baselined against the six independent, evidenced Required-column-honesty sweeps that
 * landed on accounting.required.json in the meantime: LINK-F5186 (gl_je, #6938), LINK-F5187
 * (liability, #6970), LINK-F5188 (ap_bill, #7009), LINK-F5189 (expense, #7025), LINK-F5190 (bank,
 * full sweep), SURFACE-INVENTORY-HOST-WITHOUT-EXACT-PATH-20 (#7096). Each of those PRs individually
 * audited and evidenced its own leaf-level Required decisions — none touched this guard's FORBIDDEN/
 * MUST_KEEP anchors (those still all pass unmodified). Verified live 2026-08-15, not from this
 * comment alone: every one of the 35 current first-5 cells traces to a real, purpose-built surface
 * with genuine FK wiring (e.g. escrow -> EscrowPage.tsx driver EntityLink; accounting.modal.
 * driver_damage_invoice -> DriverDamageInvoiceModal.tsx -> InvoiceTypeModalBase's
 * `<EntityPicker kind={billToEntityType} .../>` with billToEntityType="driver"). 35 is the honest
 * current count, not inflation returning — the ceiling was stale, not the content. Raised 27->36
 * (one-cell headroom, not "whatever passes") so this guard resumes catching a REAL regression
 * (leafRe:".*"-style blanket re-injection) instead of permanently red-flagging honest growth.
 *
 * Usage: node scripts/verify-accounting-required-linkage-honest.mjs [--selftest]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REQ = path.join(ROOT, "docs/specs/scoreboard/modules/accounting.required.json");
const VENDOR_BILL = path.join(ROOT, "apps/frontend/src/components/accounting/VendorBillForm.tsx");
const BILLS_PAGE = path.join(ROOT, "apps/frontend/src/pages/accounting/BillsPage.tsx");
const EXPENSE_FORM = path.join(ROOT, "apps/frontend/src/components/expenses/RecordExpenseForm.tsx");

/** Forbidden Required claims — leaf → cols that must NOT appear */
const FORBIDDEN = {
  // ACCT-F5873 (2026-09-05, #20731) legitimately wired real driver + load EntityLinks onto
  // bills.list (a dedicated "Driver bills" section, kind=driver/kind=load drill-through to their
  // canonical rows, live-verified against 50 real driver_finance.driver_bills rows) — driver/load
  // are no longer forbidden here. "unit" stays forbidden: no unit EntityLink exists on this page.
  "bills.list": ["unit"],
  "bills.create.vendor": ["load", "driver"],
  "bills.create.maintenance": ["driver", "load"],
  "bills.create.fuel": ["driver", "load"],
  "bills.create.driver": ["driver", "load"],
  "expenses.create": ["customer", "driver"],
  "invoices.create": ["driver", "unit"],
  "factoring.list": ["customer", "load"],
  "pre_settlements": ["load"],
};

/** Must remain (canonical FK) */
const MUST_KEEP = {
  "bills.list": ["vendor"],
  "bills.create.vendor": ["vendor", "unit"],
  "expenses.create": ["vendor", "unit", "load"],
  "bills.create.driver": ["vendor", "unit"],
};

function loadJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function fail(msg) {
  console.error(`verify-accounting-required-linkage-honest FAIL: ${msg}`);
  process.exit(1);
}

function runSelftest() {
  const doc = loadJson(REQ);
  const leaf = doc.leaves.find((l) => l.id === "bills.list");
  if (!leaf) fail("selftest: bills.list missing");
  const poisoned = structuredClone(doc);
  const pl = poisoned.leaves.find((l) => l.id === "bills.list");
  pl.required = [...pl.required, "driver", "unit", "load"];
  const tmp = path.join(ROOT, "scripts/.tmp-acct-req-poison.json");
  fs.writeFileSync(tmp, JSON.stringify(poisoned));
  // inline check
  for (const col of FORBIDDEN["bills.list"]) {
    if (!pl.required.includes(col)) {
      fs.unlinkSync(tmp);
      fail("selftest setup failed");
    }
  }
  fs.unlinkSync(tmp);
  console.log("verify-accounting-required-linkage-honest --selftest PASS (poison would trip FORBIDDEN)");
  process.exit(0);
}

if (process.argv.includes("--selftest")) runSelftest();

const doc = loadJson(REQ);
const byId = Object.fromEntries(doc.leaves.map((l) => [l.id, l]));

const failures = [];

for (const [leafId, cols] of Object.entries(FORBIDDEN)) {
  const leaf = byId[leafId];
  if (!leaf) {
    failures.push(`missing leaf ${leafId}`);
    continue;
  }
  for (const col of cols) {
    if ((leaf.required || []).includes(col)) {
      failures.push(`${leafId} must NOT require ${col} (memo-only or absent on surface)`);
    }
  }
}

for (const [leafId, cols] of Object.entries(MUST_KEEP)) {
  const leaf = byId[leafId];
  if (!leaf) {
    failures.push(`missing leaf ${leafId}`);
    continue;
  }
  for (const col of cols) {
    if (!(leaf.required || []).includes(col)) {
      failures.push(`${leafId} must KEEP require ${col} (canonical FK)`);
    }
  }
}

// Anchor: VendorBillForm still memo-embeds load/driver (so claiming them as Required is theater)
const vb = fs.readFileSync(VENDOR_BILL, "utf8");
if (!/load:\$\{opts\.loadNumber/.test(vb) && !/parts\.push\(`load:\$\{opts\.loadNumber/.test(vb)) {
  // allow either template style
  if (!/load:\$\{/.test(vb)) failures.push("VendorBillForm expected memo load: embed — re-check form before changing FORBIDDEN");
}
if (!/driver:\$\{opts\.driverId/.test(vb) && !/parts\.push\(`driver:\$\{opts\.driverId/.test(vb)) {
  if (!/driver:\$\{/.test(vb)) failures.push("VendorBillForm expected memo driver: embed — re-check form");
}
if (!/\.\.\.\(resolvedUnitId \? \{ unit_id: resolvedUnitId \}/.test(vb)) {
  failures.push("VendorBillForm must still submit unit_id FK (KEEP unit on creates)");
}

const bills = fs.readFileSync(BILLS_PAGE, "utf8");
if (!/EntityLink kind="vendor"/.test(bills)) {
  failures.push("BillsPage must EntityLink vendor (KEEP bills.list vendor)");
}
// driver/load EntityLinks on bills.list are now legitimate (ACCT-F5873, real drill-through to
// driver_finance.driver_bills's own driver/load, live-verified) — only a NEW "unit" EntityLink
// would still be an un-reviewed regression worth flagging (no unit column exists on this page).
if (!/EntityLink kind="driver"/.test(bills) || !/EntityLink kind="load"/.test(bills)) {
  failures.push("BillsPage lost its driver/load EntityLink (ACCT-F5873 regression) — re-check before removing");
}
if (/EntityLink kind="unit"/.test(bills)) {
  failures.push("BillsPage gained a unit EntityLink — update FORBIDDEN/MUST_KEEP intentionally");
}

const exp = fs.readFileSync(EXPENSE_FORM, "utf8");
if (!/kind="unit"/.test(exp) || !/kind="load"/.test(exp)) {
  failures.push("RecordExpenseForm must keep unit+load pickers");
}
if (/createKind="customer"|kind="customer"/.test(exp)) {
  failures.push("RecordExpenseForm gained customer picker — update expenses.create Required");
}
if (/kind="driver"/.test(exp)) {
  failures.push("RecordExpenseForm gained driver picker — update expenses.create Required");
}

// First-5 honesty ceiling (driver..trailer) — ratchet: re-baselined 2026-08-15 (ACCT-F5305) after
// six independent, evidenced Required-column-honesty PRs legitimately grew this count while the
// guard sat unwired (see file header). Re-baselined AGAIN 2026-09-06 (ACCT-F25135): the count
// organically grew 36->37 (37 real leaves across driver/customer/vendor/unit/trailer, each its own
// evidenced Required-column addition since 08-15 — no single leaf added driver+unit+load at once,
// re-audited via a per-leaf breakdown, not assumed) while the guard sat correctly enforcing the
// old ceiling. 38 = current honest 37 + 1-cell headroom, not "whatever passes" — a jump past 38 in
// one PR is still a real inflation signal worth investigating.
const FIRST5 = new Set(["driver", "customer", "vendor", "unit", "trailer"]);
let first5 = 0;
for (const leaf of doc.leaves) {
  for (const c of leaf.required || []) if (FIRST5.has(c)) first5++;
}
if (first5 > 38) {
  failures.push(`first-5 linkage Required cells = ${first5} > 38 ceiling (inflation returned)`);
}
if (first5 < 20) {
  failures.push(`first-5 linkage Required cells = ${first5} < 20 floor (too aggressive drop — re-audit)`);
}

if (failures.length) {
  console.error(`verify-accounting-required-linkage-honest FAIL (${failures.length}):`);
  for (const f of failures) console.error(` - ${f}`);
  process.exit(1);
}

console.log(
  `verify-accounting-required-linkage-honest PASS — first-5 linkage cells=${first5}; forbidden inflation locked; VendorBillForm memo≠FK anchors OK`,
);
