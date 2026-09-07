// ACC-50 — "Open tour posts nothing" (LAW §2, ROUND 5, owner order). A cost on an open tour
// accrues; it does not post. The GL entry is written when the tour (the driver's settlement for
// that load) closes.
//
// "Tour open" is CC-3's own measured definition (scripts/report-posted-expenses-while-tour-open.mjs):
// a load's tour = the driver_finance.driver_settlements row reached via
// driver_finance.driver_bills (by load_id) -> driver_finance.settlement_lines
// (source_driver_bill_id, is_active=true) -> driver_settlements (settlement_id). No settlement
// linked yet, or the linked settlement's status is not in OPEN_TOUR_STATUSES_EXCLUDED, means the
// tour is still open. Reused verbatim here — never a second, competing definition of "open."
import type { PoolClient } from "pg";

type DbClient = {
  query: <T = Record<string, unknown>>(sql: string, values?: unknown[]) => Promise<{ rows: T[] }>;
};

export const TOUR_OPEN_HOLD_REASON = "tour_open" as const;

// Mirrors report-posted-expenses-while-tour-open.mjs's OPEN_TOUR_STATUSES_EXCLUDED and
// pre-settlement.routes.ts's own "open tour" gate exactly — one definition, reused, never
// reinvented.
const CLOSED_TOUR_STATUSES = new Set(["approved", "paid", "cancelled"]);

/**
 * Is the given load's tour still open? A load with no driver_bill/settlement link yet is
 * treated as open (the tour hasn't even been assembled, let alone closed) — matching the report
 * script's own `!r.settlement_status || !CLOSED.includes(r.settlement_status)` logic.
 */
export async function isLoadTourOpen(
  client: DbClient | PoolClient,
  operatingCompanyId: string,
  loadId: string
): Promise<boolean> {
  const res = await (client as DbClient).query<{ settlement_status: string | null }>(
    `
      SELECT ds.status AS settlement_status
      FROM driver_finance.driver_bills db
      LEFT JOIN driver_finance.settlement_lines sl
        ON sl.source_driver_bill_id = db.id AND sl.is_active = true
      LEFT JOIN driver_finance.driver_settlements ds
        ON ds.id = sl.settlement_id
      WHERE db.operating_company_id = $1::uuid
        AND db.load_id = $2::uuid
        AND db.status <> 'void'
      ORDER BY ds.status NULLS FIRST
      LIMIT 1
    `,
    [operatingCompanyId, loadId]
  );
  const status = res.rows[0]?.settlement_status ?? null;
  return !status || !CLOSED_TOUR_STATUSES.has(status);
}

/**
 * accounting.expenses gate: does this expense carry a load_id whose tour is still open? Returns
 * null when the expense has no load_id at all (not a tour-linked cost — never gated).
 */
export async function expenseOpenTourLoadId(
  client: DbClient | PoolClient,
  operatingCompanyId: string,
  expenseId: string
): Promise<string | null> {
  const res = await (client as DbClient).query<{ load_id: string | null }>(
    `SELECT load_id::text AS load_id FROM accounting.expenses WHERE id = $1::uuid AND operating_company_id = $2::uuid LIMIT 1`,
    [expenseId, operatingCompanyId]
  );
  const loadId = res.rows[0]?.load_id ?? null;
  if (!loadId) return null;
  return (await isLoadTourOpen(client, operatingCompanyId, loadId)) ? loadId : null;
}

/**
 * accounting.bills gate: bills carry no load_id of their own (accounting.bills has no such
 * column, verified live) — the load linkage lives on accounting.bill_lines.load_id instead, since
 * one bill (e.g. a fuel-card statement) can span several loads. A bill posts as ONE document
 * (one JE for the whole bill, never split per line), so if ANY line names a load whose tour is
 * still open, the WHOLE bill holds — never a partial post. Returns the first open-tour load_id
 * found, or null if the bill has no load-linked line, or every load-linked line's tour is closed.
 */
export async function billOpenTourLoadId(
  client: DbClient | PoolClient,
  operatingCompanyId: string,
  billId: string
): Promise<string | null> {
  const res = await (client as DbClient).query<{ load_id: string | null }>(
    `
      SELECT DISTINCT bl.load_id::text AS load_id
      FROM accounting.bill_lines bl
      WHERE bl.bill_id = $1::uuid
        AND bl.operating_company_id = $2::uuid
        AND bl.load_id IS NOT NULL
        AND bl.voided_at IS NULL
    `,
    [billId, operatingCompanyId]
  );
  for (const row of res.rows) {
    if (!row.load_id) continue;
    if (await isLoadTourOpen(client, operatingCompanyId, row.load_id)) return row.load_id;
  }
  return null;
}

/** All load_ids whose tour this settlement bookends (via driver_bills <-> settlement_lines). Used
 *  at tour close to find every expense/bill that was held for these specific loads. */
export async function loadIdsForSettlement(
  client: DbClient | PoolClient,
  operatingCompanyId: string,
  settlementId: string
): Promise<string[]> {
  const res = await (client as DbClient).query<{ load_id: string }>(
    `
      SELECT DISTINCT db.load_id::text AS load_id
      FROM driver_finance.driver_bills db
      JOIN driver_finance.settlement_lines sl
        ON sl.source_driver_bill_id = db.id AND sl.is_active = true
      WHERE sl.settlement_id = $1::uuid
        AND db.operating_company_id = $2::uuid
        AND db.status <> 'void'
        AND db.load_id IS NOT NULL
    `,
    [settlementId, operatingCompanyId]
  );
  return res.rows.map((r) => r.load_id);
}
