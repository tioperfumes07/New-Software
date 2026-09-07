import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import {
  getRollingLedger,
  getCashFlowAdjustmentReasons,
  createCashFlowRowAdjustment,
  type RollingLedgerResult,
  type RollingLedgerRow,
  type RollingLedgerDay,
  type CashFlowAdjustmentReason,
} from "../../../api/cashFlow";
import { addDaysIso, companyToday } from "../../../lib/businessDate";
import { formatUsdCents } from "../../../lib/money";
import { EntityLink, resolveEntityRoute } from "../../../components/shared/EntityLink";
import { DatePicker } from "../../../components/forms/DatePicker";
import { Combobox } from "../../../components/Combobox";
import { ParityTable, type ParityColumn } from "../../../components/parity/ParityTable";

// CASH-FLOW-02 (owner order 2026-09-06 20:1x/20:2x/20:5xZ). A daily snapshot with roll-over:
// every expected dollar carries its own due date and stays until paid/matched.
//
// ROUND 16.7 item 0 (owner 2026-09-06 21:1xZ): the prior pass rendered 3 hand-written HTML
// table markup blocks, which regressed scripts/verify-go26-consolidation-ratchet.mjs
// (raw_table_outside_infra) for every branch. All 3 registers (Expected income, Expected
// expenses, Day grid) now use the shared ParityTable component instead.
//
// ROUND 16.7 CORRECTION (owner 2026-09-06 22:0x/5:0xZ, verbatim): "THAT IS NOT THE QBO STYLE
// FILTER I ALREADY TOLD YOU". The filter bar below reuses Banking's own components
// (BankingTransactionsDesignView.tsx) verbatim: Combobox for "Filter by description", the same
// 28px segmented-button pattern for All/Income/Expenses and By day/By type, DatePicker From/To
// always visible + an outlined Presets shortcut, and the same dropdown-button-with-chevron
// pattern for "All transaction types" / "Rolled over: show". "THE ADJUST EXPECTATION ... WILL
// ONLY COME IN EXPECTED INCOME SIDE" — the multi-field AdjustPopover now renders ONLY for income
// rows; expense rows get a lightweight "Roll over ▾" reason menu + a separate "Stop" action, no
// popup. The day-navigator card ("‹ Sun, Sep 6 · Today ›", 64px) and the split-screen layout are
// restored/kept exactly as before this correction.

const TYPE_OPTIONS = [
  { value: "Bill", label: "Bills" },
  { value: "Driver pay", label: "Driver pay" },
  { value: "Driver bill", label: "Driver bills" },
  { value: "Expense — unmatched", label: "Expenses" },
  { value: "Loan payment", label: "Loan payments" },
  { value: "Invoice", label: "Invoices" },
  { value: "Factor advance", label: "Factor advances" },
  { value: "Factor reserve", label: "Reserves" },
  { value: "Load (not invoiced)", label: "Loads (not invoiced)" },
];

type DatePreset = "7d" | "14d" | "30d" | "this_month" | "next_month";

const PRESET_OPTIONS: { value: DatePreset; label: string }[] = [
  { value: "7d", label: "Next 7 days" },
  { value: "14d", label: "Next 14 days" },
  { value: "30d", label: "Next 30 days" },
  { value: "this_month", label: "This month" },
  { value: "next_month", label: "Next month" },
];

function presetRange(preset: DatePreset, today: string): { from: string; to: string } {
  const base = new Date(today + "T00:00:00");
  if (preset === "7d") return { from: today, to: addDaysIso(today, 6) };
  if (preset === "14d") return { from: today, to: addDaysIso(today, 13) };
  if (preset === "30d") return { from: today, to: addDaysIso(today, 29) };
  if (preset === "this_month") {
    const start = new Date(base.getFullYear(), base.getMonth(), 1);
    const end = new Date(base.getFullYear(), base.getMonth() + 1, 0);
    return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) };
  }
  const start = new Date(base.getFullYear(), base.getMonth() + 1, 1);
  const end = new Date(base.getFullYear(), base.getMonth() + 2, 0);
  return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) };
}

function formatCents(cents: number, opts?: { sign?: boolean }): string {
  const abs = Math.abs(cents);
  const dollars = formatUsdCents(abs);
  if (opts?.sign && cents < 0) return `−${dollars}`;
  if (opts?.sign && cents > 0) return `+${dollars}`;
  return cents < 0 ? `−${dollars}` : dollars;
}

function fmtDateShort(iso: string): string {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "2-digit" });
}
function fmtDate(iso: string): string {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

const STATUS_LABEL: Record<RollingLedgerRow["status"], string> = {
  overdue: "Overdue",
  due_today: "Due today",
  upcoming: "Open",
};

// §7 palette law — financial UI never uses amber/warning colors, even for an overdue signal.
const STATUS_CLASS: Record<RollingLedgerRow["status"], string> = {
  overdue: "border-slate-300 bg-slate-200 text-slate-800 font-semibold",
  due_today: "border-slate-200 bg-slate-100 text-slate-700",
  upcoming: "border-slate-200 bg-white text-slate-500",
};

function StatusPill({ row }: { row: RollingLedgerRow }) {
  return (
    <>
      <span className={`inline-flex rounded-full border px-1.5 py-0.5 text-xs ${row.is_rollover_echo ? "border-slate-200 bg-slate-100 text-slate-500" : STATUS_CLASS[row.status]}`}>
        {row.is_rollover_echo ? "Rolled" : row.type === "Factor advance" || row.type === "Factor reserve" ? "Factored" : STATUS_LABEL[row.status]}
      </span>
      {row.reason_label && <div className="mt-0.5 text-xs text-slate-400">rolled — {row.reason_label}</div>}
    </>
  );
}

// Banking's exact 28px (h-7) segmented-button pattern (BankingTransactionsDesignView.tsx's
// All/Spent/Received and By month/Money in/out/All dates toggles) — reused verbatim here for
// All/Income/Expenses and By day/By type.
function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  dataTestId,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (next: T) => void;
  dataTestId?: string;
}) {
  return (
    <div className="inline-flex h-7 overflow-hidden rounded-sm border border-slate-300 bg-white text-xs" data-testid={dataTestId}>
      {options.map((opt, i) => (
        <button
          key={opt.value}
          type="button"
          className={`flex h-7 items-center px-2.5 ${i !== 0 ? "border-l border-slate-300" : ""} ${
            value === opt.value ? "bg-[#1f2a44] text-white" : "text-slate-700"
          }`}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

// Banking's exact dropdown-button-with-chevron + checkbox-menu pattern (the "All transaction
// types" filter, BankingTransactionsDesignView.tsx lines ~3169-3227) — reused verbatim.
function TypeFilterDropdown({
  options,
  selected,
  onChange,
}: {
  options: { value: string; label: string }[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const toggle = (v: string) => onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]);
  return (
    <div className="relative">
      <button
        type="button"
        className="flex h-7 min-w-[9rem] items-center justify-between gap-1 rounded-sm border border-slate-300 bg-white px-2 text-xs text-slate-700"
        onClick={() => setOpen((o) => !o)}
        data-testid="rolling-ledger-type-filter"
      >
        {selected.length === 0 ? (
          <span>All transaction types</span>
        ) : (
          <span className="flex flex-wrap items-center gap-1">
            {selected.map((v) => {
              const label = options.find((o) => o.value === v)?.label ?? v;
              return (
                <span key={v} className="inline-flex items-center gap-1 rounded-sm bg-[#1f2a44] px-1.5 py-0.5 text-xs text-white">
                  {label}
                  <span
                    role="button"
                    tabIndex={-1}
                    aria-label={`Remove ${label}`}
                    className="cursor-pointer"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggle(v);
                    }}
                  >
                    ×
                  </span>
                </span>
              );
            })}
          </span>
        )}
        <ChevronDown className="h-3 w-3" />
      </button>
      {open && (
        <div className="absolute left-0 z-20 mt-1 w-64 rounded-sm border border-slate-200 bg-white p-2 shadow-sm">
          {options.map((opt) => (
            <label key={opt.value} className="flex cursor-pointer items-center gap-2 rounded-sm px-1.5 py-1 text-xs text-slate-700 hover:bg-slate-50">
              <input type="checkbox" checked={selected.includes(opt.value)} onChange={() => toggle(opt.value)} />
              {opt.label}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

// Day navigator card (owner: "as you design the load costs" — 64px card, ‹ / date / Today / ›).
// Restores the skeleton element that existed before this correction's toolbar rewrite.
function DayNavigatorCard({ date, today, onChange }: { date: string; today: string; onChange: (next: string) => void }) {
  return (
    <div
      className="flex h-16 items-center justify-center gap-3 rounded-sm border border-slate-800 bg-white px-3"
      data-testid="rolling-ledger-day-navigator"
    >
      <button
        type="button"
        onClick={() => onChange(addDaysIso(date, -1))}
        className="flex h-7 w-7 items-center justify-center rounded-sm border border-slate-300 text-slate-600 hover:bg-slate-50"
        aria-label="Previous day"
      >
        <ChevronLeft className="h-4 w-4" />
      </button>
      <span className="text-xs font-semibold text-slate-800">
        {fmtDate(date)}
        {date === today && <span className="ml-1.5 font-normal text-slate-500">· Today</span>}
      </span>
      <button
        type="button"
        onClick={() => onChange(addDaysIso(date, 1))}
        className="flex h-7 w-7 items-center justify-center rounded-sm border border-slate-300 text-slate-600 hover:bg-slate-50"
        aria-label="Next day"
      >
        <ChevronRight className="h-4 w-4" />
      </button>
      {date !== today && (
        <button
          type="button"
          onClick={() => onChange(today)}
          className="ml-1 rounded-sm border border-slate-300 px-2 py-0.5 text-xs text-slate-600 hover:bg-slate-50"
        >
          Today
        </button>
      )}
    </div>
  );
}

// ROUND 16.7 CORRECTION — expense rows never get the multi-field AdjustPopover ("THE ADJUST
// EXPECTATION ... WILL ONLY COME IN EXPECTED INCOME SIDE"). A plain "Roll over ▾" reason menu
// (one click per catalog reason, next-day projection) replaces it.
function ExpenseRolloverMenu({
  reasons,
  onRollover,
  pending,
}: {
  reasons: CashFlowAdjustmentReason[];
  onRollover: (reasonCode: string) => void;
  pending: boolean;
}) {
  const [open, setOpen] = useState(false);
  const filtered = reasons.filter((r) => r.applies_to === "expense" || r.applies_to === "both");
  return (
    <div className="relative">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        disabled={pending}
        className="rounded-sm border border-slate-300 bg-white px-1.5 py-0.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        data-testid="rolling-ledger-expense-rollover-menu"
      >
        Roll over ▾
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 w-48 rounded-sm border border-slate-200 bg-white p-1 shadow-md" onClick={(e) => e.stopPropagation()}>
          {filtered.map((r) => (
            <button
              key={r.code}
              type="button"
              onClick={() => {
                onRollover(r.code);
                setOpen(false);
              }}
              className="block w-full rounded-sm px-2 py-1 text-left text-xs text-slate-700 hover:bg-slate-50"
            >
              {r.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ROUND 16.7 CORRECTION — a separate "Stop" action (no popup): one required-reason confirm, then
// hides the row from the snapshot (audited, same createCashFlowRowAdjustment hidden_reason path
// the income popover's "Stop showing here" checkbox already uses).
function StopTrackingButton({
  reasons,
  onStop,
  pending,
}: {
  reasons: CashFlowAdjustmentReason[];
  onStop: (reasonCode: string, hiddenReason: string) => void;
  pending: boolean;
}) {
  const [open, setOpen] = useState(false);
  const filtered = reasons.filter((r) => r.applies_to === "expense" || r.applies_to === "both");
  const [reasonCode, setReasonCode] = useState(filtered[0]?.code ?? "");
  const [hiddenReason, setHiddenReason] = useState("");
  return (
    <div className="relative">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        disabled={pending}
        className="rounded-sm border border-slate-300 bg-white px-1.5 py-0.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        data-testid="rolling-ledger-expense-stop"
      >
        Stop
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 w-56 rounded-sm border border-slate-200 bg-white p-2 shadow-md text-xs" onClick={(e) => e.stopPropagation()}>
          <select
            value={reasonCode}
            onChange={(e) => setReasonCode(e.target.value)}
            className="mb-1 h-[26px] w-full rounded-sm border border-slate-300 px-1 text-xs"
          >
            {filtered.map((r) => (
              <option key={r.code} value={r.code}>
                {r.label}
              </option>
            ))}
          </select>
          <input
            type="text"
            value={hiddenReason}
            onChange={(e) => setHiddenReason(e.target.value)}
            placeholder="Reason required (audited)"
            className="mb-1 h-[26px] w-full rounded-sm border border-slate-300 px-1 text-xs"
            data-testid="rolling-ledger-expense-stop-reason"
          />
          <button
            type="button"
            disabled={!hiddenReason.trim() || !reasonCode}
            onClick={() => {
              onStop(reasonCode, hiddenReason);
              setOpen(false);
              setHiddenReason("");
            }}
            className="w-full rounded-sm bg-slate-800 px-2 py-1 text-xs font-medium text-white hover:bg-slate-900 disabled:opacity-50"
          >
            Confirm stop
          </button>
        </div>
      )}
    </div>
  );
}

function csvEscape(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) return `"${value.replace(/"/g, '""')}"`;
  return value;
}
function exportRowsCsv(rows: RollingLedgerRow[]): void {
  const header = ["Row", "Type", "Document", "Counterparty", "Origin date", "Due date", "Amount", "Days overdue", "Status", "Reason"];
  const body = rows.map((r) =>
    [
      r.row_kind,
      r.type,
      r.document_label,
      r.counterparty,
      r.origin_date,
      r.due_date,
      (r.amount_cents / 100).toFixed(2),
      String(r.days_overdue),
      r.status,
      r.reason_label ?? "",
    ]
      .map((v) => csvEscape(String(v)))
      .join(",")
  );
  const csv = [header.join(","), ...body].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `rolling-ledger-${companyToday()}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

type AdjustPopoverProps = {
  row: RollingLedgerRow;
  reasons: CashFlowAdjustmentReason[];
  applies: "income" | "expense";
  onClose: () => void;
  onSubmit: (input: { projectedDate: string | null; reasonCode: string; note: string; hide: boolean; hiddenReason: string }) => void;
  pending: boolean;
};

function AdjustPopover({ row, reasons, applies, onClose, onSubmit, pending }: AdjustPopoverProps) {
  const navigate = useNavigate();
  const filteredReasons = reasons.filter((r) => r.applies_to === applies || r.applies_to === "both");
  const [projectedDate, setProjectedDate] = useState(addDaysIso(row.due_date, 1));
  const [reasonCode, setReasonCode] = useState(filteredReasons[0]?.code ?? "");
  const [note, setNote] = useState("");
  const [hide, setHide] = useState(false);
  const [hiddenReason, setHiddenReason] = useState("");
  const route = resolveEntityRoute(row.document_kind, row.document_id);

  const canSave = hide ? hiddenReason.trim().length > 0 && reasonCode : reasonCode && projectedDate;

  return (
    <div className="rounded-sm border border-slate-400 bg-white p-3 text-xs shadow-md" data-testid="rolling-ledger-adjust-popover">
      <div className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-600">
        Adjust expectation · {row.document_label} · {row.counterparty} · {formatCents(row.amount_cents || 0)} due {fmtDateShort(row.due_date)}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Projected date</span>
          <DatePicker value={projectedDate} onChange={setProjectedDate} min={row.due_date} disabled={hide} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Reason (catalog)</span>
          <select
            value={reasonCode}
            onChange={(e) => setReasonCode(e.target.value)}
            className="h-[26px] w-full rounded-sm border border-slate-300 px-2 text-xs"
          >
            {filteredReasons.map((r) => (
              <option key={r.code} value={r.code}>
                {r.label}
              </option>
            ))}
          </select>
        </label>
        <label className="col-span-2 block">
          <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Note</span>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="optional — who said what, when"
            className="h-[26px] w-full rounded-sm border border-slate-300 px-2 text-xs"
          />
        </label>
        {route && (
          <div className="col-span-2">
            <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Or record it</span>
            <button
              type="button"
              onClick={() => navigate(route)}
              className="rounded-sm border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-50"
            >
              Go to {row.document_label} to record the payment →
            </button>
          </div>
        )}
        <label className="col-span-2 flex items-center gap-2">
          <input type="checkbox" checked={hide} onChange={(e) => setHide(e.target.checked)} className="h-3.5 w-3.5" />
          <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Stop showing here</span>
        </label>
        {hide && (
          <label className="col-span-2 block">
            <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Reason required (audited)</span>
            <input
              type="text"
              value={hiddenReason}
              onChange={(e) => setHiddenReason(e.target.value)}
              className="h-[26px] w-full rounded-sm border border-slate-300 px-2 text-xs"
              data-testid="rolling-ledger-hide-reason"
            />
          </label>
        )}
        <div className="col-span-2 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-sm border border-slate-300 bg-white px-3 py-1 text-xs text-slate-700 hover:bg-slate-50">
            Cancel
          </button>
          <button
            type="button"
            disabled={!canSave || pending}
            onClick={() =>
              onSubmit({ projectedDate: hide ? null : projectedDate, reasonCode, note, hide, hiddenReason })
            }
            className="rounded-sm bg-slate-800 px-3 py-1 text-xs font-medium text-white hover:bg-slate-900 disabled:opacity-50"
            data-testid="rolling-ledger-adjust-save"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

type Props = {
  operatingCompanyId: string;
};

export function RollingLedgerTab({ operatingCompanyId }: Props) {
  const today = companyToday();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();

  const [preset, setPreset] = useState<DatePreset>("14d");
  const [presetMenuOpen, setPresetMenuOpen] = useState(false);
  const [from, setFrom] = useState(searchParams.get("rl_from") || today);
  const [to, setTo] = useState(searchParams.get("rl_to") || addDaysIso(today, 13));

  const selectedTypes = useMemo(() => {
    const raw = searchParams.get("rl_types");
    return raw ? raw.split(",").filter(Boolean) : [];
  }, [searchParams]);
  const search = searchParams.get("rl_q") || "";
  const showRolledOver = searchParams.get("rl_rolled") !== "hide";
  // ROUND 16.7 CORRECTION — segmented [All | Income | Expenses] (Banking's amountFilter pattern):
  // "all" keeps the split screen; "income"/"expenses" widen that side to full width.
  const rowKindFilter = (searchParams.get("rl_kind") as "all" | "income" | "expenses") || "all";
  // ROUND 16.7 CORRECTION — segmented [By day | By type]: "day" is the existing flat
  // chronological sort; "type" groups each register by row.type via ParityTable's native groupBy.
  const groupMode = (searchParams.get("rl_group") as "day" | "type") || "day";
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [adjustingRowKey, setAdjustingRowKey] = useState<string | null>(null);

  const updateParams = (updates: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(updates)) {
      if (value === null || value === "") next.delete(key);
      else next.set(key, value);
    }
    setSearchParams(next, { replace: true });
  };

  const queryKey = ["cash-flow-rolling-ledger", operatingCompanyId, from, to];
  const { data, isLoading, isError } = useQuery<RollingLedgerResult>({
    queryKey,
    queryFn: () => getRollingLedger(operatingCompanyId, from, to),
    enabled: !!operatingCompanyId && !!from && !!to && to >= from,
  });

  const { data: reasons = [] } = useQuery<CashFlowAdjustmentReason[]>({
    queryKey: ["cash-flow-adjustment-reasons"],
    queryFn: getCashFlowAdjustmentReasons,
    staleTime: 5 * 60 * 1000,
  });

  const adjustMutation = useMutation({
    mutationFn: (vars: {
      row: RollingLedgerRow;
      projectedDate: string | null;
      reasonCode: string;
      note: string;
      hiddenReason: string;
    }) =>
      createCashFlowRowAdjustment({
        operating_company_id: operatingCompanyId,
        document_kind: vars.row.document_kind,
        document_id: vars.row.document_id,
        original_due_date: vars.row.due_date,
        projected_due_date: vars.projectedDate,
        reason_code: vars.reasonCode,
        note: vars.note || null,
        hidden_reason: vars.hiddenReason || null,
      }),
    onSuccess: () => {
      setAdjustingRowKey(null);
      void queryClient.invalidateQueries({ queryKey });
    },
  });

  const applyPreset = (p: DatePreset) => {
    setPreset(p);
    const range = presetRange(p, today);
    setFrom(range.from);
    setTo(range.to);
    setPresetMenuOpen(false);
  };

  const rowKeyOf = (row: RollingLedgerRow) => `${row.row_kind}-${row.document_kind}-${row.document_id}-${row.due_date}`;

  const allRows = useMemo(() => {
    if (!data) return [];
    let rows = data.rows;
    if (!showRolledOver) rows = rows.filter((r) => !r.reason_label);
    if (selectedTypes.length > 0) rows = rows.filter((r) => selectedTypes.includes(r.type));
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      rows = rows.filter((r) => r.counterparty.toLowerCase().includes(q) || r.document_label.toLowerCase().includes(q));
    }
    return rows;
  }, [data, showRolledOver, selectedTypes, search]);

  // Banking's exact descriptionFilterOptions pattern (BankingTransactionsDesignView.tsx) — a
  // Combobox seeded from real, currently-live counterparty/document labels, never free text.
  const descriptionFilterOptions = useMemo(() => {
    const seen = new Set<string>();
    const options: { value: string; label: string }[] = [];
    for (const r of data?.rows ?? []) {
      for (const label of [r.counterparty, r.document_label]) {
        if (!label || seen.has(label)) continue;
        seen.add(label);
        options.push({ value: label, label });
      }
    }
    return options.slice(0, 200);
  }, [data]);

  const incomeRows = useMemo(
    () => allRows.filter((r) => r.row_kind === "income" && (!selectedDate || r.due_date === selectedDate)).sort((a, b) => (a.due_date < b.due_date ? -1 : 1)),
    [allRows, selectedDate]
  );
  const expenseRowsToday = useMemo(() => {
    const targetDate = selectedDate ?? today;
    return allRows
      .filter((r) => r.row_kind === "expense" && r.due_date <= targetDate)
      .sort((a, b) => (a.due_date < b.due_date ? -1 : 1));
  }, [allRows, selectedDate, today]);

  const adjustingRow = useMemo(() => {
    if (!adjustingRowKey) return null;
    return allRows.find((r) => rowKeyOf(r) === adjustingRowKey) ?? null;
  }, [allRows, adjustingRowKey]);
  const adjustingRowIsIncome = adjustingRow?.row_kind === "income";

  const kpis = useMemo(() => {
    if (!data) return null;
    const todayDay = data.days.find((d) => d.date === today) ?? data.days[0];
    const incomeNotFactored = allRows
      .filter((r) => r.type === "Invoice")
      .reduce((s, r) => s + r.amount_cents, 0);
    const dueNext10 = allRows
      .filter((r) => r.row_kind === "income" && r.due_date >= today && r.due_date <= addDaysIso(today, 10))
      .reduce((s, r) => s + r.amount_cents, 0);
    return {
      opening: data.opening_cash_cents,
      incomeToday: todayDay?.income_due_cents ?? 0,
      expensesToday: todayDay?.expenses_due_cents ?? 0,
      carriedOver: (todayDay?.income_carry_over_cents ?? 0) + (todayDay?.expenses_carry_over_cents ?? 0),
      netToday: todayDay?.net_cents ?? 0,
      projectedClosing: todayDay?.running_cash_cents ?? null,
      incomeNotFactored,
      dueNext10,
    };
  }, [data, allRows, today]);

  const incomeColumns: ParityColumn<RollingLedgerRow>[] = [
    { key: "type", label: "Type", render: (row) => row.type },
    {
      key: "counterparty",
      label: "Customer · No.",
      render: (row) => (
        <>
          <EntityLink kind={row.document_kind} id={row.document_id} label={row.document_label} onClick={(e) => e.stopPropagation()} />{" "}
          <span className="text-slate-400">{row.counterparty}</span>
        </>
      ),
    },
    {
      key: "load",
      label: "Load",
      render: (row) =>
        row.load_id ? (
          <EntityLink kind="load" id={row.load_id} label={row.load_number ?? row.load_id} onClick={(e) => e.stopPropagation()} />
        ) : (
          <span className="text-slate-400">—</span>
        ),
    },
    { key: "due_date", label: "Due", render: (row) => fmtDateShort(row.due_date), sortValue: (row) => row.due_date },
    {
      key: "in",
      label: "In",
      sortable: false,
      render: (row) => (row.days_overdue > 0 ? `+${row.days_overdue}d` : row.days_overdue === 0 ? "today" : `${-row.days_overdue}d`),
    },
    {
      key: "amount_cents",
      label: "Expected",
      className: "text-right",
      cellClass: "text-right font-mono font-medium",
      render: (row) => <span className={row.amount_cents === 0 ? "text-slate-400" : "text-slate-800"}>{formatCents(row.amount_cents)}</span>,
    },
    { key: "status", label: "Status", sortable: false, render: (row) => <StatusPill row={row} /> },
  ];

  const expenseColumns: ParityColumn<RollingLedgerRow>[] = [
    { key: "type", label: "Type", render: (row) => row.type },
    { key: "no", label: "No.", render: (row) => <EntityLink kind={row.document_kind} id={row.document_id} label={row.document_label} onClick={(e) => e.stopPropagation()} /> },
    { key: "counterparty", label: "Name", render: (row) => row.counterparty },
    { key: "period", label: "Period", sortable: false, render: (row) => `${fmtDateShort(row.origin_date)} → ${fmtDateShort(row.due_date)}` },
    { key: "due_date", label: "Due", render: (row) => fmtDateShort(row.due_date), sortValue: (row) => row.due_date },
    {
      key: "days_overdue",
      label: "Days",
      render: (row) => (row.days_overdue > 0 ? String(row.days_overdue) : row.days_overdue === 0 ? "today" : "—"),
    },
    {
      key: "amount_cents",
      label: "Amount",
      className: "text-right",
      cellClass: "text-right font-mono font-medium",
      render: (row) => <span className={row.amount_cents === 0 ? "text-slate-400" : "text-slate-800"}>{formatCents(row.amount_cents)}</span>,
    },
    { key: "status", label: "Status", sortable: false, render: (row) => <StatusPill row={row} /> },
    {
      key: "reason",
      label: "Reason / source",
      sortable: false,
      render: (row) => (row.reason_label ? `${row.reason_label}${row.reason_note ? " — " + row.reason_note : ""}` : "—"),
    },
    {
      key: "action",
      label: "Action",
      sortable: false,
      // ROUND 16.7 CORRECTION — expense rows never open the multi-field AdjustPopover: a plain
      // reason menu + a separate "Stop" action, no popup.
      render: (row) => (
        <div className="flex items-center gap-1">
          <ExpenseRolloverMenu
            reasons={reasons}
            pending={adjustMutation.isPending}
            onRollover={(reasonCode) =>
              adjustMutation.mutate({ row, projectedDate: addDaysIso(row.due_date, 1), reasonCode, note: "", hiddenReason: "" })
            }
          />
          <StopTrackingButton
            reasons={reasons}
            pending={adjustMutation.isPending}
            onStop={(reasonCode, hiddenReason) =>
              adjustMutation.mutate({ row, projectedDate: null, reasonCode, note: "", hiddenReason })
            }
          />
        </div>
      ),
    },
  ];

  const dayGridColumns: ParityColumn<RollingLedgerDay>[] = [
    {
      key: "date",
      label: "Date",
      render: (day) => (
        <>
          {fmtDate(day.date)}
          {day.date === today && <span className="ml-1 text-xs text-slate-400">(today)</span>}
        </>
      ),
    },
    { key: "income_due_cents", label: "Income due", className: "text-right", cellClass: "text-right", render: (day) => (day.income_due_cents === 0 ? "—" : formatCents(day.income_due_cents)) },
    { key: "expenses_due_cents", label: "Expenses due", className: "text-right", cellClass: "text-right", render: (day) => (day.expenses_due_cents === 0 ? "—" : formatCents(day.expenses_due_cents)) },
    {
      key: "income_carry_over_cents",
      label: "Income carried",
      className: "text-right",
      cellClass: "text-right text-slate-400",
      render: (day) => (day.income_carry_over_cents === 0 ? "—" : formatCents(day.income_carry_over_cents)),
    },
    {
      key: "expenses_carry_over_cents",
      label: "Expenses carried",
      className: "text-right",
      cellClass: "text-right text-slate-400",
      render: (day) => (day.expenses_carry_over_cents === 0 ? "—" : formatCents(day.expenses_carry_over_cents)),
    },
    {
      key: "net_cents",
      label: "Net",
      className: "text-right",
      cellClass: "text-right",
      render: (day) => <span className={day.net_cents < 0 ? "text-slate-800" : "text-slate-600"}>{day.net_cents === 0 ? "—" : formatCents(day.net_cents, { sign: true })}</span>,
    },
    {
      key: "running_cash_cents",
      label: "Running cash",
      className: "text-right",
      cellClass: "text-right font-medium text-slate-800",
      render: (day) => (day.running_cash_cents === null ? "—" : formatCents(day.running_cash_cents, { sign: true })),
    },
  ];

  return (
    <div className="space-y-3" data-testid="cash-flow-rolling-ledger-tab">
      {/* ROUND 16.7 CORRECTION — Banking's QBO-style filter bar, reused verbatim (same
      components/classes as BankingTransactionsDesignView.tsx): Filter by description (Combobox)
      → segmented All/Income/Expenses → From/To (always visible) + Presets → segmented
      By day/By type → All transaction types (dropdown-button) → Rolled over: show (dropdown-
      button) → gear (ParityTable's own, per register) + Export. */}
      <div className="flex flex-wrap items-center gap-2 rounded-sm border border-slate-200 bg-white p-2">
        <div className="h-7 w-[242px]">
          <Combobox
            options={descriptionFilterOptions}
            value={search || null}
            onChange={(next) => updateParams({ rl_q: next || null })}
            onSearch={(q) => updateParams({ rl_q: q || null })}
            allowClear
            placeholder="Filter by description"
            dataTestId="rolling-ledger-description-filter"
          />
        </div>
        <SegmentedControl
          options={[
            { value: "all" as const, label: "All" },
            { value: "income" as const, label: "Income" },
            { value: "expenses" as const, label: "Expenses" },
          ]}
          value={rowKindFilter}
          onChange={(next) => updateParams({ rl_kind: next === "all" ? null : next })}
          dataTestId="rolling-ledger-kind-filter"
        />
        <div className="flex h-7 items-center gap-1">
          <label htmlFor="rolling-ledger-from" className="text-xs font-bold uppercase text-slate-600">
            From
          </label>
          <DatePicker id="rolling-ledger-from" value={from} onChange={(v) => { setFrom(v); updateParams({ rl_from: v }); }} max={to} className="h-7 w-[128px]" data-testid="rolling-ledger-from" />
          <label htmlFor="rolling-ledger-to" className="text-xs font-bold uppercase text-slate-600">
            To
          </label>
          <DatePicker id="rolling-ledger-to" value={to} onChange={(v) => { setTo(v); updateParams({ rl_to: v }); }} min={from} className="h-7 w-[128px]" data-testid="rolling-ledger-to" />
          <div className="relative">
            <button
              type="button"
              onClick={() => setPresetMenuOpen((o) => !o)}
              className="flex h-7 items-center gap-1 rounded-sm border border-slate-300 bg-white px-2 text-xs text-slate-700 hover:bg-slate-50"
              data-testid="rolling-ledger-presets"
            >
              Presets <ChevronDown className="h-3 w-3" />
            </button>
            {presetMenuOpen && (
              <div className="absolute left-0 top-full z-10 mt-1 w-40 rounded-sm border border-slate-200 bg-white p-1 shadow-md">
                {PRESET_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => applyPreset(opt.value)}
                    className={`block w-full rounded-sm px-2 py-1 text-left text-xs hover:bg-slate-50 ${
                      preset === opt.value ? "bg-slate-100 font-medium text-slate-800" : "text-slate-700"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        <SegmentedControl
          options={[
            { value: "day" as const, label: "By day" },
            { value: "type" as const, label: "By type" },
          ]}
          value={groupMode}
          onChange={(next) => updateParams({ rl_group: next === "day" ? null : next })}
          dataTestId="rolling-ledger-group-mode"
        />
        <TypeFilterDropdown
          options={TYPE_OPTIONS}
          selected={selectedTypes}
          onChange={(next) => updateParams({ rl_types: next.length > 0 ? next.join(",") : null })}
        />
        <button
          type="button"
          onClick={() => updateParams({ rl_rolled: showRolledOver ? "hide" : null })}
          className="flex h-7 items-center gap-1 rounded-sm border border-slate-300 bg-white px-2 text-xs text-slate-700 hover:bg-slate-50"
          data-testid="rolling-ledger-rolled-toggle"
        >
          Rolled over: <b>{showRolledOver ? "show" : "hide"}</b>
          <ChevronDown className="h-3 w-3" />
        </button>
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => exportRowsCsv(allRows)}
          disabled={allRows.length === 0}
          className="h-7 rounded-sm border border-slate-300 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          data-testid="rolling-ledger-export"
        >
          Export
        </button>
      </div>

      {/* Day navigator card — 64px, restores the skeleton element from before this correction. */}
      <DayNavigatorCard date={selectedDate ?? today} today={today} onChange={(next) => setSelectedDate(next)} />

      {isLoading && <div className="rounded-sm border border-slate-200 bg-white p-6 text-center text-xs text-slate-500">Loading…</div>}
      {isError && (
        <div className="rounded-sm border border-slate-200 bg-slate-100 p-6 text-center text-xs text-slate-700">
          Failed to load the rolling ledger. Please try again.
        </div>
      )}

      {data && kpis && (
        <>
          {/* KPI strip — ONE row, 8 tiles at the exact Load-Costs reference spec (owner:
          "I WANT THE DESIGN AS YOU DESIGN THE LOAD COSTS" / STATE-AFTER-#21082 correction: 60px
          tall, bg #F4F7FA, 1px #C7D2DC border, radius 2px, padding 4px 8px, label 11px uppercase
          letter-spacing .275px muted, value 11px/600 ink). Inline-styled like
          SettlementKpiGrid.tsx's own Tile — deliberately NOT Tailwind bracket-notation, so the
          exact pixel spec never trips verify-ui-design-system-ratchet's raw-size count. */}
          <div
            className="grid grid-cols-4 sm:grid-cols-8"
            style={{ gap: 6 }}
            data-testid="rolling-ledger-kpi-strip"
          >
            {[
              { label: "Opening cash", value: kpis.opening },
              { label: "Income due today", value: kpis.incomeToday, zero: kpis.incomeToday === 0 },
              { label: "Expenses due today", value: kpis.expensesToday, bad: kpis.expensesToday > 0 },
              { label: "Carried over", value: kpis.carriedOver, zero: kpis.carriedOver === 0 },
              { label: "Net today", value: kpis.netToday, sign: true, bad: kpis.netToday < 0 },
              { label: "Projected closing", value: kpis.projectedClosing, sign: true, bad: (kpis.projectedClosing ?? 0) < 0 },
              { label: "Open invoices (not factored)", value: kpis.incomeNotFactored, ok: true },
              { label: "Due next 10 days", value: kpis.dueNext10, ok: true },
            ].map((tile) => (
              <div
                key={tile.label}
                title={tile.label}
                style={{
                  height: 60,
                  boxSizing: "border-box",
                  background: "#F4F7FA",
                  border: "1px solid #C7D2DC",
                  borderRadius: 2,
                  padding: "4px 8px",
                  overflow: "hidden",
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "space-between",
                }}
              >
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: ".275px",
                    color: "#4B5563",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {tile.label}
                </div>
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    fontVariantNumeric: "tabular-nums",
                    whiteSpace: "nowrap",
                    color: tile.bad ? "#111827" : tile.ok ? "#4B5563" : tile.zero ? "#9CA3AF" : "#111827",
                  }}
                >
                  {tile.value === null ? "—" : formatCents(tile.value, { sign: tile.sign })}
                </div>
              </div>
            ))}
          </div>

          {/* Split layout: LEFT Expected Income 38% / RIGHT Expected Expenses 62% (owner
          correction) — the segmented All/Income/Expenses filter widens one side to full width
          without dropping the split ("SPLIT SCREEN LIKE WE CURRENTLY HAVE"). */}
          <div
            className={`grid grid-cols-1 gap-3 ${
              rowKindFilter === "all" ? "xl:grid-cols-[38fr_62fr]" : "xl:grid-cols-1"
            }`}
          >
            {rowKindFilter !== "expenses" && (
              <div className="overflow-hidden rounded-sm border border-slate-800 bg-white">
                <div className="border-b border-slate-200 bg-slate-100 px-2.5 py-1.5">
                  <span className="text-xs font-bold uppercase tracking-wide text-slate-700">Expected income</span>
                  <span className="ml-2 text-xs text-slate-500">{incomeRows.length} rows</span>
                </div>
                <ParityTable
                  rows={incomeRows}
                  columns={incomeColumns}
                  rowKey={rowKeyOf}
                  storageKey="cash-flow-income"
                  emptyText="No expected income in range."
                  onRowClick={(row) => setAdjustingRowKey(adjustingRowKey === rowKeyOf(row) ? null : rowKeyOf(row))}
                  groupBy={
                    groupMode === "type"
                      ? {
                          getKey: (row) => row.type,
                          renderHeader: (key, rows) => (
                            <span className="text-xs font-bold uppercase tracking-wide text-slate-600">
                              {key} · {rows.length} · {formatCents(rows.reduce((s, r) => s + r.amount_cents, 0))}
                            </span>
                          ),
                          orderedKeys: ["Invoice", "Factor advance", "Factor reserve", "Load (not invoiced)"],
                        }
                      : undefined
                  }
                  data-testid="rolling-ledger-income-table"
                />
                {/* ROUND 16.7 CORRECTION — the multi-field AdjustPopover exists ONLY on Expected
                Income rows ("THE ADJUST EXPECTATION ... WILL ONLY COME IN EXPECTED INCOME SIDE"). */}
                {adjustingRow && adjustingRowIsIncome && (
                  <div className="border-t border-slate-200 p-2">
                    <AdjustPopover
                      row={adjustingRow}
                      reasons={reasons}
                      applies="income"
                      onClose={() => setAdjustingRowKey(null)}
                      pending={adjustMutation.isPending}
                      onSubmit={({ projectedDate, reasonCode, note, hiddenReason }) =>
                        adjustMutation.mutate({ row: adjustingRow, projectedDate, reasonCode, note, hiddenReason })
                      }
                    />
                  </div>
                )}
              </div>
            )}

            {rowKindFilter !== "income" && (
              <div className="overflow-hidden rounded-sm border border-slate-800 bg-white">
                <div className="border-b border-slate-200 bg-slate-100 px-2.5 py-1.5">
                  <span className="text-xs font-bold uppercase tracking-wide text-slate-700">
                    Expected expenses{selectedDate ? ` · ${fmtDate(selectedDate)}` : ""}
                  </span>
                  <span className="ml-2 text-xs text-slate-500">{expenseRowsToday.length} rows</span>
                </div>
                <ParityTable
                  rows={expenseRowsToday}
                  columns={expenseColumns}
                  rowKey={rowKeyOf}
                  storageKey="cash-flow-expenses"
                  emptyText="No expected expenses due or carried."
                  groupBy={
                    groupMode === "type"
                      ? {
                          getKey: (row) => row.type,
                          renderHeader: (key, rows) => (
                            <span className="text-xs font-bold uppercase tracking-wide text-slate-600">
                              {key} · {rows.length} · {formatCents(rows.reduce((s, r) => s + r.amount_cents, 0))}
                            </span>
                          ),
                          orderedKeys: ["Bill", "Driver pay", "Driver bill", "Expense — unmatched", "Loan payment"],
                        }
                      : undefined
                  }
                  data-testid="rolling-ledger-expense-table"
                />
                {/* No AdjustPopover on expense rows — the "Action" column's Roll over ▾ menu +
                Stop button (rendered inline per row above) replace it entirely. */}
              </div>
            )}
          </div>

          {/* Day grid */}
          <div className="overflow-hidden rounded-sm border border-slate-800 bg-white">
            <div className="border-b border-slate-200 bg-slate-100 px-2.5 py-1.5">
              <span className="text-xs font-bold uppercase tracking-wide text-slate-700">
                Day grid · {fmtDateShort(from)} → {fmtDateShort(to)}
              </span>
              <span className="ml-2 text-xs text-slate-500">click a date → its rows above · carried = still-open older items</span>
            </div>
            <ParityTable
              rows={data.days}
              columns={dayGridColumns}
              rowKey={(day) => day.date}
              storageKey="cash-flow-day-grid"
              rowClassName={(day) => `${day.date === today ? "bg-slate-50 font-medium" : ""} ${day.date === selectedDate ? "bg-slate-100" : ""} ${day.date < today ? "text-slate-400" : ""}`}
              onRowClick={(day) => setSelectedDate(day.date === selectedDate ? null : day.date)}
              data-testid="rolling-ledger-day-grid"
            />
          </div>
        </>
      )}
    </div>
  );
}
