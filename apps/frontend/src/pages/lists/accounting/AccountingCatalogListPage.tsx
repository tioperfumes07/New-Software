import { useEffect, useMemo, useState, type ReactNode } from "react";
import { CatalogListSearchInput } from "../../../components/lists/CatalogListSearchInput";
import { catalogListSearchQueryOptions } from "../../../hooks/catalogListSearchQueryOptions";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import type { AccountingCatalogRow } from "../../../api/catalogs-accounting";
import { Button } from "../../../components/Button";
import { BackArrowHeader } from "../../../components/layout/BackArrowHeader";
import { ListErrorState } from "../../../components/ListErrorState";
import { ParityTable, type ParityColumn } from "../../../components/parity/ParityTable";
import { formatQueryErrorDetail } from "../../../lib/tableError";
import { useCompanyContext } from "../../../contexts/CompanyContext";
import { AccountingCatalogModal, type AccountingCatalogClient, type AccountingMetadataField } from "./AccountingCatalogModal";
import { AccountingCatalogProfileDrawer } from "./AccountingCatalogProfileDrawer";
import { SelectCombobox } from "../../../components/Combobox";

type Props = {
  client: AccountingCatalogClient & {
    list: (filters: {
      operating_company_id: string;
      search?: string;
      is_active?: "true" | "false" | "all";
      limit?: number;
      offset?: number;
    }) => Promise<{ rows: AccountingCatalogRow[]; total: number }>;
  };
  displayName: string;
  breadcrumbPath: string;
  codeLabel?: string;
  readOnly?: boolean;
  // PAYMENT-TERMS-CODE-NAME-COLUMN-COLLISION — see AccountingCatalogModal's own doc comment.
  singleCodeNameField?: boolean;
  metadataFields?: AccountingMetadataField[];
  metadataSummary?: (row: AccountingCatalogRow) => string;
  // Optional in-context explainer link (e.g. Expense Categories → the GL account map).
  helperLink?: { label: string; to: string; note?: string };
  // Opt-in (Block 7): multi-select checkboxes + a caller-rendered bulk-action bar.
  enableBulkSelect?: boolean;
  bulkBar?: (ctx: { selectedIds: string[]; rows: AccountingCatalogRow[]; clearSelection: () => void; refetch: () => void }) => ReactNode;
};

function statusPillClass(isActive: boolean) {
  return isActive
    ? "rounded-sm bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700"
    : "rounded-sm bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600";
}

export function AccountingCatalogListPage({
  client,
  displayName,
  breadcrumbPath,
  codeLabel = "Code",
  readOnly = false,
  singleCodeNameField = false,
  metadataFields,
  metadataSummary,
  helperLink,
  enableBulkSelect = false,
  bulkBar,
}: Props) {
  const { selectedCompanyId } = useCompanyContext();
  const companyId = selectedCompanyId ?? "";
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"true" | "false" | "all">("true");
  const [modalMode, setModalMode] = useState<"create" | "edit">("create");
  const [selectedRow, setSelectedRow] = useState<AccountingCatalogRow | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  // Remount key: bumping it resets ParityTable's internal selection after a bulk action
  // (density/columns/per-page survive the remount via storageKey persistence).
  const [tableKey, setTableKey] = useState(0);
  const bulkEnabled = enableBulkSelect && Boolean(bulkBar);
  const clearSelection = () => setTableKey((k) => k + 1);

  // Deep-link ?create=1 opens AccountingCatalogModal (Classes / Expense Categories / etc.).
  useEffect(() => {
    if (readOnly) return;
    if (searchParams.get("create") !== "1" || !companyId) return;
    setModalMode("create");
    setSelectedRow(null);
    setModalOpen(true);
    const next = new URLSearchParams(searchParams);
    next.delete("create");
    setSearchParams(next, { replace: true });
  }, [searchParams, companyId, readOnly, setSearchParams]);

  const query = useQuery({
    queryKey: ["catalogs", "accounting", displayName, companyId, search, status],
    queryFn: () => client.list({ operating_company_id: companyId, search: search || undefined, is_active: status, limit: 200, offset: 0 }),
    enabled: Boolean(companyId),
    ...catalogListSearchQueryOptions,
  });

  const rows = query.data?.rows ?? [];
  const total = query.data?.total ?? 0;
  // Default sort order for a new row = max(existing)+1 (QBO/NetSuite convention: append to the end).
  const nextSortOrder = rows.length ? Math.max(...rows.map((r) => r.sort_order ?? 0)) + 1 : 1;

  const columns = useMemo<Array<ParityColumn<AccountingCatalogRow>>>(
    () => [
      {
        key: "code",
        label: codeLabel,
        sortable: true,
        render: (row) => (
          <span className="text-xs font-medium tracking-normal [font-variant-ligatures:none]">{row.code || "—"}</span>
        ),
      },
      { key: "display_name", label: "Display Name", sortable: true },
      {
        key: "details",
        label: "Details",
        sortable: true,
        render: (row) => (
          <span className="text-xs text-slate-600">{metadataSummary ? metadataSummary(row) : row.description || "—"}</span>
        ),
        sortValue: (row) => (metadataSummary ? metadataSummary(row) : row.description ?? ""),
      },
      {
        key: "is_active",
        label: "Status",
        sortable: true,
        render: (row) => <span className={statusPillClass(row.is_active)}>{row.is_active ? "Active" : "Inactive"}</span>,
        sortValue: (row) => (row.is_active ? "Active" : "Inactive"),
      },
    ],
    [codeLabel, metadataSummary],
  );

  return (
    <div className="space-y-3">
      <BackArrowHeader
        backTo="/lists"
        breadcrumb={breadcrumbPath.replace(/^Back · /, "").split(" · ")}
        title={displayName}
        countBadge={total}
        actions={
          !readOnly ? (
            <Button
              onClick={() => {
                setModalMode("create");
                setSelectedRow(null);
                setModalOpen(true);
              }}
            >
              + Create
            </Button>
          ) : undefined
        }
      />
      {helperLink ? (
        <div className="rounded-sm border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
          {helperLink.note ? <span className="mr-1">{helperLink.note}</span> : null}
          <Link to={helperLink.to} className="font-semibold text-slate-700 underline focus:outline-hidden focus:ring-2 focus:ring-slate-400">
            {helperLink.label}
          </Link>
        </div>
      ) : null}

      {query.isError ? (
        <ListErrorState
          title={`Couldn't load ${displayName.toLowerCase()}`}
          {...formatQueryErrorDetail(query.error)}
          onRetry={() => void query.refetch()}
        />
      ) : (
        <ParityTable<AccountingCatalogRow>
          key={tableKey}
          rows={rows}
          columns={columns}
          rowKey={(row) => row.id}
          loading={query.isLoading}
          emptyText={`No ${displayName.toLowerCase()} found.`}
          storageKey={`accounting-catalog-${displayName.toLowerCase().replace(/\s+/g, "-")}`}
          tableTestId="accounting-catalog-list-table"
          onRowClick={(row) => {
            setSelectedRow(row);
            setProfileOpen(true);
          }}
          selectable={bulkEnabled}
          batchActions={
            bulkEnabled
              ? (selected) =>
                  bulkBar!({
                    selectedIds: selected.map((r) => r.id),
                    rows,
                    clearSelection,
                    refetch: () => void query.refetch(),
                  })
              : undefined
          }
          suppressToolbarSearch
          filterBar={
            <div className="grid gap-2 md:grid-cols-3">
              <CatalogListSearchInput value={search} onChange={setSearch} placeholder="Search by code or display name" className="h-9 rounded-sm border border-gray-300 px-2 text-xs md:col-span-2" />
              <SelectCombobox value={status} onChange={(event) => setStatus(event.target.value as "true" | "false" | "all")} className="h-9 rounded-sm border border-gray-300 px-2 text-xs">
                <option value="true">Active</option>
                <option value="false">Inactive</option>
                <option value="all">All</option>
              </SelectCombobox>
            </div>
          }
        />
      )}

      <AccountingCatalogProfileDrawer
        open={profileOpen}
        displayName={displayName}
        codeLabel={codeLabel}
        singleCodeNameField={singleCodeNameField}
        row={selectedRow}
        canEdit={!readOnly}
        onClose={() => setProfileOpen(false)}
        onEdit={() => {
          setProfileOpen(false);
          setModalMode("edit");
          setModalOpen(true);
        }}
      />

      <AccountingCatalogModal
        open={modalOpen}
        readOnly={readOnly}
        operatingCompanyId={companyId}
        displayName={displayName}
        codeLabel={codeLabel}
        singleCodeNameField={singleCodeNameField}
        metadataFields={metadataFields}
        nextSortOrder={nextSortOrder}
        client={client}
        mode={modalMode}
        row={selectedRow}
        onClose={() => setModalOpen(false)}
        onSaved={() => {
          void query.refetch();
        }}
      />
    </div>
  );
}
