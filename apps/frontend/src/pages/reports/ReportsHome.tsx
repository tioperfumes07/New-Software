import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "../../components/layout/PageHeader";
import { Button } from "../../components/Button";
import {
  BasisSelector,
  type AccountingBasis,
} from "../../components/accounting/BasisSelector";
import { CategoryHoverNav } from "../../components/reports/CategoryHoverNav";
import { PHASE_6_REPORT_HREFS } from "../../components/reports/phase6ReportLinks";
import { FrequentlyRunTable } from "../../components/reports/FrequentlyRunTable";
import { ScheduledReportsPanel } from "./ScheduledReportsPanel";
import { CustomReportBuilder } from "./CustomReportBuilder";
import { IftaPreparerCard } from "../../components/reports/IftaPreparerCard";
import {
  getFrequentlyRun,
  getIftaStatus,
  getKpiSummary,
  type FrequentlyRunReport,
  type ReportCategory,
} from "../../api/reports";
import { mmmDd } from "../../lib/formatDate";
import { useMemo, useState } from "react";
import { useCompanyContext } from "../../contexts/CompanyContext";
import { useToast } from "../../components/Toast";
import { useNavigate } from "react-router-dom";
import { ReportsSubNav } from "./ReportsSubNav";
import { ListErrorBanner } from "../../components/shared/ListErrorBanner";

const BLOCK_W_FREQUENT_ROWS: FrequentlyRunReport[] = [
  {
    id: "fuel-reconciliation",
    name: "Fuel reconciliation",
    filters: "Last 30d · card vs WO",
    runs: 0,
    status: "real",
  },
  {
    id: "maintenance-cost-per-unit",
    name: "Maintenance cost per unit",
    filters: "Current quarter",
    runs: 0,
    status: "real",
  },
  {
    id: "scheduled-reports",
    name: "Default report subscriptions",
    filters: "Automation · email queue",
    runs: 0,
    status: "real",
  },
];

type ReportsKpi = {
  label: string;
  value: string;
  meta: string;
  warn?: boolean;
};

export function ReportsHomePage() {
  const [category, setCategory] = useState<ReportCategory>("all");
  const [basis, setBasis] = useState<AccountingBasis>("accrual");
  const [showCustomBuilder, setShowCustomBuilder] = useState(false);
  const { selectedCompanyId } = useCompanyContext();
  const { pushToast } = useToast();
  const navigate = useNavigate();
  const companyId = selectedCompanyId ?? "";
  const frequentQuery = useQuery({
    queryKey: ["reports", "frequently-run", companyId],
    queryFn: () => getFrequentlyRun(companyId),
    enabled: Boolean(companyId),
  });
  const iftaQuery = useQuery({
    queryKey: ["reports", "ifta-status", companyId],
    queryFn: () => getIftaStatus(companyId),
    enabled: Boolean(companyId),
  });
  const kpiQuery = useQuery({
    queryKey: ["reports", "kpi-summary", companyId],
    queryFn: () => getKpiSummary(companyId),
    enabled: Boolean(companyId),
  });

  const frequentRows = useMemo(() => {
    const apiRows = frequentQuery.data ?? [];
    const seen = new Set(apiRows.map((r) => r.id));
    const extra = BLOCK_W_FREQUENT_ROWS.filter((r) => !seen.has(r.id));
    return [...apiRows, ...extra];
  }, [frequentQuery.data]);

  // RPT-2 / RPT-S06: never fabricate counts while loading. Until KPI resolves, show "—" (not a fake 0
  // that reads as “proven empty”). Real 0 is fine once the query succeeds.
  const ifta = kpiQuery.data?.ifta_status;
  const kpiReady = kpiQuery.isSuccess && kpiQuery.data != null;
  const anyQueryError = kpiQuery.isError || frequentQuery.isError || iftaQuery.isError;
  const reportsKpis: ReportsKpi[] = [
    {
      label: "Available reports",
      value: kpiReady ? String(kpiQuery.data?.available_reports ?? 0) : "—",
      meta: kpiReady ? "categories live" : kpiQuery.isError ? "Failed to load" : "Loading…",
    },
    {
      label: "Custom schedules",
      value: kpiReady ? String(kpiQuery.data?.scheduled ?? 0) : "—",
      meta: kpiReady ? "auto-emailed" : kpiQuery.isError ? "Failed to load" : "Loading…",
    },
    {
      label: "Run last 7 days",
      value: kpiReady ? String(kpiQuery.data?.run_last_7d ?? 0) : "—",
      meta: kpiReady ? "across all users" : kpiQuery.isError ? "Failed to load" : "Loading…",
    },
    ifta
      ? {
          label: `IFTA ${ifta.quarter} due`,
          value: `${ifta.daysUntilDue}d`,
          meta: `${mmmDd(ifta.dueAt)} — file before`,
          warn: true,
        }
      : { label: "IFTA due", value: "—", meta: iftaQuery.isError ? "Failed to load" : "Loading…", warn: false },
  ];

  function handleRunReport(row: FrequentlyRunReport) {
    const phase6 = PHASE_6_REPORT_HREFS[row.id];
    if (phase6) {
      navigate(phase6);
      return;
    }
    if (row.id === "ar-aging") {
      navigate("/reports/ar-aging");
      return;
    }
    if (row.id === "ap-aging") {
      navigate("/reports/ap-aging");
      return;
    }
    if (row.status === "stub") {
      if (row.id === "detention-claims") {
        pushToast("Detention billing report ships in Phase 4.", "info");
        return;
      }
    }
    navigate(`/reports/run/${encodeURIComponent(row.id)}`);
  }

  function basisForReport(reportId: string) {
    if (
      reportId === "trial-balance" ||
      reportId === "profit-loss" ||
      reportId === "balance-sheet"
    )
      return basis;
    return "accrual";
  }

  return (
    <div className="space-y-3">
      <ReportsSubNav />
      <PageHeader
        title="Reports"
        subtitle="Hover a domain category, then open a report to run"
        actions={
          <div className="flex items-center gap-2">
            <Button onClick={() => setShowCustomBuilder((v) => !v)}>
              + Custom report
            </Button>
            <Button
              variant="secondary"
              onClick={() => navigate("/reports/scheduled")}
            >
              Schedule
            </Button>
          </div>
        }
      />

      <CategoryHoverNav
        activeCategory={category}
        onCategoryChange={setCategory}
      />

      {anyQueryError ? (
        <ListErrorBanner
          message="Reports data could not be loaded."
          onRetry={() => { void kpiQuery.refetch(); void frequentQuery.refetch(); void iftaQuery.refetch(); }}
        />
      ) : null}

      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
        {reportsKpis.map((item) => (
          <div
            key={item.label}
            className={`rounded-sm border bg-white px-3 py-2 ${item.warn ? "border-l-[3px] border-l-[#334155]" : "border-slate-200"}`}
          >
            <div className="text-[11px] font-semibold uppercase tracking-[0.04em] text-slate-500">
              {item.label}
            </div>
            <div
              className={`text-page-title font-semibold ${item.warn ? "text-[#334155]" : "text-slate-900"}`}
            >
              {item.value}
            </div>
            <div className="text-xs text-slate-500">{item.meta}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-3 lg:grid-cols-[1.8fr_1fr]">
        <div className="space-y-3">
          <section className="overflow-hidden rounded-sm border border-slate-200 bg-white">
            <div className="border-b border-slate-200 px-3 py-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-xs font-semibold text-slate-900">
                  Accounting + financial reports
                </h3>
                <BasisSelector value={basis} onChange={setBasis} />
              </div>
              <p className="text-xs text-slate-500">
                Core accounting statements plus operational finance views
              </p>
            </div>
            {/* Flat grid cells — no nested bordered tiles (Cascade row 205 box-in-box). */}
            <div className="grid sm:grid-cols-2 sm:divide-x sm:divide-slate-100">
              {(
                [
                  ["trial-balance", "Trial balance"],
                  ["profit-loss", "Profit & loss"],
                  ["balance-sheet", "Balance sheet"],
                  ["cash-flow-statement", "Cash flow statement"],
                  ["cash-flow-overview", "Cash flow overview"],
                  ["settlement-summary", "Settlement summary"],
                  ["customer-profitability", "Customer profitability"],
                  ["profit-per-truck", "Per-truck CPM dashboard"],
                  ["fuel-reconciliation", "Fuel reconciliation"],
                  ["maintenance-cost-per-unit", "Maintenance cost per unit"],
                  ["geofence-dwell", "Geofence dwell report"],
                  ["posted-while-tour-open", "Posted while tour open"],
                  ["scheduled-reports", "Default report subscriptions"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  className="border-t border-slate-100 px-3 py-2 text-left text-xs font-semibold text-slate-800 hover:bg-slate-50"
                  onClick={() => navigate(PHASE_6_REPORT_HREFS[id])}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span>{label}</span>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                      {basisForReport(id)}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </section>
          <section className="overflow-hidden rounded-sm border border-slate-200 bg-white">
            <div className="border-b border-slate-200 px-3 py-2">
              <h3 className="text-xs font-semibold text-slate-900">
                Management reports
              </h3>
              <p className="text-xs text-slate-500">
                Branded financial compilations — lender, insurance, and
                stakeholder ready
              </p>
            </div>
            <div className="grid sm:grid-cols-3 sm:divide-x sm:divide-slate-100">
              {(
                [
                  [
                    "company-overview",
                    "Company Overview",
                    "P&L + Balance Sheet",
                  ],
                  [
                    "sales-performance",
                    "Sales Performance",
                    "P&L + A/R Aging + Customer Summary",
                  ],
                  [
                    "expenses-performance",
                    "Expenses Performance",
                    "P&L + A/P Aging + Vendor Summary",
                  ],
                ] as const
              ).map(([type, label, sub]) => (
                <button
                  key={type}
                  type="button"
                  className="border-t border-slate-100 px-3 py-2 text-left hover:bg-slate-50"
                  onClick={() => navigate(`/reports/management?type=${type}`)}
                >
                  <div className="text-xs font-semibold text-slate-800">
                    {label}
                  </div>
                  <div className="mt-0.5 text-xs text-slate-500">{sub}</div>
                </button>
              ))}
            </div>
          </section>
          <FrequentlyRunTable rows={frequentRows} onRun={handleRunReport} />
        </div>
        <ScheduledReportsPanel />
      </div>

      {iftaQuery.data ? <IftaPreparerCard status={iftaQuery.data} /> : null}

      {showCustomBuilder ? <CustomReportBuilder /> : null}

      {category === "saved" && !showCustomBuilder ? (
        <section className="rounded-sm border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
          Open <strong>+ Custom report</strong> to build and save reports —
          saved definitions appear in the builder list.
        </section>
      ) : null}
    </div>
  );
}
