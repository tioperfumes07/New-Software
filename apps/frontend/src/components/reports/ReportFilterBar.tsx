import { useCallback, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { DatePicker } from "../forms/DatePicker";
import { companyToday, monthBoundsIso, addDaysIso } from "../../lib/businessDate";

// RPT-06 — Inline filter bar visible on first load (0 clicks).
// Replaces the CollapsedListFilters popover pattern on report landing pages.
// The bar is always inline: date range + presets + search + optional second/status slots.
// Locked scale: text-xs (12px), slate/gray tokens only, 28px height controls, rounded-sm (2px).

export type ReportPreset = "this_week" | "this_month" | "last_month" | "ytd";

type ReportFilterBarProps = {
  testIdPrefix: string;
  fromDate: string | null;
  toDate: string | null;
  onFromDateChange: (date: string | null) => void;
  onToDateChange: (date: string | null) => void;
  onPresetSelect: (preset: ReportPreset) => void;
  search?: string;
  onSearchChange?: (value: string) => void;
  children?: ReactNode;
  statusFilter?: string;
  onStatusFilterChange?: (value: string) => void;
  statusOptions?: Array<{ value: string; label: string }>;
  /** When provided, an Apply button renders and calls this on click. Used with useStagedListFilters. */
  onApply?: () => void;
  applyDisabled?: boolean;
  /** When provided with onApply, a Cancel button renders and calls this on click. */
  onCancel?: () => void;
  /** When provided with onApply, a Reset button renders and calls this on click. */
  onReset?: () => void;
};

const PRESET_BUTTONS: Array<{ preset: ReportPreset; label: string }> = [
  { preset: "this_week", label: "This week" },
  { preset: "this_month", label: "This month" },
  { preset: "last_month", label: "Last month" },
  { preset: "ytd", label: "YTD" },
];

function startOfWeekMonday(today: string): string {
  const [y, m, d] = today.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dow = dt.getUTCDay();
  const diff = dow === 0 ? 6 : dow - 1;
  return addDaysIso(today, -diff);
}

function startOfYear(today: string): string {
  const [y] = today.split("-").map(Number);
  return `${y}-01-01`;
}

function lastMonthBounds(today: string): { start: string; end: string } {
  const [y, m] = today.split("-").map(Number);
  const prevMonth = m - 1;
  const prevYear = prevMonth === 0 ? y - 1 : y;
  const prevM = prevMonth === 0 ? 12 : prevMonth;
  const prevIso = `${prevYear}-${String(prevM).padStart(2, "0")}-01`;
  return monthBoundsIso(prevIso);
}

export function computePresetRange(preset: ReportPreset, today: string = companyToday()): { from: string; to: string } {
  switch (preset) {
    case "this_week":
      return { from: startOfWeekMonday(today), to: today };
    case "this_month":
      return { from: monthBoundsIso(today).start, to: today };
    case "last_month": {
      const { start, end } = lastMonthBounds(today);
      return { from: start, to: end };
    }
    case "ytd":
      return { from: startOfYear(today), to: today };
  }
}

export function ReportFilterBar({
  testIdPrefix,
  fromDate,
  toDate,
  onFromDateChange,
  onToDateChange,
  onPresetSelect,
  search,
  onSearchChange,
  children,
  statusFilter,
  onStatusFilterChange,
  statusOptions,
  onApply,
  applyDisabled,
  onCancel,
  onReset,
}: ReportFilterBarProps) {
  const [, setSearchParams] = useSearchParams();

  const syncUrl = useCallback(
    (key: string, value: string | null) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (value) next.set(key, value);
          else next.delete(key);
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const handleFromDateChange = useCallback(
    (next: string) => {
      onFromDateChange(next || null);
      syncUrl("from_date", next || null);
    },
    [onFromDateChange, syncUrl],
  );

  const handleToDateChange = useCallback(
    (next: string) => {
      onToDateChange(next || null);
      syncUrl("to_date", next || null);
    },
    [onToDateChange, syncUrl],
  );

  const handlePreset = useCallback(
    (preset: ReportPreset) => {
      const { from, to } = computePresetRange(preset);
      onFromDateChange(from);
      onToDateChange(to);
      onPresetSelect(preset);
      syncUrl("from_date", from);
      syncUrl("to_date", to);
    },
    [onFromDateChange, onToDateChange, onPresetSelect, syncUrl],
  );

  const handleSearch = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      onSearchChange?.(value);
      syncUrl("q", value || null);
    },
    [onSearchChange, syncUrl],
  );

  const handleStatus = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const value = e.target.value;
      onStatusFilterChange?.(value);
      syncUrl("status", value || null);
    },
    [onStatusFilterChange, syncUrl],
  );

  return (
    <div
      data-report-filter-bar="inline"
      data-testid={`${testIdPrefix}-report-filter-bar`}
      className="flex flex-wrap items-center gap-2 rounded-sm border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700"
    >
      <label className="flex items-center gap-1 text-xs text-slate-600">
        <span className="font-semibold text-slate-600">From</span>
        <DatePicker
          className="h-7 w-[120px]"
          value={fromDate ?? ""}
          onChange={handleFromDateChange}
          aria-label="From date"
          data-testid={`${testIdPrefix}-filter-from`}
        />
      </label>
      <label className="flex items-center gap-1 text-xs text-slate-600">
        <span className="font-semibold text-slate-600">To</span>
        <DatePicker
          className="h-7 w-[120px]"
          value={toDate ?? ""}
          onChange={handleToDateChange}
          aria-label="To date"
          data-testid={`${testIdPrefix}-filter-to`}
        />
      </label>
      <div className="flex items-center gap-1">
        {PRESET_BUTTONS.map((btn) => (
          <button
            key={btn.preset}
            type="button"
            onClick={() => handlePreset(btn.preset)}
            className="h-7 rounded-sm border border-slate-300 bg-white px-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
            data-testid={`${testIdPrefix}-preset-${btn.preset}`}
          >
            {btn.label}
          </button>
        ))}
      </div>
      <div className="mx-1 h-5 w-px bg-slate-200" />
      <label className="flex items-center gap-1 text-xs text-slate-600">
        <span className="font-semibold text-slate-600">Search</span>
        <input
          type="text"
          value={search ?? ""}
          onChange={handleSearch}
          placeholder="Search…"
          className="h-7 w-[160px] rounded-sm border border-slate-300 px-2 text-xs text-slate-700 placeholder:text-slate-400"
          data-testid={`${testIdPrefix}-filter-search`}
        />
      </label>
      {children ? (
        <>
          <div className="mx-1 h-5 w-px bg-slate-200" />
          {children}
        </>
      ) : null}
      {statusOptions && statusOptions.length > 0 ? (
        <>
          <div className="mx-1 h-5 w-px bg-slate-200" />
          <label className="flex items-center gap-1 text-xs text-slate-600">
            <span className="font-semibold text-slate-600">Status</span>
            <select
              value={statusFilter ?? ""}
              onChange={handleStatus}
              className="h-7 rounded-sm border border-slate-300 bg-white px-2 text-xs text-slate-700"
              data-testid={`${testIdPrefix}-filter-status`}
            >
              <option value="">All</option>
              {statusOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
        </>
      ) : null}
      {onApply ? (
        <>
          <div className="mx-1 h-5 w-px bg-slate-200" />
          {onReset ? (
            <button
              type="button"
              onClick={onReset}
              className="h-7 rounded-sm border border-slate-300 bg-white px-3 text-xs font-medium text-slate-600 hover:bg-slate-50"
              data-testid={`${testIdPrefix}-reset`}
            >
              Reset
            </button>
          ) : null}
          {onCancel ? (
            <button
              type="button"
              onClick={onCancel}
              className="h-7 rounded-sm border border-slate-300 bg-white px-3 text-xs font-medium text-slate-600 hover:bg-slate-50"
              data-testid={`${testIdPrefix}-cancel`}
            >
              Cancel
            </button>
          ) : null}
          <button
            type="button"
            onClick={onApply}
            disabled={applyDisabled}
            className="h-7 rounded-sm border border-slate-700 bg-slate-700 px-3 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            data-testid={`${testIdPrefix}-apply`}
          >
            Apply
          </button>
        </>
      ) : null}
    </div>
  );
}
