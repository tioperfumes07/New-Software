import { appendCrudAudit } from "../audit/crud-audit.js";
import { isEnabled } from "../lib/feature-flags/service.js";
import { recordPostingFlagSkip } from "../accounting/posting-flag-skip-audit.js";
import { applyApprovedAbandonmentChargebacksToSettlement } from "./abandonment.service.js";
import { applyPendingDeductionsToSettlementWithNetFloor } from "./settlement-deduction-cap.service.js";
import { applyAutoDeductionsToSettlement } from "../settlements/auto-deductions/apply.js";
import { computeSettlementContractTerms, SETTLEMENT_CONTRACT_TERMS_FLAG } from "./settlement-contract-terms.service.js";
import { appendSettlementLineFromDriverBillIfMissing, appendEscrowContributionLineIfMissing, fetchTeamDriversForLoad } from "./settlement-engine.js";
import { materializeSettlementLines, backfillExistingSettlementLineAccounts } from "./settlement-lines-materialize.service.js";
import { fromMdataStatus } from "../dispatch/load-state-machine.js";
import {
  settlementEarningsSumSql,
  settlementDeductionsSumSql,
  settlementReimbursementsSumSql,
} from "./settlement-line-buckets.js";

/**
 * OFF-by-default flag (per-entity-only; routed through the canonical `isEnabled` resolver, NOT a
 * raw lib.feature_flags read). When OFF the close behaves exactly as before (earnings + abandonment
 * only) — deductions are NOT applied. When ON (owner flips per entity, TRANSP first) the canonical
 * deduction applier runs inside the close transaction, after earnings/abandonment lines exist and
 * BEFORE aggregateSettlementTotals recomputes net_pay, closing the "drivers overpaid" gap. TIER-1
 * FINANCIAL — flag flip is Jorge's.
 */
export const SETTLEMENT_DEDUCTION_APPLY_FLAG = "SETTLEMENT_DEDUCTION_APPLY_ENABLED";

type DbClient = {
  query: <R = Record<string, unknown>>(sql: string, values?: unknown[]) => Promise<{ rows: R[] }>;
};

type TeamLoadSplitContext = NonNullable<Awaited<ReturnType<typeof fetchTeamDriversForLoad>>>;

export function settlementDisplayIdFromLoadNumber(loadNumber: string): string {
  const trimmed = String(loadNumber ?? "").trim();
  const suffix = trimmed.replace(/^[Ll]-/, "");
  return `S-${suffix}`;
}

async function emitOutbox(client: DbClient, eventType: string, payload: Record<string, unknown>) {
  /* outbox-handler-parity: literal-types=["driver_finance.settlement.opened","driver_finance.settlement.payment_due","driver_finance.settlement.closed"] */
  await client.query(`INSERT INTO outbox.events (event_type, payload, next_retry_at) VALUES ($1, $2::jsonb, now())`, [
    eventType,
    JSON.stringify(payload),
  ]);
}

export async function openLoadBookendedSettlement(
  client: DbClient,
  opts: {
    driverId: string;
    operatingCompanyId: string;
    firstLoadId: string;
    actorUserId: string;
    /**
     * Optional override. LEAVE IT UNSET in normal code — the flag is DERIVED from the parent load
     * below, so a caller that does not know about sample data still produces a correctly tagged
     * settlement. Only set this when a caller genuinely knows better than the load.
     */
    isSampleData?: boolean;
  }
): Promise<{ settlementId: string; settlementNumber: string }> {
  const loadRes = await client.query<{
    id: string;
    load_number: string;
    assigned_primary_driver_id: string | null;
    assigned_secondary_driver_id: string | null;
    operating_company_id: string;
    is_sample_data: boolean | null;
  }>(
    `
      SELECT id, load_number, assigned_primary_driver_id, assigned_secondary_driver_id, operating_company_id,
             is_sample_data
      FROM mdata.loads
      WHERE id = $1
        AND operating_company_id = $2::uuid
        AND soft_deleted_at IS NULL
      LIMIT 1
    `,
    [opts.firstLoadId, opts.operatingCompanyId]
  );
  const load = loadRes.rows[0] ?? null;
  if (!load) throw new Error("load_not_found");

  const matchesDriver =
    load.assigned_primary_driver_id === opts.driverId || load.assigned_secondary_driver_id === opts.driverId;
  if (!matchesDriver) throw new Error("driver_not_assigned_to_load");

  const pickupRes = await client.query<{ pickup_at: string | null }>(
    `
      SELECT ls.actual_departure_at AS pickup_at
      FROM mdata.load_stops ls
      WHERE ls.load_id = $1
        AND ls.stop_type = 'pickup'
      ORDER BY ls.sequence_number ASC
      LIMIT 1
    `,
    [opts.firstLoadId]
  );
  const pickupAt = pickupRes.rows[0]?.pickup_at ?? null;
  const tripStartedAt = pickupAt ?? new Date().toISOString();

  const existing = await client.query<{ id: string; display_id: string | null }>(
    `
      SELECT s.id, s.display_id
      FROM driver_finance.driver_settlements s
      WHERE s.driver_id = $1
        AND s.operating_company_id = $2::uuid
        AND s.settlement_model = 'load_bookended'
        AND s.trip_closed_at IS NULL
        -- ACCT-F347 — a CANCELLED settlement is not a reusable one. ACCT-F266 (below) stopped reuse
        -- when the ANCHOR LOAD died, but said nothing about the settlement's own status, so a
        -- settlement that was CANCELLED while its anchor load stayed alive remained "open" forever:
        -- cancelling does not set trip_closed_at, and the close path never fires for it.
        --
        -- Live consequence on prod after the owner void-all: FOUR USMCA drivers (Leonel Morales,
        -- Jorge Pablo Munoz, Rafael Rivero, Neftali Coronado) each had a cancelled settlement whose
        -- anchor load was still in_transit / completed_docs_received. openLoadBookendedSettlement
        -- handed that cancelled settlement back, so every future load for those drivers would attach
        -- its pay to paperwork that can never pay out — and, exactly as in ACCT-F266, the paperwork
        -- would LOOK complete. Found by running the P36 smoke and getting an existing cancelled
        -- settlement back instead of a new one.
        --
        -- PINGSETTLEMENT-REUSE-APPROVED-NULL-CLOSE (found live 2026-08-31, human-sequence-replay
        -- L13512): trip_closed_at is meant to be the reliable "still open" signal — the ONLY place
        -- that sets it, closeLoadBookendedSettlementForDriver, sets trip_closed_at AND status='closed'
        -- atomically in the same UPDATE. But status can also be driven to a terminal value (approved/
        -- paid/locked/final/closed) through OTHER code paths (e.g. pre-settlement approve/finalize)
        -- that were never audited for whether they also stamp trip_closed_at. Live proof: driver Pedro
        -- Abraham Lopez Collado's settlement S-20260816-0168 sits at status='approved' with
        -- trip_closed_at STILL NULL — this reuse query handed that already-approved, already-paid-out
        -- settlement back for a brand-new trip (load 13512, first_load_id 8df23e68-...) instead of
        -- opening a new one, silently attaching real pay to paperwork nobody will ever review again.
        -- <> 'cancelled' is a blacklist that trusts every other status implicitly; switched to a
        -- whitelist matching the ONLY status the INSERT below itself ever creates a fresh row with —
        -- 'open' — so a row can only be "still open" by being the literal status openLoadBookendedSettlement
        -- itself uses, never by an accounting-mistake side door in trip_closed_at.
        AND s.status = 'open'
        AND s.voided_at IS NULL
        -- ACCT-F266 — do NOT reuse an ORPHANED bookend settlement.
        --
        -- Reuse is the point of the bookend model: one open settlement spans a driver's trip and later
        -- loads attach to it. But the only condition was "this driver has an open one", so a settlement
        -- whose ANCHOR LOAD died kept absorbing every future load for that driver, forever.
        --
        -- It cannot self-heal: trip_closed_at is set by the load-bookend close path, and that path never
        -- fires for a load that was cancelled or soft-deleted. The settlement is therefore open by
        -- accident, not by intent, and nothing ever closes it.
        --
        -- Live consequence (W3): orphan S-0099 captured L-20260808-0069 and L-20260808-0074, so neither
        -- load could open its own settlement and both showed $0 driver pay against real delivered
        -- freight. The money was not lost — it was attached to a settlement for a trip that no longer
        -- exists, which is worse, because the paperwork looks complete.
        --
        -- Requiring a LIVE anchor keeps genuine multi-load bookending intact (an open settlement whose
        -- first load is a real in-flight trip is still reused) and breaks only the orphan case. A
        -- settlement with no anchor at all is likewise not reusable — there is nothing to continue.
        AND s.first_load_id IS NOT NULL
        -- MEGA-TOUR-RULING (CC-1, 2026-09-06, docs/bus/OUTBOX-CC-1.md OUTBOX-CC-1 · MEGA-TOUR-RULING):
        -- measured live that the mega-tour settlement seed assigned each driver's first_load_id
        -- essentially arbitrarily -- "one of the driver's loads," not "the load that still
        -- matters." 8 of 11 still-open USMCA mega-tour settlements have a first_load_id pointing
        -- at a CANCELLED load, yet 6 of those 8 have real, LIVE loads correctly attached via
        -- settlement_lines right now. The original EXISTS below (unchanged, still correct for the
        -- normal single-trip settlement and for a future post-tour-split per-trip settlement whose
        -- first_load_id IS the trip's real anchor) asked the wrong question for those 6+ drivers:
        -- it called the settlement dead because its arbitrary anchor died, even though the
        -- settlement's REAL load membership (settlement_lines) was still live. That false "not
        -- reusable" verdict made openLoadBookendedSettlement fall through to INSERT a second open
        -- settlement for a driver who already had one, and
        -- uq_driver_settlements_one_open_per_driver correctly refused the duplicate (23505) --
        -- the constraint did its job; the query asked it the wrong question. This is NOT "pick an
        -- invariant, one has to yield": the seed's one-open-settlement-per-driver mega-tour and the
        -- DB's one-open-settlement-per-driver constraint say the SAME thing. Widening to ALSO accept
        -- a settlement with at least one active (is_active = true) settlement_lines row tracing
        -- through driver_bills (canonical per ACCT-F275/ACCT-F290, settlement_lines.load_id a
        -- denormalized fallback -- same resolution already used a few lines below in this file) to
        -- a non-cancelled load is a strict superset of the original check: zero schema change, zero
        -- data change, and it keeps holding once CC-3's separate TOUR-SPLIT-PLAN split runs (each
        -- new per-trip settlement's own first_load_id will then correctly be its real anchor, and
        -- this same widened check still passes via option (a) alone).
        AND (
          EXISTS (
            SELECT 1
            FROM mdata.loads fl
            WHERE fl.id = s.first_load_id
              AND fl.operating_company_id = s.operating_company_id
              AND fl.soft_deleted_at IS NULL
              AND fl.status::text <> 'cancelled'
          )
          OR EXISTS (
            SELECT 1
            FROM driver_finance.settlement_lines sl
            LEFT JOIN driver_finance.driver_bills db ON db.id = sl.source_driver_bill_id
            JOIN mdata.loads ll ON ll.id = COALESCE(db.load_id, sl.load_id)
                                AND ll.operating_company_id = s.operating_company_id
                                AND ll.soft_deleted_at IS NULL
            WHERE sl.settlement_id = s.id
              AND sl.is_active = true
              AND ll.status::text <> 'cancelled'
          )
        )
      ORDER BY s.created_at DESC
      LIMIT 1
      FOR UPDATE
    `,
    [opts.driverId, opts.operatingCompanyId]
  );

  if (existing.rows[0]?.id) {
    const settlementId = String(existing.rows[0].id);
    const settlementNumber = String(existing.rows[0].display_id ?? settlementId);
    return { settlementId, settlementNumber };
  }

  const settlementNumber = settlementDisplayIdFromLoadNumber(load.load_number);
  // BUG FOUND LIVE 2026-09-06 (DELIVER-SEED-40): pickupAt/tripStartedAt is typed `string | null`
  // above, but node-postgres auto-parses a timestamptz column (ls.actual_departure_at) into a
  // native JS Date object at runtime -- the TS annotation does not enforce that. String(dateObj)
  // calls Date.prototype.toString() ("Fri Aug 07 2026 00:00:00 GMT+0000 (...)"), not ISO, so
  // .slice(0, 10) produced "Fri Aug 07" -- Postgres then rejected it with "invalid input syntax
  // for type date" (22007), aborting the WHOLE surrounding transition transaction for every load
  // needing to open a NEW settlement here (loads joining an already-open settlement never hit
  // this line at all, which is why some loads silently succeeded and others didn't). new Date(...)
  // normalizes correctly whether tripStartedAt arrives as a Date object or an ISO string.
  const periodDate = new Date(tripStartedAt).toISOString().slice(0, 10);

  const inserted = await client.query<{ id: string; display_id: string | null }>(
    `
      INSERT INTO driver_finance.driver_settlements (
        operating_company_id,
        display_id,
        driver_id,
        period_start,
        period_end,
        status,
        gross_pay,
        deductions_total,
        reimbursements_total,
        net_pay,
        settlement_model,
        first_load_id,
        first_load_number,
        trip_started_at,
        is_sample_data
      )
      VALUES (
        $1,$2,$3,$4::date,$5::date,'open',0,0,0,0,
        'load_bookended',$6,$7,$8::timestamptz,$9
      )
      RETURNING id, display_id
    `,
    [
      opts.operatingCompanyId,
      settlementNumber,
      opts.driverId,
      periodDate,
      periodDate,
      opts.firstLoadId,
      load.load_number,
      tripStartedAt,
      // DERIVED from the parent load, not hardcoded. This is the writer dispatch calls on
      // `in_transit`, so it opens settlements for loads nobody tagged by hand — a literal `false`
      // here meant a Gate-B sample load silently produced an UNTAGGED live settlement that no purge
      // query could find. Deriving it means every one of pingSettlementOnLoadEvent's three call
      // sites, and any future one, is correct without knowing this flag exists.
      opts.isSampleData ?? load.is_sample_data ?? false,
    ]
  );

  const settlementId = String(inserted.rows[0]?.id ?? "");
  if (!settlementId) throw new Error("settlement_insert_failed");

  await appendCrudAudit(
    client,
    opts.actorUserId,
    "driver_finance.settlement.opened",
    {
      settlement_id: settlementId,
      driver_id: opts.driverId,
      operating_company_id: opts.operatingCompanyId,
      first_load_id: opts.firstLoadId,
      settlement_number: settlementNumber,
    },
    "info",
    "P6-T11176"
  );

  await emitOutbox(client, "driver_finance.settlement.opened", {
    settlement_id: settlementId,
    driver_id: opts.driverId,
    operating_company_id: opts.operatingCompanyId,
    first_load_id: opts.firstLoadId,
    settlement_number: settlementNumber,
  });

  return { settlementId, settlementNumber };
}

export async function aggregateSettlementTotals(
  client: DbClient,
  settlementId: string,
  operatingCompanyId: string
): Promise<{
  gross_pay: number;
  deductions_total: number;
  reimbursements_total: number;
  net_pay: number;
  escrow_contribution_total: number;
}> {
  const totalsRes = await client.query<{
    earnings: string | number | null;
    deductions: string | number | null;
    reimbursements: string | number | null;
    escrow_contribution: string | number | null;
  }>(
    `
      SELECT
        -- Canonical buckets in ./settlement-line-buckets.ts -- SAME expressions the settlements LIST
        -- read uses for the open-settlement accrual, so what the owner sees while a settlement is open
        -- equals what gets written here on close. earnings now includes deadhead_pay (empty-leg driver
        -- pay); it previously fell through ELSE 0 and dropped the whole deadhead leg out of gross.
        ${settlementEarningsSumSql()} AS earnings,
        ${settlementDeductionsSumSql()} AS deductions,
        -- ACCT-F5619: dispute_adjustment folded into the same bucket as reimbursement (both are
        -- positive-direction corrections owed back to the driver, unrelated to base pay) -- the
        -- CHECK constraint has permitted this line_type since 202607380000, but this aggregation
        -- previously fell through its own ELSE 0, so an approved dispute never reached the
        -- settlement header/PDF/driver statement's net_pay at all. Mirrors the 'deduction' bucket's
        -- own precedent of grouping compatible line_types under one column. REPORTING ONLY -- this
        -- does NOT claim the amount was disbursed; see the OPEN board finding
        -- SETTLEMENT-DISPUTE-APPROVAL-HAS-NO-DISBURSEMENT-PATH for the still-unresolved cash
        -- question, deliberately left untouched here pending an owner accounting-treatment decision.
        ${settlementReimbursementsSumSql()} AS reimbursements,
        COALESCE(SUM(CASE WHEN line_type = 'escrow_contribution' THEN amount ELSE 0 END), 0) AS escrow_contribution
      FROM driver_finance.settlement_lines
      WHERE settlement_id = $1
        -- ACCT-F156: settlement_lines soft-deletes via is_active, so an inactive line stays here with
        -- its amount. Unfiltered, this misstates ALL THREE aggregates at once -- earnings, deductions
        -- and reimbursements -- which is the driver's entire settlement. Table is empty today; latent
        -- until pay-runs start, which is exactly when nobody re-audits it.
        AND is_active = true
    `,
    [settlementId]
  );

  const gross = Number(totalsRes.rows[0]?.earnings ?? 0);
  const deductions = Number(totalsRes.rows[0]?.deductions ?? 0);
  const reimbursements = Number(totalsRes.rows[0]?.reimbursements ?? 0);
  const escrowContribution = Number(totalsRes.rows[0]?.escrow_contribution ?? 0);
  const net = gross - deductions + reimbursements;

  await client.query(
    `
      UPDATE driver_finance.driver_settlements
      SET gross_pay = $2,
          deductions_total = $3,
          reimbursements_total = $4,
          net_pay = $5,
          updated_at = now()
      WHERE id = $1
    `,
    [settlementId, gross, deductions, reimbursements, net]
  );

  // ACCT-F271 / FAIL-W7a — populate the settlement -> load bookend FKs.
  //
  // FOUR writers create driver_settlements and only ONE (openLoadBookendedSettlement, above) ever set
  // first_load_id / first_load_number / last_load_id / last_load_number. weekly-close.routes,
  // settlements.routes and settlements-mvp.routes set none of them — 0 references each — so a
  // settlement created by any of those three can never say which loads it covers. Live: S-2026-0001
  // carries $1,705.55 with all four columns NULL, so Settlement -> loads is a dead end and the reverse
  // drill (load -> which settlement paid it) has nothing to walk.
  //
  // DONE HERE, IN THE SHARED ROLLUP, NOT IN THREE WRITERS. Every path calls aggregateSettlementTotals
  // (pre-settlement routes, weekly close, and the bookend close) and it runs AFTER lines exist, which
  // is the first moment the covered loads are actually known — at INSERT time there are no lines to
  // derive them from. Patching three call sites would also be the silent-failure shape ACCT-F265 and
  // ACCT-F268 were fixed to avoid: the writer that forgets leaves NULL, indistinguishable from a
  // settlement that genuinely covers no load.
  //
  // ONLY FILLS NULLS. The bookend service already sets first_load_* at creation and that is
  // authoritative for its model; COALESCE-style guarding means this never overwrites it. Derived from
  // the settlement's OWN lines, so nothing is invented: if no line carries a load_id, the columns stay
  // NULL and the settlement honestly reports that it covers no load.
  await client.query(
    `
      WITH covered AS (
        -- ACCT-F290 — resolve the covered load through the CANONICAL path FIRST.
        --
        -- ACCT-F275 ruled driver_bills.load_id canonical and settlement_lines.load_id a denormalized
        -- copy, and ACCT-F288 (PR #5129) made weekly-close stamp source_driver_bill_id so the link
        -- exists at all. This CTE predates both and reads ONLY sl.load_id, so a line whose load is
        -- reachable only through its driver bill contributes nothing and the settlement reports
        -- "covers no load" while plainly covering one.
        --
        -- HONEST SCOPE: this changes NOTHING on today's data and is not claimed to. Verified live on
        -- prod br-fancy-credit-akjnd07a: across all 7 settlements the bill path resolves 0 loads
        -- (count(db.load_id) = 0 everywhere) because no settlement_line carried a bill link until
        -- #5129 merged today. It is the going-forward correctness fix that keeps the bookends
        -- accurate for every line minted from now on.
        --
        -- ACCT-F275's own COALESCE fix is NOT on main (settlements.routes.ts still counts sl.load_id
        -- alone — verified: 0 occurrences on origin/main), so its load_count undercounts by the same
        -- mechanism. That is a separate open row, not silently folded in here.
        SELECT COALESCE(db.load_id, sl.load_id) AS load_id, l.load_number, l.created_at
          FROM driver_finance.settlement_lines sl
          -- ENTITY PREDICATE (CLS-JOIN-ENTITY-UNSCOPED): sl is pinned to one settlement by the WHERE
          -- below, but the settlement row itself (and the operating_company_id everything downstream
          -- trusts, including the mdata.loads join two lines down) was resolved by bare id.
          JOIN driver_finance.driver_settlements ds ON ds.id = sl.settlement_id
                                                    AND ds.operating_company_id = $2::uuid
          LEFT JOIN driver_finance.driver_bills db ON db.id = sl.source_driver_bill_id
          JOIN mdata.loads l ON l.id = COALESCE(db.load_id, sl.load_id)
                             AND l.operating_company_id = ds.operating_company_id
         WHERE sl.settlement_id = $1::uuid
           AND sl.is_active = true
           AND COALESCE(db.load_id, sl.load_id) IS NOT NULL
      ),
      bounds AS (
        SELECT
          (SELECT load_id     FROM covered ORDER BY created_at ASC,  load_id ASC  LIMIT 1) AS first_id,
          (SELECT load_number FROM covered ORDER BY created_at ASC,  load_id ASC  LIMIT 1) AS first_no,
          (SELECT load_id     FROM covered ORDER BY created_at DESC, load_id DESC LIMIT 1) AS last_id,
          (SELECT load_number FROM covered ORDER BY created_at DESC, load_id DESC LIMIT 1) AS last_no
      )
      UPDATE driver_finance.driver_settlements s
         SET first_load_id     = COALESCE(s.first_load_id,     b.first_id),
             first_load_number = COALESCE(s.first_load_number, b.first_no),
             last_load_id      = COALESCE(s.last_load_id,      b.last_id),
             last_load_number  = COALESCE(s.last_load_number,  b.last_no),
             updated_at        = now()
        FROM bounds b
       WHERE s.id = $1::uuid
         AND b.first_id IS NOT NULL
    `,
    [settlementId, operatingCompanyId]
  );

  return {
    gross_pay: gross,
    deductions_total: deductions,
    reimbursements_total: reimbursements,
    net_pay: net,
    escrow_contribution_total: escrowContribution,
  };
}

async function closeLoadBookendedSettlementForDriver(
  client: DbClient,
  opts: {
    operatingCompanyId: string;
    actorUserId: string;
    load: { id: string; load_number: string };
    driverId: string;
    team: TeamLoadSplitContext | null;
  }
): Promise<number> {
  const busyRes = await client.query<{ cnt: number }>(
    `
      SELECT count(*)::int AS cnt
      FROM mdata.loads l
      WHERE l.operating_company_id = $1::uuid
        AND l.soft_deleted_at IS NULL
        AND l.id <> $2::uuid
        AND (
          l.assigned_primary_driver_id = $3
          OR l.assigned_secondary_driver_id = $3
          OR (
            l.team_id IS NOT NULL
            AND EXISTS (
              SELECT 1
              FROM mdata.driver_teams t
              WHERE t.id = l.team_id
                AND (t.primary_driver_id = $3 OR t.secondary_driver_id = $3)
            )
          )
        )
        AND l.status::text IN (
          'draft', 'booked', 'planned', 'assigned',
          'dispatched', 'at_pickup', 'in_transit', 'at_delivery'
        )
    `,
    [opts.operatingCompanyId, opts.load.id, opts.driverId]
  );

  const busy = Number(busyRes.rows[0]?.cnt ?? 0);
  if (busy > 0) return 0;

  const openRes = await client.query<{ id: string }>(
    `
      SELECT id
      FROM driver_finance.driver_settlements
      WHERE operating_company_id = $1::uuid
        AND driver_id = $2
        AND settlement_model = 'load_bookended'
        AND trip_closed_at IS NULL
        -- PINGSETTLEMENT-REUSE-APPROVED-NULL-CLOSE — a THIRD occurrence of the same gap fixed in
        -- openLoadBookendedSettlement/getActiveSettlementForDriver, found while about to progress
        -- L13512 to delivered_pending_docs and realizing THIS query (the one that decides which
        -- settlement gets CLOSED, i.e. gets this load's real settlement_lines attached) had no
        -- status filter at all — not even the old blacklist. Without this, closing 13512's trip
        -- would have matched S-20260816-0168 (trip_closed_at NULL despite status='approved') and
        -- attached brand-new settlement_lines to an already-approved, already-paid-out settlement —
        -- corrupting real driver pay, not just misreporting it. Same whitelist, same reasoning.
        AND status = 'open'
      ORDER BY created_at DESC
      LIMIT 1
      FOR UPDATE
    `,
    [opts.operatingCompanyId, opts.driverId]
  );

  let settlementId = openRes.rows[0]?.id ? String(openRes.rows[0].id) : "";

  // PINGSETTLEMENT-CLOSE-NO-OPEN-SETTLEMENT-FALLBACK — live-proven 2026-08-31 on load 13512: the
  // in_transit OPEN event and the delivered_pending_docs CLOSE event can straddle a deploy (the
  // open fired under pre-fix code, or any other reason no settlement was ever opened for this
  // driver's trip), and busy=0 here means this genuinely IS the driver's last active load — no
  // FUTURE load will ever trigger an open event to bookend this trip. Before this fallback, that
  // silently returned 0: the load reached its terminal delivery-evidence status with real revenue
  // already recognized (latchOnDeliveryEvidence, same call site) while its driver pay vanished —
  // no settlement, no settlement_lines, nothing for anyone to notice or query. Matches the same
  // "invisible skip" class MILES-ON-BOOK was fixed for (a refusal that only ever wrote to
  // audit.audit_events, which no dispatcher reads). Self-heals by opening a fresh settlement
  // anchored to THIS load (openLoadBookendedSettlement — same function, same reuse/anchor
  // guarantees, so it can never attach to the wrong driver or a dead load) and immediately closing
  // it below, exactly as if the open event had fired correctly moments earlier.
  if (!settlementId) {
    const opened = await openLoadBookendedSettlement(client, {
      driverId: opts.driverId,
      operatingCompanyId: opts.operatingCompanyId,
      firstLoadId: opts.load.id,
      actorUserId: opts.actorUserId,
    });
    settlementId = opened.settlementId;
  }
  if (!settlementId) return 0;

  const closedAt = new Date().toISOString();

  await client.query(
    `
      UPDATE driver_finance.driver_settlements
      SET trip_closed_at = $2::timestamptz,
          status = 'closed',
          last_load_id = $3,
          last_load_number = $4,
          period_end = ($2::timestamptz)::date,
          updated_at = now()
      WHERE id = $1
    `,
    [settlementId, closedAt, opts.load.id, opts.load.load_number]
  );

  const lineType =
    opts.team && opts.driverId === opts.team.primaryDriverId
      ? ("team_split_primary" as const)
      : opts.team
        ? ("team_split_secondary" as const)
        : ("earnings" as const);

  await appendSettlementLineFromDriverBillIfMissing(client, {
    settlementId,
    operatingCompanyId: opts.operatingCompanyId,
    driverId: opts.driverId,
    loadId: opts.load.id,
    teamId: opts.team?.teamId ?? null,
    lineType,
    actorUserId: opts.actorUserId ?? null,
  });
  // M.3 (owner order 2026-09-05, transferred CC-1 -> CC-3): the closing/return load accrues its own
  // per-load escrow line same as every other load in the tour.
  await appendEscrowContributionLineIfMissing(client, {
    settlementId,
    operatingCompanyId: opts.operatingCompanyId,
    driverId: opts.driverId,
    loadId: opts.load.id,
    actorUserId: opts.actorUserId ?? null,
  });

  await applyApprovedAbandonmentChargebacksToSettlement(client, {
    settlementId,
    driverId: opts.driverId,
    operatingCompanyId: opts.operatingCompanyId,
    actorUserId: opts.actorUserId,
  });

  // ── Hire-contract terms computation (OFF-flag-gated) ───────────────────────────────────────────
  // Compute the five signed-hire-contract money terms (MPG +$35, referral $200, late-delivery
  // pass-through, driver fines, reimbursements). Runs AFTER earnings/abandonment lines exist and BEFORE
  // the net-floor deduction applier + aggregateSettlementTotals — so the MPG/referral bonuses raise gross
  // first, and the pass-through/fine deductions this creates are picked up by the SAME existing applier
  // (net-floor capped, pay-first). NO new GL math: bonuses ride the poster's driver-pay/reimbursement
  // legs; deductions ride the bucketed deduction poster. Per-entity OFF flag; Jorge flips (TRANSP first).
  const contractTermsEnabled = await isEnabled(client, SETTLEMENT_CONTRACT_TERMS_FLAG, {
    operating_company_id: opts.operatingCompanyId,
  });
  if (contractTermsEnabled) {
    await computeSettlementContractTerms(client, {
      settlementId,
      driverId: opts.driverId,
      operatingCompanyId: opts.operatingCompanyId,
      actorUserId: opts.actorUserId,
    });
  } else {
    // Flag OFF: contract-terms money is not applied. Record the skip append-only so the settlement
    // close is never a silent no-op on this leg (verify-no-silent-noop-posting).
    await recordPostingFlagSkip(client, opts.actorUserId, {
      flagKey: SETTLEMENT_CONTRACT_TERMS_FLAG,
      postingDomain: "driver_finance.settlement_contract_terms",
      operatingCompanyId: opts.operatingCompanyId,
      context: { settlement_id: settlementId, driver_id: opts.driverId, last_load_id: opts.load.id },
    });
  }

  // ── Deduction applier (OFF-flag-gated) ─────────────────────────────────────────────────────────
  // REPAIR-A root cause: the canonical close applied earnings + abandonment but NEVER general
  // cash-advance / other deductions, because the applier had no non-test caller → drivers overpaid.
  // Wire the EXISTING applier here (reuse — no new GL/posting math), gated behind an OFF flag routed
  // through the canonical `isEnabled` resolver (per-entity, kill-switch aware — fixes the H3-4 raw-read
  // pattern). Runs on the SAME client (inside the close transaction), AFTER earnings/abandonment lines
  // exist and BEFORE aggregateSettlementTotals recomputes net_pay. OFF => skipped => net pay unchanged.
  const deductionApplyEnabled = await isEnabled(client, SETTLEMENT_DEDUCTION_APPLY_FLAG, {
    operating_company_id: opts.operatingCompanyId,
  });
  if (deductionApplyEnabled) {
    // P2a (owner DECISION 1, 2026-07-21): FIRST materialize active auto-deduction-policy tranches
    // into the canonical driver_finance.driver_settlement_deductions sub-ledger (cents), so the
    // net-floor cap applier below SEES them — closing the hole where an auto policy could push a
    // driver below the net floor invisibly. Same flag, no settlement_lines writes, no totals math
    // (idempotent via the one-open-tranche-per-policy partial unique index).
    const autoMaterialized = await applyAutoDeductionsToSettlement(client, {
      settlementId,
      driverId: opts.driverId,
      operatingCompanyId: opts.operatingCompanyId,
      actorUserId: opts.actorUserId,
    });

    const applied = await applyPendingDeductionsToSettlementWithNetFloor(client, {
      settlementId,
      driverId: opts.driverId,
      operatingCompanyId: opts.operatingCompanyId,
      actorUserId: opts.actorUserId,
    });

    // Spine audit event for the apply (append-only; ties net-pay reduction to the deduction ledger).
    await appendCrudAudit(
      client,
      opts.actorUserId,
      "driver_finance.settlement.deductions_applied",
      {
        settlement_id: settlementId,
        driver_id: opts.driverId,
        operating_company_id: opts.operatingCompanyId,
        last_load_id: opts.load.id,
        applied_count: applied.appliedCount,
        applied_cents: applied.appliedCents,
        deferred_count: applied.deferredCount,
        deferred_cents: applied.deferredCents,
        gross_cents: applied.grossCents,
        floor_cents: applied.floorCents,
        available_cents: applied.availableCents,
        // P2a additive fields: auto-deduction tranches materialized into the sub-ledger this close.
        auto_materialized_count: autoMaterialized.materialized.length,
        auto_materialized_cents: autoMaterialized.total_materialized_cents,
        auto_materializer_schema_ready: autoMaterialized.schema_ready,
      },
      "info",
      "REPAIR-A-DEDUCTION-APPLY"
    );
  } else {
    // Flag OFF: pending deductions are NOT applied (net pay unchanged). Record the skip append-only
    // so this never silently overpays a driver undetected (verify-no-silent-noop-posting; REPAIR-A).
    await recordPostingFlagSkip(client, opts.actorUserId, {
      flagKey: SETTLEMENT_DEDUCTION_APPLY_FLAG,
      postingDomain: "driver_finance.settlement_deductions",
      operatingCompanyId: opts.operatingCompanyId,
      context: { settlement_id: settlementId, driver_id: opts.driverId, last_load_id: opts.load.id },
    });
  }

  // SETL-LINES-GL — "runs at ... close": final, unconditional sweep (not flag-gated — this only
  // resolves load_id/posting_account_id/approval_status on lines that already exist or that the
  // two appliers above just created; it never changes a dollar amount, so it is safe regardless of
  // whether SETTLEMENT_CONTRACT_TERMS_FLAG / SETTLEMENT_DEDUCTION_APPLY_FLAG are on). Idempotent —
  // a row this same close's own appliers (or an earlier line-creation-time call) already
  // materialized is skipped by source-id.
  await materializeSettlementLines(client, {
    settlementId,
    operatingCompanyId: opts.operatingCompanyId,
    actorUserId: opts.actorUserId,
  });

  // ROUND 16.22 — the SAME unconditional sweep, extended to backfill posting_account_id on lines
  // that existed BEFORE this settlement's own materializer ever ran (a re-close of an already-
  // materialized settlement, or a line created by a different writer entirely) — UPDATE-only, never
  // creates a line, never changes a dollar amount or approval_status.
  await backfillExistingSettlementLineAccounts(client, {
    settlementId,
    operatingCompanyId: opts.operatingCompanyId,
  });

  const totals = await aggregateSettlementTotals(client, settlementId, opts.operatingCompanyId);

  await emitOutbox(client, "driver_finance.settlement.payment_due", {
    settlement_id: settlementId,
    driver_id: opts.driverId,
    operating_company_id: opts.operatingCompanyId,
    gross_pay: totals.gross_pay,
    deductions_total: totals.deductions_total,
    reimbursements_total: totals.reimbursements_total,
    net_pay: totals.net_pay,
  });

  await appendCrudAudit(
    client,
    opts.actorUserId,
    "driver_finance.settlement.closed",
    {
      settlement_id: settlementId,
      driver_id: opts.driverId,
      operating_company_id: opts.operatingCompanyId,
      last_load_id: opts.load.id,
      load_number: opts.load.load_number,
    },
    "info",
    "P6-T11176"
  );

  await emitOutbox(client, "driver_finance.settlement.closed", {
    settlement_id: settlementId,
    driver_id: opts.driverId,
    operating_company_id: opts.operatingCompanyId,
    last_load_id: opts.load.id,
    load_number: opts.load.load_number,
  });

  return 1;
}

export async function closeSettlementForFinalLoad(
  client: DbClient,
  opts: { loadId: string; operatingCompanyId: string; actorUserId: string }
): Promise<{ closedSettlements: number }> {
  const loadRes = await client.query<{
    id: string;
    load_number: string;
    assigned_primary_driver_id: string | null;
    assigned_secondary_driver_id: string | null;
  }>(
    `
      SELECT id, load_number, assigned_primary_driver_id, assigned_secondary_driver_id
      FROM mdata.loads
      WHERE id = $1 AND operating_company_id = $2::uuid AND soft_deleted_at IS NULL
      LIMIT 1
    `,
    [opts.loadId, opts.operatingCompanyId]
  );
  const load = loadRes.rows[0] ?? null;
  if (!load) return { closedSettlements: 0 };

  const team = await fetchTeamDriversForLoad(client, { operatingCompanyId: opts.operatingCompanyId, loadId: load.id });
  const driverIds = team
    ? [team.primaryDriverId, team.secondaryDriverId]
    : [load.assigned_primary_driver_id ?? load.assigned_secondary_driver_id ?? null].filter((v): v is string => Boolean(v));

  if (driverIds.length === 0) return { closedSettlements: 0 };

  let closed = 0;
  for (const driverId of driverIds) {
    closed += await closeLoadBookendedSettlementForDriver(client, {
      operatingCompanyId: opts.operatingCompanyId,
      actorUserId: opts.actorUserId,
      load,
      driverId,
      team,
    });
  }

  return { closedSettlements: closed };
}

export type StampTripClosedResult =
  | { stamped: true; trip_closed_at: string; anchor_load_id: string }
  | {
      stamped: false;
      reason: "not_found" | "already_closed" | "cancelled" | "not_load_bookended" | "no_anchor_load";
      trip_closed_at?: string;
      anchor_load_id?: string;
    };

/**
 * PINGSETTLEMENT-REUSE-APPROVED-NULL-CLOSE — horizontal stamp for load-bookended settlements whose
 * trip_closed_at was never set because closeLoadBookendedSettlementForDriver only runs on
 * delivered_pending_docs and only matches status='open'. Payrun-close and approved/paid settlements
 * on loads already past that milestone leave trip_closed_at NULL and block load edits.
 */
export async function stampTripClosedForBookendedSettlement(
  client: DbClient,
  opts: { settlementId: string; operatingCompanyId: string; actorUserId: string }
): Promise<StampTripClosedResult> {
  const sRes = await client.query<{
    id: string;
    driver_id: string;
    status: string;
    settlement_model: string;
    trip_closed_at: string | null;
    first_load_id: string | null;
    last_load_id: string | null;
    first_load_number: string | null;
    last_load_number: string | null;
    voided_at: string | null;
  }>(
    `
      SELECT
        id::text,
        driver_id::text,
        status,
        settlement_model,
        trip_closed_at::text,
        first_load_id::text,
        last_load_id::text,
        first_load_number,
        last_load_number,
        voided_at::text
      FROM driver_finance.driver_settlements
      WHERE id = $1::uuid
        AND operating_company_id = $2::uuid
      LIMIT 1
      FOR UPDATE
    `,
    [opts.settlementId, opts.operatingCompanyId]
  );
  const row = sRes.rows[0];
  if (!row) return { stamped: false, reason: "not_found" };
  if (row.settlement_model !== "load_bookended") return { stamped: false, reason: "not_load_bookended" };
  if (row.voided_at || row.status === "cancelled") return { stamped: false, reason: "cancelled" };

  const anchorLoadId = row.last_load_id ?? row.first_load_id;
  const anchorLoadNumber = row.last_load_number ?? row.first_load_number ?? anchorLoadId;
  if (!anchorLoadId) return { stamped: false, reason: "no_anchor_load" };

  // DEFECT-B-FIX-DOES-NOT-COVER-CLOSE-TRIP (L-0017 Live Click): Close trip used to stamp
  // trip_closed_at / status=closed WITHOUT calling appendSettlementLineFromDriverBillIfMissing.
  // Result: closed $0 settlements with an open driver bill and zero settlement_lines. Always
  // attempt the append (idempotent) — including already_closed retries / Refresh→Close trip
  // re-clicks that must heal empty closed settlements.
  const appendEarningsForAnchor = async () => {
    const team = await fetchTeamDriversForLoad(client, {
      operatingCompanyId: opts.operatingCompanyId,
      loadId: anchorLoadId,
    });
    if (team) {
      for (const [driverId, lineType] of [
        [team.primaryDriverId, "team_split_primary" as const],
        [team.secondaryDriverId, "team_split_secondary" as const],
      ] as const) {
        await appendSettlementLineFromDriverBillIfMissing(client, {
          settlementId: opts.settlementId,
          operatingCompanyId: opts.operatingCompanyId,
          driverId,
          loadId: anchorLoadId,
          teamId: team.teamId,
          lineType,
          actorUserId: opts.actorUserId,
        });
      }
    } else {
      await appendSettlementLineFromDriverBillIfMissing(client, {
        settlementId: opts.settlementId,
        operatingCompanyId: opts.operatingCompanyId,
        driverId: row.driver_id,
        loadId: anchorLoadId,
        teamId: null,
        lineType: "earnings",
        actorUserId: opts.actorUserId,
      });
    }
    // M.3 (owner order 2026-09-05, transferred CC-1 -> CC-3): escrow is a driver-level (not a
    // team-split) contribution, tied to the settlement's own driver_id regardless of whether the
    // anchor load's earnings were team-split above.
    await appendEscrowContributionLineIfMissing(client, {
      settlementId: opts.settlementId,
      operatingCompanyId: opts.operatingCompanyId,
      driverId: row.driver_id,
      loadId: anchorLoadId,
      actorUserId: opts.actorUserId,
    });
    await aggregateSettlementTotals(client, opts.settlementId, opts.operatingCompanyId);
  };

  if (row.trip_closed_at) {
    await appendEarningsForAnchor();
    return { stamped: false, reason: "already_closed", trip_closed_at: row.trip_closed_at, anchor_load_id: anchorLoadId };
  }

  const closedAt = new Date().toISOString();

  await client.query(
    `
      UPDATE driver_finance.driver_settlements
      SET trip_closed_at = $2::timestamptz,
          period_end = ($2::timestamptz)::date,
          last_load_id = COALESCE(last_load_id, $3::uuid),
          last_load_number = COALESCE(last_load_number, $4),
          status = CASE WHEN status = 'open' THEN 'closed' ELSE status END,
          updated_at = now()
      WHERE id = $1::uuid
    `,
    [opts.settlementId, closedAt, anchorLoadId, anchorLoadNumber]
  );

  await appendEarningsForAnchor();

  await appendCrudAudit(
    client,
    opts.actorUserId,
    "driver_finance.settlement.trip_closed",
    {
      settlement_id: opts.settlementId,
      driver_id: row.driver_id,
      operating_company_id: opts.operatingCompanyId,
      anchor_load_id: anchorLoadId,
      trip_closed_at: closedAt,
      prior_status: row.status,
    },
    "info",
    "PINGSETTLEMENT-TRIP-CLOSE-STAMP"
  );

  await emitOutbox(client, "driver_finance.settlement.trip_closed", {
    settlement_id: opts.settlementId,
    driver_id: row.driver_id,
    operating_company_id: opts.operatingCompanyId,
    anchor_load_id: anchorLoadId,
    trip_closed_at: closedAt,
  });

  return { stamped: true, trip_closed_at: closedAt, anchor_load_id: anchorLoadId };
}

export async function getActiveSettlementForDriver(
  client: DbClient,
  input: { driverId: string; operatingCompanyId: string }
): Promise<{ settlementId: string; settlementNumber: string | null } | null> {
  const res = await client.query<{ id: string; display_id: string | null }>(
    `
      SELECT id, display_id
      FROM driver_finance.driver_settlements
      WHERE driver_id = $1
        AND operating_company_id = $2::uuid
        AND settlement_model = 'load_bookended'
        AND trip_closed_at IS NULL
        -- ACCT-F347 — same exclusion as the reuse query in openLoadBookendedSettlement. This reader
        -- feeds "which settlement is this driver currently on"; returning a cancelled one sends the
        -- caller to dead paperwork just as surely as reusing it does.
        --
        -- PINGSETTLEMENT-REUSE-APPROVED-NULL-CLOSE — same fix as openLoadBookendedSettlement's own
        -- reuse query, same reason: trip_closed_at is not a reliable enough "still open" signal on
        -- its own (a settlement can reach a terminal status without trip_closed_at ever being
        -- stamped, live-proven on S-20260816-0168). Whitelist the one status a genuinely reusable
        -- bookended settlement can have, rather than blacklisting one known-bad value.
        AND status = 'open'
        AND voided_at IS NULL
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [input.driverId, input.operatingCompanyId]
  );
  const row = res.rows[0];
  if (!row?.id) return null;
  return { settlementId: String(row.id), settlementNumber: row.display_id ? String(row.display_id) : null };
}

export async function pingSettlementOnLoadEvent(
  client: DbClient,
  opts: {
    loadId: string;
    operatingCompanyId: string;
    /** Dispatch-facing milestone mapped inside this helper */
    dispatchTargetStatus: string;
    actorUserId: string;
  }
): Promise<void> {
  // PINGSETTLEMENT-EXACT-MATCH-GAP: normalize the target status through fromMdataStatus
  // so raw mdata values (at_pickup, at_delivery, delivered) from driver-PWA callers are
  // mapped to their narrow DispatchStatus equivalents before the exact-match checks below.
  // fromMdataStatus is idempotent on already-narrow values (e.g. "in_transit" -> "in_transit").
  const normalizedStatus = fromMdataStatus(opts.dispatchTargetStatus);

  const loadRes = await client.query<{
    assigned_primary_driver_id: string | null;
    assigned_secondary_driver_id: string | null;
    team_id: string | null;
  }>(
    `
      SELECT assigned_primary_driver_id, assigned_secondary_driver_id, team_id
      FROM mdata.loads
      WHERE id = $1 AND operating_company_id = $2::uuid AND soft_deleted_at IS NULL
      LIMIT 1
    `,
    [opts.loadId, opts.operatingCompanyId]
  );
  const load = loadRes.rows[0] ?? null;
  if (!load) return;

  const team = await fetchTeamDriversForLoad(client, { operatingCompanyId: opts.operatingCompanyId, loadId: opts.loadId });

  if (normalizedStatus === "in_transit") {
    if (team) {
      await openLoadBookendedSettlement(client, {
        driverId: team.primaryDriverId,
        operatingCompanyId: opts.operatingCompanyId,
        firstLoadId: opts.loadId,
        actorUserId: opts.actorUserId,
      });
      await openLoadBookendedSettlement(client, {
        driverId: team.secondaryDriverId,
        operatingCompanyId: opts.operatingCompanyId,
        firstLoadId: opts.loadId,
        actorUserId: opts.actorUserId,
      });
      return;
    }

    const primary = load.assigned_primary_driver_id ?? null;
    const secondary = load.assigned_secondary_driver_id ?? null;
    const settlementDriverId = primary ?? secondary;
    if (!settlementDriverId) return;

    await openLoadBookendedSettlement(client, {
      driverId: settlementDriverId,
      operatingCompanyId: opts.operatingCompanyId,
      firstLoadId: opts.loadId,
      actorUserId: opts.actorUserId,
    });
    return;
  }

  if (normalizedStatus === "delivered_pending_docs") {
    await closeSettlementForFinalLoad(client, {
      loadId: opts.loadId,
      operatingCompanyId: opts.operatingCompanyId,
      actorUserId: opts.actorUserId,
    });
    return;
  }

  // ACCT-F10160 (DEFECT B) — the driver-bill MINT gate (loadStatusRequiresDeliveryDepartureStamp)
  // fires on BOTH delivered_pending_docs AND completed_docs_received; this settlement-CLOSE
  // predicate above only ever fired on delivered_pending_docs, one transition earlier. A load
  // whose bill was not mintable yet at that exact instant (no pay rate resolvable, or a
  // mint-less driver-PWA/bulk delivery route) had its settlement close EMPTY for it, with no
  // remaining code path to attach a line once the bill eventually minted -- the manual repair
  // route (pre-settlement.routes.ts) is hard-blocked once trip_closed_at is stamped. Live-caught
  // + root-caused 2026-08-31 (L-20260831-0002/0004, GO-IDLE-WAKE DEFECT B). This branch is the
  // narrowest possible re-entry: re-attempt the earnings-line append against a settlement
  // this exact load owns (last_load_id = this load). Accept open OR closed — at the moment
  // completed_docs_received fires the settlement is often still open; requiring status='closed'
  // alone made #18830's branch a permanent no-op (L-0017 Live Click). Idempotent append.
  if (normalizedStatus === "completed_docs_received") {
    const driverIds = team
      ? [team.primaryDriverId, team.secondaryDriverId]
      : [load.assigned_primary_driver_id ?? load.assigned_secondary_driver_id ?? null];

    for (const driverId of driverIds) {
      if (!driverId) continue;
      const closedSettlement = await client.query<{ id: string }>(
        `
          SELECT id
          FROM driver_finance.driver_settlements
          WHERE operating_company_id = $1::uuid
            AND driver_id = $2
            AND settlement_model = 'load_bookended'
            AND status IN ('open', 'closed')
            AND last_load_id = $3::uuid
          ORDER BY created_at DESC
          LIMIT 1
        `,
        [opts.operatingCompanyId, driverId, opts.loadId]
      );
      const settlementId = closedSettlement.rows[0]?.id;
      if (!settlementId) continue;

      const lineType =
        team && driverId === team.primaryDriverId
          ? ("team_split_primary" as const)
          : team
            ? ("team_split_secondary" as const)
            : ("earnings" as const);

      await appendSettlementLineFromDriverBillIfMissing(client, {
        settlementId: String(settlementId),
        operatingCompanyId: opts.operatingCompanyId,
        driverId,
        loadId: opts.loadId,
        teamId: team?.teamId ?? null,
        lineType,
        actorUserId: opts.actorUserId ?? null,
      });
      // M.3 (owner order 2026-09-05, transferred CC-1 -> CC-3).
      await appendEscrowContributionLineIfMissing(client, {
        settlementId: String(settlementId),
        operatingCompanyId: opts.operatingCompanyId,
        driverId,
        loadId: opts.loadId,
        actorUserId: opts.actorUserId ?? null,
      });
    }
  }
}
