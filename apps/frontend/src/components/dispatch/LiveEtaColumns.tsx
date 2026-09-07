import type { DispatchLoadRow } from "../../api/loads";
import { FreshnessIndicator } from "./FreshnessIndicator";
import { formatClockTimeCT } from "../../lib/businessDate";

const LIFECYCLE_LABEL: Record<string, string> = {
  pretrip: "Pretrip",
  enroute_pu: "Enroute PU",
  at_shipper: "At Shipper",
  loading: "Loading",
  loaded: "Loaded",
  enroute_del: "Enroute DEL",
  at_receiver: "At Receiver",
  unloading: "Unloading",
  unloaded: "Unloaded",
  detention: "Detention",
  hos_break: "HOS Break",
  off_duty: "Off Duty",
  accident: "Accident",
  breakdown: "Breakdown",
  no_gps: "No GPS",
};

function pwaPingLabel(lastPingAt: string | null): string {
  if (!lastPingAt) return "No ping";
  const ageMs = Date.now() - Date.parse(lastPingAt);
  if (Number.isNaN(ageMs)) return "No ping";
  if (ageMs <= 5 * 60_000) return "Online";
  if (ageMs <= 30 * 60_000) return "Recent";
  if (ageMs <= 2 * 60 * 60_000) return "Stale";
  return "Offline";
}

function pwaPingClass(lastPingAt: string | null): string {
  const label = pwaPingLabel(lastPingAt);
  if (label === "Online") return "bg-slate-100 text-slate-700";
  if (label === "Recent") return "bg-slate-100 text-slate-700";
  if (label === "Stale") return "bg-slate-100 text-slate-700";
  return "bg-gray-100 text-gray-600";
}

function formatEtaTime(etaAt: string | null): string {
  if (!etaAt) return "—";
  // Central Time (CLAUDE.md §8 "Central Time always") — never the dispatcher's browser zone.
  const formatted = formatClockTimeCT(etaAt);
  return formatted || "—";
}

function onTimeClass(prediction: DispatchLoadRow["on_time_prediction"]): string {
  if (prediction === "green") return "bg-slate-100 text-slate-700";
  if (prediction === "amber") return "bg-slate-100 text-slate-700";
  if (prediction === "red") return "bg-red-100 text-red-800";
  return "bg-gray-100 text-gray-500";
}

function onTimeLabel(prediction: DispatchLoadRow["on_time_prediction"]): string {
  if (prediction === "green") return "On time";
  if (prediction === "amber") return "At risk";
  if (prediction === "red") return "Late";
  return "Unknown";
}

function sourceGlyph(source: DispatchLoadRow["samsara_eta_source"]): string {
  if (source === "samsara") return "◉";
  if (source === "manual") return "✎";
  if (source === "prediction") return "◎";
  return "◌";
}

export function DriverStatusColumn({ load }: { load: DispatchLoadRow }) {
  const lifecycle = load.driver_lifecycle_stage ?? "off_duty";
  const pingLabel = pwaPingLabel(load.driver_pwa_last_ping_at ?? null);

  return (
    <div className="inline-flex flex-nowrap items-center gap-1 whitespace-nowrap" data-testid="driver-status-column">
      <span className="rounded-full border border-slate-300 bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">
        {LIFECYCLE_LABEL[lifecycle] ?? lifecycle.replaceAll("_", " ")}
      </span>
      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${pwaPingClass(load.driver_pwa_last_ping_at ?? null)}`}>
        {pingLabel}
      </span>
    </div>
  );
}

export function SamsaraEtaColumn({ load }: { load: DispatchLoadRow }) {
  const etaAt = load.samsara_eta_at ?? null;
  if (!etaAt) {
    return <span className="text-[11px] text-gray-400" data-testid="samsara-eta-column">—</span>;
  }

  return (
    <span
      className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-800"
      title={`ETA source: ${load.samsara_eta_source ?? "unknown"}`}
      data-testid="samsara-eta-column"
    >
      <span aria-hidden>{sourceGlyph(load.samsara_eta_source ?? null)}</span>
      <span>ETA {formatEtaTime(etaAt)}</span>
    </span>
  );
}

export function OnTimePredictionColumn({ load }: { load: DispatchLoadRow }) {
  const prediction = load.on_time_prediction ?? null;
  // DSP-19 (owner 2026-09-04): "IF ON ANY COLUMN THERE IS NO DATA … PUT LINE NOT TEXT." No
  // prediction was rendered as an "Unknown" pill — that reads as a real status and "looks too
  // dirty." Render the empty-cell dash instead; a real green/amber/red still shows its pill.
  if (prediction === null) {
    return (
      <span className="text-gray-400" data-testid="on-time-prediction-column" aria-label="No on-time prediction">—</span>
    );
  }
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-semibold ${onTimeClass(prediction)}`}
      data-testid="on-time-prediction-column"
    >
      {onTimeLabel(prediction)}
    </span>
  );
}

export function LiveEtaFreshnessColumn({ load }: { load: DispatchLoadRow }) {
  return (
    <FreshnessIndicator
      lastFetchedAt={load.samsara_last_fetched_at ?? null}
      cacheTier={load.samsara_cache_tier ?? null}
    />
  );
}
