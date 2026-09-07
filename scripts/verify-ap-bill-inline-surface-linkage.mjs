#!/usr/bin/env node
/** @matrix-built {"modules":["accounting"],"cols":["ap_bill"],"leafRe":"^accounting\\.panel\\.reallocate$","task":"VERTICAL-AP-BILL-INLINE-SURFACES"} */
/** @matrix-built {"modules":["settlements"],"cols":["ap_bill"],"leafRe":"^settlements\\.panel\\.open_driver_bills$","task":"VERTICAL-AP-BILL-INLINE-SURFACES"} */
import fs from "node:fs";
const allocation = fs.readFileSync("apps/frontend/src/components/allocation/BillAllocationPanel.tsx", "utf8");
const settlements = fs.readFileSync("apps/frontend/src/pages/driver-finance/SettlementsPage.tsx", "utf8");
const failures = (a = allocation, s = settlements) => [
  ["reallocation source bill drill", a.includes('<EntityLink kind="bill" id={billId} label={billLabel} />')],
  // ACCT-F5445: NOT kind="bill" here — that was this check's original ask, and it is WRONG.
  // OpenDriverBillsPanel's bill.id is a driver_finance.driver_bills row, a DIFFERENT table from
  // accounting.bills; kind="bill" drills to /accounting/bills/:id and live-404s for it (real
  // repro cited in verify-load-detail-driver-pay-bills.mjs's own comment: B-20260810-0003 ->
  // 31f155f3-...). Same defect class already fixed twice this session (ACCT-F5443, ACCT-F5444).
  // The correct, honest shape: bill_number as plain entityLabel text, no EntityLink wrap — there
  // is no legitimate per-id drill target for an open (unsettled) driver bill.
  [
    "open driver bill honest label (never kind=bill)",
    // entityLabel() was later split into a more specific visibleDocumentLabel() helper for
    // real-document-numbered text (bill/expense numbers) — either name keeps this honest (plain
    // text, no EntityLink wrap).
    /<EntityLink[\s\S]{0,200}?kind\s*=\s*["']bill["']/.test(s)
      ? false
      : s.includes('{entityLabel(bill.bill_number, bill.id, "Driver bill")}') ||
        s.includes('{visibleDocumentLabel(bill.bill_number, bill.id, "Driver bill")}'),
  ],
].filter(([, ok]) => !ok).map(([name]) => name);
if (process.argv.includes("--selftest")) {
  if (!failures(allocation.replace('kind="bill"', 'kind="broken"')).includes("reallocation source bill drill")) process.exit(1);
  if (
    !failures(
      allocation,
      settlements.replace(
        '{visibleDocumentLabel(bill.bill_number, bill.id, "Driver bill")}',
        '<EntityLink kind="bill" id={bill.id} label={visibleDocumentLabel(bill.bill_number, bill.id, "Driver bill")} />'
      )
    ).includes("open driver bill honest label (never kind=bill)")
  ) {
    console.error("verify-ap-bill-inline-surface-linkage selftest FAIL — planted kind=\"bill\" regression on settlements not caught");
    process.exit(1);
  }
  if (
    !failures(allocation, settlements.replace('{visibleDocumentLabel(bill.bill_number, bill.id, "Driver bill")}', "")).includes(
      "open driver bill honest label (never kind=bill)"
    )
  ) {
    console.error("verify-ap-bill-inline-surface-linkage selftest FAIL — planted dropped-label regression not caught");
    process.exit(1);
  }
  console.log("verify-ap-bill-inline-surface-linkage selftest PASS — source bill + settlements mutations both red");
  process.exit(0);
}
const missing = failures();
if (missing.length) { console.error(`verify-ap-bill-inline-surface-linkage FAIL — ${missing.join(", ")}`); process.exit(1); }
console.log("verify-ap-bill-inline-surface-linkage PASS — allocation drills canonical bills; settlements open-bill stays honest text (never a live-404 bill link)");
