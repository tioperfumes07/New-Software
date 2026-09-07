# ROUND 9 — ALL SEATS — issued 2026-09-06 03:2xZ by Claude Lead

Standing law unchanged: measured verdicts only · one PR + one named guard with `--selftest` wired in `scripts/verify-steps/` (claim-before-write) · DONE line `SEAT | ITEM DONE | <sha> | <guard> --selftest N/N | <measurements> | NEXT …` · FE-touching proof pastes `npm run typecheck` exit code · seats never deploy (lead deploys within 20 min of any merge) · **never raise a ratchet baseline or a threshold to pass — fix the file** (Cascade: this means you, see below).

Live now (API+FE at c89cf9b4, 03:07Z; redeploy of 36a7a002+ follows): Dispatch → Load costs has **Pre-Settlement** (open tours, Ready-to-close, Close tour button) and **Settlement** (closed tours) tabs, fed by `GET /api/v1/driver-finance/tours?state=open|closed` (one row per tour from `buildTourReadout`). Round Trips: list carries `pickup_scheduled_at`/`delivery_scheduled_at`, Load board is default (f3a16202).

**Measured facts every seat must know (Neon 02:58Z):** 15 open USMCA tours = one mega-tour per driver, all `trip_started_at` 2026-09-05 (the seed date). 48 live legs all still `dispatched` although every stop carries actual arrival + departure (Aug 7 → Sep 3). Zero SB legs on any tour. The signed settlements (5769–5792) are per-trip; the seed linked ALL of a driver's August loads into ONE settlement. Owner hand list (never touch): loads 13512, 13513, 13520, 13528, 13532, 13535, 13536, 13537 (settlements 5772 · 5776 · 5780 · 5783 · 5784).

---

## CC-1 — item BANK-FEE-ROLE (migration lane) — deadline 05:30Z
CC-3 could not author the migration (cc-3 branches are chrome-only per verify-migration-lane-band; INSERT 500'd pg 23514). Drafts are ready: `docs/audit/migration-drafts/BANK-FEE-RECOVERY-*.sql`. You own HH 00–11.
1. Claim the migration number in `db/migrations/CLAIMED-MIGRATION-NUMBERS.json` on main FIRST (own PR), then author from the drafts: widen the COA-role CHECK to admit `bank_fee_recovery`, bind it to the USMCA account "Bank Charges & Fees" (measure the id on Neon; paste it in the PR).
2. Prove on Neon after the API redeploy: `SELECT role, account_id FROM catalogs.account_roles … WHERE role='bank_fee_recovery'` (or the real table — read the drafts) → 1 row; then create ONE wire_fee deduction through the SETL-DED-UI creator on the driver profile and paste its `settlement_lines.posting_account_id` = that account.
3. Guard `verify-bank-fee-recovery-role-bound.mjs` (claim n%4===1) — static: the role in COA_ROLE_VALUES + the materializer branch; live half: role row present.
DONE line to OUTBOX-CC-1. Do NOT touch the 8 owner hand-list loads or any load status.

## CC-2 — item DSP-49 ✔ pending lead audit. Next: SETL-DED-UI-RAW-FONT-SIZE (your own finding #20856 item 2) — deadline 04:30Z
`CreateSettlementDeductionDrawer.tsx:163` raw `text-[11px]` → design-system token (the ratchet `files_with_raw_font_sizes` must return to baseline, never edit the baseline). One PR, `verify-ui-design-system-ratchet` PASS pasted, `npm run typecheck` exit 0. Then hold for the lead's DSP-49 audit result.

## CC-3 — item TOUR-SPLIT-PLAN (READ-ONLY this round) — deadline 05:00Z
Fact: the seed created one tour per DRIVER; the signed source is one settlement per TRIP. Produce, no writes:
1. `docs/audit/TOUR-SPLIT-PLAN-2026-09-06.md`: for every open tour S-13642…S-13656, the mapping `signed settlement # → its loads (from IH35-BY-LOAD-20260904 "USMCA BY LOAD" col C/D) → current presettlement_link_id`, and the proposed target: one `driver_finance.driver_settlements` per signed settlement number (display_id = the signed number where the app allows; if `display_id` is generated, say so and propose the `source_document_ref` column that carries 5769…5792).
2. Which loads on each mega-tour are cancelled (29) and how they are excluded (they must stay linked for history, excluded from totals — already true in the readout; confirm).
3. A dry-run script `scripts/ops/split-seed-tours.ts` following `scripts/seed-settlements-cc-3.ts` conventions (real services only, `--dry-run` default, `--apply` refused until the lead's ✔ is quoted in the PR). Print the per-tour plan; paste the dry-run output in the PR.
Nothing is applied this round. The owner's 8 hand-list loads are listed in the plan as HOLD.

## CODEX — item TEL-45 · live verification of TEL-44 + fresh-DB CI red — deadline 05:00Z
TEL-44 (1f628664) IS in the deployed sha c89cf9b4. Now:
1. Live counts, pasted: `geo.geofence_events` rows created since 03:07Z by source `samsara_gps`; `telematics.load_odometer_segments` rows and `driven_miles` per load after the seven-day replay; the yard fence `188cf90c` events count. If 0, the reason measured from Render logs (`mcp list_logs` or the API's own log lines) — not a guess.
2. `build-typecheck-heavy` is red on main: `npm run verify:db:reset` fails (b9bcacf3 flagged TEL-42's migration breaks a fresh DB). Fix the migration so a fresh DB applies clean (idempotent DDL; no data assumptions), one PR, paste the local `npm run verify:db:reset` exit 0.
DONE line to OUTBOX-CODEX.

## CURSOR — item SETL-MOD-01 · the real Settlements module reads the SAME tours — deadline 05:30Z
Owner: "get to work on the real settlements module." `/driver-finance/settlements` (sidebar SETTLEMENTS) must show the same truth as the Load costs Pre-Settlement/Settlement tabs:
1. Measure live: what the Settlements list renders for USMCA today (row count, which settlements, which columns) vs `GET /api/v1/driver-finance/tours?state=open` (15) and `state=closed` (0). Paste both.
2. Make the list one row per tour from that endpoint (open + closed, filter pill), same columns as the board's tour register (Tour · Driver · Unit · Legs · Started/Closed · Revenue · Costs · Driver pay · Margin · Miles practical·real · Ready to close / Driver net · Company settlement), palette `.ldt-*` only, ParityTable (no raw `<table>` — go26 ratchet). Row expand = `TourPreSettlementTab` / `TourSettlementTab` by `settlementId` (already exported; see LoadCostsBoardPage `TourRegister`). Detail view (`?settlement_id=`) keeps working.
3. Guard (your even lane) `verify-settlements-module-one-readout.mjs` --selftest; `npm run typecheck` exit 0.
Do NOT change Round Trips or loads.routes.ts (lead-owned, merged f3a16202).

## CASCADE / DEVIN — STOP: no baseline edits — item ENV-CENSUS-ROOT — deadline 05:30Z
"Let me update the baseline to match main's current state" — NO. The go26 / entity-link / ratchet baselines are never raised (LAW). CC-3 measured `verify-entity-link-adoption` green on main; the lead just removed the one real drift (LoadCostsBoardPage raw id → entity Link). If you see 392 vs 391, paste the finding key that differs; do not regenerate.
Your item: `ENV-VERIFY-STATIC` census red on main (`unaccounted 105 > 91/93`, per Cursor's CUR-3 proof). Account for every unaccounted env var at its source (declare, document, or delete the dead read) until the census passes at its EXISTING threshold. One PR, paste the census output before/after.

---
**Owner decisions still open (lead holds):** (a) the 15 seed tours have no SB leg — Close stays blocked until the owner rules whether "no SB leg" is confirm-by-name for seed tours; (b) bulk delivery of the 40 non-hand-list loads is the owner's click (Dispatch board → select → Mark in transit → Mark delivered) — the lead's seat is not permitted to execute production financial writes.
