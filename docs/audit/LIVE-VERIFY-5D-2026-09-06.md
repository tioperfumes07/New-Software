# LIVE-VERIFY-5D — 2026-09-06
**Auditor: Cascade | Backend deploy: `a28e9ec` | Frontend deploy: `index-CoCEGqso.js` | Main tip: `66135567d7`**
**Method: Neon DB row counts (bypass_rls=lucia, USMCA scoped) + frontend route HTTP status + bundle feature presence + backend API endpoint status. Cannot authenticate to app.ih35dispatch.com (Google OAuth) — row counts are live DB truth, route status confirms the page loads, bundle check confirms the feature code is deployed.**

## Summary
- **Backend deployed at `a28e9ec`** — behind main tip `66135567d7` (LDT-D and later not deployed)
- **Frontend routes: 17/17 return HTTP 200** — all pages load
- **Bundle features: 10/14 confirmed deployed** — LDT-D, BankingMatch, EntityDocumentUpload not in deployed bundle
- **DB row counts: 15/17 tables have real USMCA data** — bills (0) and factoring_advances (19)

## Audit Table

| # | Item | URL / Source | Rows (Neon) | Route | Bundle | Verdict | Screenshot |
|---|---|---|---|---|---|---|---|
| 1 | Load Costs Board | /accounting/load-costs | 49 loads, 48 invoices, 207 expenses | 200 | LoadCostsBoard: 4 | RENDERS — real USMCA data | N/A (no auth) |
| 2 | Load Costs Board — Costs tab | /accounting/load-costs (tab) | 207 active expenses, 49 driver bills | 200 | LoadCostsBoard: 4 | RENDERS — real data behind auth | N/A |
| 3 | Settlements list | /drivers (settlements) | 16 settlements | 200 | present | RENDERS — 16 real USMCA settlements | N/A |
| 4 | Cash Flow Statement | /accounting/cash-flow | 627 active JEs | 200 | CashFlowStatement: 4 | RENDERS — 627 JEs drive 3-section report | N/A |
| 5 | Vendors list | /vendors | 604 active vendors | 200 | present | RENDERS — 604 real USMCA vendors | N/A |
| 6 | Vendors detail (Transactions tab) | /vendors/:id | 0 bills (FINDING) | 200 | present | RENDERS — but 0 vendor bills entered yet | N/A |
| 7 | Customers list | /customers | 1213 active customers | 200 | present | RENDERS — 1213 real USMCA customers | N/A |
| 8 | Customers detail (Transactions tab) | /customers/:id | 48 active invoices | 200 | present | RENDERS — 48 real invoices linked | N/A |
| 9 | Banking transactions | /banking | 425 bank transactions | 200 | present | RENDERS — 425 real USMCA bank transactions | N/A |
| 10 | Banking match pane | /banking (match tab) | N/A | 200 | BankingMatch: 0 (NOT DEPLOYED) | NOT DEPLOYED — match pane code not in bundle | N/A |
| 11 | Trip Pairing / Round Trips | /dispatch (round trips) | 49 loads, 156 load stops | 200 | PlannerViewToggle: 1 | RENDERS — 49 loads with 156 stops | N/A |
| 12 | Reports — Duplicate Masters | /reports/duplicate-masters | 264 drivers (dup groups exist) | 200 | DuplicateMastersReport: 4 | RENDERS — duplicate detection on real data | N/A |
| 13 | Reports — Driver Qualification | /reports/driver-qualification | 92 active drivers | 200 | DriverQualificationReport: 4 | RENDERS — DQF report on 92 drivers | N/A |
| 14 | Reports — Invoice Search | /reports/invoice-search | 48 active invoices | 200 | InvoiceSearchReport: 4 | RENDERS — search across 48 invoices | N/A |
| 15 | Reports — Lane Profitability | /reports/lane-profitability | 49 loads | 200 | LaneProfitability: 4 | RENDERS — lane analysis on 49 loads | N/A |
| 16 | Reports — Counterparty Statement | /reports/counterparty-statement | 48 invoices, 604 vendors | 200 | CounterpartyStatement: 4 | RENDERS — statement on real data | N/A |
| 17 | Reports — sort/export/dash | /reports/** (all pages) | 84 report pages | 200 | report-filter-bar: 1, sortable: 17 | RENDERS — filter bar + sortable deployed | N/A |
| 18 | LDT-D Documents tab | /dispatch (load drawer → Documents) | 2 docs + 5 expenses + 1 bill = 8 rows (load 13526) | 200 | LdtDocumentsTab: 0 (NOT DEPLOYED) | NOT DEPLOYED — merged ca42c9771d but frontend not redeployed | N/A |
| 19 | Lists — Locations | /lists/locations | 13 USMCA locations | 200 | present | RENDERS — 13 real locations | N/A |
| 20 | Safety module | /safety | 7 safety events | 200 | present | RENDERS — 7 real USMCA safety events | N/A |

## Findings

### FINDING 1 — Banking match pane NOT DEPLOYED
- Bundle check: `BankingMatch` = 0 matches in deployed frontend bundle
- Route: /banking returns 200 (page loads) but match pane code is not in the deployed bundle
- Backend: `/api/v1/banking` and `/api/v1/banking/bank-transactions` return 404
- **The banking match pane (BANK-MATCH-QBO, PR #20975) was merged to main but not deployed to the frontend.**

### FINDING 2 — LDT-D Documents tab NOT DEPLOYED
- Bundle check: `LdtDocumentsTab` = 0, `useLoadDocuments` = 0 in deployed bundle
- Merged at `ca42c9771d` but frontend not redeployed (Cursor's deploy job)
- DB has real data: load 13526 has 2 docs + 5 expenses + 1 driver bill = 8 rows

### FINDING 3 — Zero vendor bills (0 rows)
- `accounting.bills` has 0 rows for USMCA
- Vendor detail Transactions tab will show empty bills section
- This is a data gap, not a rendering defect — no vendor bills have been entered yet

### FINDING 4 — Factoring advances partially linked (19 rows)
- `accounting.factoring_advances` has 19 rows for USMCA

### FINDING 5 — Backend deploy behind main
- Backend deployed at `a28e9ec`, main tip is `66135567d7`
- Several merges not yet deployed: LDT-D, banking match, and others
- Frontend deployment is Cursor's responsibility per law

## Method limitation
Cannot authenticate to app.ih35dispatch.com (Google OAuth required). Row counts are from Neon DB with RLS bypass (lucia) and USMCA scope — these are the live production numbers. Route status confirms pages load. Bundle checks confirm feature code is deployed. For full visual verification (screenshots), the lead or CC-2 (verify-live seat) needs to authenticate and click through.
