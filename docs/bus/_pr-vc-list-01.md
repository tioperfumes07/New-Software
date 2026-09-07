FINDING: VC-LIST-01 (owner ROUND 11, measured live 05:29Z on /vendors 619 + /customers 1,235): every OPEN BALANCE $0.00; a single "Sort by name" select (no column asc/desc); page size 25/50/100/250 with no All; type/category/status filters don't visibly filter; STATUS showed quality chips, not active/inactive.

SOURCE-OF-TRUTH: docs/bus/ROUND-11-INSTRUCTIONS-ALL-SEATS-2026-09-06.md § CURSOR.

ROOT CAUSE:
- The Vendors/Customers ParityTable list views existed but did NOT carry the owner-spec columns, and Open balance / Spend were placeholders. The vendor-rollups endpoint only aggregated accounting.expenses (no bills, no MTD, no open balance). "$0.00 open balance" is in fact REAL for expense-only vendors — LOVES has 183 expenses ($67,003.86) and 0 bills, so open balance IS $0 — but there was no real Spend column to show the activity.
- The 12/13 failing tests under pages/{customers,vendors} failed because the pages now call listAllVendors/listAllCustomers + rollup queries the module mocks never exported, so the roster query threw and rendered the error state.

FIX:
- Backend apps/backend/src/mdata/vendor-rollups.routes.ts: extend the aggregate to a bills+expenses FULL OUTER JOIN (expenses.vendor_uuid::text unified with COALESCE(bills.vendor_uuid, bills.vendor_id)). Adds spend_total_cents, spend_ytd_cents, spend_mtd_cents, last_activity_date, open_balance_cents (unpaid non-void bills: voided_at IS NULL AND status <> 'paid'). Backward-compatible: purchases_* / last_purchase_date / expense_count keep their expenses-only meaning.
- Vendors list (VendorsListView.tsx): owner-spec visible columns Name · Code · Type · Category · Open balance · Spend (MTD) · Spend (YTD) · Last activity · Status(active/inactive). Real Spend from the rollup. Pre-existing extras kept but default-hidden (§7 never-delete). exportFilename wired.
- Customers list (Customers.tsx + CustomersListView.tsx): owner-spec columns Name · Type · Status · Open A/R · Overdue · Revenue (MTD) · Revenue (YTD) · Last load · Factored? · Credit limit. Revenue (MTD) reuses the customer-profitability endpoint scoped to the current month (no new backend). Open A/R = invoice-based (ar_aging_balance_cents excludes void + pro forma). Factored? = credit_limit_source='factor'. Credit limit from the record.
- Tests: updated the stale module mocks (listAllVendors/listAllCustomers + getVendorRollups/listVendorPaymentMethods/listAllAtRiskCustomerRelationshipScores/getCustomerProfitability), made the vendor tabs mock status-aware, and refreshed one stale active-tab class assertion to the current navy sub-nav aria-current. 15/15 pass.

GUARD: scripts/verify-vendors-customers-list-standard.mjs (--selftest 10/10), wired at verify-step 10462 (Cursor even lane; claimed on main PR #20920 / cf12ee3f). Asserts both lists are ParityTable (no raw <table>), the owner-spec columns exist, Spend/A-R read the real rollup fields, and the rollup aggregates bills+expenses with open balance excluding void+paid.

LIVE PROOF (Neon br-fancy-credit-akjnd07a, bypass_rls=lucia, USMCA 5c854333):
- LOVES (5a529e97): 183 expenses = $67,003.86, 0 bills → the extended aggregate returns purchases_ytd $67,003.86, spend_ytd $67,003.86, spend_mtd $6,336.80, last_activity 2026-09-27, open_balance $0.00. The endpoint SQL is identical to the measured aggregate.
- Customers: USMCA invoices = 47 pro forma (from_load) + 29 void, 0 finalized → invoice-based Open A/R and invoice revenue are legitimately $0 per the owner rule (pro forma = $0). Booked revenue (loads) remains in Revenue (YTD).

DOD: schema unchanged (read-only aggregate); endpoint returns real USMCA rows on operating_company_id predicate; FE reads spend_*/ar_open_cents/revenue_mtd_cents; both-way linkage via vendor_uuid/customer_id; guard runs in CI (verify-step 10462); typecheck exit 0 (frontend tsc -b + backend tsc).

MODULE_PROGRESS: Customers/Vendors — lists to standard.

REMAINING: live screenshots (list + master-detail) to be captured on the deployed FE after the post-merge deploy.
