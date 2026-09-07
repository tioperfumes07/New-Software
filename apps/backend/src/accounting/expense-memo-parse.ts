/**
 * expense-memo-parse.ts — ROUND 11 REG-PARSE-DATA.
 *
 * MUST STAY IN SYNC with apps/frontend/src/lib/expense-memo.ts's parseExpenseMemo — same regexes,
 * same grammar, same null-when-absent contract. Duplicated (not imported) because backend and
 * frontend are separate compiled apps in this monorepo; the frontend copy is the display-time
 * fallback parser, THIS copy is what the one-time backfill (expense-parse-backfill.service.ts)
 * uses to populate the real columns migration 202613830000 added. Once every row is backfilled,
 * both copies keep working: the frontend still falls back to parsing for any row the backfill
 * never touched (post-launch real expenses never have this composite-memo shape to begin with).
 */
export type ParsedExpenseMemo = {
  description: string | null;
  address: string | null;
  receiptNumber: string | null;
  settlementNumber: string | null;
  /** true when the string matched the seed grammar (so the caller knows the split is real, not a guess). */
  seedShape: boolean;
};

const SETTLEMENT_TAIL = /\s*\((settlement\s+(\d+)|missing-USMCA-seed)\)\s*$/i;
const RECEIPT_PART = /^inv\s+([A-Za-z0-9-]+)$/i;
const DATE_PART = /^\d{4}-\d{2}-\d{2}$/;
const AMOUNT_PART = /^\$-?\d[\d,]*(\.\d+)?$/;

export function parseExpenseMemo(memo: string | null | undefined, vendorDocumentNumber?: string | null): ParsedExpenseMemo {
  const raw = (memo ?? "").trim();
  const docReceipt = vendorDocumentNumber ? (vendorDocumentNumber.match(/^(\d{4,})/)?.[1] ?? null) : null;
  if (!raw) return { description: null, address: null, receiptNumber: docReceipt, settlementNumber: null, seedShape: false };

  let settlementNumber: string | null = null;
  let body = raw;
  const tail = raw.match(SETTLEMENT_TAIL);
  if (tail) {
    settlementNumber = tail[2] ?? null;
    body = raw.slice(0, raw.length - tail[0].length).trim();
  }
  const parts = body.split(/\s+—\s+|\s+—$|^—\s+/).map((p) => p.trim());
  if (!tail && parts.length < 2) {
    return { description: raw, address: null, receiptNumber: docReceipt, settlementNumber: null, seedShape: false };
  }
  const description = parts[0] || null;
  let address: string | null = null;
  let receiptNumber: string | null = null;
  for (const p of parts.slice(1)) {
    if (!p) continue;
    const inv = p.match(RECEIPT_PART);
    if (inv) { receiptNumber = inv[1]; continue; }
    if (DATE_PART.test(p) || AMOUNT_PART.test(p)) continue; // date and amount live in their own columns already
    if (address == null) address = p;
  }
  return { description, address, receiptNumber: receiptNumber ?? docReceipt, settlementNumber, seedShape: true };
}
