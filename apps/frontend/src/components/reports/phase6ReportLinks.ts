/** Dedicated report routes — keep in sync with App.tsx and CategoryHoverNav. */
export const PHASE_6_REPORT_HREFS: Record<string, string> = {
  "trial-balance": "/reports/trial-balance",
  "profit-loss": "/reports/profit-loss",
  "balance-sheet": "/reports/balance-sheet",
  "cash-flow-statement": "/reports/cash-flow-statement",
  "cash-flow-overview": "/reports/cash-flow-overview",
  "settlement-summary": "/reports/settlement-summary",
  "customer-profitability": "/reports/customer-profitability",
  "profit-per-truck": "/reports/profit-per-truck",
  "lane-profitability": "/reports/lane-profitability",
  "fuel-reconciliation": "/reports/fuel-reconciliation",
  "maintenance-cost-per-unit": "/reports/maintenance-cost-per-unit",
  "dispatch-margin": "/reports/dispatch-margin",
  "geofence-dwell": "/reports/geofence-dwell",
  deadhead: "/reports/deadhead",
  "scheduled-reports": "/reports/scheduled",
  // ACC-51 (LAW §2 reversal plan, read-only) — Accounting → Reports → "Posted while tour open".
  "posted-while-tour-open": "/reports/posted-while-tour-open",
};

export function phase6ReportHref(reportId: string): string | undefined {
  return PHASE_6_REPORT_HREFS[reportId];
}
