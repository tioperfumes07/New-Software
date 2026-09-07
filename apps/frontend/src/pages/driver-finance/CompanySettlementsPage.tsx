// L.6 — COMPANY SETTLEMENTS (read-only, owner task 2026-09-06).
//
// "One number over many loads": the list rolls a whole settlement period up to a single
// net-revenue figure (a handful of driver settlements → one company settlement → one Net Revenue).
// Selecting a row opens the 8-section waterfall (buildCompanySettlementReport): Gross Revenue →
// driver pay + deductions → fuel → expenses → Net Revenue, tied to the cent by construction.
//
// Read-only: no create/void/edit here. Money uses the app cents formatter; a voided settlement's
// net is a dash, never a fake $0.00 (law §8, dash-never-zero). Styling uses the .ldt-* palette
// (styles/tokens-load-detail.css) matching the Load-detail Costs / Tour-settlement surfaces.
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { PageHeader } from "../../components/layout/PageHeader";
import { NavyPageSubNav } from "../../components/layout/NavyPageSubNav";
import { ListErrorBanner } from "../../components/shared/ListErrorBanner";
import { ParityTable, type ParityColumn } from "../../components/parity/ParityTable";
import { useCompanyContext } from "../../contexts/CompanyContext";
import {
  listCompanySettlements,
  getCompanySettlementReport,
  type CompanySettlementListRow,
} from "../../api/accounting";
import { formatUsdCents } from "../../lib/money";
import { mmmDd } from "../../lib/formatDate";
import { CompanySettlementItemizedByLoad } from "./components/CompanySettlementItemizedByLoad";

// Dash-never-zero (law §8): a null/void money value renders "—", never "$0.00".
const DASH = "—";
function money(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return DASH;
  return formatUsdCents(cents);
}
function date(value: string | null | undefined): string {
  const out = mmmDd(value ?? "");
  return out || DASH;
}

function statusPillClass(row: CompanySettlementListRow): string {
  if (row.voided_at) return "ldt-pill bad";
  const s = (row.status || "").toLowerCase();
  if (s === "closed" || s === "final" || s === "paid") return "ldt-pill ok";
  return "ldt-pill warn";
}

function statusLabel(row: CompanySettlementListRow): string {
  if (row.voided_at) return "Voided";
  return row.status || "—";
}

export function CompanySettlementsPage() {
  const { selectedCompanyId } = useCompanyContext();
  const companyId = selectedCompanyId ?? "";
  const [selected, setSelected] = useState<CompanySettlementListRow | null>(null);
  // ROUND 16.2 item 3 — EntityLink kind="company_settlement" (EntityLink.tsx) drills here via
  // ?id=<company_settlement_id>. Auto-open that row's detail panel once the list loads, same
  // pattern SettlementDetailPage uses for ?settlement_id.
  const [searchParams] = useSearchParams();
  const deepLinkId = searchParams.get("id");

  const listQuery = useQuery({
    queryKey: ["accounting", "company-settlements", companyId],
    queryFn: () => listCompanySettlements(companyId),
    enabled: Boolean(companyId),
  });

  const rows = listQuery.data?.company_settlements ?? [];

  useEffect(() => {
    if (!deepLinkId || selected) return;
    const match = rows.find((r) => r.id === deepLinkId);
    if (match) setSelected(match);
  }, [deepLinkId, rows, selected]);

  const columns = useMemo<ParityColumn<CompanySettlementListRow>[]>(
    () => [
      {
        key: "display_id",
        label: "Display ID",
        className: "text-left",
        sortValue: (r) => r.display_id,
        render: (r) => <span className="ldt-mono">{r.display_id || DASH}</span>,
        exportValue: (r) => r.display_id,
      },
      {
        key: "period_start",
        label: "Period Start",
        sortValue: (r) => r.period_start,
        render: (r) => date(r.period_start),
        exportValue: (r) => date(r.period_start),
      },
      {
        key: "period_end",
        label: "Period End",
        sortValue: (r) => r.period_end,
        render: (r) => date(r.period_end),
        exportValue: (r) => date(r.period_end),
      },
      {
        key: "status",
        label: "Status",
        sortValue: (r) => statusLabel(r),
        render: (r) => <span className={statusPillClass(r)}>{statusLabel(r)}</span>,
        exportValue: (r) => statusLabel(r),
      },
      {
        key: "driver_settlement_count",
        label: "Driver Settlements",
        sortValue: (r) => r.driver_settlement_count,
        render: (r) => r.driver_settlement_count,
        exportValue: (r) => r.driver_settlement_count,
      },
      {
        key: "net_revenue_cents",
        label: "Net Revenue",
        className: "text-right",
        cellClass: "text-right ldt-mono",
        sortValue: (r) => (r.net_revenue_cents === null ? null : r.net_revenue_cents),
        render: (r) => money(r.net_revenue_cents),
        exportValue: (r) => (r.net_revenue_cents === null ? DASH : formatUsdCents(r.net_revenue_cents)),
      },
    ],
    []
  );

  return (
    <div className="space-y-3">
      <PageHeader
        title="Company Settlements"
        subtitle="One number over many loads — settlement periods rolled to net revenue"
      />

      <NavyPageSubNav
        items={[
          { label: "Settlements", to: "/driver-finance/settlements" },
          { label: "Company Settlements", to: "/driver-finance/company-settlements" },
          { label: "Settlement Close", to: "/driver-finance/settlement-close" },
          { label: "Cash Advance Requests", to: "/driver-finance/cash-advance-requests" },
          { label: "Cash Advances", to: "/cash-advances" },
          { label: "Escrow", to: "/accounting/escrow" },
        ]}
      />

      {listQuery.isError ? (
        <ListErrorBanner
          message="Failed to load company settlements."
          onRetry={() => void listQuery.refetch()}
        />
      ) : null}

      <ParityTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        loading={listQuery.isPending && Boolean(companyId)}
        onRowClick={(r) => setSelected(r)}
        rowClassName={(r) => (selected?.id === r.id ? "bg-slate-50" : "")}
        emptyText={
          companyId ? "No company settlements yet." : "Select a company to view its settlements."
        }
        storageKey="company-settlements-list"
        exportFilename="company-settlements"
      />

      {selected ? (
        <CompanySettlementWaterfall
          companyId={companyId}
          row={selected}
          onClose={() => setSelected(null)}
        />
      ) : null}
    </div>
  );
}

function CompanySettlementWaterfall({
  companyId,
  row,
  onClose,
}: {
  companyId: string;
  row: CompanySettlementListRow;
  onClose: () => void;
}) {
  const reportQuery = useQuery({
    queryKey: ["accounting", "company-settlement-report", companyId, row.id],
    queryFn: () => getCompanySettlementReport(row.id, companyId),
    enabled: Boolean(companyId) && Boolean(row.id),
  });

  const report = reportQuery.data;
  const isVoided = Boolean(row.voided_at);

  return (
    <div className="ldt-card" data-surface="load-detail" data-testid="company-settlement-waterfall">
      <div className="ldt-ch">
        <span>
          Company Settlement · {row.display_id} · {date(row.period_start)} – {date(row.period_end)}
        </span>
        <button type="button" className="ldt-link" onClick={onClose}>
          Close
        </button>
      </div>

      {isVoided ? (
        <div className="ldt-note bad">
          This company settlement is voided — its waterfall is retained for audit but carries no live
          net revenue (shown as {DASH} on the list).
        </div>
      ) : null}

      {reportQuery.isError ? (
        <div className="p-2">
          <ListErrorBanner
            message="Failed to load the settlement waterfall."
            onRetry={() => void reportQuery.refetch()}
          />
        </div>
      ) : reportQuery.isPending ? (
        <div className="ldt-hint">Loading waterfall…</div>
      ) : !report ? (
        <div className="ldt-hint">No waterfall available for this settlement.</div>
      ) : (
        <div className="ldt-rows">
          <div className="ldt-row head">
            <span>Waterfall</span>
            <span className="ldt-right">Amount</span>
          </div>

          <div className="ldt-row">
            <span>Gross Revenue (Invoiced)</span>
            <span className="ldt-m">{money(report.sections.revenue.invoiced_cents)}</span>
          </div>

          {report.sections.pl_rollup.lines.map((line) => (
            <div className="ldt-row" key={line.line_type}>
              <span>Less · {line.label}</span>
              <span className="ldt-m">{money(line.amount_cents)}</span>
            </div>
          ))}

          <div className="ldt-row">
            <span>
              Less · Fuel Purchases
              {report.sections.fuel_purchases.total_gallons > 0
                ? ` (${report.sections.fuel_purchases.total_gallons.toLocaleString()} gal)`
                : ""}
            </span>
            <span className="ldt-m">{money(report.sections.fuel_purchases.total_cents)}</span>
          </div>

          <div className="ldt-row">
            <span>Less · Company Expenses</span>
            <span className="ldt-m">{money(report.sections.expenses.total_cents)}</span>
          </div>

          <div className="ldt-row big">
            <span>Net Revenue</span>
            {/* Dash-never-zero — a voided settlement never shows a fabricated net. */}
            <span className="ldt-m">
              {isVoided ? DASH : money(report.sections.pl_rollup.net_revenue_cents)}
            </span>
          </div>

          {report.sections.miles_and_mpg.total_miles > 0 ? (
            <div className="ldt-row tot">
              <span>
                Miles {report.sections.miles_and_mpg.total_miles.toLocaleString()}
                {report.sections.miles_and_mpg.mpg !== null
                  ? ` · ${report.sections.miles_and_mpg.mpg} MPG`
                  : ""}
              </span>
              <span className="ldt-m">{DASH}</span>
            </div>
          ) : null}
        </div>
      )}

      {/* ROUND 16.19 — itemized per-load register UNDER the waterfall above (never replacing it —
          the waterfall's Net Revenue stays the one audited figure). */}
      {report ? (
        <>
          <div className="ldt-ch" style={{ marginTop: 8 }}>
            <span>Itemized by load</span>
          </div>
          <CompanySettlementItemizedByLoad report={report} />
        </>
      ) : null}
    </div>
  );
}
