// ENV-CENSUS-ROOT — the root fix (lead, 2026-09-06). Cascade's #20892 exempted 105 orphan guards in one sweep (14 of them
// failing) — that is the census raised by another name, reverted in #20932. This ONE claimed step RUNS every guard that a
// seat merged without CI wiring, so verify:guard-wired reports 0 orphan and any guard that fails is NAMED in CI instead of
// hidden. Every guard runs; failures are aggregated and reported together (not first-failure-only). A guard that fails
// here is a real open defect or a stale pin — fix the code or re-pin the guard to the owner's ruling; never remove a name
// from this list to make CI green. New guards get their own claimed step (claim-before-write) — this list is the backlog.
import { spawnSync } from "node:child_process";

export const CENSUS_ORPHAN_GUARDS = [
  "verify-deductions-listed-by-driver.mjs",
  "verify-driver-equipment-tab-columns.mjs",
  "verify-in-shop-units-single-predicate.mjs",
  "verify-banking-plaid-category-suggestion.mjs",
  "verify-banking-reconcile-expense-candidate.mjs",
  "verify-bill-payments-void-biconditional.mjs",
  "verify-bills-union-driver-bills.mjs",
  "verify-book-and-send-distributes-instructions.mjs",
  "verify-book-load-captures-border-crossing.mjs",
  "verify-book-load-footer-save-controls.mjs",
  "verify-box1-tax-year-uses-issued-date.mjs",
  "verify-broker-advance-never-driver-liability-never-invoice-face.mjs",
  "verify-cancellation-voids-expenses-and-advances.mjs",
  "verify-cash-advance-reversal-guard-fires.mjs",
  "verify-cash-flow-independent-of-proforma-timing.mjs",
  "verify-cash-flow-statement-live.mjs",
  "verify-catalog-lists-voided-toggle.mjs",
  "verify-cc3-ddl-handoff-retention-leave-safety.mjs",
  "verify-company-settlements-readmodel.mjs",
  "verify-counterparty-landing-polish.mjs",
  "verify-counterparty-rollups-live.mjs",
  "verify-counterparty-side-search.mjs",
  "verify-counterparty-statements-foot-to-gl.mjs",
  "verify-counterparty-transactions-tab.mjs",
  "verify-customer-activity-statements.mjs",
  "verify-deadhead-pay-line-renders-on-settlement.mjs",
  "verify-dispatch-awaiting-unit-number-visible.mjs",
  "verify-dispatch-board-column-reorder.mjs",
  "verify-dispatch-board-default-columns-fit.mjs",
  "verify-dispatch-board-view-row.mjs",
  "verify-dispatch-breadcrumb-trip-pairing-round-trips.mjs",
  "verify-dispatch-empty-cell-dash.mjs",
  "verify-dispatch-home-tab-label.mjs",
  "verify-dispatch-in-shop-feed-wired.mjs",
  "verify-dispatch-invalid-transition-reason.mjs",
  "verify-dispatch-kanban-collapsed-lane-expander.mjs",
  "verify-dispatch-kanban-column-resize.mjs",
  "verify-dispatch-kanban-derived-lane-labeled.mjs",
  "verify-dispatch-kanban-no-unassigned-word.mjs",
  "verify-dispatch-kpi-centered-light.mjs",
  "verify-dispatch-no-navy-table-header.mjs",
  "verify-dispatch-oos-strip-archived.mjs",
  "verify-dispatch-overview-view-all-lands-on-list.mjs",
  "verify-dispatch-table-view-distinct.mjs",
  "verify-driver-bill-entitylink-never-routes-to-accounting-bills.mjs",
  "verify-driver-bill-linked-to-settlement-at-creation.mjs",
  "verify-driver-bill-number-no-b-prefix.mjs",
  "verify-driver-bills-in-bills-page.mjs",
  "verify-driver-bills-void-cascade-stamps-register.mjs",
  "verify-driver-instruction-sheet-no-pay.mjs",
  "verify-driver-liability-void-route-wired.mjs",
  "verify-driver-load-history.mjs",
  "verify-driver-profile-deductions-escrow-wired.mjs",
  "verify-driver-safety-dispatch-linkage.mjs",
  "verify-drv14-dqf-report.mjs",
  "verify-duplicate-masters-report.mjs",
  "verify-edit-load-assigned-driver-not-draft.mjs",
  "verify-edit-load-prefill-reset-once.mjs",
  "verify-escrow-balance-reconciles-gl.mjs",
  "verify-fleet-oos-columns-manifest.mjs",
  "verify-fleet-table-strict-null-contract.mjs",
  "verify-geofence-carries-samsara-source-id.mjs",
  "verify-glb08-mmm-dd-sweep.mjs",
  "verify-invoices-factored-column.mjs",
  "verify-k5-planner-calendar-mmm-dd.mjs",
  "verify-k6-planner-active-drivers-only.mjs",
  "verify-k7-planner-ranges.mjs",
  "verify-k9-landing-filter-bar.mjs",
  "verify-ldt-4-factoring-money.mjs",
  "verify-lfi11-invoice-search.mjs",
  "verify-liability-balance-syncs-at-settlement-close.mjs",
  "verify-lists-reports-design-law.mjs",
  "verify-lists-reports-sort-law.mjs",
  "verify-load-costs-board-manifest.mjs",
  "verify-load-costs-board-no-truncation-no-wrap.mjs",
  "verify-load-costs-board-tabs.mjs",
  "verify-load-costs-drawer-wide.mjs",
  "verify-load-costs-loaded-miles-not-gated-on-basis-type.mjs",
  "verify-load-costs-tab-manifest.mjs",
  "verify-load-costs-tab-registers.mjs",
  "verify-locations-list.mjs",
  "verify-no-duplicate-seed-deductions.mjs",
  "verify-no-future-dated-seed-expenses.mjs",
  "verify-no-geofence-around-unresolved-point.mjs",
  "verify-no-nul-bytes-in-source.mjs",
  "verify-parity-table-header-one-row.mjs",
  "verify-planner-active-drivers-only.mjs",
  "verify-planner-column-lines.mjs",
  "verify-planner-range-options.mjs",
  "verify-planners-list-views.mjs",
  "verify-planners-lists-parity.mjs",
  "verify-quarantine-usmca-wrong-entity-loads.mjs",
  "verify-report-export-parity.mjs",
  "verify-report-landing-filter-bar.mjs",
  "verify-reports-dash-never-zero.mjs",
  "verify-round-trips-deep-link-timeline-and-empty-copy.mjs",
  "verify-roundtrips-timeline-restored.mjs",
  "verify-samsara-import-idempotent.mjs",
  "verify-samsara-roster-status-filter.mjs",
  "verify-samsara-usmca-retag-migration.mjs",
  "verify-settlement-accrual-and-deadhead.mjs",
  "verify-settlement-deduction-void-branches.mjs",
  "verify-settlement-detail-kpi-grid.mjs",
  "verify-settlement-detail-readmodel-s1b.mjs",
  "verify-settlement-detail-sections.mjs",
  "verify-settlement-lines-driver-bill-miles-rate-join.mjs",
  "verify-settlement-lines-miles-rate-live.mjs",
  "verify-settlement-reversal-voids-settlement-lines.mjs",
  "verify-settlement-seed-cc-3.mjs",
  "verify-settlement-seed-codex.mjs",
  "verify-table-design-contract.mjs",
  "verify-trailer-lists-exclude-interchange.mjs",
  "verify-unit-picker-excludes-archived-deactivated.mjs",
  "verify-usmca-no-active-test-vendors.mjs",
];

export default {
  name: "verify:census-orphans-wired",
  run() {
    const failed = [];
    for (const guard of CENSUS_ORPHAN_GUARDS) {
      const r = spawnSync(process.execPath, [`scripts/${guard}`], { encoding: "utf8", timeout: 180_000 });
      if (r.status !== 0) {
        const tail = `${r.stdout ?? ""}\n${r.stderr ?? ""}`.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("at ") && !l.includes("node:internal")).slice(-2).join(" | ");
        failed.push(`${guard} :: ${tail.slice(0, 220)}`);
      }
    }
    if (failed.length) {
      console.error(`verify:census-orphans-wired — ${failed.length}/${CENSUS_ORPHAN_GUARDS.length} guards FAIL:`);
      for (const f of failed) console.error(`  ✗ ${f}`);
      throw new Error(`verify:census-orphans-wired — ${failed.length} of ${CENSUS_ORPHAN_GUARDS.length} census guards fail (named above)`);
    }
    console.log(`verify:census-orphans-wired PASS — ${CENSUS_ORPHAN_GUARDS.length}/${CENSUS_ORPHAN_GUARDS.length} previously-orphan guards run in CI and pass`);
  },
};
