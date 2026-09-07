# ★ DEVIN (non-A)

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

**22:43Z — LEAD. Shared with Cascade — ONE item, one PR between you:**

## CASCADE / DEVIN — item LST-DUP · duplicate master-records report (Lists/Reports)
- **Measured (READ-FIRST §6, live 09-03; CC-3 today):** `mdata.drivers` 264 rows with duplicates ANGEL ALFONSO SOSA ×3, Raul Esmeregildo Perez ×3, Armando Perez ×3, Ruben Pedro Perez Garcia ×2; CC-3 22:2xZ: Hugo Gaytan and Genaro Guerrero duplicated with one open/unposted settlement and no vendor on the shadow row. No screen lists duplicates today.
- **Required value:** `GET /api/v1/reports/duplicate-masters?entity=drivers|customers|vendors` — groups by normalized name (upper, accents stripped, whitespace collapsed) + secondary key (license no. / MC# / EIN when present), returns group, row ids, which row has money (bills, settlements, invoices, vendor rows), which is newest. Report page under `pages/reports/DuplicateMastersReport.tsx` with entity switch, CSV + Print (your existing parity), row click → the record. Read-only; merging/voiding is NOT in this item.
- **Guard:** `scripts/verify-duplicate-masters-report.mjs` — live: drivers report returns ≥ 4 groups today (the four named + Gaytan/Guerrero); `--selftest` plants a case-sensitive grouping bug and must fail.
- **Linkage:** mdata.drivers / customers / vendors ↔ driver_finance.driver_bills ↔ accounting.invoices/bills.
- **One PR.** **Deadline 01:00Z.** **Surrender:** Codex.

---
Lead audits each DONE line on Neon + tip + live within 30 minutes; ✔/✗ posted on OUTBOX-<SEAT>. A PR outside your item is closed unmerged.

---

Redirect → **INBOX-DEVIN-A.md**. Retired. NEVER POST Book Load.


## 2026-09-06 00:10Z — LEAD → this seat (round 5 audit + round 4 item). Full text: docs/bus/ONE-ITEM-INSTRUCTIONS-ALL-SEATS-2026-09-05.md § AUDIT round 5 / ROUND 4.
- Same as INBOX-CASCADE: RPT-06 ✗ → RPT-06b, deadline 02:30Z.


## 2026-09-06 01:05Z — LEAD → ROUND 5 item for this seat. Full text: docs/bus/ONE-ITEM-INSTRUCTIONS-ALL-SEATS-2026-09-05.md § ROUND 5.
- Same as INBOX-CASCADE: **LST-CUST-ACT**, 04:00Z.


## 2026-09-06 01:45Z — LEAD (ROUND 6): see ONE-ITEM-INSTRUCTIONS § ROUND 6.
- Same as INBOX-CASCADE.
