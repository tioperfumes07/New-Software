> MIRROR of the Claude project document 00-IH35-CURRENT-STATE-AND-LAW-READ-FIRST.md.
> The project copy is canonical; the lead re-syncs this file when it changes.
> Mirror revision: live-verified 2026-09-05 00:10. Re-synced 2026-09-05 by Cascade.

# IH35-TMS — CURRENT STATE AND LAW
**The one document to read first. Written 2026-09-02, live-verified 2026-09-05 00:10.**

Every number in section 6 was read from live production. Every code reference was read from the
repository. Nothing here is from memory.

---

## 0. THE FINISH LAW — owner order, 2026-09-03. PERMANENT AND STRICT.

**A seat that begins a task finishes it before it begins anything else.**

Coding, wiring, building, migrating, sweeping — whatever it is, once a seat starts, that task owns
the seat until it is COMPLETE. Not "batch 6 of 11." Not "REMAINING: the tail." Complete.

**Complete means the definition of done in §0 of the standards skill:** the file exists, the route is
mounted, the migration is applied on production, the column is populated, the guard is written AND
wired into `scripts/verify-steps/`, and there is live proof. Merged is not done. CI-green is not
done. A surface that renders is not done.

**The one permitted interruption.** If another seat is blocked and needs a quick fix, the seat may
stop, make that fix, finish it to the same standard, and then **return to the original task
immediately**. It does not pick up a third thing. It does not start something new because the
original got boring or hard.

**What this law forbids, by name:**
- Leaving a numbered batch series half-run and moving to another module.
- Reporting `REMAINING:` on your own task and then taking a different assignment.
- Opening a new finding class while your current one is unclosed.
- "Parked", "deferred to next pass", "will pick up later" — on your own work.
- Splitting one task across seats mid-flight because it got long.

**If a task genuinely cannot be finished** — it needs an owner decision, another seat's migration
lane, or a column that does not exist — the seat says so IN WRITING, names the exact blocker, and
only then may it take new work. A blocker that cannot be quoted does not exist.

**Why this is law.** Six seats each 70% finished is zero finished features and six surfaces nobody
can trust. One seat finishing one thing is one thing that works. The register is long because work
was started, reported, and abandoned at the last 20%.

---

## 0b. SEAT OWNERSHIP — owner order, 2026-09-03. PERMANENT.

**One seat owns one surface. It builds the whole block — design, code, money wiring, guards, live
proof. No job is split across seats.**

**FIND IT, FILE IT, DO NOT FIX IT.** A seat WILL find a genuine bug outside its surface. Fixing it
is a violation **even when the fix is correct**, because the owner of that file gets an edit they
did not make in a file they are mid-way through. Post the finding to the owning seat and keep going.

| Seat | Surface | Money |
|---|---|---|
| Cursor | `pages/dispatch/**`, `components/dispatch/**`, `book-load.service.ts` | Yes |
| CC-1 | `pages/accounting/**`, `backend/accounting/**`, `dispatch/mileage/**`, `lane-mileage.service.ts` | Yes |
| CC-2 | `pages/banking/**`, `backend/banking/**` | Yes |
| CC-3 | `pages/safety/**`, `backend/compliance/**`, `backend/telematics/**`, `backend/integrations/samsara/**`, `jobs/geofence-*` | **No** |
| Codex | `pages/maintenance/**`, `backend/maintenance/**` | **No** |
| Cascade | `pages/lists/**`, `pages/reports/**` | **No** |

Enforced by `.github/CODEOWNERS` plus `scripts/verify-steps/verify-seat-surface-ownership.mjs`.

**Telematics, Samsara and geofencing were an UNOWNED surface until 2026-09-05.** Nobody's row
covered `backend/telematics/**`, `backend/integrations/samsara/**` or `jobs/geofence-*`, which is
part of why the geofence engine ran broken for months with nobody responsible for it (§8, the
shared-state trap). Added to CC-3 because it is sensor and compliance-adjacent and carries no
money. The owner may move it; until he says otherwise it is CC-3's.

One escape hatch only: `SURFACE-BREACH-AUTHORIZED: <owner seat> <reason>`, which the owning seat
must post first.

**Why this is law.** `BookLoadModalV4.tsx` took **28 commits in 48 hours from four seats** — one of
them (`5a147c0f0`, +92 −128) literally titled "Book Load layout restore," a seat undoing another
seat's field move. `RoundTripsTimeline.tsx` was built by Cursor on Aug 29 (+164 new) and cut by
another seat on Aug 30 (+79 −123). That is the regression mechanism.

**The money contract binds the three money seats:** `REFERENCE/MONEY-CONTRACT-ALL-SEATS.txt`,
shipped 2026-09-03 in `docs/bus/packets/2026-09-03-16-P0-SEND/`. Integer cents. Every GL write
through `journal-entries.service`. Double entry or it does not post. Two-line driver pay.
Attribution rungs. Every money row traces to a document. **Where surfaces meet, the downstream seat
READS — it does not re-derive.**

**AMENDED 22:43Z — owner order, verbatim: "cursor is a fucking idiot" · "you are lead again."** Claude Lead is registrar, auditor AND deployer from 22:43Z. Cursor builds on its own vertical only and no longer deploys (its 20-minute timer failed for 3 h 03 m on 2026-09-05, 19:37Z→22:40Z). The single register is `docs/bus/ONE-ITEM-INSTRUCTIONS-ALL-SEATS-2026-09-05.md` (+ successors) maintained by Claude Lead; OWNER-ISSUE-INVENTORY and PENDING-REGISTER remain its sources. Method (one item per seat, done bar, no Chrome until module complete) unchanged.

---

## 1. SCOPE

**USMCA is the only company in scope.** `5c854333-6ea5-4faa-af31-67cb272fef80`.

TRANSPORTATION (`91e0bf0a-133f-4ce8-a734-2586cfa66d96`) and TRUCKING
(`b49a737b-6cf0-43bb-8758-a6c8ff8a2c4e`) are **frozen**. Do not read them. Do not write them.
Do not report on them.

**Owner ruling 2026-09-04: IH35 Transportation is not operating. The trucks, the drivers and the
loads belong to USMCA only.** TRANSPORTATION is a historical ledger, not a carrier. This settles
the entity question on every AlwaysTrack artifact: those exports and settlement PDFs carry the
"IH35 Transportation, LLC" letterhead and the export tags loads TRANSPORTATION — **that is the
legacy AlwaysTrack carrier record, not the operating entity.** The operating reality is one
carrier. It does not license writing AlwaysTrack history into USMCA production — the
reference-only rule in §2 stands unchanged.

Production is Neon project `tiny-field-89581227`, branch `br-fancy-credit-akjnd07a`.
Every read requires `SET LOCAL app.bypass_rls = 'lucia'`. A bare 0 under forced RLS is **MASKED,
not empty** — re-run before it is a verdict.

**Pre-flight before any built/done/pending claim:** list open PRs AND branches (work is usually in
an open PR, never judge from `main` alone), then the live DB count under bypass. Name which you ran.

---

## 2. STANDING OWNER DECISIONS

Rulings, not findings. They do not expire and are not re-litigated.

| Decision | Ruling |
|---|---|
| Who decides | **There is no CPA.** The owner is the sole financial decision authority. No `JORGE-APPROVED` label, no HOLD gate. Never re-introduce them. |
| Capitalize threshold | **$7,000.** At or above capitalizes; under expenses. Confirmed 2026-09-02. Supersedes the $2,500 in the older standards skill. |
| USMCA opening balances | **Zero.** TMS-authoritative from day one. There is no opening entry to make. |
| **USMCA ledger cleared** | **Deliberate, by the owner, before go-live.** USMCA's entire general ledger was voided and cleared so the entity begins genuinely clean — verified 2026-09-03: expenses 0, bills 0, invoices 0, journal entries 0, fuel transactions 0. **This is a decision, not a gap.** Nothing is missing and nothing is to be recovered. Do not hunt for it, do not migrate history in, do not raise it as a finding. The first USMCA transaction will be the owner's first hand-entered load. |
| **Guards before the first row** | Because the ledger is empty by design, **every money rule is enforced from row one rather than retrofitted.** `unit_id` mandatory on expenses, double entry, integer cents, two-line driver pay, attribution rungs — the guards land BEFORE the first transaction exists. The 27,070 frozen-entity expenses carrying no truck, no load and no driver on any row are the demonstration of what retrofitting costs. |
| **AlwaysTrack historical exports** | **Reference only, never import.** All seven load-history exports are "Invoiced By IH35 Transportation, LLC" — a frozen entity. They usefully describe field SHAPE and trip patterns; they are not USMCA data and must never be written into it. **There is no USMCA backfill of any kind** — not expenses, not tours, not lanes. |
| Bank history to categorize | **December 2025 through July 2026**, by the owner. |
| Escrow | **Wiped. Begin from zero.** Zeroed by void, never deleted. |
| Sample and demo data | **All removed.** Marked and quarantined, never destroyed. |
| QuickBooks write-back | **Never.** Reconcile only. |
| GL posting flags | **Intentionally ON.** Design, not misconfiguration. Never raise as a defect. |
| Period close | **Owner only.** |
| Deletion | **Nothing is ever permanently deleted.** Every void keeps a register. |
| Neon migrations | **Coders apply them.** The owner does not hand-apply. |
| Feature flag flips | **Owner only.** |
| Load number | **Plain.** No letter prefix, no date block. |
| Driver pay basis | **Short miles.** Two lines always — loaded and empty. `rate_empty_per_mile_cents` is its own config value; it equals the loaded rate today and that equality is never hardcoded. |
| **Driver advances — the three paths** | Owner ruling 2026-09-04, verbatim: *"we never send fuel advance to a driver, very rarely from the company. the broker might send us a cash advance to the driver, for the diesel fuel and deducts from the invoice. or it might send the driver money and we apply it as a bill payment to the driver. the fuel advance from us to the driver is a company expense. he is a company driver, not an owner operator."* **Three distinct events, never collapsed.** (1) **Broker → us**, diesel for the driver, deducted from the invoice — `accounting.broker_advances` category `diesel`; applies to `invoices.broker_advance_applied_cents`, reduces what the factor purchases, never the invoice face, never `driver_finance.*`. BUILT AND CORRECT — do not rewrite. (2) **Broker → the driver directly**, applied by us as a bill payment against his driver bill — the receipt side reduces what the factor purchases exactly as (1), the disbursement side settles part of `driver_finance.driver_bills`, both linked to the SAME `broker_advances` row by `instrument_reference`. One instrument, two sides, one trace. **NOT BUILT — this is the gap.** (3) **Us → the driver**, a fuel advance: **a COMPANY EXPENSE.** Rung 1 direct trace, DR fuel expense CR bank, and that is the whole entry. **There is no receivable from the driver, no `outstanding_balance`, no `recovered_in_settlement_id`, no amortization** — he is a B1 employee, not an owner-operator. For USMCA `economic_routing` resolves to `load_expense`; `driver_settlement` must be unreachable for a company driver, enforced at the SERVICE boundary, never only in React. |
| **Operating entity** | **USMCA only. IH35 Transportation is not operating** — ruled 2026-09-04. Its trucks, drivers and loads are USMCA's. TRANSPORTATION remains a frozen historical ledger. AlwaysTrack letterhead and its TRANSPORTATION load tags are legacy carrier records, not the operating entity, and never a reason to split a report by entity. |
| Deadhead | **A trip property, never a lane average.** Computed from the truck's previous delivery, chained across all entities. Blank when unknown — never zero. **Attribution settled 2026-09-03: deadhead belongs to the load that PICKS UP** — pickup-side matched 58/117 against the owner's own Empty Mi column, delivering-side 9/113. |
| **St. Miles is not shortest miles** | AlwaysTrack `St. Miles` = `L.Miles` + `E.Miles`, verified on 10,400 of 12,393 reference loads. **It has no destination column.** Mapping it to `miles_shortest` pays deadhead twice — once at the loaded rate inside the load line, again on the deadhead line. This caused the 2,142 impossible lanes in `catalogs.lane_mileage`. |
| **The round trip is the unit of settlement** | NB opens · TR extends (0..n) · SB closes it at Laredo. **Open = pre-settlement** (live revenue and costs). **Closed = settlement** (frozen, posts to GL, company and driver readouts). **Load costs is the cost column of the pre-settlement, not a separate feature.** Status is three states: `open` → `ready_to_close` → `closed`. Assignment is automatic and immediate; **closing is confirmed by a human, never automatic.** |
| **A tour has no unit** | A truck can break down mid-trip and dispatch swaps vehicles — still one trip, one settlement, two trucks. **The unit lives on the leg.** The real constraint is that no unit may hold two loads with overlapping active windows, enforced on loads. A trip may have more than one driver; settle each for the legs they drove, all linked to one company settlement. |
| Expense numbering | First cost on a load is the **bare load number**, then `-1`, `-2`. Single digit, never zero-padded. Derived from a per-load counter, never typed. |
| Accessorial income | **4200 Accessorial / Detention Income.** 4210 Detention, 4220 Layover, 4230 Lumper, 4240 TONU beneath it. |
| Company settlement grain | **One settlement number covering many loads**, with start and end dates. |
| Plain English | Every operator-visible surface is proper English. No underscores, no machine names, no all-capitals data. |
| Repository visibility | **`tioperfumes07/IH35-TMS` is PUBLIC, permanently.** Private metered Actions minutes, throttled CI and bottlenecked the merge queue — that bottleneck forced the FAST-MERGE 4-minute law. **Closed. Never re-raise it in any form.** What stays in scope: never commit a real secret. A 2026-09-02 scan found zero real token bodies in tracked files. |
| Column naming | `_id` is the house convention — 1,519 columns versus 79 `_uuid`; `driver_id` 125 tables versus `driver_uuid` 10. `bills.driver_id` is CORRECT. Renaming `expenses.driver_uuid` is optional and owner-decided. |
| Mileage engine | **Self-hosted OSM routing.** Certified at 0.67% median absolute error against 7,601 reference loads. **PC\*MILER is not needed and not the cause of anything** — `trimble-maps-client.ts` is geocoding only, the 30-day trial expired, `PCMILER_ENABLED` defaults off. **Google is excluded on licence** — its terms cap caching at 30 days (§19.3) and bar use with a non-Google map (§19.2); a mileage that pays a driver must be stored permanently. |
| **Flags are ON unless they are QBO flags** | Owner ruling 2026-09-05, verbatim: *"the only flags that are off by law are qbo flags."* Every other feature/provider flag ships ON in production. Measured the same day: the Book Load §C address autocomplete had been a plain text box since #1145 (06-17) because (1) `lib.feature_flags` never had a `PCMILER_ENABLED` row, (2) Render had NO `GOOGLE_PLACES_*`, `PCMILER_ENABLED` or `TRIMBLE_MAPS_*` variable at all (full A→W walk of the env list), (3) the proxy knew only Trimble, whose trial expired. Fix #20601: provider chain Trimble→Google server-side; field gates only on the backend's `enabled` answer. `GOOGLE_PLACES_ENABLED=true` set on the API service 16:50Z; `GOOGLE_PLACES_API_KEY` is owner-provided. **Google here is address lookup only — the §2 mileage exclusion stands.** |
| **Google distance = REFERENCE ONLY** | Owner ruling 2026-09-05 19:41Z, verbatim: *"it can come up on the load wizard as reference. shortest distance etc. and between stops or for deadhead"* and *"under practical miles, etc, we can use as a reference for all, to be able to compare."* Google Routes API (enabled in owner project IH35-TMS) returns per-leg distance/duration shown beside OSM practical/short in the Book Load wizard and settlement views, labelled "Google reference". Rules: (1) never written to `miles_practical`, `miles_shortest`, driver pay, customer RPM or any settlement line — the §2 mileage exclusion stands for anything that pays or bills; (2) stored only in a reference column with `fetched_at` and expired after 30 days (Google terms §19.3 cache cap); (3) it is CAR routing — no truck height/weight/hazmat/HOS — the label says so; (4) legs: yard→pickup (deadhead), pickup→delivery, each intermediate stop pair, last delivery→yard. |
| **Yard = 23918 Mines Rd, Laredo, TX 78045** | Owner 2026-09-05 23:5xZ: "PERFECT YES IT IS 23918 MINES RD." The yard is the existing USMCA geofence `188cf90c-d970-4ab0-9795-d23394b38af1` (centroid 27.65149,-99.63094). One `mdata.locations` row carries `is_ih35_yard=true` (TEL-42); Empty/deadhead legs originate there; the address picker biases there. Never a second yard row. |
| **No Samsara Places push (TEL-41 CLOSED)** | Owner 2026-09-06 00:2xZ: "OK I FOLLOW YOUR RECOMMENDATIONS." Our app is the single geofence authority; Samsara is the GPS source only. We never create/sync geofences into Samsara as Places (`POST /places`). TEL-41 closed, not held. |
| **Every settlement line carries a GL account; deductions are typed** | Owner 2026-09-06 01:5xZ: "Should each line carry a GL? Of course." Deduction types wire_fee / ach_fee → Bank Charges & Fees recovery; company_vehicle_fuel → 5000 Fuel & Diesel recovery; escrow_contribution → the driver's own 2100-00-0NN escrow liability. No `other`. Debit side 2200 Driver Settlements Payable. Unknown fee type stays pending with a reason — never guessed. |
| **Three mileage numbers, never conflated** | **PRACTICAL** = what the customer is invoiced. **SHORTEST** = what the driver is paid. **REAL DRIVEN** = the odometer, and it is the only one that costs money. Measured over the owner's 37 signed settlements: practical 113,511.8 · short 113,090.3 · real driven 119,042.7 (+5.3%, and understated — T144 has reported no telematics since 2025-07-09 yet ran settlement 5760). Cost per mile on billed miles $1.6151 versus $1.5400 on miles actually driven; margin per mile is overstated $0.0329, roughly **$3,900 in six weeks**. Real driven miles come from `telematics.vehicle_locations.odometer_mi`, captured at geofence entry and exit. |
| **Departure is detected on SPEED, not distance** | Owner ruling 2026-09-04, verbatim: *"if the truck moves at speed out of that area, then we're gonna assume if he didn't answer that, that he left."* ≥15 mph sustained 3 minutes, plus distance beyond the exit radius. Distance alone is what produced the 3,127-row flap — GPS jitter in a truck-stop parking lot looks identical to leaving. **Enter and exit radii are never equal**: enter at 0.25 mi, exit at 0.5 mi. Hysteresis is mandatory on every geofence. |
| **Silence plus movement equals departure** | A driver who is prompted on arrival and does not answer does **not** cost us the event. The prompt is closed `resolved_by='auto_movement'`, the departure is recorded anyway, and dispatch is alerted that he is unresponsive. Prompts live in `pwa.driver_prompts` and are append-only — never deleted, so "I told you" is settled by a row. |

---

## 3. ACCOUNTING ARCHITECTURE

**Parallel books.** The system runs its own general ledger. QuickBooks is never written to.

**Two-event revenue latch.** Delivery earns: DR Unbilled Revenue, CR Line-haul Income. Conversion
creates the receivable: DR Accounts Receivable, CR Unbilled Revenue.

**Expense versus bill.** Paid now: DR expense, CR bank. Owed: DR expense, CR Accounts Payable,
cleared later by a bill payment. A record with no payment account **and** no vendor is an orphan and
raises `PostingEngineError`.

**Factoring is secured borrowing with recourse** (ASC 860). A/R is never derecognized.

**Three dates, three columns, three purposes.**

| Date | Column | What it drives |
|---|---|---|
| Incurred / earned | `bill_date`, `transaction_date` | Load margin, settlement, profit and loss |
| Due | `due_date` | Cash flow, accounts payable aging |
| Paid / cleared | payment date | Reconciliation only |

A cost is recognized exactly once, on the day incurred. A payment clears a liability and never adds
cost to a load. Any path where a bill payment adds cost to a load is a double count.

**Cost attribution — use the highest rung a cost can reach.** Never skip to allocation because it is
easier.

| Rung | Method | Applies to |
|---|---|---|
| 1 | **Direct trace** | Fuel, tolls, scales, repairs, lumper, permits. One truck, one place, one date. Nothing to split. |
| 2 | **Trace to the leg**; the leg carries the truck | Driver pay and revenue. Each leg has its own linehaul and miles. |
| 3 | **Allocate**, basis MILES | Only costs that genuinely belong to the whole trip. Very few. |

**Fixed monthly costs — insurance, plates, the truck note — do not belong on a trip at all.** They
are period costs on the unit. Forcing them into a settlement makes trip margin meaningless.

**The test for any attribution rule:** could you point a CPA at a document, or only at a formula you
chose? Point at a document.

**Driver chargebacks are created by the event, not by payment terms**, and stay pending until an
authorized person approves them. Never automatic, never silent.

**Load-required is category-driven, not a table default.** `accounting.line_category_load_required`
holds the 9 categories (diesel, DEF, toll, scale, lumper…) that demand a load. `load_required`
defaults **false** on both `bill_lines` and `expense_lines` — blanket true would force a load onto
office supplies. Enforced by trigger `enforce_load_fk_invariant` on both tables.

---

## 4. CANONICAL TABLE LAW

Write to the left. Never write to the right. Repoint the **writer**; never drag the FK.

| CANONICAL — write here | RETIRED — never write |
|---|---|
| `driver_finance.*` | `payroll.*` and `settlement.*` |
| `mdata.qbo_*` | `accounting.qbo_*` |
| `banking.*` | `bank.*` |
| `maintenance.*` | `maint.*` |
| `mdata.vendors` | `mdata.qbo_vendors` |
| `catalogs.load_cancellation_reasons` | `catalogs.cancellation_reasons` |
| `mdata.loads` — the canonical hub | |

**Hubs every record links back to:** `org.companies`, `identity.users`, `mdata.drivers`,
`mdata.units`, `mdata.loads`, `catalogs.accounts`, `mdata.customers`, `maintenance.work_orders`,
`mdata.vendors`, `accounting.journal_entries`, `docs.files`, `mdata.equipment`.

**A block with no linkage declaration is not done.**

Every new table carries `operating_company_id` with FORCED RLS and the 0065 grants pattern.
Migrations are idempotent and CREATE-only. Never DROP.

`mdata.units` has **no** `operating_company_id` — scope through `owner_company_id` /
`currently_leased_to_company_id`. The Fleet screen showing all 196 units to USMCA is a **scoping
defect, not a data problem.** Never delete units to fix it.

**WORM delete refusal** — `trg_worm_refuse_delete` → `refuse_financial_row_delete()` is present on
all 7 document-number tables: bills, credit_memos, expenses, factoring_advances, invoices, payments,
vendor_credits. **Verified complete 2026-09-03.** Never author a second refuse function.

**81 files write `accounting.journal_entries`; only 26 go through `journal-entries.service`, and 13
use raw INSERT.** Those 13 are grandfathered only until touched — a seat editing one converts it in
the same PR. No new raw INSERTs.

---

## 5. NUMBERING

The load number is the spine.

```
Load 12225
  -> proforma invoice 12225          created at PICKUP, converts at DELIVERY
  -> expenses 12225, 12225-1, 12225-2   the first is the bare load number
  -> driver bill 12225                  equals the load number, no B- prefix
  -> pre-settlement -> close -> driver settlement AND company settlement
```

Every transaction creator has an **empty, editable number box**, as QuickBooks does. Typed value
wins verbatim. Blank means the system assigns.

**Two numbers on a vendor document, always.** Ours and theirs.

Duplicate payment is prevented by two live **partial** unique indexes —
`uq_expenses_tms_native_vendor_document_number` and `uq_bills_tms_native_vendor_bill_number`.
Do not build a second control.

Seven generators in `accounting/display-id.ts` use `MAX()+1`. Correct under never-delete, protected
by advisory locks and the WORM triggers. **Do not replace with sequences.**

`expense-number.ts:8-14` is **correct** — challenged 2026-09-02, challenge withdrawn. Leave it alone.

---

## 6. LIVE STATE — 2026-09-03 21:30, under `bypass_rls='lucia'`

**USMCA's ledger is empty BY DESIGN (see §2). Masters are loaded; transactions are not.**

```
USMCA MASTERS — loaded and real
  customers  1,232      vendors    603      drivers   167
  accounts     144      locations    9      units owned/leased  43
  telematics: 43 USMCA-tied units, 505,235 pings

USMCA TRANSACTIONS — zero, deliberately
  loads 1  (13508, a wizard test DRAFT — no unit, no driver. Report, never delete.)
  expenses 0   bills 0   invoices 0   journal_entries 0   fuel_transactions 0
  settlements 0   posting_batches 0   load_id_reservations 0
  bank_transactions 395, categorized 0        <- owner categorizes these

EVERYTHING ELSE BELONGS TO THE FROZEN ENTITIES — do not touch
  Transportation  expenses 27,070 ($33.8M) · bills 3,196 · invoices 11,980 · JEs 1,779
  Trucking        bills 13,051 · JEs 6

OTHER LIVE FACTS
  lib.trace_counters  LOAD = 13560 · IN = 1
  load_stops with location_id: 0 of 2        <- picker built, never proven on a load
  fixed_asset_default role for USMCA: 1500 Trucks & Tractors — PRESENT.
    The "NO ROW" claim carried in earlier revisions was WRONG; Codex disproved it
    against production 2026-09-04. Repairs >= $7,000 capitalize correctly.
  escrow_liability_default: 2 rows (1 inactive, 1 active) — cosmetic duplicate

  driver_finance.driver_advance_accounts: 12 ACTIVE USMCA rows, verified 2026-09-04
    account_type Asset, "Driver Cash Advance- <driver name>",
    DRIVERCASHAD896665-007 .. -020, created 2026-08-21
    -> CORRECT AND BY DESIGN. Owner ruling: "WHEN A DRIVER IS CREATED A LIABILITY
       AND ASSET ACCOUNT IS CREATED AUTOMATICALLY." These 12 are the ASSET half,
       auto-provisioned by backend/accounting/driver-subaccount-provision.service.ts
       under the canonical "Driver Cash Advance" parent; the LIABILITY half sits
       under "Driver Escrow". Parent bound to advance_recovery and
       driver_payroll_clearing.
    An earlier revision of this document ordered these 12 DEACTIVATED, calling them
    an owner-operator receivable model. THAT ORDER WAS WRONG and is withdrawn.
    They stay ACTIVE. A named sub-account is not a receivable — the §2 ruling bars
    booking a driver receivable, not holding the account that traces company
    disbursements. If any of the 12 were deactivated, reactivate them.

  catalogs.lane_mileage REBUILT 2026-09-03 20:48Z
    3,092 lanes · short_miles NULL on every row · 0 impossible lanes (was 2,142)
    High 472 / Check ZIP 404 autofill ON · Thin 2,216 OFF
    TWO OPEN DEFECTS: the confidence rule scores ABSOLUTE spread, so the busiest lanes
    do NOT autofill (Phenix City AL -> Laredo, 367 runs, spread 42.2 mi, OFF);
    and practical_min / practical_max are NULL on every row.

  GEOFENCE / TELEMATICS — read live 2026-09-05 00:0x UTC under bypass_rls
    geo.geofences                       2 rows in the ENTIRE database, both USMCA
      188cf90c  Mines Rd yard      current_state 'departed' since 2026-09-03 19:06:32+00
      350b9f03  'TEST CODEX GO0040'  <- a TEST RECORD sitting in USMCA. Must go.
    geo.geofence_state_transitions   6,256 rows — 6,253 of them GARBAGE (see §8)
      idle->approaching 3,127 · approaching->idle 3,126 · one real arrival sequence
      16 distinct vehicle_id inside that flap · nothing recorded since 2026-09-03
    geo.geofence_events              0 rows — never fired
    telematics.vehicle_locations     643,527 rows back to 2019, 82 units, HAS odometer_mi
      newest USMCA position 2026-09-05 00:05:07+00, 14 units reporting in 48h
    telematics.vehicle_latest_position  HAS odometer_mi; city/state/formatted_location NULL
    auto_status_position_snapshots   9,546 rows, NO odometer column
    auto_status_switch_events        0 rows — never fired
    mdata.locations                  10 USMCA / 9 TRANSP / 9 TRK.  location_type_enum
      ALREADY contains fuel_stop, truck_stop, border_crossing — no enum change needed.
    pwa.driver_notifications         36 rows, fire-and-forget: no question, no answer,
      no expiry, no escalation. Cannot represent "the driver has to answer."

  LOVE'S NETWORK FILE — parsed 2026-09-05 from the owner's LOVES_LOCATIONS_COORDINATES.csv
    604 unique store numbers · 42 states · 0 bad coordinates · 0 missing lat/lng
    also carries billing card station code, OPIS rack id, discounted price, DEF price,
    effective date 2026-06-25. Seed extracted to
    ~/Downloads/09-05-2026-LOVES-604-STORES-SEED.csv

  mdata.drivers 264 rows — cdl_number 160 · cdl_expires_at 9 · dot_medical_expires_at 9
    -> the CDL and medical gates fire on ~255 of 264 drivers
    -> duplicates: ANGEL ALFONSO SOSA 3 rows, Raul Esmeregildo Perez 3,
       Armando Perez 3, Ruben Pedro Perez Garcia 2
  15 Licencia Federal de Conductor PDFs in ~/Downloads dated 2026-08-31, unloaded
```

**Nobody has clicked Book Load on a real load.** Everything built is code-verified and
database-verified, not browser-verified.

---

## 7. OPERATING RULES FOR SEATS

- **§0 THE FINISH LAW and §0b SEAT OWNERSHIP govern everything below.**
- No seat creates money records in USMCA production, including for proof.
- Migration lanes: CC-1 hours 00–11 UTC, Cursor hours 12–23 UTC. One author per migration.
- Only CC-2 writes the verified flag.
- Never trigger a deploy. Cursor only.
- `ignacio.munoz@ih35trucking.net` must never be deleted, suspended or merged — embezzlement evidence.
- Mask secrets by pattern: `npg_`, `napi_`, `GOCSPX-`, `rnd_`, `sk-`. Never paste `DATABASE_URL`.
- **A claim about a rendered surface is made by READING the component, never by grepping a label you
  guessed.** A claim about data is made by `information_schema` or a live count.
- Evidence before "done". A screenshot beats an assertion.
- FAST-MERGE order: Gate (exit 0) → Push → PR → Merge → **Neon (step 5, after merge)** → Next.

**Entity independence is a HARD rule.** TRANSP, TRK and USMCA are independent legal entities with
different tax IDs and owners. They are customers and vendors to each other. No commingling of
entity-scoped data. `catalogs.accounts` is correctly per-entity — that finding is cleared and must
not be re-raised.

**Twelve do-not-touch modules:** Home, Maintenance, Dispatch, Safety, Accounting, Banking,
Factoring, Lists, Reports, Form 425C, Electronic Logs, Driver App. The other six — Customers,
Vendors, Legal, Documents, Users, Help — may be iterated on, additive-only.

**Additive-only.** Never delete or remove modules, pages, sidebar entries, sections, cards, fields,
columns, tabs, routes or features. Only add. Sidebar locked at 18 items. The only exception is the
owner saying "remove X" in words. *(He has: Load from template, Legacy load reference #,
Class T120-SMITH, the trip-type classification banner, and the ranked driver / next-load deadhead
suggestions — all ordered removed 2026-09-03; dispatch board default columns Commodity, Linehaul, Pre-settlement, Status — ordered removed from the default set 2026-09-05 13:29Z, kept in the chooser.)*

**USMCA CUTOVER (owner 2026-09-05 13:36Z).** USMCA became operational 2026-08-07. A load is USMCA only if its first pickup is on/after 2026-08-07 and its invoice was not purchased through the Transportation Faro portal; everything else is TRANSPORTATION, frozen, never written. Authority: `docs/bus/settlement-entry-2026-09-04/IH35-AUGUST-RECONCILIATION-BOTH-ENTITIES.xlsx` sheets 2/3/4/5/6. Guard `scripts/verify-usmca-entity-cutover.mjs`.

**Additive-only is GUARDED (owner 2026-09-05 05:28Z).** `scripts/verify-additive-only.mjs` in `pnpm gate` fails any PR that shrinks the sidebar, route, board-column or tab-row sets, or hides a board column by default, unless the PR body carries `OWNER-REMOVE: "<owner's exact words>" <date>`. Breaches on record: #18231 (Round Trips timeline → PlannerGrid) and #20242 (24 of 33 dispatch columns hidden) — both Cursor, both ordered restored (L.4a, L.4c).

**MODULE OWNERSHIP MAP (owner 'lock it' 2026-09-05 14:13Z) — supersedes the §0b table where they differ; full text `docs/bus/OWNERSHIP-MAP-2026-09-05.md`.** One lead (Claude): measures, verdicts, one register, sequencing, enforcement. Cursor: deploy every 20 min + dispatcher + Banking vertical. CC-2: Dispatch + frozen shared components (ParityTable, tokens, sidebar, design contracts). CC-1: Load Costs + Accounting read models + Customers/Vendors. CC-3: Settlements/Escrow/Driver Profile + Seed + Telematics/Safety. Codex: Maintenance. Cascade: Lists/Reports/Planners. One coder per module, owned vertically; hard file boundaries in CODEOWNERS.

**Maker is not checker on the general ledger.** The coder builds and tests; an independent seat
verifies live. No approval gate — proof is the safeguard.

**Research before building.** For any module, research how QuickBooks, NetSuite, McLeod and Alvys
actually do it — fresh, never from memory — before proposing a design.

---

## 8. KNOWN TRAPS

**The entity-filter trap. This one cost a full session on 2026-09-03.** A table can be full and still
be empty for USMCA. `accounting.expenses` holds 27,070 rows — **every one of them Transportation.**
An entire expense-attribution work block was written against those rows before anyone filtered by
`operating_company_id`, and frozen-entity trip statistics were carried into a settlement design the
same way. **Every count, every export and every statistic must be filtered by entity before it
becomes a premise.** A file header naming the entity — "Invoiced By IH35 Transportation, LLC" — is
part of the data. Read it.

**The false-empty trap.** `pg_constraint contype='u'` **misses partial unique indexes.** Use
`pg_index WHERE indisunique`. This produced three wrong answers in one week.

**RLS masks aggregates.** Aggregates return counts while row SELECTs return `[]` on
`catalogs.lane_mileage`, `accounting.expenses`, `mdata.drivers` and the settlement tables. Wrap
every read: `WITH b AS (SELECT set_config('app.bypass_rls','lucia',false)) SELECT ... FROM b, <table>`.
**Empty is a question, not an answer** — check the entity, the filter, the bypass, the join and the
spelling before reporting something missing.

**Silent empty versus missing.** A screen that shows nothing without saying why is a defect. The
Fuel Planner is the reference: returns null rather than zero, says on screen that values are
unavailable and not zero, refuses rather than showing an empty page.

**Zero is a claim.** A 0 in a money or mileage field asserts the value IS zero. A producer that
cannot compute returns NULL with a reason and the UI renders the reason.
`BookLoadModalV4.tsx:396-398` defaulting mileage to 0 while validation demands > 0 is the live
example — it looks filled and fails.

**Document numbering reuses on hard delete.** Safe only because voided rows are retained and the
WORM triggers refuse deletes. Keep both.

**Team loads are 20.4% of history.** Revenue per mile is per driver; driver pay is the combined
total. Dividing without halving doubles the miles.

**Hardcoded literals masquerading as data.** `BookLoadModalV4.tsx:2014` renders
`Class T120-SMITH` — a string literal bound to nothing, on every load, confirmed live in production.
Number-shaped things on screen that came from nowhere are the most dangerous defect class in this
system.

**The shared-state trap — geofence state was stored on the wrong entity.** `geo.geofences` carries
ONE `current_state` column per geofence, and `processGpsBatch()` in
`integrations/samsara/geofences/state-machine/transitions.service.ts` loops every geofence × every
vehicle, each iteration taking `FOR UPDATE` on that same row. Sixteen trucks fought over the Mines
Rd yard and wrote **3,127 idle→approaching and 3,126 approaching→idle** transitions — 6,253 of the
6,256 rows in `geo.geofence_state_transitions` are noise. **State that belongs to a PAIR must be
keyed on the pair.** The generalized rule: before writing a status column, ask what the status is
actually about. If two different actors can be in two different states with respect to the same
row, the column is on the wrong table. Fixed by `geo.geofence_vehicle_state`, keyed
`(operating_company_id, geofence_id, unit_id)`.

**The terminal-state trap — a state machine with no way out.** `VALID_TRANSITIONS.departed =
["idle"]` existed, but `computeProposedState()` had no branch that returned `idle` from
`departed`: far away it only handles `approaching`, and otherwise returns the current state
unchanged. The Mines Rd geofence entered `departed` on 2026-09-03 19:06:32 and **the feature has
been silently dead ever since** while trucks kept reporting positions. No error, no log, no alert —
it simply stopped. **Every state machine in this system gets a test that walks the full cycle and
asserts no state is terminal**, and every worker that can go quiet gets a heartbeat someone reads.
Silent death is the worst failure mode we have, because it looks exactly like nothing happening.

**City text is not a location.** `LAREDO -> LAREDO` spans 3.6 to 1,098.8 miles across 12 loads.
`LAREDO -> YOAKUM, TX` resolved to Yoakum *County* on 10 loads — +116% error, no error raised. A
typo that resolves to a real WRONG place is silent poison. Store latitude and longitude on the stop;
city text is a fallback and every fallback is recorded.

**The settled-decision trap.** Public repository visibility (§2), GL posting flags ON (§2), and the
global-chart-of-accounts claim (§7) have each been "discovered" and raised more than once by a seat
meeting them fresh. Check §2 and §7 before filing anything as a finding. A ruling re-raised as a
finding costs the owner time and earns nothing.

**The stale-document trap.** Three wrong claims in one session came from reading a document that
recorded a defect already fixed — including the expense mint, which `expense-number.ts:12` has
handled correctly all along. **If you are about to report a defect, open the source file first.**
A document describes what was true when it was written.

---

## 9. THE STANDARDS SKILL HAS DRIFTED

`ih35-tms-standards` (rev 2026-08-05) contradicts this document in three places. **This document
wins**; the skill needs updating:

1. Skill says capitalize **≥ $2,500**. Owner ruled **$7,000** on 2026-09-02.
2. Skill describes **three entities in scope**. USMCA only; TRANSP and TRK are frozen.
3. Skill says CC-2 and Cascade produce **no builder PRs**. The owner's turbo order has both shipping
   builder PRs; that restriction is lifted.
