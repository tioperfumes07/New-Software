import { Link, useSearchParams } from "react-router-dom";
import { TrendingUp } from "lucide-react";
import { PageHeader } from "../../components/layout/PageHeader";
import { NavyPageSubNav } from "../../components/layout/NavyPageSubNav";
import { useCompanyContext } from "../../contexts/CompanyContext";
import { DailyPredictionTab } from "./tabs/DailyPredictionTab";
import { ActualVsProjectedTab } from "./tabs/ActualVsProjectedTab";
import { ManualDailyProjectionsTab } from "./tabs/ManualDailyProjectionsTab";
import { RollingLedgerTab } from "./tabs/RollingLedgerTab";
import { useFeatureFlag } from "../../hooks/useFeatureFlag";
import { CASH_FORECAST_ENABLED_FLAG } from "../../api/forecast";

type CashFlowTabId = "daily_prediction" | "actual_vs_projected" | "manual_daily_projections" | "rolling_ledger";

const ALL_TAB_IDS = new Set<CashFlowTabId>([
  "daily_prediction",
  "actual_vs_projected",
  "manual_daily_projections",
  "rolling_ledger",
]);

function parseCashFlowTab(raw: string | null, allowManual: boolean): CashFlowTabId {
  if (raw && ALL_TAB_IDS.has(raw as CashFlowTabId)) {
    if (raw === "manual_daily_projections" && !allowManual) return "daily_prediction";
    return raw as CashFlowTabId;
  }
  return "daily_prediction";
}

export function CashFlowPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { selectedCompanyId } = useCompanyContext();
  // Block F: the hand-entered tab only appears once its OFF-by-default flag is on.
  const { enabled: manualForecastEnabled } = useFeatureFlag(CASH_FORECAST_ENABLED_FLAG, selectedCompanyId ?? undefined);
  const activeTab = parseCashFlowTab(searchParams.get("tab"), Boolean(manualForecastEnabled));
  const setActiveTab = (next: CashFlowTabId) => {
    const params = new URLSearchParams(searchParams);
    if (next === "daily_prediction") params.delete("tab");
    else params.set("tab", next);
    setSearchParams(params, { replace: true });
  };
  const TABS: { id: CashFlowTabId; label: string }[] = [
    { id: "daily_prediction", label: "Projected (Auto)" },
    { id: "actual_vs_projected", label: "Actual vs Projected" },
    { id: "rolling_ledger", label: "Rolling Ledger" },
    ...(manualForecastEnabled ? [{ id: "manual_daily_projections" as const, label: "Manual Daily Projections" }] : []),
  ];

  if (!selectedCompanyId) {
    return (
      <div className="space-y-4">
        <PageHeader backHref="/home" title="Cash Flow" subtitle="Daily cash position — predicted income and expenses" />
        <div className="rounded-lg border border-gray-200 bg-white p-8 text-center">
          <TrendingUp className="mx-auto mb-3 h-10 w-10 text-gray-300" />
          <p className="text-xs text-gray-500">Select a company to view cash flow.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="cash-flow-page">
      <PageHeader
        backHref="/home"
        title="Cash Flow"
        subtitle="Forward-looking daily cash position — predicted income and expenses"
      />
      <NavyPageSubNav
        items={TABS.map((t) => ({ label: t.label, to: `#${t.id}` }))}
        activeId={activeTab}
        onTabChange={(id) => setActiveTab(id as CashFlowTabId)}
        itemIds={TABS.map((t) => t.id)}
      />
      <nav
        aria-label="Cash flow related modules"
        className="flex flex-wrap items-center gap-2 rounded-sm border border-slate-200 bg-white px-3 py-2 text-xs"
        data-testid="cash-flow-cross-module-links"
      >
        <span className="font-semibold text-slate-500">Related:</span>
        <Link className="font-medium text-slate-700 underline-offset-2 hover:underline" to="/banking">
          Banking
        </Link>
        <Link className="font-medium text-slate-700 underline-offset-2 hover:underline" to="/reports/cash-flow-statement">
          Cash flow statement
        </Link>
        <Link className="font-medium text-slate-700 underline-offset-2 hover:underline" to="/reports/cash-flow">
          Cash flow report
        </Link>
        <Link className="font-medium text-slate-700 underline-offset-2 hover:underline" to="/reports/cash-flow-overview">
          Cash flow overview
        </Link>
        <Link className="font-medium text-slate-700 underline-offset-2 hover:underline" to="/cash-advances">
          Cash advances
        </Link>
      </nav>
      {activeTab === "daily_prediction" && (
        <DailyPredictionTab operatingCompanyId={selectedCompanyId} />
      )}
      {activeTab === "actual_vs_projected" && (
        <ActualVsProjectedTab operatingCompanyId={selectedCompanyId} />
      )}
      {activeTab === "rolling_ledger" && (
        <RollingLedgerTab operatingCompanyId={selectedCompanyId} />
      )}
      {activeTab === "manual_daily_projections" && manualForecastEnabled && (
        <ManualDailyProjectionsTab operatingCompanyId={selectedCompanyId} />
      )}
    </div>
  );
}
