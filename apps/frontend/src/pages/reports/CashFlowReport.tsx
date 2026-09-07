import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "../../api/client";
import { PageHeader } from "../../components/layout/PageHeader";
import { ListErrorState } from "../../components/ListErrorState";
import { useCompanyContext } from "../../contexts/CompanyContext";
import { ReportsSubNav } from "./ReportsSubNav";
import { ReportFilterBar } from "../../components/reports/ReportFilterBar";
import { companyToday } from "../../lib/businessDate";

type CashFlowReportResponse = {
  operating_company_id: string;
  as_of_date: string;
  operating_balance_cents: number;
  scoped_load_count: number;
};

import { formatUsdCents } from "../../lib/money";

// GLB-05 -- delegates to the canonical formatter instead of reimplementing an identical
// local currency formatter (same shape lib/money.ts already covers).
function money(cents: number) {
  if (!cents) return "—";
  return formatUsdCents(cents);
}

export function CashFlowReport() {
  const { selectedCompanyId, selectedCompany } = useCompanyContext();
  const companyId = selectedCompanyId ?? "";
  const today = companyToday();
  const [searchParams, setSearchParams] = useSearchParams();
  const [appliedAsOf, setAppliedAsOf] = useState(today);
  const [groupBy, setGroupBy] = useState("month");
  const [reportSearch, setReportSearch] = useState("");

  const query = useQuery({
    queryKey: ["reports", "cash-flow", companyId, appliedAsOf],
    enabled: Boolean(companyId),
    queryFn: () =>
      apiRequest<CashFlowReportResponse>(
        `/api/v1/reports/cash-flow?operating_company_id=${encodeURIComponent(companyId)}&as_of_date=${appliedAsOf}`
      ),
  });

  const summary = useMemo(() => {
    const data = query.data;
    if (!data) return null;
    const q = reportSearch.toLowerCase();
    if (!q) return data;
    const matches = String(data.as_of_date ?? "").toLowerCase().includes(q);
    return matches ? data : null;
  }, [query.data, reportSearch]);

  return (
    <div className="space-y-4 p-4">
      <PageHeader
        title="Cash flow"
        subtitle="Tenant-scoped liquidity snapshot (GAP-45)"
        backHref="/reports"
        breadcrumb={["Reports", "Cash Flow"]}
      />
      <ReportsSubNav />

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={() => {
            if (!summary) return;
            const lines = [
              "as_of_date,operating_balance_cents,scoped_load_count",
              `${summary.as_of_date},${summary.operating_balance_cents},${summary.scoped_load_count}`,
            ];
            const blob = new Blob([lines.join("\n")], { type: "text/csv" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = "cash-flow-report.csv";
            a.click();
            URL.revokeObjectURL(url);
          }}
          className="rounded-sm border border-gray-300 bg-white px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
        >
          Export CSV
        </button>
        <button
          type="button"
          onClick={() => window.print()}
          className="rounded-sm border border-gray-300 bg-white px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
        >
          Print
        </button>
      </div>
      <ReportFilterBar
        testIdPrefix="reports-cash-flow"
        fromDate={appliedAsOf}
        toDate={null}
        onFromDateChange={(d) => setAppliedAsOf(d ?? today)}
        onToDateChange={() => {}}
        onPresetSelect={(preset) => {
          const next = new URLSearchParams(searchParams);
          next.set("preset", preset);
          setSearchParams(next, { replace: true });
        }}
        search={reportSearch}
        onSearchChange={setReportSearch}
      >
        <label className="flex items-center gap-1 text-xs text-slate-600">
          <span className="font-semibold text-slate-600">Group by</span>
          <select
            className="h-7 rounded-sm border border-slate-300 px-2 text-xs"
            value={groupBy}
            onChange={(e) => setGroupBy(e.target.value)}
            data-testid="reports-cash-flow-group-by"
          >
            <option value="day">Day</option>
            <option value="week">Week</option>
            <option value="month">Month</option>
          </select>
        </label>
      </ReportFilterBar>
      {query.isLoading ? <p>Loading…</p> : null}
      {query.isError ? (
        <ListErrorState
          title="Couldn't load cash flow"
          status={0}
          message={(query.error as Error)?.message}
          onRetry={() => void query.refetch()}
        />
      ) : null}
      {summary ? (
        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-sm border bg-white p-4">
            <div className="text-xs text-slate-600">Operating balance</div>
            <div className="text-page-title font-semibold">{money(summary.operating_balance_cents)}</div>
          </div>
          <div className="rounded-sm border bg-white p-4">
            <div className="text-xs text-slate-600">Scoped loads (OCI)</div>
            <div className="text-page-title font-semibold">{summary.scoped_load_count}</div>
            <div className="text-xs text-slate-500">Company: {selectedCompany?.legal_name ?? "—"}</div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default CashFlowReport;
