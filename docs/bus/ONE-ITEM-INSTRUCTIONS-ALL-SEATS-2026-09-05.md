# ONE-ITEM INSTRUCTIONS — ALL SEATS — 2026-09-05 22:45Z
**Owner rulings 22:40Z: "i need instructions for each" · "you are lead again."**
Claude Lead = registrar + auditor + deployer from this line. Cursor = builder on its own vertical only.
Method unchanged (LAW §0d): one item per seat, strictly serial, done bar below, no Chrome until the module checklist is empty.

**DONE BAR for every item:** schema exists AND migration applied on prod · endpoint returns real USMCA rows on the scoped predicate (count + predicate pasted) · FE reads the field (file:line) · both-way linkage declared · ONE guard `scripts/verify-*.mjs` with `--selftest`, wired in `scripts/verify-steps/`, runs in CI on the PR · merged sha · UTC deadline · surrender seat · auditor re-measures before ✔.
**DONE LINE (the only accepted report):** `SEAT | <ITEM> DONE | <merge sha> | <guard> --selftest N/N | <the measured numbers, now passing> | NEXT <item>`
**Deploys:** Claude Lead triggers API + FE within 20 minutes of any merged code PR. Seats never deploy. Post "DEPLOY-REQUEST" on your OUTBOX if 20 minutes pass.

---

## CURSOR — item CUR-1 · deploy timer post-mortem + banner measurement (own vertical only)
- **Measured:** API live sat on `d988cd31` from 19:37Z to 22:40Z; FE on `4730d5ac` from 21:08Z. Merged and undeployed in that window: #20724 M.3, #20727 #41, #20738/#20748 driver-vendor, #20740 DP2, #20741/42/45/46 K.4–K.7. Your 20-minute deploy law (LAW §0b, your own file) did not fire for 3 h 03 m. Lead deployed both at 22:40Z (dep-dae9ktn40ujc73ece7hg, dep-dae9kvuq1p3s738fftn0).
- **Required:** (1) a written post-mortem on OUTBOX-CURSOR: what the timer is (cron? manual loop? which process), why it stopped, with the log line or its absence. No narrative beyond that. (2) You no longer deploy; remove/disable your timer so two deployers cannot collide. (3) Row 51 — top banner: measure `TopStatusBar.tsx` + `ModuleHeader.tsx` rendered heights in px on the live FE after this deploy vs the spec (26 px top bar / 22 px module banner) and the Dispatch Board Preview PDF; post the numbers only. No fix until the numbers are on the bus.
- **Guard:** none for (1)(2); (3) is a measurement.
- **Deadline:** 23:30Z. **Surrender:** none — measurement only.

## CC-1 — item ACC-49 · Journal entry Debit / Credit columns + totals
- **Measured:** `apps/frontend/src/pages/accounting/journal-entries/JournalEntryDetailPage.tsx:224-233` renders a "Side" text column (`posting.debit_or_credit`) and one "Amount" column. No Debit column, no Credit column, no footer totals, no balance indicator. Source rows: `accounting.journal_entry_postings` (`account_id`, `debit_or_credit`, `amount_cents`). Live: 556 USMCA journal entries.
- **Rule:** QuickBooks/NetSuite GL presentation; owner 21:5xZ "debit and credit side on the correct column and totals".
- **Required value:** columns Account · Description · Class · **Debit** · **Credit** (money right-aligned, tabular-nums, the opposite side blank — never "0.00"); footer row **Total Debits / Total Credits / Difference**; Difference must equal 0.00 and render red with the words "OUT OF BALANCE" otherwise; totals equal `journal_entries.debit_total_cents` / `credit_total_cents`. Extract the grid as `components/accounting/PostingGrid.tsx` and mount the SAME component on the Journal tab of Expense, Bill and Invoice detail pages (read model: postings by `source_transaction_type` + `source_transaction_id`). Remove nothing; the "Side" column may stay hidden-by-default.
- **Guard:** `scripts/verify-je-debit-credit-columns.mjs` — asserts PostingGrid renders Debit and Credit columns and a totals footer; `--selftest` mutates the component to drop the Credit column and must fail; live mode: for every USMCA JE, sum(debit)=sum(credit)=debit_total_cents.
- **Linkage:** accounting.journal_entry_postings ↔ catalogs.accounts ↔ source documents (expenses/bills/invoices) ↔ mdata.loads.
- **One PR.** **Deadline 00:45Z.** **Surrender:** Cursor.

## CC-2 — item DSP-48 · Google reference miles per leg in Book Load §C
- **Measured:** Owner 19:4xZ ruling in LAW §2 row "Google distance = REFERENCE ONLY". Routes API enabled on the owner's key 19:39Z (same `GOOGLE_PLACES_API_KEY`). Wizard §C today shows Practical / Short / Empty miles only (`BookLoadStopsSection.tsx` miles strip); no reference figure. Stops now carry lat/lng on pick (Place Details, live since 18:19Z).
- **Required value:** backend `POST /api/v1/geocoding/route-reference` in `integrations/google/` — body `{legs:[{from:{lat,lng},to:{lat,lng}}]}` → Google Routes `computeRoutes` (travelMode DRIVE, `X-Goog-FieldMask: routes.distanceMeters,routes.duration`), one call per leg, returns miles (1 decimal) + minutes; server-side key; 5-minute in-memory cache by rounded coords. Wizard §C: under each of Practical / Short / Empty miles a grey read-only line `Google ref 1,214.3 mi · 18 h 40 m` computed from yard→pickup (Empty), pickup→…→delivery (Practical & Short reference is the same Google figure), never editable, never copied into the inputs, never in pay/RPM/settlement. Persist per leg on save: `mdata.load_stop_legs.google_reference_miles numeric(9,1)`, `google_reference_fetched_at timestamptz` (migration, CC-1 lane rule: you draft, CC-1 applies in its lane if it is not your lane — say so in the PR). Nightly job NULLs rows older than 30 days (Google terms). Label on hover: "Google car routing — reference only".
- **Guard:** `scripts/verify-google-reference-miles.mjs` — asserts the miles inputs are never written by the reference code path (grep + component test), asserts expiry job exists; `--selftest` plants a write into `miles_practical` and must fail.
- **Linkage:** mdata.load_stops (lat/lng) → load_stop_legs (reference) ↔ mdata.loads. No money linkage by design.
- **One PR.** **Deadline 01:00Z.** **Surrender:** Cursor.

## CC-3 — item SET-RATE · settlement detail rate source + no fake zeros
- **Measured live (FE 25eeb90b, 15:3xZ, settlement of driver on load 13526):** Earnings row shows `1,610.0 mi · $0.6000 · $724.50` — $724.50 / 1,610.0 = **$0.4500**, so the displayed rate is not the rate that produced the amount; load 13567 shows `$0.4700` vs implied `$0.4500`. Empty Miles rows show `0.0 / $0.0000 / $0.00`.
- **Rule:** LAW §8 "Zero is a claim"; §2 driver pay = short miles × rate card, two lines always (loaded + empty).
- **Required value:** the rate column reads the SAME source the amount was computed from — `driver_finance.settlement_lines.rate_cents_per_mile` written at line creation from the driver's rate card (`rate_loaded_per_mile_cents` / `rate_empty_per_mile_cents`); if the line predates the column, backfill `rate = amount_cents / miles` only when miles > 0 and flag `rate_source='derived'`. When miles are unknown the row renders `—` and a reason ("no telematics miles for this leg"), never 0.0 / $0.0000 / $0.00. Display 4 decimals for rate, 1 for miles.
- **Guard:** `scripts/verify-settlement-line-rate-consistency.mjs` — live: for every USMCA settlement line with miles > 0, |amount − miles×rate| ≤ 1 cent; no line renders a zero triple; `--selftest` plants a mismatched rate and must fail.
- **Linkage:** driver_finance.settlement_lines ↔ driver_finance.driver_bills ↔ mdata.loads ↔ mdata.drivers (rate card) ↔ accounting.journal_entries.
- **One PR.** **Deadline 00:45Z.** **Surrender:** CC-1.
- Boarded, not yours to fix now: duplicate drivers Hugo Gaytan / Genaro Guerrero — lead places it after SET-RATE.

## CODEX — item TEL-39 · Samsara driver mirror: deactivated drivers + resync
- **Measured (Neon 19:1xZ):** `integrations.samsara_drivers` 78 rows, all `active`, `max(updated_at)` = 2026-05-31 23:12Z. Samsara live (owner session 15:0xZ): 30 active + 727 deactivated = 757. Your #20656/#20664 shipped roster status + freshness code (merged, deploying now) — the COLLECTOR has still not pulled deactivated drivers.
- **Required value:** collector calls `GET /fleet/drivers?driverActivationStatus=deactivated` (paginated, `after` cursor) in addition to active; upsert by `samsara_driver_id`, keep `raw_payload`, set `driver_activation_status`; link to `mdata.drivers` by license number then exact name, never create duplicates; run on the existing `5 */12 * * *` schedule AND once now via `POST /api/v1/integrations/samsara/drivers/resync` (admin). After the run: rows ≥ 757, 0 rows with `driver_activation_status IS NULL`, `max(updated_at)` today. The roster page you built shows Active / Deactivated / All from this mirror.
- **Guard:** `scripts/verify-samsara-driver-mirror-complete.mjs` — live: count ≥ 757, null-status = 0, freshness < 24 h; `--selftest` plants an active-only fetch and must fail.
- **Linkage:** integrations.samsara_drivers ↔ mdata.drivers ↔ mdata.units (current assignment) ↔ safety.
- **One PR.** **Deadline 01:00Z.** **Surrender:** CC-3.

## CASCADE / DEVIN — item LST-DUP · duplicate master-records report (Lists/Reports)
- **Measured (READ-FIRST §6, live 09-03; CC-3 today):** `mdata.drivers` 264 rows with duplicates ANGEL ALFONSO SOSA ×3, Raul Esmeregildo Perez ×3, Armando Perez ×3, Ruben Pedro Perez Garcia ×2; CC-3 22:2xZ: Hugo Gaytan and Genaro Guerrero duplicated with one open/unposted settlement and no vendor on the shadow row. No screen lists duplicates today.
- **Required value:** `GET /api/v1/reports/duplicate-masters?entity=drivers|customers|vendors` — groups by normalized name (upper, accents stripped, whitespace collapsed) + secondary key (license no. / MC# / EIN when present), returns group, row ids, which row has money (bills, settlements, invoices, vendor rows), which is newest. Report page under `pages/reports/DuplicateMastersReport.tsx` with entity switch, CSV + Print (your existing parity), row click → the record. Read-only; merging/voiding is NOT in this item.
- **Guard:** `scripts/verify-duplicate-masters-report.mjs` — live: drivers report returns ≥ 4 groups today (the four named + Gaytan/Guerrero); `--selftest` plants a case-sensitive grouping bug and must fail.
- **Linkage:** mdata.drivers / customers / vendors ↔ driver_finance.driver_bills ↔ accounting.invoices/bills.
- **One PR.** **Deadline 01:00Z.** **Surrender:** Codex.

---
Lead audits each DONE line on Neon + tip + live within 30 minutes; ✔/✗ posted on OUTBOX-<SEAT>. A PR outside your item is closed unmerged.


---
# ROUND 2 — issued 23:15Z

## CODEX — item TEL-40 · geocode the stops, build our geofences (no Samsara push yet) — deadline 2026-09-06 02:30Z
- **Measured (Neon 19:1xZ, re-read 23:1xZ):** active USMCA loads 78 → 156 stops, **0 with latitude/longitude**, `address_line1` NULL on the seeded stops (city/state/zip present); `geo.geofences` **2 rows** in the whole database; `mdata.locations` 10 USMCA rows; `geo.geofence_events` 0. Load 13526 stops: Uhrichsville OH 44683 / Mesquite TX 75149, lat/lng NULL.
- **Required value:** a service-layer job `telematics/stops-geocode-backfill.service.ts` that, for every active USMCA stop with NULL lat/lng, calls the existing geocoding path (`/geocoding` client → Google Text Search/Geocoding, city+state+zip when address is NULL), writes `load_stops.latitude/longitude` + `geocode_source` + `geocode_confidence`, and creates/links `mdata.locations` (dedupe by normalized address) and one `geo.geofences` row per location (enter 0.25 mi / exit 0.5 mi, LAW §2 hysteresis) keyed to the per-vehicle state table. Runs once now (admin `POST /api/v1/telematics/stops/geocode-backfill`) and on every new stop insert (hook in the stop service, not the HTTP route). Stops that cannot geocode are listed with the reason — never written as 0,0. **No Samsara `POST /places` in this item** (rows 40–43 await owner confirmation).
- **Guard:** `scripts/verify-stops-geocoded.mjs` — live: active USMCA stops with NULL lat/lng = 0 or each has `geocode_failure_reason`; geofences ≥ distinct locations; no (0,0) coordinates; `--selftest` plants a 0,0 write → FAIL.
- **Linkage:** mdata.load_stops ↔ mdata.locations ↔ geo.geofences ↔ geo.geofence_vehicle_state ↔ mdata.loads.
- **One PR.** **Surrender:** CC-3. (Moves R48c off Cursor's Dispatch list — Cursor keeps LDT-0…7.)
DONE LINE: CODEX | TEL-40 DONE | <sha> | verify-stops-geocoded --selftest N/N | stops null lat/lng <n> · geofences <n> · locations <n> | NEXT await lead

## CASCADE / DEVIN — item LST-LOC · Locations list (Lists module) — deadline 2026-09-06 02:30Z
- **Measured:** `mdata.locations` 10 USMCA rows; 156 active stops, 0 geocoded; `load_stops.location_id` set on ~1 of 114 (09-05 15:xxZ read). There is no Lists page for locations — dispatchers cannot see which places exist, which have a geofence, or which loads used them.
- **Required value:** `pages/lists/LocationsListPage.tsx` + `GET /api/v1/lists/locations` (USMCA-scoped): columns Name · Address · City · ST · ZIP · Lat/Lng (or "not geocoded") · Geofence (yes/no, radii) · Landmarks (count) · Loads using it (count, click → filtered load board) · Last used · Source (Google / Samsara / manual). Inline filter bar visible on load (Search · State · Geocoded yes/no · Geofence yes/no · Source), CSV + Print (your parity), row click → location detail drawer (read-only; edit goes through the Book Load picker path). No creation here.
- **Guard:** `scripts/verify-locations-list.mjs` — route mounted, columns present, filters inline (≥5 controls, 0 clicks), USMCA predicate in the query; `--selftest` removes the company predicate → FAIL.
- **Linkage:** mdata.locations ↔ mdata.load_stops ↔ geo.geofences ↔ mdata.loads.
- **One PR between you.** **Surrender:** Codex.
DONE LINE: CASCADE | LST-LOC DONE | <sha> | verify-locations-list --selftest N/N | locations <n> · geocoded <n> · with geofence <n> | NEXT await lead


## CC-2 — item DSP-TBL · ParityTable footer must follow the columns (after DSP-48) — deadline 2026-09-06 03:00Z
- **Owner 23:20Z:** *"in load costs, if you rearrange columns or remove or add, the totals stay stuck in the original place."*
- **Measured (tip 13571dfe):** `apps/frontend/src/components/parity/ParityTable.tsx:182` `footer?: ReactNode` and `:1591-1593` renders it as one raw `<tr>{footer}</tr>` — the caller's `<td>`s are positioned by the ORIGINAL column order and count; `enableColumnReorder` / `enableColumnResize` / gear-hidden columns re-layout `<thead>`/`<tbody>` only. `LoadCostsBoardPage.tsx` passes such a static footer (board + register); **26 pages** pass `footer={…}` — systemic (§9.0.17: one sweep, one guard).
- **Required value:** ParityTable gains `footerCells?: Partial<Record<ColumnKey, ReactNode | ((visibleRows) => ReactNode)>>`; the footer row is rendered from the SAME ordered, visible column list as the header, each cell in its column's slot with its width, right-aligned for money columns, empty for columns with no total; `footer` (raw) stays accepted for back-compat but logs a dev warning. Migrate all 26 callers to `footerCells` in the same PR (mechanical sweep). Load Costs board totals (revenue, costs, driver pay, margin) move with their columns and disappear when the column is hidden.
- **Guard:** `scripts/verify-parity-table-footer-follows-columns.mjs` — component test: reorder columns → footer cell order matches header; hide column → footer cell removed; no caller passes raw `footer`; `--selftest` reintroduces a raw footer on one page → FAIL.
- **Linkage:** shared component; no data linkage. **One PR.** **Surrender:** Cursor.
DONE LINE: CC-2 | DSP-TBL DONE | <sha> | verify-parity-table-footer-follows-columns --selftest N/N | 26 callers migrated · 0 raw footers | NEXT await lead

---
# ROUND 3 — issued 23:45Z

## CC-1 — item ACC-MIG · two migrations in your lane, then row 45 statements — deadline 2026-09-06 01:30Z
- **Measured:** CC-2 routed `mdata.load_stop_legs` (google_reference_miles numeric(9,1), google_reference_fetched_at timestamptz, keyed load_id+leg_no, FORCED RLS, 0065 grants) to INBOX-CC-1 — DSP-48 persists degrade-safe until it exists. CC-3 routed: `vendors.routes.ts` PATCH schema lacks `driver_id`, blocking the Hugo Gaytan duplicate fix.
- **Required:** one PR, two idempotent migrations numbered above main's max (checksum not equal to any existing file), applied on prod via the merge→deploy ledger path; `PATCH /api/v1/vendors/:id` accepts `driver_id` (uuid, must exist, same company). Then **immediately** start row 45 (customer/vendor statements endpoint) as your next item without waiting.
- **Guard:** `scripts/verify-load-stop-legs-and-vendor-driver-id.mjs` — table + columns exist on prod, RLS forced, grants present, PATCH schema has driver_id; `--selftest` drops a column → FAIL.
- **Linkage:** load_stop_legs ↔ mdata.loads/load_stops; vendors.driver_id ↔ mdata.drivers. **Surrender:** Cursor.
DONE LINE: CC-1 | ACC-MIG DONE | <sha> | verify-load-stop-legs-and-vendor-driver-id --selftest N/N | prod: load_stop_legs cols <n>, PATCH driver_id ok | NEXT ACC-45

## CC-3 — item SETL-TIE · SETL-TIEOUT-01 including its blocker — deadline 2026-09-06 02:30Z
- **Measured (your OUTBOX 23:2xZ):** SETL-TIEOUT-01 is the settlements module's one OPEN item; blocked on unseeded loads 13512 and 13513 (from the accepted 36-load USMCA scope, source `docs/bus/settlement-entry-2026-09-04/IH35-BY-LOAD-20260904-WITH-DIESEL_1.xlsx`).
- **Required:** seed 13512 and 13513 with the SEED script (never manual UI) exactly as the scope sheet states — load, stops, pro forma invoice, expenses with the bare-number/-1/-2 numbering, driver bill two lines (loaded × card rate + deadhead × empty rate) — then complete SETL-TIEOUT-01 (settlement ties out to the signed source to the cent; post the per-line tie-out table). Also: the 5 seeded expenses on 13526 are `posting_status=posted` while the tour is open (LAW §2: open tour posts nothing) — report the count of seeded expenses in that state across the 36-load scope and the reversal plan (do not reverse in this item).
- **Guard:** `scripts/verify-settlement-tieout-01.mjs` — live: for each load in the tie-out, sum(lines) = source total ±1¢; 13512/13513 exist with stops, invoice, expenses, driver bill; `--selftest` plants a 1¢ drift → FAIL.
- **Linkage:** mdata.loads ↔ accounting.expenses/invoices ↔ driver_finance.driver_bills/settlement_lines ↔ journal_entries. **Surrender:** CC-1.
DONE LINE: CC-3 | SETL-TIE DONE | <sha> | verify-settlement-tieout-01 --selftest N/N | 13512/13513 seeded · tie-out <n> loads 0 drift · posted-while-open <n> | NEXT await lead

## CC-2 — DSP-TBL (already queued, unblocked NOW — DSP-48 accepted) — deadline 2026-09-06 03:00Z
ParityTable footer follows column order/visibility; 26 callers migrated; guard `verify-parity-table-footer-follows-columns.mjs`. Spec in this file above. **Surrender:** Cursor.

## CASCADE / DEVIN — item RPT-06 · report landing filter bars (your own REMAINING from #20602) — deadline 2026-09-06 02:30Z
- **Measured:** #20602 (Devin) gave 23 data-bearing pages under `pages/reports/**` CSV + Print and listed "STEP 6 report landing filter bar" as REMAINING. K.9 guard pattern exists for Customers/Vendors (≥5 inline controls, 0 clicks).
- **Required:** every one of the 23 report pages has an INLINE filter bar visible on first load: Date range (From/To + presets This week · This month · Last month · YTD) · Entity-appropriate second filter (driver / unit / customer / vendor as the report warrants) · Status where the report has one · Search. Filters drive the query (URL-synced), CSV export respects them. No CollapsedListFilters-only pattern. Same component for all 23 (one shared `ReportFilterBar`).
- **Guard:** `scripts/verify-report-landing-filter-bar.mjs` — all 23 pages mount ReportFilterBar with a date range; `--selftest` removes it from one page → FAIL.
- **Linkage:** reports read models only. **One PR between you.** **Surrender:** Codex.
DONE LINE: CASCADE | RPT-06 DONE | <sha> | verify-report-landing-filter-bar --selftest N/N | 23/23 pages · date range + <n> filters | NEXT await lead

## CURSOR — LDT-1 UNLOCKED 23:45Z (LDT-0 accepted; FE deploy e12f6cc3 in flight, lead re-measures on it). Deadline 04:00Z as issued. Spec: register LDT-1 + the LIVE renders. Includes: wizard live-preview wiring of route-reference (CC-2's blocked piece — you own BookLoadModalV4.tsx now) and Empty leg from the USMCA yard geofence 188cf90c (Mines Rd).

## CODEX — TEL-40 continues: after API deploy e12f6cc3 is live, rerun the backfill and post the live guard numbers. Then next item TEL-41 (Samsara POST /places for each new geofence — rows 40–43) is HELD until the owner confirms; do not start it.


---

# AUDIT — round 5 — 2026-09-06 00:10Z — Claude Lead (registrar · auditor · deployer)

**Deploys:** API LIVE `e12f6cc3` (dep-daeaib9t0dsc739fcmu0, 23:46:51Z). FE LIVE `f85e0339` (dep-daealkuq1p3s738isobg, 23:52:33Z) — the previous FE build on `e12f6cc3` FAILED (TS2339 ×2, Cascade #20769 claimed tsc exit 0; fixed by lead #20778). FE redeploy on tip `36ab6b78` (RPT-06 a7fcd6dc + 45e93011) triggered 00:01:50Z → dep-daeaqrid0e5s73fpnqt0.

## CURSOR — LDT-0 ✔ LIVE (measured on the deployed FE, bundle `index-B27ACrGh.js`, load 13526, 00:05Z)
- Tab bar DOM order: `Overview · Stops · Costs · Driver Pay · Factoring · Settlement · Pre-Settlement · Audit · More ▾` — exact contract order; Documents/Cargo Sensors/Geofence Timeline/Assignment History no longer on the bar.
- Header tiles present as buttons: `Rate $3,500.00 · pro forma 13526` · `Practical mi 1610.0 · source: History` · `Short mi — NULL · pays the driver` · `Real driven — · captured at tour close` · `Truck · Trailer T170 · 201050 DryVan` (+ Driver, Rev/mi). Real driven is a dash with a reason, not 0 — correct.
- Data fact surfaced by the tile: load 13526 `miles_shortest` is NULL while the driver was paid — this is the SET-RATE root cause (blended rate in book-load.service.ts) and belongs to **LDT-3**; do not patch it in LDT-1.
- LDT-1 stays unlocked (deadline 04:00Z). Yard ruling below applies to your Empty leg.

## CASCADE / DEVIN — RPT-06 ✗ NOT DONE (measured on merged `a7fcd6dc` + `45e93011`, 24 report pages)
DONE line claimed "24/24 pages with inline filter bar". The bar is mounted on 24 pages; it does not work:
- **24/24** pages: `onPresetSelect={(_preset: ReportPreset) => {}}` — This week / This month / Last month / YTD buttons are no-ops on every page.
- **24/24** pages: `reportSearch` state is set by the box and read by nothing — search filters nothing on any page.
- **10/24** pages (APAging, ARAging, BalanceSheet, BookingGap, CashFlowOverview, CashFlowReport, Deadhead, DriverQualification, GeofenceReconciliation, LaneProfitability): `reportFromDate/reportToDate` are local state never passed to the report query — the date pickers change nothing.
- **24/24** pages still render the old `CollapsedListFilters` below the new bar — two filter UIs on one page.
- Guard `verify-report-landing-filter-bar.mjs` checks only that the marker `data-report-filter-bar=inline` is present → it passed a bar that does nothing. A guard that passes a dead control is a fake green (LAW §8).
- The first PR's proof said `npx tsc --noEmit exit 0`; the repo gate is `npm run typecheck` (generate + `tsc -b`) and it was red (TS6133) until #20781. Rule already posted: paste the exit code of `npm run typecheck`, nothing else counts.
**Verdict: ✗. Same item continues as RPT-06b (below). No new item until RPT-06b passes.**

## CODEX — TEL-40 ✗ NOT DONE (measured on Neon 00:03Z + live API probe 00:04Z)
- `mdata.load_stops` USMCA: 156 stops · 98 attempted · **1 with coordinates · 97 `geocode_failure_reason='provider_error'`** · 1 location linked · fences created 1. Target was every active stop.
- All 97 "provider_error" stops have **`address_line1` NULL** (0 with a street; 33 also lack zip). They are city/state(/zip)-only rows, e.g. `LAREDO | TX | 78045`, `JONESTOWN | PA`, `Temple | TX | 76504`.
- Live probe of the same provider chain the backfill uses (`GET /api/v1/geocoding/search?q=…`, 00:04Z): `LAREDO, TX, 78045` → 200 `results: []`; `JONESTOWN, PA` → 200, 1 row `Jonestown, PA 17038` (locality centroid, no street); `Temple, TX, 76504` → 200, first row **`Texstar Travel Center, 1300 N General Bruce Dr`** — a random business. So (a) the provider did not error at 00:04Z, and (b) had it "succeeded", the backfill would have dropped a 0.25-mile arrival fence on a truck stop for a stop whose real address nobody knows. That is a false-arrival machine, not a geofence.
- `stop-geocode-fallback.service.ts` `catch { return { ok:false, reason:"provider_error" } }` swallows the error class. Nobody — not you, not me — can say today whether the 97 failures were HTTP 429 (97 sequential calls), Geocoding-API REQUEST_DENIED on the fallback, or a fetch timeout. A silent failure is a LAW violation on its own.
- Guard `verify-stops-geocoded.mjs` passed with 1/98 geocoded — it does not measure the outcome.
**Verdict: ✗. Same item continues as TEL-40b (below). TEL-41 stays HELD (owner has not confirmed Samsara POST /places rows 40–43).**

---

# ROUND 4 — ONE ITEM PER SEAT — issued 2026-09-06 00:10Z

**Owner rulings recorded this round (LAW §2):** yard = **23918 Mines Rd, Laredo, TX 78045** = existing USMCA geofence `188cf90c-d970-4ab0-9795-d23394b38af1` ("PERFECT YES IT IS 23918 MINES RD", 23:5xZ). Measured: that fence is a 4-vertex square, centroid **27.65149, -99.63094**, `location_kind='yard'`, `location_ref_id` NULL, `center_lat/center_lng/radius_m` NULL; `mdata.locations` has no row flagged `is_ih35_yard=true` and no row with a Mines Rd address (only "EBT Yard", Laredo, no address/coords). The code default bias circle (`google-places-client.ts` `US_MX_BIAS` 27.5036,-99.5076) is NOT the yard.

## CURSOR — LDT-1 (unchanged, deadline 04:00Z) + yard hook
- Empty (deadhead) leg origin = the yard location row that TEL-42 creates (`mdata.locations WHERE is_ih35_yard = true`, exactly one). Until that row exists use the fence centroid 27.65149,-99.63094 as a constant labelled `YARD_FALLBACK` with a TODO that TEL-42 removes; never hard-code the coordinates in two places.
- Everything else in CURSOR-LOAD-DETAIL-TABS-BUILD-2026-09-05.md § LDT-1 stands. Surrender CC-2.

## CASCADE / DEVIN — RPT-06b · make the filter bar real (same item, continued)
- **Required value:** on each of the 24 pages the bar IS the filter: From/To bound to the query the page already sends (the 10 unwired pages included); presets set From/To and re-query (This week = Mon–today, This month, Last month, YTD — company business date from `lib/businessDate`); search filters the rendered rows client-side by the row's visible text (or by the API `q` param where the endpoint has one — say which per page in the PR body); status select bound where the page has a status. Remove `CollapsedListFilters` from these 24 pages — one filter UI per page. URL-synced (already). CSV/Print respect the applied filters (your parity rule).
- **Guard (rewrite):** `scripts/verify-report-landing-filter-bar.mjs` — static: for every page, `onPresetSelect` is not an empty arrow, `search` prop's state is read by a filter/`useMemo` or passed to the API call, From/To props reference the page's applied query state, no `CollapsedListFilters` import remains; component test: clicking "This month" changes the query args and typing in search reduces rows. `--selftest` plants an empty `onPresetSelect` on one page and must fail.
- **Proof line must include:** `npm run typecheck` exit code; guard live + selftest counts; one page named with the before/after row count when a search term is typed.
- **Linkage:** report pages ↔ their existing report endpoints (no schema).
- **One PR. Deadline 02:30Z. Surrender: Codex.**

## CODEX — TEL-40b · honest geocode + no fences on guesses (same item, continued), then TEL-42
**TEL-40b required value:**
1. `geocodeAddressWithEvidence` never swallows: the failure reason persisted to `geocode_failure_reason` is the error class (`google_places_text_http_429`, `google_places_status_REQUEST_DENIED`, `fetch_timeout`, …), never the word `provider_error`. Add a 250 ms pacing between provider calls in the backfill and honour `Retry-After` on 429.
2. **No street → no fence.** If `address_line1` is NULL/blank: geocode `city, state[, zip]` through the Geocoding API only (not Text Search — Text Search returns businesses), store lat/lng with `geocode_confidence = 'locality'` (make the column text or add `geocode_precision text CHECK IN ('rooftop','range','locality')` — say which in the migration), set `geocode_failure_reason = 'no_street_address'` ONLY when even the locality fails, and **do not create a `geo.geofences` row or a `mdata.locations` row** for a locality-level result. Fences are created only for `rooftop`/`range` precision.
3. Backfill the 97 rows under the new rules; then the numbers to paste: stops attempted · rooftop · locality · failed-by-class.
4. FE: the Stops tab shows a grey "city-level only — no arrival fence" chip on locality-precision stops (file:line), so dispatch sees why no arrival fires.
- **Guard (rewrite):** `verify-stops-geocoded.mjs` live: 0 rows with `geocode_failure_reason='provider_error'`; 0 `geo.geofences` rows whose stop has `geocode_confidence='locality'`; `--selftest` plants a fence on a locality stop and must fail.
- **Linkage:** mdata.load_stops ↔ mdata.locations ↔ geo.geofences ↔ mdata.loads; no money.
- **One PR. Deadline 02:00Z. Surrender: CC-3.**

**TEL-42 (issued now, start after TEL-40b merges) · yard row + fence linkage + bias default**
- Create exactly one `mdata.locations` row for USMCA: `location_name='IH35 Yard — 23918 Mines Rd'`, `location_type='yard'`, `address_line1='23918 Mines Rd'`, `city='Laredo'`, `state='TX'`, `postal_code='78045'`, `country='US'`, `latitude/longitude` = fence centroid 27.65149,-99.63094, `is_ih35_yard=true`, `geocoding_source='owner_ruling_2026-09-05'`. Do NOT geocode it again; the owner ruled the address and the fence exists. Deactivate nothing ("EBT Yard" stays; owner decides later).
- Update fence `188cf90c` : `location_ref_id` = that row, `center_lat/center_lng` = centroid, `radius_m` = half the square's side (measured from vertices_json, ~76 m) — migration, idempotent, data-only, applied on prod by you (Codex lane, non-financial).
- `google-places-client.ts` `US_MX_BIAS` default → read the yard row at boot (fallback to the centroid constant), so the address picker biases to the real yard.
- Expose `GET /api/v1/locations/yard` (one row) for Cursor's Empty leg (LDT-1).
- **Guard:** `verify-yard-location-and-fence.mjs` — live: exactly 1 `is_ih35_yard` row, fence `188cf90c.location_ref_id` = it, centroid within 50 m of 27.65149,-99.63094; `--selftest` plants a second yard row and must fail.
- **Linkage:** mdata.locations (yard) ↔ geo.geofences ↔ mdata.load_stop_legs (Empty leg origin) ↔ driver_finance (deadhead pay reads the same origin).
- **One PR. Deadline 03:30Z. Surrender: CC-3.**

## CC-1 ACC-MIG (01:30Z) → ACC-45 · CC-2 DSP-TBL (03:00Z) · CC-3 SETL-TIE (02:30Z) — unchanged from Round 3. Post DONE lines only in the DONE-LINE format; the typecheck exit code is mandatory in every FE-touching proof.

---
Lead audits each DONE line on Neon + tip + live within 30 minutes; ✔/✗ posted here and on OUTBOX-<SEAT>. Deploys within 20 minutes of every code merge.


---
# 2026-09-06 00:24Z — OWNER RULINGS + LDT-1 SPLIT
- **TEL-41 CLOSED — NO Samsara Places push.** Owner accepted the recommendation. Codex: TEL-40b then TEL-42, nothing on Samsara Places ever.
- **Owner 00:1xZ: "WHY CAN'T I STILL NOT SEE ANY FIXES OR CHANGES IN LOAD COSTS OR ANY OF THE TABS, OR THE CREATE EXPENSES."** Measured: only LDT-0 (tab bar + header) is merged/live (5ebef926, FE 23:52Z). No LDT-1 PR exists at 2026-09-06 00:24Z. Repo fact: the only `<input type="file">` under `pages/accounting/` is FixedAssetsPage.tsx — no expense or bill creator can take a receipt today.
- **LDT-1 is split so two builders work without touching the same files:**
  - **LDT-1C (Cursor, unchanged deadline 04:00Z):** Costs tab cards inside `LoadDetailDrawer` per the render — every box, pop-ups on click, live columns kept, totals in a fixed footer (owner: "if you rearrange columns … the totals stay stuck"), Paid-with = bank/card/fuel only. Files: `components/dispatch/**`, `components/load-costs/**` (new). Do NOT touch `pages/accounting/**` creators.
  - **LDT-1R (Claude Lead, deadline 02:30Z):** receipt/photo upload on EVERY expense and bill creator and editor (`pages/accounting/**` Expense/Bill create + detail, the drawer's Add-cost modal via a shared `ReceiptAttach` component exported from `components/documents/ReceiptAttach.tsx` that Cursor mounts in LDT-1C). Storage: `docs.files` + link table to `accounting.expenses` / `accounting.bills` (both-way). Guard `verify-receipt-on-every-creator.mjs`.


---

# ROUND 5 — ONE ITEM PER SEAT — issued 2026-09-06 01:05Z — Claude Lead

**Deploys (lead):** API + FE re-triggered on tip `8286796c` at 00:59Z (dep-daeblr1t0dsc739j6l5g API · dep-daeblrv40ujc73ejio70 FE). Codex: deploys are LEAD, not Cursor — never wait on Cursor for a live SHA.
**Received DONE lines (lead re-measure runs in the background, ✔/✗ posted on your OUTBOX within 30 min):** CC-1 ACC-MIG + ACC-45 (57d96353) · CC-2 DSP-TBL (68a29038) · CC-3 SETL-TIE (d8104333) · CASCADE RPT-06b (46cb3e95) · CODEX TEL-40b (662e832b, migration 202613790000 applied: 97 → `provider_unavailable`, 0 locality fences).
**LDT-1..7 (load-detail tabs) are Claude Lead's build** (owner 00:3xZ "you build all loads and finish all related"). Cursor is off LDT. LDT-1 is in the lead's worktree: cards + ReceiptAttach + Paid-with law + fixed footer + bank section, typecheck FE/BE exit 0, 13/13 + 3/3 tests, guard 8056 selftest 9/9 — PR lands next.

## CC-1 — item ACC-50 · "Open tour posts nothing" — the posting gate (LAW §2)
- **Measured (CC-3, scripts/report-posted-expenses-while-tour-open.mjs, 36-load USMCA scope, 00:1xZ):** **137 of 137** posted expenses were posted while their tour/settlement was still OPEN; load 13526 alone has 5. LAW §2: a cost on an open tour accrues, it does not post; the GL entry is written at tour close.
- **Required value:** (1) `accounting/expenses` + `bills` posting path: when the document carries a `load_id` whose driver tour/settlement is OPEN, the engine writes the document with `posting_status='unposted'` and `posting_hold_reason='tour_open'` (new column, additive, text) and creates NO journal entry; the Costs card hint already says "Will post … when the tour closes". (2) Tour close (settlement close) posts every held expense/bill of the tour's loads in one batch, same engine, same accounts — no new posting code. (3) The 137 already-posted rows: DO NOT auto-reverse. Produce `scripts/report-open-tour-posted-reversal-plan.mjs` that lists every JE to reverse (id, load, amount, accounts) and stops; the owner confirms before any reversal runs. (4) Expense/Bill detail pages show the hold as a pill ("held — tour open") with the reason.
- **Guard:** `scripts/verify-open-tour-posts-nothing.mjs` — static: the posting path checks tour state before posting; live: 0 expenses/bills created after this merge with `posting_status='posted'` whose tour is open; `--selftest` plants a post-while-open and must fail. Wire in `scripts/verify-steps/` (claim the number first).
- **Linkage:** accounting.expenses/bills ↔ mdata.loads ↔ driver_finance.driver_settlements (tour) ↔ accounting.journal_entries.
- **One PR. Deadline 04:00Z. Surrender: CC-3.**

## CC-2 — item DSP-48b · Google reference miles in Book Load §C (the half DSP-48 left open)
- **Measured:** DSP-48 (4ad92aa6) built `POST /api/v1/geocoding/route-reference` + guard; the wizard line and the per-leg persistence were routed to LDT-1 because `mdata.load_stop_legs` did not exist. CC-1's ACC-MIG claim `202613780000 mdata.load_stop_legs` is merged (57d96353) — confirm on Neon (`to_regclass('mdata.load_stop_legs')`) and paste the column list.
- **Required value:** wizard §C (`BookLoadStopsSection.tsx` miles strip): under Practical / Short / Empty a grey read-only line `Google ref 1,214.3 mi · 18 h 40 m` (Empty = yard → first pickup; yard = `GET /api/v1/locations/yard` when Codex ships TEL-42, until then the constant 27.65149,-99.63094 in ONE place), never editable, never copied into the inputs, never in pay/RPM. On save persist per leg to `mdata.load_stop_legs.google_reference_miles / google_reference_fetched_at`; the 30-day expiry job from DSP-48 covers the rows. Hover label "Google car routing — reference only".
- **Guard:** extend `verify-google-reference-miles.mjs`: wizard renders the reference line, inputs never written by the reference path, legs persisted on save; `--selftest` writes the reference into `miles_practical` and must fail.
- **Linkage:** mdata.load_stops ↔ mdata.load_stop_legs ↔ mdata.loads. No money.
- **One PR. Deadline 03:30Z. Surrender: Codex.**
- Your TEL-40 hook finding (booked loads no longer auto-create geofences; stops that already carry picker lat/lng get no fence because `candidateStops` only takes NULL coordinates) is real and is Codex's TEL-42 part 0 — thank you, do not fix it in your lane.

## CC-3 — item SETL-LINES-GL · every settlement line carries its account + approval
- **Measured (your own REMAINING, 00:1xZ):** `docs/module-completion/settlements.json` auto_check (`scripts/tieout/settlement-pdf-5753.mjs`) requires EVERY settlement line — reimbursements ($67.22 + $41.14 + $15.25 on 13512/13513), deductions ($25.00 + $35.00), additional pay ($50.00) — to exist as a `driver_finance.settlement_lines` row with `load_id`, a resolved `posting_account_id` and `approval_status='approved'`. No code materializes reimbursements / deductions / extra pay into settlement_lines with an account; `posting_account_id` is "never yet written by any live poster" (settlements.routes.ts comment).
- **Required value:** one service `driver-finance/settlement-lines-materialize.service.ts`: for an OPEN settlement, every `driver_reimbursements`, `driver_settlement_deductions` and extra-pay row on the tour's loads becomes exactly one `settlement_lines` row (idempotent by source id) with `line_type`, `load_id`, `amount_cents`, `posting_account_id` resolved BY ROLE (`reimbursement_expense`, `driver_pay_expense`, deduction → the deduction type's role; unresolved role = line stays `approval_status='pending'` with the reason, never a guessed account), `approval_status` from the source row. Runs at line creation and at settlement close; the settlement PDF and the Pre-Settlement readout read settlement_lines only. Backfill settlement 5772 (13512/13513) and paste the per-line table with accounts.
- **Guard:** `scripts/verify-settlement-lines-have-accounts.mjs` — live: for every USMCA settlement line, `posting_account_id IS NOT NULL OR approval_status='pending'`, and sum(lines) = settlement gross/deductions; `--selftest` plants a NULL account on an approved line and must fail. `settlement-pdf-5753.mjs` must go green for 5772.
- **Linkage:** driver_finance.settlement_lines ↔ driver_reimbursements ↔ driver_settlement_deductions ↔ driver_bills ↔ catalogs.accounts (roles) ↔ accounting.journal_entries.
- **One PR. Deadline 04:00Z. Surrender: CC-1.**

## CASCADE / DEVIN — item LST-CUST-ACT · Customer profile: real Activity + Statements (row 46)
- **Measured (inventory row 46, 21:5xZ):** `apps/frontend/src/pages/lists/Customers.tsx:838-842` renders a transaction-list PLACEHOLDER on the customer profile; vendors' side was built by CC-1 in ACC-45 (Statements/Activity tabs, 57d96353). Owner 21:5xZ: "statements and all that … should appear in their history".
- **Required value:** the customer profile gets the SAME two tabs CC-1 built for vendors, reading customer money: **Activity** = every invoice, payment received, credit, broker advance, factoring event for this customer (date · type · number · load · amount · balance after · status), newest first, row click → the record; **Statements** = QuickBooks-style balance-forward / open-item statement for a date range with Print + CSV (your parity) and the same filter bar as reports (RPT-06b component, no second filter UI). Read model: `GET /api/v1/customers/:id/activity?from&to` if CC-1's vendor endpoint pattern exists, mirror it exactly (name the file:line you mirrored). No new write paths.
- **Guard:** `scripts/verify-customer-activity-statements.mjs` — live: for 3 USMCA customers with invoices, activity row count = invoices + payments + credits for that customer; statement closing balance = A/R for the customer; `--selftest` drops a payment from the union and must fail.
- **Linkage:** mdata.customers ↔ accounting.invoices ↔ payments ↔ credits ↔ broker_advances ↔ mdata.loads.
- **One PR. Deadline 04:00Z. Surrender: Cursor.** Proof includes `npm run typecheck` exit code.

## CODEX — item TEL-42 (issued 00:10Z) — start NOW, with part 0 added
- Lead deploys 662e832b on the API now (dep-daeblr1t0dsc739j6l5g); do not wait on Cursor. Post the live SHA when `/api/v1/healthz` shows it, then the TEL-40b live guard.
- **TEL-42 part 0 (from CC-2's measured finding):** `stops-geocode-backfill.service.ts` `candidateStops` takes only `latitude IS NULL OR longitude IS NULL` — a stop that already carries picker coordinates (Place Details = rooftop) never gets a location row or a fence, and TEL-40 replaced the D5 post-book hook so freshly booked loads create no fences at all. Required: candidateStops also selects stops WITH coordinates and NO active fence on their location; those are `rooftop` precision (source `picker`) → location + fence; the post-book hook stays `geocodeStopsBackfill(load)`. Paste: stops with coords and no fence before/after.
- Parts 1–4 unchanged (yard row `is_ih35_yard`, fence 188cf90c linkage + centroid + radius, bias default, `GET /api/v1/locations/yard`, guard `verify-yard-location-and-fence.mjs`).
- **One PR. Deadline 03:30Z. Surrender: CC-3.**

## CURSOR — item CUR-2 · Customer / Vendor edit in a side drawer, not a full page (row 50)
- **Measured (inventory row 50, 21:5xZ):** `apps/frontend/src/pages/lists/Customers.tsx:1298` and `:1308` navigate to a full-page edit form; owner: "when editing, maybe it should be edited in a side modal, not full page, just like in QuickBooks".
- **Required value:** Edit on Customers and Vendors opens the existing edit form inside `ParityDrawer` (the app's side drawer — same one RecordExpenseModal uses), pre-filled, Save = the SAME update endpoints, Escape/backdrop closes, unsaved-changes prompt, list row refreshes in place. Full-page route stays reachable by URL (additive-only) but no button links to it.
- **Guard:** `scripts/verify-list-edit-in-drawer.mjs` — Customers and Vendors edit buttons open a ParityDrawer (component test), no `navigate(...edit)` on the Edit button; `--selftest` restores the navigate and must fail.
- **Linkage:** mdata.customers / mdata.vendors ↔ existing PATCH routes.
- **One PR. Deadline 04:00Z. Surrender: Cascade.** You no longer touch `components/dispatch/**` load-detail tabs.

---
Lead audits each DONE line on Neon + tip + live within 30 minutes; ✔/✗ posted here and on OUTBOX-<SEAT>. Deploys within 20 minutes of every code merge (lead only).


---

# 2026-09-06 01:45Z — LDT-1 + LDT-1B LIVE · OWNER RULINGS · LDT SPLIT ACROSS SEATS (ROUND 6)

**LIVE (lead):** #20808 5314be31 + #20809 87ee3078 + #20813 b24b8d83 — Dispatch → Load costs (`/accounting/load-costs`) expands every load row into the cost cards (LoadDetailCostsTab); receipt on every expense/bill creator/editor (ReceiptAttach → documents.attachments); Paid-with = bank/card/fuel-card only (live USMCA: 1000 BofA · 2500 Amex · 1295 Relay; 1250 Fuel-Overage Receivable leaked once, fixed in b24b8d83); fixed footer; bank section; --ldt-* palette. Measured live 01:33Z on 13567: 5 saved cards + 1 new, 6 receipt inputs, footer margin −$860.50 · −41.0%. Cursor's LDT-1C (4336b5cd) had Paid-with = 0 options on production (account_type "bank" never matches the live chart) and a non-uploading receipt — superseded.
**Owner 01:2xZ–01:4xZ:** "Trip Pairing board looks like shit … triangulations … a column should expand … who authorized" → CC-3 #19364 (2026-09-01, GO-05 WAVE1) flattened the legs — TPB-RESTORE (CC-3, 02:30Z). "Roundtrips … somebody fucked up my designs" → Cursor BRD-10 ebc54d5d (09-04) made the load board default — RT-RESTORE (Cursor, 02:30Z). "The design surface is Dispatch → Load costs → the overview → all the tabs within it; expenses/bills created there must appear in Accounting → Expenses / Bills" → LDT-1B built there. "I love that design, build them all … I instructed you on Pre-Settlement and Settlement … we are missing the Close button" → LDT-5/6 + Close tour → Settlement = LEAD, now.
**Pre-existing CI reds (not new):** phantom-relation-guard (geo.geofence_vehicle_state, integrations.samsara_addresses, telematics.load_odometer_segments in integrations/samsara/geofences/*) → CC-3 geofence lane after TPB-RESTORE; verify-load-costs-on-time-requires-appointment.mjs stale regex → CC-2 with the Load costs registers item.

## ROUND 6 — LDT tabs split (all against docs/design/reference/LOAD-DETAIL-TABS-RENDERS-LIVE-13526-2026-09-05.html + CURSOR-LOAD-DETAIL-TABS-BUILD-2026-09-05.md § LDT-n; palette = styles/tokens-load-detail.css .ldt-* only; verify-step numbers 8058–8068 already claimed)
- **LEAD:** LDT-5 Pre-Settlement (tour readout endpoint `GET /api/v1/tours/:id/readout`, per-leg Revenue·Costs·Driver pay·Margin, Costs on this tour, Ready to close? checklist, **Close tour → Settlement (human confirms)**) + LDT-6 Settlement (driver + company settlement on close, frozen, PDF, JE) — Costs footer, Pre-Settlement and Settlement read the same readout.
- **CURSOR:** RT-RESTORE (02:30Z) → **LDT-7 Audit in English** (05:00Z, guard 8068, surrender CC-2).
- **CC-3:** TPB-RESTORE (02:30Z) → **LDT-3 Driver Pay** (06:00Z, guard 8060, surrender CC-1). SETL-LINES-GL de2d4a8c received — lead audit pending (prod writes: 3 expenses voided, 3 reimbursements created on 5772).
- **CODEX:** TEL-42 (03:30Z) → **LDT-2 Stops** (06:00Z, guard 8058, surrender CC-3).
- **CASCADE/DEVIN:** LST-CUST-ACT (04:00Z) → **LDT-4 Factoring** (06:00Z, guard 8062, surrender Cursor).
- **CC-1:** ACC-50 (04:00Z) → posting_hold pill on the Costs cards (with lead). **CC-2:** DSP-48b (03:30Z) → Load costs page registers (Fuel advances · Broker advances · Driver pay · Documents) in the .ldt-* design + fix the stale on-time guard.
Full item text for LDT-2/3/4/7: the register § LDT-n (unchanged) + this round's additions: .ldt-* palette mandatory (no hex — guard), unknown numbers render "—" never 0, every box a pop-up, receipts via ReceiptAttach.


---
# 2026-09-06 02:00Z — OWNER RULING + two items
- **Owner:** every settlement line carries a GL; "Admin fee" = wire fee / ACH fee / company-vehicle fuel → **CC-3 SETL-DED-GL** (typed deductions with bound roles, escrow → driver's own liability sub-account; retype 5772's three lines from source, unknown stays pending) — after TPB-RESTORE, before LDT-3. Deadline 05:00Z. Surrender CC-1.
- **CC-2 LCB-REG** (after DSP-48b — done): Dispatch → Load costs page register tabs in the .ldt-* design: Broker advances = real register (GET /api/v1/accounting/broker-advances), Documents = real register (documents.attachments + docs.file_links for the board's loads, ReceiptAttach on expense/bill rows), Driver pay = loaded × rate · empty × rate · gross per bill ("—" never 0), Fuel advances = company fuel-advance expenses (driver_id set, role company_fuel_advance_expense) + cash advances labelled; ParityTable + footerCells kept; fix the stale verify-load-costs-on-time-requires-appointment.mjs regex. Guard verify-load-costs-page-registers.mjs (--selftest swaps a register back to the note → FAIL). Deadline 05:30Z. Surrender Cascade.
- Register corrections (CC-2 report): wizard Google-reference line shipped by Cursor #20801; yard service by Codex TEL-42; DSP-48b persisted the legs incl. the empty leg from the yard service.

---
# 2026-09-06 02:25Z — LDT-5/6 LIVE · Round Trips measured · ROUND 7 items (lead)
- **LDT-5 + LDT-6 LIVE:** #20828 8a60a0cd + #20831 67bded37 — `GET /api/v1/loads/:id/tour-readout` · `POST /pre-settlements/:id/close-tour` (office role, confirm:true, hard blockers 422, stamp + company settlement in one tx, no JE); Pre-Settlement tab = legs (NB/TR/SB) · Costs on this tour · Ready to close? (5 items) · **Close tour → Settlement (human confirms)** with confirm dialog naming soft items; Settlement tab = driver + company cards, GL per line, $/mi practical + real, frozen when closed. Root cause fixed: 15/15 open USMCA settlements had settlement_model NULL (link INSERT never set it) → migration 202613800100 + INSERT fix. Live 13526 (02:19Z): S-13646 open, legs NB 13526 · TR 13527 (cancelled, now excluded) · TR 13561 · TR 13567; totals rev $12,050 / costs $4,866.23 / pay $2,038.08 before exclusion; ready 0 of 5; Close disabled with blocker "no SB leg on this tour yet".
- **Round Trips — Cursor's "already satisfied" REJECTED on measurement:** live 02:15Z every bar stacked on SEPT-05 one day wide (T152: 7 loads on one day). Cause `roundTripsLegs.ts:55-57 loadSpanStartMs = created_at` (since GO-RT-01 22a26613). → **CURSOR RT-FIX** (04:00Z) + convert LoadAuditTab raw <table> (go26 ratchet red on main: LoadAuditTab.tsx + LoadStopsRecordTab.tsx → 41→43).
- **Received DONE (audit pending):** Cursor LDT-7 d2b02e28 · CUR-2 cda6f7b4 (accepted; register missed it) · Codex TEL-42 c2114c9a + LDT-2 #20805 · Cascade LDT-4 bd00b7ca · CC-1 ACC-50 637473ab + ACC-50b 78424b90 · CC-3 SETL-LINES-GL de2d4a8c · CC-2 DSP-48b.
- **ROUND 7:** Cursor RT-FIX → (CUR-2 done). Codex **TEL-43** real driven miles segments (05:30Z). Cascade **LDT-D** Documents tab (05:30Z). CC-1 **ACC-51** lists receipt + hold pill + posted-while-open review page (05:00Z). CC-2 LCB-REG (05:30Z). CC-3 TPB-RESTORE → SETL-DED-GL → LDT-3.
- **Pre-existing CI reds on main, routed:** go26 raw tables (Cursor/Codex tabs); phantom-relation-guard geofence tables (CC-3); on-time guard stale regex (CC-2 LCB-REG).
