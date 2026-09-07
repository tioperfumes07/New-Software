/**
 * EXP-ADDR-SPLIT (owner ROUND 11, 2026-09-06) — many seed addresses read like
 * "66320GALMONT MORRISTOWN RD,OH, OH" (the street number glued to the street name, the state
 * doubled). Measured live on accounting.expenses.memo (the composite string CC-1's REG-PARSE-DATA
 * item parses into a structured `address` segment via apps/frontend/src/lib/expense-memo.ts's
 * parseExpenseMemo — this file is the NEXT step, applied to that already-extracted address string
 * when CC-1's merchant_address backfill writes it).
 *
 * SCOPE, deliberately narrow (never invent content):
 *   1. Insert ONE space between a leading run of digits (the street number) and the letter that
 *      immediately follows it — "1010NMAIN" -> "1010 NMAIN". Does NOT attempt to further split a
 *      still-glued direction/street name ("NMAIN") — guessing where "N" ends and "MAIN" begins is
 *      exactly the kind of invention this normalizer must not do.
 *   2. Normalize comma punctuation: collapse a doubled comma ("Madison,, GA" -> "Madison, GA") and
 *      ensure exactly one space after every comma — a companion defect found in the same live data,
 *      pure whitespace/punctuation, never touching the letters themselves.
 *   3. Collapse an EXACT duplicate of the final comma-separated segment ("..., OH, OH" -> "..., OH")
 *      — case-insensitive so "..., oh, OH" also collapses, but only when the two segments are
 *      byte-for-byte identical once case-folded; two DIFFERENT segments ("..., M, TN") are left
 *      alone rather than guessed at.
 *
 * NEVER fixes: spelling ("LONESMOE" stays "LONESMOE" — a transcription typo on the signed source,
 * not this normalizer's job, same "transcribe as printed" law the settlement extraction itself
 * follows), a missing city/state (no comma at all — nothing to split), or a placeholder value like
 * "no-location-on-file" (passed through completely unchanged, never treated as a real address).
 */
const PLACEHOLDER_VALUES = new Set(["no-location-on-file"]);

export function normalizeMerchantAddress(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (PLACEHOLDER_VALUES.has(trimmed.toLowerCase())) return raw;

  // 1. Space after a leading street number glued to the next word.
  let s = trimmed.replace(/^(\d+)([A-Za-z])/, "$1 $2");

  // 2. Comma punctuation: collapse a doubled comma, then ensure one space after every comma.
  s = s
    .replace(/,\s*,/g, ",")
    .replace(/,(?!\s)/g, ", ")
    .replace(/[ \t]+/g, " ")
    .trim();

  // 3. Collapse an exact duplicate of the final comma-separated segment (case-insensitive).
  const segments = s.split(",").map((seg) => seg.trim());
  if (segments.length >= 2) {
    const last = segments[segments.length - 1];
    const secondLast = segments[segments.length - 2];
    if (last && secondLast && last.toUpperCase() === secondLast.toUpperCase()) {
      segments.pop();
    }
  }
  return segments.join(", ");
}
