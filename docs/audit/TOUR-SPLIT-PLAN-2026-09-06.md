# TOUR-SPLIT-PLAN — 2026-09-06 (CC-3, ROUND 9, READ-ONLY)

**Status: PROPOSAL ONLY. Nothing in this document has been applied. No writes were made to
produce it.** Live reads only (`SELECT set_config('app.bypass_rls','lucia',true)` in a rolled-back
transaction), plus a read of `docs/bus/settlement-entry-2026-09-04/IH35-BY-LOAD-20260904-WITH-DIESEL_1.xlsx`
sheet **"USMCA BY LOAD"**. Verified 2026-09-06, Neon `br-fancy-credit-akjnd07a`.

## 0. The fact, verified

The seed created **one `driver_finance.driver_settlements` row per DRIVER** (15 open USMCA rows,
`display_id` S-13642…S-13656, all `trip_started_at` = 2026-09-05, all `settlement_model =
'load_bookended'`, all `status = 'open'`). The **signed source is one settlement per TRIP**
(17 distinct settlement numbers found in the "USMCA BY LOAD" sheet's col C — 5769, 5771–5777,
5779–5787 — a driver with multiple trips has multiple signed settlement numbers, all currently
merged onto their one mega-tour row).

Root cause, read from the code (not guessed): `apps/backend/src/dispatch/presettlement-link.service.ts`'s
`suggestPresettlementLink` — the REAL, live booking-time linker — resolves an NB leg to **always
start a new settlement** and a TR/SB leg to **join the OPEN settlement for the same `mdata.loads.tour_id`**.
That logic, run correctly, would already produce one settlement per real trip. The seed did not go
through it; loads here carry **multiple distinct live `tour_id` values under one settlement row**
(e.g. S-13642 has loads with two different `tour_id`s), and — more importantly — **two loads
that share the SAME live `tour_id` can carry two DIFFERENT signed settlement numbers** (S-13643's
`tour_id=06de22b5-…` covers both settlement 5774's load 13518 *and* settlement 5784's loads
13528/13536). **`mdata.loads.tour_id` is not a reliable grouping key here** — it is itself a seed
artifact, not a real dispatch-assigned relay boundary. The only trustworthy grouping key in this
plan is the **signed settlement number from the "USMCA BY LOAD" sheet**.

## 1. Mapping: signed settlement # → loads → current link → proposed target

Source: "USMCA BY LOAD" sheet, col C ("Settl #") / col D ("Load #"), row type `LOAD` only (36 rows
total; 17 carry a settlement number — the rest are `Dispatched`/not yet signed). Current link =
live `mdata.loads.presettlement_link_id` joined to `driver_finance.driver_settlements.display_id`.

**Rule used to decide which signed number KEEPS the existing mega-tour row** (never move a
HOLD load, ever): if one of the settlement numbers sharing a mega-tour owns one of the owner's 8
hand-list loads, that number keeps the row in place (zero writes to its loads). Only the
*other* signed number(s) on that mega-tour get a brand-new row + a `presettlement_link_id`
repoint of their (non-HOLD) loads. Where no HOLD load is involved, the numerically lower / more-
loaded settlement is proposed to keep the row — **flagged explicitly as arbitrary and open to lead
override**, since nothing in the source data says which one is "the" tour.

| Signed # | Loads | Driver | Current mega-tour | Proposal | HOLD? |
|---|---|---|---|---|---|
| 5769 | 13508 | Angel Alfonso Sosa Perez | **none** — `presettlement_link_id IS NULL` (an orphan; load is `trip_type='SB'`, `status='assigned_not_dispatched'` — consistent with the round's own "zero SB legs on any tour" fact) | **NEW** settlement, driver Angel Alfonso Sosa Perez; link load 13508 to it (a link, not a repoint — it has no current link to move away from) | no |
| 5771 | 13510 | Jorge Luis Infante Corona | S-13645 (shared with 5777, 5783) | **NEW** settlement; repoint 13510 | no |
| 5772 | 13512, 13513 | Pedro Abraham Lopez Collado | S-13654 (only signed # on this mega-tour) | **KEEP S-13654 in place**; tag `source_document_ref='5772'` | **YES** (13512, 13513) |
| 5773 | 13511 | Concepcion Cordova Dominguez | S-13642 (shared with 5786) | **KEEP S-13642 in place** (arbitrary — lower number, no HOLD load either side); tag `source_document_ref='5773'` | no |
| 5774 | 13518 | Jose Antonio Vicente Martinez | S-13643 (shared with 5784, which owns HOLD loads) | **NEW** settlement; repoint 13518 (5784 keeps S-13643 because it owns HOLD loads 13528/13536) | no |
| 5775 | 13514, 13516 | Alfonso Hidalgo Chavez | S-13644 (shared with 5787) | **KEEP S-13644 in place** (arbitrary — more loads, no HOLD load either side); tag `source_document_ref='5775'` | no |
| 5776 | 13520 | Leonel Antonio Morales | S-13647 (shared with 5781) | **KEEP S-13647 in place** (5776 owns HOLD load 13520 — never repoint it); tag `source_document_ref='5776'` | **YES** (13520) |
| 5777 | 13519, 13521 | Jorge Luis Infante Corona | S-13645 (shared with 5771, 5783) | **NEW** settlement; repoint 13519, 13521 (5783 keeps S-13645 because it owns HOLD loads 13535/13537) | no |
| 5779 | 13526 | Luis Armando Sosa Perez | S-13646 (only signed # on this mega-tour) | **KEEP S-13646 in place**; tag `source_document_ref='5779'` | no |
| 5780 | 13532 | Rafael Rogelio Rivero Reynoso | S-13655 (only signed # on this mega-tour) | **KEEP S-13655 in place**; tag `source_document_ref='5780'` | **YES** (13532) |
| 5781 | 13523, 13534 | Leonel Antonio Morales | S-13647 (shared with 5776, which owns HOLD load 13520) | **NEW** settlement; repoint 13523, 13534 | no |
| 5782 | 13529 | Hugo Gaytan Sarabia | S-13648 (only signed # on this mega-tour) | **KEEP S-13648 in place**; tag `source_document_ref='5782'` | no |
| 5783 | 13535, 13537 | Jorge Luis Infante Corona | S-13645 (shared with 5771, 5777) | **KEEP S-13645 in place** (5783 owns HOLD loads 13535/13537); tag `source_document_ref='5783'` | **YES** (13535, 13537) |
| 5784 | 13528, 13536 | Jose Antonio Vicente Martinez | S-13643 (shared with 5774) | **KEEP S-13643 in place** (5784 owns HOLD loads 13528/13536); tag `source_document_ref='5784'` | **YES** (13528, 13536) |
| 5785 | 13538, 13543 | Genaro Guerrero Chavez | S-13649 (only signed # on this mega-tour) | **KEEP S-13649 in place**; tag `source_document_ref='5785'` | no |
| 5786 | 13548 | Concepcion Cordova Dominguez | S-13642 (shared with 5773) | **NEW** settlement; repoint 13548 | no |
| 5787 | 13549 | Alfonso Hidalgo Chavez | S-13644 (shared with 5775) | **NEW** settlement; repoint 13549 | no |

**Totals: 17 signed settlement numbers → 10 keep their existing mega-tour row (metadata tag only,
zero load repoints) + 7 need a brand-new `driver_finance.driver_settlements` row (9 loads
repointed/linked total: 13508, 13510, 13518, 13519, 13521, 13523, 13534, 13548, 13549 — none of
them a HOLD load).**

Five mega-tours are untouched by any signed number today (S-13650, S-13651, S-13652, S-13653,
S-13656 — every load on them is either cancelled or not yet signed) — nothing to propose for them
this round.

### 1a. `display_id` is generated — cannot carry the signed number

`display_id` is produced by `presettlement-link.service.ts`'s `allocateNextSettlementDisplayId`,
which draws from the **same shared LOAD/`S-` sequence** `dispatch/load-id-reservation.service.ts`'s
`allocateNextLoadNumber` uses for load numbers (`S-<n>`) — a deliberate, explicit prior decision
(PS2: "No settlement doc type in `lib.trace_counters`... one convention with LD/LOAD," i.e. never
mint a second counter). It cannot be repointed to read "5772" without colliding with that shared
counter or breaking the one-convention rule.

**Proposal: add `driver_finance.driver_settlements.source_document_ref text NULL`** (additive,
nullable, no default requirement on existing rows) to carry the signed number (`'5772'`, `'5786'`,
…) alongside the existing `display_id` (`S-13654`, `S-13791`, …) — never replacing it. This is a
migration and is **NOT authored or applied here** (CC-3 has no migration lane, same standing
constraint as `BANK-FEE-RECOVERY-*` this round) — flagged to the board for a migration-lane seat,
same handoff shape as the bank-fee-recovery drafts.

## 2. Cancelled-leg handling — confirmed, not changed

**29 of the 77 currently-linked loads (37.7%) are `status='cancelled'`.** Confirmed live (`SELECT
count(*) FILTER (WHERE l.status='cancelled') FROM mdata.loads l JOIN driver_finance.
driver_settlements ds ON ds.id = l.presettlement_link_id WHERE l.operating_company_id = <USMCA>`)
and matching the round's own "Fact" line exactly.

Confirmed by reading `apps/backend/src/driver-finance/tour-readout.routes.ts` (`buildTourReadout`,
the ONE reader both the Load-costs Pre-Settlement/Settlement tabs and `GET /api/v1/driver-finance/tours`
share):

- Line 128: `CANCELLED = new Set(["cancelled","canceled","abandoned","driver_walkoff","driver_no_show"])`.
- Line 130–131: a cancelled leg's `revenue` is forced to `0` (`cancelled ? 0 : n(r.rate_total_cents)`)
  — this is the exact LDT-5/6 fix already shipped this round (TR 13527's $3,000 phantom revenue).
- Line 133: `is_cancelled` is stamped on every leg row and **the leg itself is never dropped** — it
  stays in the tour's leg list (visible for history).
  It is only removed from `active`/`live` derived sets — line 210 (`legs.filter((l) => !l.is_cancelled)`)
  and line 299 (`r.legs.filter((l) => !l.is_cancelled)`) — i.e. every rollup/checklist that consumes
  those derived sets already excludes cancelled legs from money and from the "ready to close" count.

**Confirmed: cancelled loads already stay linked for history and are already excluded from
totals. No code or data change is proposed for this.** The plan above (§1) does not touch a
cancelled load's link at all — every repoint/link in §1 targets a `dispatched` load only.

## 3. Owner hand-list — HOLD, never touched by this plan

| Load | Signed # | Current settlement | This plan's action |
|---|---|---|---|
| 13512 | 5772 | S-13654 | none — tag-in-place only, load itself untouched |
| 13513 | 5772 | S-13654 | none — tag-in-place only, load itself untouched |
| 13520 | 5776 | S-13647 | none — tag-in-place only, load itself untouched |
| 13528 | 5784 | S-13643 | none — tag-in-place only, load itself untouched |
| 13532 | 5780 | S-13655 | none — tag-in-place only, load itself untouched |
| 13535 | 5783 | S-13645 | none — tag-in-place only, load itself untouched |
| 13536 | 5784 | S-13643 | none — tag-in-place only, load itself untouched |
| 13537 | 5783 | S-13645 | none — tag-in-place only, load itself untouched |

Every HOLD load lands in a "KEEP in place" row in §1 by construction of the keep/carve rule — this
plan **never proposes a `presettlement_link_id` write, a status write, or any other write to any
of these 8 loads.**

## 4. Open questions — RESOLVED (owner ruling, 2026-09-06)

All four are ratified. Verbatim ruling quoted per question; nothing below was guessed at, and the
Q4 guardrail the ruling asked for was run live before this plan doc was updated.

1. **Un-signed loads sharing a split mega-tour — CONFIRMED, default accepted.** "leave them on the
   KEPT settlement, do not repoint... Repointing now would be a guess the data can't support...
   When each of these loads later closes and gets its own signed number, it gets its own
   settlement then — no data is lost, nothing is destroyed, and the choice stays reversible."
   No change to §1's plan.
2. **Arbitrary "keep" tiebreak — CONFIRMED, lower signed number wins, permanently.** "KEEP the
   lower signed number (the plan's rule)... Pick the deterministic rule and never revisit it...
   Don't invent a 'trip-progress' tiebreak (none have `trip_closed_at` progress, so it resolves to
   nothing anyway)." §1's 5773-over-5786 and 5775-over-5787 choices stand as written, no longer
   flagged as arbitrary — they are now the LAW for any future tie of this shape, not a one-off pick.
3. **`source_document_ref` migration — ASSIGNED to CC-1, draft ready.** "DO IT, and it's the gating
   item... Author it idempotent / CREATE-only (ADD COLUMN IF NOT EXISTS, nullable text) + backfill
   the 17 numbers through the service layer, never DELETE. Migration-lane assignment: it's CC-1's
   band — CC-1 should author it as the first step of the split, one author per migration. --apply
   stays hard-refused until this lands + lead ✔." Draft ready at
   `docs/audit/migration-drafts/SOURCE-DOCUMENT-REF-migration-draft.sql` (same ready-to-apply
   handoff shape as this round's `BANK-FEE-RECOVERY-*` drafts) — a single additive
   `ADD COLUMN IF NOT EXISTS source_document_ref text NULL`, idempotent, fresh-DB safe, no RLS/grant
   change. The backfill itself (17 numbers, through whatever settlement-update service function
   exists once the column is queryable, never raw SQL) is NOT written yet — it cannot be
   verified against a column that does not exist, and the ruling gates `--apply` behind it landing
   first regardless.
4. **Settlement 5769's orphan load 13508 — CONFIRMED independent new settlement, guardrail run and
   PASSED.** Ruling: "make it a fully independent new settlement... The one guardrail: before
   apply, confirm 13508's revenue/driver-pay is carried in signed 5769 and is not already inside
   S-13652's signed amount, so the SB isn't double-counted." Verified live 2026-09-06 (same
   `BEGIN; SELECT set_config('app.bypass_rls','lucia',true); …; ROLLBACK;` discipline as the rest of
   this plan):
   - The "USMCA BY LOAD" sheet's settlement-5769 rows (LOAD/CHARGE/EXPENSE/DEDUCTION/FUEL, rows
     2–8) name load 13508 **exclusively** — no other load number appears under settl 5769 anywhere
     in the sheet. 5769's signed total is 13508's own figures, nothing else.
   - `driver_finance.settlement_lines WHERE settlement_id = <S-13652's id>` returns 8 rows across
     exactly 4 load_ids — `b7a92e7f…`, `0602ce28…`, `fe6efd8c…`, `6c3cc008…` — **none of them is
     13508's load id** (`926f4142-3fe4-4aa5-b896-daa0ca6474c4`). `settlement_lines WHERE load_id =
     926f4142…` returns **0 rows** anywhere in the system.
   - 13508 itself carries two `driver_bills` rows: one `void` ($709.49, an already-corrected prior
     figure — void-not-delete, not touched here) and one `open` ($633.46) — neither is linked to
     any settlement (`settlement_lines` has 0 rows for it, confirmed above).
   - **Guardrail PASSED: 13508's revenue/driver-pay is not double-counted anywhere today.** §1's
     plan for 5769 stands as written.

## 5. The dry-run script

`scripts/ops/split-seed-tours.ts` — follows `scripts/seed-settlements-cc-3.ts`'s conventions (real
service functions only, `--dry-run` default, `--apply` hard-refused this round). It reads the same
xlsx sheet + live DB and derives exactly the plan in §1 (machine-derived, not hand-transcribed —
this document's table was generated by running it, its own output pasted below). See its own
header comment for the real service functions the eventual `--apply` would call
(`confirmPresettlementLink`'s `create_new`/`link_existing` actions — the SAME functions
`presettlement-link.service.ts` already exports and book-load already uses; no new write path).

### Dry-run output (2026-09-06, Neon `br-fancy-credit-akjnd07a`)

```
$ DATABASE_URL=<Neon prod> npx tsx scripts/ops/split-seed-tours.ts --dry-run


=== TOUR-SPLIT-PLAN dry-run ===

Settlement 5769 (Angel Alfonso Sosa Perez) — loads: 13508
  current: UNLINKED
  action:  NEW — no current presettlement_link_id — never linked (orphan)

Settlement 5771 (Jorge Luis Infante Corona) — loads: 13510
  current: S-13645
  action:  NEW — carved out of S-13645 (kept by settlement 5783)

Settlement 5772 (PEDRO ABRAHAM LOPEZ COLLADO) — loads: 13512, 13513
  current: S-13654
  action:  KEEP — only signed settlement number on this mega-tour

Settlement 5773 (Concepcion Cordova Dominguez) — loads: 13511
  current: S-13642
  action:  KEEP — arbitrary (lower number) — no HOLD load either side, flag for lead override

Settlement 5774 (JOSE ANTONIO VICENTE MARTINEZ) — loads: 13518
  current: S-13643
  action:  NEW — carved out of S-13643 (kept by settlement 5784)

Settlement 5775 (ALFONSO HIDALGO CHAVEZ) — loads: 13514, 13516
  current: S-13644
  action:  KEEP — arbitrary (lower number) — no HOLD load either side, flag for lead override

Settlement 5776 (Leonel Antonio Morales) — loads: 13520
  current: S-13647
  action:  KEEP — owns a HOLD load — never repointed

Settlement 5777 (Jorge Luis Infante Corona) — loads: 13519, 13521
  current: S-13645
  action:  NEW — carved out of S-13645 (kept by settlement 5783)

Settlement 5779 (LUIS ARMANDO SOSA PEREZ) — loads: 13526
  current: S-13646
  action:  KEEP — only signed settlement number on this mega-tour

Settlement 5780 (Rafael Rogelio Rivero Reynoso) — loads: 13532
  current: S-13655
  action:  KEEP — only signed settlement number on this mega-tour

Settlement 5781 (Leonel Antonio Morales) — loads: 13523, 13534
  current: S-13647
  action:  NEW — carved out of S-13647 (kept by settlement 5776)

Settlement 5782 (HUGO GAYTAN SARABIA) — loads: 13529
  current: S-13648
  action:  KEEP — only signed settlement number on this mega-tour

Settlement 5783 (Jorge Luis Infante Corona) — loads: 13535, 13537
  current: S-13645
  action:  KEEP — owns a HOLD load — never repointed

Settlement 5784 (JOSE ANTONIO VICENTE MARTINEZ) — loads: 13528, 13536
  current: S-13643
  action:  KEEP — owns a HOLD load — never repointed

Settlement 5785 (Genaro Guerrero Chavez) — loads: 13538, 13543
  current: S-13649
  action:  KEEP — only signed settlement number on this mega-tour

Settlement 5786 (Concepcion Cordova Dominguez) — loads: 13548
  current: S-13642
  action:  NEW — carved out of S-13642 (kept by settlement 5773)

Settlement 5787 (ALFONSO HIDALGO CHAVEZ) — loads: 13549
  current: S-13644
  action:  NEW — carved out of S-13644 (kept by settlement 5775)

TOTAL: 17 signed settlement(s) — 10 KEEP in place (tag only), 7 NEW (9 load(s) to repoint/link)
HOLD-load safety check: PASS — no HOLD load appears in any NEW/repoint row
```

## 6. Nothing applied

No `INSERT`, `UPDATE`, or `DELETE` was executed against `driver_finance.driver_settlements` or
`mdata.loads` to produce this document. Every query above ran inside `BEGIN; SELECT
set_config('app.bypass_rls','lucia',true); …; ROLLBACK;`. `scripts/ops/split-seed-tours.ts --apply`
is refused unconditionally this round (see its own header) — it requires the lead's ✔ quoted
verbatim in a future PR before any write path is even reachable.

## 7. Ratified sequencing for the eventual `--apply` (owner ruling, 2026-09-06)

1. CC-1 lands the `source_document_ref` migration on Neon (draft ready, §4 item 3).
2. The lead re-measures the 17-signed-settlement map against live data at that point (this plan's
   numbers are a 2026-09-06 snapshot — re-verify, never assume stale is still true).
3. `scripts/ops/split-seed-tours.ts --apply` runs through the EXISTING
   `confirmPresettlementLink`'s `create_new` / `link_existing` actions only — the same functions
   `book-load.service.ts` already calls at booking time, no new write path, fully reversible
   (void-not-delete throughout), WORM-audited. 10 settlements keep their row (tagged via
   `source_document_ref` only) / 7 get a new row / 9 loads repointed or linked / 0 HOLD loads
   touched — the keep/carve rule in §1 already guarantees a HOLD load can never appear in a
   repoint, and `split-seed-tours.ts`'s own safety check throws if that guarantee is ever violated.

`--apply` remains hard-refused (its `LEAD_APPROVAL_QUOTE` gate, plus the missing column) until
steps 1–2 above are both true.
