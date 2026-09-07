import { DndContext, type DragEndEvent, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { listAllDispatchCatalogRows, pickupTimeTypesCatalogClient } from "../../api/catalogs-dispatch";
import { getLoadStopsForDispatch, replaceLoadStopsDispatch, type RefinedLoadStop } from "../../api/dispatch";
import { DateTimePicker } from "../../components/forms/DateTimePicker";
import { Button } from "../../components/Button";
import { CappedListNotice } from "../../components/CappedListNotice";
import { useToast } from "../../components/Toast";
import { ReferenceSelect } from "../../components/parity/ReferenceSelect";
import { SelectCombobox } from "../../components/Combobox";

export type UiStopType = "pickup" | "dropoff" | "fuel" | "rest" | "customs";

export type MultiStopRow = {
  key: string;
  stop_type: UiStopType;
  location_address: string;
  city: string;
  state: string;
  country: string;
  postal_code: string;
  window_start: string;
  window_end: string;
  notes: string;
  signature_required: boolean;
  photo_required: boolean;
  latitude: string;
  longitude: string;
  /** catalogs.pickup_time_types — Load drawer Stops picker_law (Book Load parity). */
  pickup_time_type_id: string;
  geocode_precision: "rooftop" | "range" | "locality" | null;
};

function apiStopToRow(s: RefinedLoadStop): MultiStopRow {
  const st = s.stop_type === "delivery" ? "dropoff" : s.stop_type === "border" ? "customs" : (s.stop_type as UiStopType);
  const wStart = s.appointment_start_at ?? s.scheduled_arrival_at ?? "";
  const wEnd = s.appointment_end_at ?? "";
  return {
    key: s.id,
    stop_type: st,
    location_address: s.address_line1 ?? "",
    city: s.city ?? "",
    state: s.state ?? "",
    country: s.country ?? "US",
    postal_code: s.postal_code ?? "",
    window_start: wStart ? wStart.slice(0, 16) : "",
    window_end: wEnd ? wEnd.slice(0, 16) : "",
    notes: s.notes ?? "",
    signature_required: Boolean(s.signature_required),
    photo_required: Boolean(s.photo_required),
    latitude: s.latitude != null ? String(s.latitude) : "",
    longitude: s.longitude != null ? String(s.longitude) : "",
    pickup_time_type_id: s.pickup_time_type_id ?? "",
    geocode_precision: s.geocode_precision ?? null,
  };
}

function padIsoLocal(draft: string): string | null {
  if (!draft || draft.length < 10) return null;
  const normalized = draft.includes("T") ? draft : `${draft}:00`;
  const d = new Date(normalized);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function SortableRow({
  row,
  index,
  operatingCompanyId,
  pickupTimeTypeOptions,
  pickupTimeTypesLoading,
  pickupTimeTypesUnavailable,
  onPickupTimeTypeCreated,
  onChange,
  onRemove,
  disabled,
}: {
  row: MultiStopRow;
  index: number;
  operatingCompanyId: string;
  pickupTimeTypeOptions: Array<{ value: string; label: string; type?: string }>;
  pickupTimeTypesLoading: boolean;
  pickupTimeTypesUnavailable: boolean;
  onPickupTimeTypeCreated: () => void;
  onChange: (key: string, patch: Partial<MultiStopRow>) => void;
  onRemove: (key: string) => void;
  disabled: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: row.key, disabled });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.85 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} className="rounded-sm border border-gray-200 bg-white p-2 text-xs shadow-xs">
      <div className="flex items-start gap-2">
        <button
          type="button"
          className="mt-1 cursor-grab rounded-sm border border-gray-200 px-1 text-xs text-gray-500"
          {...attributes}
          {...listeners}
          aria-label="Drag to reorder"
          disabled={disabled}
        >
          ::
        </button>
        <div className="grid flex-1 grid-cols-2 gap-2">
          <div>
            <div className="text-xs font-semibold text-gray-500">#{index + 1} Type</div>
            <SelectCombobox
              className="mt-0.5 h-8 w-full rounded-sm border border-gray-300 px-1 text-xs"
              value={row.stop_type}
              onChange={(e) => onChange(row.key, { stop_type: e.target.value as UiStopType })}
            >
              {(["pickup", "dropoff", "fuel", "rest", "customs"] as const).map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </SelectCombobox>
          </div>
          <div className="flex items-end justify-end">
            <Button type="button" variant="secondary" size="sm" onClick={() => onRemove(row.key)}>
              Remove
            </Button>
          </div>
          <div className="col-span-2" data-testid={`stop-pickup-time-type-${index}`}>
            <label htmlFor={`stop-pickup-time-type-${row.key}`} className="text-xs font-semibold text-gray-500">
              Pickup / appointment type
            </label>
            <div className="mt-0.5">
              <ReferenceSelect
                id={`stop-pickup-time-type-${row.key}`}
                value={row.pickup_time_type_id || null}
                onChange={(value) => onChange(row.key, { pickup_time_type_id: value ?? "" })}
                options={pickupTimeTypeOptions}
                createKind="pickup_time_type"
                operatingCompanyId={operatingCompanyId}
                placeholder="Select pickup type"
                loading={pickupTimeTypesLoading}
                disabled={pickupTimeTypesLoading || pickupTimeTypesUnavailable}
                onOptionCreated={onPickupTimeTypeCreated}
              />
            </div>
          </div>
          <div className="col-span-2">
            <div className="text-xs font-semibold text-gray-500">Address</div>
            <input
              className="mt-0.5 h-8 w-full rounded-sm border border-gray-300 px-2 text-xs"
              value={row.location_address}
              onChange={(e) => onChange(row.key, { location_address: e.target.value })}
            />
            {row.geocode_precision === "locality" ? (
              <span data-testid="stop-geocode-locality-chip" className="mt-1 inline-flex rounded-sm bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                city-level only — no arrival fence
              </span>
            ) : null}
          </div>
          <div>
            <div className="text-xs font-semibold text-gray-500">City</div>
            <input className="mt-0.5 h-8 w-full rounded-sm border border-gray-300 px-2 text-xs" value={row.city} onChange={(e) => onChange(row.key, { city: e.target.value })} />
          </div>
          <div>
            <div className="text-xs font-semibold text-gray-500">ST</div>
            <input className="mt-0.5 h-8 w-full rounded-sm border border-gray-300 px-2 text-xs" value={row.state} onChange={(e) => onChange(row.key, { state: e.target.value })} />
          </div>
          <div>
            <div className="text-xs font-semibold text-gray-500">ZIP</div>
            <input
              className="mt-0.5 h-8 w-full rounded-sm border border-gray-300 px-2 text-xs"
              value={row.postal_code}
              onChange={(e) => onChange(row.key, { postal_code: e.target.value })}
              aria-label="ZIP"
            />
          </div>
          <div>
            <div className="text-xs font-semibold text-gray-500">Window start</div>
            <DateTimePicker
              className="mt-0.5 w-full"
              aria-label="Window start"
              value={row.window_start}
              onChange={(v) => onChange(row.key, { window_start: v })}
            />
          </div>
          <div>
            <div className="text-xs font-semibold text-gray-500">Window end</div>
            <DateTimePicker
              className="mt-0.5 w-full"
              aria-label="Window end"
              value={row.window_end}
              onChange={(v) => onChange(row.key, { window_end: v })}
            />
          </div>
          <label className="col-span-1 flex items-center gap-1 text-xs">
            <input type="checkbox" checked={row.signature_required} onChange={(e) => onChange(row.key, { signature_required: e.target.checked })} />
            Sig
          </label>
          <label className="col-span-1 flex items-center gap-1 text-xs">
            <input type="checkbox" checked={row.photo_required} onChange={(e) => onChange(row.key, { photo_required: e.target.checked })} />
            Photo
          </label>
          <div className="col-span-2">
            <div className="text-xs font-semibold text-gray-500">Notes</div>
            <textarea className="mt-0.5 w-full rounded-sm border border-gray-300 px-2 py-1 text-xs" rows={2} value={row.notes} onChange={(e) => onChange(row.key, { notes: e.target.value })} />
          </div>
        </div>
      </div>
    </div>
  );
}

type Props = {
  loadId: string;
  operatingCompanyId: string;
};

export function MultiStopEditor({ loadId, operatingCompanyId }: Props) {
  const { pushToast } = useToast();
  const qc = useQueryClient();
  const [rows, setRows] = useState<MultiStopRow[]>([]);
  const actionGenerationRef = useRef(0);

  useEffect(() => {
    actionGenerationRef.current += 1;
  }, [loadId, operatingCompanyId]);

  const q = useQuery({
    queryKey: ["dispatch", "load-stops-refined", loadId, operatingCompanyId],
    queryFn: () => getLoadStopsForDispatch(loadId, operatingCompanyId),
    enabled: Boolean(loadId && operatingCompanyId),
  });

  const pickupTimeTypesQuery = useQuery({
    queryKey: ["dispatch", "pickup-time-types", operatingCompanyId],
    queryFn: () => listAllDispatchCatalogRows(pickupTimeTypesCatalogClient, { operating_company_id: operatingCompanyId, is_active: "true" }),
    enabled: Boolean(operatingCompanyId),
  });

  const pickupTimeTypeOptions = useMemo(
    () => (pickupTimeTypesQuery.data?.rows ?? []).map((row) => ({ value: row.id, label: row.display_name, type: row.code })),
    [pickupTimeTypesQuery.data?.rows]
  );

  useEffect(() => {
    if (q.data?.stops) setRows(q.data.stops.map(apiStopToRow));
  }, [q.data]);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setRows((items) => {
      const oldIndex = items.findIndex((i) => i.key === String(active.id));
      const newIndex = items.findIndex((i) => i.key === String(over.id));
      if (oldIndex < 0 || newIndex < 0) return items;
      return arrayMove(items, oldIndex, newIndex);
    });
  };

  const totals = useMemo(() => {
    const n = Math.max(0, rows.length - 1);
    const dist = n * 145;
    const hrs = n * 2 + dist / 55;
    return { dist, hrs };
  }, [rows.length]);

  type SaveStopsInput = {
    generation: number;
    loadId: string;
    companyId: string;
    body: Parameters<typeof replaceLoadStopsDispatch>[1];
  };

  const mut = useMutation({
    mutationFn: async (input: SaveStopsInput) => {
      if (input.body.stops.length < 2) throw new Error("need_two_stops");
      return replaceLoadStopsDispatch(input.loadId, input.body);
    },
    onSuccess: async (_result, input) => {
      if (input.generation !== actionGenerationRef.current) return;
      pushToast("Stops saved", "success");
      await qc.invalidateQueries({ queryKey: ["dispatch", "load-stops-refined", input.loadId, input.companyId] });
      await qc.invalidateQueries({ queryKey: ["loads", "detail", input.loadId] });
    },
    onError: (err, input) => {
      if (input.generation !== actionGenerationRef.current) return;
      const msg = String((err as Error)?.message ?? "");
      pushToast(msg === "need_two_stops" ? "Need at least 2 stops to save" : "Could not save stops", "error");
    },
  });

  const saveStops = () => {
    const companyId = operatingCompanyId;
    const submittedLoadId = loadId;
    const body: Parameters<typeof replaceLoadStopsDispatch>[1] = {
      operating_company_id: companyId,
      stops: rows.map((r, idx) => {
        const lat = r.latitude.trim() === "" ? null : Number(r.latitude);
        const lng = r.longitude.trim() === "" ? null : Number(r.longitude);
        return {
          sequence_number: idx + 1,
          stop_type: r.stop_type,
          location_address: r.location_address || null,
          city: r.city || null,
          state: r.state || null,
          country: r.country || "US",
          postal_code: r.postal_code || null,
          address_line1: r.location_address || null,
          latitude: lat != null && Number.isFinite(lat) ? lat : null,
          longitude: lng != null && Number.isFinite(lng) ? lng : null,
          window_start: padIsoLocal(r.window_start),
          window_end: padIsoLocal(r.window_end),
          notes: r.notes || null,
          signature_required: r.signature_required,
          photo_required: r.photo_required,
          pickup_time_type_id: r.pickup_time_type_id || null,
        };
      }),
    };
    mut.mutate({ generation: actionGenerationRef.current, loadId: submittedLoadId, companyId, body });
  };

  const patchRow = (key: string, patch: Partial<MultiStopRow>) => {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  };

  const removeRow = (key: string) => {
    setRows((prev) => prev.filter((r) => r.key !== key));
  };

  const addStop = () => {
    setRows((prev) => [
      ...prev,
      {
        key: `new-${typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Date.now())}`,
        stop_type: "rest",
        location_address: "",
        city: "",
        state: "",
        country: "US",
        postal_code: "",
        window_start: "",
        window_end: "",
        notes: "",
        signature_required: false,
        photo_required: false,
        latitude: "",
        longitude: "",
        pickup_time_type_id: "",
        geocode_precision: null,
      },
    ]);
  };

  if (q.isLoading) return <div className="text-xs text-gray-500">Loading stops…</div>;
  if (q.isError) {
    return (
      <div className="space-y-2 rounded-sm border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700" role="alert" data-load-stops-read-error>
        <div>Could not load stops.</div>
        <Button type="button" size="sm" variant="secondary" onClick={() => void q.refetch()}>
          Retry stops
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <CappedListNotice
        shown={pickupTimeTypeOptions.length}
        limit={200}
        total={pickupTimeTypesQuery.data?.total ?? null}
        hint="Type in the pickup-time field to narrow the catalog."
      />
      {pickupTimeTypesQuery.isError ? (
        <div className="space-y-1 rounded-sm border border-red-200 bg-red-50 p-2 text-xs text-red-700" role="alert">
          <div>Could not load pickup and appointment types.</div>
          <Button type="button" size="sm" variant="secondary" onClick={() => void pickupTimeTypesQuery.refetch()}>
            Retry pickup types
          </Button>
        </div>
      ) : null}
      <fieldset className="space-y-2" disabled={mut.isPending} aria-busy={mut.isPending}>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={rows.map((r) => r.key)} strategy={verticalListSortingStrategy}>
            <div className="space-y-2">
              {rows.map((row, index) => (
                <SortableRow
                  key={row.key}
                  row={row}
                  index={index}
                  operatingCompanyId={operatingCompanyId}
                  pickupTimeTypeOptions={pickupTimeTypeOptions}
                  pickupTimeTypesLoading={pickupTimeTypesQuery.isLoading}
                  pickupTimeTypesUnavailable={pickupTimeTypesQuery.isError}
                  onPickupTimeTypeCreated={() => void pickupTimeTypesQuery.refetch()}
                  onChange={patchRow}
                  onRemove={removeRow}
                  disabled={mut.isPending}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
        <Button type="button" size="sm" variant="secondary" onClick={addStop}>
          + Create stop
        </Button>
        <div className="rounded-sm border border-gray-100 bg-gray-50 p-2 text-xs text-gray-700">
          Est. leg miles: ~{totals.dist} · Est. hours: ~{totals.hrs.toFixed(1)}
        </div>
        <Button type="button" size="sm" loading={mut.isPending} onClick={saveStops}>
          Save stops
        </Button>
      </fieldset>
    </div>
  );
}
