# FAC-10 — USMCA TEST/CODEX vendor inventory

Read-only production inventory on 2026-09-06. No vendor was deleted, voided, deactivated, or changed. Owner decides quarantine.

| id | vendor_name | created_at | created_by | is_sample_data | state | checked FK uses |
|---|---|---|---|---:|---|---:|
| 3e5cc896-63a5-43ee-8426-0976031e1e82 | CODEX-AUDIT-SPINE-VENDOR-20260816-0327 | 2026-08-16T08:27:07.957Z | e4117991-d2c0-406d-8cda-74e98d95bccd | false | deactivated 2026-08-17T01:15:10.695Z | 0 |
| 2fff082e-297f-42ef-b8d9-22a22504e61d | CODEX AUDIT-SPINE-DRIVER-20260816-0329 | 2026-08-16T08:35:51.314Z | e4117991-d2c0-406d-8cda-74e98d95bccd | false | deactivated 2026-08-17T01:15:10.695Z | 0 |
| 23048fd2-6dd7-4aca-af6d-2d8f522b1c8b | CODEX TEST Go0034 | 2026-09-02T13:13:00.571Z | e4117991-d2c0-406d-8cda-74e98d95bccd | false | active | 0 |
| 423ec4df-47cb-41d4-b67e-82e08eabfa24 | TEST CODEX 18756 | 2026-09-02T13:13:00.571Z | e4117991-d2c0-406d-8cda-74e98d95bccd | false | active | 0 |
| 53474f24-bb8c-4acb-ad08-689908de5627 | CODEX TEST 0034 Driver | 2026-09-02T13:13:00.571Z | e4117991-d2c0-406d-8cda-74e98d95bccd | false | active | 0 |
| 5b3d27fb-f524-4b61-b777-079d0ceafc36 | TEST CODEX ONBOARD 20260824 | 2026-09-02T13:13:00.571Z | e4117991-d2c0-406d-8cda-74e98d95bccd | false | active | 0 |
| 8e389a06-6f8b-4836-94a1-cf6dd1c83759 | TEST CODEX GO0034 | 2026-09-02T13:13:00.571Z | e4117991-d2c0-406d-8cda-74e98d95bccd | false | active | 0 |

Checked references: `accounting.bills.mdata_vendor_id`, `accounting.expenses.vendor_uuid`, `factoring.canonical_factor_agreements.factor_vendor_id`, `mdata.loads.factoring_company_vendor_id`, `mdata.customers.factoring_company_vendor_id`, `maintenance.work_orders.vendor_id/external_vendor_id`, `catalogs.maintenance_vendors.linked_vendor_id`, and vendor-payment-method vendor FKs. Each listed vendor had zero checked references.

Guard: `scripts/verify-usmca-no-active-test-vendors.mjs`. Its live mode fails while an unflagged matching vendor remains active; it never mutates data.
