import { EntityLink } from "../shared/EntityLink";

export type LivePosition = {
  lat: number;
  lng: number;
  recorded_at: string;
  stale: boolean;
  speed_mph?: number | null;
};

export function LoadLivePositionCell({
  position,
  loadId,
  unavailable = false,
}: {
  position: LivePosition | null;
  loadId: string;
  unavailable?: boolean;
}) {
  if (unavailable) return <span className="text-xs font-semibold text-amber-700">Unavailable</span>;
  if (!position) return <span className="text-xs text-slate-400">No GPS</span>;
  return (
    <div className="inline-flex flex-nowrap items-center gap-x-2 whitespace-nowrap text-xs" data-testid="load-live-gps-cell">
      <span className={position.stale ? "font-semibold text-red-600" : "text-slate-700"}>
        {position.lat.toFixed(4)}, {position.lng.toFixed(4)}
      </span>
      <span className="text-slate-500">{new Date(position.recorded_at).toLocaleTimeString()}</span>
      <EntityLink kind="load_map" id={loadId} label="Map" className="text-[#1f2a44] underline" />
    </div>
  );
}
