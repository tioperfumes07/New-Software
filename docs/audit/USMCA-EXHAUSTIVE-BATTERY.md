# USMCA EXHAUSTIVE TRANSACTION BATTERY — surface → created → registered → gap

> **GENERATED — do not hand-edit.** Produced by `scripts/gen-usmca-battery-doc.mjs` from
> `scripts/usmca-create-surface-inventory.mjs`, which reads the route files themselves. The list
> therefore cannot drift from what the server actually serves.

**Entity: USMCA `5c854333-6ea5-4faa-af31-67cb272fef80`** (`USMCA Freight Solutions Inc`, operating_carrier, active — verified on the prod branch).

## Scope and counts

| bucket | n | meaning |
|---|---:|---|
| **create** (collection POST) | 287 | `POST /api/v1/mdata/customers` — creates a top-level record |
| **nested create** (child POST) | 216 | `POST /…/loads/:id/stops` — needs its parent to exist first, so it is ordered after it |
| action (NOT a create) | 200 | `/:id/approve`, `/scan` — operates on an existing row |
| infra (NOT a surface) | 68 | auth, webhooks, feature flags, integrations plumbing |
| **TOTAL POST endpoints** | 771 | |
| UI files with `+ Create`/`+ Book` | 163 | product vocabulary is locked to those two labels, which is what makes the UI side greppable |

Counting the 200 actions as create-surfaces would inflate the denominator and make the coverage
report a lie, so every endpoint lands in exactly one bucket and nothing is silently dropped.

## ⚠ TEST-DATA TAGGING — the requested mechanism does not exist

The directive says to tag every created row `is_test_data=true` / `is_sample`. **Verified against the
prod branch: `is_test_data` exists on exactly THREE objects — `audit.scenario_status`,
`audit.v_scenario_status_current`, `driver_finance.driver_pay_rates` — and `is_sample` does not exist
anywhere.** No transaction table (loads, invoices, bills, work_orders, claims, settlements…) has
either column, so the tag cannot be written as specified without a migration across dozens of tables.

**Substitute, matching existing precedent on prod** (`USMCA-TEST-BILL-05`, `CC3-VOIDTEST-20260807-01`,
`TEST-BILL-0806-A` are all real rows created this way):

1. every row created by this battery carries the marker **`CC2-BATTERY-20260807`** in its
   human-readable identifier (bill_number / load_number / reference / name), and
2. every created row's **UUID is recorded in the manifest below**, so the whole set is isolatable and
   voidable by id, not by guessing at a naming convention.

That satisfies the stated intent — *isolatable and voidable before Monday* — which the literal
column cannot. Flagged rather than silently substituted.

## Dependency order (creation follows this, not the table order)

1. **masters / catalogs** — customer, vendor, account, item, catalog rows
2. **operational** — load → assign USMCA driver + USMCA-leased unit → dispatch → deliver → POD/BOL
3. **money** — invoice/AR, bill/AP, expense, fuel, settlement, advance, deduction, escrow, WO, factoring, claim, fine, bank txn + match, transfer, lease

A missing account is CREATED (additive, entity-scoped, sensible default, `qbo_map` null) rather than
blocking the wire — per the owner's standing instruction.

## Coverage matrix

`created` / `registered` are filled by the battery run. `registered` means the record produced its
expected downstream effect (balanced JE, both-way link) — that is CC-3's verification, handed over
after creation; a GL/posting failure goes to CC-1.

### safety — 65 create-surface(s)

| kind | endpoint | route file | created | registered | gap |
|---|---|---|---|---|---|
| create | `/api/safety/anomaly/evaluate` | `apps/backend/src/safety/anomaly/routes.ts:142` | — | — | — |
| create | `/api/safety/anomaly/rules` | `apps/backend/src/safety/anomaly/routes.ts:30` | — | — | — |
| create | `/api/safety/anomaly/seed-defaults` | `apps/backend/src/safety/anomaly/routes.ts:131` | — | — | — |
| nested | `/api/safety/damage-reports/:uuid/photos` | `apps/backend/src/safety/damage-reports/photo-evidence.routes.ts:42` | — | — | — |
| create | `/api/safety/drug-alcohol/enrollments` | `apps/backend/src/safety/drug-alcohol/routes.ts:101` | — | — | — |
| create | `/api/safety/drug-alcohol/enrollments/bulk-active` | `apps/backend/src/safety/drug-alcohol/routes.ts:131` | — | — | — |
| create | `/api/safety/drug-alcohol/random-pool/draw` | `apps/backend/src/safety/drug-alcohol/routes.ts:303` | — | — | — |
| create | `/api/safety/drug-alcohol/tests` | `apps/backend/src/safety/drug-alcohol/routes.ts:198` | — | — | — |
| nested | `/api/safety/drug-alcohol/tests/:uuid/flag-positive` | `apps/backend/src/safety/drug-alcohol/routes.ts:262` | — | — | — |
| nested | `/api/safety/photo-comparison/:session_uuid/post-trip` | `apps/backend/src/safety/photo-comparison/routes.ts:160` | — | — | — |
| create | `/api/safety/photo-comparison/evidence` | `apps/backend/src/safety/photo-comparison/routes.ts:94` | — | — | — |
| create | `/api/safety/photo-comparison/pre-trip` | `apps/backend/src/safety/photo-comparison/routes.ts:128` | — | — | — |
| create | `/api/v1/safety/accidents` | `apps/backend/src/safety/safety.routes.ts:510` | — | — | — |
| nested | `/api/v1/safety/accidents/:id/photos` | `apps/backend/src/safety/safety.routes.ts:786` | — | — | — |
| nested | `/api/v1/safety/accidents/:id/spawn-liability` | `apps/backend/src/safety/safety.routes.ts:822` | — | — | — |
| nested | `/api/v1/safety/accidents/:id/spawn-wo` | `apps/backend/src/safety/safety.routes.ts:1013` | — | — | — |
| create | `/api/v1/safety/background-checks` | `apps/backend/src/safety/background-checks.routes.ts:43` | — | — | — |
| create | `/api/v1/safety/company-violations` | `apps/backend/src/safety/company-violations.routes.ts:170` | — | — | — |
| nested | `/api/v1/safety/company-violations/:id/complete-corrective-action` | `apps/backend/src/safety/company-violations.routes.ts:406` | — | — | — |
| nested | `/api/v1/safety/company-violations/:id/generate-audit-export` | `apps/backend/src/safety/company-violations.routes.ts:376` | — | — | — |
| create | `/api/v1/safety/complaints` | `apps/backend/src/routes/safety/complaints.ts:154` | — | — | — |
| create | `/api/v1/safety/csa-scores/compute` | `apps/backend/src/routes/safety/csa-scores.ts:179` | — | — | — |
| create | `/api/v1/safety/csa-scores/pull-from-safer` | `apps/backend/src/routes/safety/csa-scores.ts:191` | — | — | — |
| nested | `/api/v1/safety/dot-inspection-events/:id/follow-up` | `apps/backend/src/safety/dot-inspection-events.routes.ts:101` | — | — | — |
| create | `/api/v1/safety/dot-inspections` | `apps/backend/src/routes/safety/dot-inspections.ts:176` | — | — | — |
| nested | `/api/v1/safety/dot-inspections/:id/upload-pdf` | `apps/backend/src/routes/safety/dot-inspections.ts:308` | — | — | — |
| create | `/api/v1/safety/driver-documents` | `apps/backend/src/safety/driver-documents.routes.ts:51` | — | — | — |
| create | `/api/v1/safety/driver-qualification/items` | `apps/backend/src/safety/driver-qualification.routes.ts:121` | — | — | — |
| create | `/api/v1/safety/drug-pool/selections` | `apps/backend/src/safety/drug-pool.routes.ts:52` | — | — | — |
| create | `/api/v1/safety/drug-program/clearinghouse-queries` | `apps/backend/src/safety/drug-program.routes.ts:409` | — | — | — |
| create | `/api/v1/safety/drug-program/random-pools` | `apps/backend/src/safety/drug-program.routes.ts:329` | — | — | — |
| create | `/api/v1/safety/drug-program/tests` | `apps/backend/src/safety/drug-program.routes.ts:144` | — | — | — |
| create | `/api/v1/safety/dvir` | `apps/backend/src/safety/dvir.routes.ts:173` | — | — | — |
| create | `/api/v1/safety/events-log` | `apps/backend/src/safety/events/safety-events.routes.ts:276` | — | — | — |
| create | `/api/v1/safety/fines` | `apps/backend/src/safety/fines.routes.ts:194` | — | — | — |
| nested | `/api/v1/safety/fines/:id/contest` | `apps/backend/src/safety/fines.routes.ts:481` | — | — | — |
| nested | `/api/v1/safety/fines/:id/convert-to-liability` | `apps/backend/src/safety/fines.routes.ts:319` | — | — | — |
| nested | `/api/v1/safety/fines/:id/dismiss` | `apps/backend/src/safety/fines.routes.ts:512` | — | — | — |
| nested | `/api/v1/safety/fines/:id/link-payment` | `apps/backend/src/safety/fines.routes.ts:634` | — | — | — |
| nested | `/api/v1/safety/fines/:id/reduce` | `apps/backend/src/safety/fines.routes.ts:543` | — | — | — |
| create | `/api/v1/safety/hos-violations` | `apps/backend/src/routes/safety/hos-violations.ts:131` | — | — | — |
| create | `/api/v1/safety/hos/exceptions` | `apps/backend/src/safety/hos.routes.ts:34` | — | — | — |
| create | `/api/v1/safety/incidents` | `apps/backend/src/safety/incidents.routes.ts:284` | — | — | — |
| nested | `/api/v1/safety/incidents/:id/auto-create-claim` | `apps/backend/src/safety/damage-continuity/continuity.routes.ts:171` | — | — | — |
| nested | `/api/v1/safety/incidents/:id/photos` | `apps/backend/src/safety/incidents.routes.ts:436` | — | — | — |
| nested | `/api/v1/safety/incidents/:id/start-continuity` | `apps/backend/src/safety/damage-continuity/continuity.routes.ts:57` | — | — | — |
| nested | `/api/v1/safety/incidents/:id/status` | `apps/backend/src/safety/incidents.routes.ts:567` | — | — | — |
| create | `/api/v1/safety/incidents/full-report` | `apps/backend/src/safety/incidents/full-report.routes.ts:51` | — | — | — |
| create | `/api/v1/safety/integrity-alert-rules` | `apps/backend/src/safety/integrity-alerts.routes.ts:162` | — | — | — |
| create | `/api/v1/safety/integrity-alerts` | `apps/backend/src/safety/integrity-alerts.routes.ts:422` | — | — | — |
| nested | `/api/v1/safety/integrity-alerts/:id/snooze` | `apps/backend/src/safety/integrity-alerts.routes.ts:366` | — | — | — |
| create | `/api/v1/safety/integrity-alerts/evaluate` | `apps/backend/src/safety/integrity-alerts.routes.ts:245` | — | — | — |
| create | `/api/v1/safety/internal-fines` | `apps/backend/src/safety/safety-v5.routes.ts:217` | — | — | — |
| create | `/api/v1/safety/medical-cards` | `apps/backend/src/safety/medical-cards.routes.ts:118` | — | — | — |
| create | `/api/v1/safety/onboarding/sessions` | `apps/backend/src/safety/onboarding.routes.ts:79` | — | — | — |
| nested | `/api/v1/safety/onboarding/sessions/:session_id/admin-override` | `apps/backend/src/safety/onboarding.routes.ts:236` | — | — | — |
| create | `/api/v1/safety/permits` | `apps/backend/src/safety/permits.routes.ts:249` | — | — | — |
| create | `/api/v1/safety/rtd/cases` | `apps/backend/src/safety/rtd.routes.ts:267` | — | — | — |
| nested | `/api/v1/safety/rtd/cases/:id/advance` | `apps/backend/src/safety/rtd.routes.ts:361` | — | — | — |
| nested | `/api/v1/safety/scheduler/requests/:id/assign-cover` | `apps/backend/src/safety/driver-scheduler.routes.ts:287` | — | — | — |
| create | `/api/v1/safety/scheduler/temp-assignments` | `apps/backend/src/safety/driver-scheduler.routes.ts:389` | — | — | — |
| create | `/api/v1/safety/training-programs` | `apps/backend/src/safety/training-programs.routes.ts:34` | — | — | — |
| create | `/api/v1/safety/training-records` | `apps/backend/src/safety/training-records.routes.ts:42` | — | — | — |
| create | `/api/v1/safety/v5/complaints` | `apps/backend/src/safety/safety-v5.routes.ts:540` | — | — | — |
| create | `/api/v1/safety/v5/dot-inspections` | `apps/backend/src/safety/safety-v5.routes.ts:120` | — | — | — |

### accounting — 53 create-surface(s)

| kind | endpoint | route file | created | registered | gap |
|---|---|---|---|---|---|
| create | `/api/v1/accounting/1099-corrections` | `apps/backend/src/accounting/p7-wave2.routes.ts:471` | — | — | — |
| nested | `/api/v1/accounting/bill-payments/:id/post-gl` | `apps/backend/src/accounting/bill-payment-gl.routes.ts:19` | — | — | — |
| create | `/api/v1/accounting/bills` | `apps/backend/src/accounting/bills.routes.ts:260` | **y** | **y** | — CC-3 2026-08-28: `061bf94d-…` BILL-2026-00023 $50, DR 5400/CR 2000 balanced, voided cleanly (net 0). See LIVE-TXN-BATTERY LV-TXN-017. |
| nested | `/api/v1/accounting/bills/:id/allocate` | `apps/backend/src/accounting/bills.routes.ts:521` | — | — | — |
| nested | `/api/v1/accounting/bills/:id/pay` | `apps/backend/src/accounting/bills.routes.ts:330` | — | — | — |
| nested | `/api/v1/accounting/bills/:id/post-gl` | `apps/backend/src/accounting/bill-gl-draft.routes.ts:102` | — | — | — |
| create | `/api/v1/accounting/bills/draft-je-preview` | `apps/backend/src/accounting/bill-gl-draft.routes.ts:45` | — | — | — |
| nested | `/api/v1/accounting/collections/:taskId/contact` | `apps/backend/src/accounting/collections.routes.ts:90` | — | — | — |
| create | `/api/v1/accounting/escrow/deposit` | `apps/backend/src/accounting/escrow/routes.ts:106` | — | — | — |
| create | `/api/v1/accounting/escrow/open` | `apps/backend/src/accounting/escrow/routes.ts:41` | — | — | — |
| create | `/api/v1/accounting/expense-category-map` | `apps/backend/src/accounting/expense-category-map/routes.ts:214` | — | — | — |
| create | `/api/v1/accounting/factoring-advances` | `apps/backend/src/accounting/factoring-advances.routes.ts:304` | — | — | — |
| nested | `/api/v1/accounting/factoring-advances/:id/advance` | `apps/backend/src/accounting/factoring-advances.routes.ts:429` | — | — | — |
| nested | `/api/v1/accounting/factoring-advances/:id/recourse-return` | `apps/backend/src/accounting/factoring-advances.routes.ts:673` | — | — | — |
| nested | `/api/v1/accounting/factoring-advances/:id/reserve-held` | `apps/backend/src/accounting/factoring-advances.routes.ts:494` | — | — | — |
| create | `/api/v1/accounting/fixed-assets/dispose` | `apps/backend/src/accounting/amortization-posting/amortization-posting.routes.ts:104` | — | — | — |
| create | `/api/v1/accounting/fixed-assets/register-trk-units` | `apps/backend/src/accounting/fixed-assets.routes.ts:372` | — | — | — |
| create | `/api/v1/accounting/fixed-assets/register-unit` | `apps/backend/src/accounting/fixed-assets.routes.ts:338` | — | — | — |
| create | `/api/v1/accounting/invoices` | `apps/backend/src/accounting/invoices.routes.ts:310` | **y** | **partial — GAP FOUND** | CC-3 2026-08-28: no-load path correctly 409s (LV-TXN-018). From-load path DOES reach `sent`, but Event 2 (bill/A/R) is missing for 9 of 12 sent+earned USMCA loads ($13,701.00), 3 already `paid` with A/R credited-not-debited ($3,600.00 live-wrong). Filed `FACT-F4-PLEDGED-INVOICE-ZERO-AR` (widened) on the board, lane CC-1. See LIVE-TXN-BATTERY LV-TXN-019. |
| nested | `/api/v1/accounting/invoices/:id/lines` | `apps/backend/src/accounting/invoice-lines.routes.ts:81` | — | — | — |
| create | `/api/v1/accounting/invoices/from-load` | `apps/backend/src/accounting/invoices.routes.ts:481` | — | — | — |
| create | `/api/v1/accounting/journal-entries` | `apps/backend/src/accounting/journal-entries.routes.ts:59` | — | — | — |
| create | `/api/v1/accounting/lease-posting/leases` | `apps/backend/src/accounting/lease-asc842/lease-posting.routes.ts:99` | — | — | — |
| nested | `/api/v1/accounting/lease-posting/leases/:lease_id/assets` | `apps/backend/src/accounting/lease-asc842/lease-posting.routes.ts:140` | — | — | — |
| nested | `/api/v1/accounting/lease-posting/leases/:lease_id/schedule` | `apps/backend/src/accounting/lease-asc842/lease-posting.routes.ts:172` | — | — | — |
| create | `/api/v1/accounting/lease-posting/operating/end-of-term-sale` | `apps/backend/src/accounting/lease-asc842/lease-posting.routes.ts:296` | — | — | — |
| create | `/api/v1/accounting/lease-posting/operating/rental` | `apps/backend/src/accounting/lease-asc842/lease-posting.routes.ts:272` | — | — | — |
| create | `/api/v1/accounting/lease-posting/sales-type/commencement` | `apps/backend/src/accounting/lease-asc842/lease-posting.routes.ts:320` | — | — | — |
| create | `/api/v1/accounting/lease-posting/sales-type/interest` | `apps/backend/src/accounting/lease-asc842/lease-posting.routes.ts:344` | — | — | — |
| create | `/api/v1/accounting/month-close` | `apps/backend/src/accounting/month-close.routes.ts:60` | — | — | — |
| create | `/api/v1/accounting/month-close-acknowledge` | `apps/backend/src/accounting/month-close.routes.ts:84` | — | — | — |
| create | `/api/v1/accounting/opening-balance-register/clone-as-is-commit` | `apps/backend/src/accounting/opening-balance-register/opening-balance-register.routes.ts:169` | — | — | — |
| create | `/api/v1/accounting/opening-balance-register/finality` | `apps/backend/src/accounting/opening-balance-register/opening-balance-register.routes.ts:194` | — | — | — |
| create | `/api/v1/accounting/opening-balance-register/import-from-fixture` | `apps/backend/src/accounting/opening-balance-register/opening-balance-register.routes.ts:150` | — | — | — |
| create | `/api/v1/accounting/opening-balance-register/import-from-qbo` | `apps/backend/src/accounting/opening-balance-register/opening-balance-register.routes.ts:132` | — | — | — |
| create | `/api/v1/accounting/payments` | `apps/backend/src/accounting/payments.routes.ts:242` | — | — | — |
| nested | `/api/v1/accounting/payments/:paymentId/applications` | `apps/backend/src/accounting/payment-applications.routes.ts:27` | — | — | — |
| create | `/api/v1/accounting/periods` | `apps/backend/src/accounting/p7-wave2.routes.ts:180` | — | — | — |
| create | `/api/v1/accounting/posting-engine-mvp/remediate-bank-ledger-repoint` | `apps/backend/src/accounting/posting-engine.routes.ts:214` | — | — | — |
| create | `/api/v1/accounting/prepaid-expenses` | `apps/backend/src/accounting/prepaid-expenses.routes.ts:330` | — | — | — |
| create | `/api/v1/accounting/pse-mirror/enforce` | `apps/backend/src/accounting/pse-mirror.routes.ts:44` | — | — | — |
| create | `/api/v1/accounting/pse-mirror/sync-now` | `apps/backend/src/accounting/pse-mirror.routes.ts:33` | — | — | — |
| create | `/api/v1/accounting/recurring-bill-templates` | `apps/backend/src/accounting/bills/recurring/routes.ts:63` | — | — | — |
| nested | `/api/v1/accounting/recurring-bill-templates/:uuid/generate-now` | `apps/backend/src/accounting/bills/recurring/routes.ts:190` | — | — | — |
| create | `/api/v1/accounting/related-party-loans` | `apps/backend/src/accounting/related-party-loan-posting/routes.ts:336` | — | — | — |
| create | `/api/v1/accounting/sales-tax/agencies` | `apps/backend/src/accounting/sales-tax/routes.ts:78` | — | — | — |
| nested | `/api/v1/accounting/sales-tax/returns/:id/file` | `apps/backend/src/accounting/sales-tax/routes.ts:285` | — | — | — |
| nested | `/api/v1/accounting/sales-tax/returns/:id/mark-paid` | `apps/backend/src/accounting/sales-tax/routes.ts:325` | — | — | — |
| create | `/api/v1/accounting/sales-tax/returns/prepare` | `apps/backend/src/accounting/sales-tax/routes.ts:172` | — | — | — |
| create | `/api/v1/accounting/settlement-posting/bill-payment-post` | `apps/backend/src/accounting/settlement-posting/settlement-posting.routes.ts:116` | — | — | — |
| create | `/api/v1/accounting/settlement-posting/recover-from-driver` | `apps/backend/src/accounting/settlement-posting/settlement-posting.routes.ts:155` | — | — | — |
| create | `/api/v1/accounting/vendor-credits` | `apps/backend/src/accounting/vendor-credits.routes.ts:158` | — | — | — |
| create | `/api/v1/accounting/vendors/batch-categorize` | `apps/backend/src/accounting/vendor-category.routes.ts:45` | — | — | — |

### mdata — 44 create-surface(s)

| kind | endpoint | route file | created | registered | gap |
|---|---|---|---|---|---|
| create | `/api/v1/mdata/customers` | `apps/backend/src/mdata/customers.routes.ts:599` | — | — | — |
| nested | `/api/v1/mdata/customers/:customer_id/lanes` | `apps/backend/src/mdata/customer-lanes.routes.ts:88` | — | — | — |
| nested | `/api/v1/mdata/customers/:customer_id/quality-events` | `apps/backend/src/mdata/customer-quality-events.routes.ts:206` | — | — | — |
| nested | `/api/v1/mdata/customers/:id/fmcsa-link` | `apps/backend/src/catalogs/fmcsa.routes.ts:225` | — | — | — |
| nested | `/api/v1/mdata/customers/:id/verify-fmcsa` | `apps/backend/src/mdata/customers.routes.ts:1163` | — | — | — |
| create | `/api/v1/mdata/driver-teams` | `apps/backend/src/mdata/driver-teams.routes.ts:231` | — | — | — |
| nested | `/api/v1/mdata/driver-teams/:id/replace-driver` | `apps/backend/src/mdata/driver-teams.routes.ts:432` | — | — | — |
| create | `/api/v1/mdata/drivers` | `apps/backend/src/mdata/drivers.routes.ts:1112` | — | — | — |
| nested | `/api/v1/mdata/drivers/:driver_id/safety-events` | `apps/backend/src/mdata/driver-safety-events.routes.ts:521` | — | — | — |
| nested | `/api/v1/mdata/drivers/:driver_id/suspend` | `apps/backend/src/mdata/driver-safety-events.routes.ts:348` | — | — | — |
| nested | `/api/v1/mdata/drivers/:id/clear-default-truck` | `apps/backend/src/mdata/driver-default-truck.routes.ts:175` | — | — | — |
| nested | `/api/v1/mdata/drivers/:id/default-truck` | `apps/backend/src/mdata/driver-default-truck.routes.ts:118` | — | — | — |
| nested | `/api/v1/mdata/drivers/:id/disable-phone-login` | `apps/backend/src/mdata/drivers.routes.ts:2090` | — | — | — |
| nested | `/api/v1/mdata/drivers/:id/enable-phone-login` | `apps/backend/src/mdata/drivers.routes.ts:2018` | — | — | — |
| nested | `/api/v1/mdata/drivers/:id/messages` | `apps/backend/src/mdata/driver-messages.routes.ts:24` | — | — | — |
| nested | `/api/v1/mdata/drivers/:id/reactivate` | `apps/backend/src/mdata/drivers.routes.ts:1956` | — | — | — |
| nested | `/api/v1/mdata/drivers/:id/resend-invite` | `apps/backend/src/mdata/drivers.routes.ts:1425` | — | — | — |
| nested | `/api/v1/mdata/drivers/:id/training` | `apps/backend/src/mdata/driver-training.routes.ts:56` | — | — | — |
| nested | `/api/v1/mdata/drivers/:id/w8ben` | `apps/backend/src/mdata/driver-w8ben.routes.ts:120` | — | — | — |
| create | `/api/v1/mdata/drivers/bulk-invite` | `apps/backend/src/mdata/drivers.routes.ts:1218` | — | — | — |
| create | `/api/v1/mdata/drivers/check-returning` | `apps/backend/src/mdata/driver-returning-detection.routes.ts:155` | — | — | — |
| create | `/api/v1/mdata/equipment` | `apps/backend/src/mdata/equipment.routes.ts:230` | — | — | — |
| create | `/api/v1/mdata/equipment-log` | `apps/backend/src/mdata/equipment-log.routes.ts:144` | — | — | — |
| nested | `/api/v1/mdata/equipment/:id/plates` | `apps/backend/src/mdata/equipment-plates.routes.ts:82` | — | — | — |
| nested | `/api/v1/mdata/equipment/:id/status-change` | `apps/backend/src/mdata/equipment.routes.ts:378` | — | — | — |
| create | `/api/v1/mdata/loads` | `apps/backend/src/mdata/loads.routes.ts:299` | — | — | — |
| nested | `/api/v1/mdata/loads/:id/stops` | `apps/backend/src/mdata/loads.routes.ts:1248` | — | — | — |
| create | `/api/v1/mdata/locations` | `apps/backend/src/mdata/locations.routes.ts:247` | — | — | — |
| nested | `/api/v1/mdata/locations/:id/contacts` | `apps/backend/src/mdata/locations.routes.ts:634` | — | — | — |
| nested | `/api/v1/mdata/locations/:id/contacts/:contactId/set-primary` | `apps/backend/src/mdata/locations.routes.ts:800` | — | — | — |
| create | `/api/v1/mdata/qbo/accounts` | `apps/backend/src/mdata/qbo-master-write.routes.ts:519` | — | — | — |
| create | `/api/v1/mdata/qbo/customers` | `apps/backend/src/mdata/qbo-master-write.routes.ts:260` | — | — | — |
| create | `/api/v1/mdata/qbo/items` | `apps/backend/src/mdata/qbo-master-write.routes.ts:388` | — | — | — |
| create | `/api/v1/mdata/qbo/vendors` | `apps/backend/src/mdata/qbo-master-write.routes.ts:109` | — | — | — |
| create | `/api/v1/mdata/units` | `apps/backend/src/mdata/units.routes.ts:230` | — | — | — |
| nested | `/api/v1/mdata/units/:id/drivers/clear-default` | `apps/backend/src/mdata/unit-default-driver.routes.ts:183` | — | — | — |
| nested | `/api/v1/mdata/units/:id/drivers/default` | `apps/backend/src/mdata/unit-default-driver.routes.ts:140` | — | — | — |
| nested | `/api/v1/mdata/units/:id/photos` | `apps/backend/src/mdata/unit-photos.routes.ts:48` | — | — | — |
| nested | `/api/v1/mdata/units/:id/plates` | `apps/backend/src/mdata/unit-plates.routes.ts:137` | — | — | — |
| nested | `/api/v1/mdata/units/:id/quick-availability` | `apps/backend/src/mdata/units.routes.ts:526` | — | — | — |
| nested | `/api/v1/mdata/units/:id/trip-cost` | `apps/backend/src/mdata/unit-trip-cost.routes.ts:42` | — | — | — |
| create | `/api/v1/mdata/vendors` | `apps/backend/src/mdata/vendors.routes.ts:460` | — | — | — |
| create | `/api/v1/mdata/vendors/ensure-drivers` | `apps/backend/src/mdata/vendors.routes.ts:305` | — | — | — |
| create | `/api/v1/mdata/workflow-requests` | `apps/backend/src/mdata/workflow-routes.ts:185` | — | — | — |

### maintenance — 38 create-surface(s)

| kind | endpoint | route file | created | registered | gap |
|---|---|---|---|---|---|
| nested | `/api/v1/maintenance/arriving-soon/:load_id/convert-issue-to-wo` | `apps/backend/src/maintenance/arriving-soon.routes.ts:145` | — | — | — |
| create | `/api/v1/maintenance/arriving-soon/audit-view` | `apps/backend/src/maintenance/arriving-soon.routes.ts:396` | — | — | — |
| create | `/api/v1/maintenance/brake-wear/measurements` | `apps/backend/src/integrations/samsara/cap-13-brake-wear/routes.ts:64` | — | — | — |
| create | `/api/v1/maintenance/drivers` | `apps/backend/src/maintenance/drivers.routes.ts:172` | — | — | — |
| nested | `/api/v1/maintenance/dvir-defects/:id/triage` | `apps/backend/src/maintenance/defects.routes.ts:172` | — | — | — |
| create | `/api/v1/maintenance/fault-rules` | `apps/backend/src/maintenance/fault-auto-wo/fault-rules.routes.ts:70` | — | — | — |
| create | `/api/v1/maintenance/inspections` | `apps/backend/src/maintenance/inspections.routes.ts:231` | — | — | — |
| nested | `/api/v1/maintenance/inspections/:id/photos` | `apps/backend/src/maintenance/inspections.routes.ts:403` | — | — | — |
| create | `/api/v1/maintenance/internal-labor` | `apps/backend/src/maintenance/internal-labor.routes.ts:134` | — | — | — |
| create | `/api/v1/maintenance/parts` | `apps/backend/src/maintenance/parts.routes.ts:173` | — | — | — |
| create | `/api/v1/maintenance/parts-inventory/purchases` | `apps/backend/src/maintenance/parts-inventory.routes.ts:55` | — | — | — |
| create | `/api/v1/maintenance/pm-auto-engine/run-now` | `apps/backend/src/maintenance/pm-auto-engine.service.ts:601` | — | — | — |
| create | `/api/v1/maintenance/pm-auto-engine/settings` | `apps/backend/src/maintenance/pm-auto-engine.service.ts:569` | — | — | — |
| create | `/api/v1/maintenance/pm-schedule` | `apps/backend/src/maintenance/pm-schedule.routes.ts:118` | — | — | — |
| nested | `/api/v1/maintenance/pm-schedule/:id/generate-wo` | `apps/backend/src/maintenance/pm-schedule.routes.ts:155` | — | — | — |
| nested | `/api/v1/maintenance/pre-flight-dvir/:defectId/route` | `apps/backend/src/maintenance/pre-flight-dvir.routes.ts:146` | — | — | — |
| nested | `/api/v1/maintenance/pre-flight/defects/:id/route` | `apps/backend/src/maintenance/pre-flight/routes.ts:165` | — | — | — |
| create | `/api/v1/maintenance/reefer-hours/ingest-samsara` | `apps/backend/src/maintenance/reefer-hours.routes.ts:478` | — | — | — |
| create | `/api/v1/maintenance/reefer-hours/log` | `apps/backend/src/maintenance/reefer-hours.routes.ts:384` | — | — | — |
| create | `/api/v1/maintenance/severe-repair/export-pdf` | `apps/backend/src/maintenance/severe-repair-estimate.routes.ts:104` | — | — | — |
| create | `/api/v1/maintenance/tire-tread/measurements` | `apps/backend/src/integrations/samsara/cap-12-tire-tread/routes.ts:61` | — | — | — |
| create | `/api/v1/maintenance/tires/brands` | `apps/backend/src/maintenance/tires.routes.ts:284` | — | — | — |
| create | `/api/v1/maintenance/tires/records` | `apps/backend/src/maintenance/tires.routes.ts:367` | — | — | — |
| create | `/api/v1/maintenance/tires/replace` | `apps/backend/src/maintenance/tires.routes.ts:604` | — | — | — |
| create | `/api/v1/maintenance/tires/tread-audit` | `apps/backend/src/maintenance/tires.routes.ts:675` | — | — | — |
| nested | `/api/v1/maintenance/triage/:issue_id/convert-to-damage` | `apps/backend/src/maintenance/triage.routes.ts:172` | — | — | — |
| nested | `/api/v1/maintenance/triage/:issue_id/convert-to-wo` | `apps/backend/src/maintenance/triage.routes.ts:44` | — | — | — |
| create | `/api/v1/maintenance/vehicles` | `apps/backend/src/maintenance/vehicles.routes.ts:187` | — | — | — |
| create | `/api/v1/maintenance/vendors` | `apps/backend/src/maintenance/vendors.routes.ts:336` | — | — | — |
| create | `/api/v1/maintenance/warranty/claims` | `apps/backend/src/maintenance/warranty.routes.ts:411` | — | — | — |
| nested | `/api/v1/maintenance/warranty/claims/:id/file` | `apps/backend/src/maintenance/warranty.routes.ts:489` | — | — | — |
| nested | `/api/v1/maintenance/warranty/claims/:id/reimburse` | `apps/backend/src/maintenance/warranty.routes.ts:525` | — | — | — |
| create | `/api/v1/maintenance/warranty/detect-from-wo` | `apps/backend/src/maintenance/warranty.routes.ts:595` | — | — | — |
| create | `/api/v1/maintenance/warranty/parts` | `apps/backend/src/maintenance/warranty.routes.ts:344` | — | — | — |
| create | `/api/v1/maintenance/work-orders` | `apps/backend/src/maintenance/work-orders.routes.ts:557` | — | — | — |
| nested | `/api/v1/maintenance/work-orders/:id/line-items` | `apps/backend/src/maintenance/work-orders.routes.ts:1335` | — | — | — |
| nested | `/api/v1/maintenance/work-orders/:id/parts-invoice-links` | `apps/backend/src/maintenance/parts-invoice-links.routes.ts:159` | — | — | — |
| nested | `/api/v1/maintenance/work-orders/:id/status` | `apps/backend/src/maintenance/work-orders.routes.ts:1272` | — | — | — |

### banking — 31 create-surface(s)

| kind | endpoint | route file | created | registered | gap |
|---|---|---|---|---|---|
| nested | `/api/v1/banking/accounts/:id/hide` | `apps/backend/src/banking/banking.routes.ts:741` | — | — | — |
| nested | `/api/v1/banking/accounts/:id/unhide` | `apps/backend/src/banking/banking.routes.ts:766` | — | — | — |
| create | `/api/v1/banking/accounts/visibility` | `apps/backend/src/banking/banking.routes.ts:281` | — | — | — |
| create | `/api/v1/banking/categorization-rules` | `apps/backend/src/banking/categorization-rules.routes.ts:154` | — | — | — |
| nested | `/api/v1/banking/categorization-rules/:id/apply-historical` | `apps/backend/src/banking/categorization-rules.routes.ts:297` | — | — | — |
| create | `/api/v1/banking/cc-payments` | `apps/backend/src/banking/transfers.routes.ts:133` | — | — | — |
| create | `/api/v1/banking/equipment-loans` | `apps/backend/src/data-infra/data-infra.routes.ts:191` | — | — | — |
| nested | `/api/v1/banking/equipment-loans/:id/attributions` | `apps/backend/src/data-infra/data-infra.routes.ts:226` | — | — | — |
| nested | `/api/v1/banking/equipment-loans/:id/payments` | `apps/backend/src/data-infra/data-infra.routes.ts:245` | — | — | — |
| create | `/api/v1/banking/manual-je` | `apps/backend/src/banking/manual-je.routes.deprecated.ts:56` | — | — | — |
| nested | `/api/v1/banking/plaid/accounts/:id/disconnect` | `apps/backend/src/integrations/plaid/link.routes.ts:322` | — | — | — |
| create | `/api/v1/banking/plaid/create-link-token` | `apps/backend/src/integrations/plaid/link.routes.ts:135` | — | — | — |
| create | `/api/v1/banking/plaid/create-update-link-token` | `apps/backend/src/integrations/plaid/link.routes.ts:413` | — | — | — |
| create | `/api/v1/banking/plaid/exchange-public-token` | `apps/backend/src/integrations/plaid/link.routes.ts:157` | — | — | — |
| nested | `/api/v1/banking/plaid/items/:itemId/disconnect` | `apps/backend/src/banking/plaid-items.routes.ts:116` | — | — | — |
| create | `/api/v1/banking/plaid/items/disconnect` | `apps/backend/src/integrations/plaid/link.routes.ts:429` | — | — | — |
| create | `/api/v1/banking/reconciliation-sessions` | `apps/backend/src/banking/p7-wave2.routes.ts:356` | — | — | — |
| nested | `/api/v1/banking/reconciliation-sessions/:id/finalize` | `apps/backend/src/banking/p7-wave2.routes.ts:450` | — | — | — |
| nested | `/api/v1/banking/reconciliation/:sessionId/clear` | `apps/backend/src/banking/reconciliation.routes.ts:655` | — | — | — |
| create | `/api/v1/banking/rules` | `apps/backend/src/banking/p7-wave2.routes.ts:192` | — | — | — |
| nested | `/api/v1/banking/transactions/:id/investigate` | `apps/backend/src/banking/categorization.routes.ts:961` | — | — | — |
| nested | `/api/v1/banking/transactions/:id/refresh-suggestion` | `apps/backend/src/banking/p7-wave2.routes.ts:303` | — | — | — |
| nested | `/api/v1/banking/transactions/:id/skip` | `apps/backend/src/banking/categorization.routes.ts:892` | — | — | — |
| nested | `/api/v1/banking/transactions/:id/transfer` | `apps/backend/src/banking/categorization.routes.ts:801` | — | — | — |
| nested | `/api/v1/banking/transactions/:id/undo-categorization` | `apps/backend/src/banking/banking.routes.ts:502` | — | — | — |
| create | `/api/v1/banking/transactions/bulk-categorize` | `apps/backend/src/banking/categorization.routes.ts:1029` | — | — | — |
| create | `/api/v1/banking/transactions/bulk-post-as-bills` | `apps/backend/src/banking/categorization.routes.ts:1078` | — | — | — |
| create | `/api/v1/banking/transactions/categorize-bulk` | `apps/backend/src/banking/categorization.routes.ts:664` | — | — | — |
| create | `/api/v1/banking/transfers` | `apps/backend/src/banking/transfers.routes.ts:80` | — | — | — |
| create | `/api/v1/banking/transfers/intercompany` | `apps/backend/src/banking/transfers.routes.ts:188` | — | — | — |
| create | `/api/v1/banking/upload-statement` | `apps/backend/src/banking/reconciliation.routes.ts:1072` | — | — | — |

### catalogs — 26 create-surface(s)

| kind | endpoint | route file | created | registered | gap |
|---|---|---|---|---|---|
| create | `/api/v1/catalogs/account-role-bindings` | `apps/backend/src/catalogs/account-role-bindings.routes.ts:128` | — | — | — |
| create | `/api/v1/catalogs/accounts` | `apps/backend/src/catalogs/accounts.routes.ts:235` | — | — | — |
| create | `/api/v1/catalogs/classes` | `apps/backend/src/catalogs/classes.routes.ts:135` | — | — | — |
| create | `/api/v1/catalogs/dispatch-flag-colors` | `apps/backend/src/catalogs/dispatch-flag-colors.routes.ts:103` | — | — | — |
| nested | `/api/v1/catalogs/dispatch-flag-colors/:id/reactivate` | `apps/backend/src/catalogs/dispatch-flag-colors.routes.ts:282` | — | — | — |
| create | `/api/v1/catalogs/driver-load-statuses` | `apps/backend/src/catalogs/driver-load-statuses.routes.ts:128` | — | — | — |
| create | `/api/v1/catalogs/driver-termination-reasons` | `apps/backend/src/mdata/driver-safety-events.routes.ts:156` | — | — | — |
| nested | `/api/v1/catalogs/driver-termination-reasons/:id/reactivate` | `apps/backend/src/mdata/driver-safety-events.routes.ts:318` | — | — | — |
| create | `/api/v1/catalogs/equipment-types` | `apps/backend/src/catalogs/equipment-types.routes.ts:210` | — | — | — |
| create | `/api/v1/catalogs/file-categories` | `apps/backend/src/catalogs/file-categories.routes.ts:69` | — | — | — |
| create | `/api/v1/catalogs/items` | `apps/backend/src/catalogs/items.routes.ts:146` | — | — | — |
| create | `/api/v1/catalogs/load-cancellation-reasons` | `apps/backend/src/catalogs/load-cancellation-reasons.routes.ts:124` | — | — | — |
| create | `/api/v1/catalogs/maintenance/parts-master` | `apps/backend/src/catalogs/maintenance/parts.routes.ts:106` | — | — | — |
| create | `/api/v1/catalogs/maintenance/services-catalog` | `apps/backend/src/catalogs/maintenance/services.routes.ts:137` | — | — | — |
| create | `/api/v1/catalogs/payment-methods` | `apps/backend/src/driver-finance/payment-methods-catalog.routes.ts:60` | — | — | — |
| create | `/api/v1/catalogs/payment-terms` | `apps/backend/src/catalogs/payment-terms.routes.ts:142` | — | — | — |
| create | `/api/v1/catalogs/posting-templates` | `apps/backend/src/catalogs/posting-templates.routes.ts:155` | — | — | — |
| create | `/api/v1/catalogs/registry` | `apps/backend/src/catalogs/catalog-registry.routes.ts:327` | — | — | — |
| create | `/api/v1/catalogs/safety/cargo-claim-reasons` | `apps/backend/src/catalogs/safety/cargo-claim-reasons.routes.ts:117` | — | — | — |
| create | `/api/v1/catalogs/safety/civil-fine-types` | `apps/backend/src/catalogs/safety/civil-fine-types.routes.ts:110` | — | — | — |
| create | `/api/v1/catalogs/safety/company-violation-types` | `apps/backend/src/catalogs/safety/company-violation-types.routes.ts:108` | — | — | — |
| create | `/api/v1/catalogs/safety/complaint-types` | `apps/backend/src/catalogs/safety/complaint-types.routes.ts:102` | — | — | — |
| create | `/api/v1/catalogs/safety/dot-violation-types` | `apps/backend/src/catalogs/safety/dot-violation-types.routes.ts:143` | — | — | — |
| create | `/api/v1/catalogs/safety/internal-fine-reasons` | `apps/backend/src/catalogs/safety/internal-fine-reasons.routes.ts:118` | — | — | — |
| create | `/api/v1/catalogs/void-cancel-reasons` | `apps/backend/src/catalogs/void-cancel-reasons.routes.ts:123` | — | — | — |
| create | `/api/v1/catalogs/workflow-requests` | `apps/backend/src/catalogs/workflow-routes.ts:244` | — | — | — |

### dispatch — 22 create-surface(s)

| kind | endpoint | route file | created | registered | gap |
|---|---|---|---|---|---|
| nested | `/api/dispatch/driver-pwa/load/:uuid/stops/:stop_uuid/arrival` | `apps/backend/src/dispatch/driver-pwa/dispatch-view.routes.ts:293` | — | — | — |
| nested | `/api/dispatch/driver-pwa/load/:uuid/stops/:stop_uuid/departure` | `apps/backend/src/dispatch/driver-pwa/dispatch-view.routes.ts:365` | — | — | — |
| nested | `/api/dispatch/driver-pwa/load/:uuid/stops/:stop_uuid/document` | `apps/backend/src/dispatch/driver-pwa/dispatch-view.routes.ts:457` | — | — | — |
| nested | `/api/v1/dispatch/detention/events/:id/bridge-billing` | `apps/backend/src/dispatch/detention.routes.ts:70` | — | — | — |
| nested | `/api/v1/dispatch/detention/events/:id/notify-customer` | `apps/backend/src/dispatch/detention.routes.ts:87` | — | — | — |
| nested | `/api/v1/dispatch/equipment-transfers/:uuid/confirm-inbound` | `apps/backend/src/dispatch/equipment-transfer/routes.ts:96` | — | — | — |
| nested | `/api/v1/dispatch/equipment-transfers/:uuid/confirm-outbound` | `apps/backend/src/dispatch/equipment-transfer/routes.ts:74` | — | — | — |
| create | `/api/v1/dispatch/equipment-transfers/initiate` | `apps/backend/src/dispatch/equipment-transfer/routes.ts:28` | — | — | — |
| create | `/api/v1/dispatch/intransit-issues` | `apps/backend/src/dispatch/intransit-issues.routes.ts:62` | — | — | — |
| create | `/api/v1/dispatch/intransit-issues/office` | `apps/backend/src/dispatch/arch-tabs.routes.ts:73` | — | — | — |
| create | `/api/v1/dispatch/loads` | `apps/backend/src/dispatch/loads.routes.ts:1016` | — | — | — |
| nested | `/api/v1/dispatch/loads/:id/complete-quicksave-draft` | `apps/backend/src/dispatch/quicksave.routes.ts:113` | — | — | — |
| nested | `/api/v1/dispatch/loads/:id/distribute-instructions` | `apps/backend/src/dispatch/loads.routes.ts:758` | — | — | — |
| nested | `/api/v1/dispatch/loads/:id/quick-assign` | `apps/backend/src/dispatch/quicksave.routes.ts:79` | — | — | — |
| nested | `/api/v1/dispatch/loads/:load_id/confirm-predicted-delivery` | `apps/backend/src/dispatch/predicted-delivery.routes.ts:35` | — | — | — |
| nested | `/api/v1/dispatch/loads/:load_uuid/stops/:stop_uuid/extra-rates` | `apps/backend/src/dispatch/loads/multi-stop/extra-rate.routes.ts:46` | — | — | — |
| create | `/api/v1/dispatch/loads/ocr-upload` | `apps/backend/src/dispatch/loads.routes.ts:416` | — | — | — |
| create | `/api/v1/dispatch/loads/reserve-id` | `apps/backend/src/dispatch/loads.routes.ts:372` | — | — | — |
| nested | `/api/v1/dispatch/ocr-intake/items/:id/convert` | `apps/backend/src/dispatch/ocr-intake.routes.ts:78` | — | — | — |
| nested | `/api/v1/dispatch/ocr-intake/items/:id/reprocess` | `apps/backend/src/dispatch/ocr-intake.routes.ts:65` | — | — | — |
| create | `/api/v1/dispatch/ratecon/extract` | `apps/backend/src/dispatch/ratecon-extract.routes.ts:64` | — | — | — |
| create | `/api/v1/dispatch/validation/pre-dispatch` | `apps/backend/src/dispatch/validation/pre-dispatch.routes.ts:17` | — | — | — |

### driver — 18 create-surface(s)

| kind | endpoint | route file | created | registered | gap |
|---|---|---|---|---|---|
| nested | `/api/v1/driver/arrival-prompts/:id/confirm` | `apps/backend/src/driver/arrival-prompts.routes.ts:81` | — | — | — |
| nested | `/api/v1/driver/arrival-prompts/:id/dismiss` | `apps/backend/src/driver/arrival-prompts.routes.ts:152` | — | — | — |
| create | `/api/v1/driver/cash-advance-requests` | `apps/backend/src/driver-finance/cash-advance-requests.routes.ts:84` | — | — | — |
| nested | `/api/v1/driver/chat/messages/:id/receipt` | `apps/backend/src/chat/chat.routes.ts:212` | — | — | — |
| nested | `/api/v1/driver/chat/threads/:id/messages` | `apps/backend/src/chat/chat.routes.ts:199` | — | — | — |
| create | `/api/v1/driver/dvir` | `apps/backend/src/driver/dvir.routes.ts:16` | — | — | — |
| create | `/api/v1/driver/fuel/upload-receipt` | `apps/backend/src/driver/fuel-receipt.routes.ts:23` | — | — | — |
| nested | `/api/v1/driver/loads/:id/accept` | `apps/backend/src/driver/loads.routes.ts:342` | — | — | — |
| nested | `/api/v1/driver/loads/:id/stops/:stopId/arrive` | `apps/backend/src/driver/loads.routes.ts:453` | — | — | — |
| nested | `/api/v1/driver/loads/:id/stops/:stopId/depart` | `apps/backend/src/driver/loads.routes.ts:519` | — | — | — |
| nested | `/api/v1/driver/loads/:loadId/stops/:stopId/pod` | `apps/backend/src/dispatch/pod.routes.ts:78` | — | — | — |
| create | `/api/v1/driver/messages` | `apps/backend/src/drivers/messages.routes.ts:120` | — | — | — |
| create | `/api/v1/driver/push-subscription` | `apps/backend/src/driver/push-subscriptions.routes.ts:22` | — | — | — |
| create | `/api/v1/driver/reports` | `apps/backend/src/driver/reports.routes.ts:28` | — | — | — |
| create | `/api/v1/driver/scheduler/request` | `apps/backend/src/safety/driver-scheduler.routes.ts:123` | — | — | — |
| nested | `/api/v1/driver/scheduler/request/:id/documentation` | `apps/backend/src/safety/driver-scheduler.routes.ts:167` | — | — | — |
| nested | `/api/v1/driver/settlements/:settlementId/dispute` | `apps/backend/src/driver/settlement-disputes-p6.routes.ts:38` | — | — | — |
| nested | `/api/v1/driver/status-suggestions/:id/respond` | `apps/backend/src/driver/status-suggestions.routes.ts:71` | — | — | — |

### legal — 15 create-surface(s)

| kind | endpoint | route file | created | registered | gap |
|---|---|---|---|---|---|
| nested | `/api/v1/legal/attorney-review/:token/request-changes` | `apps/backend/src/legal/attorney-review.routes.ts:45` | — | — | — |
| create | `/api/v1/legal/contracts` | `apps/backend/src/legal/contracts.routes.ts:213` | — | — | — |
| create | `/api/v1/legal/contracts/draft-preview` | `apps/backend/src/legal/contracts.routes.ts:182` | — | — | — |
| create | `/api/v1/legal/contracts/lease-to-own/ensure-template` | `apps/backend/src/legal/contracts.routes.ts:323` | — | — | — |
| create | `/api/v1/legal/contracts/truck-lease/ensure-template` | `apps/backend/src/legal/contracts.routes.ts:284` | — | — | — |
| create | `/api/v1/legal/matters` | `apps/backend/src/legal/matters.routes.ts:174` | — | — | — |
| nested | `/api/v1/legal/matters/:id/deadlines` | `apps/backend/src/legal/matters.routes.ts:311` | — | — | — |
| nested | `/api/v1/legal/matters/:id/documents` | `apps/backend/src/legal/matters.routes.ts:266` | — | — | — |
| nested | `/api/v1/legal/matters/:id/events` | `apps/backend/src/legal/matters.routes.ts:245` | — | — | — |
| nested | `/api/v1/legal/sign/:token/verify/confirm` | `apps/backend/src/legal/sign.routes.ts:58` | — | — | — |
| create | `/api/v1/legal/templates` | `apps/backend/src/legal/templates.routes.ts:147` | — | — | — |
| nested | `/api/v1/legal/templates/:id/attorney-review-link` | `apps/backend/src/legal/templates.routes.ts:259` | — | — | — |
| nested | `/api/v1/legal/templates/:id/new-version` | `apps/backend/src/legal/templates.routes.ts:215` | — | — | — |
| nested | `/api/v1/legal/templates/:id/retire` | `apps/backend/src/legal/templates.routes.ts:332` | — | — | — |
| create | `/api/v1/legal/templates/library/ensure` | `apps/backend/src/legal/templates.routes.ts:196` | — | — | — |

### compliance — 11 create-surface(s)

| kind | endpoint | route file | created | registered | gap |
|---|---|---|---|---|---|
| create | `/api/v1/compliance/csa/mitigation-actions` | `apps/backend/src/compliance/csa.routes.ts:370` | — | — | — |
| create | `/api/v1/compliance/csa/pull-now` | `apps/backend/src/compliance/csa.routes.ts:584` | — | — | — |
| create | `/api/v1/compliance/drug-alcohol/results` | `apps/backend/src/compliance/drug-alcohol.routes.ts:195` | — | — | — |
| create | `/api/v1/compliance/fmcsa-safer/verify-now` | `apps/backend/src/compliance/fmcsa-safer.routes.ts:153` | — | — | — |
| nested | `/api/v1/compliance/form-2290/:id/mark-submitted` | `apps/backend/src/compliance/form-2290.routes.ts:343` | — | — | — |
| create | `/api/v1/compliance/form-2290/generate-draft` | `apps/backend/src/compliance/form-2290.routes.ts:182` | — | — | — |
| create | `/api/v1/compliance/notification-rules` | `apps/backend/src/compliance/compliance-notification-rules.routes.ts:58` | — | — | — |
| create | `/api/v1/compliance/property-tax/appraisal-districts` | `apps/backend/src/compliance/property-tax/property-tax.routes.ts:82` | — | — | — |
| create | `/api/v1/compliance/property-tax/renditions` | `apps/backend/src/compliance/property-tax/property-tax.routes.ts:140` | — | — | — |
| nested | `/api/v1/compliance/property-tax/renditions/:id/lines` | `apps/backend/src/compliance/property-tax/property-tax.routes.ts:184` | — | — | — |
| create | `/api/v1/compliance/required-document-types` | `apps/backend/src/compliance/required-documents.routes.ts:91` | — | — | — |

### driver-finance — 11 create-surface(s)

| kind | endpoint | route file | created | registered | gap |
|---|---|---|---|---|---|
| create | `/api/v1/driver-finance/cash-advance-requests` | `apps/backend/src/driver-finance/cash-advance-requests.routes.ts:302` | — | — | — |
| nested | `/api/v1/driver-finance/cash-advance-requests/:id/deny` | `apps/backend/src/driver-finance/cash-advance-requests.routes.ts:409` | — | — | — |
| nested | `/api/v1/driver-finance/drivers/:driverId/payment-methods` | `apps/backend/src/driver-finance/driver-payment-methods.routes.ts:81` | — | — | — |
| create | `/api/v1/driver-finance/escrow-separations` | `apps/backend/src/driver-finance/escrow-separation.routes.ts:67` | — | — | — |
| nested | `/api/v1/driver-finance/escrow/:driverId/forfeit` | `apps/backend/src/driver-finance/escrow-forfeit.routes.ts:46` | — | — | — |
| nested | `/api/v1/driver-finance/pre-settlements/:id/add-load` | `apps/backend/src/driver-finance/pre-settlement.routes.ts:168` | — | — | — |
| nested | `/api/v1/driver-finance/pre-settlements/:id/settle` | `apps/backend/src/driver-finance/pre-settlement.routes.ts:283` | — | — | — |
| create | `/api/v1/driver-finance/settlement-disputes` | `apps/backend/src/driver-finance/settlement-dispute.routes.ts:84` | — | — | — |
| nested | `/api/v1/driver-finance/settlement-disputes/:id/withdraw` | `apps/backend/src/driver-finance/settlement-dispute.routes.ts:178` | — | — | — |
| create | `/api/v1/driver-finance/settlements` | `apps/backend/src/driver-finance/settlements.routes.ts:324` | — | — | — |
| nested | `/api/v1/driver-finance/settlements/:id/payrun-close` | `apps/backend/src/driver-finance/settlement-payrun-close.routes.ts:86` | — | — | — |

### insurance — 10 create-surface(s)

| kind | endpoint | route file | created | registered | gap |
|---|---|---|---|---|---|
| create | `/api/v1/insurance/claims` | `apps/backend/src/insurance/claim.routes.ts:475` | — | — | — |
| create | `/api/v1/insurance/coi-requests` | `apps/backend/src/insurance/coi-request.routes.ts:56` | — | — | — |
| create | `/api/v1/insurance/lawsuits` | `apps/backend/src/insurance/lawsuit.routes.ts:102` | — | — | — |
| create | `/api/v1/insurance/payment-schedule` | `apps/backend/src/insurance/payment-schedule.routes.ts:101` | — | — | — |
| create | `/api/v1/insurance/policies` | `apps/backend/src/insurance/policy.routes.ts:242` | — | — | — |
| nested | `/api/v1/insurance/policies/:id/generate-bills` | `apps/backend/src/insurance/dispersal.routes.ts:269` | — | — | — |
| nested | `/api/v1/insurance/policies/:policy_id/renew` | `apps/backend/src/insurance/policy.routes.ts:616` | — | — | — |
| nested | `/api/v1/insurance/policies/:policy_id/units` | `apps/backend/src/insurance/policy.routes.ts:433` | — | — | — |
| create | `/api/v1/insurance/policies/with-bills` | `apps/backend/src/insurance/policy-create-atomic.routes.ts:41` | — | — | — |
| create | `/api/v1/insurance/type-catalog` | `apps/backend/src/insurance/type-catalog.routes.ts:116` | — | — | — |

### identity — 9 create-surface(s)

| kind | endpoint | route file | created | registered | gap |
|---|---|---|---|---|---|
| nested | `/api/v1/identity/applicants/:id/convert-to-driver` | `apps/backend/src/identity/applicants.routes.ts:302` | — | — | — |
| create | `/api/v1/identity/applicants/ensure-portal` | `apps/backend/src/identity/applicants.routes.ts:176` | — | — | — |
| create | `/api/v1/identity/me/switch-company` | `apps/backend/src/identity/company-context.routes.ts:130` | — | — | — |
| create | `/api/v1/identity/password-reset/confirm` | `apps/backend/src/identity/password-reset.routes.ts:120` | — | — | — |
| create | `/api/v1/identity/password-reset/request` | `apps/backend/src/identity/password-reset.routes.ts:41` | — | — | — |
| create | `/api/v1/identity/users` | `apps/backend/src/identity/users.routes.ts:598` | — | — | — |
| nested | `/api/v1/identity/users/:user_id/safety-events` | `apps/backend/src/mdata/dispatcher-safety-events.routes.ts:401` | — | — | — |
| create | `/api/v1/identity/users/check-returning-dispatcher` | `apps/backend/src/mdata/dispatcher-safety-events.routes.ts:657` | — | — | — |
| create | `/api/v1/identity/workflow-requests` | `apps/backend/src/identity/workflow-routes.ts:113` | — | — | — |

### reports — 9 create-surface(s)

| kind | endpoint | route file | created | registered | gap |
|---|---|---|---|---|---|
| create | `/api/v1/reports/custom-definitions` | `apps/backend/src/reports/custom-report-builder.routes.ts:92` | — | — | — |
| create | `/api/v1/reports/form-425c/exhibits/build` | `apps/backend/src/reports/form-425c/exhibits/routes.ts:26` | — | — | — |
| nested | `/api/v1/reports/ifta/draft/:uuid/mark-filed` | `apps/backend/src/reports/ifta/routes.ts:114` | — | — | — |
| nested | `/api/v1/reports/ifta/draft/:uuid/owner-approve` | `apps/backend/src/reports/ifta/routes.ts:96` | — | — | — |
| create | `/api/v1/reports/ifta/prepare` | `apps/backend/src/reports/ifta/routes.ts:43` | — | — | — |
| create | `/api/v1/reports/run-log` | `apps/backend/src/reports/library.routes.ts:679` | — | — | — |
| create | `/api/v1/reports/scheduled` | `apps/backend/src/reports/scheduled-reports.routes.ts:68` | — | — | — |
| nested | `/api/v1/reports/scheduled/:id/test-send` | `apps/backend/src/reports/scheduled-reports.routes.ts:174` | — | — | — |
| create | `/api/v1/reports/scheduled/subscriptions` | `apps/backend/src/reports/scheduled/routes.ts:52` | — | — | — |

### form-425c — 8 create-surface(s)

| kind | endpoint | route file | created | registered | gap |
|---|---|---|---|---|---|
| create | `/api/v1/form-425c` | `apps/backend/src/compliance/form-425c.routes.ts:493` | — | — | — |
| nested | `/api/v1/form-425c/:id/amend` | `apps/backend/src/compliance/form-425c.routes.ts:915` | — | — | — |
| nested | `/api/v1/form-425c/:id/exhibit-a` | `apps/backend/src/compliance/form-425c.routes.ts:1041` | — | — | — |
| nested | `/api/v1/form-425c/:id/exhibit-b` | `apps/backend/src/compliance/form-425c.routes.ts:1079` | — | — | — |
| nested | `/api/v1/form-425c/:id/generate-filing-pdf` | `apps/backend/src/compliance/form-425c.routes.ts:785` | — | — | — |
| nested | `/api/v1/form-425c/:id/import-banking` | `apps/backend/src/compliance/form-425c.routes.ts:702` | — | — | — |
| nested | `/api/v1/form-425c/:id/mark-filed` | `apps/backend/src/compliance/form-425c.routes.ts:856` | — | — | — |
| create | `/api/v1/form-425c/profiles` | `apps/backend/src/compliance/form-425c.routes.ts:424` | — | — | — |

### settlements — 7 create-surface(s)

| kind | endpoint | route file | created | registered | gap |
|---|---|---|---|---|---|
| create | `/api/v1/settlements` | `apps/backend/src/driver-finance/settlements-mvp.routes.ts:131` | — | — | — |
| nested | `/api/v1/settlements/:id/disputes` | `apps/backend/src/settlements/disputes/disputes.routes.ts:407` | — | — | — |
| create | `/api/v1/settlements/approve-line` | `apps/backend/src/settlements/approval.routes.ts:111` | — | — | — |
| create | `/api/v1/settlements/finalize` | `apps/backend/src/settlements/approval.routes.ts:194` | — | — | — |
| create | `/api/v1/settlements/generate-pdf` | `apps/backend/src/settlements/approval.routes.ts:291` | — | — | — |
| create | `/api/v1/settlements/reject-line` | `apps/backend/src/settlements/approval.routes.ts:140` | — | — | — |
| create | `/api/v1/settlements/weekly-close` | `apps/backend/src/driver-finance/weekly-close.routes.ts:210` | — | — | — |

### customers — 7 create-surface(s)

| kind | endpoint | route file | created | registered | gap |
|---|---|---|---|---|---|
| nested | `/api/v1/customers/:customer_id/contacts` | `apps/backend/src/mdata/customer-detail-alias.routes.ts:22` | — | — | — |
| nested | `/api/v1/customers/:customer_id/lanes` | `apps/backend/src/mdata/customer-detail-alias.routes.ts:43` | — | — | — |
| nested | `/api/v1/customers/:customerId/factor` | `apps/backend/src/factoring/factor.routes.ts:407` | — | — | — |
| nested | `/api/v1/customers/:id/flag-duplicate` | `apps/backend/src/mdata/reclassify.routes.ts:134` | — | — | — |
| nested | `/api/v1/customers/:id/payments` | `apps/backend/src/accounting/customer-payments.routes.ts:130` | — | — | — |
| nested | `/api/v1/customers/:id/portal-users` | `apps/backend/src/shipper-portal/portal-users-admin.routes.ts:69` | — | — | — |
| nested | `/api/v1/customers/:id/reclassify` | `apps/backend/src/mdata/reclassify.routes.ts:47` | — | — | — |

### factoring — 6 create-surface(s)

| kind | endpoint | route file | created | registered | gap |
|---|---|---|---|---|---|
| create | `/api/v1/factoring/batches` | `apps/backend/src/factoring/batch.routes.ts:58` | — | — | — |
| create | `/api/v1/factoring/factors` | `apps/backend/src/factoring/factor.routes.ts:178` | — | — | — |
| nested | `/api/v1/factoring/factors/:id/letter-of-release` | `apps/backend/src/factoring/factor.routes.ts:369` | — | — | — |
| create | `/api/v1/factoring/faro-imports` | `apps/backend/src/data-infra/data-infra.routes.ts:165` | — | — | — |
| create | `/api/v1/factoring/import/faro` | `apps/backend/src/factoring/faro-csv-import.routes.ts:16` | — | — | — |
| create | `/api/v1/factoring/submission-queue/submit-batch` | `apps/backend/src/factoring/submission-queue.routes.ts:46` | — | — | — |

### ifta — 5 create-surface(s)

| kind | endpoint | route file | created | registered | gap |
|---|---|---|---|---|---|
| create | `/api/v1/ifta/preparations` | `apps/backend/src/ifta/ifta-quarterly-preparer.routes.ts:56` | — | — | — |
| nested | `/api/v1/ifta/preparations/:id/aggregate-gallons` | `apps/backend/src/ifta/ifta-quarterly-preparer.routes.ts:153` | — | — | — |
| nested | `/api/v1/ifta/preparations/:id/aggregate-miles` | `apps/backend/src/ifta/ifta-quarterly-preparer.routes.ts:109` | — | — | — |
| nested | `/api/v1/ifta/preparations/:id/calculate-tax` | `apps/backend/src/ifta/ifta-quarterly-preparer.routes.ts:196` | — | — | — |
| nested | `/api/v1/ifta/preparations/:id/generate-csv` | `apps/backend/src/ifta/ifta-quarterly-preparer.routes.ts:263` | — | — | — |

### scheduled-reports — 5 create-surface(s)

| kind | endpoint | route file | created | registered | gap |
|---|---|---|---|---|---|
| create | `/api/v1/scheduled-reports` | `apps/backend/src/scheduled-reports/scheduled-reports.routes.ts:171` | — | — | — |
| nested | `/api/v1/scheduled-reports/:id/pause` | `apps/backend/src/scheduled-reports/scheduled-reports.routes.ts:385` | — | — | — |
| nested | `/api/v1/scheduled-reports/:id/resume` | `apps/backend/src/scheduled-reports/scheduled-reports.routes.ts:426` | — | — | — |
| nested | `/api/v1/scheduled-reports/:id/send-now` | `apps/backend/src/scheduled-reports/scheduled-reports.routes.ts:479` | — | — | — |
| create | `/api/v1/scheduled-reports/test-send` | `apps/backend/src/scheduled-reports/scheduled-reports.routes.ts:554` | — | — | — |

### driver-pay — 5 create-surface(s)

| kind | endpoint | route file | created | registered | gap |
|---|---|---|---|---|---|
| nested | `/api/v1/driver-pay/settlements/:id/mark-bounced` | `apps/backend/src/driver-finance/settlement-payment.routes.ts:119` | — | — | — |
| nested | `/api/v1/driver-pay/settlements/:id/mark-cleared` | `apps/backend/src/driver-finance/settlement-payment.routes.ts:103` | — | — | — |
| nested | `/api/v1/driver-pay/settlements/:id/mark-paid-manually` | `apps/backend/src/driver-finance/settlement-payment.routes.ts:137` | — | — | — |
| nested | `/api/v1/driver-pay/settlements/:id/mark-sent` | `apps/backend/src/driver-finance/settlement-payment.routes.ts:85` | — | — | — |
| nested | `/api/v1/driver-pay/settlements/:id/queue-payment` | `apps/backend/src/driver-finance/settlement-payment.routes.ts:69` | — | — | — |

### master-data — 5 create-surface(s)

| kind | endpoint | route file | created | registered | gap |
|---|---|---|---|---|---|
| nested | `/api/v1/master-data/drivers/:id/link-qbo-vendor` | `apps/backend/src/integrations/qbo/qbo-vendor-linkage.routes.ts:167` | — | — | — |
| nested | `/api/v1/master-data/trailers/:id/link-qbo-class` | `apps/backend/src/integrations/qbo/qbo-vendor-linkage.routes.ts:225` | — | — | — |
| nested | `/api/v1/master-data/trailers/:id/unlink-qbo-class` | `apps/backend/src/integrations/qbo/qbo-vendor-linkage.routes.ts:278` | — | — | — |
| nested | `/api/v1/master-data/units/:id/link-qbo-class` | `apps/backend/src/integrations/qbo/qbo-vendor-linkage.routes.ts:199` | — | — | — |
| nested | `/api/v1/master-data/units/:id/unlink-qbo-class` | `apps/backend/src/integrations/qbo/qbo-vendor-linkage.routes.ts:261` | — | — | — |

### bank-recon — 4 create-surface(s)

| kind | endpoint | route file | created | registered | gap |
|---|---|---|---|---|---|
| create | `/api/v1/bank-recon/accept-match` | `apps/backend/src/accounting/bank-recon/recon-worklist.routes.ts:69` | — | — | — |
| create | `/api/v1/bank-recon/close-period` | `apps/backend/src/accounting/bank-recon/recon-worklist.routes.ts:138` | — | — | — |
| create | `/api/v1/bank-recon/manual-match` | `apps/backend/src/accounting/bank-recon/recon-worklist.routes.ts:112` | — | — | — |
| create | `/api/v1/bank-recon/reject-match` | `apps/backend/src/accounting/bank-recon/recon-worklist.routes.ts:95` | — | — | — |

### chat — 4 create-surface(s)

| kind | endpoint | route file | created | registered | gap |
|---|---|---|---|---|---|
| create | `/api/v1/chat/attachments/presign` | `apps/backend/src/chat/chat.routes.ts:111` | — | — | — |
| nested | `/api/v1/chat/messages/:id/receipt` | `apps/backend/src/chat/chat.routes.ts:102` | — | — | — |
| nested | `/api/v1/chat/threads/:id/messages` | `apps/backend/src/chat/chat.routes.ts:90` | — | — | — |
| create | `/api/v1/chat/threads/for-load` | `apps/backend/src/chat/chat.routes.ts:65` | — | — | — |

### docs — 4 create-surface(s)

| kind | endpoint | route file | created | registered | gap |
|---|---|---|---|---|---|
| nested | `/api/v1/docs/files/:file_id/links` | `apps/backend/src/docs/files.routes.ts:645` | — | — | — |
| nested | `/api/v1/docs/files/:file_id/upload-complete` | `apps/backend/src/docs/files.routes.ts:301` | — | — | — |
| nested | `/api/v1/docs/files/:file_id/versions` | `apps/backend/src/docs/files.routes.ts:828` | — | — | — |
| create | `/api/v1/docs/files/upload-url` | `apps/backend/src/docs/files.routes.ts:180` | — | — | — |

### fuel — 3 create-surface(s)

| kind | endpoint | route file | created | registered | gap |
|---|---|---|---|---|---|
| create | `/api/v1/fuel/card-overage-events/reprocess` | `apps/backend/src/fuel/fuel-card-overage.routes.ts:245` | — | — | — |
| create | `/api/v1/fuel/gl/reflush-unposted` | `apps/backend/src/fuel/fuel-gl-reflush.routes.ts:26` | — | — | — |
| nested | `/api/v1/fuel/planner/recommendations/:id/send-to-driver` | `apps/backend/src/fuel/planner.routes.ts:216` | — | — | — |

### notifications — 3 create-surface(s)

| kind | endpoint | route file | created | registered | gap |
|---|---|---|---|---|---|
| nested | `/api/v1/notifications/:id/dismiss` | `apps/backend/src/notifications/notifications.routes.ts:45` | — | — | — |
| nested | `/api/v1/notifications/:id/read` | `apps/backend/src/notifications/notifications.routes.ts:23` | — | — | — |
| create | `/api/v1/notifications/mark-all-read` | `apps/backend/src/notifications/notifications.routes.ts:68` | — | — | — |

### safety-docs — 3 create-surface(s)

| kind | endpoint | route file | created | registered | gap |
|---|---|---|---|---|---|
| create | `/api/v1/safety-docs` | `apps/backend/src/safetydoc/safetydoc.routes.ts:15` | — | — | — |
| nested | `/api/v1/safety-docs/assignments/:id/read` | `apps/backend/src/safetydoc/safetydoc.routes.ts:108` | — | — | — |
| nested | `/api/v1/safety-docs/assignments/:id/sign` | `apps/backend/src/safetydoc/safetydoc.routes.ts:131` | — | — | — |

### driver-pwa — 3 create-surface(s)

| kind | endpoint | route file | created | registered | gap |
|---|---|---|---|---|---|
| nested | `/api/v1/driver-pwa/transfers/:id/ack-dropoff` | `apps/backend/src/mdata/equipment-transfer.routes.ts:185` | — | — | — |
| nested | `/api/v1/driver-pwa/transfers/:id/ack-pickup` | `apps/backend/src/mdata/equipment-transfer.routes.ts:207` | — | — | — |
| nested | `/api/v1/driver-pwa/transfers/:id/confirm` | `apps/backend/src/mdata/equipment-transfer.routes.ts:229` | — | — | — |

### loads — 3 create-surface(s)

| kind | endpoint | route file | created | registered | gap |
|---|---|---|---|---|---|
| nested | `/api/v1/loads/:id/team-split` | `apps/backend/src/settlements/team-splits/team-splits.routes.ts:297` | — | — | — |
| nested | `/api/v1/loads/:loadId/abandonment` | `apps/backend/src/mdata/load-abandonment.routes.ts:35` | — | — | — |
| nested | `/api/v1/loads/:loadId/stops` | `apps/backend/src/dispatch/dispatch-refinements.routes.ts:189` | — | — | — |

### vendors — 3 create-surface(s)

| kind | endpoint | route file | created | registered | gap |
|---|---|---|---|---|---|
| nested | `/api/v1/vendors/:id/bill-payments` | `apps/backend/src/accounting/vendor-bill-payments.routes.ts:152` | — | — | — |
| nested | `/api/v1/vendors/:id/flag-duplicate` | `apps/backend/src/mdata/reclassify.routes.ts:269` | — | — | — |
| nested | `/api/v1/vendors/:id/reclassify` | `apps/backend/src/mdata/reclassify.routes.ts:182` | — | — | — |

### attachments — 2 create-surface(s)

| kind | endpoint | route file | created | registered | gap |
|---|---|---|---|---|---|
| nested | `/api/v1/attachments/:id/finalize` | `apps/backend/src/documents/attachments.routes.ts:134` | — | — | — |
| create | `/api/v1/attachments/upload-url` | `apps/backend/src/documents/attachments.routes.ts:109` | — | — | — |

### cash-advances — 2 create-surface(s)

| kind | endpoint | route file | created | registered | gap |
|---|---|---|---|---|---|
| create | `/api/v1/cash-advances` | `apps/backend/src/cash-advances/cash-advances.routes.ts:309` | — | — | — |
| nested | `/api/v1/cash-advances/hub/requests/:id/deny` | `apps/backend/src/cash-advances/driver-hub-requests.routes.ts:89` | — | — | — |

### customer-contracts — 2 create-surface(s)

| kind | endpoint | route file | created | registered | gap |
|---|---|---|---|---|---|
| create | `/api/v1/customer-contracts` | `apps/backend/src/customer-contracts/customer-contract.routes.ts:52` | — | — | — |
| nested | `/api/v1/customer-contracts/:id/supersede` | `apps/backend/src/customer-contracts/customer-contract.routes.ts:176` | — | — | — |

### daily-tasks — 2 create-surface(s)

| kind | endpoint | route file | created | registered | gap |
|---|---|---|---|---|---|
| create | `/api/v1/daily-tasks` | `apps/backend/src/daily-tasks/daily-tasks.routes.ts:31` | — | — | — |
| nested | `/api/v1/daily-tasks/:id/accept` | `apps/backend/src/daily-tasks/daily-tasks.routes.ts:90` | — | — | — |

### driver-alerts — 2 create-surface(s)

| kind | endpoint | route file | created | registered | gap |
|---|---|---|---|---|---|
| create | `/api/v1/driver-alerts` | `apps/backend/src/driveralert/driveralert.routes.ts:15` | — | — | — |
| nested | `/api/v1/driver-alerts/:id/re-alarm` | `apps/backend/src/driveralert/driveralert.routes.ts:142` | — | — | — |

### email — 2 create-surface(s)

| kind | endpoint | route file | created | registered | gap |
|---|---|---|---|---|---|
| nested | `/api/v1/email/queue/:id/retry-now` | `apps/backend/src/email/email.routes.ts:125` | — | — | — |
| create | `/api/v1/email/test` | `apps/backend/src/email/email.routes.ts:47` | — | — | — |

### expenses — 2 create-surface(s)

| kind | endpoint | route file | created | registered | gap |
|---|---|---|---|---|---|
| create | `/api/v1/expenses` | `apps/backend/src/accounting/expenses.routes.ts:446` | — | — | — |
| nested | `/api/v1/expenses/:expenseId/reattribute` | `apps/backend/src/accounting/expenses.routes.ts:809` | — | — | — |

### finance — 2 create-surface(s)

| kind | endpoint | route file | created | registered | gap |
|---|---|---|---|---|---|
| create | `/api/v1/finance/calculator/compute` | `apps/backend/src/finance/calculator/routes.ts:13` | — | — | — |
| create | `/api/v1/finance/loans` | `apps/backend/src/finance/amortization/routes.ts:20` | — | — | — |

### governance — 2 create-surface(s)

| kind | endpoint | route file | created | registered | gap |
|---|---|---|---|---|---|
| create | `/api/v1/governance/void-cancel-requests` | `apps/backend/src/governance/void-cancel-requests.routes.ts:103` | — | — | — |
| nested | `/api/v1/governance/void-cancel-requests/:id/deny` | `apps/backend/src/governance/void-cancel-requests.routes.ts:308` | — | — | — |

### maint — 2 create-surface(s)

| kind | endpoint | route file | created | registered | gap |
|---|---|---|---|---|---|
| create | `/api/v1/maint/parts` | `apps/backend/src/maint/parts.routes.ts:91` | — | — | — |
| create | `/api/v1/maint/pm/schedules` | `apps/backend/src/maint/pm.routes.ts:170` | — | — | — |

### portal — 2 create-surface(s)

| kind | endpoint | route file | created | registered | gap |
|---|---|---|---|---|---|
| create | `/api/v1/portal/auth/forgot-password` | `apps/backend/src/shipper-portal/portal-auth.routes.ts:116` | — | — | — |
| create | `/api/v1/portal/auth/reset-password` | `apps/backend/src/shipper-portal/portal-auth.routes.ts:170` | — | — | — |

### road-service-tickets — 2 create-surface(s)

| kind | endpoint | route file | created | registered | gap |
|---|---|---|---|---|---|
| create | `/api/v1/road-service-tickets` | `apps/backend/src/maintenance/road-service/tickets.routes.ts:125` | — | — | — |
| nested | `/api/v1/road-service-tickets/:id/create-wo` | `apps/backend/src/maintenance/road-service/tickets.routes.ts:249` | — | — | — |

### tax-documents — 2 create-surface(s)

| kind | endpoint | route file | created | registered | gap |
|---|---|---|---|---|---|
| nested | `/api/v1/tax-documents/1099-nec/:id/render-pdf` | `apps/backend/src/tax-documents/tax-documents.routes.ts:226` | — | — | — |
| create | `/api/v1/tax-documents/1099-nec/generate-batch` | `apps/backend/src/tax-documents/tax-documents.routes.ts:81` | — | — | — |

### work-orders — 2 create-surface(s)

| kind | endpoint | route file | created | registered | gap |
|---|---|---|---|---|---|
| create | `/api/v1/work-orders` | `apps/backend/src/work-orders/work-orders.routes.ts:613` | — | — | — |
| nested | `/api/v1/work-orders/:id/photos` | `apps/backend/src/work-orders/work-orders.routes.ts:1310` | — | — | — |

### units — 2 create-surface(s)

| kind | endpoint | route file | created | registered | gap |
|---|---|---|---|---|---|
| nested | `/api/units/:unit_uuid/permits` | `apps/backend/src/master-data/units/permits/routes.ts:76` | — | — | — |
| nested | `/api/units/:unit_uuid/toll-tags` | `apps/backend/src/master-data/units/toll-tags/routes.ts:75` | — | — | — |

### disputes — 2 create-surface(s)

| kind | endpoint | route file | created | registered | gap |
|---|---|---|---|---|---|
| nested | `/api/v1/disputes/:disputeId/decide` | `apps/backend/src/accounting/disputes.routes.ts:124` | — | — | — |
| nested | `/api/v1/disputes/:disputeId/start-review` | `apps/backend/src/accounting/disputes.routes.ts:103` | — | — | — |

### ap — 1 create-surface(s)

| kind | endpoint | route file | created | registered | gap |
|---|---|---|---|---|---|
| create | `/api/v1/ap/bill-payments` | `apps/backend/src/ap/payment-application.routes.ts:69` | — | — | — |

### assets — 1 create-surface(s)

| kind | endpoint | route file | created | registered | gap |
|---|---|---|---|---|---|
| create | `/api/v1/assets` | `apps/backend/src/assets/assets.routes.ts:249` | — | — | — |

### assignments — 1 create-surface(s)

| kind | endpoint | route file | created | registered | gap |
|---|---|---|---|---|---|
| create | `/api/v1/assignments/quicksave` | `apps/backend/src/assignments/quicksave.routes.ts:86` | — | — | — |

### auto-deductions — 1 create-surface(s)

| kind | endpoint | route file | created | registered | gap |
|---|---|---|---|---|---|
| create | `/api/v1/auto-deductions/policies` | `apps/backend/src/settlements/auto-deductions/policy.routes.ts:65` | — | — | — |

### bill-payments — 1 create-surface(s)

| kind | endpoint | route file | created | registered | gap |
|---|---|---|---|---|---|
| create | `/api/v1/bill-payments/cc` | `apps/backend/src/bill-payments/cc-payment.routes.ts:36` | — | — | — |

### border-crossing — 1 create-surface(s)

| kind | endpoint | route file | created | registered | gap |
|---|---|---|---|---|---|
| create | `/api/v1/border-crossing/wizard` | `apps/backend/src/border-crossing/border-crossing-wizard.routes.ts:104` | — | — | — |

### broker-profiles — 1 create-surface(s)

| kind | endpoint | route file | created | registered | gap |
|---|---|---|---|---|---|
| create | `/api/v1/broker-profiles` | `apps/backend/src/brokerupdate/brokerupdate.routes.ts:15` | — | — | — |

### broker-updates — 1 create-surface(s)

| kind | endpoint | route file | created | registered | gap |
|---|---|---|---|---|---|
| create | `/api/v1/broker-updates` | `apps/backend/src/brokerupdate/brokerupdate.routes.ts:70` | — | — | — |

### cash-flow — 1 create-surface(s)

| kind | endpoint | route file | created | registered | gap |
|---|---|---|---|---|---|
| create | `/api/v1/cash-flow/adjustments` | `apps/backend/src/cash-flow/cash-flow.routes.ts:82` | — | — | — |

### dashcam — 1 create-surface(s)

| kind | endpoint | route file | created | registered | gap |
|---|---|---|---|---|---|
| create | `/api/v1/dashcam/request-clip` | `apps/backend/src/telematics/dashcam-on-demand.routes.ts:43` | — | — | — |

### driver-teams — 1 create-surface(s)

| kind | endpoint | route file | created | registered | gap |
|---|---|---|---|---|---|
| create | `/api/v1/driver-teams` | `apps/backend/src/mdata/driver-team-split.routes.ts:82` | — | — | — |

### drivers — 1 create-surface(s)

| kind | endpoint | route file | created | registered | gap |
|---|---|---|---|---|---|
| create | `/api/v1/drivers/document-alerts/evaluate` | `apps/backend/src/drivers/document-alerts.routes.ts:109` | — | — | — |

### forecast — 1 create-surface(s)

| kind | endpoint | route file | created | registered | gap |
|---|---|---|---|---|---|
| create | `/api/v1/forecast/cash-entries` | `apps/backend/src/forecast/cash-forecast-manual.routes.ts:93` | — | — | — |

### lists — 1 create-surface(s)

| kind | endpoint | route file | created | registered | gap |
|---|---|---|---|---|---|
| create | `/api/v1/lists/force-qbo-sync` | `apps/backend/src/lists/lists-hub.routes.ts:147` | — | — | — |

### load-templates — 1 create-surface(s)

| kind | endpoint | route file | created | registered | gap |
|---|---|---|---|---|---|
| create | `/api/v1/load-templates` | `apps/backend/src/dispatch/dispatch-refinements.routes.ts:263` | — | — | — |

### mx-permits — 1 create-surface(s)

| kind | endpoint | route file | created | registered | gap |
|---|---|---|---|---|---|
| create | `/api/v1/mx-permits` | `apps/backend/src/mexico-ops/mx-permits.routes.ts:94` | — | — | — |

### mx-tolls — 1 create-surface(s)

| kind | endpoint | route file | created | registered | gap |
|---|---|---|---|---|---|
| create | `/api/v1/mx-tolls` | `apps/backend/src/mexico-ops/mx-tolls.routes.ts:111` | — | — | — |

### onboarding — 1 create-surface(s)

| kind | endpoint | route file | created | registered | gap |
|---|---|---|---|---|---|
| create | `/api/v1/onboarding/seed-sample-data` | `apps/backend/src/onboarding/state.routes.ts:232` | — | — | — |

### org — 1 create-surface(s)

| kind | endpoint | route file | created | registered | gap |
|---|---|---|---|---|---|
| create | `/api/v1/org/user-company-access` | `apps/backend/src/org/companies.routes.ts:162` | — | — | — |

### payroll — 1 create-surface(s)

| kind | endpoint | route file | created | registered | gap |
|---|---|---|---|---|---|
| create | `/api/v1/payroll/driver-settlements/compute` | `apps/backend/src/payroll/driver-settlement.routes.ts:26` | — | — | — |

### program — 1 create-surface(s)

| kind | endpoint | route file | created | registered | gap |
|---|---|---|---|---|---|
| create | `/api/v1/program/board/notes` | `apps/backend/src/program/program-board.routes.ts:27` | — | — | — |

### team-splits — 1 create-surface(s)

| kind | endpoint | route file | created | registered | gap |
|---|---|---|---|---|---|
| create | `/api/v1/team-splits/configs` | `apps/backend/src/settlements/team-splits/team-splits.routes.ts:201` | — | — | — |

### telematics — 1 create-surface(s)

| kind | endpoint | route file | created | registered | gap |
|---|---|---|---|---|---|
| create | `/api/v1/telematics/geofences` | `apps/backend/src/telematics/geofences.routes.ts:191` | — | — | — |

### time-entries — 1 create-surface(s)

| kind | endpoint | route file | created | registered | gap |
|---|---|---|---|---|---|
| create | `/api/v1/time-entries` | `apps/backend/src/maintenance/labor.routes.ts:266` | — | — | — |

### usmca — 1 create-surface(s)

| kind | endpoint | route file | created | registered | gap |
|---|---|---|---|---|---|
| create | `/api/v1/usmca/activation/transition` | `apps/backend/src/usmca/activation/activation.routes.ts:46` | — | — | — |

### abandonment-chargebacks — 1 create-surface(s)

| kind | endpoint | route file | created | registered | gap |
|---|---|---|---|---|---|
| nested | `/api/v1/abandonment-chargebacks/:id/dispute` | `apps/backend/src/driver-finance/abandonment.routes.ts:122` | — | — | — |

### equipment-transfers — 1 create-surface(s)

| kind | endpoint | route file | created | registered | gap |
|---|---|---|---|---|---|
| nested | `/api/v1/equipment-transfers/:id/confirm` | `apps/backend/src/mdata/equipment-transfer.routes.ts:116` | — | — | — |

### equipment — 1 create-surface(s)

| kind | endpoint | route file | created | registered | gap |
|---|---|---|---|---|---|
| nested | `/api/v1/equipment/:id/initiate-transfer` | `apps/backend/src/mdata/equipment-transfer.routes.ts:89` | — | — | — |

### integrity — 1 create-surface(s)

| kind | endpoint | route file | created | registered | gap |
|---|---|---|---|---|---|
| nested | `/api/v1/integrity/anomalies/:id/dismiss` | `apps/backend/src/integrity/anomaly-status.routes.ts:281` | — | — | — |

### liabilities — 1 create-surface(s)

| kind | endpoint | route file | created | registered | gap |
|---|---|---|---|---|---|
| nested | `/api/v1/liabilities/:id/send-ack-request` | `apps/backend/src/liabilities/liabilities.routes.ts:188` | — | — | — |

### owner-approval — 1 create-surface(s)

| kind | endpoint | route file | created | registered | gap |
|---|---|---|---|---|---|
| nested | `/api/v1/owner-approval/:token/deny` | `apps/backend/src/driver-finance/owner-approval.routes.ts:54` | — | — | — |

## MANIFEST — created rows (THIS LIST IS THE VOID LIST)

Every row below is real, in PRODUCTION USMCA, created through the live API as Owner. Marker
`CC2-BATTERY-20260807`. Void by UUID before Monday (WORM reversing entries — never DELETE), then hand
this table to CC-3/GUARD to confirm USMCA's GL nets to ZERO for all battery activity.

| # | table | txn type | UUID | JE id | created | registered | error |
|---:|---|---|---|---|:---:|:---:|---|
| 1 | `mdata.vendors` | vendor (master) | `a4f40fba-dd17-4b08-abbd-93a346c00e7f` | — masters post no JE | **y** | pending CC-3 | — |
| 2 | `mdata.customers` | customer (master) | `45226738-fcfa-40f0-944d-574e6725bcd6` | — | **y** | pending CC-3 | — |
| 3 | `catalogs.classes` | class (catalog) | `ff404f39-75a0-4ca0-b132-2f809df0458b` | — | **y** | pending CC-3 | — |
| 4 | `mdata.maintenance_services` | maintenance service (catalog) | `2ff79ae3-6205-416b-9fec-6fd84aa98757` | — | **y** | pending CC-3 | — |
| 5 | `catalogs.accounts` | GL account (catalog) | `05cf308d-5444-4387-8e1f-caf5ba645642` | — | **y** | pending CC-3 | — |
| 6 | `catalogs.items` | item (catalog) | `88e32da9-427e-46ee-9584-f09f6e6607a8` | — | **y** | pending CC-3 | — |
| 7 | `catalogs.dispatch_flag_colors` | dispatch flag colour | `60647861-53a2-4157-b37c-813baef8d960` | — | **y** | pending CC-3 | — |
| 8 | `catalogs.driver_load_statuses` | driver load status | `fd616582-7159-4522-bfab-95b09bc1dbde` | — | **y** | pending CC-3 | — |
| 9 | `catalogs.load_cancellation_reasons` | load cancellation reason | `caaef06b-66ef-48ff-aaa1-5e3ff45d5b01` | — | **y** | pending CC-3 | — |
| 10 | `catalogs.driver_termination_reasons` | termination reason | `249e5fb1-db73-4887-b150-714cbe336627` | — | **y** | pending CC-3 | — |
| 11 | `catalogs.cargo_claim_reasons` | cargo claim reason | `5462a833-487a-4c41-a9a2-48df115835a6` | — | **y** | pending CC-3 | — |
| 12 | `catalogs.civil_fine_types` | civil fine type | `8e283867-91b8-4c18-8939-7117ffb5957e` | — | **y** | pending CC-3 | — |
| 13 | `catalogs.company_violation_types` | company violation type | `718819c7-9e8b-4133-bd2a-2b105be3b806` | — | **y** | pending CC-3 | — |
| 14 | `catalogs.complaint_types` | complaint type | `ad4decd3-79fd-4413-b9de-e1d4d956abc1` | — | **y** | pending CC-3 | — |
| 15 | `catalogs.dot_violation_types` | DOT violation type | `ef096ca9-8c19-48d4-9983-5f9c4dbd5e3a` | — | **y** | pending CC-3 | — |
| 16 | `catalogs.internal_fine_reasons` | internal fine reason | `7b605739-f37e-48ba-a8da-d156554d0fe0` | — | **y** | pending CC-3 | — |
| 17 | `catalogs.void_cancel_reasons` | void/cancel reason | `90d1e200-18cb-4376-bcb7-4b361104e620` | — | **y** | pending CC-3 | — |
| 18 | `catalogs.file_categories` | file category | `8a308ecc-373f-4b36-9d24-8ffe5aa4c105` | — | **y** | pending CC-3 | — |
| 19 | `mdata.maintenance_parts` | maintenance part | `a1259683-b656-4f52-8bd9-b4e0b91a9dad` | — | **y** | pending CC-3 | — |
| 20 | `mdata.loads` | **LOAD (operating path)** `LUSMCAFREIGHT-20260807-0001` | `8d576d23-9b82-4474-b76f-d2640e6e13f7` | — draft, no JE yet | **y** | pending CC-3 | — |
| 21 | `accounting.bills` | **vendor bill (money — first JE-posting surface)** `BILL-2026-00023` | `061bf94d-bab4-4e10-aa5e-e126b47dbc72` | `bb5b9b63-da45-4b16-a068-dc7066f459ff` | **y** | **y — VOIDED 2026-08-28** | — |
| 22 | `safety.civil_fines` | **driver fine → liability (money-chain surface, first-ever live exercise — 0 prior conversions existed anywhere)** DOT Speeding, driver Neftali Coronado Urbano | `b05cc2db-b3a5-4826-9b9b-aa5020da8fc1` | — no JE yet, correctly deferred | **y** | **y — see FINDING SAFETY-MONEY-FINE-CONVERT-DROPS-DRIVER-LABEL below** | — |

**Row 22 (2026-09-07, CC-3):** the next untested money surface in dependency order after row 21
(invoice/AR, expense, fuel, settlement, advance, deduction, escrow, WO, factoring, claim were all
independently confirmed live-tested elsewhere by 2026-09-07 — see the cross-session coverage audit
this session ran against `docs/audit/GUARD-WORKORDERS.md`). Created a real $75.00 DOT/Speeding civil
fine for driver Neftali Coronado Urbano via the live `+ Create Fine` UI
(`/safety/external-fines`), marked `CC2-BATTERY-20260907` in its violation description/notes per the
established battery convention, held per the owner's 2026-08-29 standing rule (not voided). Converted
it to a driver liability via the live "Convert to Driver Liability" action — **PASS end to end**:
`safety.civil_fines.converted_to_liability_id` → `driver_finance.driver_liabilities`
`ed9aa15c-6083-43c7-b2d7-b335a6a18781` (type `civil_fine`, `$75.00`, status `pending_recovery`) →
`driver_finance.driver_settlement_deductions` `9784c5df-4bd5-4ee6-8fa8-ff370fc14c6e` (`deduction_type`
`fine`, status `pending`, `applied_to_settlement_id` NULL). No JE posted yet — correct: per
`settlement-payrun-close.service.ts`, the deduction posts its GL leg only when a real settlement run
closes and includes it, same architecture as the already-tested settlement/deduction surfaces. This is
the first real evidence that the fine→liability chain (previously found abandoned/never-exercised —
`SAFETY-MONEY-TRIAGE-INTERNAL-FINES-LIVE-CORRECTION`, GUARD-WORKORDERS.md) actually works.

**Live-caught FE defect, root-caused and fixed in the same pass:** converting the fine dropped the
driver's display name (`"Driver — not visible"` tombstone) and threw React error #185 (max update
depth) in the console — filed as **`SAFETY-MONEY-FINE-CONVERT-DROPS-DRIVER-LABEL`** on the board
(`docs/audit/GUARD-WORKORDERS.md`) with full root cause, fix, and a planted-regression test. See that
row for detail; not duplicated here.

**All 9 catalog/master rows above (1-20) — none posts a journal entry, so USMCA's GL was untouched by them.**
Row 21 (2026-08-28, CC-3) is the first MONEY surface exercised: DR 5400 Truck Repairs & Maintenance / CR 2000
Accounts Payable (A/P), $50.00, balanced. **Already voided** the same session (reversing JE
`85d414c2-a3b9-4757-ab1e-6d168e86cc88`, both accounts net to $0) — full evidence in
`docs/audit/LIVE-TXN-BATTERY-2026-08-06.md` LV-TXN-017. Rows 1-20's `registered` column stays `pending CC-3`
(unchanged by this session; those are the 2026-08-07 masters wave, already deactivated 2026-08-17).

### WIRING BUG FOUND BY THE BATTERY — `GET /api/v1/mdata/loads/:id` 500'd for EVERY load

Booking the first real USMCA load succeeded on attempt 1
(`8d576d23-9b82-4474-b76f-d2640e6e13f7`, `LUSMCAFREIGHT-20260807-0001`, USMCA-scoped, customer =
battery customer, status `draft`). Reading it back returned **500 — `42703: column "commodity" does not
exist`**.

**Root cause: three PHANTOM COLUMNS.** `mdata/loads.routes.ts:755` selected
`commodity, cargo_weight_lbs, reefer_setpoint_temp_f`. Verified against the PROD branch
(`information_schema`): `mdata.loads` has **none of the three**. The comment directly above them
asserted those exact names as fact — the schema disagreed. The real reefer setpoint is `reefer_temp_f`,
which the same SELECT already lists.

**Why it hid:** `GET /loads` (list) and `GET /dispatch/loads/:id` both return **200** — neither selects
those columns. Only the single-load mdata read was broken, so the surface looked healthy from two of its
three entry points. Nothing but creating a load and reading it back would have found it.

**Fixed:** phantom columns removed, `trip_type` retained. This is CLS-SCHEMA-DRIFT, the class the wave
queue already tracks.

*Footnote on the fix itself:* my first patch put backticks inside the `--` SQL comment, which closed the
JS template literal and produced a misleading `TS1005 ',' expected`. That is a trap I have already
documented for myself and walked into anyway — it is in my notes precisely because the error message
points nowhere near the cause.

### Adaptive-create rule classes — 4 rules unlocked 14 surfaces

The adaptive creator reads the server's own 400 `fieldErrors` and refills. Each failure it could not
handle turned out to be ONE missing rule affecting many surfaces, never a per-surface fix:

| rule added | surfaces it unlocked | evidence |
|---|---:|---|
| entity in the **QUERY STRING**, not only the body | 6 | all 6 safety catalogs returned `operating_company_id: expected string, received undefined` while it WAS in the body |
| lowercase code pattern `/^[a-z0-9_]+$/` | 3 | `code must be lowercase letters, digits, and underscores` |
| length caps from `Too big: expected string to have <=N characters` | 1 | `icon_label` capped at 10 |
| non-empty arrays (`expected array` / `to have >=1 items` are the same requirement) | 1 | `applies_to` |

Most surfaces now create in **2 attempts**. This is why the server's own validation error is a better
contract source than static schema parsing: it is authoritative, and it works on factory-generated
routes where no literal `z.object` exists in the route file.

### How this list was recovered — and the safety class it exposed

Three of the nine returned **201 with no id my extractor could read** (creators return variously
`{id}`, `{row:{}}`, `{data:{}}`, or a bare object). **A created row whose UUID is not captured is a row
that cannot be voided** — that is a safety defect, not a cosmetic one, and it would have left unmarked
rows in USMCA's live books on Monday.

Recovering them endpoint-by-endpoint would have been the per-site fix. The universal one is a **marker
sweep**: generate, from `information_schema`, a UNION over every table that has both an `id` and a
human-label column, filtered on the marker. One query finds every battery row regardless of which
endpoint made it or what that endpoint returned. **That sweep IS the void list**, and it is authoritative
in a way that parsing 503 different response shapes never could be.

## CORRECTION to my own earlier finding (recorded, not quietly dropped)

The scoreboard reported *"maintenance catalogs 404 unmounted"* and my first probe agreed. **Both were
wrong, and the guard-side reason matters more than the fix.** The endpoint is
`/api/v1/catalogs/maintenance/**services-catalog**`, which is mounted and serves GET *and* POST. My probe
invented the path `/services` and then read its own 404 as confirmation. A 404 only means "unmounted"
when the path is known-correct — otherwise it measures the guess, not the server.

`catalogs/fleet/tire-positions` IS a real gap, of a different kind: it defines **only a GET**. There is no
POST at all, so the create-surface does not exist rather than being unmounted.

## Known create-surface failures already proven live (2026-08-07)

| surface | live result | lane |
|---|---|---|
| `GET/POST /api/v1/catalogs/maintenance/services` | **404 — route not found** on the deployed API | CC-2 |
| fleet catalog create | **500** — reported as a trailing `--` SQL comment | CC-2 |
| payment-terms creator | **42701 duplicate column** | CC-2 / lists |
| `GET /api/v1/catalogs/fleet/tire-positions` | 200 `{rows:[],total:0}` — reachable, empty | — |
| `GET /api/v1/catalogs/maintenance/parts` | 200 with USMCA rows — reachable and populated | — |

