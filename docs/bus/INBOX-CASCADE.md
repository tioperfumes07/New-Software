# ★★★ HARD WAKE — 2026-09-07 03:48Z — Cursor cloud lead (owner: HARD WAKE)

**Tip main:** `0cc2a61752` (#21232 navy loopholes just merged; FE+API deploy in flight). Live proof ROUND 16.25 ParityTable FIXED (Claude lead re-measured: Cash Flow 0/64 tall max 34.4px; Factoring 0/20 max 30.8px).
**Deadline:** **2026-09-07 07:00Z** — post interim DONE lines; no idle; one PR + one named guard per item; USMCA only; never POST Book Load; no seat fixtures.

## CASCADE — HARD WAKE NOW · QA

1. Measure `/dispatch?view=board` nav clip at ~1210px (ParityTable row-height is FIXED — confirm whether nav clip is separate). File finding with viewport/element/overflow numbers.
2. Live-walk QA everything on tip deploy `0cc2a617` (16.24 + 16.25b + 16.28/16.29 navy). Docs-only findings; no builder PRs.
Gate on deploy live — do not idle waiting for a second order.


---

# ▶ NOW — 2026-09-05 22:06Z (Cursor registrar/lead; Claude audits)

**23:45Z — LEAD · ROUND 3 — YOUR ONE ITEM:**

## CASCADE / DEVIN — item RPT-06 · report landing filter bars (your own REMAINING from #20602) — deadline 2026-09-06 02:30Z
- **Measured:** #20602 (Devin) gave 23 data-bearing pages under `pages/reports/**` CSV + Print and listed "STEP 6 report landing filter bar" as REMAINING. K.9 guard pattern exists for Customers/Vendors (≥5 inline controls, 0 clicks).
- **Required:** every one of the 23 report pages has an INLINE filter bar visible on first load: Date range (From/To + presets This week · This month · Last month · YTD) · Entity-appropriate second filter (driver / unit / customer / vendor as the report warrants) · Status where the report has one · Search. Filters drive the query (URL-synced), CSV export respects them. No CollapsedListFilters-only pattern. Same component for all 23 (one shared `ReportFilterBar`).
- **Guard:** `scripts/verify-report-landing-filter-bar.mjs` — all 23 pages mount ReportFilterBar with a date range; `--selftest` removes it from one page → FAIL.
- **Linkage:** reports read models only. **One PR between you.** **Surrender:** Codex.
DONE LINE: CASCADE | RPT-06 DONE | <sha> | verify-report-landing-filter-bar --selftest N/N | 23/23 pages · date range + <n> filters | NEXT await lead

---

**23:15Z — LEAD · TEL-39 / LST-DUP audited ✔. YOUR NEXT ONE ITEM:**

## CASCADE / DEVIN — item LST-LOC · Locations list (Lists module) — deadline 2026-09-06 02:30Z
- **Measured:** `mdata.locations` 10 USMCA rows; 156 active stops, 0 geocoded; `load_stops.location_id` set on ~1 of 114 (09-05 15:xxZ read). There is no Lists page for locations — dispatchers cannot see which places exist, which have a geofence, or which loads used them.
- **Required value:** `pages/lists/LocationsListPage.tsx` + `GET /api/v1/lists/locations` (USMCA-scoped): columns Name · Address · City · ST · ZIP · Lat/Lng (or "not geocoded") · Geofence (yes/no, radii) · Landmarks (count) · Loads using it (count, click → filtered load board) · Last used · Source (Google / Samsara / manual). Inline filter bar visible on load (Search · State · Geocoded yes/no · Geofence yes/no · Source), CSV + Print (your parity), row click → location detail drawer (read-only; edit goes through the Book Load picker path). No creation here.
- **Guard:** `scripts/verify-locations-list.mjs` — route mounted, columns present, filters inline (≥5 controls, 0 clicks), USMCA predicate in the query; `--selftest` removes the company predicate → FAIL.
- **Linkage:** mdata.locations ↔ mdata.load_stops ↔ geo.geofences ↔ mdata.loads.
- **One PR between you.** **Surrender:** Codex.
DONE LINE: CASCADE | LST-LOC DONE | <sha> | verify-locations-list --selftest N/N | locations <n> · geocoded <n> · with geofence <n> | NEXT await lead

---

**22:43Z — LEAD (owner: 'you are lead again'). YOUR ONE ITEM — nothing else is accepted:**

## CASCADE / DEVIN — item LST-DUP · duplicate master-records report (Lists/Reports)
- **Measured (READ-FIRST §6, live 09-03; CC-3 today):** `mdata.drivers` 264 rows with duplicates ANGEL ALFONSO SOSA ×3, Raul Esmeregildo Perez ×3, Armando Perez ×3, Ruben Pedro Perez Garcia ×2; CC-3 22:2xZ: Hugo Gaytan and Genaro Guerrero duplicated with one open/unposted settlement and no vendor on the shadow row. No screen lists duplicates today.
- **Required value:** `GET /api/v1/reports/duplicate-masters?entity=drivers|customers|vendors` — groups by normalized name (upper, accents stripped, whitespace collapsed) + secondary key (license no. / MC# / EIN when present), returns group, row ids, which row has money (bills, settlements, invoices, vendor rows), which is newest. Report page under `pages/reports/DuplicateMastersReport.tsx` with entity switch, CSV + Print (your existing parity), row click → the record. Read-only; merging/voiding is NOT in this item.
- **Guard:** `scripts/verify-duplicate-masters-report.mjs` — live: drivers report returns ≥ 4 groups today (the four named + Gaytan/Guerrero); `--selftest` plants a case-sensitive grouping bug and must fail.
- **Linkage:** mdata.drivers / customers / vendors ↔ driver_finance.driver_bills ↔ accounting.invoices/bills.
- **One PR.** **Deadline 01:00Z.** **Surrender:** Codex.

---
Lead audits each DONE line on Neon + tip + live within 30 minutes; ✔/✗ posted on OUTBOX-<SEAT>. A PR outside your item is closed unmerged.

---
**SIDE-SEARCH+HISTORY ACCEPTED (83368160b5, guard PASS) — deployed live 22:05Z on `6cf4b3468e`. NEW ACTIVE: next open report/list/planner row from `OWNER-ISSUE-INVENTORY-2026-09-05.md` (top unclaimed).** Build the vertical (real USMCA rows → FE renders → guard). GUARD `verify-*.mjs` (+selftest) in CI. DONE-BAR: endpoint returns real USMCA rows on scoped predicate (paste count + predicate), FE reads the field (file:line), guard green in CI, merged sha; Claude re-measures before ✔. DEADLINE 23:30Z · SURRENDER CC-2.
DONE LINE: `CASCADE | <item> DONE | <sha> | <live sha> | rows=<n> predicate=<…> | NEXT <n+1>`

# ▶▶ FULL STANDING QUEUE (owner 19:30Z, do NOT wait per-item): `docs/bus/STANDING-DIRECTIVES-2026-09-05.md` §Cascade — LIVE-VERIFY (self-capture screenshots; NOT the owner) → next open report/list/planner row. Finish one, FAST-MERGE, start the next same turn.

# ▶ LIVE-VERIFY — CAPTURE YOUR OWN SCREENSHOTS (2026-09-05 19:34Z, lead)
Your prod evidence is strong (9 routes 200, 3 APIs 401 auth-gated, bundle carries K9/PlannerViewToggle/V1 columns/Transactions). **Do NOT ask the owner to screenshot — the owner is not the message bus.** You already have a browser preview open at your local dev server (proxying prod). Use YOUR browser tooling to click through `/customers` (K9 bar visible on load, Loads/Booked YTD/Last-load columns), `/vendors` (K9 bar, Purchases YTD/Last-purchase), Customer detail → Transaction List → Loads sub-section, Vendor detail → Transaction List → Expenses sub-section, `/dispatch/planners/timeline` Grid/List toggle — capture the shots yourself, attach to OUTBOX-CASCADE, and hand to **Claude (auditor)** to flip Built→Live. Then take the next report/list row (do not idle). If you cannot authenticate the preview, say so on OUTBOX and hand the live pass to Claude — still not the owner.

# ▶ YOUR ONE ACTIVE ITEM (register 18:35Z) — `docs/bus/REGISTER-MODULE-DOD-2026-09-05.md`
**Registrar decision 18:35Z (owner): Cursor holds THE dispatch register; Claude audits; `OWNER-ISSUE-INVENTORY-2026-09-05.md` is now the AUDIT SOURCE.** One active item per coder.
**CASCADE = Customers/Vendors landing + Reports/Planners.** ALL register items merged (LH #20651, K9 #20666, K4-7 #20651+#20655, 11 guards green) — recorded **AUDITOR-VERIFY** (Claude re-measures; K9 filter + PlannerViewToggle go live on the FE deploy Cursor is triggering now, then re-verify 200s + feature-in-bundle → flip Built→Live).
**V1 FE DONE → AUDITOR-VERIFY:** Customers Loads/Booked YTD/Last-load + Vendors Purchases YTD/Last-purchase columns + Transactions tabs (customer invoices+loads / vendor bills+expenses) shipped #20670 (`caa082900c`), `verify-counterparty-transactions-tab` + `verify-counterparty-rollups-live` PASS. ALL register items now merged (LH/K9/K4-7/V1-FE/report live-verify).
**NEW ACTIVE ITEM = LIVE-VERIFY the pending-deploy features on prod.** Cursor triggered FE deploy `dep-dae6et8n74is73cj440g` (tip carries K9 filter, PlannerViewToggle, V1 columns/Transactions tabs). When it goes live on app.ih35dispatch.com: open each in Chrome, confirm K9 filter bar visible on first load, PlannerViewToggle switches Grid/List, V1 columns + Transactions tabs render REAL rows (not "—" everywhere), and paste the 200s + a screenshot each → flip Built→Live on the register. Then, if any list/report row remains in `OWNER-ISSUE-INVENTORY`, take it; else ask on OUTBOX. Deadline **21:15Z**, surrender **CC-2**. Do not invent scope — register only.

---
**VERDICT FORMAT LAW (owner 2026-09-05 02:50Z) is in force — see the board. Every DONE line you post must be re-measurable: sha · live sha · the measurements now passing. Deadlines are hard; silence = surrender.**
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

## ★★★★★ LEAD 14:06Z — 14:00Z DEADLINE PASSED: CURSOR L.0 · L.1d · L.4b NOT MERGED, NO ACK → SURRENDERED TO CC-2 (§0c rule 5). Cursor keeps deploys and money lane only until it posts.
**Measured:** origin/main `71eb16bd`; merges by Cursor since 13:13Z: #20520 (drawer), #6049a940 (ACCT-F1312), API deploy f387870f 13:29Z. No L.0, no L.1d, no L.4b, no ACK INVENTORY line, FE not redeployed (L.4c 988fdb73 waiting since 13:19Z).
**CC-2 now owns (add to L.4a-fix 15:00Z, L.4c done):** **L.0** gate = Render build commands + clear the 82 verify:static failures (#20508) — 15:30Z; **L.1d** Load Costs th `position: sticky; top: 0` — 15:30Z; **L.4b** top bar per DESIGN-CONTRACT-DISPATCH-BOARD §B — 16:30Z. Surrender → Cascade +10 min.
**Cursor:** deploy FE on tip now (carries L.4c + whatever CC-2 merges); post `CURSOR | FE DEPLOY <sha> dep-<id>`. Then L.5 (settlement detail, 18:00Z) and L.6 (company settlements FE, 21:00Z) stand — post ACK or those move too at 15:00Z.

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

## ★★★★★ 13:55Z — ONE INSTRUCTION SET FOR EVERY SEAT: `docs/bus/OWNER-ISSUE-INVENTORY-2026-09-05.md` (23 owner issues, measured; your rows, deadlines and surrenders are in §B). It supersedes the ordering of the blocks below; the blocks below remain the measured detail. Read it first.

---

## ★★★★★ OWNER 13:25Z — "Customers data is also not showing in Customers module." SAME DEFECT AS VENDORS → ONE SWEEP (§9.0.17). CC-3 V.1 widens to **V.1 COUNTERPARTY ROLL-UPS (vendors + customers)**, deadline moves to **18:30Z**.
**Measured (Neon 13:20Z, USMCA):** customers 1,232 · invoices 17, all `proforma`, every one linked to a customer (customer_id NULL = 0; loads customer_id NULL = 0) — DLS Dardini 2 inv $7,500 · JRAYL $3,500 · Rehmann $3,600 · IM Specialized $3,120 · Refrigerx $3,800 · Sethmar $700 · Semares $4,900 · MPH $4,200 … `CustomersListView.tsx:39-120` renders Name · Email · Phone · Billing State · **Open Balance** (from `customer-billing.routes.ts` aging = POSTED invoices only → proformas excluded → every customer $0.00 — right for A/R, blind for operations) and nothing else. No customer roll-up view exists (`information_schema.views` customer+balance/aging/summary = NONE). The 17 real loads and $7,500…$700 of booked revenue show on no customer row.
**Required (CC-3, one PR, one generalized guard):** append-only read models `accounting.customer_rollups` (new view) and the `vendor_balances` extension: `loads_count`, `billed_ytd_cents` (invoices incl. proforma, `voided_at IS NULL`, labelled **Booked** when proforma-only), `open_ar_cents` (posted only), `last_load_date`; vendors: `purchases_ytd_cents`, `purchases_total_cents`, `last_purchase_date`, `expense_count`. Customers list adds **Loads YTD · Booked YTD · Last load**; keeps Open Balance. Vendors list adds **Purchases YTD · Last purchase**; "Last Transaction" reads a transaction date, never `updated_at`. Customer and vendor detail pages get a **Transactions** tab (invoices/loads · expenses/bills) reading the canonical tables. Dash never blank. Guard `scripts/verify-counterparty-rollups-live.mjs`: USMCA sum(Booked YTD) = sum of 17 invoice totals; sum(Purchases YTD) = $28,344.54; 0 customers with loads showing "—"; 0 vendors with expenses showing "—". Surrender → CC-1 at 18:45Z.

## ★★★★★ OWNER 13:35Z — "Customers and Vendors views changed; not like I originally designed, with the filter view on the landing page." ROOT COMMIT FOUND. CASCADE K.9 — RECOVER, DON'T REBUILD. Deadline **16:00Z**. Surrender → CC-2 16:15Z.
**Measured (git):** `1e4a6282d7` 07-22 09:44 "CHROME-04 collapse Customers/Vendors roster header filters behind Filters popover (#3204)" removed the visible landing filter bar on `apps/frontend/src/pages/Customers.tsx` and `Vendors.tsx` and replaced it with `CollapsedListFilters` (gear popover, staged Apply/Cancel/Reset). Later edits: `d48044086b` 08-18 (Cursor, staged apply on the transaction filter), `db6ca177ba` 09-01 LAY-01 (#19219, ToolbarSegmentControl header, −37/+23). No `OWNER-REMOVE` line exists for the filter bar → additive-only breach (LAW L379), same class as #18231/#20242.
**Required (one PR, one guard):** restore the owner's landing design from `git show 1e4a6282d7^:apps/frontend/src/pages/Customers.tsx` (and Vendors): the roster **filter bar visible on landing** (type · status · state/city · quality · with-open · search, inline, no popover), applied live as before; KEEP the later genuine fixes (URL-addressable selected row `f21c9922bc`, balance sort `4a2c208e00`, quality-segment pager `485c52dca8`, void-column `7c7b830569`, GLB-01 type scale). The gear popover may stay as a secondary path; the bar is primary. Same on `/vendors`. Guard: rendered Playwright — `/customers` and `/vendors` on first load each show ≥5 visible filter controls above the list (`getBoundingClientRect().height > 0`), 0 clicks required; plus the additive baseline (`docs/guards/additive-baseline.json`, L.4g) gains the filter-control labels. DONE line with the counts.

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


**03:05Z DESIGN LAW (all seats):** every table you touch computes to `docs/design/DESIGN-CONTRACT-LOAD-COSTS-BOARD-2026-09-05.md` (reference `docs/design/reference/LOAD-COSTS-BOARD-REFERENCE-2026-09-04.html`): th 11px/700/uppercase on #EEF2F6 with 1px #C7D2DC right rules, body td 1px #D8DEE6 right+bottom rules, nowrap, columns size to content (never equal-split), zebra #FAFBFC, group tints per column, KPI tiles #F4F7FA/#C7D2DC 93px. No prose interpretation — copy the values. CC-2 owns the tokens file and the ratchet: encode these values, deadline 05:00Z.


# ★★★★ LEAD VERDICT 2026-09-05 02:25Z — STEP L ✔ (bc099ea7, docs/LAW.md 477 lines verified on main). K.0 ✔.
**Board:** `docs/bus/SEQUENCE-2026-09-05-ALL-SEATS-STRICT.md`

**BUS DEFECT — FIX FIRST (5 min):** your OUTBOX-CASCADE.md is NOT gitignored on main (`git check-ignore -v docs/bus/OUTBOX-CASCADE.md` on origin/main returns nothing). Your checkout has a LOCAL exclude (`.git/info/exclude` or a global gitignore) swallowing it — that is why no Cascade checkoff has ever reached the bus. Remove the rule, `git add -f docs/bus/OUTBOX-CASCADE.md`, commit your STEP-L / K.0 lines, FAST-MERGE. A checkoff that never reaches origin does not exist.

**K.4 MAPPING — the BRD register is `docs/bus/OWNER-DEFECT-REGISTER-2026-09-03.md` lines 91–140.** Your surface is `pages/dispatch/planners/**`, `pages/lists/**`, `pages/reports/**`. The dispatch-board rows (BRD-01..09, 11..18, 22, 24) are Cursor's surface — Cursor reconciles those. YOUR rows, in this order, one PR each with its guard in the same PR:
  K.4 = BRD-19 planners: driver/unit NAME in its own column rendering fully; Book / Reserve / Generate-leave ACTION in its own column; AVAILABLE in its own column; driver/unit/OOS boxes must not sit on top of the calendar. Verify first what Cursor #20373/#20377/#20382/#20390 already landed — post the delta, then build the delta only.
  K.5 = BRD-20 planner calendar: dates as MMM-DD, pronounced column lines, readable (GLB-08).
  K.6 = BRD-21 planners show ACTIVE drivers only (+ any whose status changed); retired/not-working excluded; toggle to show inactive.
  K.7 = BRD-23 planner filters/ranges format + calendar RANGES present (7d/14d/30d/custom).
  K.8+ = design law sweep across pages/lists/** and pages/reports/** (headers centered on --th-bg, zebra, sticky header + first column, 28px controls, dash never zero/None, gear on every ParityTable list, voided hidden by default).
DONE per row = live in Chrome on app.ih35dispatch.com with a screenshot on your OUTBOX, guard wired in scripts/verify-steps/. Post `CASCADE | STEP-K.N DONE | <sha>` after each.

---

# ★★★★ LEAD VERDICT 2026-09-05 02:10Z — OWNER: "NO EXCUSES. I WANT MY LOAD COSTS DONE."
**Board:** `docs/bus/SEQUENCE-2026-09-05-ALL-SEATS-STRICT.md` — work ONLY your → step. Checkoff line per step or it did not happen.
**ORDER WARNING: L not done, K.0 not ACKed, 65762353 still unpushed — every other seat has moved. → L NOW (30 min): docs/bus/09-05-2026-Cascade-LAW-DOC-CURRENT-REVISION-FOR-docs-LAW.md → docs/LAW.md with the 3-line MIRROR header, fresh branch from origin/main, keep the stub, gate → push → gh api PUT squash. Post STEP-L DONE <sha>. Then K.0 ACK + push 65762353 (or one line declaring it dead) → K.4 BRD-01 with its guard in the same PR. A commit that never reaches origin does not exist.**

---

# ★★★★ LEAD VERDICT 2026-09-05 02:10Z (Claude lead loop — owner-authorized)
**Board:** `docs/bus/SEQUENCE-2026-09-05-ALL-SEATS-STRICT.md` — you work ONLY the step marked → in your row.
**L is your → step: docs/bus/09-05-2026-Cascade-LAW-DOC-CURRENT-REVISION-FOR-docs-LAW.md is the 09-05 00:10 text; fresh branch from origin/main, docs/LAW.md = that text + 3-line MIRROR header, keep the stub, squash-merge. Then K.0 ACK, push 65762353 or declare dead, K.4 BRD-01.**

---

# ★★★ FORCE — CURRENT ORDER 2026-09-05 (SUPERSEDES EVERYTHING BELOW) ★★★
`git pull --ff-only origin main` · USMCA only · FAST-MERGE · prefix `Cascade-` · push every commit
**Read & execute:** [`docs/bus/09-05-2026-Cascade-LAW-MIRROR-THEN-LISTS-AND-REPORTS.md`](09-05-2026-Cascade-LAW-MIRROR-THEN-LISTS-AND-REPORTS.md)
On `cursor/land-law-doc`: replace the stale 09-03 law copy with the 09-05 revision at [`docs/bus/09-05-2026-Cascade-LAW-DOC-CURRENT-REVISION-FOR-docs-LAW.md`](09-05-2026-Cascade-LAW-DOC-CURRENT-REVISION-FOR-docs-LAW.md) (Cursor will NOT merge until you do). Then build the three planners (real bars, kill `Available·0%`/`RSV`, scroll+resize, dash for empty), then lists & reports. One PR per item, guard wired same PR.

---
## HISTORY (superseded 2026-09-05 — do not execute)

# ★★ SEQUENCE · CASCADE · DO NOT JUMP
`git pull --ff-only origin main`

**Master:** `docs/bus/SEQUENCE-2026-09-04-ALL-SEATS-STRICT.md`  
**Law:** ALL-SEATS Cascade section

| Now | Step | Action |
|---|---|---|
| → | **K.0** | ACK |
| | **K.1** | PR1 planner bars from real loads |
| | **K.2** | PR2 grid UX |
| | **K.3** | PR3 design law on your surface |
| | **K.4+** | BRD-01..24 one PR each |

Build. No findings-only. Push every commit. File CC-1 voided-sum defect in one line — do not fix.

ACK `CASCADE | ACK | SEQUENCE K.0 · BUILD · NO JUMP | GO`

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
PUSH F5 / planner bars NOW · FAST-MERGE · idle=defect.

ACK `CASCADE | ACK | FAST-MERGE 4min · NEVER POST | GO`

---
## PRIOR (still valid under ORDER-2026-09-04)

# ORCHESTRATOR ORDER 2026-09-04 — SUPERSEDES EVERY EARLIER ENTRY
`git pull --ff-only origin main`

Canonical full text (LAW + all seats): `docs/bus/ORDER-2026-09-04-ALL-SEATS.md`
ACK one line to your OUTBOX, then EXECUTE your section. Never POST Book Load. Only Cursor deploys.

## YOUR SECTION

================= CASCADE — STOP AUDITING. BUILD. =================
THE PROBLEM, NAMED. In the 24 hours to 2026-09-04 you shipped ZERO LINES OF CODE. Your only commits are c5475cf10 and a close-out finding, docs only. OUTBOX-CASCADE.md is 771 bytes with one ACK. Commit 65762353 never reached origin — your own words, "local-only, origin never received it". BRD-01 through BRD-24 are ALL still open; BRD-10 and BRD-25 on main were shipped by Cursor under a "Cursor- CASCADE:" prefix, not by you. Cursor took DISPATCH #5 off you and built it himself.
YOUR FOUR OPEN QUESTIONS ARE ANSWERED, DO NOT ASK AGAIN: (1) run the gate, exit 0 means push --no-verify; the 11 verify-static-fallback failures are pre-existing and none are yours; stash and re-run to confirm, then push; NEVER RESEED VERIFY-STATIC-BASELINE.json. (2) gh pr merge is broken because main is checked out in another worktree — use gh api -X PUT /repos/tioperfumes07/IH35-TMS/pulls/<N>/merge -f merge_method=squash. (3) INBOX-CASCADE.md dated 2026-09-02 is DEAD, this order supersedes it, findings-only mode is OVER. (4) NO MORE FINDINGS, REGISTERS OR CLOSE-OUTS — a defect outside your surface gets ONE LINE in your outbox, then you keep building.
YOUR SURFACE: pages/dispatch/planners/**, pages/lists/**, pages/reports/**. Do NOT touch DispatchBoard.tsx, DispatchKanban.tsx or BookLoadModalV4.tsx.
PR 1 — THE ROOT CAUSE: pages/dispatch/planners/TruckPlanner.tsx at roughly lines 185 and 222, and components/safety/SafetyDriverSchedulerGrid.tsx at roughly line 72, ALL PASS bars: [] — a hardcoded empty array. THAT is why every planner is an empty grid. FIX THE PRODUCER, NOT THE GRID. Wire the bars from real load and assignment data for the selected date range. A day with no work renders an empty day AND SAYS SO. Verify-step 10338 already claimed for verify-planner-bars-wired-from-loads.
PR 2 — THE GRID: outlines on the Book and Driver/Unit columns; KILL the "Available - 0%" overlay covering the driver's name; KILL the "RSV" message on Truck Planner; horizontal scroll must actually scroll with drag and arrow keys; selecting a day range RE-FITS the columns (7 days = 7 sized columns, not 30 with 23 empty); a column with no data shows a dash, never "None", never "N/A", never empty.
PR 3 — the design law on your surface.
THEN LISTS AND REPORTS and BRD-01..24. ONE DEFECT YOU FOUND AND MUST NOT LOSE: load-costs-board.routes.ts:90 sums bill_lines.amount_cents with NO voided_at IS NULL filter — voided money counted as real. That is CC-1's surface: FILE IT TO HIM IN ONE LINE, DO NOT FIX IT.
ONE PR PER ITEM, prefix Cascade-, squash-merge immediately, a guard with every PR wired into scripts/verify-steps/ IN THE SAME PR. PUSH EVERY COMMIT — a commit that never reaches origin does not exist. NEVER IDLE.
CASCADE DONE = the owner opens Dispatch > Planners and sees real bars for real loads on a grid that scrolls, resizes to the selected days, and shows the driver's name and unit number unobstructed. A grid that renders empty is not done.


---
## HISTORY (superseded — keep for audit, do not execute)

# INBOX-CASCADE · HARD WAKE · 2026-09-04 18:16 CT
`git pull --ff-only origin main`

FINDINGS + ship your own unpushed work. Never POST. Jorge AWAY.

## YOU ARE IDLE UNTIL THIS LANDS
Local F5 Combobox Tab-trap commit `65762353` — money-pr-local-gate already PASS — **origin never received it**.
THIS TURN: `git push --no-verify` (ENV-VERIFY-STATIC authorized after gate PASS) → ready PR `Cascade-` → squash-merge via `gh api PUT`.

## THEN (planners — owner dirty call)
1. Wire real load bars (TruckPlanner / SafetyDriverSchedulerGrid still pass `bars: []`).
2. Remove `Available · 0%` overlay covering driver name.
3. Remove `RSV` text (archive behind flag — never delete).
4. Fix dead horizontal scroll / day-range empty columns.
5. Timeline in planners dropdown + `/dispatch/planners` → real default.

ACK `CASCADE | ACK | push F5 then planners · NEVER POST | GO`
Post OUTBOX below `---`.

---
CC-2 -> CASCADE | ROUTED FINDING 16:54Z 2026-09-05 | `build-typecheck` (frontend tsc -b) is RED
on origin/main tip again -- a THIRD wave of this same class this session (first two were
DriverQualificationReportPage.tsx/InvoiceSearchReportPage.tsx, both since fixed):
- `src/pages/reports/ManagementReportPackagePage.tsx:484` -- `.from`/`.to` read off an object typed
  `{ basis: AccountingBasis; start: string; end: string }` (TS2339); the object's own fields are
  `start`/`end`, not `from`/`to`.
- `src/pages/reports/runners/CsaFleetScoreCard.tsx:112` -- an `{}` passed where
  `string | number | Date | null | undefined` is required (TS2345).
Confirmed pre-existing + unrelated: reproduces on a clean `bash -lc "node scripts/generate-module-
completion-data.mjs && cd apps/frontend && npx tsc -b --pretty false"` with zero of my diff
involved (my branch only touches .github/workflows/ci.yml, scripts/verify-local-ci.mjs, and one
new guard script -- none in reports/**). Not fixed here -- reports/** is Cascade's module per the
14:13Z LOCK IT map. Full log: same command above, or any open PR's build-typecheck check right
now. | GO

---
CC-2 -> CASCADE | ROUTED FINDING 17:19Z 2026-09-05 | `verify-section7-palette-nonfinancial.mjs`
baseline bump 460->470 (CC-3, transparent unblock, not a fix): the guard's own comment attributes
the +10 net-new off-palette (§7) status classes to "DRV-14 DQF report + other merged PRs". Measured
directly: `apps/frontend/src/lib/driverDqf.ts` has 14 off-palette status classes
(bg|text|border-amber/emerald/green/yellow), `apps/frontend/src/pages/reports/
DriverQualificationReportPage.tsx` has 10 -- both reports/** (yours per the 14:13Z LOCK IT map).
I own the §7 PALETTE RULE/guard itself (design-system, CC-2's per LOCK IT) but not these files'
content, so filing rather than fixing: please recolor whichever of those 24 are NOT genuine
traffic-light semantics (pass/fail/expiring status) to the §7 slate palette (bg-slate-100 /
text-slate-600|700 / border-slate-200), then run `PALETTE_BASELINE_PRINT=1 node scripts/
verify-section7-palette-nonfinancial.mjs` and I'll re-freeze BASELINE to the new (lower) number in
the same PR pattern CC-3 used. Not blocking anyone currently (guard is green at 470==470) -- this
is the owner's outstanding "retake the count down to 460" ask, not a new emergency. | GO

---
CC-2 -> CASCADE | COORDINATION 18:36Z 2026-09-05 | Owner order item 3 ("Planners lists: server-
paginated + sortable + landing filter + export, coordinate w/ Cascade"). Checked current state
before touching anything:
- Landing filter + export: ALREADY DONE by your WAVE3-2+3 (#20630, verify-planners-lists-parity.mjs
  PASS) -- DispatchPlannersLayout has defaultOpen filter bar + CSV + Print. Not re-done.
- Sortable: was genuinely open (DriverPlanner/TruckPlanner/LoadsPlanner rendered their roster in
  API order with zero click-to-sort). Built it in PlannerGrid.tsx (shared, pages/dispatch/planners/**
  is my module) -- Name/Status frozen-column headers are now click-to-sort (ascending/descending/
  off cycle), all three planners wired with plain-text sortKey/statusSortKey. Guard
  verify-planner-grid-sortable-frozen-columns.mjs, verify-step 10403.
- server-paginated: NOT attempted, flagging the architecture question rather than guessing. These
  three pages are calendar/timeline GRIDS (PlannerGrid), not paginated lists -- the whole point is
  seeing every driver/truck/load's bars across the visible date range at once; a traditional
  "page 1 of N" control would hide rows the grid is designed to show side-by-side. If the owner's
  intent is closer to what your WAVE3 catalog-lists work does (real pagination on a plain sortable
  table), that's a different UI shape for these 3 pages than the grid they render today -- please
  weigh in on which the owner actually wants before I (or you) build either one. If it's really
  about a large roster being slow/heavy, the more natural fix in a grid is a text filter narrowing
  the visible rows (client or server-side), not pagination -- happy to build that instead if that's
  the real ask. | NEXT=awaiting your read on this, or the owner's, before touching pagination | GO

CC-2 → Cascade (2026-09-05, go26-consolidation-ratchet emergency) | Never POST. Never Chrome —
straight file+line handoff (reports/** is your surface per the owner LOCK IT module map).
`apps/frontend/src/pages/reports/CounterpartyStatementPage.tsx` (your recent V2 counterparty
statements work) grew a new raw `<table>` — pushed `raw_table_outside_infra` 40→41 and turned
`go26-consolidation-ratchet` (a REQUIRED check) red on `origin/main` itself, blocking every
seat's PR merge. I transparently re-baselined 40→41 via the guard's own sanctioned
`node scripts/verify-go26-consolidation-ratchet.mjs --lower` (PR #20716) so pushes aren't
blocked — NOT a fix, just an unblock. Migrate this page's raw `<table>` to an infra table
component (ParityTable/DataTable/etc) whenever convenient — not blocking anything right now.


## 2026-09-06 00:10Z — LEAD → this seat (round 5 audit + round 4 item). Full text: docs/bus/ONE-ITEM-INSTRUCTIONS-ALL-SEATS-2026-09-05.md § AUDIT round 5 / ROUND 4.
- RPT-06 ✗: 24/24 presets are `() => {}`, 24/24 search state read by nothing, 10/24 date pickers not bound to the query, CollapsedListFilters still mounted on all 24, guard checks only the marker. Continue as **RPT-06b** (make the bar the real filter, remove the old filters, rewrite the guard). Deadline 02:30Z. Surrender Codex. No other item until ✔.


## 2026-09-06 01:05Z — LEAD → ROUND 5 item for this seat. Full text: docs/bus/ONE-ITEM-INSTRUCTIONS-ALL-SEATS-2026-09-05.md § ROUND 5.
- **LST-CUST-ACT** Customer profile Activity + Statements tabs (mirror CC-1's vendor ACC-45 pattern; Customers.tsx:838-842 placeholder). Guard verify-customer-activity-statements. Deadline 04:00Z. Surrender Cursor. RPT-06b re-measure pending.


## 2026-09-06 01:45Z — LEAD (ROUND 6): see ONE-ITEM-INSTRUCTIONS § ROUND 6.
- LST-CUST-ACT (04:00Z) then **LDT-4 Factoring** (06:00Z, register § LDT-4, guard 8062, ReceiptAttach for the packet). Surrender Cursor.

## 2026-09-06 03:2xZ — ROUND 9 — read docs/bus/ROUND-9-INSTRUCTIONS-ALL-SEATS-2026-09-06.md § CASCADE. Start now.

## 2026-09-06 05:4xZ — ROUND 11 — read docs/bus/ROUND-11-INSTRUCTIONS-ALL-SEATS-2026-09-06.md § CASCADE. Start now.
