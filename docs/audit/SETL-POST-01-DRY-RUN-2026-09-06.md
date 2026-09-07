# SETL-POST-01 — dry run: why "Closed" did not post (ROUND 13, 2026-09-06)

DRY RUN ONLY. Zero writes. All numbers below are read live from Neon `br-fancy-credit-akjnd07a`
(RLS bypass, positive-controlled) at ~15:1xZ 2026-09-06.

## The 8 settlements

S-13656, S-13648, S-13646, S-13642, S-13652, S-13644, S-13649, S-13650 — all `status='closed'`,
all `posted_at IS NULL`, all `settlement_model='load_bookended'`, all `trip_closed_at` stamped
06:01–07:56Z under the owner's login (matches the task).

## Root cause: "close" and "post to GL" are two different, disconnected code paths

**"Close" here is the automatic trip-bookend event, not a posting action.** Every one of these 8
settlements was closed by `settlements-load-bookended.service.ts`'s trip-close branch (fires when a
driver's next-load-open event or terminal delivery evidence bookends the tour). That function:

```
settlements-load-bookended.service.ts (~line 493)
  UPDATE driver_finance.driver_settlements
    SET trip_closed_at = now(), status = 'closed', last_load_id = ..., period_end = ...
  WHERE id = $1
```

sets `status='closed'` and `trip_closed_at` **directly**, then materializes the settlement's
earnings/escrow/chargeback lines. **It never calls a GL poster.** There are exactly two live GL
posters for a driver settlement, and both require a **separate, explicit** call:

- `driver-finance/settlement-payrun-close.service.ts` → `closeSettlementPayRun()` — called only
  from `settlement-payrun-close.routes.ts` (a human/route action), gated by the
  `SETTLEMENT_GL_POSTING_ENABLED` flag (flag OFF ⇒ preview-only, writes nothing).
- `accounting/settlement-posting/settlement-bill-payment-posting.service.ts` →
  `postSettlementBillPayment()` — the other, older poster (Bill + BillPayment shape), also only
  called from its own route.

Live-confirmed: **none of the 8 settlements has a row in `driver_finance.payrun_gl_runs` or
`driver_finance.driver_settlement_gl_runs`** — neither poster was ever invoked for any of them.
"Closed" (trip-bookend) never automatically triggers "posted" (GL) in the current code. The
owner's law — "Closed = settlement (frozen, posts to GL)" — describes an invariant the code does
not enforce; nothing here is a partial post or a crashed post, it is a call that was never made.

Secondary, structural finding (does not change the above): even the columns meant to record a
post — `driver_finance.driver_settlements.posted_at` / `posted_by_user_id` — are written by
**neither** live poster. Migration `202607520000_driver_finance_settlement_posting_linkage_columns.sql`
added them anticipating a "Step 2 writer repoint" that set `posted_at <- post UPDATE (now())`; that
repoint's `posted_at` write never landed in either canonical poster (confirmed by reading both
files in full — `settlement-bill-payment-posting.service.ts` sets `accounting_bill_id` /
`accounting_bill_payment_id` on the header but not `posted_at`; `settlement-payrun-close.service.ts`
sets `payrun_gl_runs.journal_entry_id` but never touches `driver_settlements.posted_at` either).
So even a settlement that WAS posted through either live path would still read `posted_at IS NULL`
today — a second, independent gap from the first.

## Dry-run JE for S-13656 ($690.82 gross / $665.82 net)

Settlement `6ce5561b-07c4-45f2-9ae5-df9a60e7c023`, driver Vicente Santos Contreras
(`40022039-b657-4713-97de-439fba899946`), USMCA. Computed by replaying `closeSettlementPayRun`'s
exact read sequence live (no code path invoked, pure re-derivation of its queries):

| Term | Cents | Source |
|---|---:|---|
| gross_cents | 69,082 | `driver_settlements.gross_pay` |
| reimbursements_cents | 0 | no `reimbursement` settlement_lines |
| detention_pay_cents | 0 | no `detention_pay` settlement_lines |
| deductions_cents | 0 | no `driver_settlement_deductions` rows |
| chargebacks_cents | 0 | no `abandonment_chargeback` lines |
| advance_recoveries_cents | 0 | no outstanding `driver_advances` for this driver |
| escrow_contribution_cents | 2,500 | SUM `escrow_contribution` settlement_lines (load_bookended model → accrued-sum path, not the flat default) |
| **net_cents** | **66,582 ($665.82)** | matches header `net_pay` and the task's own figure |

The balanced JE this would post (legs, per `closeSettlementPayRun`'s leg order):

| # | Account | Dr/Cr | Amount |
|---|---|---|---:|
| 1 | `6890` Cost of Labor–Mexico Drivers (`driver_pay_expense` role) | Debit | $690.82 |
| 2 | Driver's own Damage-Claim escrow LIABILITY sub-account (`resolveDriverEscrowLiabilityAccount`) | Credit | $25.00 |
| 3 | Net cash leg — chosen payment method's `gl_account_id` | Credit | $665.82 |

Debits $690.82 = Credits ($25.00 + $665.82). Balances.

**This settlement cannot actually post today, for two independent reasons, neither fixed by
choosing to post:**

1. **No payment method chosen.** `closeSettlementPayRun` requires `input.paymentMethodId` whenever
   `net_cents > 0` (true here) — the payrun-close route call was never made with one, so leg #3 has
   no target account yet. This is expected (posting is an explicit UI action) — flagged so it is
   not mistaken for a defect.
2. **`DRIVER_ESCROW_ACCOUNT_UNBOUND` — a real blocker.** `accounting.escrow_accounts` has **zero**
   rows for this driver (`holder_id=40022039-…, holder_type='driver'`) — no per-driver Damage-Claim
   escrow liability sub-account is provisioned. `resolveDriverEscrowLiabilityAccount` throws before
   leg #2 can resolve. A live attempt to post S-13656 today, even with a payment method supplied,
   fails outright — it does not silently omit the escrow leg.

## Same escrow-account gap across the other 7 (live-checked, informational)

| Settlement | Driver | Escrow account provisioned? |
|---|---|---|
| S-13642 | Concepcion Cordova Dominguez | yes |
| S-13644 | Alfonso Hidalgo Chavez | yes |
| S-13646 | Luis Armando Sosa Perez | yes |
| S-13648 | Hugo Gaytan | **no** |
| S-13649 | Genaro Guerrero Chavez | **no** |
| S-13650 | Neftali Coronado Urbano | yes |
| S-13652 | Angel Alfonso Sosa | **no** |
| S-13656 | Vicente Santos Contreras | **no** |

4 of 8 (S-13648, S-13649, S-13652, S-13656) would fail `DRIVER_ESCROW_ACCOUNT_UNBOUND` on a real
post attempt today, independent of the payment-method gap. Relevant to the 15:30Z owner decision
(one-tour-per-driver vs. void+split/TOUR-SPLIT): whichever way it resolves, these 4 drivers need a
provisioned escrow liability sub-account before any of their settlements — split or not — can post.

## What this dry run does NOT do

No JE posted, no `payrun_gl_runs`/`driver_settlement_gl_runs` row claimed, no `driver_advances` /
`driver_liabilities` mutated, no escrow ledger entry written. Zero writes, per the task's own "DRY
RUN ONLY. Do NOT post."
