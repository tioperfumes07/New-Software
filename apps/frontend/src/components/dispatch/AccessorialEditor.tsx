import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { additionalChargesCatalogClient, listAllDispatchCatalogRows } from "../../api/catalogs-dispatch";
import { CappedListNotice } from "../CappedListNotice";
import { ReferenceSelect } from "../parity/ReferenceSelect";
import { MoneyInput } from "../forms/MoneyInput";
import { ListErrorState } from "../ListErrorState";
import { ParityTable, type ParityColumn } from "../parity/ParityTable";
import {
  createEmptyAccessorialRow,
  seedAccessorialRow,
  sumAccessorialCents,
  type AccessorialRow,
  type AccessorialSeedPreset,
} from "./accessorial-editor-lib";

export type DetentionSeedPatch = {
  detention_expected_y_n: boolean;
  detention_expected_hours?: number;
  detention_bill_customer_per_hour_cents?: number;
};

type Props = {
  operatingCompanyId: string;
  rows: AccessorialRow[];
  onRowsChange: (rows: AccessorialRow[]) => void;
  onDetentionSeed?: (patch: DetentionSeedPatch) => void;
  /** W7 — per-stop extra rates (stops[].extra_rates) rolled into the displayed Accessorial subtotal. */
  extraSubtotalCents?: number;
};

function updateRow(rows: AccessorialRow[], id: string, patch: Partial<AccessorialRow>): AccessorialRow[] {
  return rows.map((row) => (row.id === id ? { ...row, ...patch } : row));
}

export function AccessorialEditor({ operatingCompanyId, rows, onRowsChange, onDetentionSeed, extraSubtotalCents = 0 }: Props) {
  const catalogQuery = useQuery({
    queryKey: ["book-load-additional-charges", operatingCompanyId],
    queryFn: () =>
      listAllDispatchCatalogRows(additionalChargesCatalogClient, {
        operating_company_id: operatingCompanyId,
        is_active: "true",
      }),
    enabled: Boolean(operatingCompanyId),
  });

  const catalogOptions = useMemo(() => {
    const catalogRows = catalogQuery.data?.rows ?? [];
    if (catalogRows.length > 0) {
      return catalogRows.map((row) => ({
        value: row.id,
        code: row.code,
        label: row.display_name,
        description: row.description ?? row.display_name,
      }));
    }
    return [];
  }, [catalogQuery.data?.rows]);

  const accessorialSubtotal = sumAccessorialCents(rows) + Math.max(0, extraSubtotalCents);

  function appendRow(row: AccessorialRow) {
    onRowsChange([...rows, row]);
  }

  function handleCreateCharge() {
    appendRow(createEmptyAccessorialRow());
  }

  function handleSeed(preset: AccessorialSeedPreset) {
    const row = seedAccessorialRow(preset);
    const canonical = catalogOptions.find((option) => option.code === row.code);
    appendRow({
      ...row,
      additional_charge_id: canonical?.value ?? "",
      description: canonical?.description ?? row.description,
    });
    if (preset === "detention") {
      onDetentionSeed?.({ detention_expected_y_n: true });
    }
  }

  function handleCodeChange(id: string, catalogId: string) {
    const option = catalogOptions.find((o) => o.value === catalogId);
    const existing = rows.find((r) => r.id === id);
    onRowsChange(
      updateRow(rows, id, {
        additional_charge_id: catalogId,
        code: option?.code ?? existing?.code ?? "",
        // A code created inline is not in catalogOptions until the refetch lands — keep whatever
        // description the row already had rather than blanking it in that window.
        description: option?.description ?? option?.label ?? existing?.description ?? "",
      })
    );
  }

  function handleRemove(id: string) {
    onRowsChange(rows.filter((row) => row.id !== id));
  }

  const columns = useMemo((): Array<ParityColumn<AccessorialRow>> => {
    return [
      {
        key: "code",
        // K1 (owner correction 2026-09-02, Plain English Law): this column's underlying `code` key
        // and catalogs.additional_charges.code are unchanged — only the operator-facing header
        // moves from the machine term "Code" to what the operator is actually picking: the billable
        // income item (e.g. Detention, Lumper) they're charging the customer for.
        label: "Income item",
        sortable: true,
        // LST-PICKER-03: the accessorial code picker now inherits the shared picker law — "+ Create
        // Accessorial charge" is the permanent FIRST ROW INSIDE the dropdown (no external button),
        // and the create writes catalogs.additional_charges, the same table this list reads, so a
        // code created mid-booking is still there after a reload. Options are keyed by `code`, so
        // createdValueField="code" selects the new row by the value this editor actually stores.
        render: (row) => (
          <ReferenceSelect
            value={row.additional_charge_id || null}
            onChange={(next) => handleCodeChange(row.id, next ?? "")}
            options={catalogOptions.map((o) => ({ value: o.value, label: o.label }))}
            createKind="additional_charge"
            operatingCompanyId={operatingCompanyId}
            loading={catalogQuery.isLoading}
            placeholder="Select income item"
            onOptionCreated={() => void catalogQuery.refetch()}
          />
        ),
      },
      {
        key: "description",
        label: "Description",
        sortable: true,
        render: (row) => (
          <input
            type="text"
            value={row.description}
            onChange={(event) => onRowsChange(updateRow(rows, row.id, { description: event.target.value }))}
            className="h-7 w-full rounded-sm border border-gray-300 px-2 text-xs"
          />
        ),
      },
      {
        key: "amount_cents",
        label: "Amount ($)",
        sortable: true,
        cellClass: "text-right",
        render: (row) => (
          <MoneyInput
            valueCents={row.amount_cents}
            onChangeCents={(c) => onRowsChange(updateRow(rows, row.id, { amount_cents: c ?? 0 }))}
            className="ml-auto w-24"
            ariaLabel="Accessorial amount"
          />
        ),
      },
      {
        key: "taxable",
        label: "Taxable",
        sortable: true,
        cellClass: "text-center",
        render: (row) => (
          <input
            type="checkbox"
            checked={row.taxable}
            onChange={(event) => onRowsChange(updateRow(rows, row.id, { taxable: event.target.checked }))}
          />
        ),
      },
    ];
  }, [catalogOptions, catalogQuery, operatingCompanyId, onRowsChange, rows]);

  const catalogErr = catalogQuery.error as { status?: number; message?: string } | null;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="text-xs font-semibold text-[#1f2a44] hover:underline" onClick={handleCreateCharge}>
          + Create charge
        </button>
        <span className="text-xs text-gray-400">·</span>
        {(["detention", "layover", "lumper"] as const).map((preset) => (
          <button
            key={preset}
            type="button"
            className="text-xs font-semibold capitalize text-[#1f2a44] hover:underline"
            onClick={() => handleSeed(preset)}
          >
            {preset}
          </button>
        ))}
        <span className="ml-auto text-xs font-semibold text-gray-600">
          Accessorial subtotal{" "}
          <span className="font-mono text-gray-900">
            {new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(accessorialSubtotal / 100)}
          </span>
        </span>
      </div>

      {catalogQuery.isError ? (
        <ListErrorState
          title="Couldn't load accessorial codes"
          status={typeof catalogErr?.status === "number" ? catalogErr.status : 0}
          message={catalogErr?.message}
          onRetry={() => void catalogQuery.refetch()}
        />
      ) : null}

      <ParityTable
        storageKey="dispatch-accessorial-editor"
        tableTestId="accessorial-editor-table"
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        emptyText="No accessorial charges yet. Use + Create charge or quick seeds (detention · layover · lumper)."
        initialPageSize={50}
        pageSizeOptions={[25, 50, 100]}
        // K3 (owner correction 2026-09-02): ParityTable's own UniversalListToolbar search box was
        // rendering above this load's own handful of charge lines -- a client search over 1-5 rows
        // the operator is actively typing into (Description/Amount), not a dataset to search. Same
        // shape as the already-documented LV-WORK-ORDERS-CONSOLE-DUPLICATE-SEARCH fix.
        suppressToolbarSearch
        // K5 (GO-23 wave5 row15, 2026-09-02): same shape as K3 above -- the built-in "Per page" /
        // "Page 1 of 1" pager chrome was rendering under a load's own handful of charge lines. A
        // single load never carries enough accessorial lines to paginate (initialPageSize=50 above
        // already fits every real case in one page), so the pager can only ever show "Page 1 of 1" --
        // controls that can never do anything, on a table the operator is actively editing, not
        // paging through. hidePager (ParityTable's own documented suppression flag, Phase A3) keeps
        // internal slicing at initialPageSize=50 (every row still renders) and only hides the chrome.
        hidePager
        // DSP-TBL (owner ruling 2026-09-05): footerCells replaces the old colSpan-based raw
        // footer — the label now lives in the "code" column's cell (description's cell renders
        // empty, same visual read as the old 2-column span) so the total stays under "amount_cents"
        // even if the operator reorders/hides a column.
        footerCells={{
          code: <span className="text-[11px] font-semibold uppercase tracking-[0.4px] text-gray-600">Amounts total</span>,
          amount_cents: (visibleRows) => (
            <span data-testid="accessorial-amounts-column-total" className="text-gray-900">
              {new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(sumAccessorialCents(visibleRows) / 100)}
            </span>
          ),
        }}
        rowActions={(row) => (
          <button type="button" className="text-xs text-red-700 hover:underline" onClick={() => handleRemove(row.id)}>
            Remove
          </button>
        )}
      />
      <CappedListNotice
        shown={(catalogQuery.data?.rows ?? []).length}
        limit={200}
        total={catalogQuery.data?.total ?? null}
        hint="Type to search for an accessorial code that is not listed."
        className="text-[11px] text-slate-600"
      />
    </div>
  );
}
