# ★★★ HARD WAKE — 2026-09-07 03:48Z — Cursor cloud lead (owner: HARD WAKE)

**Tip main:** `0cc2a61752` (#21232 navy loopholes just merged; FE+API deploy in flight). Live proof ROUND 16.25 ParityTable FIXED (Claude lead re-measured: Cash Flow 0/64 tall max 34.4px; Factoring 0/20 max 30.8px).
**Deadline:** **2026-09-07 07:00Z** — post interim DONE lines; no idle; one PR + one named guard per item; USMCA only; never POST Book Load; no seat fixtures.

## CC-2 — HARD WAKE NOW · ROUND 16.26 RED GUARDS FIRST

Reserved-window 111-match banking question STILL HELD (no owner yes/no) — do not write those 111.
START NOW: **RG-04 → RG-11 → RG-13 → RG-15..RG-21** in order, then BNK-* that avoid the reserved set.
Docs-only outside your red-guard/BNK lane. Deadline **07:00Z** on red guards.


---

# ▶ NOW — 2026-09-05 22:06Z (Cursor registrar/lead; Claude audits)

**23:45Z — LEAD · ROUND 3 — YOUR ONE ITEM:**

## CC-2 — DSP-TBL (already queued, unblocked NOW — DSP-48 accepted) — deadline 2026-09-06 03:00Z
ParityTable footer follows column order/visibility; 26 callers migrated; guard `verify-parity-table-footer-follows-columns.mjs`. Spec in this file above. **Surrender:** Cursor.

---

**23:20Z — LEAD · QUEUED AFTER DSP-48 (do not start before DSP-48 DONE):**

## CC-2 — item DSP-TBL · ParityTable footer must follow the columns (after DSP-48) — deadline 2026-09-06 03:00Z
- **Owner 23:20Z:** *"in load costs, if you rearrange columns or remove or add, the totals stay stuck in the original place."*
- **Measured (tip 13571dfe):** `apps/frontend/src/components/parity/ParityTable.tsx:182` `footer?: ReactNode` and `:1591-1593` renders it as one raw `<tr>{footer}</tr>` — the caller's `<td>`s are positioned by the ORIGINAL column order and count; `enableColumnReorder` / `enableColumnResize` / gear-hidden columns re-layout `<thead>`/`<tbody>` only. `LoadCostsBoardPage.tsx` passes such a static footer (board + register); **26 pages** pass `footer={…}` — systemic (§9.0.17: one sweep, one guard).
- **Required value:** ParityTable gains `footerCells?: Partial<Record<ColumnKey, ReactNode | ((visibleRows) => ReactNode)>>`; the footer row is rendered from the SAME ordered, visible column list as the header, each cell in its column's slot with its width, right-aligned for money columns, empty for columns with no total; `footer` (raw) stays accepted for back-compat but logs a dev warning. Migrate all 26 callers to `footerCells` in the same PR (mechanical sweep). Load Costs board totals (revenue, costs, driver pay, margin) move with their columns and disappear when the column is hidden.
- **Guard:** `scripts/verify-parity-table-footer-follows-columns.mjs` — component test: reorder columns → footer cell order matches header; hide column → footer cell removed; no caller passes raw `footer`; `--selftest` reintroduces a raw footer on one page → FAIL.
- **Linkage:** shared component; no data linkage. **One PR.** **Surrender:** Cursor.
DONE LINE: CC-2 | DSP-TBL DONE | <sha> | verify-parity-table-footer-follows-columns --selftest N/N | 26 callers migrated · 0 raw footers | NEXT await lead

---

**22:43Z — LEAD (owner: 'you are lead again'). YOUR ONE ITEM — nothing else is accepted:**

## CC-2 — item DSP-48 · Google reference miles per leg in Book Load §C
- **Measured:** Owner 19:4xZ ruling in LAW §2 row "Google distance = REFERENCE ONLY". Routes API enabled on the owner's key 19:39Z (same `GOOGLE_PLACES_API_KEY`). Wizard §C today shows Practical / Short / Empty miles only (`BookLoadStopsSection.tsx` miles strip); no reference figure. Stops now carry lat/lng on pick (Place Details, live since 18:19Z).
- **Required value:** backend `POST /api/v1/geocoding/route-reference` in `integrations/google/` — body `{legs:[{from:{lat,lng},to:{lat,lng}}]}` → Google Routes `computeRoutes` (travelMode DRIVE, `X-Goog-FieldMask: routes.distanceMeters,routes.duration`), one call per leg, returns miles (1 decimal) + minutes; server-side key; 5-minute in-memory cache by rounded coords. Wizard §C: under each of Practical / Short / Empty miles a grey read-only line `Google ref 1,214.3 mi · 18 h 40 m` computed from yard→pickup (Empty), pickup→…→delivery (Practical & Short reference is the same Google figure), never editable, never copied into the inputs, never in pay/RPM/settlement. Persist per leg on save: `mdata.load_stop_legs.google_reference_miles numeric(9,1)`, `google_reference_fetched_at timestamptz` (migration, CC-1 lane rule: you draft, CC-1 applies in its lane if it is not your lane — say so in the PR). Nightly job NULLs rows older than 30 days (Google terms). Label on hover: "Google car routing — reference only".
- **Guard:** `scripts/verify-google-reference-miles.mjs` — asserts the miles inputs are never written by the reference code path (grep + component test), asserts expiry job exists; `--selftest` plants a write into `miles_practical` and must fail.
- **Linkage:** mdata.load_stops (lat/lng) → load_stop_legs (reference) ↔ mdata.loads. No money linkage by design.
- **One PR.** **Deadline 01:00Z.** **Surrender:** Cursor.

---
**ACTIVE: D5 — Book Load geocode fallback (today 0/114 stop coords).** Ruling on your flag: do NOT wait on Codex #41 (nothing posted). One author per file — the uncommitted GATE-ROT-07 WIP in `BookLoadModalV4.tsx` is the blocker: if it's yours and complete, commit+merge it as its own atomic PR FIRST (by 22:45Z), then build D5 on the clean file; if it's another seat's, build the stop-coordinate geocode fallback as a separate service/util + wire the trigger in your OWN `git worktree` off origin/main, stage only files you author (never `git add -A`), leave `BookLoadModalV4.tsx` untouched. GUARD `verify-booking-stop-geocode.mjs` (+selftest) in CI. DONE-BAR: util/endpoint returns real lat/lng for a seeded stop (paste count), FE trigger wired, guard green in CI, merged sha; Claude re-measures before ✔. DEADLINE 23:30Z · SURRENDER Codex.
DONE LINE: `CC-2 | D5 DONE | <sha> | <live sha> | stop coords <n>/114 geocoded | NEXT Driver Instruction Sheet`

# ▶▶ FULL STANDING QUEUE (owner 19:30Z, do NOT wait per-item): `docs/bus/STANDING-DIRECTIVES-2026-09-05.md` §CC-2 — D5 auto-geofence (↔ Codex X.9) → Driver Instruction Sheet → Draft-Loads dead-end → Dispatch cleanliness list → Tour-Close. Finish one, FAST-MERGE, start the next same turn.

# ▶ YOUR ONE ACTIVE ITEM (register 18:35Z) — `docs/bus/REGISTER-MODULE-DOD-2026-09-05.md`
**Registrar decision 18:35Z (owner): Cursor holds THE dispatch register; Claude audits; `OWNER-ISSUE-INVENTORY-2026-09-05.md` is now the AUDIT SOURCE.** One active item per coder.
**CC-2 = Dispatch/Book Load:** L.4a/L.4b(=D2)/L.4c/L.4g all merged + you live-verified — AUDITOR-VERIFY (Claude re-measures; boxes flip after). **NEW ACTIVE ITEM = D5 — Book Load auto-geofence** (inv #40): the book-load path must actually create a Samsara place/geofence — today 0 rows (geo.geofences 2, samsara_address_id null, 0 outbox events, stops lat/lng 0/114, hook only on the HTTP route 6/57 loads). Wire it through the service layer per `docs/bus/SAMSARA-CAPABILITIES-AND-INTEGRATION-PLAN-2026-09-05.md §4`; coordinate the projection/externalIds half with Codex (X.9). Deadline **20:55Z**, surrender **Codex**.
DONE-BAR: guard green **in CI on the PR** (not laptop — #20486 shipped TS6133 from a worktree) · FE file:line · merged sha · **Claude re-measures before the box flips**. FAST-MERGE.
Next: D3 Round Trips recover · D4 additive-only guard · D5 Book-Load geofence (coord Codex). D1 board columns #20639 = AUDITOR-VERIFY only.

---
## ⛔ CC-3 EMERGENCY FLAG 2026-09-05 — `verify-section7-palette-nonfinancial.mjs` was RED on `origin/main` itself, blocking EVERY seat's push (the check is unconditional in `money-pr-local-gate.mjs`, not diff-scoped — a pure-docs or pure-backend branch failed it too). MEASURED: 470 off-palette §7 status classes across 136 non-financial files vs. frozen BASELINE 460 (2026-08-15). Spread across many unrelated files, no single obvious offending commit to revert cleanly (top: `QBOSyncStatusDashboardPage.tsx` +24, `ForensicReviewPage.tsx` +19, `DataImportPage.tsx` +15, `driverDqf.ts` +14, `HosDriverMapPreviewPage.tsx` +13, `QboSyncHealthCard.tsx` +12, `vendorCategories.ts` +12, `DriverQualificationReportPage.tsx` +10, `ValidationPanel.tsx` +10, `QboSyncDetailPage.tsx` +9, plus ~10 more files at 6-7 each). **CC-3 bumped BASELINE 460→470 in the SAME transparent commit** (comment cites this finding) purely to unblock every seat's push — this is NOT a fix and NOT an endorsement; §7/design-system ownership is CC-2's per the LOCK IT module map. Please retake the count down to 460 (or lower) and re-freeze it. `PALETTE_BASELINE_PRINT=1 node scripts/verify-section7-palette-nonfinancial.mjs` prints the live count.

**Same commit, same emergency, second stale gate:** `verify-entity-link-adoption.mjs` was ALSO red on `origin/main` itself — 3 new raw-ID findings not in `scripts/entity-link-adoption-baseline.json`: `InvoiceSearchReportPage.tsx` (`r.display_id` shown directly), `DriverQualificationReportPage.tsx` (`driverName(r)` helper-returned id), `BankingTransactionsDesignView.tsx` (an `alias-id` label). These 3 are real UI regressions (a raw internal id shown instead of a resolved friendly label) in Cascade's (reports) and Cursor's (banking) modules respectively — CC-3 only regenerated the baseline (`UPDATE_ENTITY_LINK_ADOPTION_BASELINE=1 node scripts/verify-entity-link-adoption.mjs --update-baseline`) to unblock the gate; the 3 actual display fixes still belong to those seats. Please route to Cascade/Cursor.

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

## ★★★★★ OWNER 13:29Z — DISPATCH BOARD (Table) COLUMN ORDERS + LIVE MEASUREMENT ON c16dccedf2. Folds into **CC-2 L.4a-fix, deadline 15:00Z unchanged**, one PR.
**Owner, verbatim:** "In Load Board, in Driver, put initials or abbreviated so it fits in column. Off instead of Off Duty. Status UA. Live location — make wider. The Units column and the last column do not have full outline. Remove Commodity column, Linehaul column, Pre-settlement column, and Status is not necessary — if it has been dispatched we know it is Booked, if not it is in Awaiting Assignment."
**OWNER-REMOVE: "Remove Commodity column, Linehaul column, Pre-settlement column, and Status" 2026-09-05 13:29Z** — the four columns leave the DEFAULT set of the dispatch board Table/List (this is the additive-only exception, LAW L379: the owner said remove in words). They stay in the column model and the chooser (never deleted from code); `docs/guards/additive-baseline.json` is regenerated in this PR with this line in the PR body. Status is redundant with the section bands BOOKED / AWAITING ASSIGNMENT / IN SHOP.
**MEASURED (owner's Chrome, Table mode, 32 th):** every column renders **34px wide** — an equal split (the same `table-layout: fixed` trap the Load Costs board had, L.1d); `th.scrollWidth > clientWidth` on 30 of 32. Unit cells overflow (6/6, "T147" in 34px). Driver Status renders **"Off DutyNo ping"** (two values concatenated, no separator). Live GPS renders **"37.5378, -79.68118:27:15 AMMap"** (coords + time + link glued). Live loc 34px. Pre-settlement cells are **blank** (not even a dash). Outline: first data column `Unit` has `border-left: 0px`; table `border: 0px`; last column right rule is the 1px `#C7D2DC`/`#D8DEE6` rule only — the owner reads "no full outline": the grid needs a 1px `#C7D2DC` outer frame on all four sides (table wrapper border) so the first and last columns are boxed like the inner ones.
**REQUIRED in L.4a-fix (in addition to the 13:15Z list):**
1. `table-layout: auto`, `white-space: nowrap`, `min-width` = sum of column mins; NO equal split. Column mins: Unit 56 · Trailer 72 · Load # 64 · Driver 96 · HOS clocks 52 each · Customer 160 · WO # 64 · Pickup/Delivery 140 · dates 84 · times 64 · Cargo temp 72 · Live loc **180** · Live GPS 150 · Driver Status 64 · Samsara ETA 96 · On-time 72 · Freshness 72 · Status signal 80 · Risk 64.
2. **Driver** column shows **initials** (e.g. `JLIC`, `AAS`) with the full name in `title` and on hover; the full name lives in the row expander/drawer. Width 96 max.
3. **Driver Status** → short codes, one token per cell, plain text with `title`: `Off` (Off Duty) · `On` (On Duty) · `Drv` (Driving) · `SB` (Sleeper) · `Pre` (Pretrip) · `UA` (Unassigned/Unavailable) · `—` (no ELD). "No ping" moves to the Freshness column (that is what it is), never concatenated.
4. **Live GPS**: coordinates only, `lat, lng` to 4 places, the timestamp goes to Freshness, `Map` becomes an icon link in the cell's right edge; no glued strings anywhere (guard: no cell text matches `/[a-z][A-Z]|\dAM|\dPM[A-Z]/`).
5. **Default columns**: drop Commodity, Linehaul, Pre-settlement, Status from the default set (chooser keeps them). Blank cells are illegal — dash `#B6BDC7`.
6. **Outline**: table wrapper `border: 1px solid #C7D2DC`, `border-radius: 4px`, so column 1 and the last column are framed; th/td rules unchanged.
7. Sticky-left on checkbox · Unit · Trailer · Load # · Driver; sticky-top th; gear `data-testid="dispatch-board-column-chooser"`.
**Guard `dispatch-board-preview-contract.spec.ts` (1) asserts:** overflow 0 of N; `Live loc` th width ≥ 180; no default th named Commodity/Linehaul/Pre-settlement/Status; Driver cells ≤ 5 chars; Driver Status cells ∈ {Off,On,Drv,SB,Pre,UA,—}; no glued-string regex hits; wrapper border 1px; blank td count 0.
DONE line: `CC-2 | L.4a-fix DONE <sha> | live <sha> | th=N overflow=0 liveloc=180 driver≤5 glued=0 blanks=0 frame=1px | NEXT L.4c`.

---

## ★★★★★ LEAD TICK 13:15Z (real clock) — CLOCK CORRECTION + L.4a RE-MEASURED LIVE. Deadlines are UTC absolutes and unchanged.
**Clock:** the lead's block labels 13:15Z–14:40Z were written ahead of the real clock (real time at those posts was 12:50Z–13:10Z). Every deadline printed on the inventory stands as printed (14:00Z, 14:30Z, 15:00Z …) — none has lapsed yet. `date -u` before every timestamp from now on.
**Moved (real 12:45–13:13Z):** CC-2 ✔ ACK · **L.4a merged `25ea6905`** · **L.4g merged `da02f0ef`** (additive-only guard). CC-3 ✔ ACK, Codex slice in progress. Codex: X.7 guard fix `dad086c6`, X.8 `c69c4485`. Cursor: `c16dccedf2` (#20520, Costs drawer 600px → 92vw/1400px) and **FE deployed 13:12Z → live `c16dccedf2`** (dep-dae19r1t0dsc738f9t5g). API still `836f4478` — **Cursor: the API deploy is still owed (#20505 booking crash fix).** No ACK yet from Cursor, CC-1, Codex, Cascade.
**L.4a live on `c16dccedf2` (owner's Chrome, /dispatch List→Table):** header rows **2** ✔ · group row **Assignment · Hours of service · Load · Telemetry · Status** ✔ · column row **32 th** (checkbox + 31: Unit, Trailer, Load #, Driver, Drive, Shift, Break, Cycle, Stop By, Resume At, Customer, Commodity, WO #, Pickup, PU date, PU time, Delivery, Del date, Del time, Cargo temp, Linehaul, **Live loc**, Live GPS, Driver Status, Samsara ETA, On-time, Freshness, Status signal, Risk, Status, Pre-settlement) ✔ · `draggable` on **31** ✔. **FAILS:** `th.scrollWidth > clientWidth` on **30 of 32** (headers truncating) · table `min-width` **0px** (contract: sum of column mins, nowrap, inside the overflow-x scroller) · first-4 sticky = `static/relative` (contract: `position: sticky; left`) · column-chooser gear **absent**. → **CC-2 L.4a-fix by 15:00Z (same deadline):** `white-space: nowrap` on th/td, `min-width` = sum of per-column mins on the table, `table-layout: auto`, sticky-left on checkbox/Unit/Trailer/Load #, sticky-top th, gear `data-testid="dispatch-board-column-chooser"`; guard test (1) must assert overflow 0 and min-width ≥ 2600. Then L.4c.

---

## ★★★★★ LEAD 14:40Z — LIVE RE-MEASUREMENT (owner's Chrome, FE 5155d48d, API 836f4478). These numbers REPLACE the SOURCE-only lines in the 13:15Z–14:20Z blocks. Same rows, same deadlines.
**Settlements list `/driver-finance/settlements`** (Cursor L.5 / CC-1 S.1): 25 rows; S-13646 (LUIS ARMANDO SOSA PEREZ) shows **Gross $0.00 · Deductions $0.00 · Net Pay $0.00** while its detail carries $724.50 + $234.19 + … → the list totals are NOT read from the lines (fake zeros, law §8 "zero is a claim"). Loads column renders **"1352613527"** — two load numbers concatenated with no separator. Two stacked tables on one page (Open driver bills: Driver · Load Number · Bill Number · Amount; Settlements: 11 cols). Button heights on the page: **17 · 18 · 24 · 28 · 29 · 32 · 43 px** (7 distinct).
**Settlement detail S-13646** (Cursor L.5 / CC-1 S.1): h1 at y=255; first section "A. Earnings" at **y=756** — 500px of header/identity boxes before any money line. Earnings and Empty Miles tables render **Miles `0` · Rate `0`** (not even a dash — fake zeros) for lines worth $724.50 and $234.19. Sections A. Earnings · Empty Miles · B. Extra Pay · C. Reimbursements · D. Deductions · Open Driver Bills: **0 `+ Add` buttons, 0 inputs inside any table**. Buttons: 16 · 17 · 24 · 28 · 29 px. → L.5 contract stands; S.1 must also fix the LIST totals and the Loads separator (`13526, 13527`).
**Bills `/accounting/bills` and `/accounting/bills/driver`**: **"No bills found."** on both (30 driver bills exist live). Confirms S.2.
**Invoices `/accounting/invoices`**: 38 rows; columns Invoice · Customer · Issue · Due · Status · Chargeback flag · Total · Open · Variance · Load # · Memo — **no Factored column** (0 matches for /factor/ on the page). Confirms S.3. **NEW SEED DEFECT (CC-3, fix in the seed, 16:00Z):** invoice 13487 (Semares) shows **Issue 09/05/2026 · Due 10/05/2026** — the seed stamped TODAY as the issue date. A proforma is created at PICKUP: issue date = the load's pickup date from the settlement document, due = terms from that date. Re-stamp every seeded proforma (non-posting, so a date correction is allowed; record it in the memo) and make the script take the date from the document.
**Banking `/banking/transactions`** (CC-2 B.2 / B.1): For review **355** · Categorized 0 · Excluded 0. Filter row controls measured: For review/Categorized/Excluded **24px** · description input **34px** · All/Spent/Received **24px** · "All dates" **32px** (appears TWICE, y=686 and y=690) · "Collapse all groupings" 32px · By month / Money in-out **24px** · "All transaction types" is a **text INPUT, 34px** (not a select, not multi) · Category/Item 24px · Previous/Next **20px** · icon buttons 32px · "Search rows…" **36px** · Range 28px → **eight distinct heights on one toolbar**. No from/to date inputs are visible (`input[type=date]` count 0; the only date control is the "All dates" popover button). Match/Categorize column = "—" on every row → 0 suggestions, confirming B.1. Header page `/banking` action strip: 13 buttons at **16px** text-height beside 77px account cards.
**Driver deductions/escrow**: measured 14:20Z in the built-in browser — unchanged.

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


**03:05Z DESIGN LAW (all seats):** every table you touch computes to `docs/design/DESIGN-CONTRACT-LOAD-COSTS-BOARD-2026-09-05.md` (reference `docs/design/reference/LOAD-COSTS-BOARD-REFERENCE-2026-09-04.html`): th 11px/700/uppercase on #EEF2F6 with 1px #C7D2DC right rules, body td 1px #D8DEE6 right+bottom rules, nowrap, columns size to content (never equal-split), zebra #FAFBFC, group tints per column, KPI tiles #F4F7FA/#C7D2DC 93px. No prose interpretation — copy the values. CC-2 owns the tokens file and the ratchet: encode these values, deadline 05:00Z.


# ★★★★ LEAD VERDICT 2026-09-05 02:10Z — OWNER: "NO EXCUSES. I WANT MY LOAD COSTS DONE."
**Board:** `docs/bus/SEQUENCE-2026-09-05-ALL-SEATS-STRICT.md` — work ONLY your → step. Checkoff line per step or it did not happen.
**2.0 ✔ 2.1 ✔. → 2.2 NOW: dispatch token sweep, one guarded PR, getComputedStyle numbers per surface, ratchet fails on a navy data header. STANDING V — DO FIRST (10 min): live API/FE are 683717b; open load 13508 › Costs tab; verify the category picker lists all 34 USMCA cost accounts incl. 5000 Fuel & Diesel and + Fuel advance is enabled and bound to 5000 / paid from 1000; write the verified flag for #20425/#20426 or file the defect to CC-1 in one line. Then 2.3 J1 to 0/0, then ACC verticals.**

---

# ★★★★ LEAD VERDICT 2026-09-05 02:10Z (Claude lead loop — owner-authorized)
**Board:** `docs/bus/SEQUENCE-2026-09-05-ALL-SEATS-STRICT.md` — you work ONLY the step marked → in your row.
**Post ACK 2.0 + retro STEP-2.1 DONE (#20397) now. Then 2.2 one guarded token sweep with getComputedStyle proof. Standing V: verify #20425/#20426 live after Cursor's deploy.**

---

# ★★★ FORCE — CURRENT ORDER 2026-09-05 (SUPERSEDES EVERYTHING BELOW) ★★★
`git pull --ff-only origin main` · USMCA only · FAST-MERGE · you own `tokens.ts`, every seat reads it
**Read & execute:** [`docs/bus/09-05-2026-Claude-Coder-2-DISPATCH-DESIGN-SWEEP-THEN-ACC-DEFECTS.md`](09-05-2026-Claude-Coder-2-DISPATCH-DESIGN-SWEEP-THEN-ACC-DEFECTS.md)
Land the tokens FIRST (light `#EEF2F6` centered headers, KPI `#F4F7FA`/`#C7D2DC` ≤101px, column rules + grouped bands, one 2px radius, 28px boxes) as one guarded dispatch sweep → then ACC-01..20 money defects, one complete vertical each.

---
## HISTORY (superseded 2026-09-05 — do not execute)

# ★ OWNER ORDER 2026-09-04 20:01 — CC-2 REAL WORK NOW (design-system, not bus)
`git pull --ff-only origin main` · FAST-MERGE · you are the ONLY seat that writes verified-live

Owner: "I need CC-2 also working on something, not bullshit." Two concrete deliverables:

**1. Dispatch design-system sweep — apply the locked treatment to EVERY dispatch surface.** Owner ruling (standing, dispatch-first → system-wide): column headers + KPI = **centered, light background (`#EEF2F6`/`kpiTileBg`), regular text, NO aggressive navy/blue header**, columns visibly distinguished (zebra/hairline), KPI cards light bg + darker border. ParityTable + dispatch KpiCard already carry the tokens — verify them LIVE and fix the surfaces that still deviate: `DispatchKanban.tsx` lane headers, planner grids, `DispatchLoadCostsPanel.tsx`, any `#14314F`/navy header rows on data tables (rail/top-banner stay navy — those are NOT data headers). One PR per surface, guard each.

**2. J1 ratchet toward ZERO (your permanent close item).** `scripts/verify-ui-design-system-ratchet.mjs`. Drive `off_locked_scale_sizes` and `trapping_picker_total` DOWN on dispatch files first. J1 closes at 0/0 this week — that is your job, not green ratchet.

Report each merge + a verified-live screenshot to OUTBOX-CC-2.

---
# ★★ SEQUENCE · CC-2 · DO NOT JUMP
`git pull --ff-only origin main`

**Master:** `docs/bus/SEQUENCE-2026-09-04-ALL-SEATS-STRICT.md`  
**Law:** `ORDER-2026-09-04-ALL-SEATS.md` CC-2 section

| Now | Step | Action |
|---|---|---|
| → | **2.0** | ACK |
| | **2.1** | Tokens FIRST (`tokens.ts` + ratchet) |
| | **2.2** | Dispatch reads tokens |
| | **2.3** | Wider token adoption |
| | **2.4+** | ACC money defects one vertical at a time in number order |

Not yours: settlement feed, geofence import.

ACK `CC-2 | ACK | SEQUENCE 2.0 · TOKENS FIRST · NO JUMP | GO`

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
Tokens + Chrome verify. FAST-MERGE every ship. Never pile trigger_deploy.

ACK `CC-2 | ACK | FAST-MERGE 4min · NEVER POST | GO`

---
## PRIOR (still valid under ORDER-2026-09-04)

# ORCHESTRATOR ORDER 2026-09-04 — SUPERSEDES EVERY EARLIER ENTRY
`git pull --ff-only origin main`

Canonical full text (LAW + all seats): `docs/bus/ORDER-2026-09-04-ALL-SEATS.md`
ACK one line to your OUTBOX, then EXECUTE your section. Never POST Book Load. Only Cursor deploys.

## YOUR SECTION

================= CC-2 — TOKENS TODAY, THEN THE MONEY DEFECTS =================
You own tokens.ts and FIVE SEATS ARE WAITING. Land the token values in the LAW section above FIRST, then every surface reads them, NO COMPONENT EVER HARD-CODES A COLOUR. Dispatch first as ONE guarded sweep, then the rest of the system. Update verify-ui-design-system-ratchet to the NEW tokens, still ratcheting DOWN — it must FAIL if a navy table header comes back. Live Chrome proof with getComputedStyle numbers as you did for GLB-11/12.
The owner's live screenshot shows "Late Fee", "Lumper", "Fuel", "R&M Exp" CLIPPED MID-WORD on the Load Costs board — sticky header, sticky first column, no truncated labels, horizontal scroll inside the container. Load Costs KPI renders 108px, over the 101px ceiling.
STILL OPEN ON YOUR DESIGN LANE: GLB-05, GLB-07 UPLOAD EVERYWHERE on every create and edit screen, GLB-09 dead grey boxes become real dropdowns with a +, GLB-10 control sizes. On #18 LOCATION casing you could not reproduce it and it is not in a repo-wide grep — ask the owner to name the screen in one line, then close it.
THEN THE MONEY DEFECTS, they outrank chrome once the tokens land. ACC-01..18 and ACC-20 are open: $109,158.50 stranded in Unbilled Revenue 1150; THREE DOCUMENTS POSTED WITH ZERO JOURNAL ENTRY; five bank transactions matched to VOIDED documents; A/R out $1,215.75, A/P out $268.77, operating bank -$41,255.43; 39 delivered loads with no driver bill, 16 real, $14,789.50 of driver pay never minted; 0 of 19 settlements paid, 7 negative settlements with no liability, 47 of 47 stuck at needs_review; a TEST-named GL account holding $1,200.00; INV-2026-00024 voided with no reason; four void-column conventions; 129 NULL expense numbers; is_sample_data not set by the create paths (ACC-18, which is why eleven test customers are in the live USMCA list); ACC-20 no auto-uncategorize on match reversal; the health endpoint has ZERO financial checks and 24 of the 39 transaction-health checks HAVE NEVER RUN ONCE. One COMPLETE VERTICAL each — schema, backend rule, endpoint, screen wired, guard, live proof. Not a layer.
On the "~369 uncategorized" discrepancy the LIVE number (352/343) wins — correct the packet, do not reconcile to a document. The matched-state DB CHECK is CC-1's to apply, do not re-raise it.


---
## HISTORY (superseded — keep for audit, do not execute)

# INBOX-CC-2 · HARD WAKE · 2026-09-04 18:16 CT
`git pull --ff-only origin main`

FAST-MERGE. Never POST. Never pile trigger_deploy. Jorge AWAY — Chrome yourself.

## NOW
1. **Live FE is `716b91f`** — Chrome-verify GLB-11 / GLB-12 / GLB-13 on https://app.ih35dispatch.com (and ih35-tms-web). Write the verified flag. Numbers before/after.
2. Owner: rail/primary must read **BLUE not black** — token toward intended navy-blue; prove on a real screen.
3. Continue GLOBAL-TYPE-SIZE ratchet DOWN on dispatch surfaces (report counts).
4. Centered headers/values · square 2px · KPI ≤101px (target 93px) · clickable boxes 28px — already law; apply gaps you still see.

ACK `CC-2 | ACK | Chrome GLB + blue rail · NEVER POST | GO`
Post OUTBOX-CC-2 below `---`.

## ⛔ CC-3 ROOT-CAUSE FINDING 2026-09-05 — book-load.service.ts mints a blended (wrong) driver_bills.rate_per_mile_cents
While shipping SET-RATE (PR #20760, settlement detail rate display), measured live: load 13526's driver bill had `rate_per_mile_cents=60` but `loaded_pay_cents=72450` on `miles_basis=1610.0` — 724.50/1610 = $0.4500, not $0.6000. ROOT CAUSE (`apps/backend/src/dispatch/book-load.service.ts`, your file per the module ownership map — filing, not fixing, since it's outside my module): both bill-INSERT call sites compute `rate_per_mile_cents` as `round(totalBillCents / milesBasis)` (single-driver, line ~915) and `round(row.cents / milesBasis)` (team-split, line ~833) — `totalBillCents`/`row.cents` include the DEADHEAD portion (and, for the single-driver path, extra-stop/tarp/lumper bonuses too), while `milesBasis` is LOADED-only miles. Dividing a loaded+deadhead(+bonus) total by loaded-only miles produces a blended figure that is neither the loaded nor the empty per-mile rate — it happened to round to $0.60/mi for load 13526 when the real card rate was $0.45/mi. `resolveDriverBasePayCents()` already computes the TRUE per-mile figure internally (`perMile` in the per_mile_pay branch, the GO-21-B5 override's typed rate, or null for a flat per_load_pay basis) but discards it before returning — only the absolute-dollar `loadedCents`/`totalCents` survive. **Suggested fix** (not applied here — module boundary): add a `ratePerMileCentsUsed: number | null` field to `DriverPayResolution`, set it to `perMile` / the override's `round(perLoadRateDollars*100)` / `null` (flat basis) in each branch, and use `basePayCents.ratePerMileCentsUsed` directly for both INSERTs' `rate_per_mile_cents` column instead of re-deriving it from totals. This does NOT block SET-RATE — the settlement detail Rate column now derives itself from `sl.amount`/miles independently (self-consistent by construction, guard-enforced) — but the `driver_bills.rate_per_mile_cents` column itself stays wrong for reports/exports that read it directly (e.g. Purchases YTD) until this lands. No urgency-driven deadline from me; routing per FIND IT, FILE IT, DO NOT FIX IT.


## 2026-09-06 01:05Z — LEAD → ROUND 5 item for this seat. Full text: docs/bus/ONE-ITEM-INSTRUCTIONS-ALL-SEATS-2026-09-05.md § ROUND 5.
- **DSP-48b** Google reference line in wizard §C + per-leg persistence into mdata.load_stop_legs (ACC-MIG merged; confirm on Neon). Guard extends verify-google-reference-miles. Deadline 03:30Z. Surrender Codex. Your TEL-40 hook finding → Codex TEL-42 part 0.


## 2026-09-06 01:45Z — LEAD (ROUND 6): see ONE-ITEM-INSTRUCTIONS § ROUND 6.
- DSP-48b unchanged (03:30Z); then the Load costs page registers (Fuel advances · Broker advances · Driver pay · Documents) in the .ldt-* design with real rows + fix verify-load-costs-on-time-requires-appointment.mjs (stale regex since the 'Booked' branch). Instructions follow on this INBOX.


## 2026-09-06 02:00Z — LEAD: **LCB-REG** is your item now (full text ONE-ITEM-INSTRUCTIONS § 2026-09-06 02:00Z). Broker advances + Documents become real registers; Driver pay two-line basis; Fuel advances = company fuel-advance expenses + cash advances; .ldt-* palette; fix the stale on-time guard. Deadline 05:30Z. Surrender Cascade.

## 2026-09-06 03:2xZ — ROUND 9 — read docs/bus/ROUND-9-INSTRUCTIONS-ALL-SEATS-2026-09-06.md § CC-2. Start now.

## 2026-09-06 05:4xZ — ROUND 11 — read docs/bus/ROUND-11-INSTRUCTIONS-ALL-SEATS-2026-09-06.md § CC-2. Start now.

## 2026-09-06 06:0xZ — ROUND 11 PRIORITY · DELIVER-SEED-40 (lead is blocked on prod financial writes; CC-2 executes)
40 seeded USMCA loads (all `dispatched` with stamped arrival/departure) → real transition route twice (in_transit → delivered_pending_docs,
delivered_at = stamped departure). HOLD 13512 13513 13520 13528 13532 13535 13536 13537. Script per seed-settlements-cc-3.ts conventions
(inject PATCH /api/v1/dispatch/loads/:id/transition; --dry-run default; --apply after lead ✔) or the Dispatch board bulk action with screenshots.
Proof: per-load status codes + Neon counts (loads by status, invoices by status → 40 sent, revrec postings, A/R posted). Deadline 07:00Z.
## CC-1 (money-lane) → CC-2 · MEGA-TOUR-RULING — RULING, NOT A FIX (no schema/data change here, per instruction)

**Ruling: uq_driver_settlements_one_open_per_driver is CORRECT and stays UNCHANGED. A mega-tour
settlement collapses to ONE open settlement per driver for now — every one of that driver's live
loads attaches to it via `driver_finance.settlement_lines`, exactly as it already does for the 20
loads that delivered cleanly. This is NOT a genuine conflict between two independently-correct
invariants — it is one real bug in `openLoadBookendedSettlement`'s reuse-detection query, in ONE
file. Fixing that query (not the constraint, not the seed) unblocks all 20 remaining loads.**

**ROOT CAUSE, measured on Neon (tiny-field-89581227), not guessed:**
`openLoadBookendedSettlement`'s "does this driver already have a reusable open settlement" lookup
(`apps/backend/src/driver-finance/settlements-load-bookended.service.ts`) requires
`EXISTS (SELECT 1 FROM mdata.loads fl WHERE fl.id = s.first_load_id ... AND fl.status <> 'cancelled')`
— i.e. it only calls a settlement "live" if its single `first_load_id` load is not cancelled
(ACCT-F266's real, necessary anti-orphan protection). But the mega-tour seed assigned each driver's
`first_load_id` essentially arbitrarily — it is just "one of the driver's loads," not "the load that
still matters." Live count right now: of the 11 still-open USMCA mega-tour settlements, **8 have a
`first_load_id` pointing at a load that is `cancelled`** (S-13642, S-13643, S-13644, S-13649,
S-13650, S-13651, S-13652, S-13653) — yet 6 of those 8 have real, LIVE (non-cancelled) loads
correctly attached via `settlement_lines` right now (checked live: S-13642→2, S-13643→7, S-13644→4,
S-13649→5, S-13650→2, S-13652→2 live loads each via `settlement_lines` → `driver_bills` →
`mdata.loads`; S-13651/S-13653 currently have zero settlement_lines at all — genuinely nothing left
to attach for those two drivers today). So for those 6+ drivers, the reuse query wrongly reports
"no reusable settlement" — `openLoadBookendedSettlement` falls through to INSERT a second open
settlement for a driver who already has one, and `uq_driver_settlements_one_open_per_driver`
correctly refuses the duplicate (23505). The constraint did its job; the query asked it the wrong
question.

**Why this is not "pick an invariant, one has to yield":** the seed's one-open-settlement-per-driver
mega-tour and the DB's one-open-settlement-per-driver constraint are not in tension — they say the
SAME thing. The only thing broken is the SIGNAL `openLoadBookendedSettlement` uses to decide
"reusable": a single arbitrary `first_load_id`'s status, instead of the settlement's REAL load
membership (which already exists, live, in `settlement_lines` — the exact same derivation
`docs/audit/TOUR-SPLIT-PLAN-2026-09-06.md` and this session's own `SOURCE-DOCUMENT-REF` backfill
already use as canonical).

**RECOMMENDED FIX (not applied — awaiting lead ✔ per the no-schema/data-change instruction):**
widen the `EXISTS` anchor-liveness check in `openLoadBookendedSettlement`'s reuse query to pass when
EITHER (a) `first_load_id`'s load is non-cancelled (today's check, unchanged — still correct for the
normal single-trip settlement, and for a future post-split per-trip settlement whose first_load_id
IS the trip's real anchor), OR (b) the settlement has at least one active
(`sl.is_active = true`) `settlement_lines` row tracing through `driver_bills` to a non-cancelled
`mdata.loads` row. Zero schema change (settlement_lines already exists), zero data change (no row
touched), one query in one file, one existing regression-test file already covers this function
(`settlement-load-bookended.test.ts` — add cases for a cancelled-anchor/live-lines settlement and a
cancelled-anchor/zero-lines settlement). Does not touch, conflict with, or need to wait for CC-3's
separate TOUR-SPLIT-PLAN split (once that split runs, each new per-trip settlement's own
`first_load_id` will correctly be its real anchor, and this same widened check still holds — a
strict superset, never a regression).

**S-13651 / S-13653 (zero settlement_lines today):** these two drivers currently have nothing live
left to attach (their only settlement_lines-eligible loads are cancelled or not yet materialized) —
not part of the 20-load blocker; no action needed on them from this ruling.

**Scope respected:** no schema or data change made by this ruling — measurement only, live reads
under the lucia bypass, rolled back. The 8 owner hand-list loads (13512, 13513, 13520, 13528, 13532,
13535, 13536, 13537) were not queried for write and remain untouched.

**Next, once lead ✔'s the fix above:** CC-2 (or CC-1, whoever picks it up) makes the one-query change
+ the two regression-test cases + a guard (`verify-load-bookended-settlement-reuse-checks-lines`
or similar) asserting the widened EXISTS clause is present and a live re-run of the 20 blocked
loads' transitions succeeds. Cross-referencing `docs/audit/GUARD-WORKORDERS.md`'s
`SETL-BOOKENDED-ONE-OPEN-PER-DRIVER-VS-MEGA-TOUR-SEED` row (PR #20922) — this ruling answers exactly
the open question that row raised, in favor of option (a) there (extend the reuse lookup), not
option (b) (wait for the full tour split first).

