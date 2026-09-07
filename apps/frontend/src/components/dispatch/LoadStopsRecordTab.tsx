// TABLE_DATE_OMIT: this table has no date column by design (not a time-series view).

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  geocodeDispatchLoadStops,
  getLoadStopsRecord,
  type StopsRecordLeg,
  type StopsRecordResponse,
  type StopsRecordStop,
} from "../../api/dispatch";
import { Button } from "../Button";
import { ParityTable, type ParityColumn } from "../parity/ParityTable";
import { useLoadDocuments } from "./tabs/useLoadDocuments";

type Props = {
  loadId: string;
  operatingCompanyId: string;
  onEditStops?: () => void;
};

// LDT-2 — the Stops tab is a read-only RECORD of what happened. Every editable field
// (Type, Address, City, ST, ZIP, windows, signature/photo, lumper, contact, dock) is
// edited in the Book Load wizard §C — never inline here (guard: no text fields in this body).

const DASH = "—";

function fmtMiles(v: number | null | undefined): string {
  // Unknown miles are a dash, never 0.0 — a real 0.0 would be a wrong claim (guard).
  if (v == null) return DASH;
  return v.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

function fmtTs(ts: string | null | undefined): string {
  if (!ts) return DASH;
  return new Date(ts).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtDuration(minutes: number | null | undefined): string {
  if (minutes == null || minutes < 0) return DASH;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}

function stopTypeLabel(t: string): string {
  if (t === "pickup") return "Pickup";
  if (t === "delivery") return "Delivery";
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function appointmentText(stop: StopsRecordStop): string {
  if (stop.appointment_start_at) {
    const start = fmtTs(stop.appointment_start_at);
    if (stop.appointment_end_at) return `${start} – ${fmtTs(stop.appointment_end_at)}`;
    return start;
  }
  if (stop.scheduled_arrival_at) return fmtTs(stop.scheduled_arrival_at);
  return DASH;
}

function locationText(stop: StopsRecordStop): string {
  const parts = [stop.address_line1, stop.city, stop.state, stop.postal_code].filter(Boolean);
  return parts.length ? parts.join(", ") : DASH;
}

// DSP-49 — "no appointment on file" gap, same definition as scripts/report-loads-missing-appointments.mjs:
// the REAL field (appointment_start_at) on the first pickup and last delivery, not the scheduled_arrival_at
// fallback appointmentText() displays. A load can carry a rough scheduled_arrival_at and still be missing the
// real appointment window the Round Trips timeline and tour readout position on.
function missingRequiredAppointments(stops: StopsRecordStop[]): Array<{ label: string; sequence: number }> {
  const pickups = stops.filter((s) => s.stop_type === "pickup").sort((a, b) => a.sequence - b.sequence);
  const deliveries = stops.filter((s) => s.stop_type === "delivery").sort((a, b) => a.sequence - b.sequence);
  const firstPickup = pickups[0];
  const lastDelivery = deliveries[deliveries.length - 1];
  const missing: Array<{ label: string; sequence: number }> = [];
  if (firstPickup && !firstPickup.appointment_start_at) {
    missing.push({ label: "pickup", sequence: firstPickup.sequence });
  }
  if (lastDelivery && !lastDelivery.appointment_start_at) {
    missing.push({ label: "delivery", sequence: lastDelivery.sequence });
  }
  return missing;
}

// Every box is a drill-down pop-up (owner: "i want all those to pop up just like here when we click").
function StopsPopup({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
      role="dialog"
      aria-modal="true"
      data-testid="stops-record-popup"
      onClick={onClose}
    >
      <div
        className="max-h-[80vh] w-full max-w-lg overflow-auto rounded-sm border border-gray-200 bg-white p-4 text-xs shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-2 flex items-center justify-between">
          <div className="text-xs font-semibold text-[#0F1219]">{title}</div>
          <button type="button" className="text-gray-400 hover:text-gray-700" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function legsForDisplay(data: StopsRecordResponse): StopsRecordLeg[] {
  const { legs, load } = data;
  if (legs.length > 0) return legs;
  return [
    { leg_index: 0, leg_kind: "deadhead_to_pickup", from_label: "Yard", to_label: "Pickup (deadhead, this load picks up)", practical_miles: load.miles_deadhead, short_miles: null, real_miles: null, google_reference_miles: null },
    { leg_index: 1, leg_kind: "loaded", from_label: "Pickup", to_label: "Delivery", practical_miles: load.miles_practical, short_miles: load.miles_shortest, real_miles: null, google_reference_miles: null },
  ];
}
const sum = (xs: Array<number | null>): number | null => (xs.every((x) => x == null) ? null : xs.reduce<number>((n, x) => n + (x ?? 0), 0));
const four = (a: number | null, b: number | null, c: number | null, d: number | null) => `${fmtMiles(a)} · ${fmtMiles(b)} · ${fmtMiles(c)} · ${fmtMiles(d)}`;

/** § Stops design: two inline cards + the source note. */
function StopsDesignCards({ data }: { data: StopsRecordResponse }) {
  const legs = legsForDisplay(data);
  const { stops, events, geofence_event_count } = data;
  const geocoded = stops.filter((s) => !s.geocode_missing).length;
  const timeline: Array<{ at: string | null; tone: "ok" | "warn" | "off"; text: string }> = [];
  if (events.length > 0) {
    for (const e of events) {
      const kind = e.event_kind === "entered" ? "Entered" : e.event_kind === "exited" ? "Exited" : e.event_kind;
      timeline.push({ at: e.occurred_at, tone: e.event_kind === "exited" ? "warn" : "ok", text: `${kind}${e.sequence != null ? ` stop #${e.sequence} fence` : " fence"} · source ${e.source}` });
    }
  } else {
    for (const st of [...stops].sort((x, y) => x.sequence - y.sequence)) {
      const label = stopTypeLabel(st.stop_type).toLowerCase();
      if (st.arrived_at) timeline.push({ at: st.arrived_at, tone: "ok", text: `Arrived ${label} — source ${st.source}${st.geocode_missing ? " (no fence: stop not geocoded)" : ""}` });
      if (st.departed_at) timeline.push({ at: st.departed_at, tone: "warn", text: `Departed ${label} — source ${st.source}` });
      if (!st.arrived_at) timeline.push({ at: null, tone: "off", text: `${stopTypeLabel(st.stop_type)} fence not yet entered` });
    }
  }
  const noOdometer = legs.every((l) => l.real_miles == null);
  return (
    <>
      <div className="ldt-grid2" data-testid="stops-design-cards">
        <section className="ldt-card" data-testid="stops-record-legs">
          <div className="ldt-ch"><span>Leg miles</span><span className="ldt-sub">practical · short · real · google ref</span></div>
          <div className="ldt-rows">
            {legs.map((l) => (
              <div key={l.leg_index} className="ldt-row" data-testid="stops-record-leg-row">
                <span>{l.from_label} → {l.to_label}</span>
                <span className="ldt-k">{four(l.practical_miles, l.short_miles, l.real_miles, l.google_reference_miles)}</span>
              </div>
            ))}
            <div className="ldt-row tot" data-testid="stops-leg-miles-total">
              <span>Total{data.load.miles_deadhead != null && legs.length === 1 ? <span className="ldt-muted"> deadhead {fmtMiles(data.load.miles_deadhead)} stored on load, not on a leg</span> : null}</span>
              <span className="ldt-k">{four(sum(legs.map((l) => l.practical_miles)), sum(legs.map((l) => l.short_miles)), sum(legs.map((l) => l.real_miles)), sum(legs.map((l) => l.google_reference_miles)))}</span>
            </div>
          </div>
        </section>
        <section className="ldt-card" data-testid="stops-record-events">
          <div className="ldt-ch"><span>Arrival &amp; departure events</span><span className="ldt-sub">geo.geofence_events</span></div>
          <div className="ldt-rows">
            {timeline.map((t, i) => (
              <div key={i} className="ldt-row" data-testid="stops-record-event-row" style={{ gridTemplateColumns: "72px 14px 1fr" }}>
                <span className="ldt-k ldt-muted">{t.at ? fmtTs(t.at) : DASH}</span>
                <span aria-hidden="true" style={{ display: "inline-block", width: 9, height: 9, borderRadius: 9, marginTop: 4, background: t.tone === "ok" ? "var(--ldt-accent)" : t.tone === "warn" ? "var(--ldt-warn)" : "var(--ldt-rule)" }} />
                <span>{t.text}</span>
              </div>
            ))}
            {noOdometer ? (
              <div className="ldt-row" data-testid="stops-no-odometer" style={{ gridTemplateColumns: "72px 14px 1fr" }}>
                <span className="ldt-k ldt-muted">{DASH}</span>
                <span aria-hidden="true" style={{ display: "inline-block", width: 9, height: 9, borderRadius: 9, marginTop: 4, background: "var(--ldt-rule)" }} />
                <span className="ldt-muted">No odometer captured — real driven miles unavailable for this load ({geofence_event_count} fence events · {geocoded} of {stops.length} stops geocoded)</span>
              </div>
            ) : null}
          </div>
        </section>
      </div>
      <div className="ldt-note" data-testid="stops-source-note">
        Every value here is read from planned stops, geofence arrival events, real odometer readings and leg mileage. Nothing on this tab is typed. Editing goes back to the wizard.
      </div>
    </>
  );
}

function StopDetailPopup({ stop, onClose }: { stop: StopsRecordStop; onClose: () => void }) {
  const rows: Array<[string, string]> = [
    ["Type", stopTypeLabel(stop.stop_type)],
    ["Location", locationText(stop)],
    ["Appointment", appointmentText(stop)],
    ["Arrived", fmtTs(stop.arrived_at)],
    ["Departed", fmtTs(stop.departed_at)],
    ["Dwell", fmtDuration(stop.dwell_minutes)],
    ["Free time", fmtDuration(stop.free_time_minutes)],
    ["Detention", stop.detention_minutes > 0 ? fmtDuration(stop.detention_minutes) : "None"],
    ["Source", stop.source],
    ["Contact", stop.contact_name ?? DASH],
    ["Dock / gate", stop.gate_dock_text ?? DASH],
    ["Signature", stop.signature_required ? "Required" : "Not required"],
    ["Photo", stop.photo_required ? "Required" : "Not required"],
    [
      "Lumper",
      stop.lumper_required
        ? stop.lumper_amount_cents != null
          ? `Required · $${(stop.lumper_amount_cents / 100).toFixed(2)}`
          : "Required"
        : "No",
    ],
    ["Documents", `${stop.doc_count}`],
  ];
  return (
    <StopsPopup title={`Stop #${stop.sequence} · ${stopTypeLabel(stop.stop_type)}`} onClose={onClose}>
      <div className="ldt-rows" data-testid="stops-record-detail-rows">
        {rows.map(([k, v]) => (
          <div key={k} className="ldt-row grid grid-cols-2 border-b border-gray-100 px-2 py-1">
            <span className="text-gray-500">{k}</span>
            <span className="text-right text-gray-800">{v}</span>
          </div>
        ))}
      </div>
      {stop.geocode_missing ? (
        <p className="mt-2 text-xs text-[#93301f]">
          No coordinates on file — no arrival fence can fire. Use “Geocode missing” on the tab to run the address
          geocoder; coordinates are never entered by hand.
        </p>
      ) : null}
    </StopsPopup>
  );
}

export function LoadStopsRecordTab({ loadId, operatingCompanyId, onEditStops }: Props) {
  const queryClient = useQueryClient();
  const [openStop, setOpenStop] = useState<StopsRecordStop | null>(null);

  const query = useQuery({
    queryKey: ["load-stops-record", loadId, operatingCompanyId],
    queryFn: () => getLoadStopsRecord(loadId, operatingCompanyId),
  });

  // LDT-D shared read — BOL/POD chips come from the SAME rows as the Documents tab
  // and the Factoring packet (useLoadDocuments). Never a separate docs fetch.
  const { packetDocuments } = useLoadDocuments({
    operatingCompanyId,
    loadId,
    enabled: Boolean(loadId && operatingCompanyId),
  });

  const geocodeMutation = useMutation({
    mutationFn: () => geocodeDispatchLoadStops(loadId, operatingCompanyId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["load-stops-record", loadId, operatingCompanyId] });
    },
  });

  if (query.isLoading) {
    return <div className="py-8 text-center text-xs text-gray-500">Loading stops record…</div>;
  }

  if (query.error) {
    return (
      <div className="space-y-2 rounded-sm border border-slate-200 bg-slate-50 p-4 text-xs text-slate-700" role="alert">
        <div>Couldn’t load the stops record.</div>
        <Button type="button" size="sm" variant="secondary" onClick={() => void query.refetch()}>
          Retry
        </Button>
      </div>
    );
  }

  const data = query.data;
  const stops: StopsRecordStop[] = data?.stops ?? [];
  const anyGeocodeMissing = stops.some((s) => s.geocode_missing);
  const missingAppointments = missingRequiredAppointments(stops);
  const stopColumns: Array<ParityColumn<StopsRecordStop>> = [
    { key: "sequence", label: "#" },
    { key: "stop_type", label: "Type", render: (stop) => stopTypeLabel(stop.stop_type) },
    { key: "location", label: "Location", render: (stop) => <>{locationText(stop)}{stop.geocode_missing ? <span className="ml-1 inline-flex rounded-sm bg-[#f6e3df] px-1.5 py-0.5 text-xs font-medium text-[#93301f]">Geocode missing</span> : null}</> },
    { key: "appointment", label: "Appt window", render: appointmentText },
    { key: "arrived_at", label: "Arrived", render: (stop) => fmtTs(stop.arrived_at), cellClass: "tabular-nums" },
    { key: "departed_at", label: "Departed", render: (stop) => fmtTs(stop.departed_at), cellClass: "tabular-nums" },
    { key: "dwell_minutes", label: "Dwell", render: (stop) => fmtDuration(stop.dwell_minutes), cellClass: "tabular-nums" },
    { key: "detention_minutes", label: "Detention", render: (stop) => stop.detention_minutes > 0 ? <span className="text-[#93301f]">{fmtDuration(stop.detention_minutes)}</span> : DASH, cellClass: "tabular-nums" },
    { key: "source", label: "Source" },
    { key: "doc_count", label: "Docs", render: (stop) => (
      // LDT-D shared read — BOL/POD chips from useLoadDocuments (same rows as
      // Documents tab + Factoring packet). Pickup → BOL chip; Delivery → POD chip.
      <div className="flex flex-wrap gap-1" data-testid="stops-record-docs-chips">
        {stop.stop_type === "pickup" ? (
          <span className={`inline-flex items-center rounded-sm border px-1.5 py-0.5 text-xs font-medium ${packetDocuments.bol ? "border-gray-300 bg-gray-50 text-gray-700" : "border-gray-200 text-gray-400"}`} data-testid="stops-record-bol-chip">
            BOL
          </span>
        ) : null}
        {stop.stop_type === "delivery" ? (
          <span className={`inline-flex items-center rounded-sm border px-1.5 py-0.5 text-xs font-medium ${packetDocuments.pod ? "border-gray-300 bg-gray-50 text-gray-700" : "border-gray-200 text-gray-400"}`} data-testid="stops-record-pod-chip">
            POD
          </span>
        ) : null}
        <span className="tabular-nums text-gray-500">{stop.doc_count}</span>
      </div>
    ) },
  ];

  return (
    <div className="space-y-3" data-testid="stops-record">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs uppercase tracking-wide text-[#4B5563]">Stops — what happened</div>
        <div className="flex items-center gap-2">
          {anyGeocodeMissing ? (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              data-testid="stop-geocode-missing"
              disabled={geocodeMutation.isPending}
              onClick={() => geocodeMutation.mutate()}
            >
              {geocodeMutation.isPending ? "Geocoding…" : "Geocode missing"}
            </Button>
          ) : null}
          {onEditStops ? (
            <Button type="button" size="sm" variant="secondary" data-testid="stops-record-edit" onClick={onEditStops}>
              Edit stops
            </Button>
          ) : null}
        </div>
      </div>

      {missingAppointments.length > 0 ? (
        <div
          className="flex flex-wrap items-center justify-between gap-2 rounded-sm border border-[#f6e3df] bg-[#f6e3df] px-2 py-1.5 text-xs text-[#93301f]"
          data-testid="stops-record-appointment-missing"
          role="alert"
        >
          <span>
            No appointment on file —{" "}
            {missingAppointments
              .map((m) => `${m.label} #${m.sequence}`)
              .join(" and ")}{" "}
            {missingAppointments.length > 1 ? "have" : "has"} no appointment window recorded.
          </span>
          {onEditStops ? (
            <button
              type="button"
              className="font-semibold underline hover:no-underline"
              data-testid="stops-record-appointment-missing-edit"
              onClick={onEditStops}
            >
              Edit stops
            </button>
          ) : null}
        </div>
      ) : null}

      {stops.length === 0 ? (
        <div className="rounded-sm border border-gray-200 bg-gray-50 p-4 text-center text-xs text-gray-500">
          No stops found.
        </div>
      ) : (
        <div data-testid="stops-record-table"><ParityTable rows={stops} columns={stopColumns} rowKey={(stop) => stop.stop_id} onRowClick={setOpenStop} rowTestId={() => "stops-record-row"} storageKey="load-stops-record" minWidthPx={900} suppressToolbarSearch suppressToolbarRange initialPageSize={25} /></div>
      )}

      {geocodeMutation.isError ? (
        <div className="rounded-sm border border-[#f6e3df] bg-[#f6e3df] px-2 py-1 text-xs text-[#93301f]">
          Geocode failed — {String((geocodeMutation.error as Error)?.message ?? "try again")}.
        </div>
      ) : null}
      {geocodeMutation.data ? (
        <div className="rounded-sm border border-gray-200 bg-gray-50 px-2 py-1 text-xs text-gray-600">
          Geocoded {geocodeMutation.data.stops_geocoded} of {geocodeMutation.data.stops_checked} stops
          {geocodeMutation.data.stops_geocode_failed > 0 ? ` · ${geocodeMutation.data.stops_geocode_failed} failed` : ""}.
        </div>
      ) : null}

      {/* LDT-2 DESIGN (owner 2026-09-06 04:2xZ "THE DESIGN … I WANT ALL THE SHIT IN THESE PICTURES"): the approved render
          (LOAD-DETAIL-TABS-RENDERS-2026-09-05.html § Stops) shows LEG MILES and ARRIVAL & DEPARTURE EVENTS as two INLINE
          cards — every leg row with practical · short · real · google ref, the fence/driver/manual events as a timeline —
          not two one-line buttons hiding the data behind a pop-up. Every value is read from the planned stop record (planned),
          geofence events (actual), telematics odometer (real) and stop legs (miles). Nothing typed here. */}
      {data ? <StopsDesignCards data={data} /> : null}

      {openStop ? <StopDetailPopup stop={openStop} onClose={() => setOpenStop(null)} /> : null}
    </div>
  );
}
