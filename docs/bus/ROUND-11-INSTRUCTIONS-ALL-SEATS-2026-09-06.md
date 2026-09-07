# ROUND 11 — ALL SEATS — issued 2026-09-06 05:4xZ by Claude Lead

Standing law unchanged (measured verdicts · one PR + one named guard `--selftest` in scripts/verify-steps/ (claim first) · DONE line with sha,
guard N/N, measurements, `npm run typecheck` exit code for FE · seats never deploy · never raise a baseline). Design surface: the owner's renders
(docs/design/reference/LOAD-DETAIL-TABS-RENDERS*.html) and `.ldt-*` tokens only — no local `<style>`, no Tailwind card restyling.

Live since 05:0xZ (lead): LDT-PAGE `/accounting/load-costs/:loadId` · LDT-DESIGN-1 (Stops · Driver Pay · Factoring to the renders) · REG-400
(registers paged at the API cap, errors surfaced) · REG-PARSE (Expenses/Bills registers: Description · Receipt no. · Address · Settlement) ·
HUB-MTD-EXPENSES · MD-WIDTH-0 (Vendors/Customers detail pane had 0px width). Owner 05:3xZ on Vendors/Customers: "NOT SHOWING BALANCES, FILTERS
ARE INCORRECT, ALL PAGE SIZE INCORRECT, NO ASCENDING/DESCENDING ORDER".

---

## CURSOR — item VC-LIST-01 · Vendors + Customers lists to standard — deadline 07:30Z
Measured live 05:29Z on /vendors and /customers (USMCA): 619 vendors / 1,235 customers; every OPEN BALANCE $0.00; sort = a single "Sort by
name" select (no column header sort, no asc/desc); page size select 25/50/100/250 (no All); filters = Active/Inactive/All + "All categories"/
"All types" selects whose effect is not visible in the list; STATUS column shows "No history"/"Medium" quality chips, not the vendor status.
Build (both pages, apps/frontend/src/pages/Vendors.tsx + vendors/*, Customers.tsx + customers/*):
1. The list is a ParityTable (sortable headers asc/desc on every column, page-size 25/50/100/250/All, column chooser, export), not the custom
   table. Columns Vendors: Name · Code · Type · Category · Open balance · Spend (MTD) · Spend (YTD) · Last activity · Status(active/inactive).
   Customers: Name · Type · Status · Open A/R · Overdue · Revenue (MTD) · Revenue (YTD) · Last load · Factored? · Credit limit.
2. Balances are REAL: Open balance = unpaid bills (accounting.bills amount − paid, non-void) per vendor; Spend = bills + expenses by vendor
   (expenses.vendor_uuid; GET /api/v1/expenses caps limit at 200 → page or add a server aggregate — prefer one new read endpoint
   `GET /api/v1/mdata/vendor-rollups` already exists: extend it, paste its live row for LOVES: expenses count/total must match Load costs →
   Expenses filtered to LOVES). Customers: Open A/R excludes void + pro forma; Revenue = delivered-load invoices only (pro forma is $0 revenue).
3. Filters actually filter (type, category, status) and the count badges (All/Active/Inactive/By category) recount from the filtered set.
4. Master-detail: the pane opens on row click (lead fixed the 0px width in d4ab9a67 — verify live, aside ≤ 560px, main > 0); keep List view.
5. The 13 failing tests under pages/customers/__tests__ + pages/vendors fail on bare main — make them pass or replace them with tests of the
   new table (never delete a failing test without a replacement asserting the same behavior).
Guard (even lane): `verify-vendors-customers-list-standard` --selftest (ParityTable, sortable headers, real balance source, filters wired).
Paste: LOVES row (open balance, spend MTD/YTD) vs Neon SUM; screenshots list + master-detail.

## CC-1 — item REG-PARSE-DATA · structured fields instead of the composite memo — deadline 07:30Z
The seed wrote `<item> — <address> — inv <n> — <date> — $<amt> (settlement <n>)` into expenses.memo / expense_lines.description (measured on
Neon; lib/expense-memo.ts parses it for display). Make the data right, not the string: (1) migration (claim first; HH 00–11 band):
`accounting.expenses.merchant_address text`, `accounting.expenses.source_settlement_ref text` (additive); (2) backfill through a real service
function (never raw UPDATE): parse memo → vendor_document_number = receipt no. only, line description = item, merchant_address, source_settlement_ref;
memo keeps the original string (WORM); (3) expenses list returns the new fields; the Load costs register reads them first and falls back to the
parser only when they are null. Paste before/after counts (rows with merchant_address, rows with source_settlement_ref, rows still composite).
Guard --selftest with a live half. SOURCE-DOCUMENT-REF (Round 10) continues in the same lane; report both.

## CC-2 — item PAYMENTS-KPI-STRIP · verify-money-kpi-strip-no-fake-zero-on-error red on main — deadline 07:00Z
`scripts/verify-money-kpi-strip-no-fake-zero-on-error.mjs` fails on bare main: "PaymentsListPage.tsx: Amount totals strip not found — did it
move?". Measure PaymentsListPage.tsx (git log -S), restore the totals strip with the error state the guard pins (never edit the guard to pass),
one PR. Then STOPS-APPT-FIX (Round 10) — post dry-run output if not yet posted.

## CC-3 — items DED-DUP · EXP-DATE · CATALOG-PICKER-TEST · FACTORING-GUARDS (Round 10 addenda) — deadline 07:00Z
Unchanged; post status now. Add: EXP-ADDR-ADDRESS-SPLIT — many seed addresses read "66320GALMONT MORRISTOWN RD,OH, OH" (street glued to number,
state doubled); when CC-1's merchant_address exists, normalize on backfill (space after the street number, one state) — coordinate with CC-1,
you own the normalizer + its tests against 20 live samples pasted in the PR.

## CODEX — item TEL-46 (Round 10) — status now; add API-CAPS-AUDIT — deadline 07:30Z
REG-400 root cause was a list endpoint cap (200) below what a page asked for (500), swallowed as an empty table. Audit every FE list call
against its route's z.max: `grep -rn "limit: [0-9]" apps/frontend/src` vs `limit: z.coerce.number().int().min(1).max(N)` in apps/backend/src.
Paste the table (endpoint · FE limit · API cap · status). Fix each mismatch on the FE side (page at the cap) — one PR; guard
`verify-list-limits-within-api-caps` --selftest (static: no FE call exceeds its route's cap).

## CASCADE — ENV-CENSUS-ROOT — if no status by 06:00Z the item moves to CC-3 (unchanged).

---
**Owner decisions still open (lead holds):** bulk-deliver click for the 40 seeded loads; SB rule for the 15 seed tours (no SB legs exist).

---
## 05:5xZ ADDENDA (owner 05:4xZ: "LIST THE LOADS I NEED TO INPUT SO THE SETTLEMENTS CAN CLOSE. THE REST OF THE SETTLEMENTS CLOSE … I WANT TO SEE THEM IN FACTORING, A CODER CREATES ONE PURCHASE, THEN SEED AND CONFIRM WITH FARO'S FILES, KEEP FARO TO RECONCILE TOMORROW")
Measured: only 13556 is a missing USMCA load (USMCA BY LOAD, no settlement #). 12 Laredo-bound loads were seeded trip_type TR, not SB:
13513 13515 13516 13518 13532 13534 13544 13548 13552 13562 13567 13568 — the real reason every tour says "no SB leg".
OWNER RULING (recorded): seed settlements whose signed load set has no Laredo leg (5771 5773 5776 5777 5779 5782 5783 5784 5785 5787) close with
"no SB leg" confirmed by name; live tours keep the hard rule.
- CC-3 PRIORITY: TRIP-TYPE-SB (script, dry-run → lead ✔ → apply) + readout rule (sb_delivered.hard=false only when source_document_ref set and no Laredo leg). Deadline 07:30Z.
- CC-1 PRIORITY: FACT-01 — after the owner's bulk-deliver click: invoices visible in Factoring; ONE real factoring purchase with JE pasted; seed the rest from Faro files (dry-run → ✔ → apply); keep every Faro line. Deadline 08:00Z. SOURCE-DOCUMENT-REF + REG-PARSE-DATA follow.
- CURSOR addendum: vendor master-detail Expenses table uses the parsed columns and pages GET /expenses at 200.
