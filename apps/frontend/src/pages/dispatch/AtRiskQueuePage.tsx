import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { listAtRiskOrLateDispatchLoads, type DispatchAlertLoadRow } from "../../api/dispatch";
import { ListErrorState } from "../../components/ListErrorState";
import { PageHeader } from "../../components/layout/PageHeader";
import { ParityTable, type ParityColumn } from "../../components/parity/ParityTable";
import { EntityLinkOrTombstone } from "../../components/shared/EntityLinkOrTombstone";
import { StatusBadge } from "../../components/StatusBadge";
import { useCompanyContext } from "../../contexts/CompanyContext";
import { DispatchAlertServerControls, type DispatchAlertRange } from "../../components/dispatch/DispatchAlertServerControls";
import { serverDispatchAlertQueryFromSortState, sortDispatchAlertBoardRows } from "./dispatchAlertBoardSort";

function etaLabel(prediction: Record<string, unknown> | null | undefined): string {
  if (!prediction) return "No ETA";
  const cls = String(prediction.confidence_class ?? "");
  const at = prediction.predicted_arrival_at ? new Date(String(prediction.predicted_arrival_at)).toLocaleString() : "";
  const variance = prediction.variance_minutes != null ? `${prediction.variance_minutes}m variance` : "";
  return [cls, at, variance].filter(Boolean).join(" · ");
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function moneyCents(v: unknown): string {
  return (num(v) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtWhen(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d.toLocaleString() : "—";
}

function place(city?: string | null, state?: string | null): string {
  return [city, state].filter(Boolean).join(", ") || "—";
}

export function AtRiskQueuePage() {
  const { selectedCompanyId } = useCompanyContext();
  const companyId = selectedCompanyId ?? "";
  const [range, setRange] = useState<DispatchAlertRange>({ from: "", to: "" });
  const [paritySortKey, setParitySortKey] = useState("load_number");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const serverSort = serverDispatchAlertQueryFromSortState(paritySortKey, sortDirection);

  const loadsQ = useQuery({
    queryKey: ["dispatch", "at-risk-or-late-loads", companyId, range, serverSort],
    queryFn: () => listAtRiskOrLateDispatchLoads(companyId, { ...range, ...serverSort }),
    enabled: Boolean(companyId),
  });

  const loads = useMemo(
    () => sortDispatchAlertBoardRows(loadsQ.data?.loads ?? [], paritySortKey, sortDirection),
    [loadsQ.data?.loads, paritySortKey, sortDirection],
  );
  type AtRiskRow = DispatchAlertLoadRow;

  const milesSum = useMemo(() => loads.reduce((s, row) => s + num(row.loaded_miles), 0), [loads]);
  const rateSumCents = useMemo(() => loads.reduce((s, row) => s + num(row.rate_total_cents), 0), [loads]);
  const weightedRpm = milesSum > 0 ? rateSumCents / 100 / milesSum : 0;

  const columns = useMemo<ParityColumn<AtRiskRow>[]>(
    () => [
      {
        key: "load_number",
        label: "Load #",
        sortable: true,
        className: "font-medium",
        render: (load) => <EntityLinkOrTombstone kind="load" id={load.id} name={load.load_number} noun="Load" />,
      },
      {
        key: "status",
        label: "Status",
        sortable: true,
        render: (load) => <StatusBadge status={load.status} />,
      },
      {
        key: "customer_name",
        label: "Customer",
        sortable: true,
        render: (load) => <EntityLinkOrTombstone kind="customer" id={load.customer_id} name={load.customer_name} noun="Customer" />,
      },
      {
        key: "customer_wo_number",
        label: "W.O. / PO",
        sortable: true,
        render: (load) => load.customer_wo_number || "—",
      },
      {
        key: "origin_city",
        label: "Origin",
        sortable: true,
        render: (load) => place(load.origin_city, load.origin_state),
      },
      {
        key: "delivery_city",
        label: "Destination",
        sortable: true,
        render: (load) => place(load.delivery_city, load.delivery_state),
      },
      {
        key: "pickup_at",
        label: "Pickup",
        sortable: true,
        render: (load) => fmtWhen(load.pickup_at),
      },
      {
        key: "delivery_at",
        label: "Delivery",
        sortable: true,
        render: (load) => fmtWhen(load.delivery_at),
      },
      {
        key: "driver_name",
        label: "Driver",
        sortable: true,
        render: (load) => <EntityLinkOrTombstone kind="driver" id={load.driver_id} name={load.driver_name} noun="Driver" />,
      },
      {
        key: "unit_number",
        label: "Unit",
        sortable: true,
        render: (load) => <EntityLinkOrTombstone kind="unit" id={load.unit_id} name={load.unit_number} noun="Unit" />,
      },
      {
        key: "loaded_miles",
        label: "Loaded mi",
        sortable: true,
        className: "text-right",
        render: (load) => (load.loaded_miles == null ? "—" : num(load.loaded_miles).toLocaleString(undefined, { maximumFractionDigits: 1 })),
      },
      {
        key: "rate_total_cents",
        label: "Rate",
        sortable: true,
        className: "text-right",
        render: (load) => (load.rate_total_cents == null ? "—" : moneyCents(load.rate_total_cents)),
      },
      {
        key: "rpm",
        label: "RPM",
        sortable: true,
        className: "text-right",
        render: (load) => (load.rpm == null ? "—" : num(load.rpm).toFixed(2)),
      },
      {
        key: "invoice_status",
        label: "Invoice",
        sortable: true,
        render: (load) => load.invoice_status || "Not cut",
      },
      {
        key: "risk_reason",
        label: "Reason",
        sortable: true,
        render: (load) =>
          [
            load.is_at_risk ? "At-risk" : null,
            load.is_late ? "Late" : null,
            load.risk_reason,
            etaLabel(load.latest_eta_prediction),
          ]
            .filter(Boolean)
            .join(" · ") || "—",
      },
      {
        key: "hours_over",
        label: "Hours over",
        sortable: true,
        className: "text-right",
        render: (load) => (load.hours_over == null ? "—" : num(load.hours_over).toFixed(1)),
      },
      {
        key: "promised_at",
        label: "Promised",
        sortable: true,
        render: (load) => fmtWhen(load.promised_at ?? load.next_stop_scheduled_at),
      },
    ],
    [],
  );

  // DSP-TBL (owner ruling 2026-09-05): footerCells replaces the raw colSpan=10 footer — the
  // "N loads shown" caption now lives in "load_number", each total stays keyed to its own
  // column (loaded_miles/rate_total_cents/rpm), so it can't drift if a column moves.
  const footerCells = {
    load_number: (
      <span className="font-normal" data-testid="at-risk-footer-count">
        {loads.length} loads shown · matches tile
      </span>
    ),
    loaded_miles: <span className="tabular-nums">{milesSum.toLocaleString(undefined, { maximumFractionDigits: 1 })}</span>,
    rate_total_cents: <span className="tabular-nums">{moneyCents(rateSumCents)}</span>,
    rpm: <span className="tabular-nums">{milesSum > 0 ? weightedRpm.toFixed(2) : "—"}</span>,
  };

  if (!companyId) {
    return <div className="rounded-sm border bg-white p-4 text-xs text-slate-600">Select an operating company.</div>;
  }

  return (
    <div data-testid="dispatch-at-risk-page" className="mx-auto max-w-6xl space-y-4">
      <PageHeader
        title="At-Risk / Late Queue"
        subtitle="Active dispatched, pickup, in-transit, or delivery loads with an at-risk or late ETA signal. Tile value equals this table's row count (union, not a sum)."
        actions={
          <Link to="/dispatch" className="rounded-sm border px-3 py-1.5 text-xs">
            Dispatch Home
          </Link>
        }
      />

      <DispatchAlertServerControls value={range} onApply={setRange} />

      {loadsQ.isError ? (
        <ListErrorState
          title="Couldn't load at-risk queue"
          status={0}
          message={(loadsQ.error as Error)?.message}
          onRetry={() => void loadsQ.refetch()}
        />
      ) : (
        <ParityTable<AtRiskRow>
          columns={columns}
          rows={loads}
          rowKey={(load) => load.id}
          loading={loadsQ.isLoading}
          emptyText="No loads at risk in the selected range."
          storageKey="dispatch-at-risk-late-queue"
          exportFilename="at-risk-late-queue"
          suppressToolbarRange
          sortKey={paritySortKey}
          sortDirection={sortDirection}
          sortMode="external"
          onSortChange={(key, direction) => {
            setParitySortKey(key);
            setSortDirection(direction);
          }}
          footerCells={footerCells}
        />
      )}
      <p className="text-[11px] text-gray-500" data-testid="kpi-drill-row-count">
        {loads.length} loads — must match the At-risk / late tile.
      </p>
    </div>
  );
}
