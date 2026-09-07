import { useMemo, useState } from "react";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { AccountingSubNavWrapper } from "./AccountingSubNavWrapper";
import { invoiceOpenCentsForDisplay, isVoidInvoice } from "./InvoicesListPage";
import { ManualJEModal } from "./ManualJEModal";
import {
  listBills,
  listBillPayments,
  listExpenses,
  listInvoices,
  listPayments,
  type VendorBill,
} from "../../api/accounting";
import { getQboSyncQueue, getQboSyncQueueStats } from "../../api/banking";
import { listSettlements } from "../../api/driverFinance";
import { getProfitLossReport, getTrialBalanceReport } from "../../api/reports";
import { useAuth } from "../../auth/useAuth";
import { Button } from "../../components/Button";
import { useCompanyContext } from "../../contexts/CompanyContext";
import { companyToday, monthBoundsIso } from "../../lib/businessDate";
import { entityLabel } from "../../lib/entity-label";

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

type AmountRow = { key: string; left: string; right: string; muted?: string };
type TabId =
  | "home"
  | "bills"
  | "expenses"
  | "bill-payment"
  | "invoices"
  | "receive-payment"
  | "settlements"
  | "find-transactions"
  | "unmatched-needs-review"
  | "factoring"
  | "journal-entries"
  | "reports";

export const TABS: Array<{ id: TabId; label: string; to?: string }> = [
  { id: "home", label: "Home" },
  { id: "bills", label: "Bills", to: "/accounting/bills" },
  { id: "expenses", label: "Expenses", to: "/accounting/expenses/list" },
  { id: "bill-payment", label: "Bill Payment", to: "/accounting/bill-payments" },
  { id: "invoices", label: "Invoices", to: "/accounting/invoices" },
  { id: "receive-payment", label: "Receive Payment", to: "/accounting/payments" },
  { id: "settlements", label: "Settlements", to: "/driver-finance/settlements" },
  { id: "find-transactions", label: "Find Transactions" },
  { id: "unmatched-needs-review", label: "Unmatched / Needs Review", to: "/banking/qbo-sync-queue" },
  { id: "factoring", label: "Factoring", to: "/accounting/factoring" },
  { id: "journal-entries", label: "Journal Entries", to: "/accounting/journal-entries" },
  { id: "reports", label: "Reports", to: "/reports" },
];

/**
 * #3a — per-tab summary-card subtitle. The card title updates per tab but the subtitle was a
 * single hardcoded "Bills paid MTD · Avg DSO" line on every tab. This makes the subtitle reactive
 * to the active tab: AP/AR tabs surface the relevant live metric, others get a domain hint.
 * Exhaustive over TabId (no default) so a new tab fails typecheck until it gets a subtitle.
 */
export function accountingTabSubtitle(
  tabId: TabId,
  metrics: { billsPaidMtdCents: number; avgDsoDays: number | null }
): string {
  const billsPaid = money.format(metrics.billsPaidMtdCents / 100);
  const dso = metrics.avgDsoDays == null ? "—" : `${Math.round(metrics.avgDsoDays)}d`;
  switch (tabId) {
    case "home":
      return `Bills paid MTD: ${billsPaid}. Avg DSO: ${dso}.`;
    case "bills":
      return `Open bills awaiting payment. Bills paid MTD: ${billsPaid}.`;
    case "expenses":
      return "Direct expenses and category mapping.";
    case "bill-payment":
      return `Bill payments recorded this month: ${billsPaid}.`;
    case "invoices":
      return `Customer invoices outstanding. Avg DSO: ${dso}.`;
    case "receive-payment":
      return "Record customer payments and deposits.";
    case "settlements":
      return "Driver settlements and pay runs.";
    case "find-transactions":
      return "Search across all accounting transactions.";
    case "unmatched-needs-review":
      return "QBO sync items that need review.";
    case "factoring":
      return "Faro factoring advances and reserve releases.";
    case "journal-entries":
      return "Manual journal entries and GL adjustments.";
    case "reports":
      return "Financial statements and account registers.";
  }
}

function monthStartIso() {
  return monthBoundsIso(companyToday()).start;
}

function currentQuarterRange() {
  const today = companyToday();
  const [y, m] = today.split("-").map(Number);
  const q = Math.floor((m - 1) / 3);
  const startMonth = q * 3 + 1;
  const endMonth = startMonth + 2;
  const endDay = new Date(Date.UTC(y, endMonth, 0)).getUTCDate();
  return {
    start: `${y}-${String(startMonth).padStart(2, "0")}-01`,
    end: `${y}-${String(endMonth).padStart(2, "0")}-${String(endDay).padStart(2, "0")}`,
  };
}

function isIsoOnOrAfter(left: string | null | undefined, right: string) {
  if (!left) return false;
  return left >= right;
}

function amountOrBalanceCents(row: VendorBill) {
  const balance = row.balance_cents;
  if (balance != null) return Number(balance);
  return Number(row.amount_cents) - Number(row.paid_cents ?? 0);
}

function relativeRetry(nextAttemptAt: string | null | undefined) {
  if (!nextAttemptAt) return "—";
  const deltaMs = new Date(nextAttemptAt).getTime() - Date.now();
  const minutes = Math.max(1, Math.round(Math.abs(deltaMs) / 60000));
  return `retry ${minutes}m`;
}

function kpiCard(label: string, value: string, sublabel: string, tone: "neutral" | "warn" | "danger" = "neutral") {
  const toneClass =
    tone === "danger"
      ? "border-l-4 border-l-red-500"
      : tone === "warn"
        ? "border-l-4 border-l-slate-400"
        : "border-l-4 border-l-slate-300";
  return (
    <div className={`rounded-sm border border-gray-200 bg-white px-3 py-2 ${toneClass}`}>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{label}</p>
      <p className="text-page-title font-semibold text-gray-900">{value}</p>
      <p className="text-xs text-gray-500">{sublabel}</p>
    </div>
  );
}

function homePanel(title: string, rows: AmountRow[], empty: string, actionHref?: string, actionLabel?: string) {
  return (
    <section className="rounded-sm border border-gray-200 bg-white">
      <header className="flex items-center justify-between border-b border-gray-200 px-3 py-1.5">
        <h3 className="text-[11px] font-bold uppercase tracking-wide text-gray-700">{title}</h3>
        {actionHref && actionLabel ? (
          <Link to={actionHref} className="text-xs font-semibold text-slate-700 hover:underline">
            {actionLabel}
          </Link>
        ) : null}
      </header>
      {rows.length ? (
        <ul>
          {rows.map((row) => (
            <li key={row.key} className="flex items-start justify-between border-b border-gray-100 px-3 py-1.5 text-xs last:border-b-0">
              <span className="truncate text-gray-800">{row.left}</span>
              <span className="text-right">
                <span className={`tabular-nums ${row.muted ? "text-gray-500" : "text-gray-900"}`}>{row.right}</span>
                {row.muted ? <span className="ml-2 text-xs text-gray-500">{row.muted}</span> : null}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-3 py-4 text-xs text-gray-500">{empty}</p>
      )}
    </section>
  );
}

export function AccountingHubPage() {
  const { selectedCompanyId } = useCompanyContext();
  const companyId = selectedCompanyId ?? "";
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [manualJeOpen, setManualJeOpen] = useState(false);
  const mtdStart = monthStartIso();
  const monthRange = useMemo(() => monthBoundsIso(companyToday()), []);
  const quarterRange = useMemo(() => currentQuarterRange(), []);

  const [billsQ, billPaymentsQ, paymentsQ, settlementsQ, invoicesQ, qboStatsQ, qboQueueQ, trialBalanceQ, profitLossQ, expensesQ] = useQueries({
    queries: [
      {
        queryKey: ["accounting-proto", "bills", companyId],
        queryFn: () => listBills(companyId, { include_balance: true, limit: 500 }),
        enabled: Boolean(companyId),
      },
      {
        queryKey: ["accounting-proto", "bill-payments", companyId],
        queryFn: () => listBillPayments(companyId, { limit: 500 }),
        enabled: Boolean(companyId),
      },
      {
        queryKey: ["accounting-proto", "payments", companyId],
        queryFn: () => listPayments(companyId, { limit: 500 }),
        enabled: Boolean(companyId),
      },
      {
        queryKey: ["accounting-proto", "settlements", companyId],
        queryFn: () => listSettlements(companyId),
        enabled: Boolean(companyId),
      },
      {
        queryKey: ["accounting-proto", "invoices", companyId],
        queryFn: () => listInvoices(companyId),
        enabled: Boolean(companyId),
      },
      {
        queryKey: ["accounting-proto", "qbo-sync-stats", companyId],
        queryFn: () => getQboSyncQueueStats(companyId),
        enabled: Boolean(companyId),
      },
      {
        queryKey: ["accounting-proto", "qbo-sync-queue", companyId],
        queryFn: () => getQboSyncQueue(companyId, { limit: 50 }),
        enabled: Boolean(companyId),
      },
      {
        queryKey: ["accounting-hub", "trial-balance", companyId, quarterRange.start, quarterRange.end],
        queryFn: () =>
          getTrialBalanceReport({
            operating_company_id: companyId,
            from_date: quarterRange.start,
            to_date: quarterRange.end,
            basis: "accrual",
          }),
        enabled: Boolean(companyId),
        retry: false,
      },
      {
        queryKey: ["accounting-hub", "profit-loss", companyId, monthRange.start, monthRange.end],
        queryFn: () =>
          getProfitLossReport({
            operating_company_id: companyId,
            from_date: monthRange.start,
            to_date: monthRange.end,
            basis: "accrual",
          }),
        enabled: Boolean(companyId),
        retry: false,
      },
      {
        // HUB-MTD-EXPENSES (owner 2026-09-06 05:0xZ, Accounting home showed MTD EXPENSES $0.00 · 0 bills while Neon held
        // 207 direct expenses): the KPI read BILLS only. Direct expenses (accounting.expenses, the whole USMCA cost base
        // today) are month-to-date expenses too. GET /api/v1/expenses caps limit at 200 → paged by offset.
        queryKey: ["accounting-proto", "expenses-mtd", companyId, mtdStart],
        queryFn: async () => {
          const rows: Awaited<ReturnType<typeof listExpenses>>["rows"] = [];
          for (let offset = 0; offset < 5000; offset += 200) {
            const page = await listExpenses(companyId, { limit: 200, offset, date_from: mtdStart });
            const got = page.rows ?? [];
            rows.push(...got);
            if (got.length < 200) break;
          }
          return rows;
        },
        enabled: Boolean(companyId),
        retry: false,
      },
    ],
  });

  const bills = billsQ.data?.rows ?? [];
  const billPayments = billPaymentsQ.data?.rows ?? [];
  const receivePayments = paymentsQ.data?.rows ?? [];
  const settlements = settlementsQ.data?.settlements ?? [];
  const invoices = invoicesQ.data?.invoices ?? [];
  const qboItems = qboQueueQ.data?.items ?? [];

  const openBills = useMemo(
    () =>
      bills
        .filter((bill) => (bill.status === "open" || bill.status === "partial") && amountOrBalanceCents(bill) > 0)
        .sort((a, b) => amountOrBalanceCents(b) - amountOrBalanceCents(a)),
    [bills]
  );

  const billsMtd = useMemo(() => bills.filter((bill) => isIsoOnOrAfter(bill.bill_date, mtdStart)), [bills, mtdStart]);
  const openBillsAmountCents = openBills.reduce((sum, bill) => sum + amountOrBalanceCents(bill), 0);
  const directExpensesMtd = useMemo(
    () => (expensesQ.data ?? []).filter((x) => x.status !== "void" && x.status !== "draft" && isIsoOnOrAfter(x.transaction_date, mtdStart)),
    [expensesQ.data, mtdStart]
  );
  const expensesMtdCents =
    billsMtd.reduce((sum, row) => sum + Number(row.amount_cents ?? 0), 0) +
    directExpensesMtd.reduce((sum, x) => sum + Number(x.total_amount_cents ?? 0), 0);
  // ACCT-F200 / LV-AR-OPEN-INCLUDES-VOIDED (ACCT-F5027) — amount_open_cents is a STORED GENERATED
  // column that legitimately stays nonzero on a voided invoice (voiding changes validity, not face
  // value); every open-A/R read path MUST exclude voided rows instead, via the same
  // isVoidInvoice/invoiceOpenCentsForDisplay helpers InvoicesListPage already uses. This KPI was the
  // one surface still summing the raw column unfiltered, live-overstating USMCA Open Invoices by
  // ~$32.9k (34 void rows, $34,873.57 shown vs the real $3,200.00 open across 3 proforma rows).
  const openInvoices = invoices.filter((invoice) => !isVoidInvoice(invoice) && invoiceOpenCentsForDisplay(invoice) > 0);
  const openInvoicesCents = openInvoices.reduce((sum, invoice) => sum + Number(invoice.amount_open_cents ?? 0), 0);
  const overdueInvoices = openInvoices.filter((invoice) => invoice.due_date < companyToday());
  const overdueInvoiceCents = overdueInvoices.reduce((sum, invoice) => sum + Number(invoice.amount_open_cents ?? 0), 0);
  const unmatchedItems = qboItems.filter((item) => item.sync_status === "failed" || item.sync_status === "blocked");
  const qboPending = Number(qboStatsQ.data?.pending ?? 0);
  const qboFailed = Number(qboStatsQ.data?.failed ?? 0);

  const settlementsRows: AmountRow[] = settlements
    .slice(0, 5)
    .map((row) => ({
      key: row.id,
      left: row.driver_full_name || "Settlement",
      right: money.format(Number(row.net_pay ?? 0) / 100),
      muted: row.status,
    }));

  const findTransactionsRows: AmountRow[] = useMemo(() => {
    const items: Array<{ key: string; label: string; date: string; amountCents: number; type: string }> = [];
    for (const row of billPayments.slice(0, 12)) {
      items.push({
        key: `bp-${row.id}`,
        // ACCOUNTING-HUB-FIND-TRANSACTIONS-BILL-PAYMENT-LABEL-IGNORES-AVAILABLE-VENDOR-NAME:
        // reference_number/check_number/memo are commonly blank on routine payments. The
        // backend's listBillPayments() already resolves vendor_name + bill_number on every row
        // (same pattern BillPaymentsListPage.tsx already uses) -- prefer those before falling
        // back to the free-text fields, so a resolvable payment never renders "Payment — not visible".
        label: entityLabel(
          row.vendor_name || row.bill_number || row.reference_number || row.check_number || row.memo,
          row.id,
          "Payment",
        ),
        date: row.payment_date,
        amountCents: Number(row.amount_cents ?? 0),
        type: "Bill payment",
      });
    }
    for (const row of receivePayments.slice(0, 12)) {
      items.push({
        key: `rp-${row.id}`,
        label: entityLabel(row.display_id || row.customer_name, row.id, "Payment"),
        date: row.payment_date,
        amountCents: Number(row.amount_cents ?? 0),
        type: "Receive payment",
      });
    }
    return items
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 5)
      .map((item) => ({
        key: item.key,
        left: item.label,
        right: money.format(item.amountCents / 100),
        muted: item.type,
      }));
  }, [billPayments, receivePayments]);

  const unmatchedRows: AmountRow[] = unmatchedItems.slice(0, 5).map((item) => ({
    key: item.id,
    left: `${item.entity_type} · ${entityLabel(item.display_id, item.entity_id, "Record")}`,
    right: item.sync_status,
    muted: relativeRetry(item.next_attempt_at),
  }));

  const trialBalanceRows: AmountRow[] = useMemo(() => {
    if (trialBalanceQ.isError) {
      return [
        {
          key: "tb-stub",
          left: "Ledger snapshot",
          right: "Unavailable",
          muted: "service unavailable",
        },
      ];
    }
    if (trialBalanceQ.isLoading || !trialBalanceQ.data) {
      return [{ key: "tb-loading", left: "Ledger snapshot", right: "Loading…" }];
    }
    const { summary, rows } = trialBalanceQ.data;
    return [
      {
        key: "tb-debits",
        left: "Grand debits",
        right: money.format(summary.grand_total_debits / 100),
      },
      {
        key: "tb-credits",
        left: "Grand credits",
        right: money.format(summary.grand_total_credits / 100),
      },
      {
        key: "tb-balanced",
        left: "Balance check",
        right: summary.balanced ? "Balanced" : "Out of balance",
        muted: `${rows.length} accounts`,
      },
    ];
  }, [trialBalanceQ.data, trialBalanceQ.isError, trialBalanceQ.isLoading]);

  const profitLossRows: AmountRow[] = useMemo(() => {
    if (profitLossQ.isError) {
      return [
        {
          key: "pl-stub",
          left: "P&L snapshot",
          right: "Unavailable",
          muted: "service unavailable",
        },
      ];
    }
    if (profitLossQ.isLoading || !profitLossQ.data) {
      return [{ key: "pl-loading", left: "P&L snapshot", right: "Loading…" }];
    }
    const report = profitLossQ.data;
    return [
      {
        key: "pl-revenue",
        left: "Revenue",
        right: money.format(report.revenue.total / 100),
      },
      {
        key: "pl-gross",
        left: "Gross profit",
        right: money.format(report.gross_profit / 100),
      },
      {
        key: "pl-net",
        left: "Net income",
        right: money.format(report.net_income / 100),
        muted: report.net_income < 0 ? "loss" : "profit",
      },
    ];
  }, [profitLossQ.data, profitLossQ.isError, profitLossQ.isLoading]);

  const kpiStrip = (
    <div className="grid gap-2 md:grid-cols-3 xl:grid-cols-6">
        {/* CLS-MONEY-KPI-FAKE-ZERO-REMAINDER-HUB — hub strip used billsQ.data?.rows ?? [] / invoicesQ.data
            without isError, so a failed bills/invoices/QBO fetch still painted $0.00 / 0 open. */}
        {billsQ.isError
          ? kpiCard("Open Bills", "—", "Error loading")
          : kpiCard("Open Bills", money.format(openBillsAmountCents / 100), `${openBills.length} open`, openBills.length ? "danger" : "neutral")}
        {billsQ.isError
          ? kpiCard("MTD Expenses", "—", "Error loading")
          : expensesQ.isError
            ? kpiCard("MTD Expenses", "—", "Error loading expenses")
            : kpiCard("MTD Expenses", money.format(expensesMtdCents / 100), `${billsMtd.length} bills · ${directExpensesMtd.length} expenses`, "warn")}
        {invoicesQ.isError
          ? kpiCard("Open Invoices", "—", "Error loading")
          : kpiCard("Open Invoices", money.format(openInvoicesCents / 100), `${openInvoices.length} open`)}
        {invoicesQ.isError
          ? kpiCard("Overdue A/R", "—", "Error loading")
          : kpiCard("Overdue A/R", money.format(overdueInvoiceCents / 100), `${overdueInvoices.length} overdue`, overdueInvoices.length ? "danger" : "neutral")}
        {qboQueueQ.isError
          ? kpiCard("Unmatched", "—", "Error loading")
          : kpiCard("Unmatched", String(unmatchedItems.length), "failed / blocked queue")}
        {qboStatsQ.isError
          ? kpiCard("QBO Sync", "—", "Error loading")
          : kpiCard("QBO Sync", `${qboPending} pending`, qboFailed ? `${qboFailed} failed` : "queue healthy", qboFailed ? "danger" : qboPending ? "warn" : "neutral")}
      </div>
  );

  return (
    <AccountingSubNavWrapper
      title="Accounting"
      subtitle="Bills, expenses, invoices, settlements & transaction review"
      kpiStrip={kpiStrip}
      createControl={
        // Access follows the existing accounting role gate (canAccessAccounting: Owner /
        // Administrator / Accountant) — the same bar as every other create surface in this module.
        // No amount threshold: owner ruling 2026-07-22, "remove threshold".
        // CTL-04: createControl replaces module "+ Create ▾" so hub has exactly one create control.
        <Button size="sm" onClick={() => setManualJeOpen(true)} disabled={!companyId}>
          + Create Manual JE
        </Button>
      }
    >
      {!companyId ? <p className="text-xs text-slate-700">Select an operating company.</p> : null}
      <div className="grid gap-2 lg:grid-cols-3">
        {homePanel("Settlements", settlementsRows, settlementsQ.isLoading ? "Loading…" : "No settlements found.", "/driver-finance/settlements", "View all")}
        {homePanel(
          "Find Transactions",
          findTransactionsRows,
          billPaymentsQ.isLoading || paymentsQ.isLoading ? "Loading…" : "No transactions found.",
          "/accounting/payments",
          "Open payments"
        )}
        {homePanel(
          "Unmatched / Needs Review",
          unmatchedRows,
          qboQueueQ.isLoading ? "Loading…" : "No unmatched queue items.",
          "/banking/qbo-sync-queue",
          "Open queue"
        )}
        {homePanel(
          "TRIAL BALANCE",
          trialBalanceRows,
          trialBalanceQ.isError
            ? "Trial balance snapshot is temporarily unavailable."
            : `Quarter-to-date ${quarterRange.start} → ${quarterRange.end}.`,
          "/reports/trial-balance",
          "Open trial balance"
        )}
        {homePanel(
          "PROFIT & LOSS",
          profitLossRows,
          profitLossQ.isError
            ? "P&L snapshot is temporarily unavailable."
            : `Month-to-date ${monthRange.start} → ${monthRange.end}.`,
          "/reports/profit-loss",
          "Open profit & loss"
        )}
      </div>
      {companyId && user?.role === "Owner" ? (
        <ManualJEModal
          open={manualJeOpen}
          operatingCompanyId={companyId}
          onClose={() => setManualJeOpen(false)}
          onSaved={() => {
            setManualJeOpen(false);
            void queryClient.invalidateQueries({ queryKey: ["journal-entries", companyId] });
            void queryClient.invalidateQueries({ queryKey: ["accounting-hub", "trial-balance", companyId] });
            void queryClient.invalidateQueries({ queryKey: ["accounting-hub", "profit-loss", companyId] });
          }}
        />
      ) : null}
    </AccountingSubNavWrapper>
  );
}
