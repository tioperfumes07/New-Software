import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { formatDateUS } from "../../lib/formatDate";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { convertFineToLiability, getSafetyFines } from "../../api/safety";
import { CompanyViolationsPage } from "./CompanyViolationsPage";
import { FineCreateModal } from "./components/FineCreateModal";
import { FineDetailDrawer } from "./components/FineDetailDrawer";
import { SelectCombobox } from "../../components/Combobox";
import { ParityTable, type ParityColumn } from "../../components/parity/ParityTable";
import { EntityPicker } from "../../components/EntityPicker";
import { ListErrorState } from "../../components/ListErrorState";
import { EntityLink } from "../../components/shared/EntityLink";
import { entityLabel } from "../../lib/entity-label";
import { Button } from "../../components/Button";
import { useStagedListFilters } from "../../components/table";
import { userFacingApiError } from "../../lib/api-error-message";

type FineRow = Record<string, unknown>;

type Props = {
  operatingCompanyId: string;
};

/** A23-9: merged company violations into External Fines via record-type filter (RBC option a). */
type RecordTypeFilter = "driver-fine" | "company-violation";

const EMPTY_FILTERS = { status: "", subjectType: "", driverId: "", unitId: "" };

export function FinesPage({ operatingCompanyId }: Props) {
  const queryClient = useQueryClient();
  const actionGenerationRef = useRef(0);
  const [searchParams, setSearchParams] = useSearchParams();
  // C-06: Home "Open Company Violations" drills with ?record_type=company-violation so the
  // merged External Fines tab opens on the company-violation filter (not the driver-fine default).
  const recordTypeFromUrl = searchParams.get("record_type");
  const initialRecordType: RecordTypeFilter =
    recordTypeFromUrl === "company-violation" ? "company-violation" : "driver-fine";
  const [recordTypeFilter, setRecordTypeFilter] = useState<RecordTypeFilter>(initialRecordType);
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedFine, setSelectedFine] = useState<Record<string, unknown> | null>(null);
  const [convertError, setConvertError] = useState<unknown>(null);
  const [page, setPage] = useState(0);
  const pageSize = 50;
  const relatedLoadFromUrl = searchParams.get("related_load_id")?.trim() ?? "";
  const relatedUnitFromUrl = searchParams.get("related_unit_id")?.trim() ?? "";
  const subjectDriverFromUrl = searchParams.get("subject_driver_id")?.trim() ?? "";
  // LST-F5163F: visible reverse filters (allowCreate=false); URL seeds pickers.
  // LV-SAFETY-EXTERNAL-FINES-FILTER-SILENT-APPLY — stage until Apply; Cancel restores.
  function patchSearchParam(next: { driverId: string; unitId: string }) {
    const p = new URLSearchParams(searchParams);
    if (next.driverId) p.set("subject_driver_id", next.driverId);
    else p.delete("subject_driver_id");
    if (next.unitId) p.set("related_unit_id", next.unitId);
    else p.delete("related_unit_id");
    setSearchParams(p, { replace: true });
  }

  const [applied, setApplied] = useState(() => ({
    ...EMPTY_FILTERS,
    driverId: subjectDriverFromUrl,
    unitId: relatedUnitFromUrl,
  }));
  const staged = useStagedListFilters({
    applied,
    empty: EMPTY_FILTERS,
    onApply: (next) => {
      setApplied(next);
      patchSearchParam(next);
    },
  });
  const draft = staged.draft;

  useEffect(() => {
    setApplied((prev) => ({
      ...prev,
      ...(subjectDriverFromUrl ? { driverId: subjectDriverFromUrl } : {}),
      ...(relatedUnitFromUrl ? { unitId: relatedUnitFromUrl } : {}),
    }));
  }, [subjectDriverFromUrl, relatedUnitFromUrl]);

  function setDriverFilter(next: string) {
    staged.setDraft((d) => ({ ...d, driverId: next }));
  }
  function setUnitFilter(next: string) {
    staged.setDraft((d) => ({ ...d, unitId: next }));
  }

  const finesQueryKey = [
      "safety",
      "fines",
      operatingCompanyId,
      applied.status,
      applied.subjectType,
      relatedLoadFromUrl,
      applied.unitId,
      applied.driverId,
      relatedUnitFromUrl,
      subjectDriverFromUrl,
      page,
    ] as const;
  const finesQuery = useQuery({
    queryKey: finesQueryKey,
    queryFn: () =>
      getSafetyFines(operatingCompanyId, {
        status: applied.status || undefined,
        subject_type: applied.subjectType ? (applied.subjectType as "driver" | "company") : undefined,
        related_load_id: relatedLoadFromUrl || undefined,
        related_unit_id: applied.unitId.trim() || relatedUnitFromUrl || undefined,
        subject_driver_id: applied.driverId.trim() || subjectDriverFromUrl || undefined,
        limit: pageSize,
        offset: page * pageSize,
      }),
    enabled: Boolean(operatingCompanyId),
  });

  /** @matrix-built modules=safety cols=driver,unit,load,gl_je,connectivity,reverse_link */
  const convertMutation = useMutation({
    mutationFn: (input: { fineId: string; companyId: string; generation: number; queryKey: readonly unknown[] }) =>
      convertFineToLiability(input.fineId, input.companyId),
    onMutate: () => setConvertError(null),
    onSuccess: (payload, input) => {
      if (input.generation !== actionGenerationRef.current) return;
      const fineId = String(payload.fine?.id ?? "");
      queryClient.setQueryData(
        input.queryKey,
        (old: { fines?: Array<Record<string, unknown>> } | undefined) => {
          if (!old?.fines) return old;
          return {
            ...old,
            // SAFETY-MONEY-FINE-CONVERT-DROPS-DRIVER-LABEL: convert-to-liability's response is a
            // plain `RETURNING *` on safety.civil_fines — it carries no subject_driver_name (that's
            // only ever computed by the enriched GET list/detail queries' JOIN to mdata.drivers).
            // Replacing the cached row wholesale with `payload.fine` therefore dropped the resolved
            // driver display name, rendering the governed "Driver — not visible" tombstone even
            // though the driver is fully resolvable — live-caught the first time this mutation was
            // ever exercised (0 prior real conversions existed). Merge the authoritative new fields
            // (status, converted_to_liability_id, etc.) onto the existing enriched row instead of
            // replacing it, so display-only joined fields survive.
            fines: old.fines.map((fine) =>
              String(fine.id) === fineId ? { ...fine, ...payload.fine } : fine
            ),
          };
        }
      );
      void queryClient.invalidateQueries({ queryKey: ["driver-settlements"] });
    },
    onError: (error, input) => {
      if (input.generation === actionGenerationRef.current) setConvertError(error);
    },
  });

  useEffect(() => {
    actionGenerationRef.current += 1;
    setSelectedFine(null);
    setConvertError(null);
    convertMutation.reset();
  }, [operatingCompanyId]); // Mutation reset is stable; company transitions own a fresh fine action lifecycle.

  const rows = finesQuery.data?.fines ?? [];
  const totalCount = finesQuery.isError ? 0 : finesQuery.data?.total_count ?? 0;
  const pageCount = Math.max(1, Math.ceil(totalCount / pageSize));

  useEffect(() => {
    setPage(0);
  }, [operatingCompanyId, applied, relatedLoadFromUrl, relatedUnitFromUrl, subjectDriverFromUrl]);

  // SAF-F33 reverse drill-through: /safety/external-fines?fine_id=<id> opens that fine's drawer.
  const fineIdParam = searchParams.get("fine_id");
  useEffect(() => {
    if (!fineIdParam || rows.length === 0) return;
    const match = rows.find((r) => String(r.id) === fineIdParam);
    if (match) {
      setSelectedFine(match);
      const next = new URLSearchParams(searchParams);
      next.delete("fine_id");
      setSearchParams(next, { replace: true });
    }
  }, [fineIdParam, rows, searchParams, setSearchParams]);

  useEffect(() => {
    if (recordTypeFromUrl === "company-violation" || recordTypeFromUrl === "driver-fine") {
      setRecordTypeFilter(recordTypeFromUrl);
    }
  }, [recordTypeFromUrl]);

  // SAF-B12: the drawer's lifecycle actions (contest / dismiss / reduce / link-payment) invalidate this
  // query. `selectedFine` is a snapshot of the row taken when the drawer opened, so on its own the drawer
  // would keep rendering the PRE-action status and amount after a successful write — the operator would
  // see "open" on a fine they just contested and reasonably conclude nothing happened. Re-point at the
  // refetched row DURING RENDER (not in an effect — that would be a cascading setState). If the new status
  // filters the row out of the list we keep the last snapshot so the drawer does not blank out.
  const activeFine = selectedFine
    ? rows.find((row) => String(row.id) === String(selectedFine.id)) ?? selectedFine
    : null;

  // Migrated to the shared QBO-parity grid — columns, order, and the per-row "Open" action are
  // preserved verbatim (§7 additive-only).
  const columns: Array<ParityColumn<FineRow>> = [
    { key: "issued_date", label: "Issued", sortable: true, render: (row) => formatDateUS(row.issued_date) },
    { key: "subject_type", label: "Subject", sortable: true, render: (row) => String(row.subject_type ?? "—") },
    {
      // SAF-F18: show the driver NAME (from the server-side join) as a drill-through link — was a raw
      // subject_driver_id uuid, or nothing. Company-subject fines have no driver → dash.
      key: "subject_driver_name",
      label: "Driver",
      render: (row) =>
        row.subject_driver_id ? (
          <EntityLink
            kind="driver"
            id={String(row.subject_driver_id)}
            label={entityLabel(row.subject_driver_name, String(row.subject_driver_id), "Driver")}
          />
        ) : (
          <span className="text-slate-400">—</span>
        ),
    },
    {
      key: "related_unit_id",
      label: "Unit",
      render: (row) =>
        row.related_unit_id ? (
          <EntityLink
            kind="unit"
            id={String(row.related_unit_id)}
            label={entityLabel(row.related_unit_number, String(row.related_unit_id), "Unit")}
          />
        ) : (
          <span className="text-slate-400">—</span>
        ),
    },
    { key: "issued_by_authority", label: "Authority", render: (row) => String(row.issued_by_authority ?? "—") },
    { key: "violation_description", label: "Violation", render: (row) => String(row.violation_description ?? "—") },
    { key: "amount_cents", label: "Amount", render: (row) => `$${(Number(row.amount_cents ?? 0) / 100).toFixed(2)}` },
    { key: "status", label: "Status", sortable: true, render: (row) => String(row.status ?? "open") },
    {
      key: "action",
      label: "Action",
      render: (row) => (
        <button type="button" className="text-slate-700 underline" onClick={() => setSelectedFine(row)}>
          Open
        </button>
      ),
    },
  ];

  if (recordTypeFilter === "company-violation") {
    return (
      <div className="space-y-3" data-testid="external-fines-page">
        <div className="flex flex-wrap items-center gap-2">
          <div data-testid="fines-record-type-filter">
            <SelectCombobox
              value={recordTypeFilter}
              onChange={(event) => setRecordTypeFilter(event.target.value as RecordTypeFilter)}
              className="rounded-sm border border-gray-300 px-2 py-1 text-xs"
            >
              <option value="driver-fine">Driver Fine</option>
              <option value="company-violation">Company Violation</option>
            </SelectCombobox>
          </div>
        </div>
        <CompanyViolationsPage operatingCompanyId={operatingCompanyId} />
      </div>
    );
  }

  return (
    <div className="space-y-3" data-testid="external-fines-page">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          className="rounded-sm bg-[#1F2A44] px-3 py-1 text-xs font-semibold text-white"
        >
          + Create Fine
        </button>
      </div>

      {finesQuery.isError ? (
        <ListErrorState
          title="Couldn't load fines"
          status={0}
          message={(finesQuery.error as Error)?.message}
          onRetry={() => void finesQuery.refetch()}
        />
      ) : (
      <ParityTable<FineRow>
        columns={columns}
        rows={rows}
        rowKey={(row) => String(row.id)}
        loading={finesQuery.isLoading}
        emptyText="No fines found."
        storageKey="safety-external-fines"
        exportFilename="external-fines"
        pageSize={pageSize}
        hidePager
        filterBar={
          <div className="relative flex flex-wrap items-end gap-2" data-testid="external-fines-filters">
            <div data-testid="fines-record-type-filter">
              <SelectCombobox
                value={recordTypeFilter}
                onChange={(event) => setRecordTypeFilter(event.target.value as RecordTypeFilter)}
                className="rounded-sm border border-gray-300 px-2 py-1 text-xs"
              >
                <option value="driver-fine">Driver Fine</option>
                <option value="company-violation">Company Violation</option>
              </SelectCombobox>
            </div>
            <SelectCombobox
              value={draft.status}
              onChange={(event) => staged.setDraft((d) => ({ ...d, status: event.target.value }))}
              className="rounded-sm border border-gray-300 px-2 py-1 text-xs"
            >
              <option value="">All statuses</option>
              <option value="open">Open</option>
              <option value="paid">Paid</option>
              <option value="contested">Contested</option>
              <option value="dismissed">Dismissed</option>
              <option value="reduced">Reduced</option>
            </SelectCombobox>
            <SelectCombobox
              value={draft.subjectType}
              onChange={(event) => staged.setDraft((d) => ({ ...d, subjectType: event.target.value }))}
              className="rounded-sm border border-gray-300 px-2 py-1 text-xs"
            >
              <option value="">All subjects</option>
              <option value="driver">Driver</option>
              <option value="company">Company</option>
            </SelectCombobox>
            <label className="text-[11px] text-slate-600">
              Driver
              <EntityPicker
                kind="driver"
                operatingCompanyId={operatingCompanyId}
                value={draft.driverId || null}
                onChange={(next) => setDriverFilter(next ?? "")}
                allowCreate={false}
                placeholder="All drivers"
                className="mt-1"
                dataTestId="fines-filter-driver"
              />
            </label>
            <label className="text-[11px] text-slate-600">
              Unit
              <EntityPicker
                kind="unit"
                operatingCompanyId={operatingCompanyId}
                value={draft.unitId || null}
                onChange={(next) => setUnitFilter(next ?? "")}
                allowCreate={false}
                placeholder="All units"
                className="mt-1"
                dataTestId="fines-filter-unit"
              />
            </label>
            <Button type="button" size="sm" data-testid="external-fines-filter-apply" onClick={staged.apply} disabled={!staged.dirty}>
              Apply
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              data-testid="external-fines-filter-cancel"
              onClick={staged.cancel}
              disabled={!staged.dirty}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              data-testid="external-fines-filter-reset"
              onClick={() => {
                staged.cancel();
                setApplied(EMPTY_FILTERS);
                patchSearchParam(EMPTY_FILTERS);
              }}
            >
              Reset
            </Button>
          </div>
        }
      />
      )}
      {!finesQuery.isError && totalCount > 0 ? (
        <div className="flex items-center justify-end gap-2 text-xs" data-testid="external-fines-server-pager">
          <span>{page * pageSize + 1}–{Math.min((page + 1) * pageSize, totalCount)} of {totalCount}</span>
          <Button type="button" size="sm" variant="secondary" disabled={page === 0} onClick={() => setPage((value) => Math.max(0, value - 1))}>Previous</Button>
          <Button type="button" size="sm" variant="secondary" disabled={page + 1 >= pageCount} onClick={() => setPage((value) => Math.min(pageCount - 1, value + 1))}>Next</Button>
        </div>
      ) : null}

      <FineCreateModal
        open={createOpen}
        operatingCompanyId={operatingCompanyId}
        onClose={() => setCreateOpen(false)}
        onCreated={() => void queryClient.invalidateQueries({ queryKey: ["safety", "fines", operatingCompanyId] })}
      />

      <FineDetailDrawer
        open={Boolean(activeFine)}
        fine={activeFine}
        operatingCompanyId={operatingCompanyId}
        converting={convertMutation.isPending}
        onClose={() => setSelectedFine(null)}
        onConvertToLiability={(fineId) => convertMutation.mutate({
          fineId,
          companyId: operatingCompanyId,
          generation: actionGenerationRef.current,
          queryKey: finesQueryKey,
        })}
        onUpdated={() => void queryClient.invalidateQueries({ queryKey: ["safety", "fines", operatingCompanyId] })}
      />
      {convertError ? (
        <p className="text-xs text-red-700" data-testid="fine-convert-liability-error">
          {userFacingApiError(convertError, "Could not convert the fine to a liability.")}
        </p>
      ) : null}
    </div>
  );
}
