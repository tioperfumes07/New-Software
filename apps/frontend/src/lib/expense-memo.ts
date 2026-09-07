/**
 * REG-PARSE (owner 2026-09-06 05:2xZ): "EXPENSES NEEDS TO BE PARSED — DESCRIPTION, RECEIPT NUMBER, AND ADDRESS IN ANOTHER
 * [column]. WE CAN'T HAVE IT LOOK THAT MESSY … AND SETTLEMENT NO IN A COLUMN AS WELL. SAME FOR BILLS."
 *
 * The 2026-09-05 seed wrote one composite string into expenses.memo / expense_lines.description (measured on Neon):
 *   "<item> — <address> — inv <receipt no> — <YYYY-MM-DD> — $<amount> (settlement <n>)"
 *   "<item> — <address> (settlement <n>)"           · "<item> —  (settlement <n>)"
 *   "… (missing-USMCA-seed)"                          → no signed settlement number on the row
 * and vendor_document_number as "<receipt no>-L<load>[-<cents>-<slug>]" or "<receipt no>-<slug>".
 * This parser splits that string for DISPLAY. It never invents: a part that is not present is null, and a memo that is not
 * in the seed shape comes back as description = the memo, everything else null (receipt no. from vendor_document_number's
 * leading digits when present). The durable fix is structured fields on the row (bus item REG-PARSE-DATA).
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
