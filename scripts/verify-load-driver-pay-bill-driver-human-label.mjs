#!/usr/bin/env node
/**
 * DISPATCH-DRIVER-PAY-BILL-DRIVER-HUMAN-LABEL-MISSING — the mounted Load Driver Pay tab reads
 * driver_id from a driver-finance route, but the producer's `SELECT *` had no join to
 * mdata.drivers, so no driver_name ever reached the payload and the driver EntityLink rendered a
 * hardcoded generic "Driver" label instead of the driver's real name. Fixed with the SAME
 * same-company LEFT JOIN pattern the sibling /driver-finance/driver-bills/open route already used.
 *
 * LDT-3 (owner item, 2026-09-05, deadline 06:00Z) later replaced the whole tab's read model with a
 * dedicated GET /api/v1/driver-finance/loads/:loadId/driver-pay-detail endpoint (a real
 * math-correctness fix — SET-RATE law, "miles × rate ≠ amount" impossible by construction — not a
 * driver-label regression). The driver_name join/select this guard originally locked was carried
 * forward faithfully into the new route's own bill query; the frontend type also carries it, just
 * renamed DriverBillRow -> DriverPayDetail and moved driver_name to the type's top level (it was
 * always destructured off `data`, not `bill`, at the render site) rather than nested under `bill`.
 *
 * Locks: (1) the driver-pay-detail route's bill query joins mdata.drivers same-company and selects
 * driver_name, (2) the frontend DriverPayDetail type carries driver_name, (3) the driver
 * EntityLink's label is resolved via entityLabel(driver_name, driver_id, "Driver"), never a
 * hardcoded string.
 *
 * Run: node scripts/verify-load-driver-pay-bill-driver-human-label.mjs [--selftest]
 */
import { readFileSync } from "node:fs";

const routePath = "apps/backend/src/driver-finance/driver-bills.routes.ts";
const componentPath = "apps/frontend/src/components/dispatch/LoadDetailDriverPayTab.tsx";

const routeSrc = readFileSync(routePath, "utf8");
const componentSrc = readFileSync(componentPath, "utf8");

function analyze(routeSrc, componentSrc) {
  const failures = [];

  // Scope to the driver-pay-detail route's OWN bill query (the one LoadDetailDriverPayTab.tsx
  // actually calls) rather than the whole file, so a regression in a sibling route's join (a
  // different, already-correct query) isn't conflated.
  const detailRouteStart = routeSrc.indexOf('"/api/v1/driver-finance/loads/:loadId/driver-pay-detail"');
  const billQueryStart = detailRouteStart === -1 ? -1 : routeSrc.indexOf("FROM driver_finance.driver_bills db", detailRouteStart);
  const billQuerySection = billQueryStart === -1 ? "" : routeSrc.slice(Math.max(0, billQueryStart - 400), billQueryStart + 400);

  if (detailRouteStart === -1) {
    failures.push(`${routePath}: GET .../driver-pay-detail route not found — has the tab's read model moved again?`);
  }
  if (!/LEFT JOIN mdata\.drivers d ON d\.id = db\.driver_id AND d\.operating_company_id = db\.operating_company_id/.test(billQuerySection)) {
    failures.push(`${routePath}: driver-pay-detail's bill query no longer LEFT JOINs mdata.drivers same-company`);
  }
  if (!/concat_ws\(' ', d\.first_name, d\.last_name\) AS driver_name/.test(billQuerySection)) {
    failures.push(`${routePath}: driver-pay-detail's bill query no longer selects driver_name`);
  }
  // The resolved driver_name must actually reach the JSON payload, not just the intermediate row.
  if (!/driver_name:\s*bill\?\.driver_name\s*\?\?\s*null/.test(routeSrc.slice(detailRouteStart === -1 ? 0 : detailRouteStart))) {
    failures.push(`${routePath}: driver-pay-detail's response payload no longer forwards driver_name`);
  }

  if (!/driver_name:\s*string \| null;/.test(componentSrc)) {
    failures.push(`${componentPath}: DriverPayDetail no longer declares driver_name`);
  }
  if (!/label=\{entityLabel\(driver_name, driver_id, "Driver"\)\}/.test(componentSrc)) {
    failures.push(`${componentPath}: driver EntityLink no longer resolves its label via entityLabel(driver_name, ...) — may have reverted to a hardcoded "Driver" string`);
  }
  if (/label="Driver"/.test(componentSrc)) {
    failures.push(`${componentPath}: found a hardcoded label="Driver" — the generic-label regression this finding is about`);
  }

  return failures;
}

function selftest() {
  const good = analyze(routeSrc, componentSrc);
  if (good.length > 0) {
    console.error("verify-load-driver-pay-bill-driver-human-label --selftest: FAIL on the real (good) files");
    for (const f of good) console.error(`  - ${f}`);
    process.exit(1);
  }

  // Mutation 1: revert the backend join (simulate a SELECT * with no join) on the driver-pay-detail
  // route's own bill query specifically (not the sibling /open route's identical-looking one).
  const mutatedRoute = routeSrc.replace(
    /SELECT db\.id::text, db\.bill_number, db\.status, db\.driver_id::text,\s*\n\s*concat_ws\('\s',\s*d\.first_name,\s*d\.last_name\) AS driver_name,/,
    "SELECT db.id::text, db.bill_number, db.status, db.driver_id::text,"
  );
  if (mutatedRoute === routeSrc) {
    console.error("verify-load-driver-pay-bill-driver-human-label --selftest: mutation 1 setup failed — anchor not found");
    process.exit(1);
  }
  const failures1 = analyze(mutatedRoute, componentSrc);
  if (failures1.length === 0) {
    console.error("verify-load-driver-pay-bill-driver-human-label --selftest: mutation 1 (drop backend join) was not caught");
    process.exit(1);
  }

  // Mutation 2: revert the frontend label back to a hardcoded string.
  const mutatedComponent = componentSrc.replace(
    'label={entityLabel(driver_name, driver_id, "Driver")}',
    'label="Driver"'
  );
  if (mutatedComponent === componentSrc) {
    console.error("verify-load-driver-pay-bill-driver-human-label --selftest: mutation 2 setup failed — anchor not found");
    process.exit(1);
  }
  const failures2 = analyze(routeSrc, mutatedComponent);
  if (failures2.length === 0) {
    console.error("verify-load-driver-pay-bill-driver-human-label --selftest: mutation 2 (revert to hardcoded label) was not caught");
    process.exit(1);
  }

  // Mutation 3: the response payload stops forwarding driver_name even though the query still
  // resolves it (a real, distinct failure mode from mutation 1).
  const mutatedRoute3 = routeSrc.replace("driver_name: bill?.driver_name ?? null,", "driver_name: null,");
  if (mutatedRoute3 === routeSrc) {
    console.error("verify-load-driver-pay-bill-driver-human-label --selftest: mutation 3 setup failed — anchor not found");
    process.exit(1);
  }
  const failures3 = analyze(mutatedRoute3, componentSrc);
  if (failures3.length === 0) {
    console.error("verify-load-driver-pay-bill-driver-human-label --selftest: mutation 3 (payload drops driver_name) was not caught");
    process.exit(1);
  }

  console.log("verify-load-driver-pay-bill-driver-human-label --selftest: OK (good files clean, all 3 targeted mutations caught)");
}

if (process.argv.includes("--selftest")) {
  selftest();
} else {
  const failures = analyze(routeSrc, componentSrc);
  if (failures.length > 0) {
    console.error("verify-load-driver-pay-bill-driver-human-label: FAIL");
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log("verify-load-driver-pay-bill-driver-human-label: OK — driver-pay-detail's bill query joins mdata.drivers same-company, driver_name typed and resolved via entityLabel");
}
