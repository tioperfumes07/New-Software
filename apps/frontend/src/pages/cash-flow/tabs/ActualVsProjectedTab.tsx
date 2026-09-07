import { useMemo, useState } from "react";
import { localDateFromIso } from "../../../lib/businessDate";
import { DatePicker } from "../../../components/forms/DatePicker";
import { useQuery } from "@tanstack/react-query";
import { TrendingUp, TrendingDown } from "lucide-react";
import { ListErrorState } from "../../../components/ListErrorState";
import { ParityTable, type ParityColumn } from "../../../components/parity/ParityTable";
import { CollapsedListFilters, useStagedListFilters } from "../../../components/table";
import { SelectCombobox } from "../../../components/Combobox";
import { getActualVsProjected, type ActualVsProjectedResult, type AvpLineItem } from "../../../api/cashFlow";
import { addDaysIso, companyToday } from "../../../lib/businessDate";
import { formatUsdCents } from "../../../lib/money";

// CASHFLOW-1: range must end on the company business date (Central), not the UTC date — otherwise the
// "To" defaults to tomorrow after ~7 PM Central. See lib/businessDate.
function todayIso(): string {
  return companyToday();
}

function sevenDaysAgoIso(): string {
  return addDaysIso(companyToday(), -7);
}

function formatCents(cents: number, opts?: { sign?: boolean }): string {
  const abs = Math.abs(cents);
  const dollars = formatUsdCents(abs);
  if (opts?.sign && cents > 0) return `+${dollars}`;
  if (opts?.sign && cents < 0) return `−${dollars}`;
  return cents < 0 ? `−${dollars}` : dollars;
}

function formatPct(pct: number | null): string {
  if (pct === null) return "—";
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`;
}

type Props = {
  operatingCompanyId: string;
};

type RowGroup = {
  date: string;
  income: AvpLineItem;
  expenses: AvpLineItem;
  net: AvpLineItem;
};

function groupByDate(lines: AvpLineItem[]): RowGroup[] {
  const map = new Map<string, Partial<RowGroup>>();
  for (const line of lines) {
    const g = map.get(line.date) ?? {};
    if (line.category === "income") g.income = line;
    else if (line.category === "expenses") g.expenses = line;
    else if (line.category === "net") g.net = line;
    g.date = line.date;
    map.set(line.date, g);
  }
  return Array.from(map.values())
    .filter((g): g is RowGroup => !!g.date && !!g.income && !!g.expenses && !!g.net)
    .sort((a, b) => a.date.localeCompare(b.date));
}

function VarianceCell({ variance_cents, variance_pct }: { variance_cents: number; variance_pct: number | null }) {
  const pos = variance_cents > 0;
  const zero = variance_cents === 0;
  return (
    <div className={`flex flex-col items-end ${zero ? "text-gray-500" : pos ? "text-slate-700" : "text-red-700"}`}>
      <span className="font-semibold">{formatCents(variance_cents, { sign: true })}</span>
      <span className="text-xs">{formatPct(variance_pct)}</span>
    </div>
  );
}

// Column order/formatting preserved 1:1 from the former hand-rolled table markup (display-only migration).
const COLUMNS: Array<ParityColumn<RowGroup>> = [
  {
    key: "date",
    label: "Date",
    sortable: true,
    className: "text-left",
    render: (g) => (
      <span className="font-medium text-gray-900">
        {localDateFromIso(g.date).toLocaleDateString("en-US", {
          weekday: "short",
          month: "short",
          day: "numeric",
        })}
      </span>
    ),
  },
  {
    key: "projected_income",
    label: "Projected Income",
    sortable: true,
    className: "text-right",
    sortValue: (g) => g.income.projected_cents,
    render: (g) => (
      <span className="text-gray-700">
        {formatCents(g.income.projected_cents)}
        {/* DEAD-SCHEMA-CASH-FLOW-SNAPSHOT-CAPTURED-AT-UNREAD — honest provenance: this figure is a
            frozen daily snapshot, not a live recomputation. Shown only when the backend actually
            sourced it from forecast.cash_flow_projection_snapshots. */}
        {g.income.projected_captured_at ? (
          <span
            className="block text-xs text-gray-400"
            title={`Frozen snapshot captured ${new Date(g.income.projected_captured_at).toLocaleString()}`}
          >
            snapshot {new Date(g.income.projected_captured_at).toLocaleDateString()}
          </span>
        ) : null}
      </span>
    ),
  },
  {
    key: "actual_income",
    label: "Actual Income",
    sortable: true,
    className: "text-right",
    sortValue: (g) => g.income.actual_cents,
    render: (g) => <ActualCell line={g.income} />,
  },
  {
    key: "income_variance",
    label: "Income Variance",
    sortable: true,
    className: "text-right",
    sortValue: (g) => g.income.variance_cents,
    render: (g) =>
      g.income.actual_unavailable ? (
        <span className="text-xs text-gray-400">—</span>
      ) : (
        <VarianceCell variance_cents={g.income.variance_cents} variance_pct={g.income.variance_pct} />
      ),
  },
  {
    key: "projected_expenses",
    label: "Projected Exp.",
    sortable: true,
    className: "text-right",
    sortValue: (g) => g.expenses.projected_cents,
    render: (g) => <span className="text-gray-700">{formatCents(g.expenses.projected_cents)}</span>,
  },
  {
    key: "actual_expenses",
    label: "Actual Exp.",
    sortable: true,
    className: "text-right",
    sortValue: (g) => g.expenses.actual_cents,
    render: (g) => <ActualCell line={g.expenses} />,
  },
  {
    key: "expense_variance",
    label: "Exp. Variance",
    sortable: true,
    className: "text-right",
    sortValue: (g) => g.expenses.variance_cents,
    render: (g) =>
      g.expenses.actual_unavailable ? (
        <span className="text-xs text-gray-400">—</span>
      ) : (
        <VarianceCell variance_cents={g.expenses.variance_cents} variance_pct={g.expenses.variance_pct} />
      ),
  },
  {
    key: "net",
    label: "Net",
    sortable: true,
    className: "text-right",
    sortValue: (g) => g.net.actual_cents,
    render: (g) =>
      g.income.actual_unavailable || g.expenses.actual_unavailable ? (
        <span className="text-xs text-gray-400" title="Actual net depends on actual income/expenses, both unavailable">—</span>
      ) : (
        <span className={`font-bold ${g.net.actual_cents >= 0 ? "text-slate-700" : "text-red-700"}`}>
          {formatCents(g.net.actual_cents, { sign: true })}
        </span>
      ),
  },
];

// CASH-FLOW-01 (owner order 2026-09-06, LAW §8 "zero is a claim"): actual_unavailable means the
// backend measured 0 categorized bank lines company-wide -- a bare $0 here would read as
// "confirmed zero cash moved" when the truth is "we cannot see actuals yet". Render the honest
// state instead of the number.
function ActualCell({ line }: { line: AvpLineItem }) {
  if (line.actual_unavailable) {
    return (
      <span className="text-xs text-gray-400" title="0 bank lines categorized — actuals unavailable, not a confirmed zero">
        unavailable
      </span>
    );
  }
  return <span className="text-gray-700">{formatCents(line.actual_cents)}</span>;
}

type VarianceFilter = "all" | "over" | "under" | "flat";
type AvpFilterDraft = {
  from: string;
  to: string;
  varianceFilter: VarianceFilter;
};

export function ActualVsProjectedTab({ operatingCompanyId }: Props) {
  // LV-CASH-FLOW-ACTUAL-SPLIT-FILTER-APPLY — From/To + Net variance share one staged Filters draft.
  const defaultFrom = sevenDaysAgoIso();
  const defaultTo = todayIso();
  const [applied, setApplied] = useState<AvpFilterDraft>({
    from: defaultFrom,
    to: defaultTo,
    varianceFilter: "all",
  });
  const staged = useStagedListFilters({
    applied,
    empty: { from: defaultFrom, to: defaultTo, varianceFilter: "all" as VarianceFilter },
    onApply: (next) => {
      if (next.from > next.to) return;
      setApplied(next);
    },
  });
  const draftInvalid = staged.draft.from > staged.draft.to;
  const activeFilterCount =
    (applied.varianceFilter === "all" ? 0 : 1) +
    (applied.from !== defaultFrom || applied.to !== defaultTo ? 1 : 0);

  const avpQ = useQuery<ActualVsProjectedResult>({
    queryKey: ["cash-flow-avp", operatingCompanyId, applied.from, applied.to],
    queryFn: () => getActualVsProjected(operatingCompanyId, applied.from, applied.to),
    enabled: !!operatingCompanyId && applied.from <= applied.to,
  });
  const { data, isLoading, isError } = avpQ;

  const groups = data ? groupByDate(data.lines) : [];
  const filteredGroups = useMemo(() => {
    if (applied.varianceFilter === "all") return groups;
    return groups.filter((g) => {
      const v = g.net.variance_cents;
      if (applied.varianceFilter === "over") return v > 0;
      if (applied.varianceFilter === "under") return v < 0;
      return v === 0;
    });
  }, [groups, applied.varianceFilter]);
  const acc = data?.accuracy_summary;

  return (
    <div className="space-y-4">
      {/* Single staged Filters — From/To + Net variance (no split Apply-only date chrome). */}
      <CollapsedListFilters
        activeFilterCount={activeFilterCount}
        onApply={staged.apply}
        onReset={staged.reset}
        onCancel={staged.cancel}
        applyDisabled={!staged.dirty || draftInvalid}
        testIdPrefix="cash-flow-avp"
        dataAttributes={{ "data-cash-flow-avp-filter-toolbar": "collapsed" }}
        className="rounded-sm border border-gray-200 bg-white p-2"
      >
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs font-semibold text-slate-600">
            From
            <DatePicker
              value={staged.draft.from}
              onChange={(next) => staged.setDraft({ ...staged.draft, from: next })}
              className="mt-1"
            />
          </label>
          <label className="text-xs font-semibold text-slate-600">
            To
            <DatePicker
              value={staged.draft.to}
              onChange={(next) => staged.setDraft({ ...staged.draft, to: next })}
              className="mt-1"
            />
          </label>
          <label className="text-xs font-semibold text-slate-600">
            Net variance
            <SelectCombobox
              className="mt-1 block w-full max-w-xs"
              value={staged.draft.varianceFilter}
              onChange={(event) =>
                staged.setDraft({
                  ...staged.draft,
                  varianceFilter: event.target.value as VarianceFilter,
                })
              }
              data-testid="cash-flow-avp-variance-filter"
            >
              <option value="all">All rows</option>
              <option value="over">Net over projected</option>
              <option value="under">Net under projected</option>
              <option value="flat">Net flat</option>
            </SelectCombobox>
          </label>
        </div>
        {draftInvalid && (
          <p className="mt-2 text-xs text-red-600">From date must be before or equal to To date.</p>
        )}
      </CollapsedListFilters>

      {/* CASH-FLOW-01 (owner order 2026-09-06): honest coverage banner -- a $0 actual on 0
          categorized bank lines is "actuals unavailable", not "confirmed zero cash moved". */}
      {!isLoading && data && data.bank_categorization_coverage.categorized_count === 0 ? (
        <div className="rounded-sm border border-slate-200 bg-slate-100 px-3 py-2 text-xs text-slate-700">
          {data.bank_categorization_coverage.categorized_count} of {data.bank_categorization_coverage.total_count} bank
          lines categorized — actuals unavailable, not zero. Categorize transactions in Banking to see real actuals here.
        </div>
      ) : null}

      {/* Accuracy Summary */}
      {!isLoading && acc && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {[
            {
              label: "Income Accuracy",
              projected: acc.total_projected_income_cents,
              actual: acc.total_actual_income_cents,
              pct: acc.income_variance_pct,
            },
            {
              label: "Expense Accuracy",
              projected: acc.total_projected_expense_cents,
              actual: acc.total_actual_expense_cents,
              pct: acc.expense_variance_pct,
            },
            {
              label: "Net Variance",
              projected: acc.total_projected_income_cents - acc.total_projected_expense_cents,
              actual: acc.total_actual_income_cents - acc.total_actual_expense_cents,
              pct: acc.income_variance_pct,
            },
          ].map((card) => {
            // CASH-FLOW-01: 0 categorized bank lines means the "Act:"/variance figures on this
            // card are not real actuals — show the honest state instead of a misleading $0/100%.
            const actualsUnavailable = data?.bank_categorization_coverage.categorized_count === 0;
            const varCents = card.actual - card.projected;
            const pos = varCents >= 0;
            return (
              <div key={card.label} className="rounded-lg border border-gray-200 bg-white px-4 py-3">
                <p className="text-xs font-medium uppercase tracking-wide text-gray-500">{card.label}</p>
                <div className="mt-1 flex items-center justify-between">
                  <span className="text-xs text-gray-600">
                    Proj: <strong>{formatCents(card.projected)}</strong>
                  </span>
                  <span className="text-xs text-gray-600">
                    Act: <strong>{actualsUnavailable ? "unavailable" : formatCents(card.actual)}</strong>
                  </span>
                </div>
                {actualsUnavailable ? (
                  <p className="mt-1 text-xs text-gray-400">actuals unavailable</p>
                ) : (
                  <div className={`mt-1 flex items-center gap-1 text-xs font-bold ${pos ? "text-slate-700" : "text-red-700"}`}>
                    {pos ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
                    {formatCents(varCents, { sign: true })}
                    <span className="ml-1 text-xs font-medium">{formatPct(card.pct)}</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Per-line table */}
      {isError ? (
        <ListErrorState
          title="Couldn't load actual vs projected data"
          status={0}
          message={(avpQ.error as Error)?.message}
          onRetry={() => void avpQ.refetch()}
        />
      ) : (
        <ParityTable
          columns={COLUMNS}
          rows={filteredGroups}
          rowKey={(g) => g.date}
          loading={isLoading}
          emptyText="No data for the selected date range."
          storageKey="cash-flow-avp"
          tableTestId="cash-flow-avp-table"
        />
      )}
    </div>
  );
}
