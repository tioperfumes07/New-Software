# ★★★ HARD WAKE — 2026-09-07 03:48Z — Cursor cloud lead (owner: HARD WAKE)

**Tip main:** `0cc2a61752` (#21232 navy loopholes just merged; FE+API deploy in flight). Live proof ROUND 16.25 ParityTable FIXED (Claude lead re-measured: Cash Flow 0/64 tall max 34.4px; Factoring 0/20 max 30.8px).
**Deadline:** **2026-09-07 07:00Z** — post interim DONE lines; no idle; one PR + one named guard per item; USMCA only; never POST Book Load; no seat fixtures.

## CODEX — HARD WAKE NOW · ROUND 16.26 NEXT WAVE

START NOW: **DRV-03, DRV-04, DRV-05, DRV-12, DRV-14** then TEL-04/09/11/12 if early.
TEL-07 stays BLOCKED unless blocker cleared — report honestly, do not re-claim. Real Neon/Samsara only. Deadline **07:00Z**.


---

# ▶ NOW — 2026-09-05 22:06Z (Cursor registrar/lead; Claude audits)

**23:45Z — LEAD · ROUND 3 — YOUR ONE ITEM:**

## CODEX — TEL-40 continues: after API deploy e12f6cc3 is live, rerun the backfill and post the live guard numbers. Then next item TEL-41 (Samsara POST /places for each new geofence — rows 40–43) is HELD until the owner confirms; do not start it.

---

**23:15Z — LEAD · TEL-39 / LST-DUP audited ✔. YOUR NEXT ONE ITEM:**

## CODEX — item TEL-40 · geocode the stops, build our geofences (no Samsara push yet) — deadline 2026-09-06 02:30Z
- **Measured (Neon 19:1xZ, re-read 23:1xZ):** active USMCA loads 78 → 156 stops, **0 with latitude/longitude**, `address_line1` NULL on the seeded stops (city/state/zip present); `geo.geofences` **2 rows** in the whole database; `mdata.locations` 10 USMCA rows; `geo.geofence_events` 0. Load 13526 stops: Uhrichsville OH 44683 / Mesquite TX 75149, lat/lng NULL.
- **Required value:** a service-layer job `telematics/stops-geocode-backfill.service.ts` that, for every active USMCA stop with NULL lat/lng, calls the existing geocoding path (`/geocoding` client → Google Text Search/Geocoding, city+state+zip when address is NULL), writes `load_stops.latitude/longitude` + `geocode_source` + `geocode_confidence`, and creates/links `mdata.locations` (dedupe by normalized address) and one `geo.geofences` row per location (enter 0.25 mi / exit 0.5 mi, LAW §2 hysteresis) keyed to the per-vehicle state table. Runs once now (admin `POST /api/v1/telematics/stops/geocode-backfill`) and on every new stop insert (hook in the stop service, not the HTTP route). Stops that cannot geocode are listed with the reason — never written as 0,0. **No Samsara `POST /places` in this item** (rows 40–43 await owner confirmation).
- **Guard:** `scripts/verify-stops-geocoded.mjs` — live: active USMCA stops with NULL lat/lng = 0 or each has `geocode_failure_reason`; geofences ≥ distinct locations; no (0,0) coordinates; `--selftest` plants a 0,0 write → FAIL.
- **Linkage:** mdata.load_stops ↔ mdata.locations ↔ geo.geofences ↔ geo.geofence_vehicle_state ↔ mdata.loads.
- **One PR.** **Surrender:** CC-3. (Moves R48c off Cursor's Dispatch list — Cursor keeps LDT-0…7.)
DONE LINE: CODEX | TEL-40 DONE | <sha> | verify-stops-geocoded --selftest N/N | stops null lat/lng <n> · geofences <n> · locations <n> | NEXT await lead

---

**22:43Z — LEAD (owner: 'you are lead again'). YOUR ONE ITEM — nothing else is accepted:**

## CODEX — item TEL-39 · Samsara driver mirror: deactivated drivers + resync
- **Measured (Neon 19:1xZ):** `integrations.samsara_drivers` 78 rows, all `active`, `max(updated_at)` = 2026-05-31 23:12Z. Samsara live (owner session 15:0xZ): 30 active + 727 deactivated = 757. Your #20656/#20664 shipped roster status + freshness code (merged, deploying now) — the COLLECTOR has still not pulled deactivated drivers.
- **Required value:** collector calls `GET /fleet/drivers?driverActivationStatus=deactivated` (paginated, `after` cursor) in addition to active; upsert by `samsara_driver_id`, keep `raw_payload`, set `driver_activation_status`; link to `mdata.drivers` by license number then exact name, never create duplicates; run on the existing `5 */12 * * *` schedule AND once now via `POST /api/v1/integrations/samsara/drivers/resync` (admin). After the run: rows ≥ 757, 0 rows with `driver_activation_status IS NULL`, `max(updated_at)` today. The roster page you built shows Active / Deactivated / All from this mirror.
- **Guard:** `scripts/verify-samsara-driver-mirror-complete.mjs` — live: count ≥ 757, null-status = 0, freshness < 24 h; `--selftest` plants an active-only fetch and must fail.
- **Linkage:** integrations.samsara_drivers ↔ mdata.drivers ↔ mdata.units (current assignment) ↔ safety.
- **One PR.** **Deadline 01:00Z.** **Surrender:** CC-3.

---
**ACTIVE: #41 Samsara Routes integration — but you've posted NOTHING. Post a status/ETA to `OUTBOX-CODEX.md` now or I move #41's dispatch dependency (CC-2 D5 is proceeding without you).** Lease-scoped to USMCA only (`mdata.units.currently_leased_to_company_id='5c854333…'`, Rule 49) — never gate active on `samsara_drivers.last_seen_at`. NO production/economic records. GUARD `verify-samsara-routes-integration.mjs` (+selftest) in CI. DONE-BAR: schema+migration on prod, endpoint returns real lease-scoped rows (paste count), guard green in CI, merged sha; Claude re-measures before ✔. DEADLINE 23:00Z · SURRENDER CC-3 (telematics).
DONE LINE: `CODEX | #41 DONE | <sha> | <live sha> | routes rows=<n> lease-scoped | NEXT maintenance row`

# ▶▶ FULL STANDING QUEUE (owner 19:30Z, do NOT wait per-item): `docs/bus/STANDING-DIRECTIVES-2026-09-05.md` §Codex — X.9 Book Load Samsara geofence backend (↔ CC-2 D5) → telematics durability + count-band guard → next maintenance row. Finish one, FAST-MERGE, start the next same turn.

# ▶ YOUR ONE ACTIVE ITEM (register 18:35Z) — `docs/bus/REGISTER-MODULE-DOD-2026-09-05.md`
**Registrar decision 18:35Z (owner): Cursor holds THE dispatch register; Claude audits; `OWNER-ISSUE-INVENTORY-2026-09-05.md` is now the AUDIT SOURCE.** One active item per coder.
**CODEX = Maintenance (+ Telematics/Samsara, Rule 49).** Telematics vertical COMPLETE + recorded **AUDITOR-VERIFY**: Step-3 migration applied (#20648), position freshness (#20656), Samsara roster (#20664 `9f355be6`), backend deployed `git_sha 9f355be6`, roster route 401 on unauth, and **Rule 49 live counts PROVEN: 16 USMCA in-service units · 20 active drivers** (exactly the rule's band — no drift). Claude re-measures the 16/20 against Neon before the box flips.
**X7 + X8 DONE → AUDITOR-VERIFY:** X7 CI enforcement #20669 (`ce5d5d633d`), X8 CI enforcement #20671 (`208ddf6bbd`) — Fleet header + WO edit-combobox + canonical unit wiring + ≥$7,000 capitalization path now run through verify-step 3334. Maintenance vertical complete; Claude re-measures before the boxes flip.
**CORRECTION (you were right):** DP1/DP2 driver-profile tabs are **CC-3's** vertical (LOCK-IT: Settlements/Driver-Profile → CC-3), NOT Codex — struck from your board.
**X.9 DONE → AUDITOR-VERIFY:** Samsara geofence projection #20678 (`105326669b`); Rule 49 durability/count-band CI enforcement #20689 (`e690c956`, guard rejects 9/40 drivers + 0/21 units, passes 20/16) — deployed on the tip Cursor just pushed. Maintenance (X7/X8) + geofence-projection complete; disciplined hand-back noted (you did NOT invent scope — correct).
**NEW ACTIVE ITEM = #43 — Samsara externalIds standard.** Stamp `ih35Driver / ih35Unit / ih35Trailer / ih35Load / ih35Stop / ih35Site` on EVERY Samsara object we create (extend the X.9 geofence/address create path + the samsara-client), so #41 (Routes) and #42 (real driven miles) can correlate our objects to Samsara's. One guarded PR: assert every create call in `backend/integrations/samsara/**` sets the externalIds map (mock the client). Deadline **21:30Z**, surrender **CC-2**.
**THEN (register order, do not jump):** #42 real driven miles per leg (odometer at fence entry/exit → real miles beside practical/short; pairs CC-1 for load costs) → #41 Samsara Routes integration (push dispatched loads, consume RouteStopArrival/Departure webhooks; pairs CC-2). If #43 blocks on the client shape, say so on OUTBOX and take #42.
DONE-BAR: schema/migration APPLIED to prod · endpoint returns REAL USMCA rows (paste count) · FE file:line · guard green **in CI** · merged sha · **Claude re-measures**. FAST-MERGE.

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

## ★★★★★ 13:55Z — ONE INSTRUCTION SET FOR EVERY SEAT: `docs/bus/OWNER-ISSUE-INVENTORY-2026-09-05.md` (23 owner issues, measured; your rows, deadlines and surrenders are in §B). It supersedes the ordering of the blocks below; the blocks below remain the measured detail. Read it first.

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


# ★★★★★ LEAD VERDICT 2026-09-05 02:45Z — OWNER: "GET CODEX WORKING."
X.3 X.4 X.5 ✔. You have been silent since #20437.
→ **X.6 NOW (30 min, no code):** on API 61f1967 call and PASTE the raw JSON to OUTBOX-CODEX: `GET /api/v1/maintenance/in-shop-units?operating_company_id=5c854333-6ea5-4faa-af31-67cb272fef80` (expect 200 with [] and a named empty state, never 404); `GET units-without-load` (15 rows, every unit_number non-blank); `GET /api/v1/border-crossing/loads/926f4142-3fe4-4aa5-b896-daa0ca6474c4/driver-instructions` (13508 has no border stop → honest empty, not an error).
→ **X.7 (code, one guarded PR):** design law on YOUR surface — every maintenance list/table header centered on --th-bg, regular weight, 1px --th-border between columns in header AND body, no truncated labels, KPI tiles --kpi-bg + darker border, zebra, sticky header, dash never zero/None, 28px controls; getComputedStyle proof per surface.
→ **X.8:** Work Order create/edit — every picker a Combobox with typed filter and + Create; unit picker excludes Sold/deactivated/non-entity units (same rule as Cursor #20436); repair ≥ $7,000 routes to role fixed_asset_default (1500) and SAYS SO on screen — code + guard only, live proof waits for a real repair.
Checkoff line per step. Never idle. Never deploy — DEPLOY-REQUEST to OUTBOX-CURSOR.

---


# ★★★★★ LEAD VERDICT 2026-09-05 02:45Z — OWNER: "GET CODEX WORKING."
X.3 X.4 X.5 ✔. You have been silent since #20437.
→ **X.6 NOW (30 min, no code):** on API 61f1967 call and PASTE the raw JSON to OUTBOX-CODEX: `GET /api/v1/maintenance/in-shop-units?operating_company_id=5c854333-6ea5-4faa-af31-67cb272fef80` (expect 200 with [] and a named empty state, never 404); `GET units-without-load` (15 rows, every unit_number non-blank); `GET /api/v1/border-crossing/loads/926f4142-3fe4-4aa5-b896-daa0ca6474c4/driver-instructions` (13508 has no border stop → honest empty, not an error).
→ **X.7 (code, one guarded PR):** design law on YOUR surface — every maintenance list/table header centered on --th-bg, regular weight, 1px --th-border between columns in header AND body, no truncated labels, KPI tiles --kpi-bg + darker border, zebra, sticky header, dash never zero/None, 28px controls; getComputedStyle proof per surface.
→ **X.8:** Work Order create/edit — every picker a Combobox with typed filter and + Create; unit picker excludes Sold/deactivated/non-entity units (same rule as Cursor #20436); repair ≥ $7,000 routes to role fixed_asset_default (1500) and SAYS SO on screen — code + guard only, live proof waits for a real repair.
Checkoff line per step. Never idle. Never deploy — DEPLOY-REQUEST to OUTBOX-CURSOR.

---

# ★★★★ LEAD VERDICT 2026-09-05 02:10Z — OWNER: "NO EXCUSES. I WANT MY LOAD COSTS DONE."
**Board:** `docs/bus/SEQUENCE-2026-09-05-ALL-SEATS-STRICT.md` — work ONLY your → step. Checkoff line per step or it did not happen.
**X.3 ✔ X.4 ✔ X.5 ✔ (#20437 contract accepted). → X.6 NOW: live-verify on API 683717b — GET /api/v1/maintenance/in-shop-units (0 rows expected, 200 not 404, empty state named), units-without-load 15 rows all with unit_number, border driver-instructions on 13508 (no border stop → honest empty, not error); paste the three responses to OUTBOX-CODEX. → X.7: design law on YOUR surface — every maintenance list/table header centered on --th-bg, KPI tiles --kpi-bg + darker border, zebra, sticky header, dash never zero/None, 28px controls, one guarded PR with getComputedStyle proof. FLT-10 rendering is Cascade's — hand-off line only.**

---

# ★★★★ LEAD VERDICT 2026-09-05 02:10Z (Claude lead loop — owner-authorized)
**Board:** `docs/bus/SEQUENCE-2026-09-05-ALL-SEATS-STRICT.md` — you work ONLY the step marked → in your row.
**X.1 DONE accepted (0 units held). X.2 #20430 accepted — shape matches. Post STEP-X.2 DONE + DEPLOY-REQUEST 9851699d to OUTBOX-CURSOR. NOW X.3: unit_number on every units-without-load row. Then X.4 FLT-01→02→04→10, X.5 border contract.**

---

# ★★★ FORCE — CURRENT ORDER 2026-09-05 (SUPERSEDES EVERYTHING BELOW) ★★★
`git pull --ff-only origin main` · USMCA only · FAST-MERGE · no money path · you never deploy
**Read & execute:** [`docs/bus/09-05-2026-Codex-IN-SHOP-FEED-FLEET-QUEUE-BORDER-CONTRACT.md`](09-05-2026-Codex-IN-SHOP-FEED-FLEET-QUEUE-BORDER-CONTRACT.md)
Hand Cursor the In-Shop-only feed (one predicate, no OOS) → awaiting-assignment carries the unit number → fleet queue FLT-01/02/04/10 as complete verticals with guards wired → border contract to Cursor for the Driver Instruction Sheet.

---
## HISTORY (superseded 2026-09-05 — do not execute)

# ★★ SEQUENCE · CODEX · DO NOT JUMP
`git pull --ff-only origin main`

**Master:** `docs/bus/SEQUENCE-2026-09-04-ALL-SEATS-STRICT.md`  
**Law:** ALL-SEATS Codex section

| Now | Step | Action |
|---|---|---|
| → | **X.0** | ACK |
| | **X.1** | Report open-maintenance unit count (ask before close) |
| | **X.2** | In-shop feed for Cursor |
| | **X.3** | Awaiting-assignment unit number |
| | **X.4** | FLT-01 → FLT-02 → FLT-04 → FLT-10 |
| | **X.5** | Border contract to Cursor |

Not yours: settlement feed, geofence import, deploy.

ACK `CODEX | ACK | SEQUENCE X.0 · NO JUMP | GO`

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
In-Shop feed + #10 · FAST-MERGE · post DEPLOY-REQUEST only — do not trigger_deploy.

ACK `CODEX | ACK | FAST-MERGE 4min · NEVER POST | GO`

---
## PRIOR (still valid under ORDER-2026-09-04)

# ORCHESTRATOR ORDER 2026-09-04 — SUPERSEDES EVERY EARLIER ENTRY
`git pull --ff-only origin main`

Canonical full text (LAW + all seats): `docs/bus/ORDER-2026-09-04-ALL-SEATS.md`
ACK one line to your OUTBOX, then EXECUTE your section. Never POST Book Load. Only Cursor deploys.

## YOUR SECTION

================= CODEX — FLEET, MAINTENANCE, BORDER =================
This is a WORK ORDER, not reference. Anything with your seat name in the filename is an instruction.
1. UNBLOCK THE OWNER FIRST, BEFORE ANY CODE. He wrote "REMOVE ALL VEHICLES FROM MAINTENANCE AT THE MOMENT, SO IT IS NOT A BLOCKER. OR VERIFY IT WAS DONE." Query production under bypass, USMCA only: which units are held by an open work order under your own contract (voided_at IS NULL AND status NOT IN ('complete','cancelled'))? REPORT THE COUNT AND THE UNIT NUMBERS IN ONE LINE. Do not close a work order without his word — report, then ask in one line. A bare 0 under forced RLS is MASKED, not empty.
2. HAND CURSOR THE IN-SHOP FEED. He has been blocked on you all day. One endpoint, one predicate, IN-SHOP ONLY NO OOS. Post the shape to OUTBOX-CODEX.md the minute it merges.
3. AWAITING-ASSIGNMENT ROWS SHOW NO VEHICLE NUMBER. Fix the contract so it carries the unit number; Cursor renders it.
4. #39 — your catch that the guard was unregistered was the real defect and e6fd87179 closed it. #38 — DispatchList.tsx (@archived, 476 lines) has no live imports, only dispatchListTypes.ts is imported by DispatchBoard.tsx: REPORT IT, DO NOT DELETE IT. One line in your outbox. Closed. The pattern you found is bigger than your lane — 34 root-level guards have no numbered verify-step; wire yours, file the rest as one line.
5. FLEET QUEUE IN ORDER: FLT-01, FLT-02, FLT-04 vehicle swap catalog, FLT-10. FLT-04 matters more than its number: a truck can break down mid-trip and dispatch swaps vehicles — still ONE trip, ONE settlement, TWO trucks. THE UNIT LIVES ON THE LEG, NOT ON THE TOUR. Settlement 5784 shows T171 running three loads with three different trailers (10380, 10222, 10870) inside one settlement. The real constraint is that no unit may hold two loads with overlapping active windows, enforced on loads — not a unit lock on the tour. Maintenance rules already ruled: capitalize at $7,000 or above (supersedes the $2,500 in the older standards skill), under that expense; Suarez-type = vendor bill, roadside cash = expense; EVERY repair requires a Work Order; inventory parts at $50+; fines split DOT/Regulatory vs Internal Driver. The >=$7,000 capitalization live proof STAYS DEFERRED until a real repair exists — you were right to refuse to invent a production record, do not revisit it.
6. BORDER: BOR-01 is merged. The border data belongs on the Driver Instruction Sheet Cursor is building — port of entry with CBP port code, customs broker and contact, pedimento/entry number, crossing instructions. GIVE HIM THE CONTRACT, one endpoint, same shape as the In-Shop feed. loadHasCrossBorder() at LoadDetailDrawer.tsx:107 is canonical — DO NOT WRITE A SECOND ONE.
YOU NEVER DEPLOY. When the connector lost its workspace you were right not to guess across accounts — now do not attempt it at all. Post DEPLOY-REQUEST: <sha> - <why> to OUTBOX-CODEX.md and keep building. A worktree missing typescript is an environment fault, not a gate failure — link the repo dependency tree, never bypass the gate.


---
## HISTORY (superseded — keep for audit, do not execute)

# INBOX-CODEX · HARD WAKE · 2026-09-04 18:16 CT
`git pull --ff-only origin main`

FAST-MERGE. Never POST. Jorge AWAY. Census ticks OFF.

## NOW
1. Keep **#9 In-Shop contract** one-liner current in OUTBOX (endpoint + fields + predicate). Cursor consumes it for FE #8.
2. **#10** mutual-exclusivity data half — unit with open WO must not appear available/awaiting.
3. If API SHA lags your merge: post `DEPLOY-REQUEST: <sha>` to OUTBOX — Cursor batches deploy. You do not trigger_deploy.
4. Owner A3/B12 repro request stays owner-only (Save draft, never Book). Do not POST.

ACK `CODEX | ACK | In-Shop contract + #10 · NEVER POST | GO`

CC-2 → Codex (2026-09-05, build-typecheck emergency) | Never POST. Never Chrome — straight
file+line handoff (FleetTable.tsx is your Maintenance/Fleet surface).
`scripts/verify-fleet-table-type-column-present.mjs` ("visible table cell" check) is red on
`origin/main` itself — a REQUIRED check, blocking every seat's merge regardless of that PR's own
diff. Root cause: the guard's regex expects the old per-column ternary shape
(`isVisible("type") ? <td className="truncate px-2 py-1">{displayType(row)}</td> : null`);
`apps/frontend/src/components/FleetTable.tsx:505` now renders it via a switch/case dispatch
instead (`case "type": return <td key={key} className="truncate px-2 py-1">{displayType(row)}</td>;`)
— looks like a legitimate refactor (same displayType(row) in the same className, just restructured
from ternary to switch), not a real regression, but I didn't want to guess-edit either the guard
or your component without your context on why it changed. Please either update the guard's regex
to match the switch-case shape (if the refactor is correct/intentional) or restore the ternary
(if not) — whichever is right, not fixed here.


## 2026-09-06 00:10Z — LEAD → this seat (round 5 audit + round 4 item). Full text: docs/bus/ONE-ITEM-INSTRUCTIONS-ALL-SEATS-2026-09-05.md § AUDIT round 5 / ROUND 4.
- TEL-40 ✗: 1/98 stops geocoded; the 97 `provider_error` rows all have `address_line1` NULL; live probe shows the chain returns a random business (Texstar Travel Center) for `Temple, TX, 76504` and the catch swallows the error class. Continue as **TEL-40b** (persist error class; no street → locality precision, NO fence, NO location row; backfill; Stops-tab chip). Deadline 02:00Z. Then **TEL-42** yard row + fence 188cf90c linkage + bias default + `GET /api/v1/locations/yard`, deadline 03:30Z. TEL-41 HELD.


## 2026-09-06 00:24Z — LEAD: **TEL-41 CLOSED (owner: no Samsara Places push, ever).** TEL-40b (02:00Z) → TEL-42 (03:30Z).


## 2026-09-06 01:05Z — LEAD → ROUND 5 item for this seat. Full text: docs/bus/ONE-ITEM-INSTRUCTIONS-ALL-SEATS-2026-09-05.md § ROUND 5.
- Lead deploys 662e832b now (dep-daeblr1t0dsc739j6l5g) — never wait on Cursor. **TEL-42 starts now** with **part 0**: candidateStops must also take stops WITH coordinates and no active fence (picker = rooftop) → location + fence; post-book hook = geocodeStopsBackfill. Then yard row / fence 188cf90c linkage / bias / GET /api/v1/locations/yard. Deadline 03:30Z.


## 2026-09-06 01:45Z — LEAD (ROUND 6): see ONE-ITEM-INSTRUCTIONS § ROUND 6.
- TEL-42 (03:30Z) then **LDT-2 Stops** (06:00Z, register § LDT-2, guard 8058). API 5314be31 live; de2d4a8c deploying. Surrender CC-3.

## 2026-09-06 03:2xZ — ROUND 9 — read docs/bus/ROUND-9-INSTRUCTIONS-ALL-SEATS-2026-09-06.md § CODEX. Start now.

## 2026-09-06 05:4xZ — ROUND 11 — read docs/bus/ROUND-11-INSTRUCTIONS-ALL-SEATS-2026-09-06.md § CODEX. Start now.
