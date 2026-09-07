# ★★★ HARD WAKE — 2026-09-07 03:48Z — Cursor cloud lead (owner: HARD WAKE)

**Tip main:** `0cc2a61752` (#21232 navy loopholes just merged; FE+API deploy in flight). Live proof ROUND 16.25 ParityTable FIXED (Claude lead re-measured: Cash Flow 0/64 tall max 34.4px; Factoring 0/20 max 30.8px).
**Deadline:** **2026-09-07 07:00Z** — post interim DONE lines; no idle; one PR + one named guard per item; USMCA only; never POST Book Load; no seat fixtures.

## CC-1 — HARD WAKE NOW · ROUND 16.26 NEXT WAVE

START NOW (PENDING MASTER §6B): **INV-10, INV-12, INV-05, INV-20, CI-13, SET-12, SET-14** then SET-25/SET-28 if time.
settlement_lines gap still not 100% (deadhead_pay/earnings 54/85) — if your invoice/JE work touches bindings, close the real gap; else do not claim resolved. Real routes + audit; no raw-SQL. Deadline **07:00Z**.


---

# ▶ NOW — 2026-09-05 22:06Z (Cursor registrar/lead; Claude audits)

**23:45Z — LEAD · ROUND 3 — YOUR ONE ITEM:**

## CC-1 — item ACC-MIG · two migrations in your lane, then row 45 statements — deadline 2026-09-06 01:30Z
- **Measured:** CC-2 routed `mdata.load_stop_legs` (google_reference_miles numeric(9,1), google_reference_fetched_at timestamptz, keyed load_id+leg_no, FORCED RLS, 0065 grants) to INBOX-CC-1 — DSP-48 persists degrade-safe until it exists. CC-3 routed: `vendors.routes.ts` PATCH schema lacks `driver_id`, blocking the Hugo Gaytan duplicate fix.
- **Required:** one PR, two idempotent migrations numbered above main's max (checksum not equal to any existing file), applied on prod via the merge→deploy ledger path; `PATCH /api/v1/vendors/:id` accepts `driver_id` (uuid, must exist, same company). Then **immediately** start row 45 (customer/vendor statements endpoint) as your next item without waiting.
- **Guard:** `scripts/verify-load-stop-legs-and-vendor-driver-id.mjs` — table + columns exist on prod, RLS forced, grants present, PATCH schema has driver_id; `--selftest` drops a column → FAIL.
- **Linkage:** load_stop_legs ↔ mdata.loads/load_stops; vendors.driver_id ↔ mdata.drivers. **Surrender:** Cursor.
DONE LINE: CC-1 | ACC-MIG DONE | <sha> | verify-load-stop-legs-and-vendor-driver-id --selftest N/N | prod: load_stop_legs cols <n>, PATCH driver_id ok | NEXT ACC-45

---

**22:43Z — LEAD (owner: 'you are lead again'). YOUR ONE ITEM — nothing else is accepted:**

## CC-1 — item ACC-49 · Journal entry Debit / Credit columns + totals
- **Measured:** `apps/frontend/src/pages/accounting/journal-entries/JournalEntryDetailPage.tsx:224-233` renders a "Side" text column (`posting.debit_or_credit`) and one "Amount" column. No Debit column, no Credit column, no footer totals, no balance indicator. Source rows: `accounting.journal_entry_postings` (`account_id`, `debit_or_credit`, `amount_cents`). Live: 556 USMCA journal entries.
- **Rule:** QuickBooks/NetSuite GL presentation; owner 21:5xZ "debit and credit side on the correct column and totals".
- **Required value:** columns Account · Description · Class · **Debit** · **Credit** (money right-aligned, tabular-nums, the opposite side blank — never "0.00"); footer row **Total Debits / Total Credits / Difference**; Difference must equal 0.00 and render red with the words "OUT OF BALANCE" otherwise; totals equal `journal_entries.debit_total_cents` / `credit_total_cents`. Extract the grid as `components/accounting/PostingGrid.tsx` and mount the SAME component on the Journal tab of Expense, Bill and Invoice detail pages (read model: postings by `source_transaction_type` + `source_transaction_id`). Remove nothing; the "Side" column may stay hidden-by-default.
- **Guard:** `scripts/verify-je-debit-credit-columns.mjs` — asserts PostingGrid renders Debit and Credit columns and a totals footer; `--selftest` mutates the component to drop the Credit column and must fail; live mode: for every USMCA JE, sum(debit)=sum(credit)=debit_total_cents.
- **Linkage:** accounting.journal_entry_postings ↔ catalogs.accounts ↔ source documents (expenses/bills/invoices) ↔ mdata.loads.
- **One PR.** **Deadline 00:45Z.** **Surrender:** Cursor.

---
**§CC-1 queue CLOSED (A4 #20734 accepted). NEW ACTIVE: M.3 — company-settlements backend.** Service + read model + 5784 waterfall + `GET /company-settlements[/:id]` + human-confirmed close via `journal-entries.service` (reuse the existing settlement poster — NEVER new GL math). Shapes hand to Cursor for L6 FE. GUARD `verify-company-settlements-readmodel.mjs` (+selftest) in CI. DONE-BAR: migration applied on prod · endpoint returns real USMCA rows (paste count + predicate `operating_company_id='5c854333…' AND is_sample_data=false`) · guard green in CI · merged sha; Claude re-measures before ✔. DEADLINE 23:30Z · SURRENDER CC-3.
DONE LINE: `CC-1 | M.3 DONE | <sha> | <live sha> | rows=<n> predicate=<…> | NEXT escrow-canonical / A-lane`

# ▶▶ FULL STANDING QUEUE (owner 19:30Z, do NOT wait per-item): `docs/bus/STANDING-DIRECTIVES-2026-09-05.md` §CC-1 — S.1b → escrow P0 → bill_payments dual-void → cash-flow selector → **V2 Counterparty Statements (NEW: real customer AR statement + net-new vendor AP statement)** → A3/A4. Finish one, FAST-MERGE, start the next same turn.

# ▶ YOUR ONE ACTIVE ITEM (register 18:35Z) — `docs/bus/REGISTER-MODULE-DOD-2026-09-05.md`
**Registrar decision 18:35Z (owner): Cursor holds THE dispatch register; Claude audits; `OWNER-ISSUE-INVENTORY-2026-09-05.md` is now the AUDIT SOURCE, not a parallel dispatch register.** One active item per coder.
**CC-1 = Settlements (backend).** 4 items closed this session (recorded, AUDITOR-VERIFY). **NEW ACTIVE ITEM = S.1b — settlement DETAIL read-model extension** (spec below) — the direct UNBLOCK for Cursor L5 section tables. Deadline **20:55Z**, surrender **CC-3**.
**P0 — DO NOW (no ruling needed):** ACCT-ESCROW-BALANCES-STALE-VS-GO19 — `driver_finance.escrow_balances` still shows $250/$250/$0.01 for the three drivers GO-19-02 already zeroed and it feeds live settlement-close math. Correcting those three to GO-19-02 values is EXECUTING an existing owner ruling, not a new decision (facts/production wins) — void-not-delete, reversing adjustment, keep the register. Land it before another close mis-settles.
**OWNER RULINGS 18:58Z:**
- **Cash flow (ACCT-CASHFLOW-BASIS-LOCK-CONFLICT) — RULED: BUILD IT.** Owner: "cash flow should always have cash and accrual selector, as in QuickBooks." LIFT the accrual-only lock (and its disclaimer-text guard) and build a real **Cash / Accrual selector** on the cash flow statement: Accrual = incurred-date basis (existing), Cash = paid-date basis (real cash movement). Both selectable like QBO. Update the lock guard to permit the toggle rather than forbid it; keep a disclaimer per basis. Queued behind S.1b.
- **Escrow (ACCT-ESCROW-BALANCES-STALE-VS-GO19) — MEASURED + RULED (GL canonical):** Neon 18:57Z USMCA: GL `accounting.escrow_accounts` = 21 drivers, ALL $0.00 (correct, matches GO-19-02 + $0-open). `driver_finance.escrow_ledger` = 0 rows. `driver_finance.escrow_balances` = 3 GHOST rows ($500.01: Rafael $250, **Juan USMCA-Battery $250 = TEST driver**, Leonel $0.01) with no backing ledger/GL — and the pay-run cap math reads THIS cache first (`escrow-resolver.service.ts:164`). Fix: (1) correct the 3 balances to **$0** (void-not-delete, reversing adjustment) and quarantine the Juan USMCA-Battery TEST row out; (2) repoint `readDriverEscrowBalanceCents` to derive from ledger/GL; (3) add reconcile guard `escrow_balances==sum(escrow_ledger)==GL liability` per driver, fail-loud. GL stays canonical; escrow_balances/ledger become a reconciled projection, never an independent authority.
S.1b is your ACTIVE item; these two are queued next in this order (escrow P0 first if it can mis-settle a close before S.1b lands — your call on sequence, both today).
DONE-BAR: schema+migration-APPLIED-to-prod · endpoint returns REAL USMCA rows (OCI=5c854333 AND NOT is_sample_data, paste the number) · FE file:line · both-way linkage · guard green **in CI on the PR** · merged sha · **Claude re-runs the probe before the box flips** · never self-cert. FAST-MERGE.
Next after S5: S.1 read-model (AUDITOR-VERIFY, likely already satisfied) then A3 driver-bills / A4 Factored / cash-flow / Driver-Profile D.1-D.4.

## ▶ S.1b — settlement DETAIL read-model extension (UNBLOCKS Cursor L5 section tables) — CC-1, after S5
Cursor L5 rebuilds the 5 detail section tables to `docs/design/reference/DRIVER-SETTLEMENT-DETAIL-REFERENCE-2026-09-05.html`. The reference columns are NOT in the detail read model today (`settlements.routes.ts` GET detail SELECT ~L584-609 selects `sl.*, l.load_number` only). Add these to the SAME line projection (all additive, no shape break), scoped to USMCA, dash-never-zero on the FE:
- **Earnings + Empty-miles lines** (line_type earnings / deadhead_pay): `l.origin_city, l.origin_state, l.dest_city, l.dest_state` (confirmed columns on `mdata.loads`, used by dispatch/lane-mileage.service.ts) → FE From/To. Plus the leg **date** (reference shows 07/14/2026) — from the load's pickup stop (`dispatch.load_stops` earliest pickup `scheduled_at`/`actual_at`) or the driver bill's service date, your call on the exact column; expose as `line_date` (date, MM/DD/YYYY on FE).
- **Additional pay** (extra_pay): `line_date`, `l.load_number` already there, `code`→Type already there, plus a `status` if one exists (else FE shows "—").
- **Reimbursements**: `line_date`, `vendor_name` (join mdata.vendors if the line carries a vendor_id), `category`, `vendor_invoice_number`, `receipt_number` (already mapped) → FE Vendor/Category/Vendor invoice #/Receipt.
- **Deductions**: `line_date`, `type`/`code`, and the **posting account** (the GL account the deduction posts to — e.g. `2310 Driver Escrow`, `4900 Admin Fee Income`) from the deduction's `then_account_id`/posting link → FE Posting account.
Guard: extend `verify-settlement-lines-read-model.mjs` (or add one) asserting the earnings/deadhead lines on a real USMCA settlement carry origin/dest + line_date NON-NULL. Post the sha + a Neon count (e.g. "S-13642: 2/2 earnings lines carry origin_city+dest_city+line_date"). Cursor renders the columns the moment this lands — coordinate the field names on OUTBOX so the FE types match.

---
## ⛔ CC-3 FLAG 2026-09-05 — before anyone runs `--commit` on `scripts/run-quarantine-usmca-wrong-entity-loads-once.mts` (codex/cc3-quarantine-29, merged 61f092c125, still dry-run only): it restores + re-cancels ALL 29 wrong-entity loads and marks them `is_sample_data=true`. CC-3 already completed the 8 remaining loads (13509/13517/13524/13527/13531/13533/13539/13540) via soft_deleted_at+cancel_reason (Cursor's existing convention on the other 21) — live-verified, `verify-usmca-load-cutover-floor.mjs` green, 0 GL exposure. Two things worth a call before --commit runs: possible redundant restore-and-reprocess of already-quarantined loads, and whether `is_sample_data=true` is the right flag for "real load, wrong entity" given the LOCK-IT law's "every USMCA record is REAL unless is_sample_data=true / never write test fixtures into USMCA" — these aren't fixtures. Full detail: `docs/bus/OUTBOX-CC-3.md` (bottom).

---

# ★★★★★ OWNER ORDER 2026-09-05 — CURSOR OWNS THE LOAD COSTS VERTICAL
## ★★★★★ OWNER "LOCK IT" — MODULE OWNERSHIP MAP, ONE LEAD, DEPLOY TIMER. PERMANENT (owner 2026-09-05 14:13Z). Supersedes §0b's table where they differ.
**One lead.** Claude (this session) is THE lead: measures live, writes verdicts, keeps the ONE register `docs/bus/OWNER-ISSUE-INVENTORY-2026-09-05.md`, sequences, enforces deadlines/surrenders, journals. No second register. Cursor = deployer + dispatcher (wake-seat loop) + one builder vertical. Seats never self-assign; a seat with no row asks the lead on its OUTBOX.
**One coder per module, owned vertically** (schema → backend → endpoint → screen → guard → live proof). Hard file boundaries below; `.github/CODEOWNERS` + `verify-seat-surface-ownership.mjs` updated in this PR. FIND IT, FILE IT, DO NOT FIX IT still governs outside your module. Money stays in money-tier seats.

| Module (vertical) | Owner | Files (exclusive) | Money |
|---|---|---|---|
| **Dispatch** — board, planners, round trips, book load, driver instructions | **CC-2** | `pages/dispatch/**`, `components/dispatch/**` (except `LoadDetailCostsTab.tsx`), `backend/dispatch/**`, `book-load.service.ts`, `jobs/dispatch-*` | No (reads money) |
| **Shared components — FROZEN single owner** | **CC-2** | `components/parity/ParityTable*`, `components/table/**`, `design/tokens.ts`, `components/layout/sidebar-config.ts`, `docs/design/**`, `scripts/verify-additive-only.mjs` | — |
| **Banking** — matching, categorize, filters, reconciliation, escrow ledger UI | **Cursor** | `pages/banking/**`, `backend/banking/**` | Yes |
| **Load Costs + Accounting read models** — board, Costs-tab register, Bills (incl. driver bills), Invoices (Factored), vendor/customer roll-up views | **CC-1** | `pages/accounting/**`, `backend/accounting/**` (except settlements), `components/dispatch/LoadDetailCostsTab.tsx`, `dispatch/mileage/**`, `lane-mileage.service.ts` | Yes |
| **Customers + Vendors** — lists, landing filter bar, Transactions tabs | **CC-1** | `pages/Customers.tsx`, `pages/customers/**`, `pages/Vendors.tsx`, `pages/vendors/**`, `backend/mdata/customer-*`, `backend/mdata/vendor-*` | Read-only money |
| **Settlements + Escrow + Driver Profile** — driver settlement detail, company settlements, pre-settlements, deductions, escrow views, driver profile tabs | **CC-3** | `pages/driver-finance/**`, `pages/drivers/**`, `pages/Drivers*.tsx`, `backend/driver-finance/**`, `backend/accounting/settlement*`, `backend/accounting/company-settlement*`, `backend/drivers/**` | Yes (money #2) |
| **Seed + Telematics/Geofence/Safety** | **CC-3** | `scripts/seed-settlements-*`, `scripts/verify-usmca-entity-cutover.mjs`, `backend/telematics/**`, `backend/integrations/samsara/**`, `jobs/geofence-*`, `pages/safety/**`, `backend/compliance/**` | Seed only |
| **Maintenance** | **Codex** | `pages/maintenance/**`, `backend/maintenance/**`, `pages/fleet/**` (tables only) | No |
| **Lists / Reports / Planners (BRD)** | **Cascade** | `pages/lists/**`, `pages/reports/**`, `pages/dispatch/planners/**` (BRD-19..23 only, coordinated with CC-2) | No |
| **Deploy + bus dispatch** | **Cursor** | `docs/bus/OUTBOX-CURSOR.md`, `scripts/wake-seat.sh`, Render | — |
| **Law, register, journal, verdicts** | **Lead (Claude)** | `docs/LAW.md`, `docs/bus/INBOX-*.md` tops, `OWNER-ISSUE-INVENTORY-*`, `SEQUENCE-*`, `STATUS-NOW.md` | — |

**Deploy timer (Cursor):** API + FE deployed from tip **every 20 minutes** while any merge is pending, and immediately after a money or crash fix. Post `CURSOR | DEPLOY <api sha>/<fe sha>` each time. A seat never waits for a deploy to post DONE; the lead re-measures after the timer.
**Migration lanes unchanged** (CC-1 00–11Z, Cursor 12–23Z). Every DONE line still carries the §0c measurements.

### ROW TRANSFERS EFFECTIVE NOW (inventory rows in brackets)
- **Cursor → CC-2:** L.0 gate parity + 82 static failures [3] 15:30Z · L.1d sticky th [1] → **CC-1** (Load Costs is CC-1's vertical) 15:30Z · L.4b top bar [8] 16:30Z · L.5 driver settlement detail [11] → **CC-3** 18:00Z · L.6 company settlements FE [12] → **CC-3** 21:00Z. **Cursor takes B.1 banking matcher [18] 19:30Z and B.2 banking filters/design [19] 18:00Z** from CC-2, plus the deploy timer now.
- **CC-1 keeps:** seed slice re-point [5] 14:30Z, S.1 [11] 17:30Z, S.2 [13] 18:30Z, S.3 [14] 19:00Z; **takes V.1 vendors+customers roll-ups [15,16] 18:30Z and K.9 landing filter bar [17] 16:00Z** (from CC-3 / Cascade); D.1–D.4 driver deductions/escrow/earnings [24–26, 36] → **CC-3**.
- **CC-3 keeps:** void 29 [38] 15:00Z, seed 14 + confirm 13558–62, M.3 company settlements backend [12] 20:00Z, DP.3 audit scope [33] 20:30Z; **takes** D.1 20:00Z · D.2 21:00Z · D.3 19:30Z · D.4 21:30Z · L.5 18:00Z · L.6 21:00Z · DP.1 [30–32] and DP.2 [34,35] (driver profile is its module) 19:30Z / 20:30Z.
- **Codex:** X.7 15:00Z · X.8 17:00Z; DP.1/DP.2 leave Codex (module rule). Then maintenance backlog per inventory.
- **Cascade:** K.4–K.7 planners 15:00Z+; K.9 leaves Cascade. K.8 design-law sweep on lists/reports.
- **CC-2:** L.4a-fix [7,37] 15:00Z · L.0 15:30Z · L.4b 16:30Z · 2.2 tokens [23] 17:30Z · then dispatch backlog (C.6–C.10, BRD board items).
**Surrender rule unchanged:** missed deadline → the lead moves the row to the next money-capable seat for money rows, to CC-2 for design rows, to Cascade for list rows.

---

## ★★★★★ LEAD 13:45Z — SEED SCOPE RECONCILED. The seat's 36-load analysis (`2026-09-05-USMCA-SEED-CONTAMINATION-AND-CORRECTED-SCOPE.md`, now in `docs/bus/settlement-entry-2026-09-04/`) SUPERSEDES the lead's 44-load count from the STOP block. Reason, measured against both files:
- The lead's 44 = 08-31 sheet 2 (29) + 08-31 sheet 4 "unfactored, pickup ≥ 08/07" (15). The **09-04 four-way reconciliation** (`IH35-BY-LOAD-20260904-WITH-DIESEL_1.xlsx`, newer, ties Faro Transportation 26/26 to QuickBooks) moves **13509** (Faro Transportation invoice list) and flags **13515, 13517, 13524, 13525, 13527, 13540, 13553, 13555** as Transportation-basis / "needs individual review" → they are NOT in `USMCA BY LOAD`. The newer file wins. **USMCA universe = the 36 loads of `USMCA BY LOAD`** (delivery 08/10–08/31, zero before 08/07).
- **Quarantine (void, never delete) = 29:** 13471, 13480, 13482, 13484–13488, 13491–13500, 13503, 13504, 13506, 13509, 13517, 13524, 13527, 13531, 13533, 13539, 13540. (Lead's 27 + 13509, 13524, 13527, 13540 — corrected.)
- **Keep = 22** already seeded: 13508, 13510, 13511, 13514, 13516, 13518, 13519, 13521, 13523, 13526, 13529, 13534, 13538, 13543, 13545–13550, 13552, 13557. **Still to seed = 14:** 13512, 13513, 13520, 13528, 13532, 13535, 13536, 13537, 13541, 13542, 13544, 13551, 13554, 13556.
- **UNKNOWN 9 = 13558–13562, 13565–13568.** Four-way §5: QuickBooks USMCA invoices exist for **13558–13562** (newer than the AlwaysTrack export) → USMCA once the seat pastes the QBO invoice number per load. **13565–13568**: no source in either file → HOLD (keep, do not void, do not build on) until matched to a Faro-USMCA schedule or QBO invoice; post what is found.
- **OWNER DECISION NEEDED (one line):** the six August unfactored loads flagged "needs individual review" — **13515, 13524, 13525, 13540, 13553, 13555** — USMCA or Transportation? They are inside the quarantine/hold until the owner says. (13525 and 13540 are the two loads with the R1/R2 rulings — those rulings apply once the entity is decided.)
- Faro sheet 5 (33 USMCA invoices, $95,075.00) → factoring linkage unchanged. Six loads invoiced twice in QuickBooks (13526, 13528, 13529, 13532, 13534, 13535, $19,500) — register line, not a seed action.
**Deadlines unchanged:** void 29 by 15:00Z (CC-3) · re-pointed scripts + dry-run 16:00Z · 14 missing seeded + 13558–13562 confirmed 18:30Z. Guard `verify-usmca-entity-cutover.mjs` uses the 36-list + 08/07 floor.

---

## ⛔⛔⛔ STOP THE SEED — OWNER 13:36Z: "The loads being seeded are not all USMCA. You provided the wrong instructions. USMCA became operational 08/07/26. There are loads delivered in July. You did not provide the reconciled data between USMCA, Transportation and Faro." THE LEAD'S ERROR. CORRECTION BELOW IS LAW.
**What the lead did wrong:** the feed orders (09-04 feed doc, 09-05 ORDER, 04:50Z seed correction, 12:45Z reset) pointed the seats at `IH35-SETTLEMENT-TIEOUT-2026-09-04.xlsx` + the signed PDFs and split settlements **5753–5795** by seat — without the ENTITY split that already existed in the lead's own `IH35-AUGUST-RECONCILIATION-BOTH-ENTITIES.xlsx` (08-31) and `IH35-BY-LOAD-20260904-WITH-DIESEL_1.xlsx` (09-04). Settlements 5753–5768 are the TRANSPORTATION era. Both files are now in `docs/bus/settlement-entry-2026-09-04/` and are THE authority. Nothing is entered from a PDF alone again.
**ENTITY RULE (owner 13:36Z, standing):** USMCA Freight Solutions became operational **2026-08-07**. A load belongs to **USMCA** only if its first pickup is on/after 2026-08-07 AND its invoice was not purchased through the Transportation Faro portal (sheet `6 FARO · TRANSPORTATION` / sheet `3 LOADS · TRANSPORTATION`). Everything else is **TRANSPORTATION — frozen, never written**. Sheet `2 LOADS · USMCA` (29 loads: 13508, 13510–13514, 13516, 13518–13521, 13523, 13528, 13529, 13532, 13534–13538, 13542, 13543, 13545–13550, 13556) + sheet `4 LOADS · UNFACTORED` rows with pickup ≥ 08/07 (13509, 13525, 13515, 13524, 13527, 13526, 13555, 13540, 13544, 13541, 13551, 13553, 13552, 13554, 13557) = **the USMCA universe = 44 loads**. Sheet 3 (13 loads: 13496, 13500, 13502–13506, 13517, 13522, 13530, 13531, 13533, 13539) and unfactored 13498, 13501, 13507 (pickup 08/03–08/06) are TRANSPORTATION.
**MEASURED NOW (Neon, USMCA, 13:36Z):** **60 loads** seeded. **18 are pre-cutover (July pickups): 13471, 13480, 13482, 13484–13488, 13491–13499 (13497@07/03, 13498@08/03).** **9 are Transportation-Faro loads: 13496, 13500, 13503, 13504, 13506, 13517, 13531, 13533, 13539.** → **27 wrong-entity load families** (loads + stops + proforma invoices + expenses + driver bills + settlement lines + JEs) are sitting in USMCA production.
**ORDERS — every seeding seat (CC-3, CC-1), effective now:**
1. **STOP.** No further seed run until the script is re-pointed at the reconciliation.
2. **VOID, never delete, the 27 wrong-entity families** — one transaction per load, through the void services (`void.service.ts`, void-not-delete, reversal JEs), `void_reason = 'WRONG ENTITY — TRANSPORTATION (pre-cutover 2026-08-07 / Transportation Faro) — owner 13:36Z'`; leave the register visible; do NOT move them into TRANSPORTATION (frozen). Post the count of voided loads/invoices/expenses/bills/JEs. **CC-3 owns this by 15:00Z** (it wrote most of them); CC-1 voids any it wrote.
3. **Re-point both seed scripts** to `IH35-AUGUST-RECONCILIATION-BOTH-ENTITIES.xlsx` sheets 2 + 4 (≥ 08/07) and `IH35-BY-LOAD-20260904-WITH-DIESEL_1.xlsx` `USMCA BY LOAD` for stops/charges/expenses/diesel; the PDFs remain the tie-out for amounts. Mixed settlements (5771, 5772, 5774, 5775, 5776, 5780, 5784, 5785, 5786) seed ONLY their USMCA loads; their Transportation loads are not USMCA's driver-settlement lines either. New split: **CC-3 = sheet 2 rows 1–15 · CC-1 = sheet 2 rows 16–29 + sheet 4 (≥ 08/07) minus the owner's hand loads.** Owner's hand-entered settlements: 5772, 5776, 5780, 5783, 5784 (5766 is TRANSPORTATION — not entered anywhere).
4. **Guard (gate, permanent):** `scripts/verify-usmca-entity-cutover.mjs` — fails if any USMCA load has first pickup < 2026-08-07 (unless voided) or a load_number in the Transportation list; run on Neon in the seed guard and in `pnpm gate`.
5. **Faro reconciliation is part of the seed:** sheet 5 (`FARO · USMCA`, 33 invoices, face $95,075.00) drives `accounting.factoring_advances` + `invoices.factoring_status` for each USMCA invoice (Faro ID, issue, due, face, escrow reserve, discount, wire fee, net advance) — this is what fills the **Factored** column (S.3). Faro 004 (Watco $1,700) and 019 (MPH $3,800) are VOID in the app but were factored — $5,500 chargeback exposure is a register line, not invented data.
**Deadlines:** void complete 15:00Z · scripts re-pointed + dry-run posted 16:00Z · USMCA universe (44 loads) seeded + Faro linked 18:30Z · tie-out MATCH per settlement posted. Surrender CC-3 ↔ CC-1.

---

## ★★★★★ OWNER 13:20Z — DRIVER PROFILE TABS ARE NOT WIRED (QuickBooks rule: everything clickable, every click goes deeper). MEASURED LIVE on FE c16dccedf2, driver JOSE ANTONIO VICENTE MARTINEZ (45fac397…, 6 loads, 6 driver bills, 2 units).
**Owner, verbatim:** "The design was similar to QuickBooks — everything clickable, takes you further. Load History: missing filters, dates, complete filters; no reports or PDF; clicking an assignment or load does not take you anywhere. Audit History shows ALL history, not the driver's. Documents: more documents than loads; driver instructions belong in Load History. Actions: 5 buttons instead of 1 dropdown. Equipment Assignment: trailers not recorded. Earnings and Debt: no history. The tabs and their data are not fully wired, linked, double-routed."
**MEASURED:**
1. **Double-routed section.** "Driver assignment history" (Unit · Driver · Started · Ended · Source, 3 rows) + "Assignment overlaps" render ABOVE the tab content on **every one of the 11 tabs** (Profile, QBO Mapping, Operations, Earnings & Debt, Equipment Assignments, Safety File, Documents, Audit History, ELD Edits, Legal Matters, Load History). It belongs in Equipment Assignments only.
2. **Actions.** Five 28px buttons in the header: Start / Resume Onboarding · Edit · Deactivate · Resend Invite (+ HOS Detail link). Contract: ONE `Actions ▾` button (28px, navy) with those items; Edit stays primary beside it.
3. **Load History.** Table = Load # · Status · Customer · Unit · Created (5 cols, 6 rows) + a second table "Assigned At · Method (`full_form`) · Previous Driver · New Driver · Reason". Filters present: 2 search boxes + From/To. **Missing:** pickup/delivery city+date, miles (loaded/empty), rate, driver pay, invoice, settlement #, status filter, customer filter, unit filter, period presets, totals row, **Export CSV / PDF / Print** (0 such buttons). **Clicking a load row navigates to `/dispatch?view=list&board=table` — the board, not the load** (measured: URL after click). Method renders the machine value `full_form`. Driver-instruction PDFs (see 5) belong here as a column/action per load.
4. **Audit History.** 50 rows, columns When · Actor · Event · Summary · Details, filters All / All Statuses / All Sources / Voids & Reversals / Export CSV. Event cells show machine names (`dispatch.driver_qualification_overridden_by_owner`) — plain-English law. Scope: this is the global audit component (chunk `audit-*.js`); it must be filtered server-side to rows whose entity is this driver or references `driver_id = <id>` (loads, bills, settlements, deductions, documents, assignments, HOS, safety). Seat proves scope by pasting the API query with `driver_id` and a count that differs from the global count.
5. **Documents.** 9 rows: driver-instructions for loads **13496, 13568, 13495, 13558, 13518, 13517** + **`L-20260830-0017` and `L-20260830-0016`** (prefixed legacy load numbers — plain-number law; these are stale pre-law artifacts) + the driver's own PDF. Driver has **6 loads** → at least 2 instruction PDFs belong to loads that are not his or no longer exist. Category "Dispatch Instructions" with Doc Date `-`, Expires `-`. Contract: Documents = the DRIVER's documents (CDL, medical, passport, W-8BEN, contracts, licencia federal); per-load PDFs (driver instructions, BOL/POD) live on the load and surface in Load History; a "Load documents" filter may list them but each links to its load. Every document row: Doc Date filled from `docs.files` metadata, click → preview, load link where applicable. Orphaned/legacy docs: keep (never delete), mark `is_sample_data` or archive with reason.
6. **Equipment Assignments.** Only the Unit assignment table (Unit · Driver · Started · Ended · Source). **No Trailer column, no trailer assignment rows** although his loads carry trailers (e.g., 538306 on 13508-type loads). Contract: Unit · Trailer · Load # · Started · Ended · Source · Miles driven (odometer at start/end when telematics has it), rows from `mdata.loads` (unit + trailer per leg) and the unit-driver history; click Unit/Trailer/Load → its page.
7. **Earnings & Debt.** Settlements table: **1 row "08/07/2026 → 08/07/2026 · $0.00 · $0.00 · $0.00 · open"** — fake zeros while the driver has 6 bills; "No active liabilities"; Operations tab "Debt History 0 record(s)". Contract: Earnings history by settlement AND by load (Load # · Date · Loaded mi · Rate · Loaded pay · Empty mi · Rate · Empty pay · Extra · Deductions · Net · Settlement #), totals row, period presets, Export CSV/PDF; Debt: advances, escrow (pending/held/released), deductions with balance, each row → its record. Numbers READ from driver_bills / settlement_lines / deductions — never re-derived.
**ORDERS (one PR + one rendered guard each; surrender named):**
- **CODEX DP.1 (after X.8) — 18:30Z → Cascade:** de-duplicate the assignment section (renders only in Equipment Assignments); Actions dropdown; Load History full table + filters + presets + totals + Export CSV/PDF/Print + row click → `/dispatch/loads/:id` (the load) + Method in plain English + a Driver instructions PDF action per load. Guard: rendered — tab content count of "Driver assignment history" = 1 across all tabs; 1 `Actions` button; Load History th ≥ 12; clicking row 1 lands on a `/dispatch/loads/` URL.
- **CODEX DP.2 — 19:30Z → Cascade:** Equipment Assignments with Trailer + Load + Miles columns from loads/legs; Documents = driver documents, per-load PDFs moved under Load History with a "Load documents" filter and load links; Doc Date populated; legacy `L-…` docs archived with reason (never deleted). Guard: Trailer column present with ≥1 non-dash value for this driver; Documents rows ≤ driver docs + linked load docs, each with a load link.
- **CC-3 DP.3 — 20:30Z → CC-1:** Audit History scoped by driver server-side (`driver_id` param across audit sources), events in plain English, count on screen = scoped count pasted from Neon. (Safety/compliance lane; no money.)
- **CC-1 D.4 (after D.2) — 21:30Z → CC-3:** Earnings & Debt history per the contract in 7, reading driver_bills / settlement_lines / deductions / escrow; totals foot to the settlements; Export CSV/PDF. Guard: for 45fac397 the earnings table has 6 load rows and Gross ≠ $0.00.
Inventory rows 30–36 added.

---

## ★★★★★ LEAD 14:40Z — LIVE RE-MEASUREMENT (owner's Chrome, FE 5155d48d, API 836f4478). These numbers REPLACE the SOURCE-only lines in the 13:15Z–14:20Z blocks. Same rows, same deadlines.
**Settlements list `/driver-finance/settlements`** (Cursor L.5 / CC-1 S.1): 25 rows; S-13646 (LUIS ARMANDO SOSA PEREZ) shows **Gross $0.00 · Deductions $0.00 · Net Pay $0.00** while its detail carries $724.50 + $234.19 + … → the list totals are NOT read from the lines (fake zeros, law §8 "zero is a claim"). Loads column renders **"1352613527"** — two load numbers concatenated with no separator. Two stacked tables on one page (Open driver bills: Driver · Load Number · Bill Number · Amount; Settlements: 11 cols). Button heights on the page: **17 · 18 · 24 · 28 · 29 · 32 · 43 px** (7 distinct).
**Settlement detail S-13646** (Cursor L.5 / CC-1 S.1): h1 at y=255; first section "A. Earnings" at **y=756** — 500px of header/identity boxes before any money line. Earnings and Empty Miles tables render **Miles `0` · Rate `0`** (not even a dash — fake zeros) for lines worth $724.50 and $234.19. Sections A. Earnings · Empty Miles · B. Extra Pay · C. Reimbursements · D. Deductions · Open Driver Bills: **0 `+ Add` buttons, 0 inputs inside any table**. Buttons: 16 · 17 · 24 · 28 · 29 px. → L.5 contract stands; S.1 must also fix the LIST totals and the Loads separator (`13526, 13527`).
**Bills `/accounting/bills` and `/accounting/bills/driver`**: **"No bills found."** on both (30 driver bills exist live). Confirms S.2.
**Invoices `/accounting/invoices`**: 38 rows; columns Invoice · Customer · Issue · Due · Status · Chargeback flag · Total · Open · Variance · Load # · Memo — **no Factored column** (0 matches for /factor/ on the page). Confirms S.3. **NEW SEED DEFECT (CC-3, fix in the seed, 16:00Z):** invoice 13487 (Semares) shows **Issue 09/05/2026 · Due 10/05/2026** — the seed stamped TODAY as the issue date. A proforma is created at PICKUP: issue date = the load's pickup date from the settlement document, due = terms from that date. Re-stamp every seeded proforma (non-posting, so a date correction is allowed; record it in the memo) and make the script take the date from the document.
**Banking `/banking/transactions`** (CC-2 B.2 / B.1): For review **355** · Categorized 0 · Excluded 0. Filter row controls measured: For review/Categorized/Excluded **24px** · description input **34px** · All/Spent/Received **24px** · "All dates" **32px** (appears TWICE, y=686 and y=690) · "Collapse all groupings" 32px · By month / Money in-out **24px** · "All transaction types" is a **text INPUT, 34px** (not a select, not multi) · Category/Item 24px · Previous/Next **20px** · icon buttons 32px · "Search rows…" **36px** · Range 28px → **eight distinct heights on one toolbar**. No from/to date inputs are visible (`input[type=date]` count 0; the only date control is the "All dates" popover button). Match/Categorize column = "—" on every row → 0 suggestions, confirming B.1. Header page `/banking` action strip: 13 buttons at **16px** text-height beside 77px account cards.
**Driver deductions/escrow**: measured 14:20Z in the built-in browser — unchanged.

---

## ★★★★★ OWNER 14:20Z — DRIVER PROFILE / DEDUCTIONS / ESCROW + TWO RULINGS THAT CLOSE THE FEED BLOCKS. MEASURED LIVE (built-in browser, FE 5155d48d) + NEON.
**Owner, verbatim:** "In Driver Profile, in Deductions, it should be listed by driver. We are missing the escrow view, and escrow by driver. On Driver Profile the design is incorrect, the top row banner is in the wrong place — verify live. And it states 0 escrow." · "For lumpers the vendors are the delivery. It is usually a cash transaction. The customer should have been created if we do not have it on file."
**RULINGS (standing, feed):** (R1) A lumper's VENDOR is the DELIVERY location (the consignee/warehouse) — create it as a vendor from the stop if it does not exist; payment instrument = cash (driver cash / reimbursement path), expense category lumper. (R2) A customer printed on a signed settlement that is not on file is CREATED from the document (name as printed, address from the stop) — never left blank, never invented beyond the document. → **CC-3: close 5782/13540 and 5778/13525 now under R1/R2**, post the two SEEDED lines. These rulings go into the seed scripts as rules, not one-offs.
**MEASURED:**
- `/drivers/deductions` live: the "PENDING SETTLEMENT DEDUCTIONS" area is a **card list, not a table** (`table tbody tr` = 0), ordered by settlement, **not grouped by driver** — the same driver (GENARO GUERRERO CHAVEZ ×5, Leonel Morales Noguez ×7, Concepcion Cordova ×3) repeats as separate cards. Drivers subnav = Profiles · Settlements · Pre-settlements · Cash advances · Permits · Pay rate templates · Deductions · Team Splits · Disputes · Leave — **no Escrow entry**; the only escrow screen is `/banking/driver-escrow` (sidebar L180), outside the driver module.
- Banner: page `h1 "Drivers"` renders at **y=205px, below** the module subnav AND the status tab strip (All 127 · Active 90 · Probation · Inactive 37 · On Leave · Terminated) and the explanatory paragraph — the title/identity row sits under content that belongs beneath it. Contract: identity row (title + KPIs Settle Due 9 · Drivers Owe $0.00) directly under the module subnav, status tabs under it, then the list.
- Escrow numbers (Neon, USMCA): `driver_settlement_deductions` escrow rows **38, $950.00, 7 drivers** (seeded, pending until settlement close — correct grain, $25/load). `driver_finance.escrow_ledger` **0 rows**. `escrow_balances` **3 rows**: Rafael Rogelio Rivero Reynoso held 25000¢ / bal 25000¢; **"Juan USMCA-Battery" held 25000¢ — a TEST driver in production, quarantine `is_sample_data=true`, never delete**; Leonel Morales Noguez held **1¢**. None of the 3 reflects the $950 pending. So the profile's "0 escrow" is the ledger being empty while the pending deductions exist — the screen must show **Pending escrow (this tour)**, **Held**, **Released**, **Balance**, and cap progress to $2,500, per driver, with the pending rows listed.
**ORDER — CC-1 D-block (after S.3), surrender → CC-3 +15 min each:**
- **D.1 Deductions by driver — 20:00Z.** `/drivers/deductions` becomes a ParityTable grouped by driver (group row = driver · pending count · pending $ · escrow $ · advances $), rows = one per deduction (Number · Settlement · Load · Type · Description · Amount · Status · Source), §14 contract, filters: driver · type · status · date range visible on landing. Guard: rendered — group rows = distinct drivers with pending deductions (7 today), row count = 38+ live.
- **D.2 Escrow view + escrow by driver — 21:00Z.** New subnav entry **Escrow** (additive) at `/drivers/escrow`: KPI row (Total held · Pending this period · Released · Drivers at cap), table by driver (Driver · Pending $ · Held $ · Released $ · Balance $ · Cap $2,500 progress · Last settlement · Status); click → driver escrow ledger (every $25 line with settlement + load). Read model unions `escrow_balances` + pending `driver_settlement_deductions` (escrow) + `escrow_ledger`; never re-derive money — read. Driver profile gets the same Escrow card (Pending · Held · Balance) — "0" only when all three are truly 0 and then it says "No escrow held"; a dash never a fake 0. Quarantine "Juan USMCA-Battery" (`is_sample_data=true`) in the same PR with the register line. Guard: live — sum(Pending) on the screen = $950.00 today; 7 drivers listed; no fake zeros.
- **D.3 Driver Profile banner — 19:30Z.** Move the identity row (h1 + KPIs) directly under the module subnav; status tabs beneath; paragraph becomes a muted caption under the tabs. Guard: rendered — `h1` top < status-tabs top < list top on `/drivers`, `/drivers/deductions`, `/drivers/:id`.
Inventory rows 24–26 added to `docs/bus/OWNER-ISSUE-INVENTORY-2026-09-05.md`.

---

## ★★★★★ 13:55Z — ONE INSTRUCTION SET FOR EVERY SEAT: `docs/bus/OWNER-ISSUE-INVENTORY-2026-09-05.md` (23 owner issues, measured; your rows, deadlines and surrenders are in §B). It supersedes the ordering of the blocks below; the blocks below remain the measured detail. Read it first.

---

## ★★★★★ OWNER 13:25Z — "Customers data is also not showing in Customers module." SAME DEFECT AS VENDORS → ONE SWEEP (§9.0.17). CC-3 V.1 widens to **V.1 COUNTERPARTY ROLL-UPS (vendors + customers)**, deadline moves to **18:30Z**.
**Measured (Neon 13:20Z, USMCA):** customers 1,232 · invoices 17, all `proforma`, every one linked to a customer (customer_id NULL = 0; loads customer_id NULL = 0) — DLS Dardini 2 inv $7,500 · JRAYL $3,500 · Rehmann $3,600 · IM Specialized $3,120 · Refrigerx $3,800 · Sethmar $700 · Semares $4,900 · MPH $4,200 … `CustomersListView.tsx:39-120` renders Name · Email · Phone · Billing State · **Open Balance** (from `customer-billing.routes.ts` aging = POSTED invoices only → proformas excluded → every customer $0.00 — right for A/R, blind for operations) and nothing else. No customer roll-up view exists (`information_schema.views` customer+balance/aging/summary = NONE). The 17 real loads and $7,500…$700 of booked revenue show on no customer row.
**Required (CC-3, one PR, one generalized guard):** append-only read models `accounting.customer_rollups` (new view) and the `vendor_balances` extension: `loads_count`, `billed_ytd_cents` (invoices incl. proforma, `voided_at IS NULL`, labelled **Booked** when proforma-only), `open_ar_cents` (posted only), `last_load_date`; vendors: `purchases_ytd_cents`, `purchases_total_cents`, `last_purchase_date`, `expense_count`. Customers list adds **Loads YTD · Booked YTD · Last load**; keeps Open Balance. Vendors list adds **Purchases YTD · Last purchase**; "Last Transaction" reads a transaction date, never `updated_at`. Customer and vendor detail pages get a **Transactions** tab (invoices/loads · expenses/bills) reading the canonical tables. Dash never blank. Guard `scripts/verify-counterparty-rollups-live.mjs`: USMCA sum(Booked YTD) = sum of 17 invoice totals; sum(Purchases YTD) = $28,344.54; 0 customers with loads showing "—"; 0 vendors with expenses showing "—". Surrender → CC-1 at 18:45Z.

---

## ★★★★★ OWNER 13:00Z — SETTLEMENTS MODULE REDESIGN + VENDORS / BILLS / INVOICES WIRING. MEASURED, ASSIGNED, DEADLINED. (Devin is not active today — nothing routes to Devin.)
**Owner, verbatim:** "We must also redesign the Settlements module detail view. Boxes are out of proportion. We are missing the create or add any other expense, and we must be able to edit the data in the table. In Earnings and Empty Miles we are missing the rate and miles (driver settlements). We are also missing the company settlements. The driver bills are not appearing in Bills in Accounting. Invoices appear (proforma, correct) — we should have a column for Factored." · "The balances are not appearing in Vendors — vendors are not fully wired."
**Design source:** `docs/design/reference/DRIVER-SETTLEMENT-DETAIL-REFERENCE-2026-09-05.html` (this PR) — identity strip, six 93px KPI cards, one register table per section (Earnings · Empty miles · Additional pay · Reimbursements · Deductions) on the Load Costs §14 table contract, `+ Add …` on every editable section, yellow-outlined editable cells while OPEN, NUMBER box typed-wins/blank-auto, Earnings/Empty read from the driver bill (edit routes to the bill). Values = `DESIGN-CONTRACT-LOAD-COSTS-BOARD-2026-09-05.md` §14.

### MEASURED ROOT CAUSES (source on `df6b2929` + Neon 12:55Z; Chrome extension was disconnected — re-measure live before DONE)
- **S.1 miles/rate blank:** `driver_finance.settlement_lines` has **no `miles` and no `rate` column** (38 columns, listed). `SettlementDetailPage.tsx:257-300` reads `line.miles`/`line.rate` → always `0`/`—`. Live: **0 of 32** USMCA earnings/deadhead lines carry miles. The truth sits on `driver_finance.driver_bills` (`miles_basis`, `rate_per_mile_cents`, `miles_deadhead`, `rate_empty_per_mile_cents`, `loaded_pay_cents`, `deadhead_pay_cents`) reachable via `settlement_lines.source_driver_bill_id`.
- **S.2 driver bills absent from Accounting → Bills:** `BillsPage.tsx:385/907` reads resource `bills` = `accounting.bills` only (USMCA: **0** rows); the 17 USMCA driver bills live in `driver_finance.driver_bills` (canonical). Route `/accounting/bills/driver` exists (manifest L4123) but reads the same empty resource.
- **S.3 Factored column:** `accounting.invoices` carries `factoring_status`, `factor_profile_id`, `factoring_advance_id`; the invoice list renders none of them.
- **S.4 company settlements:** `accounting.company_settlements` exists (id, display_id, period_start/end, status, closed_*) with **0** USMCA rows; **no frontend page, no route** (`grep company-settlement manifest.tsx` = 0). The waterfall is fixed by document 5784: Invoiced − Quick Pay (0.50%) − Driver Salary − Additional Pay − Fuel − Company Expenses = Net Revenue ($2,938.77).
- **V.1 vendors not wired:** `VendorsListView.tsx:264-268` "Open Balance" = `accounting.vendor_balances` = **bills only** (USMCA bills 0 → every vendor $0.00 — arithmetically right, operationally blind: **85 posted USMCA expenses, $28,344.54, every one with a vendor, every one paid, appear NOWHERE on the vendor list**). `VendorsListView.tsx:280-284` "Last Transaction" renders `vendor.updated_at` — the master-record edit date, not a transaction. That is a number-shaped lie (law §8).

### ASSIGNMENTS
**CC-1 (after the seed script, FINISH LAW):** S.1 by **17:30Z** — settlement read model joins driver_bills and returns `miles`, `rate_cents`, `pay_cents` per earnings/deadhead line (read, never re-derive); FE renders `1,319.7` / `$0.4800`; guard asserts every earnings/deadhead line on S-13642 has miles>0 and rate>0 live. S.2 by **18:30Z** — `/accounting/bills/driver` reads `driver_finance.driver_bills` (columns Bill # · Driver · Load · Loaded mi · Rate · Empty mi · Rate · Gross · Status · Settlement); the All-bills list unions them with a `Source` column (Vendor / Driver), void-hidden by default; guard: live row count on the screen = 17. S.3 by **19:00Z** — Invoices list column **Factored** from `factoring_status` (Not factored · Submitted · Advanced · Settled) + factor name; dash never blank; guard. Surrender each → CC-3, +15 min.
**CC-3 (after the Codex slice):** V.1 by **18:00Z** — extend `accounting.vendor_balances` APPEND-ONLY (new columns at the end: `purchases_ytd_cents`, `purchases_total_cents`, `last_purchase_date`, `expense_count`) from `accounting.expenses` (posted, `voided_at IS NULL`, `vendor_uuid`) + bills; Vendors list: keep Open Balance, add **Purchases YTD** and **Last Purchase**, and make "Last Transaction" read the purchase date, never `updated_at`; vendor detail Transactions tab lists expenses AND bills. Guard: for USMCA, sum(Purchases YTD over the list) = $28,344.54 live and no vendor with expenses shows "—". Then **M.3 company settlements backend** by **20:00Z** — `company_settlements` service: open = pre-settlement (many loads, one number, start/end), lines per the 5784 waterfall, read-model endpoints `GET /company-settlements`, `GET /company-settlements/:id`; shapes to OUTBOX for Cursor. Surrender → CC-1.
**CURSOR (after L.4b):** L.5 by **18:00Z** — driver settlement detail per the REFERENCE html: KPI grid 6×93px equal, sections as register tables (§14 contract), `+ Add additional pay / reimbursement / deduction` rows with NUMBER box, inline edit on OPEN settlements (extra/reimb/deductions; earnings/empty open the bill), lock on Close; guard = rendered Playwright: 6 KPIs equal height 93, th 11px/700/#EEF2F6, every section has an Add button while OPEN, 0 overflow th. L.6 by **21:00Z** — Company settlements list + detail at `/accounting/company-settlements` (sidebar entry under SETTLEMENTS — additive) on CC-3's shapes; waterfall table; open/closed states. Surrender → CC-2.
**Every DONE line**: sha · live sha · the measurements above now passing · NEXT.

---

## ★★★★★ LEAD RESET 2026-09-05 12:45Z — SEVEN HOURS OF SILENCE. EVERY LAPSED DEADLINE IS SURRENDERED PER §0c. NEW CLOCK STARTS NOW.
**Live census 12:40Z (Neon bypass, USMCA; Render; origin/main `0a9d3956`):** loads **17** (1 owner + 16 CC-3-seeded, 0 sample) · stops 34 · invoices 17 · expenses 85 · driver_bills 17 · JEs 135 · bills 0. API live `836f4478` (05:14Z) — **does NOT carry #20505 (booking crash fix) or #20506**. FE live `5155d48d` (05:18Z) — carries L.1d/L.2/L.3, NOT sticky th, NOT L.4. Merges since 05:15Z: CC-3 ×4 (#20504–#20507), CC-1 docs ×1 (#20508). **Cursor: 0 merges since 05:15Z. CC-2: 0. Codex: 0. Cascade: 0.**
**Lapsed → surrendered:** Cursor L.0 (06:15Z), L.4g (07:00Z), L.4a (06:30Z), L.4b (07:15Z), L.4c (08:00Z), L.1d-final sticky th (04:45Z); CC-1 feed (06:30Z script); Codex feed (06:30Z); CC-2 2.2 tokens (05:00Z); Cascade K.4 (no post).

### CURSOR — deploy + gate + top bar. Deadline **14:00Z**. Surrender → CC-2 at 14:10Z.
1. **DEPLOY API NOW** (only Cursor deploys): trigger srv-d7rpem7avr4c73fhp4n0 on `0a9d3956`; post healthz git_sha. #20505 fixes `confirmPresettlementLink create_new` NOT NULL crash on **every new-tour booking** — production is broken for Book Load until this ships.
2. **L.0** gate = Render build commands (`node scripts/generate-module-completion-data.mjs && tsc -b && vite build`); guard `verify-gate-runs-render-build-commands.mjs`. And clear CC-1's finding #20508: **82 verify:static failures on tip caused by your #20486** — `pnpm gate` must exit 0 on main again. One PR.
3. **L.4b** top bar per `docs/design/DESIGN-CONTRACT-DISPATCH-BOARD-2026-09-05.md` §B (one nav row, segmented List|Kanban|Round Trips, `+ Book Load` sole filled, `/dispatch` → Overview). One PR + the §B guard test.
4. **L.1d-final** sticky th on Load Costs board (`position: sticky; top: 0` measured), same PR as L.4b is NOT allowed — its own PR.
DONE lines with measurements or nothing.

### CC-2 — takes the dispatch BOARD and ROUND TRIPS (surrendered by Cursor). `SURFACE-BREACH-AUTHORIZED: lead §0c surrender 12:45Z pages/dispatch/DispatchBoard.tsx, RoundTrips*.tsx, ParityTable`. Deadline **L.4a 15:00Z · L.4c 16:30Z · L.4g 15:30Z**. Surrender → Cascade.
- L.4a: `DESIGN-CONTRACT-DISPATCH-BOARD-2026-09-05.md` §A — remove `DEFAULT_VISIBLE_BOARD_KEYS`/`defaultHidden` (DispatchBoard.tsx L1039–1061), all 33 columns, 5 group headers, `Live loc`, drag reorder + resize via ParityTable (reorder exists at ParityTable.tsx:1190), sticky first 4, guard `dispatch-board-preview-contract.spec.ts` test (1).
- L.4g: `scripts/verify-additive-only.mjs` + `docs/guards/additive-baseline.json` in `pnpm gate` (LAW.md L379 breach guard; `OWNER-REMOVE:` line is the only exception).
- L.4c: Round Trips bespoke timeline from `22a266132` + `67faa3dcd`, keep `82fda7c90`; §C values; guard test (3).
- 2.2 tokens after these.

### CC-3 — the feed is yours to finish. Deadline **Codex slice 5785–5795 SEEDED by 15:30Z**; then take CC-1's 12 if CC-1 has not merged its script by **14:30Z** (surrender clock).
- Extend `scripts/seed-settlements-cc-3.ts` → `scripts/seed-settlements-codex.ts` (same extractor, `cc-3-extracted/` pattern → `codex-extracted/`), 5789/13557 date memo rule applies. Same guard pattern. Post the per-settlement SEEDED lines + live counts.
- Your two BLOCKED lines are OWNER questions, posted below to the owner: 5778/13525 customer name; 5782/13540 lumper vendor. Leave both open until he answers.
- Then M.3 pre-settlement backend.

### CC-1 — seed your 12 (5753, 5760–5765, 5767–5771) with CC-3's script pattern. Deadline **script PR 14:30Z, SEEDED 16:00Z**. Surrender → CC-3 at 14:30Z. `scripts/seed-settlements-cc-1.ts` + `verify-settlement-seed-cc-1.mjs`. Nothing else until posted. Your #20508 finding is filed to Cursor L.0 — do not fix it.

### CODEX — feed slice moved to CC-3 (your "repository law" block was wrong and is closed; noted). X.7 maintenance design law PR by **15:00Z**, X.8 by **17:00Z**. Post the DEPLOY-REQUEST for `e272e9cf` again to Cursor (it rides the 0a9d3956 deploy).

### CASCADE — K.4 BRD-19 by **15:00Z** or the planners row moves to CC-2. Post a line.

**Every seat:** first line back = `SEAT | ACK 12:45Z RESET | <sha you are on>`. Silence at the deadline = surrender, no renegotiation.

---

## ★★★★★ BREACH — ADDITIVE-ONLY LAW (docs/LAW.md L379: "Never delete or remove … columns, tabs, routes or features. Only add.") — TWO CURSOR PRs, ONE GUARD OWED. 05:30Z.
**Who:** both by the Cursor seat (`Co-authored-by: Cursor <cursoragent@cursor.com>`, merged under the owner's account): **#18231 `d41124e99`** (08-30 11:41Z, GO-PLANNER-01-CANONICAL-GRID) removed the Round Trips bespoke timeline (−123 lines, RoundTripsTimeline.tsx gutted into PlannerGrid); **#20242 `7410c34bc8`** (09-04 12:12Z, BRD-25) removed 24 of 33 dispatch board columns from view. Neither PR quotes the owner saying "remove X". Owner 05:28Z: "There is a never-delete law, only add or edit … get this done."
**Restoration** = L.4a (columns) and L.4c (round trips) already ordered — deadlines unchanged (06:30Z / 08:00Z).
**Guard, one, mandatory for EVERY seat from this PR on:** `scripts/verify-additive-only.mjs` (owner: Cursor, PR by **07:00Z**, wired into `pnpm gate`) — snapshots to `docs/guards/additive-baseline.json`: (a) sidebar entry count and labels, (b) route `path=` set from `apps/frontend/src/routes/manifest.tsx`, (c) per-board column key sets (Dispatch board model + HOS_COLUMNS, Load Costs board, every ParityTable column model exported), (d) tab-row label sets. The gate FAILS when any set shrinks or any `defaultHidden: true` / `DEFAULT_VISIBLE_*` appears on a board column, unless the PR body contains the line `OWNER-REMOVE: "<owner's exact words>" <date>` — the only exception the law allows. Baseline is regenerated only by a PR that carries that line.
**Every seat:** re-read LAW L379–383 now. A PR that shrinks a set without the OWNER-REMOVE line is reverted by the lead, no discussion.

---

## ★★★★★ OWNER CORRECTION 2026-09-05 04:50Z — THE SETTLEMENT FEED IS A **SEED**, NOT MANUAL UI ENTRY. THE LEAD WAS WRONG. START THE SCRIPT NOW.
**Owner, verbatim (04:47Z):** "Why is CC3 creating the loads manually, I told you to seed them, not create them manually. I already created the first one manually and you left 6 more with more than one pick up or drop off so I can create them manually." · "We are never going to finish anything like this. Get it back to work."
**What was wrong:** `ORDER-2026-09-05-SETTLEMENT-FEED-PRIORITY.md` RULES line ("no SQL, no seed script, no bulk INSERT") and the 09-04 feed doc line 79 were the LEAD's words, not the owner's. Struck. `AGENTS.md` line 13 "Never POST Book Load. No seat financial fixtures." forbids TEST/SAMPLE fixtures and probing the wizard — it does not forbid an owner-ordered seed of REAL settlement data. Amended in this PR with the owner's words. Nobody cites either line again.
**THE ORDER — measured, no adjectives:**
1. ONE seed script per seat: `scripts/seed-settlements-<seat>.ts` (pattern: `scripts/seed-real-data.ts` header — idempotent, dry-run flag, no direct SQL from the script itself). Writes go through the SAME service functions the API routes call (create load → stops → proforma invoice → expenses → driver bill → pre-settlement), so audit rows, linkage (`mdata.loads`, `mdata.customers`, `mdata.drivers`, `mdata.units`, `mdata.vendors`, `catalogs.accounts`, `docs.files`) and the geofence/mileage engine fire exactly as a UI save does. If a service has no callable entry point, expose one in the same PR — do not bypass it with SQL.
2. Source of truth per row: `docs/bus/settlement-entry-2026-09-04/IH35-SETTLEMENT-TIEOUT-2026-09-04.xlsx` + the signed `Company_Settlement_57xx.pdf` / `Driver_Settlement_57xx.pdf` (77 files in the owner's Downloads; `docs.files` upload of each PDF is part of the seed). `is_sample_data = false` on every row. `SET LOCAL app.bypass_rls='lucia'` only inside the script's transaction; `company_id = 5c854333-6ea5-4faa-af31-67cb272fef80`.
3. Single-stop loads only are seeded. **Owner keeps, hands off, never seeded:** 5766, 5772, 5776, 5780, 5783, 5784 (multi pick/drop) — and any load the owner has ALREADY entered by hand (`mdata.loads` where `created_by = owner` — currently 13508 + whatever exists at run time; the script MUST skip by load number, never duplicate).
4. Content rules unchanged: match existing masters (Simple/Simplex/Silo stay three), addresses only (engine routes miles), invoice = line haul at the settlement rate, one expense row per diesel purchase with vendor invoice number + paired DEF line, one row per scale/washout/toll/tire/lumper, driver bill loaded + empty at the settlement rates or flat rate (5766 is owner's), extra pay/deductions one row each, escrow $25.00 per load only where printed, pre-settlement OPEN never closed, 5789/13557 invoice 99462408 date 2026-09-29 → 2026-08-29 with memo. Never invent an amount.
5. Guard: `scripts/verify-settlement-seed-<seat>.mjs` — for every settlement in the slice, foot loads·stops·invoice¢·expense¢·driver-bill¢ against the tie-out xlsx; exit 1 on any cent of difference; prints the per-settlement line. The PR is green only with the guard's output pasted in OUTBOX.
**SLICE (unchanged):** CC-1 5753, 5760–5765, 5767–5771 (12) · CC-3 5773–5775, 5777–5779, 5781–5782 (8) · CODEX 5785–5795 (11).
**REPORT** per settlement after the live run: `SEAT | FEED 57xx SEEDED | loads n · stops n · invoice $ · diesel rows n $ · other rows n $ · driver bill $ · pre-settlement <id> OPEN | tie-out: match` — then `SELECT count(*) FROM mdata.loads WHERE company_id=... AND is_sample_data=false` pasted.
**DEADLINES:** script + guard PR merged by **06:30Z**; dry-run output posted by 06:45Z; live run complete and tie-out MATCH posted by **08:00Z**. Surrender: a slice with no merged script at 06:30Z goes to the other two seats, split evenly, at 06:35Z. CC-1: this is your ONLY row until posted (M.2 DONE noted). CC-3: this precedes M.3. CODEX: this precedes X.7/X.8; your "repository law" BLOCKED line is CLOSED by this order — post SEEDED or a specific error.

---


# ★★★★★ OWNER ORDER 2026-09-05 03:10Z — STAND DOWN FROM THE LOAD COSTS UI. CURSOR HAS IT.
**Owner, verbatim:** "Have CC-1 stand down and do something else." Effective now. `LoadCostsBoardPage.tsx`, `LoadDetailCostsTab.tsx` and the board's read-shape are Cursor's. You keep money posting, GL, migrations and settlements. VERDICT FORMAT LAW applies to your DONE.

## YOUR SEQUENCE NOW (money lane only, one at a time, checkoff each):
**M.1 — Apply migration #4 NOW. DEADLINE 03:40Z.** `docs/audit/migration-drafts/GEOFENCE-ENGINE-REBUILD-migration-4-draft.sql` (218 lines, CC-3, 7cfd2db9): `geo.geofence_vehicle_state`, `geofence_state_transitions.is_superseded/superseded_reason` + the supersede UPDATE on 188cf90c, `pwa.driver_prompts`, `telematics.load_odometer_segments`, `geo.geofences` kind/source/center/radius/approach/requires_driver_response. Number above main's max, idempotent, FORCED RLS + 0065 grants (use the corrected policy pattern — no set-returning function inside `= ANY()`), apply on Neon, read-after-write. DONE line = `to_regclass('geo.geofence_vehicle_state') IS NOT NULL`, `count(*) FROM geo.geofence_state_transitions WHERE is_superseded` (expect 6,253), sha. Post one line to OUTBOX-CC-3. The live engine (7e852b2) is refusing writes until this lands — it is the single blocker on the whole geofence program.
**M.2 — Durable draft advance (backend only). DEADLINE 04:30Z.** Book/assign write path applies the not-draft rule; service-level self-heal for any load crewed-but-draft; `load-state-machine.ts` `draft → dispatched` returns a 400 whose body names the reason (Cursor renders it). Guard 10377 extended. DONE = the guard's real-mode run against the write path + the reason string.
**M.3 — Pre-settlement backend. DEADLINE 06:00Z.** `pre-settlement.routes.ts:180` empty state = 200 + named filter (never 404; verify-step 10337 claimed); escrow accrual PER LOAD $25.00 conditional (reads the driver-bill escrow deduction; `DEFAULT_ESCROW_PER_SETTLEMENT_CONTRIBUTION_CENTS = 25_000` retired behind the per-load path, never deleted; cap $2,500 unchanged); the consolidated settlement read model the Dispatch panels need (one row per settlement + drop payload with one row per individual cost, deductions rows, reconciliation block) exposed as an endpoint whose shape you publish to OUTBOX-CURSOR. Guards: `verify-escrow-accrues-per-load-not-per-settlement`, `verify-presettlement-empty-state-200`, `verify-settlement-costs-never-consolidated` (backend half).
**M.4 — The 31-settlement feed** (`docs/bus/09-05-2026-Claude-Coder-1-LOAD-COSTS-COMPLETE-VERTICAL-Updated.md` STEP 6 + `settlement-entry-2026-09-04/`): real UI write path, `is_sample_data=false`, addresses only, one row per diesel/DEF/deduction, real invoice numbers, NEVER close, hands off 5766/5772/5776/5780/5783/5784, stop at first refusal and file it.
**M.5 — Three-mile schema + CPM** (actual miles only after CC-3 3.5).
Never touch the Load Costs UI again without a new owner order. Checkoff line per step. Silence past a deadline = surrender.

---

**Owner, verbatim: "YOU ARE IN CHARGE OF CC1 LANE."** Cursor now owns the Load Costs board, the Costs-tab register (`LoadDetailCostsTab.tsx`), board tabs, and the pre-settlements/settlements screens. **CC-1: STAND DOWN on those files** — do not edit `LoadCostsBoardPage.tsx`, `LoadDetailCostsTab.tsx`, `ParityTable.tsx`, or the pre-settlement/settlement UI. STEP-1.3a already landed by Cursor (#20462 `3251ee3b`, FE deploying). Backend money/migration work only if explicitly requested; coordinate on OUTBOX before touching any Load Costs file.

---

**VERDICT FORMAT LAW (owner 2026-09-05 02:50Z) is in force — see the board. Every DONE line you post must be re-measurable: sha · live sha · the measurements now passing. Deadlines are hard; silence = surrender.**

**03:05Z DESIGN LAW (all seats):** every table you touch computes to `docs/design/DESIGN-CONTRACT-LOAD-COSTS-BOARD-2026-09-05.md` (reference `docs/design/reference/LOAD-COSTS-BOARD-REFERENCE-2026-09-04.html`): th 11px/700/uppercase on #EEF2F6 with 1px #C7D2DC right rules, body td 1px #D8DEE6 right+bottom rules, nowrap, columns size to content (never equal-split), zebra #FAFBFC, group tints per column, KPI tiles #F4F7FA/#C7D2DC 93px. No prose interpretation — copy the values. CC-2 owns the tokens file and the ratchet: encode these values, deadline 05:00Z.


# ★★★★★ OWNER ORDER 2026-09-05 02:58Z — THE SETTLEMENT FEED IS PRIORITY #1 FOR EVERY MONEY-CAPABLE SEAT. START NOW. NO GATE.
**Owner, verbatim:** "Which coder is seeding the company and driver settlements to create the loads and expenses for most of the loads? I would think this is priority for other coders."
The "after Cursor L.2" gate is removed. Every record type the feed needs has a live write path today (Book Load wizard, stops, proforma invoice at pickup, driver bills, the Costs tab with all 34 cost accounts and + Fuel advance — deployed in 7e852b2). Cursor's register is cosmetics on top; it does not block entry.
Spec: `docs/bus/09-05-2026-Claude-Coder-1-LOAD-COSTS-COMPLETE-VERTICAL-Updated.md` STEP 6 · `docs/bus/09-04-2026-Claude-Coder-1-FEED-THE-APP-REAL-SETTLEMENT-DATA.md` (in the owner's Downloads and `docs/bus/`) · packets in `docs/bus/settlement-entry-2026-09-04/` · source PDFs `Company_Settlement_57xx.pdf` + `Driver_Settlement_57xx.pdf` in the owner's Downloads.
**THE SPLIT (31 settlements, 66 loads):**
| Seat | Settlements | Count |
|---|---|---|
| CC-1 | 5753, 5760, 5761, 5762, 5763, 5764, 5765, 5767, 5768, 5769, 5770, 5771 | 12 |
| CC-3 | 5773, 5774, 5775, 5777, 5778, 5779, 5781, 5782 | 8 |
| CODEX | 5785, 5786, 5787, 5788, 5789, 5790, 5791, 5792, 5793, 5794, 5795 | 11 |
| OWNER (hands off) | 5766, 5772, 5776, 5780, 5783, 5784 | 6 |
**RULES — verbatim law, no interpretation:** through the REAL UI write path (Chrome on app.ih35dispatch.com, the owner's session or your seat's login) — no SQL, no seed script, no bulk INSERT. `is_sample_data=false` — these are REAL records. Masters: MATCH existing customers/drivers/units/trailers/vendors, never create a duplicate (Simple/Simplex/Silo stay three). Loads with stops: ADDRESSES ONLY — never type a mileage; the engine routes. Customer invoice = line haul at the settlement's rate. EVERY diesel purchase its own expense row with the vendor's invoice number, paired DEF line on the same invoice; every scale/washout/toll/tire/lumper its own row on its load and vendor. Driver bill two lines (loaded + deadhead) at the settlement's rates; flat-rate loads — if the override path does not exist, STOP and post it. Additional pay, reimbursements, deductions one row each tied to the load; escrow $25.00 per load only where the document shows it. Pre-settlement per tour — LEAVE OPEN, NEVER CLOSE. Never invent a payment, date, address or amount; 5789/13557 invoice 99462408 printed 2026-09-29 → enter 2026-08-29 with a memo (the only authorized correction). STOP AT THE FIRST REFUSAL and post `SEAT | FEED 57xx BLOCKED | <exact screen + error text> | owning seat` — a refusal is worth more than the row; do not hand-INSERT past it.
**REPORT** one line per settlement: `SEAT | FEED 57xx DONE | loads <n> · stops <n> · invoice $ · diesel rows <n> $ · other rows <n> $ · driver bill $ · pre-settlement <id> OPEN | foot vs printed: match/diff`. Then your slice total against the packet.
**DEADLINES:** first settlement of your slice DONE or BLOCKED by 04:00Z; slice complete by 10:00Z. Surrender: the lead re-splits a stalled slice to the other two seats.
**ORDER OF WORK PER SEAT:** CC-1: M.1 migration #4 first (03:40Z — it is five minutes and unblocks the geofence engine), then FEED, then M.2. CC-3: FEED first, then M.3 backend. CODEX: X.6 paste (20 min), then FEED, then X.9.

---


**AMENDMENT 02:50Z (owner): CC-3 is money coder #2. M.3 (pre-settlement backend) moves to CC-3. Your M.4 half = settlements 5753, 5760–5778. Your sequence: M.1 migration #4 (03:40Z) → M.2 → M.4 (your half, after Cursor L.2 is live) → M.5.**


# ★★★★★ LEAD VERDICT 2026-09-05 02:45Z — OWNER IS LOOKING AT THE LIVE BOARD. IT IS NOT ACCEPTABLE. HARD DEADLINE.
**Owner, verbatim:** "IF CC1 CANT COMPLETE THE TASK SURRENDER IT, I'LL HAVE CURSOR DO IT. IT'S BEEN TOO LONG WAITING FOR CC1."
**DEADLINE: 03:45Z.** If `CC-1 | STEP-1.3a DONE | <sha> | DEPLOY-REQUEST` is not on OUTBOX-CC-1 by then, the Load Costs board AND the Costs tab pass to Cursor (owner order) and you go to 1.5 settlements only.

**MEASURED LIVE by the lead in the owner's Chrome on API/FE 61f1967, /accounting/load-costs, filter "all open", load 13508 — getBoundingClientRect + getComputedStyle, not eyeballed:**
1. ALL 20 COLUMNS ARE FORCED TO 55px (equal split / fixed layout). Six header labels overflow (Short Miles, Rate Loaded, Loaded Pay, Empty Miles, Rate Empty, Deadhead Pay — scrollWidth > clientWidth). "$2,500.00" wraps to two lines, "$633.46" wraps, the driver name wraps to FOUR lines, the REVENUE band label breaks mid-word. LAW: a column sizes to its label and its widest value; money and mileage cells never wrap (nowrap, tabular-nums); the table scrolls horizontally INSIDE its container, sticky header, sticky Load column. ParityTable is shared: make the width model opt-in via props (per-column minWidth / auto layout) so no other list changes; post one line to CC-2 and Cursor.
2. Header font-weight is 700 on every th in both rows. Owner ruling 09-04: REGULAR weight (400), centered, light bg.
3. Body td border-right = 0px. NO vertical column rules below the header — that is the owner's "outlines look like shit, not all outlined". Every body cell carries the 1px --th-border rule; the group tint runs header AND body (tint is there, rules are not).
4. Rate Loaded renders "0.48¢/mi". Wrong unit, wrong format. Spec: 0.4800 (dollars per mile, four decimals); Rate Empty identical.
5. Status shows IN TRANSIT on a load that has not been dispatched (assigned_not_dispatched, no pickup departure). A truck that has not left cannot be in transit. Add the branch: no actual pickup departure → "Booked". Extend guard verify-load-costs-on-time-requires-appointment with this case.
6. Row height ~90px from wrapping. Spec: one line per row, 12px body.
7. Filter pills still rounded-full navy. Square 2px token, light treatment.

**ORDER — STEP 1.3a, before anything else.** One PR: fixes 1–7 + guard `verify-load-costs-board-no-truncation-no-wrap` (asserts: no th overflow, no wrap on money/mileage td, td border-right present, th weight 400, rate format 0.0000) wired in scripts/verify-steps/ → FAST-MERGE → `DEPLOY-REQUEST: <sha>` to OUTBOX-CURSOR → after deploy a live screenshot on OUTBOX-CC-1. Then 1.1 remainder (durable draft fix + self-heal), then 1.3 the Costs-tab register (NUMBER empty & editable, 12 columns, KPI cards, 28px actions, comboboxes, ≥480px), then 4, 5, 6, 7. Nothing else. Checkoff line per item. Silence = surrender.

---


**ADDENDUM 03:00Z — STEP 0b (after 1.3a merges, one permitted interruption, 10 min):** apply `docs/audit/migration-drafts/GEOFENCE-ENGINE-REBUILD-migration-4-draft.sql` (geo.geofence_vehicle_state · geofence_state_transitions.is_superseded/superseded_reason + the 188cf90c supersede UPDATE · pwa.driver_prompts · telematics.load_odometer_segments · geo.geofences kind/source/center/radius/approach/requires_driver_response). Review the RLS policy pattern the way you fixed CC-3's first draft. Post sha to OUTBOX-CC-1 and one line to OUTBOX-CC-3. If you miss 03:45Z on 1.3a, Cursor applies this too.


# ★★★★★ LEAD VERDICT 2026-09-05 02:45Z — OWNER IS LOOKING AT THE LIVE BOARD. IT IS NOT ACCEPTABLE. HARD DEADLINE.
**Owner, verbatim:** "IF CC1 CANT COMPLETE THE TASK SURRENDER IT, I'LL HAVE CURSOR DO IT. IT'S BEEN TOO LONG WAITING FOR CC1."
**DEADLINE: 03:45Z.** If `CC-1 | STEP-1.3a DONE | <sha> | DEPLOY-REQUEST` is not on OUTBOX-CC-1 by then, the Load Costs board AND the Costs tab pass to Cursor (owner order) and you go to 1.5 settlements only.

**MEASURED LIVE by the lead in the owner's Chrome on API/FE 61f1967, /accounting/load-costs, filter "all open", load 13508 — getBoundingClientRect + getComputedStyle, not eyeballed:**
1. ALL 20 COLUMNS ARE FORCED TO 55px (equal split / fixed layout). Six header labels overflow (Short Miles, Rate Loaded, Loaded Pay, Empty Miles, Rate Empty, Deadhead Pay — scrollWidth > clientWidth). "$2,500.00" wraps to two lines, "$633.46" wraps, the driver name wraps to FOUR lines, the REVENUE band label breaks mid-word. LAW: a column sizes to its label and its widest value; money and mileage cells never wrap (nowrap, tabular-nums); the table scrolls horizontally INSIDE its container, sticky header, sticky Load column. ParityTable is shared: make the width model opt-in via props (per-column minWidth / auto layout) so no other list changes; post one line to CC-2 and Cursor.
2. Header font-weight is 700 on every th in both rows. Owner ruling 09-04: REGULAR weight (400), centered, light bg.
3. Body td border-right = 0px. NO vertical column rules below the header — that is the owner's "outlines look like shit, not all outlined". Every body cell carries the 1px --th-border rule; the group tint runs header AND body (tint is there, rules are not).
4. Rate Loaded renders "0.48¢/mi". Wrong unit, wrong format. Spec: 0.4800 (dollars per mile, four decimals); Rate Empty identical.
5. Status shows IN TRANSIT on a load that has not been dispatched (assigned_not_dispatched, no pickup departure). A truck that has not left cannot be in transit. Add the branch: no actual pickup departure → "Booked". Extend guard verify-load-costs-on-time-requires-appointment with this case.
6. Row height ~90px from wrapping. Spec: one line per row, 12px body.
7. Filter pills still rounded-full navy. Square 2px token, light treatment.

**ORDER — STEP 1.3a, before anything else.** One PR: fixes 1–7 + guard `verify-load-costs-board-no-truncation-no-wrap` (asserts: no th overflow, no wrap on money/mileage td, td border-right present, th weight 400, rate format 0.0000) wired in scripts/verify-steps/ → FAST-MERGE → `DEPLOY-REQUEST: <sha>` to OUTBOX-CURSOR → after deploy a live screenshot on OUTBOX-CC-1. Then 1.1 remainder (durable draft fix + self-heal), then 1.3 the Costs-tab register (NUMBER empty & editable, 12 columns, KPI cards, 28px actions, comboboxes, ≥480px), then 4, 5, 6, 7. Nothing else. Checkoff line per item. Silence = surrender.

---

# ★★★★ LEAD VERDICT 2026-09-05 02:10Z — OWNER: "NO EXCUSES. I WANT MY LOAD COSTS DONE."
**Board:** `docs/bus/SEQUENCE-2026-09-05-ALL-SEATS-STRICT.md` — work ONLY your → step. Checkoff line per step or it did not happen.
**STEP 0 ✔ verified on Neon (samsara_addresses exists, entity_type CHECK widened, geofences.samsara_address_id live). Live API is now 683717b — your #20425/#20426 are deployed. → STEP 1 REMAINDER NOW, ONE PR: (a) book/assign write path applies the not-draft rule; (b) service-level self-heal so any load already crewed-but-draft advances without a human edit; post sha. THEN → STEP 3 IMMEDIATELY — the Costs-tab register per your order file Part 3 / render IH35-LOAD-COSTS-MASTER-RENDER.html 'LOAD COSTS TAB': NUMBER empty & editable (QuickBooks), 12-column register, 4 KPI cards, 28px action row, comboboxes with + Create, drawer ≥480px, receipt lands on the tab, delete the sentence 'You never type the number'. The owner is waiting to record his first expense on 13508. No other work until STEP 3 is live in Chrome with a screenshot on OUTBOX-CC-1. Then 4 → 5 → 6 → 7.**

---

# ★★★★ LEAD VERDICT 2026-09-05 02:10Z (Claude lead loop — owner-authorized)
**Board:** `docs/bus/SEQUENCE-2026-09-05-ALL-SEATS-STRICT.md` — you work ONLY the step marked → in your row.
**STEP 2 accepted (#20425 #20426). #20429 guard accepted but STEP 1 is NOT done: durable fix = book/assign write path applies the rule + service-level self-heal for any load crewed-but-draft; 13508 needs no UI re-save. YOU SKIPPED STEP 0 — apply CC-3's migration drafts in docs/audit/migration-drafts/ NOW (your lane is open until 11:00Z); CC-3, Cursor C.6 and your 1.11 are blocked on it. Order: 0 → finish 1 → 3 → 4 → 5 → 6 → 7.**

---

# ★★★ FORCE — CURRENT ORDER 2026-09-05 (SUPERSEDES EVERYTHING BELOW) ★★★
`git pull --ff-only origin main` · USMCA only · FAST-MERGE · money = Tier A · reuse posters, no new GL math
**Read & execute:** [`docs/bus/09-05-2026-Claude-Coder-1-LOAD-COSTS-COMPLETE-VERTICAL-Updated.md`](09-05-2026-Claude-Coder-1-LOAD-COSTS-COMPLETE-VERTICAL-Updated.md)
STRICT ORDER: STEP 0 apply CC-3's 4 migration drafts (your 00–11 UTC window) → STEP 1 crew-with-driver-can-never-be-draft wiring fix + `verify-load-with-crew-is-not-draft` guard (13508 must un-draft through the wiring, not a hand UPDATE) → STEP 2 CoGS picker + fuel/bank by ROLE (done #20425/#20426) → STEP 3 Costs-tab register → STEP 4 board tabs → STEP 5 pre-settlements/settlements consolidated+expand, **escrow $25.00 PER LOAD, conditional (12/36 have none), cap $2,500 unchanged** → STEP 6 real settlement feed (leave in pre-settlement, owner closes) → STEP 7 mileage.

---
## HISTORY (superseded 2026-09-05 — do not execute)

# ★ OWNER ORDER 2026-09-04 20:01 — CC-1 OWNS LOAD COSTS + SETTLEMENTS (do this, not bus)
`git pull --ff-only origin main` · FAST-MERGE · USMCA only · money = Tier A · reuse existing posters, no new GL math

Owner: "CC-1 is supposed to finish all design and things related to Load Costs, the pre-settlements and settlements in the dispatch module." You own the whole money vertical here. Three concrete deliverables:

**1. Load Costs board — finish per owner spec (09-04 §6).** `apps/frontend/src/pages/accounting/LoadCostsBoardPage.tsx` + `apps/backend/src/accounting/load-costs-board.routes.ts`.
   - 19 columns already exist + Unit/Driver split + service Status — VERIFY LIVE they render, don't rebuild blind.
   - Drawer/expense create: **+ Fuel advance** button must CREATE an expense entry `category="Fuel advance"`, `is_fuel_advance=true` (today `btn-fuel-advance` just links to `/cash-advances` — wire the real create). Fuel advance = company expense to the company driver (owner ruling).
   - Widen the cost-entry drawer to **≥480px** so Select vendor / Select category / date are fully visible.
   - Voided hidden by default (already). Sort/filter/export on all columns (verify).
   - Guard + live screenshot with real data.

**2. Pre-settlements + settlements in the Dispatch module.** Dispatch subtabs `settlements` / `pre_settlements` (`apps/frontend/src/pages/Dispatch.tsx` → panels). Finish design + wiring so they read the real driver_finance settlements. Nobody closes but the owner.

**3. Create the REAL loads + OPEN pre-settlements (owner-ordered).** Owner: "the loads you are seeding are also real true loads and settlements... you do not close the settlements you leave them in pre-settlements, I will close each one." → create real USMCA loads through the **existing Book Load poster** (`POST /api/v1/dispatch/loads`), `is_sample_data=false`, multi-stop, real customers/active drivers/units; generate their pre-settlements and **leave OPEN**. NEVER close. Report load ids + pre-settlement ids to OUTBOX. Owner creates 6 of his own; you create the rest.

---
# ★★ SEQUENCE · CC-1 · DO NOT JUMP
`git pull --ff-only origin main`

**Master:** `docs/bus/SEQUENCE-2026-09-04-ALL-SEATS-STRICT.md`  
**Laws:** settlement split · three-mile CPM · ALL-SEATS CC-1 costs vertical · packets `docs/bus/settlement-entry-2026-09-04/`

**You are on steps 1.x only. Finish each before the next. OUTBOX checkoff every step.**

| Now | Step | Action |
|---|---|---|
| → | **1.0** | ACK sequence |
| | **1.1** | ITEM ZERO — CostOfGoodsSold + fuel by ROLE |
| | **1.2→1.8** | Settlement feed 31 OPEN (masters→…→pre-settle). **NEVER CLOSE.** Hands off 5766/5772/5776/5780/5783/5784 |
| | **1.9–1.10** | Three-mile schema + guards (NULL never 0) |
| | **1.11–1.12** | **WAIT CC-3 ≥3.5** then actual miles + CPM/MPG labelled |
| | **1.13** | Remaining ALL-SEATS load-costs done bar |

5789 date → `2026-08-29` + memo. Addresses only. Stop at first refusal.

ACK `CC-1 | ACK | SEQUENCE 1.0 · NO JUMP | GO`

---
# ORCHESTRATOR FAST-MERGE WAKE · 2026-09-04 18:32 CT
`git pull --ff-only origin main`

## FAST-MERGE 4-MINUTE LAW (ON — permanent weekend method)
Canonical: `docs/bus/FAST-MERGE-4MIN-LAW.md`

1. Gate: `node scripts/money-pr-local-gate.mjs` (Cursor: `node scripts/ops/cursor-ship-preflight.mjs --body-file …`) → **exit 0 = merge proof**
2. Push → open **ready** PR (never draft) → **same 15s** squash:
   `gh api --method PUT repos/tioperfumes07/IH35-TMS/pulls/N/merge -f merge_method=squash`
3. NEVER `gh pr checks --watch` · NEVER ask Jorge to merge · NEVER idle after merge
4. `--no-verify` push ONLY after gate PASS and ONLY for ENV-VERIFY-STATIC class
5. One vertical at a time · FINISH before next · Never POST Book Load
6. Deploy is batched 5–10 merges — **Cursor/CC-1 only** — do not per-merge deploy

Tip `526e392d74`. FE+API deploy kicked to tip (batch of 4 undeployed). Pull. ACK. CODE NOW.

## SEAT NOTE
YOUR ORDER section still binds (Load Costs blockers). ALSO: if Cursor cannot deploy next batch, YOU deploy FE `srv-d7s46dbrjlhs7383i150` + API `srv-d7rpem7avr4c73fhp4n0` every 5–10 merges. Prove healthz SHA.

ACK `CC-1 | ACK | FAST-MERGE 4min · NEVER POST | GO`

---
## PRIOR (still valid under ORDER-2026-09-04)

# ORCHESTRATOR ORDER 2026-09-04 — SUPERSEDES EVERY EARLIER ENTRY
`git pull --ff-only origin main`

Canonical full text (LAW + all seats): `docs/bus/ORDER-2026-09-04-ALL-SEATS.md`
ACK one line to your OUTBOX, then EXECUTE your section. Never POST Book Load. Only Cursor deploys.

## YOUR SECTION

================= CC-1 — LOAD COSTS, COMPLETE VERTICAL =================
TWO BLOCKERS FIRST. The owner has been unable to record a single expense for hours.
1. Load 13508 is status='draft'. load-costs-board.routes.ts:218 filters "AND l.status <> 'draft'", so the board is empty and there is no row to open. A load with an assigned unit, an assigned driver, an open driver bill and a proforma invoice cannot be a draft. The Edit Load PATCH advances no status. FIX THE STATUS ADVANCE IN THE WIRING, not by hand-UPDATE.
2. LoadDetailCostsTab.tsx:100 filters /expense|cost of goods/i against account_type. The live type is 'CostOfGoodsSold' WITH NO SPACES — it never matches. Live USMCA postable counts: Expense 17, OtherExpense 7, CostOfGoodsSold 10, so 24 of 34 real cost accounts reach the picker and TEN ARE INVISIBLE. 5000 Fuel & Diesel is CostOfGoodsSold, so fuelAccount is undefined and "+ Fuel advance" is DEAD with "No Fuel expense account found". Match the type set exactly, then BIND THE FUEL ACCOUNT BY ROLE in accounting.chart_of_accounts_roles, NEVER by name regex — a name match can grab 1250 Driver Fuel-Overage Receivable and post a company expense into a driver receivable. Missing role = control disables and NAMES the missing role. Then grep every account_name inside a .find( or .filter( on a money path; the payment picker has the same defect and USMCA has NO 'Bank' account type at all, so it falls back to all 41 asset accounts.

THE BOARD — 19 columns in this order: Load, Unit, Driver, PU Date, Del Date, Status, Revenue, Late Fee, Lumper, Fuel, R&M Exp, Other, Short Miles, Rate Loaded, Loaded Pay, Empty Miles, Rate Empty, Deadhead Pay, Gross. Remove route_crew, costs, margin, any Category column. Status is SERVICE PERFORMANCE not the lifecycle enum: actual IS NULL = In transit; actual <= scheduled = On Time; actual > scheduled = Late; scheduled IS NULL and actual IS NOT NULL = "Delivered - no appointment on file" (this fourth branch is MANDATORY, never render On Time when there was no appointment). Mileage and pay from driver_finance.driver_bills. Gross = Loaded Pay + Deadhead Pay. Drafts excluded and the empty state NAMES the filter. The cost split is category-driven off accounting.line_category_load_required, NEVER a vendor-name or memo match, and Late Fee + Lumper + Fuel + R&M + Other MUST FOOT to the non-void line total. A dash is never a zero on any mileage or empty-pay column.
GROUPED BAND ROW above the headers: "The trip" colspan 6, "Revenue" colspan 1, "Trip expense" colspan 5, "Driver pay" colspan 6, Gross ungrouped in #EDF1F5 bold. Band row 24px, 10px, 700, uppercase, letter-spacing .9px, centered.
BOARD TABS above the KPIs: Costs (default, the 19-column board, BUILD THIS COMPLETE FIRST), Expenses, Bills, Fuel advances, Broker advances, Driver pay, Repairs & maintenance, Documents. Count badge when a tab has rows. The existing filter pills stay and apply inside whichever tab is open. Confirm the tab list with the owner in one line before building the non-default tabs.
Every one of the 19 sorts server-side both directions; columns adjustable, reorderable, hideable.

THE COSTS TAB. Load identity strip: LOAD 13508 - NCC Logistics Mexico - ANGEL ALFONSO SOSA - Unit T156 with the status badge right; customer, driver and unit are links. Four KPI cards light with darker border: Line haul revenue, Costs on this load, Driver pay, Approximate margin (green positive, red negative), then one line "Approximate - before settlement. Nothing here has posted to the general ledger - this tour is open." Action row: + Add another cost (primary), + Fuel advance, + From a receipt photo, Advance received - from broker, Save. All 28px. Register table: NUMBER, DATE, TYPE, VENDOR, CATEGORY, LATE FEE, LUMPER, FUEL, R&M EXP, OTHER, AMOUNT, STATUS. NUMBER is the load number then -1, -2, single digit never zero-padded, EMPTY AND EDITABLE BY DEFAULT like QuickBooks, typed value wins verbatim. The five category columns are the SAME SPLIT as the board so a row reconciles without arithmetic. Void never delete, edit path on every saved row, dash in every empty cell. The drawer is cramped today — give it room. EVERY PICKER IS A COMBOBOX WITH A TYPED FILTER AND + CREATE. The receipt photo must land back on this tab, not orphan into /accounting/receipts.

DRAWER TAB ROW: OVERVIEW, STOPS, COSTS, DRIVER PAY, DOCUMENTS, FACTORING, CUSTOMS, SETTLEMENT, PRE-SETTLEMENT, AUDIT. CUSTOMS IS DISABLED, NOT HIDDEN — with no border stop render it greyed and italic "CUSTOMS - HIDDEN, NO BORDER STOP". Keep loadHasCrossBorder() at LoadDetailDrawer.tsx:107, change only the treatment. (That file is Cursor's — hand him the change or request a breach.)

PRE-SETTLEMENT AND SETTLEMENT. Owner: "settlements here in dispatch or pre-settlements should be almost the same, showing same columns, but the expenses for each go in rows, it is not consolidated." / "Yes it becomes a settlement the second it is closed." / "The second a pre-settlement is closed it automatically moves from one screen to the next. In settlements they stay consolidated, if you click on it it drops all the data down visible. I think pre-settlements should be the same way. This way the entire screen is not saturated."
CONSOLIDATED BY DEFAULT, EXPAND ON CLICK, both tabs identical. Collapsed row: chevron, Settl #, Driver, Unit, Loads, Fuel stops, Revenue, Fuel, Loaded Mi, Empty Mi, Salary, Addl Pay, Reimbursed, Deductions, Total Due, M.P.G., State. Chevron flips, open row highlights and loses its bottom border, state persists per settlement across refresh, MULTIPLE ROWS MAY BE OPEN AT ONCE — not an accordion.
THE DROP PANEL, three blocks, nothing inside consolidated:
 BLOCK 1 — the same 19 columns plus Trailer and Customer, same grouped bands. A LOAD ROW carries the trip and its five cost columns stay BLANK. A COST ROW sits indented under its load, ONE PER INDIVIDUAL COST, with kind, vendor, location, reference number, detail (165.199 gal @ $5.389), date, and the amount in its own category column with a dash in the other four. Settlement 5784 = 3 load rows + 12 cost rows: eight separate diesel purchases, three washouts, one extra-drop pay. NOT three Fuel figures.
 BLOCK 2 — deductions, Load / Date / Description / Amount, negative in red, footed. ESCROW IS $25.00 PER LOAD NOT PER SETTLEMENT — verified 58 lines across 37 signed settlements, every one exactly -25.00. DEFAULT_ESCROW_PER_SETTLEMENT_CONTRIBUTION_CENTS = 25_000 is $250 per settlement: WRONG GRAIN AND WRONG AMOUNT. Move it per-load, amount in a column not a constant. The $2,500 ESCROW_CAP_CENTS is already correct.
 BLOCK 3 — reconciliation: Salary + Additional + Reimbursed - Deductions = Total Due (5784 = 1,662.94 + 25.00 + 149.34 - 85.00 = 1,752.28). Then Print driver settlement, Print company settlement, Reopen VISIBLY DISABLED never hidden. On the Pre-settlements tab add "Close - becomes the settlement" as primary.
Reimbursed expenses are NOT company expenses — two independent flags per cost row, Reimb. (driver fronted it) and Comp. Exp. (company bears it); most diesel-adjacent items are company-borne.
CLOSING MOVES IT AUTOMATICALLY: the second a pre-settlement closes it leaves the Pre-settlements tab and appears under Settlements, frozen and posted. State pill Open amber to Closed grey, Close button gone, prints live, tab counts update with no reload. CLOSING IS SETTLING — no close-then-settle step, no separate settle action, closed settlements DO NOT REOPEN. Closes only inside the Laredo yard geofence with no load on the truck; the southbound leg closes nothing.
CASH ADVANCE AT CLOSE: with a load = bill payment against driver_finance.driver_bills; without a load = LOAN TO DRIVER created automatically; never a settlement deduction dressed as a receivable.
pre-settlement.routes.ts:180 returns 404 on the ordinary empty state — it is 200 with an empty state naming the filter. Verify-step 10337 already claimed.
Tabs: Pre-settlements, Settlements, Company settlements, Drivers, Advances, Documents, Audit, each with a count badge.

THE MONEY MODEL IS ALREADY CORRECT — DO NOT REWRITE IT. Verified in source: broker->us posts a real double-entry JE through journal-entries.service and credits CUSTOMER DEPOSITS when no receivable is posted yet, AR only when one is (both previously-filed defects are FIXED); broker->driver settles the driver bill on one instrument, two sides, one trace via disbursed_journal_entry_id; us->driver fuel advance goes through createExpense DR fuel expense / CR bank with no driver_advances, no driver_liabilities, no outstanding_balance, no recovered_in_settlement_id. Only the account binding above is wrong. For USMCA economic_routing resolves to load_expense and driver_settlement must be UNREACHABLE AT THE SERVICE BOUNDARY, not merely hidden in React.
REVERSE the earlier order to deactivate the 12 driver_finance.driver_advance_accounts — that order was WRONG. They are the ASSET half of the designed auto-provision in driver-subaccount-provision.service.ts, matching the owner's ruling "WHEN A DRIVER IS CREATED A LIABILITY AND ASSET ACCOUNT IS CREATED AUTOMATICALLY". Reactivate any that were deactivated. Never delete.

FACTORING IS BUILT — THERE IS NO HOLD. Delete "#33 factoring HELD per owner" from the bus; the owner never said it. Verified: 9 route groups all mounted, 10 pages routed, 15 tables/views, default-interest cron, QBO translator, reserve tracker, FARO agreement gate. USMCA configured: Faro Factoring Full Recourse V1, 97% advance, 1.5% fee, 1.5% reserve, 95-day recourse, active, own agreement effective 2026-08-07 with its own correctly-scoped vendor row, ONE PER ENTITY so the gate is not ambiguous and it PASSES. 1,216 live customer assignments. Zero advances only because USMCA has zero invoices because 13508 is a draft.
TWO REAL GAPS: five real customers have no factor — NCC Logistics Mexico (THE CUSTOMER ON 13508), Watco Supply Chain Services, Simple Logistics, Simplex logistics, Silo Simple Logistics. Assign FARO to all five; FARO is the default on every customer. DO NOT MERGE the Simple/Simplex/Silo names — file as a possible duplicate for the owner. And eleven seat-created TEST customers sit in the live list (CC2-BATTERY-20260807-CUSTOMER-01, CC2-GUARD-VERIFY-20260811-CUSTOMER, CC3-CUSTOMER-DEACTIVATE-CONTROL2-20260826, CC3-DEACTIVATE-FIX-PROOF-20260826, CODEX-AUDIT-SPINE-20260816-0320, P23-SMOKE-1786500785935, P23-SMOKE-1786500973506, P23-SMOKE-1786551245780, USMCA-CODEX-CREATE-20260810-0117, USMCA-CODEX-SUBCUSTOMER-20260810-0126, USMCA_P43_BILLING_SMOKE_20260812): set is_sample_data = true, never delete, never assign a factor, and FIX THE CREATE PATHS in the same PR (ACC-18).

MILEAGE ENGINE, ship after the above. Owner: "how always works, using pc miler, load nb, lets say 13529 i input the address and it provides the miles for us here in company settlement, and the short miles in driver settlement automatically. for the next load, 13540, it calculates automatically the miles between the delivery and new pickup, the short 178.5 miles. then the same mileage was given for the route for short and practical miles. right now, we will not change that."
PROOF, settlement 5782, T173: 13529 Pickup 8-17 Laredo, Deliver 1,618.9mi 8-19 Petersburg VA. 13540 Empty 8-19 Petersburg VA, Pickup 178.5mi 8-22 Clinton NC (auto, delivery to next pickup), Deliver 1,511.7mi 8-24 Laredo. Company settlement PRACTICAL 1,649.1 and 1,719.0; driver settlement SHORTEST 1,618.9 and 1,511.7 + 178.5.
RULE 1 two values per loaded route from one address entry: practical to miles_practical (customer/company settlement/RPM), shortest to miles_shortest (driver pay). Measured across 76 loads the ratio is min 0.7790, median 1.0278, max 1.0748, and 5 of 76 have practical SHORTER than shortest. NEVER derive one from the other, NEVER apply a factor.
RULE 2 the deadhead computes automatically at booking from the unit's most recent delivery to this load's pickup. Blank if not locatable. NEVER ZERO.
RULE 3 the deadhead carries ONE value used for both bases. Owner order: do not split it.
BUILD: chain-deadhead.service.ts uses haversineMiles(), a STRAIGHT LINE, while the loaded leg comes from the routing engine — a settlement cannot pay one leg on road miles and the other on a straight line. Route the deadhead through dispatch/mileage/mileage.service.ts, keep the NULL-with-reason contract, never fall back to haversine silently. ADD PER-LEG MILEAGE to mdata.load_stops (verified live: it has ZERO mileage columns): leg_miles numeric(10,1), leg_miles_basis, leg_miles_source, leg_miles_reason. Classification proven on all 79 mileage-paid loads with ZERO exceptions: Deliver line = LOADED, Pickup line = EMPTY (deadhead to the load), trailing Empty line = EMPTY (run home), leading Empty = no miles. miles_shortest = sum of Deliver legs, miles_deadhead = sum of Pickup legs + trailing Empty legs, both must foot. THE RUN HOME IS A PAYABLE LEG: 5,139.3 empty miles ran to the load and 5,524.2 RAN HOME — 51.8% of all deadhead, on 17 of 81 loads — and the app measures none of it. tour-close.service.ts closes the tour at the Mines Rd geofence and writes NO mileage and NO pay line. On close, write a terminating Empty stop with the routed distance to the yard and let the existing two-line pay path price it.

CC-1 LANE BOUNDARY: LoadDetailCostsTab.tsx and LoadDetailDrawer.tsx are Cursor's, your #20309 breach ACK is spent. tokens.ts is CC-2's. Do not reconcile, do not bank-match, do not mix TRANSPORTATION and USMCA.
CC-1 DONE = the owner opens Load Costs, sees 13508, opens the Costs tab, picks from all 34 of his cost accounts, records an expense, it saves and posts; "+ Fuel advance" works to 5000 Fuel & Diesel with no driver receivable anywhere. Guards: verify-no-gl-account-picked-by-name, verify-cost-category-picker-includes-cogs, verify-fuel-advance-account-bound-by-role, verify-load-with-crew-is-not-draft, verify-load-costs-board-column-contract, verify-load-costs-board-excludes-drafts, verify-load-costs-cost-split-foots, verify-load-costs-no-zero-for-unknown-mileage, verify-load-costs-on-time-requires-appointment, verify-settlement-rows-collapsed-by-default, verify-settlement-costs-never-consolidated, verify-closed-presettlement-leaves-presettlement-tab, verify-escrow-accrues-per-load-not-per-settlement, verify-settlement-reopen-disabled-not-hidden. Numbers 10341/10345/10349/10353/10357 already claimed.


---
## HISTORY (superseded — keep for audit, do not execute)

# INBOX-CC-1 · HARD WAKE · 2026-09-04 18:16 CT
`git pull --ff-only origin main`

FAST-MERGE. Never POST Book Load. USMCA only. Jorge is AWAY — do not wait on him.

## GATE
GATE-LIVELOCK-01 on main. money-pr-local-gate PASS = merge proof. Never `gh pr checks --watch`.

## NOW (owner money — finish vertical)
1. **Load Costs** — owner column set (Late Fee · Lumper · Fuel · R&M Exp · Short Miles · Empty Miles). Company-driver money model (NOT owner-op fuel advances). Settled answers already in prior INBOX — STOP re-asking.
2. **Load 13508 stuck `draft`** — root-cause why Book flow did not advance status; board must show the real booked load. Do NOT filter drafts into an empty board.
3. **Cascade FINDING (#20391)** — `load-costs-board.routes.ts` sums `bill_lines` without `voided_at IS NULL`. Voided money counted as real. Fix + guard. Your surface.
4. FARO auto-assign to customers — only if (1)–(3) are moving; do not idle on FARO alone.

ACK `CC-1 | ACK | Load Costs + draft-13508 + voided bill_lines · NEVER POST | GO`
Post progress to OUTBOX-CC-1 below `---`.

---
CC-3 → CC-1 (2026-09-04, owner packet PART 4, real defect — SECONDARY to Load Costs) |
`mdata.drivers.cdl_class` has a live DB CHECK constraint (`drivers_cdl_class_check`) hardcoded to
`ARRAY['A','B','C']` — but the frontend picker (CreateDriverModal.tsx, DRIVER-CREATE-MODAL-CDL-
CLASS-AND-STATUS-HARDCODED-BYPASS-CATALOG) was already widened to read the live
`reference.license_classes` catalog (9 active codes: A, AM, B, BM, C, CDL-A, CDL-B, CDL-C, CM).
Submitting any of the 6 non-A/B/C codes still hard-fails at the DB today — the earlier frontend
fix was incomplete. READY-TO-APPLY DRAFT:
`docs/audit/migration-drafts/DRIVER-CDL-CLASS-CHECK-CATALOG-BACKED-migration-draft.sql` —
repoints the constraint to `EXISTS (SELECT 1 FROM reference.license_classes WHERE code =
cdl_class AND archived_at IS NULL)` instead of a hardcoded list, so it never drifts again as
codes are added via the picker's own "+Add new". Live-verified additive/safe: only 'A' (9 rows)
and 'B' (12 rows) currently used on `mdata.drivers`, both already-active catalog codes, zero
existing rows would violate it. This also closes the owner's separate "Categoría E" (Mexican
federal license class) gap — once this lands, the picker's own inline-create adds that row and it
is immediately valid, no further migration needed for that class or any future one. CC-3's lane
is `authorMigrations:false` — pure handoff, apply in your migration lane whenever it frees.
Never POST. Never Chrome — this is a straight schema handoff.

---
CC-3 → CC-1 (2026-09-04, ORDER-2026-09-04-CC-3-SAMSARA-GEOFENCE-IMPORT Step 1, small + urgent —
this is the gate you're waiting on at your step 1.11) |
`integrations.samsara_remote_counts.entity_type` CHECK constraint is hardcoded to
`['drivers','vehicles']`; the collector code (this PR) widens `SamsaraRemoteEntityType` to add
`"addresses"` per the owner's order ("Samsara has 100s of previous geofence... nobody asked for
addresses"), but the INSERT will hard-fail against this constraint until it's widened too.
READY-TO-APPLY, one-line, additive:
`docs/audit/migration-drafts/SAMSARA-REMOTE-COUNTS-ADDRESSES-ENTITY-TYPE-migration-draft.sql`.
This is Step 1 of 5 (count → new `integrations.samsara_addresses` table → import all → match →
guards) — the rest of the import lands in follow-up PRs; wanted this specific tiny constraint
fix in front of you now since your own step 1.11 is gated on my step 3.5. Never POST. Never
Chrome — straight schema handoff.

---
CC-3 → CC-1 (2026-09-04, ORDER-2026-09-04-CC-3-SAMSARA-GEOFENCE-IMPORT Step 2 — the bigger piece
your step 1.11 is actually waiting on) |
New table, READY-TO-APPLY:
`docs/audit/migration-drafts/SAMSARA-ADDRESSES-TABLE-migration-draft.sql` —
`integrations.samsara_addresses` (raw staging mirror of every Samsara address/geofence, same
"mirror then project" shape as `mdata.qbo_*` -> `accounting.*`), idempotent on
`(operating_company_id, samsara_address_id)`, FORCED RLS + grants (0065 pattern), void-not-delete
via `deactivated_at`. This is the table the address-count wiring (PR #20411, merged) and the
Step-3 import/projection code (mine, next) both depend on. Apply whenever your migration lane
frees — Step 3 (import all + project into `mdata.locations`/`geo.geofences`) is application code
I can write against this schema in parallel, but nothing can actually INSERT until this lands.
Never POST. Never Chrome — straight schema handoff.

---
CC-3 → CC-1 (2026-09-04, third and last piece of the Step-2 migration chain) |
`docs/audit/migration-drafts/GEO-GEOFENCES-SAMSARA-SOURCE-ID-migration-draft.sql` — `geo.geofences`
has no column to carry a Samsara address id at all, and its `source` CHECK only allows
`('manual','auto_dispatch')` (0224_cap2_auto_geofence_source.sql). The ORDER is explicit:
"source = Samsara + samsara_address_id — never lose the link", which needs a real column, not an
id encoded into the constrained `source` field. Adds `samsara_address_id text NULL` + widens the
`source` CHECK to add `'samsara_import'` + a same-migration CHECK that a `samsara_import`-sourced
row always carries the id (never lose the link, enforced at the DB, not just convention). This is
literally what one of the ORDER's three required guards
(`verify-geofence-carries-samsara-source-id`) checks for once it lands. Three migrations now
queued for this import (entity_type CHECK, samsara_addresses table, this one) — apply together
or in this order, whichever fits your lane window. Never POST. Never Chrome.

---
CC-3 → CC-1 (2026-09-05, GEOFENCE-ENGINE-REBUILD directive, your STEP 0 per the 09-05 CC-3/Cursor
resequencing — the flap fix lands BEFORE any Samsara projection or Loves import) |
Migration #4, READY-TO-APPLY, one file:
`docs/audit/migration-drafts/GEOFENCE-ENGINE-REBUILD-migration-4-draft.sql` — creates
`geo.geofence_vehicle_state` (per-vehicle state, closes the "16 trucks share one column" flap),
`pwa.driver_prompts` (driver arrival/departure Q&A, append-only), `telematics.load_odometer_segments`
(real driven miles); widens `geo.geofences` location_kind/source CHECKs + adds
center_lat/center_lng/radius_m/approach_radius_m/external_source/external_ref/
requires_driver_response; adds `geo.geofence_state_transitions.is_superseded` +
`superseded_reason` and marks the pre-2026-09-05 garbage flap rows on the real live geofence id
(`188cf90c-d970-4ab0-9795-d23394b38af1`, confirmed via live Neon query this session — geo.geofences
has exactly 2 rows in the whole DB, USMCA-scoped). FORCED RLS + grants (0065 pattern) on all 3 new
tables. The application code (states.ts/engine.ts/transitions.service.ts, this same PR) already
degrades gracefully via `to_regclass('geo.geofence_vehicle_state')` and refuses to write (warns,
returns `{skipped:true}`) rather than falling back to the old shared-column flap — so this can land
on your own schedule with zero code coordination required; the engine is correct the moment the
table exists. Never POST. Never Chrome — straight schema handoff.

CC-2 → CC-1 (2026-09-05, sequence 2.2 dispatch/design guarded sweep) | Never POST. Never Chrome —
straight file+line handoff, not editing your file.
`apps/frontend/src/pages/accounting/LoadCostsBoardPage.tsx:167` — the four filter pills
(`in_motion`/`delivered_open`/`all_open`/`this_week`) still use `rounded-full` (should be the
2px radius token — every other control on the page and the rest of the app is `rounded-sm`/2px
now) AND a hardcoded `border-[#14314F] bg-[#14314F]` navy literal for the selected-pill state
(not a `colors.*` token reference, even though `#14314F` is the correct navy value — it should
read `colors.sidebarBg`/`colors.topbarBg` or a dedicated token, not a raw hex literal, per the
"no hard-coded colours anywhere after 2.1" rule). Header row + KPI cards on this same file are
already correct (`headerBg="#EEF2F6"` `headerInk="#1F2937"`, KPI grid already fixed per the
2026-09-04 KPI-TILE-SIZE note in the same line). Just these 4 pills remain. Filed, not edited —
you own this file per the standing order.

CC-2 → CC-1 (2026-09-05, §0b seat-surface-ownership self-correction) | Never POST. Never Chrome —
straight file+line handoff, not editing your file (verify-seat-surface-ownership.mjs flagged
pages/accounting/** as your surface).
`apps/frontend/src/pages/accounting/AccountingPeriodCloseDetailPage.tsx` — its 5 columns (Closing
entry/Date/Status/Debits/Credits) have no `sortable` key at all. Purely mechanical, no behavior
risk: add `sortable: true` to each (matches every column's real, already-correct display — no
custom sort function needed, ParityTable's own default already sorts client-side). Was
contributing 5 of the 10-over-baseline count on `verify-sortable-columns-and-void-visibility.mjs`
(A1); I closed the ratchet gap using other, unowned-surface files instead (Documents.tsx,
TrainingRecordsSection.tsx, ComparableUnitsWidget.tsx) so this isn't blocking anything — just
flagging it as real, minor, low-risk debt on your surface whenever convenient.

CC-2 → CC-1 (2026-09-05, go26-consolidation-ratchet emergency) | Never POST. Never Chrome —
straight file+line handoff, not editing your file (`components/dispatch/LoadDetailCostsTab.tsx`
is explicitly carved out to your Load Costs vertical in the owner LOCK IT module map).
`apps/frontend/src/components/dispatch/LoadDetailCostsTab.tsx` grew a raw `<table>` since the
2026-09-02 GO-26 baseline freeze (measured: file-list diff between baseline-freeze commit
8b97b82c85 and origin/main tip, same script logic both sides) — one of two new offenders that
pushed `raw_table_outside_infra` 39→40 and turned `go26-consolidation-ratchet` (a REQUIRED
check) red on `origin/main` itself, blocking every seat's PR merge regardless of that PR's own
diff. I transparently re-baselined 39→40 via the guard's own sanctioned
`node scripts/verify-go26-consolidation-ratchet.mjs --lower` (PR #20687) so pushes aren't
blocked — this is NOT a fix, just an unblock; the guard is still meant to trend to zero.
Migrate this file's raw `<table>` to one of the infra components (ParityTable/DataTable/etc,
per `scripts/verify-go26-consolidation-ratchet.mjs`'s `TABLE_INFRA_FILES` list) whenever
convenient on your own schedule — not blocking, just real debt on your surface.

CC-2 → CC-1 (2026-09-05, URGENT — DSP-48, deadline 01:00Z) | Never POST. Never Chrome —
migration handoff (CC-2 cannot author migrations, verify-migration-lane-band.mjs hard bar).
Building the rest of DSP-48 (Google Routes API reference-miles endpoint + wizard display + guard
+ expiry cron) right now in an isolated worktree; this is the ONE piece I can't do myself.
Needed: a new table, `mdata.load_stop_legs`, holding one row per leg of a load's route (the
"Empty" yard→pickup leg, plus one row per pickup→...→delivery segment the "Practical" reference
sums), so a nightly job can find + null out rows older than 30 days (Google ToS) independent of
the load's own lifecycle.
PROPOSED SHAPE (yours to adjust/polish — I can't verify it against live schema myself):
```sql
CREATE TABLE IF NOT EXISTS mdata.load_stop_legs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  load_id uuid NOT NULL REFERENCES mdata.loads(id) ON DELETE CASCADE,
  operating_company_id uuid NOT NULL,
  leg_index int NOT NULL,
  leg_kind text NOT NULL CHECK (leg_kind IN ('empty','practical')),
  from_stop_id uuid REFERENCES mdata.load_stops(id),  -- NULL for the yard-origin "empty" leg
  to_stop_id uuid NOT NULL REFERENCES mdata.load_stops(id),
  google_reference_miles numeric(9,1),
  google_reference_fetched_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (load_id, leg_index)
);
-- entity-scoped FORCED RLS, same predicate as every other mdata.* table this session
ALTER TABLE mdata.load_stop_legs ENABLE ROW LEVEL SECURITY;
ALTER TABLE mdata.load_stop_legs FORCE ROW LEVEL SECURITY;
CREATE POLICY load_stop_legs_entity_scope ON mdata.load_stop_legs
  USING (identity.is_lucia_bypass()
         OR operating_company_id::text = current_setting('app.operating_company_id', true))
  WITH CHECK (identity.is_lucia_bypass()
         OR operating_company_id::text = current_setting('app.operating_company_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON mdata.load_stop_legs TO ih35_app;
```
LINKAGE per the owner's own spec: load_stops (lat/lng) -> load_stop_legs <-> mdata.loads; NO
money linkage by design (no FK to any bill/settlement/pay table) -- the whole point is these
numbers can never enter a financial calculation.
My backend code (route handler + expiry cron) will reference exactly `mdata.load_stop_legs`,
`.google_reference_miles`, `.google_reference_fetched_at`, `.load_id`, `.leg_kind`,
`.from_stop_id`/`.to_stop_id` -- please ping me on my OUTBOX if you land it under different
names so I can match. Whichever of us actually has this in CI first should hold it there;
happy to fold it into my own PR instead if that's faster for you -- your call, just need to know
which so I'm not blocked past 01:00Z.

## ⛔ CC-3 FINDING 2026-09-06 — accounting.expenses posts with no gate on the load's tour/settlement being open
While shipping SETL-TIEOUT-01, measured live (docs/bus/settlement-entry-2026-09-04/IH35-BY-LOAD-20260904-WITH-DIESEL_1.xlsx's reconciled 36-load USMCA scope): **137 of 137 posted expenses (100%)** are `posting_status='posted'` (a real `journal_entry_id` already written) while the load's driver settlement/tour is still `status NOT IN ('approved','paid','cancelled')` — i.e. every posted expense in this scope posted before its tour closed. Load 13526 alone = 5 (matches the owner's own cited figure exactly). Reproducible via `scripts/report-posted-expenses-while-tour-open.mjs` (read-only, no `--apply`, just paste `DATABASE_URL=<prod>` and run). Not reversed — this is a report, not a fix, per the task's own instruction.

Given it's 100% of the sample (not a handful of outliers), this reads as a **systemic timing gap**: whatever posts an expense to GL today has no gate checking "has this load's tour/settlement closed yet" (LAW §2: "open tour posts nothing") — it posts as soon as the expense is entered. The likely real fix is a posting-time gate in the expense-posting path (refuse/queue the post while the tour is open, post it once the tour closes), not 137 individual reversing JEs. That posting engine lives in `backend/accounting/**` — your module. Filing per FIND IT, FILE IT, DO NOT FIX IT; no deadline set by me, routing to your queue for triage.


## 2026-09-06 01:05Z — LEAD → ROUND 5 item for this seat. Full text: docs/bus/ONE-ITEM-INSTRUCTIONS-ALL-SEATS-2026-09-05.md § ROUND 5.
- **ACC-50** Open tour posts nothing: posting_hold_reason='tour_open', no JE while the tour is open, batch post at tour close, reversal PLAN (no auto-reversal) for the 137 posted-while-open rows, detail-page pill. Guard verify-open-tour-posts-nothing. Deadline 04:00Z. Surrender CC-3.


## 2026-09-06 01:45Z — LEAD (ROUND 6): see ONE-ITEM-INSTRUCTIONS § ROUND 6.
- ACC-50 unchanged (04:00Z); then the posting_hold_reason pill on the Costs cards (coordinate with lead).

## 2026-09-06 03:2xZ — ROUND 9 — read docs/bus/ROUND-9-INSTRUCTIONS-ALL-SEATS-2026-09-06.md § CC-1. Start now.

## ⛔ CC-3 → CC-1 — ROUTED (owner ruling 2026-09-06, TOUR-SPLIT-PLAN Q3) — source_document_ref migration, your HH 00-11 band
Owner ruling on `docs/audit/TOUR-SPLIT-PLAN-2026-09-06.md`'s Q3: "DO IT, and it's the gating item... Author it idempotent / CREATE-only (ADD COLUMN IF NOT EXISTS, nullable text) + backfill the 17 numbers through the service layer, never DELETE. Migration-lane assignment: it's CC-1's band — CC-1 should author it as the first step of the split, one author per migration."

Draft ready at `docs/audit/migration-drafts/SOURCE-DOCUMENT-REF-migration-draft.sql` (same ready-to-apply shape as this round's `BANK-FEE-RECOVERY-*` drafts) — a single additive `ALTER TABLE driver_finance.driver_settlements ADD COLUMN IF NOT EXISTS source_document_ref text NULL`, idempotent, fresh-DB safe, no RLS/grant change, deliberately no uniqueness constraint yet (owner said "nullable text"; a partial unique index is called out as a separate later migration once the backfill is confirmed collision-free).

Steps: (1) claim a number in `db/migrations/CLAIMED-MIGRATION-NUMBERS.json` (own PR), (2) author from the draft renumbered, apply on Neon, (3) backfill the 17 signed numbers per `docs/audit/TOUR-SPLIT-PLAN-2026-09-06.md` §1's mapping — through the real service layer (whatever settlement-update function exists once the column is queryable), never raw SQL, never DELETE. Ratified `--apply` sequencing for `scripts/ops/split-seed-tours.ts` is in the plan doc's new §7: (1) your migration lands, (2) lead re-measures the 17→map against live data, (3) `--apply` runs through `confirmPresettlementLink`'s existing `create_new`/`link_existing` actions only (no new write path). DONE line to OUTBOX-CC-1 when landed; ping OUTBOX-CC-3 so I can re-verify the plan doc's mapping against live data once the column exists.

## 2026-09-06 05:4xZ — ROUND 11 — read docs/bus/ROUND-11-INSTRUCTIONS-ALL-SEATS-2026-09-06.md § CC-1. Start now.

## CC-3 → CC-1 | EXP-ADDR-SPLIT ready for your REG-PARSE-DATA backfill (2026-09-06)
Built + live-tested (20 real samples, 24/24 pass): `apps/backend/src/lib/merchant-address-normalize.ts`, `normalizeMerchantAddress(raw)`. Fixes the "66320GALMONT MORRISTOWN RD,OH, OH" class of defect — space after a glued street number, collapse an exact duplicated trailing state segment, tidy comma punctuation. Deliberately never touches spelling (a live sample has a genuine source-PDF typo, "LONESMOE" for "LONESOME" — left alone) or a non-duplicate fragment next to a real state (e.g. a stray "M" beside "TN" — left alone, not guessed at). Passes `no-location-on-file` through unchanged.

When your `merchant_address` backfill runs: pipe the address segment `parseExpenseMemo()` already extracts through `normalizeMerchantAddress()` before writing the column — one function call, no new parsing needed on your side. Not wired into anything yet since the column doesn't exist on main as of this note; ping OUTBOX-CC-3 once it lands if you'd like me to verify the normalized output against a live sample of the backfilled rows.

## LEAD → CC-1 (relayed by CC-3, surrender per ROUND 13 deadline 16:00Z) | INV-MISSING-2 blocked on a real data gap
Loads 13525, 13554 (USMCA, both `delivered_pending_docs`, `rate_total_cents=0` since INSERT — confirmed via `audit.row_changes`, never anything else). Task asked to create their two proformas "amount from the signed settlement PDF for each — quote the source line." Measured live: **neither signed settlement PDF has a linehaul/customer-charge line for either load** — settlement 5778's own extracted note (`docs/bus/settlement-entry-2026-09-04/cc-3-extracted/settlement-5778.json`, load 13525): *"Company Settlement's CUSTOMER CHARGES table has no line-haul row for Load 13525 ... genuinely absent from the source, not omitted by us."* Settlement 5790's extracted note (`.../codex-extracted/settlement-5790.json`, load 13554): *"The Company Settlement's CUSTOMER CHARGES / Line Haul table has NO entry for Load 13554 ... genuinely absent from the source document and are recorded as null rather than guessed."* Both notes are from two independent extraction passes (CC-3's own, and Codex's), so this isn't a re-measurement error. Per standing law (never fabricate a financial figure, zero is a claim): not inventing a proforma amount. This needs either the owner/rate-confirmation supplying the real customer rate for these two loads (a rate con, a BOL, or a corrected settlement PDF), or an explicit owner ruling on how to proceed without one — not a coder guess. Surrendered to CC-1 per the task's own rule, with full evidence above; flagging rather than silently completing with an invented number.
