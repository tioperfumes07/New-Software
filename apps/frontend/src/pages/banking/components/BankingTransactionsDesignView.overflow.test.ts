import { describe, expect, it } from "vitest";
import view from "./BankingTransactionsDesignView.tsx?raw";
import parityTable from "../../../components/parity/ParityTable.tsx?raw";

/**
 * Guard for #3b — the Banking Transactions register must allow horizontal scroll (overflow-x: auto), NOT
 * clip wide content. Regression #3b: with the optional columns (Check No / Payee / Class / Location)
 * toggled on, a table-fixed layout exceeds its container and overflow-hidden clipped the trailing columns.
 *
 * WHERE THE CONTRACT LIVES MOVED. This file used to regex the VIEW's own markup for a wrapper div
 * immediately preceding a `table-fixed` table. That table no longer exists in the view — the register
 * migrated to the shared `ParityTable` (the view references it 10x and contains no <table> at all), so the
 * old regex could only ever return null. The invariant is unchanged and still worth guarding; it is now
 * owned by ParityTable, so this asserts it THERE and asserts the view still delegates to it.
 *
 * RE-PINNED (B2 BANK-REGISTER-COLUMNS pass, found stale): the wrapper is now a single-class
 * `<div className="overflow-x-auto">` (no trailing space before `>`) and the table's own className
 * is a template literal — `` `w-full ${columnLayout === "auto" ? "table-auto" : "table-fixed"}
 * text-center}` `` (AUTO-FIT, owner law 2026-09-01) — table-fixed is the real DEFAULT branch, with
 * an intentional table-auto escape hatch, not an unconditional literal any more. A bare
 * `className="([^"]*table-fixed[^"]*)"` regex can never match a dynamic `className={...}`
 * expression, so it always returned null regardless of the real markup — re-pinned to match the
 * actual current structure instead of asserting a static string that no longer exists.
 *
 * The old `min-w-[1150px]` assertion is deliberately NOT carried over: ParityTable sizes columns explicitly
 * (table-fixed + persisted, resizable widths), so a hardcoded min-width is not how it engages scroll. Kept
 * only the property that actually protects the user — scroll, never clip.
 * Static source-contract (?raw) so it cannot regress regardless of render-time mocking.
 */
describe("BankingTransactionsDesignView — table overflow contract (#3b)", () => {
  // The register table lives in ParityTable now: isolate ITS wrapper div (identified by its own
  // overflow-x-auto class, not just "the first <div>...<table> pair in the file" — the file has
  // several unrelated div/table pairs before this one, e.g. the toolbar row) + the table inside it.
  const wrapperMatch = parityTable.match(/<div className="([^"]*overflow-x-auto[^"]*)">\s*\n[\s\S]*?<table\s*\n\s*className=\{([\s\S]*?)\}/);

  it("the register delegates to the shared ParityTable", () => {
    expect(view).toContain("ParityTable");
  });

  it("locates the register table and its wrapper", () => {
    expect(wrapperMatch, "could not find the register table wrapper in ParityTable").not.toBeNull();
  });

  it("wrapper is horizontally scrollable, not clipping (overflow-x-auto, never overflow-hidden)", () => {
    const wrapperClasses = wrapperMatch![1];
    expect(wrapperClasses).toContain("overflow-x-auto");
    expect(wrapperClasses).not.toContain("overflow-hidden");
  });

  it("table-fixed is a real branch of the table's className, so persisted column widths drive layout", () => {
    // Replaces the old min-w-[1150px] check — see the header note. table-auto is a legitimate
    // AUTO-FIT escape hatch, not asserted away here — only that table-fixed still exists as a
    // real, reachable branch (the default, per the ternary's else-arm).
    expect(wrapperMatch![2]).toContain("table-fixed");
  });
});
