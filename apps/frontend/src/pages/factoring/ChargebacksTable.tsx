/**
 * Factoring chargebacks/fees list — display-only (props in; parent owns query).
 * Migrated to shared ParityTable grammar; amount formatting, sign, column order,
 * EntityLink, and bulk Export Selected / Dispute stub preserved 1:1.
 */
import { entityLabel } from "../../lib/entity-label";
import { ParityTable, type ParityColumn } from "../../components/parity/ParityTable";
import { EntityLink } from "../../components/shared/EntityLink";
import { useToast } from "../../components/Toast";
import type { LoadCostRollupFields } from "../../api/factoring";
import { buildLoadCostColumns, centsFromWire } from "./loadCostColumnManifest";

export type ChargebackFeeRow = {
  factoring_advance_id: string;
  created_at: string | null;
  statement_reference: string | null;
  chargeback_amount: number;
  factor_fee_amount: number;
  invoice_id: string | null;
  invoice_display_id: string | null;
  customer_id: string | null;
  customer_name: string | null;
  // ACCT-F5901 — the Advance column rendered statement_reference's free-text memo (same string as
  // the neighboring Statement Ref column) because no dollar field existed on this row at all.
  // views.factoring_chargebacks_fees (202613080000) now selects the real advance amount, mirroring
  // views.factoring_recourse_at_risk's already-live advance_amount column exactly.
  advance_amount: number;
  // FAC-08: source load resolved by the backend chargebacks route (accounting.invoices LATERAL).
  load_id: string | null;
} & LoadCostRollupFields;

type Props = {
  rows: ChargebackFeeRow[];
  fmtCurrency: (value: unknown) => string;
  fmtDate: (value: unknown) => string;
};

// Minimal RFC-4180 CSV cell escaping (mirrors the inline pattern in AccountRegisterPage/useListExport).
function csvCell(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function downloadCsv(filename: string, header: string[], rows: string[][]) {
  const lines = [header, ...rows].map((cols) => cols.map(csvCell).join(","));
  const blob = new Blob([lines.join("\r\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function ChargebacksTable({ rows, fmtCurrency, fmtDate }: Props) {
  const { pushToast } = useToast();

  const columns: Array<ParityColumn<ChargebackFeeRow>> = [
    {
      key: "factoring_advance_id",
      label: "Advance",
      sortable: true,
      // ACCT-F5901 — was entityLabel(row.statement_reference, ...), which rendered the exact same
      // free-text memo string the neighboring Statement Ref column also renders, not a dollar
      // amount. The drill-through to the advance record is preserved (never remove a working
      // link); only the label changes, from duplicated memo text to the real dollar figure.
      render: (row) => (
        <EntityLink kind="factoring_advance" id={row.factoring_advance_id} label={fmtCurrency(row.advance_amount)} />
      ),
    },
    {
      key: "created_at",
      label: "Date",
      sortable: true,
      render: (row) => fmtDate(row.created_at),
    },
    {
      key: "invoice_id",
      label: "Invoice",
      render: (row) => row.invoice_id ? (
        <EntityLink kind="invoice" id={row.invoice_id} label={entityLabel(row.invoice_display_id, row.invoice_id, "Invoice")} />
      ) : "—",
    },
    {
      key: "customer_id",
      label: "Customer",
      render: (row) => row.customer_id ? (
        <EntityLink kind="customer" id={row.customer_id} label={entityLabel(row.customer_name, row.customer_id, "Customer")} />
      ) : "—",
    },
    {
      key: "statement_reference",
      label: "Statement Ref",
      render: (row) => row.statement_reference || "—",
    },
    {
      key: "chargeback_amount",
      label: "Chargeback",
      sortable: true,
      render: (row) => fmtCurrency(row.chargeback_amount),
    },
    {
      key: "factor_fee_amount",
      label: "Fee",
      sortable: true,
      render: (row) => fmtCurrency(row.factor_fee_amount),
    },
    // FAC-08: same SHARED Load-Costs manifest as the recourse register (one manifest, two consumers).
    // Advanced + Factoring fee excluded — this register renders native Advance + Fee dollar columns
    // above (never-delete law), so the gear shows no duplicate.
    ...buildLoadCostColumns<ChargebackFeeRow>(
      (row) => ({
        loadId: row.load_id,
        loadNumber: row.lc_load_number,
        driverId: row.lc_driver_id,
        driverName: row.lc_driver_name,
        unitNumber: row.lc_unit_number,
        settlementNumber: row.lc_settlement_number,
        revenueCents: centsFromWire(row.lc_revenue_cents),
        costsCents: centsFromWire(row.lc_costs_cents),
        driverPayCents: centsFromWire(row.lc_driver_pay_cents),
        marginCents: centsFromWire(row.lc_margin_cents),
        factoringFeeCents: null,
        reserveCents: null,
        advancedCents: null,
        dueCents: null,
      }),
      { exclude: ["advanced", "factoring_fee"] },
    ),
  ];

  return (
    <ParityTable
      columns={columns}
      rows={rows}
      rowKey={(row) => row.factoring_advance_id}
      storageKey="factoring-chargebacks"
      tableTestId="factoring-chargebacks-table"
      emptyText="No chargeback/fee rows available."
      selectable
      maxSelectable={200}
      onSelectionCapExceeded={() => pushToast("Selection cap of 200 rows reached.", "error")}
      batchActions={(selected) => (
        <>
          <button
            type="button"
            className="rounded-sm border border-gray-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700"
            onClick={() => {
              if (selected.length === 0) {
                pushToast("Select at least one row to export.", "info");
                return;
              }
              downloadCsv(
                `factoring-chargebacks-${new Date().toISOString().slice(0, 10)}.csv`,
                ["Advance Id", "Date", "Statement Ref", "Chargeback", "Fee"],
                selected.map((row) => [
                  row.factoring_advance_id,
                  fmtDate(row.created_at),
                  row.statement_reference || "",
                  fmtCurrency(row.chargeback_amount),
                  fmtCurrency(row.factor_fee_amount),
                ]),
              );
              pushToast(`Exported ${selected.length} chargeback row(s).`, "success");
            }}
          >
            Export Selected
          </button>
          <button
            type="button"
            disabled
            title="Bulk dispute is not available yet."
            className="rounded-sm border border-gray-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700 disabled:opacity-50"
            onClick={() => pushToast("Bulk dispute is not available yet.", "info")}
          >
            Dispute
          </button>
        </>
      )}
    />
  );
}
