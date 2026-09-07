// ACC-51 (owner 01:33Z: "Accounting → Expenses list + Bills list carry the same truth as Load
// costs"): the Costs cards (LoadDetailCostsTab.tsx, ACC-50b) already show a real "held — tour
// open" pill; the Expenses/Bills list pages showed only a bare posting_status string (Expenses)
// or nothing at all (Bills). One shared pill, reused by both lists, so "posted / held — tour open
// / unposted" never drifts into three different renderings of the same three states.
//
// Red for the hold is intentional and on-palette: verify-section7-palette-financial.mjs's
// OFF_PALETTE regex only flags amber/emerald/green/yellow — red is reserved for exactly this kind
// of real, actionable financial-control alert (matches this file's own sibling void-button red
// already live in ExpensesListPage.tsx). Slate/gray for the two non-alert states, matching each
// list's own existing §7 "no green/red on a browse list" status-pill convention.
export function PostingPill({ posted, holdReason }: { posted: boolean; holdReason?: string | null }) {
  if (holdReason === "tour_open") {
    return (
      <span className="inline-flex rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-700">
        held — tour open
      </span>
    );
  }
  if (posted) {
    return <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">posted</span>;
  }
  return <span className="inline-flex rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-500">unposted</span>;
}
