import { useEffect, useState, type JSX } from "react";
import { useQuery } from "@tanstack/react-query";
import type { UseFormRegister, UseFormSetValue, UseFormWatch } from "react-hook-form";
import { listDriverTeams } from "../../../api/mdata";
import { DriverPickerWithCreate } from "../../../components/drivers/DriverPickerWithCreate";
import { EntityPicker } from "../../../components/EntityPicker";
import { SelectCombobox } from "../../../components/Combobox";
import { OptimalDriversPanel } from "../../../components/dispatch/OptimalDriversPanel";
import { DriverHosClocksBlock } from "../../../components/dispatch/hos/DriverHosClocks";
import { DeadheadOptimizerPanel } from "../../../components/dispatch/DeadheadOptimizerPanel";
import { DriverInstructionsTextarea } from "./book-load-v4/DriverInstructionsTextarea";
import { ExpectedAdjustmentsCallout } from "./book-load-v4/ExpectedAdjustmentsCallout";
import { loadTrailerEquipmentCatalogClient, type DispatchCatalogRow } from "../../../api/catalogs-dispatch";
import { ReferenceSelect } from "../../../components/parity/ReferenceSelect";
import { EntityLinkOrTombstone } from "../../../components/shared/EntityLinkOrTombstone";
import { ListErrorState } from "../../../components/ListErrorState";
import type { EntityPickerOption } from "../../../components/parity/entityPickerRegistry";
import { InterchangeTrailerPicker } from "./book-load-v4/InterchangeTrailerPicker";
import { getDriverPayCard, type NonOwnedTrailer } from "../../../api/dispatch";

type Props = {
  register: UseFormRegister<any>;
  watch?: UseFormWatch<any>;
  setValue?: UseFormSetValue<any>;
  operatingCompanyId?: string;
  /** Existing load id when editing; preview seam uses reservation uuid for new books. */
  optimizerLoadId?: string;
  /** Deadhead-optimizer inputs lifted from the parent so §B order is owned here (RENDER-A-v2). */
  deadheadAfterAt?: string;
  deadheadDropCity?: string;
  deadheadDropState?: string;
  /**
   * AUTHGATE-PANEL-MISSING-ENTITY-LABELS (2026-08-21): this section owns the ONLY place BookLoadModalV4
   * ever learns a picked unit/trailer/driver's real display name (EntityPickerOption.label) — the form's
   * own watch()'d fields hold IDs only. BookLoadModalV4 renders its own <AuthGatePanel> sibling further
   * down the tree with the same unitUuid/trailerUuid/driverUuid but had no way to also pass
   * unitLabel/trailerLabel/driverLabel, so AuthGatePanel's EntityLinkOrTombstone always fell back to
   * "Unit — not visible" (id-only) even though the label was known right here. Lifting it up.
   */
  onOptionsResolved?: (options: {
    unit: EntityPickerOption | null;
    trailer: EntityPickerOption | null;
    primaryDriver: EntityPickerOption | null;
  }) => void;
};

export function BookLoadEquipmentSection({ register, watch, setValue, operatingCompanyId, optimizerLoadId, deadheadAfterAt, deadheadDropCity, deadheadDropState, onOptionsResolved }: Props) {
  const assignmentMode = watch ? watch("assignment_mode") : "solo";
  const primaryDriverId = watch ? String(watch("assigned_primary_driver_id") ?? "").trim() : "";
  const secondaryDriverId = watch ? String(watch("assigned_secondary_driver_id") ?? "").trim() : "";
  const hosOperatingCompanyId = operatingCompanyId?.trim() || undefined;
  const assignedUnitId = watch ? String(watch("assigned_unit_id") ?? "") : "";
  const assignedTrailerUnitId = watch ? String(watch("assigned_trailer_unit_id") ?? "") : "";
  // OPT-PANEL-01 (restored 2026-09-06, LEAD ROUND 13 -- LST-F6134/#20187 dropped this embed with
  // no owner remove line; additive law requires restoring it). Preview seam: a new (not-yet-booked)
  // load has no id yet, so the optimizer keys off the in-progress reservation_uuid instead; an
  // edit-mode caller can still pass a real optimizerLoadId to key off the load itself.
  const reservationUuid = watch ? String(watch("reservation_uuid") ?? "") : "";
  const hazmat = watch ? Boolean(watch("hazmat")) : false;
  const stops = watch ? (watch("stops") as Array<{ city?: string; state?: string }> | undefined) : undefined;
  const pickupStop = stops?.find((s) => s) ?? stops?.[0];
  const optimizerLoadKey = optimizerLoadId || reservationUuid || "00000000-0000-4000-8000-000000000000";
  const [primaryDriverOption, setPrimaryDriverOption] = useState<EntityPickerOption | null>(null);
  const [secondaryDriverOption, setSecondaryDriverOption] = useState<EntityPickerOption | null>(null);
  const [unitOption, setUnitOption] = useState<EntityPickerOption | null>(null);
  const [trailerOption, setTrailerOption] = useState<EntityPickerOption | null>(null);
  // GO-23 A1 — trailer source: our own fleet OR an interchange (non-owned) trailer, never both.
  // trailer_source defaults to "owned" so every existing load's behavior is unchanged.
  const trailerSource = watch ? (String(watch("trailer_source") ?? "owned") as "owned" | "interchange") : "owned";
  const interchangeTrailerId = watch ? String(watch("interchange_trailer_id") ?? "") : "";
  const [interchangeTrailerOption, setInterchangeTrailerOption] = useState<NonOwnedTrailer | null>(null);
  // AUTHGATE-PANEL-MISSING-ENTITY-LABELS: lift the resolved labels up so BookLoadModalV4's separate
  // <AuthGatePanel> can pass real names instead of leaving EntityLinkOrTombstone id-only.
  useEffect(() => {
    const trailerForGate =
      trailerSource === "interchange" && interchangeTrailerOption
        ? {
            value: interchangeTrailerOption.id,
            label: [interchangeTrailerOption.trailer_number, interchangeTrailerOption.counterparty_name]
              .filter((part) => Boolean(part && String(part).trim()))
              .join(" · "),
          }
        : trailerOption;
    onOptionsResolved?.({
      unit: unitOption,
      trailer: trailerForGate,
      primaryDriver: primaryDriverOption,
    });
  }, [
    interchangeTrailerOption,
    onOptionsResolved,
    primaryDriverOption,
    trailerOption,
    trailerSource,
    unitOption,
  ]);
  const trailerType = watch ? String(watch("trailer_type") ?? "") : "";
  const temperatureType = watch ? String(watch("temperature_type") ?? "") : ""; // W-FIX-1 Frozen/Fresh segmented
  // Conditional equipment detail reveals (render-v6 §B): reefer detail only on a reefer trailer, tarp detail
  // only on a flatbed. Previously the reefer setpoint always showed and flatbed tarp detail never revealed.
  const isReefer = trailerType === "refrigerated_van";
  const isFlatbed = trailerType === "flatbed";
  // render-v6 §B: Tarp qty + size are disabled until "Tarp required?" = Yes (reuses requires_tarps).
  const tarpRequired = watch ? Boolean(watch("requires_tarps")) : false;
  const teamsQuery = useQuery({
    queryKey: ["book-load-driver-teams", operatingCompanyId],
    queryFn: () => listDriverTeams(String(operatingCompanyId)),
    enabled: Boolean(operatingCompanyId),
  });
  // WIZ-32 / WIZ-16 — resolve the selected driver's per-mile rate for the read-only "Driver pay rate
  // / mi" display, from the SAME table settlement pays on (driver_finance.driver_pay_rates, via
  // /dispatch/driver-pay-card). The load stores no override, so the caption "resolves automatically
  // from the driver's profile rate card" is literally true. Only enabled once a driver is chosen.
  const driverPayCardQuery = useQuery({
    queryKey: ["book-load-driver-pay-card", operatingCompanyId, primaryDriverId],
    queryFn: () => getDriverPayCard({ operating_company_id: String(operatingCompanyId), driver_id: primaryDriverId }),
    enabled: Boolean(operatingCompanyId && primaryDriverId),
    staleTime: 30_000,
  });
  const driverPayCard = driverPayCardQuery.data;
  // Honest display: a per-mile RATE only exists for a per_mile_pay basis. A per_load_pay driver has
  // no per-mile rate (blank, not 0); no rate row at all is also blank (unknown), never a fabricated 0.
  const resolvedDriverRatePerMile =
    driverPayCard && driverPayCard.has_rate && driverPayCard.basis_type === "per_mile_pay" && driverPayCard.rate_per_mile_cents && driverPayCard.rate_per_mile_cents > 0
      ? (driverPayCard.rate_per_mile_cents / 100).toFixed(2)
      : "";
  const trailerEquipmentQuery = useQuery({
    queryKey: ["book-load-trailer-equipment", operatingCompanyId],
    queryFn: async () => {
      const limit = 200;
      const rows: DispatchCatalogRow[] = [];
      for (let offset = 0; ; offset += limit) {
        const page = await loadTrailerEquipmentCatalogClient.list({
          operating_company_id: String(operatingCompanyId),
          is_active: "true",
          limit,
          offset,
        });
        rows.push(...page.rows);
        if (rows.length >= page.total || page.rows.length < limit) return { rows, total: page.total };
      }
    },
    enabled: Boolean(operatingCompanyId),
  });
  useEffect(() => {
    if (!watch || !setValue || watch("load_trailer_equipment_id")) return;
    const match = trailerEquipmentQuery.data?.rows?.find((row) => row.code.toLowerCase() === trailerType);
    if (match) setValue("load_trailer_equipment_id", match.id);
  }, [setValue, trailerEquipmentQuery.data?.rows, trailerType, watch]);
  // C9: all six equipment requirement chips persist on mdata.loads (requires_tarps historically;
  // the other five via HOLD migration 202609170000).
  const toggles = [
    { field: "requires_reefer_fuel", label: "Reefer fuel" },
    { field: "requires_pulp_probe", label: "Pulp probe" },
    { field: "requires_locking_jacks", label: "Locking jacks" },
    { field: "requires_tarps", label: "Tarps" },
    { field: "requires_load_locks", label: "Load locks" },
    { field: "requires_straps", label: "Straps" },
  ] as const;

  return (
    <section className="space-y-2">
      <div className="grid grid-cols-1 items-end gap-2 md:grid-cols-2">
        {/* render-v6 §B labels: Reefer / Flatbed / Dry Van (/ Lowboy — needs a trailer_type enum value via a
            gated migration; flagged). power_only_* kept — real data; removing them would break power-only loads. */}
        <Field label="Trailer type" input={
          <ReferenceSelect
            size="sm"
            value={watch ? String(watch("load_trailer_equipment_id") ?? "") || null : null}
            onChange={(next) => {
              const row = trailerEquipmentQuery.data?.rows?.find((item) => item.id === next);
              setValue?.("load_trailer_equipment_id", next ?? "", { shouldDirty: true });
              if (row) setValue?.("trailer_type", row.code.toLowerCase(), { shouldDirty: true });
            }}
            options={(trailerEquipmentQuery.data?.rows ?? []).map((row) => ({ value: row.id, label: row.display_name, type: row.code }))}
            createKind="load_trailer_equipment"
            operatingCompanyId={operatingCompanyId ?? ""}
            loading={trailerEquipmentQuery.isLoading}
            placeholder="Select trailer requirement"
            onOptionCreated={() => void trailerEquipmentQuery.refetch()}
          />
        } />
        <Field
          label="Truck unit"
          input={
            <EntityPicker
              size="sm"
              kind="unit"
              operatingCompanyId={operatingCompanyId ?? ""}
              value={assignedUnitId || null}
              onChange={(next, option) => {
                setUnitOption(option ?? null);
                setValue?.("assigned_unit_id", next ?? "", { shouldDirty: true });
              }}
              onSelectedOptionResolved={setUnitOption}
              className="h-7 w-full text-xs"
              placeholder={operatingCompanyId ? "Select truck unit" : "Select company first"}
              dataField="assigned_unit_id"
              disabled={!operatingCompanyId}
            />
          }
        />
        </div>
        <Field
          label="Trailer"
          input={
            <div className="flex w-full min-w-0 flex-col gap-1">
              {/* GO-23 A1: our trailer XOR an interchange trailer — never both. Toggle sits above the
                  picker so the unit name is never clipped to "Select tra...". */}
              <div className="inline-flex h-7 w-fit shrink-0 overflow-hidden whitespace-nowrap rounded-sm border border-gray-300 bg-white text-xs font-semibold leading-none" data-testid="trailer-source-toggle">
                <button
                  type="button"
                  title="Our trailer"
                  onClick={() => {
                    setValue?.("trailer_source", "owned", { shouldDirty: true });
                    setValue?.("interchange_trailer_id", "", { shouldDirty: true });
                    setInterchangeTrailerOption(null);
                  }}
                  className={`px-1.5 ${trailerSource === "owned" ? "bg-[#1f2a44] text-white" : "text-gray-700"}`}
                >
                  Ours
                </button>
                <button
                  type="button"
                  title="Interchange trailer"
                  onClick={() => {
                    setValue?.("trailer_source", "interchange", { shouldDirty: true });
                    setTrailerOption(null);
                    setValue?.("assigned_trailer_unit_id", "", { shouldDirty: true });
                  }}
                  className={`border-l border-gray-300 px-1.5 ${trailerSource === "interchange" ? "bg-[#1f2a44] text-white" : "text-gray-700"}`}
                >
                  Interchange
                </button>
              </div>
              <div className="min-w-0 w-full">
              {trailerSource === "owned" ? (
                <EntityPicker
                  size="sm"
                  kind="trailer"
                  operatingCompanyId={operatingCompanyId ?? ""}
                  value={assignedTrailerUnitId || null}
                  onChange={(next, option) => {
                    setTrailerOption(option ?? null);
                    setValue?.("assigned_trailer_unit_id", next ?? "", { shouldDirty: true });
                  }}
                  onSelectedOptionResolved={setTrailerOption}
                  className="h-7 w-full text-xs"
                  placeholder={operatingCompanyId ? "Select trailer unit" : "Select company first"}
                  dataField="assigned_trailer_unit_id"
                  disabled={!operatingCompanyId}
                />
              ) : (
                <InterchangeTrailerPicker
                  size="sm"
                  operatingCompanyId={operatingCompanyId ?? ""}
                  value={interchangeTrailerId || null}
                  onChange={(next, trailer) => {
                    setInterchangeTrailerOption(trailer);
                    setValue?.("interchange_trailer_id", next ?? "", { shouldDirty: true });
                  }}
                  disabled={!operatingCompanyId}
                />
              )}
              </div>
            </div>
          }
        />
      {trailerEquipmentQuery.isError ? (
        <ListErrorState
          status={0}
          message="Trailer requirements unavailable."
          onRetry={() => void trailerEquipmentQuery.refetch()}
        />
      ) : null}
      {/* Exact Leaves dispatch.parity.book_load_equipment_section:driver|unit|trailer —
          pickers alone leave selected identities non-navigable; expose EntityLinks. */}
      {assignedUnitId || assignedTrailerUnitId || interchangeTrailerId || primaryDriverId || secondaryDriverId ? (
        <div
          className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-600"
          data-testid="book-load-equipment-selected-entitylinks"
        >
          {primaryDriverId ? (
            <span data-testid="book-load-equipment-driver-link">
              Driver:{" "}
              <EntityLinkOrTombstone kind="driver" id={primaryDriverId} name={primaryDriverOption?.label ?? null} noun="Driver" />
            </span>
          ) : null}
          {secondaryDriverId ? (
            <span data-testid="book-load-equipment-team-driver-link">
              Team:{" "}
              <EntityLinkOrTombstone kind="driver" id={secondaryDriverId} name={secondaryDriverOption?.label ?? null} noun="Driver" />
            </span>
          ) : null}
          {assignedUnitId ? (
            <span data-testid="book-load-equipment-unit-link">
              Unit: <EntityLinkOrTombstone kind="unit" id={assignedUnitId} name={unitOption?.label ?? null} noun="Unit" />
            </span>
          ) : null}
          {assignedTrailerUnitId ? (
            <span data-testid="book-load-equipment-trailer-link">
              Trailer:{" "}
              <EntityLinkOrTombstone kind="trailer" id={assignedTrailerUnitId} name={trailerOption?.label ?? null} noun="Trailer" />
            </span>
          ) : null}
          {interchangeTrailerId ? (
            // Plain English Law: never render the raw non_owned_trailer_id — no EntityLink kind
            // exists for it yet. interchangeTrailerOption is set synchronously by the picker's own
            // onChange, so this only ever shows a human label, never a bare UUID.
            <span data-testid="book-load-equipment-interchange-trailer-summary">
              Interchange trailer: {interchangeTrailerOption?.trailer_number ?? "selected"}
              {interchangeTrailerOption?.counterparty_name ? ` (${interchangeTrailerOption.counterparty_name})` : ""}
            </span>
          ) : null}
        </div>
      ) : null}
      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
        <Field
          label="Driver"
          input={
            <DriverPickerWithCreate
              size="sm"
              operatingCompanyId={operatingCompanyId ?? ""}
              value={primaryDriverId || null}
              onChange={(next, option) => {
                setPrimaryDriverOption(option ?? null);
                setValue?.("assigned_primary_driver_id", next ?? "", { shouldDirty: true });
              }}
              onSelectedOptionResolved={setPrimaryDriverOption}
              className="h-7 w-full text-xs"
              placeholder="Select driver"
              dataField="assigned_primary_driver_id"
              // FAIL-CA1: driver create defaults to Probation — Active-only hid SAMPLE Cascade-1612 class.
              driverRoster="active_or_probation"
              // BookLoadModalV4 is a centered portal modal (not ParityDrawer) → default shell="modal".
            />
          }
        />
        <Field
          label="Team driver"
          input={
            <DriverPickerWithCreate
              size="sm"
              operatingCompanyId={operatingCompanyId ?? ""}
              value={secondaryDriverId || null}
              onChange={(next, option) => {
                setSecondaryDriverOption(option ?? null);
                setValue?.("assigned_secondary_driver_id", next ?? "", { shouldDirty: true });
              }}
              onSelectedOptionResolved={setSecondaryDriverOption}
              className="h-7 w-full text-xs"
              placeholder="Solo load (optional)"
              dataField="assigned_secondary_driver_id"
              driverRoster="active_or_probation"
            />
          }
        />
      </div>
      <div className="space-y-2" data-testid="book-load-driver-hos">
        <DriverHosClocksBlock driverId={primaryDriverId || undefined} operatingCompanyId={hosOperatingCompanyId} heading="Driver HOS (hours of service)" />
        {assignmentMode === "team" && secondaryDriverId ? (
          <DriverHosClocksBlock driverId={secondaryDriverId} operatingCompanyId={hosOperatingCompanyId} heading="Team driver HOS" />
        ) : null}
      </div>
      {/* OPT-PANEL-01: restored embed (D8 driver assignment optimizer) — needs a pickup city to
          rank against, so it only renders once §A's first stop has one. */}
      {operatingCompanyId && pickupStop?.city ? (
        <OptimalDriversPanel
          loadId={optimizerLoadKey}
          operatingCompanyId={operatingCompanyId}
          selectedDriverId={primaryDriverId}
          onSelectDriver={(id) => setValue?.("assigned_primary_driver_id", id, { shouldDirty: true })}
          preview={{
            pickup_city: pickupStop.city,
            pickup_state: pickupStop.state,
            hazmat,
            trailer_type: trailerType,
          }}
        />
      ) : null}
      {/* RENDER-A-v2 §B: deadhead-optimizer aid sits with the driver-assignment helpers, before reefer/flatbed. */}
      {assignedUnitId && operatingCompanyId ? (
        <DeadheadOptimizerPanel
          operatingCompanyId={operatingCompanyId}
          unitUuid={assignedUnitId}
          unitName={unitOption?.label ?? null}
          afterDeliveryAt={deadheadAfterAt ?? ""}
          dropCity={deadheadDropCity ?? ""}
          dropState={deadheadDropState ?? ""}
        />
      ) : null}
      <div className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_auto] md:items-center">
        <Field
          label="Assignment mode"
          input={
            <div className="inline-flex h-7 overflow-hidden rounded-sm border border-gray-300 bg-white text-xs">
              <label className={`flex cursor-pointer items-center px-3 ${assignmentMode === "solo" ? "bg-[#1f2a44] text-white" : "text-gray-700"}`}>
                <input type="radio" value="solo" className="hidden" {...register("assignment_mode")} />
                Solo
              </label>
              <label className={`flex cursor-pointer items-center border-l border-gray-300 px-3 ${assignmentMode === "team" ? "bg-[#1f2a44] text-white" : "text-gray-700"}`}>
                <input type="radio" value="team" className="hidden" {...register("assignment_mode")} />
                Team
              </label>
            </div>
          }
        />
        <Field
          label="Team preset"
          input={
            <SelectCombobox
              {...register("team_id")}
              className="h-7 min-w-[240px] text-xs"
              disabled={teamsQuery.isLoading || teamsQuery.isError}
            >
              <option value="">
                {teamsQuery.isLoading ? "Loading teams..." : teamsQuery.isError ? "Teams unavailable" : "Optional team preset"}
              </option>
              {(teamsQuery.data?.teams ?? []).map((team) => (
                <option key={team.id} value={team.id}>
                  {team.team_name}
                </option>
              ))}
            </SelectCombobox>
          }
        />
      </div>
      {teamsQuery.isError ? (
        <ListErrorState status={0} message="Driver teams unavailable." onRetry={() => void teamsQuery.refetch()} />
      ) : null}
      {/* WIZ-32 / WIZ-16: a 0 in this box is a claim that the rate is zero. The field is display-only
          and READ-ONLY: blank when no driver (or no per-mile rate card), and the driver's resolved
          per-mile rate once one is selected — read from the same table settlement pays on. The load
          stores no override (booking resolves the rate live), so this control carries NO hidden
          register input: the form value comes from defaultValues and the submit omits a 0. The label
          is associated (htmlFor/id) with the single VISIBLE read-only input, so any label-target — a
          screen reader, getByLabelText, or an orch DOM probe — resolves to value=""/readOnly=true, never
          to a hidden "0". A hidden register field used to sit first under this label and read as a 0. */}
      <div className="flex flex-wrap items-end gap-3">
        <Field
          htmlFor="book-load-driver-pay-rate-per-mile"
          label="Driver pay rate / mi"
          hint="Resolves automatically from the driver's profile rate card — read-only."
          input={
            <input
              id="book-load-driver-pay-rate-per-mile"
              type="text"
              readOnly
              value={resolvedDriverRatePerMile}
              placeholder={primaryDriverId && driverPayCardQuery.isLoading ? "…" : ""}
              data-testid="driver-pay-rate-per-mile"
              aria-readonly="true"
              className="h-7 w-[5.5rem] rounded-sm border border-gray-300 bg-slate-50 px-2 text-right text-xs tabular-nums"
            />
          }
        />
      </div>
      {/* RENDER-A-v2 §B REEFER PANEL (amber, "Refrigerated") — reefer trailer only. "Temperature type"
          (Frozen/Fresh) is asked FIRST, THEN "Reefer temperature (°F)" (the single setpoint reefer_temp_f).
          temperature_type persists via migration 202606231600 (W-FIX-1). Reefer mode + Pre-cool removed. */}
      {isReefer ? (
        <div data-testid="reefer-panel" className="grid grid-cols-1 gap-2 rounded-sm border border-slate-200 bg-slate-100 p-2 md:grid-cols-2">
          <Field
            label="Temperature type"
            input={
              <div data-testid="temperature-type-segmented" className="flex h-7 overflow-hidden rounded-sm border border-gray-300 text-xs">
                {/* register keeps the value in form state; the buttons drive it via setValue (segmented control,
                    RENDER-A-v2). Asked FIRST, before "Reefer temperature (°F)". */}
                <input type="hidden" {...register("temperature_type")} />
                {([
                  { value: "frozen", label: "Frozen" },
                  { value: "fresh", label: "Fresh" },
                ] as const).map((opt, idx) => {
                  const active = temperatureType === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setValue?.("temperature_type", opt.value, { shouldDirty: true })}
                      className={`flex-1 px-2 ${idx === 0 ? "border-r border-gray-300" : ""} ${active ? "bg-[#1F2A44] text-white" : "bg-white text-slate-700"}`}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            }
          />
          <Field
            label="Reefer temperature (°F)"
            input={<input data-testid="reefer-temp-field" type="number" step="0.1" {...register("reefer_temp_f", { valueAsNumber: true })} className="h-7 w-full rounded-sm border border-gray-300 px-2 text-xs" />}
          />
        </div>
      ) : null}
      {/* Render-v6 §B conditional detail: revealed by trailer type. Reefer setpoint above (reefer only);
          flatbed reveals the tarp-type detail (the "Tarps" required toggle stays in the Equipment chips). */}
      {isFlatbed ? (
        <div data-testid="flatbed-tarp-detail" className="grid grid-cols-1 gap-2 rounded-sm border border-slate-200 bg-slate-100 p-2 md:grid-cols-3">
          {/* RENDER-A-v2 §B flatbed = Tarp required? · Tarp qty · Tarp size. The old "Tarp type" material
              dropdown is a separate extra beyond the size dropdown → kept hidden for round-trip. */}
          <input type="hidden" {...register("tarp_type")} />
          <Field
            label="Tarp required?"
            input={
              <label className="flex h-7 items-center gap-2 text-xs">
                <input type="checkbox" {...register("requires_tarps")} className="h-3.5 w-3.5" /> Required
              </label>
            }
          />
          <Field
            label="Tarp qty"
            input={<input data-testid="tarp-qty-field" type="number" min={0} step={1} disabled={!tarpRequired} {...register("tarp_qty", { valueAsNumber: true })} className="h-7 w-full rounded-sm border border-gray-300 px-2 text-xs disabled:bg-gray-100" />}
          />
          <Field
            label="Tarp size"
            input={
              <SelectCombobox {...register("tarp_size")} disabled={!tarpRequired} className="h-7 w-full text-xs disabled:bg-gray-100">
                <option value="">—</option>
                <option value="4ft">4'</option>
                <option value="6ft">6'</option>
                <option value="8ft">8'</option>
                <option value="steel">Steel</option>
                <option value="lumber">Lumber</option>
              </SelectCombobox>
            }
          />
        </div>
      ) : null}
      {/* RENDER-A-v2 §B: "Equipment & driver instructions" expander — equipment requirement chips + the
          driver-visible instructions, combined into one expander after the trailer panels. */}
      <details open data-testid="equipment-driver-instructions" className="rounded-sm border border-gray-200">
        <summary className="cursor-pointer px-2 py-1 text-[11px] font-semibold text-[#1f2a44]">
          Equipment &amp; driver instructions <span className="font-normal text-gray-400">requirements · visible to driver</span>
        </summary>
        <div className="space-y-2 border-t border-gray-200 p-2">
          <div>
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.4px] text-gray-600">Equipment</div>
            <div className="flex flex-wrap gap-1.5">
              {toggles.map((toggle) => (
                <label key={toggle.field} className="cursor-pointer">
                  <input type="checkbox" {...register(toggle.field)} className="peer sr-only" />
                  <span className="inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold tracking-[0.3px] text-gray-600 ring-1 ring-gray-300 peer-checked:bg-[#1f2a44] peer-checked:text-white peer-checked:ring-[#1f2a44]">
                    {toggle.label}
                  </span>
                </label>
              ))}
            </div>
          </div>
          <DriverInstructionsTextarea register={register as never} />
        </div>
      </details>
      <details open data-testid="expected-adjustments" className="rounded-sm border border-gray-200">
        <summary className="cursor-pointer px-2 py-1 text-[11px] font-semibold text-[#1f2a44]">
          Expected adjustments <span className="font-normal text-gray-400">detention · late risk</span>
        </summary>
        <div className="space-y-2 border-t border-gray-200 p-2">
          <ExpectedAdjustmentsCallout
            register={register as never}
            operatingCompanyId={operatingCompanyId ?? ""}
            watch={(watch ?? (() => undefined)) as never}
            setValue={(setValue ?? (() => undefined)) as never}
          />
        </div>
      </details>
      <div className="hidden">
        <input type="number" {...register("temp_fahrenheit", { valueAsNumber: true })} />
      </div>
    </section>
  );
}

function Field({ label, input, hint, htmlFor }: { label: string; input: JSX.Element; hint?: string; htmlFor?: string }) {
  return (
    <div className="min-w-0 space-y-0.5">
      <label htmlFor={htmlFor} className="block whitespace-nowrap text-[11px] font-bold uppercase tracking-[0.4px] text-[#4B5563]">{label}</label>
      {input}
      {hint ? <p className="mt-1 text-xs text-gray-600">{hint}</p> : null}
    </div>
  );
}
