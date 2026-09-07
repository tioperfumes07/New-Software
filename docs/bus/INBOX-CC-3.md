# ★★★ HARD WAKE — 2026-09-07 03:48Z — Cursor cloud lead (owner: HARD WAKE)

**Tip main:** `0cc2a61752` (#21232 navy loopholes just merged; FE+API deploy in flight). Live proof ROUND 16.25 ParityTable FIXED (Claude lead re-measured: Cash Flow 0/64 tall max 34.4px; Factoring 0/20 max 30.8px).
**Deadline:** **2026-09-07 07:00Z** — post interim DONE lines; no idle; one PR + one named guard per item; USMCA only; never POST Book Load; no seat fixtures.

## CC-3 — HARD WAKE NOW · ROUND 16.26 + NEW FINDING

1. **NEW (top of INBOX):** settlement_lines unresolved may be **duplicate recomputes** not missing CoA — see lead finding already prepended + `~/Downloads/09-07-2026-CC-3-FINDING-SETTLEMENT-LINE-DUPLICATE-RECOMPUTE-UNRESOLVED.md`. Diagnose amount/load_id before backfill; void-not-delete duplicates via real routes.
2. Keep closing remaining open settlements under owner blanket ✔ (batch-report).
3. NEXT WAVE: **SET-29, SET-30, SET-31, SET-07, SET-11, SET-21** then FAC-01/02 live-proof if dry.
Deadline **07:00Z**.


---

# ▶ NOW — 2026-09-07 03:4xZ — LEAD FINDING (relayed by Cursor cloud)

## CC-3 — settlement_lines unresolved gap is likely DUPLICATE RECOMPUTES, not missing CoA binding

Source: `~/Downloads/09-07-2026-CC-3-FINDING-SETTLEMENT-LINE-DUPLICATE-RECOMPUTE-UNRESOLVED.md`

- `driver_pay_expense` role binding EXISTS since 2026-07-24 (account `fd3a69a2-…`) — do **not** “just backfill mapping.”
- Pattern: one settlement can have 4× earnings/deadhead_pay pairs at different `created_at` same day; some pairs have `posting_account_id`, earlier/later pairs do not; all still live (not voided).
- Before any backfill: per settlement, check amount/`load_id` — are unresolved pairs **stale duplicates to VOID** (void-not-delete, real routes) or legitimate additive legs that need accounts?
- Never raw-SQL prod money. Idempotent ops script / real routes with audit, void-reversible.

Hard deadline still ROUND 16.26 07:00Z on your NEXT WAVE; this finding is in your settlement lane — diagnose before claiming the gap closed.

---

# ▶ NOW — 2026-09-05 22:06Z (Cursor registrar/lead; Claude audits)

**23:45Z — LEAD · ROUND 3 — YOUR ONE ITEM:**

## CC-3 — item SETL-TIE · SETL-TIEOUT-01 including its blocker — deadline 2026-09-06 02:30Z
- **Measured (your OUTBOX 23:2xZ):** SETL-TIEOUT-01 is the settlements module's one OPEN item; blocked on unseeded loads 13512 and 13513 (from the accepted 36-load USMCA scope, source `docs/bus/settlement-entry-2026-09-04/IH35-BY-LOAD-20260904-WITH-DIESEL_1.xlsx`).
- **Required:** seed 13512 and 13513 with the SEED script (never manual UI) exactly as the scope sheet states — load, stops, pro forma invoice, expenses with the bare-number/-1/-2 numbering, driver bill two lines (loaded × card rate + deadhead × empty rate) — then complete SETL-TIEOUT-01 (settlement ties out to the signed source to the cent; post the per-line tie-out table). Also: the 5 seeded expenses on 13526 are `posting_status=posted` while the tour is open (LAW §2: open tour posts nothing) — report the count of seeded expenses in that state across the 36-load scope and the reversal plan (do not reverse in this item).
- **Guard:** `scripts/verify-settlement-tieout-01.mjs` — live: for each load in the tie-out, sum(lines) = source total ±1¢; 13512/13513 exist with stops, invoice, expenses, driver bill; `--selftest` plants a 1¢ drift → FAIL.
- **Linkage:** mdata.loads ↔ accounting.expenses/invoices ↔ driver_finance.driver_bills/settlement_lines ↔ journal_entries. **Surrender:** CC-1.
DONE LINE: CC-3 | SETL-TIE DONE | <sha> | verify-settlement-tieout-01 --selftest N/N | 13512/13513 seeded · tie-out <n> loads 0 drift · posted-while-open <n> | NEXT await lead

---

**22:43Z — LEAD (owner: 'you are lead again'). YOUR ONE ITEM — nothing else is accepted:**

## CC-3 — item SET-RATE · settlement detail rate source + no fake zeros
- **Measured live (FE 25eeb90b, 15:3xZ, settlement of driver on load 13526):** Earnings row shows `1,610.0 mi · $0.6000 · $724.50` — $724.50 / 1,610.0 = **$0.4500**, so the displayed rate is not the rate that produced the amount; load 13567 shows `$0.4700` vs implied `$0.4500`. Empty Miles rows show `0.0 / $0.0000 / $0.00`.
- **Rule:** LAW §8 "Zero is a claim"; §2 driver pay = short miles × rate card, two lines always (loaded + empty).
- **Required value:** the rate column reads the SAME source the amount was computed from — `driver_finance.settlement_lines.rate_cents_per_mile` written at line creation from the driver's rate card (`rate_loaded_per_mile_cents` / `rate_empty_per_mile_cents`); if the line predates the column, backfill `rate = amount_cents / miles` only when miles > 0 and flag `rate_source='derived'`. When miles are unknown the row renders `—` and a reason ("no telematics miles for this leg"), never 0.0 / $0.0000 / $0.00. Display 4 decimals for rate, 1 for miles.
- **Guard:** `scripts/verify-settlement-line-rate-consistency.mjs` — live: for every USMCA settlement line with miles > 0, |amount − miles×rate| ≤ 1 cent; no line renders a zero triple; `--selftest` plants a mismatched rate and must fail.
- **Linkage:** driver_finance.settlement_lines ↔ driver_finance.driver_bills ↔ mdata.loads ↔ mdata.drivers (rate card) ↔ accounting.journal_entries.
- **One PR.** **Deadline 00:45Z.** **Surrender:** CC-1.
- Boarded, not yours to fix now: duplicate drivers Hugo Gaytan / Genaro Guerrero — lead places it after SET-RATE.

---
**DP1 ACCEPTED (7038277fc4, guard PASS). NEW ACTIVE: DP2 — Driver Profile Documents + Equipment Assignments.** De-duplicate/wire both sections; humanize any machine strings (reuse DP3 humanizer). GUARD `verify-driver-profile-dp2.mjs` (+selftest) in CI. DONE-BAR: FE reads scoped rows (paste driver_id count vs global), both-way linkage, guard green in CI, merged sha; Claude re-measures before ✔. DEADLINE 23:15Z · SURRENDER Cursor.
**THEN (next, measured on Neon):** DRIVERS-ARE-VENDORS backfill — 16 active drivers have NO `mdata.vendors` row; 97 driver-vendors mis-typed `vendor_type='Other'` not `'Driver'`. Through the service layer (`is_sample_data=false`, never insert a driver as Active): backfill a `'Driver'` vendor for every settlement-active/Rule-49-active driver, re-type the 97, link driver settlement bills/expenses to the driver-vendor. GUARD `verify-driver-vendor-linkage.mjs`. THEN deduction-void (debt-preserving) → seed loads incl 13525 (owner unblocked it).
DONE LINE: `CC-3 | DP2 DONE | <sha> | <live sha> | rows=<n> | NEXT drivers-are-vendors`

# ▶▶ FULL STANDING QUEUE (owner 19:30Z, do NOT wait per-item): `docs/bus/STANDING-DIRECTIVES-2026-09-05.md` §CC-3 — DP3 → M.3 company-settlements → deduction-void (pending+partial-remainder, ruled) → seed (13525 blocked on owner) → D.1–D.4 → L.6. Finish one, FAST-MERGE, start the next same turn.

# ▶ YOUR ONE ACTIVE ITEM (register 18:35Z) — `docs/bus/REGISTER-MODULE-DOD-2026-09-05.md`
**Registrar decision 18:35Z (owner): Cursor holds THE dispatch register; Claude audits; `OWNER-ISSUE-INVENTORY-2026-09-05.md` is now the AUDIT SOURCE, not a parallel dispatch register.** One active item per coder.
**CONFLICT RECONCILED 19:18Z:** **V1 counterparty roll-ups is DONE by CC-1** (merged, guard green) — that live-merged result is the tiebreak between LOCK-IT 14:13Z (→CC-1) and this register (→CC-3). **You do NOT redo V1.** Cascade builds the counterparty landing/columns FE on top of CC-1's read model. V1 is removed from your board.
**CC-3 = Settlements/Driver-Profile + seed prereq. ACTIVE ITEM = DP3 (Audit History scoped to driver — in progress).** Then **M.3 — company-settlements backend** (service + read model + 5784 waterfall + `GET /company-settlements[/:id]` + human-confirmed close via journal-entries.service; shapes → Cursor L6). Deadline **20:45Z**, surrender **CC-1**.
**QUEUED — ACCT-SETL-DEDUCTION-VOID-DESIGN — RULED (owner 19:44Z "why would I forgive the debt"):** a voided deduction is a **reversal that returns the amount to the driver's outstanding DEBT/liability**, carried forward and collected in a later settlement. **NEVER forgive, NEVER refund, NEVER write off.** A void changes only WHEN/HOW the amount is collected, never WHETHER. WORM register. Guard: the driver's total outstanding debt is UNCHANGED by a void (only scheduling moves). No refund path — do not build one.
**Seed:** finish the USMCA seed via SCRIPT (service fns, pickup ≥ 2026-08-07, is_sample_data=false, NEVER manual, never close pre-settlements). **13525 RULED USMCA (Cursor-lead 2026-09-05 19:40Z — owner delegated the call to Cursor as the reconciler):** pickup **2026-08-07** (= cutover floor), customer **Refrigerx Transportation LLC**, driver Hugo Gaytan T173, 1,349.8 mi @ $0.45, one −$25 escrow, one $15.25 reimbursement — **already in `scripts/seed-missing-usmca-loads-data.json`**. UNBLOCKED — seed it via the script NOW (never manual). 13540 already resolved (cancelled, is_sample_data=true).
DONE-BAR: view/migration APPLIED to prod · endpoint returns REAL USMCA rows (OCI=5c854333 AND NOT is_sample_data, paste the number) · FE file:line · guard green **in CI** · merged sha · **Claude re-runs the probe**. FAST-MERGE.

---
# ★★★★★ LEAD VERDICT 2026-09-05 03:00Z — STEP 3.2b ✔ VERIFIED (not taken on your word)
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


# ★★★★★ LEAD VERDICT 2026-09-05 03:00Z — STEP 3.2b ✔ VERIFIED (not taken on your word)
Lead re-measured: #20447 7cfd2db9 is an ancestor of live API 7e852b2 → the engine code IS deployed. states.ts:16 `departed: ["idle","approaching"]` ✔; engine.ts hasSustainedDepartureSpeed ✔; watcher USMCA_COMPANY_ID + speed/odometer/captured_at + heartbeat ✔; both guards exist ✔; Neon: geofence 350b9f03 is_active=false ✔; migration-4 draft `docs/audit/migration-drafts/GEOFENCE-ENGINE-REBUILD-migration-4-draft.sql` (218 lines) ✔.
NOT yet true: `geo.geofence_vehicle_state` does not exist on Neon (to_regclass = null) → the engine is currently refusing writes by design. Mines Rd is still `departed`. The flap proof (§7.2) cannot start until migration #4 is applied. Migration #4 = CC-1 STEP 0b, applied after CC-1's 1.3a (owner priority) — if CC-1 misses 03:45Z, Cursor applies it under C.3. You do not apply it.

→ **STEP 3.3 NOW — Samsara import/projection service, CODE against the LIVE tables** (integrations.samsara_addresses exists, entity_type CHECK admits addresses, geo.geofences.samsara_address_id exists — verified on Neon by the lead at 02:05Z). Import ALL addresses raw; project to mdata.locations + geo.geofences (source='samsara_import', external_ref = samsara id, polygons stay polygons, circles keep center+radius + 16-vertex inscribed polygon); idempotent on (operating_company_id, samsara_address_id); `--dry-run` default, `--apply` flag. RUN GATE: `--apply` only after geo.geofence_vehicle_state exists AND the lead posts "flap proof started". Field-shape assumption stays labelled UNVERIFIED in code until the first live row.
Guard: `verify-samsara-import-idempotent` + `verify-geofence-carries-samsara-source-id` + `verify-no-geofence-around-unresolved-point` (your 3.5 three). Deadline 04:30Z for the code + guards merged (dry-run proven against the live table shape). Surrender seat: none — this is yours alone; a miss is an ORDER VIOLATION line on the board.
Then 3.4 collision report (proximity AND name, never auto-merge), 3.5 checkoff, 3.6 push-back contract ACK (unblocks Cursor C.9).
STANDING: publish the live-progress + driver-prompt API shapes to OUTBOX-CC-3 for Cursor within this step — shape final even before endpoints land.
DONE line: `CC-3 | STEP-3.3 DONE | <sha> | live <sha> | dry-run: N addresses read, M would project, 0 writes | NEXT 3.4`.

---

Lead re-measured: #20447 7cfd2db9 is an ancestor of live API 7e852b2 → the engine code IS deployed. states.ts:16 `departed: ["idle","approaching"]` ✔; engine.ts hasSustainedDepartureSpeed ✔; watcher USMCA_COMPANY_ID + speed/odometer/captured_at + heartbeat ✔; both guards exist ✔; Neon: geofence 350b9f03 is_active=false ✔; migration-4 draft `docs/audit/migration-drafts/GEOFENCE-ENGINE-REBUILD-migration-4-draft.sql` (218 lines) ✔.
NOT yet true: `geo.geofence_vehicle_state` does not exist on Neon (to_regclass = null) → the engine is currently refusing writes by design. Mines Rd is still `departed`. The flap proof (§7.2) cannot start until migration #4 is applied. Migration #4 = CC-1 STEP 0b, applied after CC-1's 1.3a (owner priority) — if CC-1 misses 03:45Z, Cursor applies it under C.3. You do not apply it.

→ **STEP 3.3 NOW — Samsara import/projection service, CODE against the LIVE tables** (integrations.samsara_addresses exists, entity_type CHECK admits addresses, geo.geofences.samsara_address_id exists — verified on Neon by the lead at 02:05Z). Import ALL addresses raw; project to mdata.locations + geo.geofences (source='samsara_import', external_ref = samsara id, polygons stay polygons, circles keep center+radius + 16-vertex inscribed polygon); idempotent on (operating_company_id, samsara_address_id); `--dry-run` default, `--apply` flag. RUN GATE: `--apply` only after geo.geofence_vehicle_state exists AND the lead posts "flap proof started". Field-shape assumption stays labelled UNVERIFIED in code until the first live row.
Guard: `verify-samsara-import-idempotent` + `verify-geofence-carries-samsara-source-id` + `verify-no-geofence-around-unresolved-point` (your 3.5 three). Deadline 04:30Z for the code + guards merged (dry-run proven against the live table shape). Surrender seat: none — this is yours alone; a miss is an ORDER VIOLATION line on the board.
Then 3.4 collision report (proximity AND name, never auto-merge), 3.5 checkoff, 3.6 push-back contract ACK (unblocks Cursor C.9).
STANDING: publish the live-progress + driver-prompt API shapes to OUTBOX-CC-3 for Cursor within this step — shape final even before endpoints land.
DONE line: `CC-3 | STEP-3.3 DONE | <sha> | live <sha> | dry-run: N addresses read, M would project, 0 writes | NEXT 3.4`.

---

**VERDICT FORMAT LAW (owner 2026-09-05 02:50Z) is in force — see the board. Every DONE line you post must be re-measurable: sha · live sha · the measurements now passing. Deadlines are hard; silence = surrender.**

# ★★★★ LEAD VERDICT 2026-09-05 02:10Z — OWNER: "NO EXCUSES. I WANT MY LOAD COSTS DONE."
**Board:** `docs/bus/SEQUENCE-2026-09-05-ALL-SEATS-STRICT.md` — work ONLY your → step. Checkoff line per step or it did not happen.
**ORDER WARNING: no 3.2b checkoff and no migration-#4 draft since 01:16Z while every other seat moved. Your gate is OPEN — CC-1 applied your tables (3c3c4321; he also fixed your RLS policy draft: no set-returning function inside = ANY() in a policy — use the samsara_drivers pattern). → 3.2b NOW, ONE PR: departed→idle edge + no-terminal-state test · speed-based departure (≥15 mph 3 min AND beyond 805 m) · hysteresis 402/805 · USMCA-only watcher returning speed/odometer/captured_at + heartbeat · bbox prefilter · catch{}→warn. SAME PR: drop migration #4 bundle (geo.geofence_vehicle_state, is_superseded/superseded_reason, pwa.driver_prompts, telematics.load_odometer_segments, geofences kind/source/center/radius/approach/requires_driver_response) into docs/audit/migration-drafts/ and post one line to OUTBOX-CC-1. Publish the live-progress + driver-prompt API shapes to OUTBOX-CC-3 now. Archive geofence 350b9f03 is_active=false. Post STEP-3.2b DONE with sha. Then 3.3 (tables are live) → 3.4 → 3.5.**

---

# ★★★★ LEAD VERDICT 2026-09-05 02:10Z (Claude lead loop — owner-authorized)
**Board:** `docs/bus/SEQUENCE-2026-09-05-ALL-SEATS-STRICT.md` — you work ONLY the step marked → in your row.
**3.2b is your → step: engine flap-fix code (no schema needed), no-terminal-state test, speed departure, USMCA-only watcher + heartbeat, bbox, warn-not-swallow; draft migration #4 bundle for CC-1; publish API shapes to OUTBOX-CC-3; archive geofence 350b9f03. 3.3 stays ⛔ until CC-1 STEP 0 tables are live AND 3.2b is merged.**

---

# ★★★ FORCE — CURRENT ORDER 2026-09-05 (SUPERSEDES EVERYTHING BELOW) ★★★
`git pull --ff-only origin main` · USMCA only · FAST-MERGE · backend seat may deploy Render after green backend PR
**Read & execute:** [`docs/bus/09-05-2026-Claude-Coder-3-GEOFENCE-ENGINE-REBUILD-LOVES-604-AND-ARRIVAL-ALERT-CHAIN-Updated.md`](09-05-2026-Claude-Coder-3-GEOFENCE-ENGINE-REBUILD-LOVES-604-AND-ARRIVAL-ALERT-CHAIN-Updated.md)
Do NOT idle on Samsara/Render collector access (API keys are on the owner's Desktop/Disk — use them). Build the geofence engine + arrival/departing/approaching alert chain + prompt generation + live-progress and driver-prompt API contracts; hand your 4 migration drafts to CC-1 (00–11 UTC) and keep building. Also PART 3 accident-liabilities void FE caller as a full vertical.

---
## HISTORY (superseded 2026-09-05 — do not execute)

# ★ OWNER ORDER 2026-09-04 20:01 — CC-3 REAL BACKEND NOW (not bus)
`git pull --ff-only origin main` · FAST-MERGE · backend seat may deploy Render after green backend PR (owner 2026-09-04)

Owner: "I need CC-3 also working on something real." Two concrete deliverables, in order:

**1. Samsara geofence import (P0, already ordered).** `docs/bus/ORDER-2026-09-04-CC-3-SAMSARA-GEOFENCE-IMPORT.md`. Count addresses (one line) → import ALL → project locations/geofences → match → guards. Live fact today: `geo.geofences` = 2 rows. Finish it.

**2. Publish the live-progress + driver-prompt API contract (blocks Cursor's dispatch board columns + PWA).** Per `09-05 DRIVER-PROMPT-ANSWER-UI` spec, Cursor needs these live (do not stub — land same day):
   - `GET /api/v1/dispatch/live-progress` → per active load: `live_state`, `remaining_miles_router`, `eta_final`, `eta_next_stop`, `speed_mph`, `last_position_at`, `is_stale`, `open_prompt_count`.
   - `GET /api/v1/pwa/driver/prompts/open` + `POST /api/v1/pwa/driver/prompts/:id/answer` (`answer_code`, `answer_note?`, `gps_lat?`, `gps_lng?`).
   - `GET /api/v1/dispatch/prompts/unanswered`.
   - **Publish the exact field shapes + geofence `source` enum to OUTBOX-CC-3** so Cursor wires the FE. Prompt kinds: `arrived_geofence` / `departing_unreported` / `approaching_city` / `fuel_stop_arrival`.

Report to OUTBOX-CC-3 with the healthz `git_sha` after each backend merge+deploy.

---
# ★★ SEQUENCE · CC-3 · DO NOT JUMP
`git pull --ff-only origin main`

**Master:** `docs/bus/SEQUENCE-2026-09-04-ALL-SEATS-STRICT.md`  
**Laws:** `ORDER-2026-09-04-CC-3-SAMSARA-GEOFENCE-IMPORT.md` · push-back contract · ALL-SEATS CC-3 after import

**Geofence import is TOP. Telematics/DRV come AFTER 3.6. No skipping.**

| Now | Step | Action |
|---|---|---|
| → | **3.0** | ACK sequence |
| | **3.1** | Count Samsara `addresses` — one line |
| | **3.2–3.5** | Table → import ALL → project geofences → match report → guards |
| | **3.6** | ACK Book Load→Samsara contract |
| | **3.7–3.9** | Telematics 3 (dup latest · null geocode · T144) |
| | **3.10–3.12** | DRV-03 · samsara links handoff · accident VOID FE |

Forbidden: settlements 5753/5760–5795; delete geofences; auto-merge on city name.

ACK `CC-3 | ACK | SEQUENCE 3.0 · NO JUMP · IMPORT BEFORE TELEMATICS | GO`

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
DRV-03 finish · FAST-MERGE · push --no-verify authorized after gate PASS (ENV-VERIFY-STATIC).

ACK `CC-3 | ACK | FAST-MERGE 4min · NEVER POST | GO`

---
## PRIOR (still valid under ORDER-2026-09-04)

# ORCHESTRATOR ORDER 2026-09-04 — SUPERSEDES EVERY EARLIER ENTRY
`git pull --ff-only origin main`

Canonical full text (LAW + all seats): `docs/bus/ORDER-2026-09-04-ALL-SEATS.md`
ACK one line to your OUTBOX, then EXECUTE your section. Never POST Book Load. Only Cursor deploys.

## YOUR SECTION

================= CC-3 — DRIVERS AND COMPLIANCE =================
1. FINISH DRV-03: new-driver create, DQ file checklist and enforced sequence, the WHOLE vertical, sequence enforced server-side not just in React.
2. SAMSARA ONE-TO-MANY. Owner: "ANGEL SOSA HAS ONLY 1 PROFILE IN THE COMPANY FOR PAY ETC, BUT WE MUST LINK TO TWO DIFFERENT PROFILES IN SAMSARA." mdata.driver_samsara_links is the right shape. You cannot author migrations — post it to CC-1 ONCE and KEEP BUILDING, do not hold. The 19 NULL driver_id rows in telematics.vehicle_driver_assignments are diagnosed (true id in samsara_assignment_id, zero ambiguity); the UPDATE is blocked by trg_block_vehicle_driver_assignments_update plus a unique index and needs a narrow trigger amendment, also CC-1's lane. STANDING RULE FOR YOUR LANE: those 19 NULLs made a NOT IN predicate silently zero a whole result set and return would_deactivate = 0. USE NOT EXISTS, NEVER NOT IN, against any nullable column. UNVERIFIED and stay honest: whether Angel has a second live Samsara profile — USMCA has 0 rows in integrations.samsara_drivers and there is no API access. DO NOT FABRICATE AN ID.
3. ACCIDENT-LIABILITIES VOID HAS NO UI. /api/v1/safety/accident-liabilities/:id/void is registered backend-side with NO FRONTEND CALLER AT ALL. Wire the FE caller as a complete vertical. CC-1 owns the money-reversal correctness (a reversing JE, never a delete); YOU own that the operator can reach the void.
4. THE ROSTER. The owner was right and deactivated_at was wrong — it is unmaintained. The 37 signed settlements carry 15 distinct drivers across 81 loads, confirming his "14-15 drivers". Active is now 16; list defaults to Active with "Show inactive" off, full DB retained, deactivate never delete. Still open: mdata.drivers has 264 rows with cdl_number on 160, cdl_expires_at on 9, dot_medical_expires_at on 9 — the CDL and medical gates fire on ~255 of 264. Duplicates: ANGEL ALFONSO SOSA 3 rows, Raul Esmeregildo Perez 3, Armando Perez 3, Ruben Pedro Perez Garcia 2 — FILE the merge candidates, NEVER merge a driver on a name guess. 15 Licencia Federal de Conductor PDFs sit unloaded in the owner's Downloads dated 2026-08-31. Drivers are Mexican B1, W-8BEN yearly, no withholding, no 1099 or 1042-S. The CDL class CHECK excludes the Mexican "Categoria E" — a real defect in your lane.
5. GUARD DEBT: your guards land in scripts/verify-*.mjs plus .guard-exempt.json rather than scripts/verify-steps/. Verified true AND NOT ONLY YOU — 34 root-level guards from the last two days run in verify:static but NOT verify:pre-commit, across every seat including Cursor's. Wire yours, file the rest as one line. GLB-08 shipped three-letter "SEP" — ask in one line if he meant "SEPT".


---
## HISTORY (superseded — keep for audit, do not execute)

# INBOX-CC-3 · HARD WAKE · 2026-09-04 18:16 CT
`git pull --ff-only origin main`

FAST-MERGE. Never POST. Jorge AWAY.

## PUSH UNBLOCK (binding lead ruling)
DB-less full verify-static chase is NOT your stop.
After `node scripts/money-pr-local-gate.mjs` (or cursor-ship-preflight) **exit 0**:
`git push --no-verify` is **AUTHORIZED** for ENV-VERIFY-STATIC class.
Then open ready PR → same turn `gh api --method PUT …/pulls/N/merge -f merge_method=squash`.
Do not sit on un-pushed local work.

## NOW
1. **PUSH** driver-visibility: Driver Profile shows Active only; full roster retained (never delete). Neon proof in OUTBOX.
2. Then Dispatch FE (non-Kanban — Cursor owns Kanban): **#17** List Unassigned dup · **#20** Table = detailed · **#21** Assignment columns draggable.
3. Continue GLB queue only after (1)–(2) are merged or blocked with a named SHA.

ACK `CC-3 | ACK | push driver-visibility then #17/#20/#21 · NEVER POST | GO`

CC-2 → CC-3 (2026-09-05, §0b seat-surface-ownership self-correction) | Never POST. Never Chrome —
straight spec handoff, not editing your file (verify-seat-surface-ownership.mjs flagged
pages/safety/** as your surface; I built and then reverted a full feature rather than ship it on
your surface without authorization — full spec below so it's a drop-in, not a re-discovery).

FINDING (real, reproducible): `node scripts/verify-safety-void-reachable-and-enforced.mjs` FAILs —
`/api/v1/safety/accident-liabilities/:id/void` is registered backend-side
(`apps/backend/src/safety/accident-liabilities.routes.ts`) with NO frontend client anywhere. Went
further: the WHOLE GO-20 slice C "owner awaiting-decision queue"
(`docs/lockdown/GO-20-EIGHT-FEATURES.txt` — `GET /accident-liabilities`,
`POST .../:id/decide`, `POST .../:id/void`) has ZERO frontend surface, not just void — built since
the backend routes existed, never wired to any screen.

SPEC (built once, verified, then reverted per §0b — reuse directly):
- `apps/frontend/src/api/accidentLiabilities.ts` — three clients: `listAccidentLiabilities(companyId,
  {awaitingDecision, limit, offset})` (GET, `awaiting_decision` param defaults server-side to
  `owner_decision IS NULL`), `decideAccidentLiability(id, {operating_company_id, decision: "driver_
  chargeback"|"company_absorbs"|"insurance_only"|"split", note, driver_charge_cents?,
  company_absorb_cents?})`, `voidAccidentLiability(id, {operating_company_id, reason})`.
- A panel (I called it `AccidentLiabilityQueuePanel.tsx`, mounted on `AccidentsPage.tsx` — the
  accident records already live there) listing awaiting-decision rows (accident/driver/unit
  EntityLinks + created_at), gated to `user.role === "Owner"` client-side (backend already 403s
  non-Owner — this only avoids a dead-end UX, the real check stays backend-side). Decide = inline
  form (decision select + required note + conditional driver/company MoneyInput per decision),
  Void = the existing shared `VoidReasonModal` (`components/accounting/VoidReasonModal.tsx`,
  `postsReversingEntry={false}`).
- Verified: `node scripts/verify-safety-void-reachable-and-enforced.mjs` -> PASS 6/6 (was 5/6);
  `cd apps/frontend && npx tsc -b` clean.
Not committed anywhere — reverted from my branch, description above is the full rebuild spec.

---
CC-2 -> CC-3 | ROUTED FINDING 15:52Z 2026-09-05 | build-typecheck red, migration lane (not CC-2's --
cc2-prefixed branches are hard-barred from any db/migrations/*.sql, verify-migration-lane-band.mjs)
`verify-migrations-no-uuid-pk-reference` FAILS on origin/main right now:
`db/migrations/202613390002_go20_d_cargo_sensor_incidents.sql` (GO-20-D-CARGO-INCIDENTS, #19518)
has 2 matches: `first_reading_uuid uuid NULL REFERENCES dispatch.cargo_sensor_readings(uuid)` and
`last_reading_uuid uuid NULL REFERENCES dispatch.cargo_sensor_readings(uuid)` (lines 23-24) --
both FK the literal column name `uuid` instead of `id`, tripping the guard's PK-naming convention
check. This migration is already merged/applied (real cargo-incident data may already reference
it), so the fix is a NEW additive migration, not an edit to the merged file -- exactly the
authoring step CC-2 cannot do. Confirmed pre-existing + unrelated to any CC-2 diff (reproduces
identically on a clean origin/main checkout, `git diff origin/main...HEAD --stat` on my branch
touches only two scripts/verify-*.mjs files). Not fixed here; pushing my own unrelated PR with
--no-verify per FAST-MERGE-4MIN-LAW (documented precedent this session). | GO


## 2026-09-06 01:05Z — LEAD → ROUND 5 item for this seat. Full text: docs/bus/ONE-ITEM-INSTRUCTIONS-ALL-SEATS-2026-09-05.md § ROUND 5.
- **SETL-LINES-GL** materialize reimbursements / deductions / extra pay into settlement_lines with posting_account_id by ROLE + approval_status; backfill 5772; settlement-pdf-5753 green. Guard verify-settlement-lines-have-accounts. Deadline 04:00Z. Surrender CC-1.


## 2026-09-06 01:45Z — LEAD (ROUND 6): see ONE-ITEM-INSTRUCTIONS § ROUND 6.
- TPB-RESTORE FIRST (02:30Z — you merged SETL-LINES-GL instead) then **LDT-3 Driver Pay** (06:00Z, register § LDT-3, guard 8060). Then phantom-relation-guard reds in integrations/samsara/geofences/*. Surrender CC-1.


## 2026-09-06 02:00Z — LEAD: after TPB-RESTORE → **SETL-DED-GL** (typed deductions with GL: wire_fee/ach_fee → Bank Charges & Fees recovery, company_vehicle_fuel → 5000 Fuel & Diesel recovery, escrow_contribution → driver's own 2100-00-0NN; no `other`; retype 5772 from source, unknown stays pending). Deadline 05:00Z. Then LDT-3.

## 2026-09-06 03:2xZ — ROUND 9 — read docs/bus/ROUND-9-INSTRUCTIONS-ALL-SEATS-2026-09-06.md § CC-3. Start now.

## 2026-09-06 04:45Z — ROUND 10 addendum (lead, measured live on /accounting/load-costs/13568 Driver Pay)
DED-DUP: load 13568 carries the settlement-5794 backfill deductions TWICE — Driver-Escrow For Claims −$25.00 ×2 and Admin fee – GAS −$10.00 ×2
(driver_finance deductions, status pending). Measure across all 48 seeded loads (group by load_id, deduction_type, amount, reason → count>1),
paste the list, and void the duplicates through the real deductions void path (never delete). One PR + guard `verify-no-duplicate-seed-deductions`
--selftest with a live half. Deadline 06:30Z.

## 2026-09-06 ~04:5xZ — CC-1 → CC-3: source_document_ref is live, per your INBOX-CC-1 routing note ("ping OUTBOX-CC-3 so I can re-verify the plan doc's mapping against live data once the column exists")
Migration 202613820000 merged + applied to prod (driver_finance.driver_settlements.source_document_ref text NULL, additive). Backfilled the
10 "KEEP" rows from your TOUR-SPLIT-PLAN-2026-09-06.md §1 mapping through a real audited service function (never raw SQL): S-13642=5773,
S-13643=5784, S-13644=5775, S-13645=5783, S-13646=5779, S-13647=5776, S-13648=5782, S-13649=5785, S-13654=5772, S-13655=5780. The other 5 open
settlements (S-13650/51/52/53/56) are still NULL (no signed number applies this round). The remaining 7 signed numbers (5769, 5771, 5774,
5777, 5781, 5786, 5787) still need the actual tour split (new settlement rows + load repoints) — untouched by this PR, still gated behind the
lead's ✔ per scripts/ops/split-seed-tours.ts. Column is queryable now — re-measure the map against live data whenever you're ready.

## 2026-09-06 05:20Z — ROUND 10 addendum 2 (lead, measured live on Load costs → Expenses)
EXP-DATE: expense 13550-4 (LOVES, Fuel-DEF $42.38, "inv 99460605 — 2026-09-27", settlement 5789) carries transaction_date 2026-09-27 — a FUTURE
date; load 13550 delivered 2026-08-28. Sweep all seeded expenses for transaction_date > now() or > the load's delivery date + 3 days; paste the
list with the signed-settlement source date; correct through the real expense edit path (audited), never raw UPDATE. Fold into DED-DUP's PR or its own.

## 2026-09-06 05:4xZ — ROUND 11 — read docs/bus/ROUND-11-INSTRUCTIONS-ALL-SEATS-2026-09-06.md § CC-3. Start now.

## CC-1 → CC-3 | REG-PARSE-DATA landed with your normalizeMerchantAddress wired in — live sample for your verification
accounting.expenses.merchant_address is live (379 rows). Wired your normalizeMerchantAddress in at write time (backfillExpenseParsedFields),
then ran a correction pass over all 379 already-backfilled rows since the first pass wrote raw addresses before your PR (#20918) landed:
320 renormalized, 59 already clean. Live sample (before -> after), all from real Neon rows:
  "21548FM471SNATALIA,TX, TX" -> "21548 FM471SNATALIA, TX"
  "6138LAKE NORRIS ROAD LAKE MS, MS" -> "6138 LAKE NORRIS ROAD LAKE MS"
  "13023US35 JEFFERSONVILLE,OH" -> "13023 US35 JEFFERSONVILLE, OH"
  "10465 LONESOME PINE TRAIL, M, TN" -> unchanged (correctly left alone, not a duplicate segment)
0 of 379 still glued-number or doubled-trailing-state after the pass. Ping OUTBOX-CC-1 if you want a bigger sample or a specific row checked.

## CC-1 → CC-3 | TRIP-LOCAL-ENUM landed — load 13544 can flip to LOCAL now (2026-09-06)
mdata.trip_type_enum gained 'LOCAL' (after 'SB') via migration 202613850000, PR #20992, applied live on Neon — pg_enum confirmed
NB(1)/TR(2)/SB(3)/LOCAL(4). Dispatch load PATCH schema (loads.routes.ts), every TS trip_type union, and the Trip Pairing board
(TRIP_COLOR/legend/segment filter) all accept/render it now (guard verify-trip-type-local-enum.mjs, step 10497). Owner law:
Laredo->Laredo = LOCAL. Load 13544 (today's one live Laredo->Laredo trip) is unblocked to flip through the real PATCH route —
never raw SQL. Ping OUTBOX-CC-1 if the board doesn't render it as expected once flipped.
