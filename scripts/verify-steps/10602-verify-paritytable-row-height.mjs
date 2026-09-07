/**
 * verify-paritytable-row-height — ROUND 16.25 (owner-reported live defect, 2026-09-07).
 *
 * ROOT CAUSE: ParityTable.tsx's <td> renderer defaulted to `wrap-break-word` (whiteSpace: normal)
 * with no enforced column min-width. A narrow column with short-but-multi-character content
 * (a status label, a 5-digit load number) wrapped to 2 lines, and because every <td> in a <tr>
 * shares row height, that inflated the ENTIRE row -- live-measured 25/67 rows at 98.3px vs the
 * owner's ~44-48px compact-row ruling, on Cash Flow Rolling Ledger alone. Confirmed systemic via
 * repo-wide search: ParityTable is imported in 50+ files across every module.
 *
 * FIX (this guard enforces it stays fixed): the <td> renderer defaults to
 * `whitespace-nowrap text-ellipsis` (truncate), with an explicit per-column `allowWrap: true`
 * opt-in for the few columns that legitimately need multi-line text. This guard fails if the
 * unconditional `wrap-break-word` default ever comes back, or if a body <td> renders without the
 * allowWrap-aware truncate classes.
 *
 * This is a static source check (grep-shaped), not a live browser render -- CI here has no
 * headless-Chrome step wired for this repo. Live re-verification (real getBoundingClientRect()
 * row-height measurement on Cash Flow, Factoring, Dispatch) is REQUIRED separately before any
 * DONE claim for ROUND 16.25 -- this guard only prevents the source-level regression.
 */
import fs from "node:fs";
import path from "node:path";

const FILE = path.join(process.cwd(), "apps/frontend/src/components/parity/ParityTable.tsx");

export default {
  name: "verify-paritytable-row-height",
  run: async () => {
    const src = fs.readFileSync(FILE, "utf8");

    // REGRESSION GUARD 1: the old unconditional default must not return.
    const bareWrapBreakWord = /overflow-hidden wrap-break-word px-2 align-top/;
    if (bareWrapBreakWord.test(src)) {
      console.error(
        "FAIL verify-paritytable-row-height: ParityTable.tsx <td> reverted to the unconditional " +
          "`wrap-break-word` default (ROUND 16.25 regression) -- body rows will inflate again.",
      );
      process.exit(1);
    }

    // REGRESSION GUARD 2: the allowWrap-aware truncate default must be present.
    const hasAllowWrapGate =
      src.includes("allowWrap?: boolean") &&
      src.includes('column.allowWrap ? "wrap-break-word" : "whitespace-nowrap text-ellipsis"');
    if (!hasAllowWrapGate) {
      console.error(
        "FAIL verify-paritytable-row-height: ParityTable.tsx no longer carries the ROUND 16.25 " +
          "allowWrap-gated truncate default on the body <td> -- re-add the `allowWrap` column " +
          "option and the whitespace-nowrap/text-ellipsis default before merging.",
      );
      process.exit(1);
    }

    console.log(
      "PASS verify-paritytable-row-height: ParityTable.tsx body <td> defaults to truncate " +
        "(whitespace-nowrap text-ellipsis) with allowWrap opt-in intact.",
    );
  },
};
