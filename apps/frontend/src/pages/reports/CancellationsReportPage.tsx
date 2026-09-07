import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { PageHeader } from "../../components/layout/PageHeader";
import { useCompanyContext } from "../../contexts/CompanyContext";
import { getCancellationsReport, type CancellationBucket } from "../../api/reports";
import { ReportsSubNav } from "./ReportsSubNav";
import { ParityTable, type ParityColumn } from "../../components/parity/ParityTable";
import { ListErrorState } from "../../components/ListErrorState";
import { formatQueryErrorDetail } from "../../lib/tableError";
import { EntityLink, type EntityKind } from "../../components/shared/EntityLink";
import { entityLabel, isUnresolvedEntityTombstone } from "../../lib/entity-label";
import { mmmDd } from "../../lib/formatDate";
import { ReportFilterBar } from "../../components/reports/ReportFilterBar";

import { formatUsdCents } from "../../lib/money";

// GLB-05 -- delegates to the canonical formatter instead of reimplementing an identical
// local currency formatter (same shape lib/money.ts already covers).
function money(cents: number) {
  if (!cents) return "—";
  return formatUsdCents(cents);
}

const BUCKET_SECTIONS = [
  { title: "By reason", prop: "by_reason" as const, storageKey: "cancellations-report-by-reason", entityKind: null, formatAsDate: false },
  { title: "By driver", prop: "by_driver" as const, storageKey: "cancellations-report-by-driver", entityKind: "driver" as const, formatAsDate: false },
  { title: "By customer", prop: "by_customer" as const, storageKey: "cancellations-report-by-customer", entityKind: "customer" as const, formatAsDate: false },
  { title: "By date", prop: "by_date" as const, storageKey: "cancellations-report-by-date", entityKind: null, formatAsDate: true },
];

const UUID_KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function entityNoun(kind: EntityKind): string {
  return kind === "customer" ? "Customer" : kind === "driver" ? "Driver" : "Record";
}

/** Display-only: By date bucket labels are ISO YYYY-MM-DD keys — never mutate row.key / sort / API. */
function cancellationsByDateLabel(row: CancellationBucket): string {
  const raw = (row.label || row.key || "").trim();
  return mmmDd(raw) || raw;
}

function bucketColumns(
  groupLabel: string,
  entityKind: EntityKind | null,
  formatAsDate: boolean,
): ParityColumn<CancellationBucket>[] {
  return [
    {
      key: "label",
      label: groupLabel,
      sortable: true,
      sortValue: (row) => row.key,
      render: (row) => {
        if (formatAsDate) {
          return <span className="font-medium text-gray-800">{cancellationsByDateLabel(row)}</span>;
        }
        if (!entityKind || !UUID_KEY.test(row.key)) {
          return <span className="font-medium text-gray-800">{row.label}</span>;
        }
        const noun = entityNoun(entityKind);
        const label = entityLabel(row.label, row.key, noun);
        if (isUnresolvedEntityTombstone(row.label, row.key, noun)) {
          return (
            <span className="font-medium text-gray-800" data-testid="cancellations-report-tombstone">
              {label}
            </span>
          );
        }
        return <EntityLink kind={entityKind} id={row.key} label={label} className="font-medium text-gray-800" />;
      },
    },
    { key: "count", label: "Count", sortable: true, className: "text-right", cellClass: "text-right font-mono" },
    { key: "billable_count", label: "Billable", sortable: true, className: "text-right", cellClass: "text-right font-mono text-gray-600" },
    {
      key: "total_charge_cents",
      label: "Charges",
      sortable: true,
      className: "text-right",
      cellClass: "text-right font-mono",
      render: (row) => money(row.total_charge_cents),
    },
  ];
}

function CancellationBucketTable({
  title,
  rows,
  storageKey,
  entityKind,
  formatAsDate,
  loading,
}: {
  title: string;
  rows: CancellationBucket[];
  storageKey: string;
  entityKind: EntityKind | null;
  formatAsDate: boolean;
  loading?: boolean;
}) {
  const exportFilename = `${storageKey}.csv`;
  const groupLabel = title.replace(/^By /, "");
  const columns = useMemo(
    () => bucketColumns(groupLabel, entityKind, formatAsDate),
    [entityKind, formatAsDate, groupLabel],
  );

  return (
    <div className="rounded-sm border border-gray-200 bg-white">
      <div className="border-b border-gray-200 bg-gray-50 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-600">
        {title}
      </div>
      <div className="p-2">
        <ParityTable
          rows={rows}
          columns={columns}
          rowKey={(row) => row.key}
          loading={loading}
          storageKey={storageKey}
          emptyText="No cancellations in range."
          exportFilename={exportFilename}
        />
      </div>
    </div>
  );
}

// GAP-10 — Load cancellations analytics. Read-only; groups cancellations by reason / driver / customer /
// date with billable-charge totals, scoped to the selected operating company (per-entity).
export function CancellationsReportPage() {
  const { selectedCompanyId } = useCompanyContext();
  const companyId = selectedCompanyId ?? "";
  const [searchParams, setSearchParams] = useSearchParams();
  const emptyFilters = { from: "", to: "", reason: "" };
  const [applied, setApplied] = useState(emptyFilters);
  const [reportSearch, setReportSearch] = useState("");

  const query = useQuery({
    queryKey: ["reports", "cancellations", companyId, applied.from, applied.to],
    queryFn: () =>
      getCancellationsReport({
        operating_company_id: companyId,
        from: applied.from || undefined,
        to: applied.to || undefined,
      }),
    enabled: Boolean(companyId),
    retry: false,
  });

  const data = query.data;
  const total = data?.total ?? { count: 0, total_charge_cents: 0, billable_count: 0 };
  const tableLoading = query.isPending || (query.isFetching && !data);

  const q = reportSearch.toLowerCase();
  const filterBuckets = (buckets: CancellationBucket[]) => {
    if (!q) return buckets;
    return buckets.filter((b) => String(b.label ?? "").toLowerCase().includes(q) || String(b.key ?? "").toLowerCase().includes(q));
  };

  return (
    <div className="space-y-3">
      <PageHeader
        title="Cancellations"
        subtitle="Reports"
        backHref="/reports"
        breadcrumb={["Reports", "Cancellations"]}
      />
      <ReportsSubNav />

      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => window.print()}
          className="rounded-sm border border-gray-300 bg-white px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
        >
          Print
        </button>
      </div>

      <ReportFilterBar
        testIdPrefix="reports-cancellations"
        fromDate={applied.from || null}
        toDate={applied.to || null}
        onFromDateChange={(d) => setApplied((p) => ({ ...p, from: d ?? "" }))}
        onToDateChange={(d) => setApplied((p) => ({ ...p, to: d ?? "" }))}
        onPresetSelect={(preset) => {
          const next = new URLSearchParams(searchParams);
          next.set("preset", preset);
          setSearchParams(next, { replace: true });
        }}
        search={reportSearch}
        onSearchChange={setReportSearch}
      >
        <label className="flex items-center gap-1 text-xs text-slate-600">
          <span className="font-semibold text-slate-600">Reason</span>
          <select
            className="h-7 rounded-sm border border-slate-300 px-2 text-xs"
            value={applied.reason}
            onChange={(e) => setApplied((p) => ({ ...p, reason: e.target.value }))}
            data-testid="reports-cancellations-reason"
          >
            <option value="">All reasons</option>
            <option value="customer_cancel">Customer cancel</option>
            <option value="carrier_cancel">Carrier cancel</option>
            <option value="weather">Weather</option>
            <option value="other">Other</option>
          </select>
        </label>
      </ReportFilterBar>

      {query.isError ? (
        <ListErrorState
          title="Couldn't load cancellations report"
          {...formatQueryErrorDetail(query.error)}
          onRetry={() => void query.refetch()}
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
            <div className="rounded-sm border border-gray-200 bg-white px-3 py-2">
              <div className="text-[11px] uppercase tracking-wide text-gray-500">Cancellations</div>
              <div className="text-page-title font-semibold">{total.count}</div>
            </div>
            <div className="rounded-sm border border-gray-200 bg-white px-3 py-2">
              <div className="text-[11px] uppercase tracking-wide text-gray-500">Billable to customer</div>
              <div className="text-page-title font-semibold">{total.billable_count}</div>
            </div>
            <div className="rounded-sm border border-gray-200 bg-white px-3 py-2">
              <div className="text-[11px] uppercase tracking-wide text-gray-500">Total charges</div>
              <div className="text-page-title font-semibold">{money(total.total_charge_cents)}</div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {BUCKET_SECTIONS.map(({ title, prop, storageKey, entityKind, formatAsDate }) => (
              <CancellationBucketTable
                key={prop}
                title={title}
                rows={filterBuckets(data?.[prop] ?? [])}
                storageKey={storageKey}
                entityKind={entityKind}
                formatAsDate={formatAsDate}
                loading={tableLoading}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
