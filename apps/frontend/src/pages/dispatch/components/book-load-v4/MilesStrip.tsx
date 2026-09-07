import type { LaneMileageFillConfidence } from "../../../../api/dispatch";

type Props = {
  practical?: number | null;
  shortest?: number | null;
  deadhead?: number | null;
  /** Linehaul divided by practical miles. Not the customer invoice basis. */
  ratePerMile?: number;
  /** Operator-facing fill label from the lane lookup (or "Operator entered"). */
  provenance?: string;
  /** Drives warning chrome. check_zip must stay visible — those miles feed pay. */
  fillConfidence?: LaneMileageFillConfidence | "operator";
  onPracticalChange?: { (n: number | null): void };
  onShortestChange?: { (n: number | null): void };
  onDeadheadChange?: { (n: number | null): void };
  shortestRequired?: boolean;
  practicalRequired?: boolean;
  /** MILES-INVERT-01 — inline flag when catalog short > practical. */
  milesColumnInverted?: boolean;
  /** Reverse-lane short miles differ by >100mi (catalog trigger). */
  reverseLaneShortDiff?: boolean;
  /** P0 State B — Thin lane: history + Use, never silent fill. */
  historyOffer?: { runs: number; median: number; spread: number | null } | null;
  onUseHistoryMiles?: { (): void };
  /** P0 State C */
  newLane?: boolean;
  /** DSP-48 (owner ruling 2026-09-05, "Google distance = REFERENCE ONLY"): a car-routing
   *  distance/time for comparison against the typed Practical miles above — grey, read-only,
   *  NEVER editable and NEVER copied into any miles input (LAW §2). null/undefined = not
   *  computed yet (no coordinates, provider not configured, or still loading). */
  googleReferencePractical?: { miles: number; minutes: number } | null;
  /** LDT-1 (owner ruling 2026-09-05): Google car-routing reference for the EMPTY leg —
   *  yard → pickup — grey, read-only, NEVER editable and NEVER copied into Empty miles (LAW §2).
   *  null/undefined = not computed (no coordinates, provider off, or still loading). */
  googleReferenceEmpty?: { miles: number; minutes: number } | null;
};

function numFromInput(raw: string): number | null {
  const t = raw.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) && !(n < 0) ? n : null;
}

function formatMiles(n: number | null | undefined): string {
  return n != null && Number.isFinite(n) && !(n <= 0) ? n.toLocaleString(undefined, { maximumFractionDigits: 1 }) : "";
}

function inputValue(n: number | null | undefined): string {
  return n != null && Number.isFinite(n) && !(n <= 0) ? String(n) : "";
}

/** "18 h 40 m" — DSP-48's own example format. */
function formatDuration(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours} h ${minutes} m` : `${minutes} m`;
}

function provenanceClass(fillConfidence?: LaneMileageFillConfidence | "operator"): string {
  switch (fillConfidence) {
    case "check_zip":
      // §7 slate only (no amber). Weight + border make ZIP mismatch louder than a quiet History fill.
      return "border-t border-slate-400 bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-900";
    case "verify":
    case "reverse":
      return "border-t border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-600";
    case "operator":
      return "border-t border-slate-200 px-2 py-1 text-xs text-slate-700";
    default:
      return "border-t border-slate-200 px-2 py-1 text-xs text-slate-600";
  }
}

/**
 * Practical miles drive revenue per mile (typed linehaul / practical).
 * Short miles drive driver pay. Empty miles are deadhead into the pickup.
 * Operator labels are English words only (owner 2026-09-01). Column names stay on the wire.
 * GO-16 Rev C / CC-3: provenance under the boxes; Check ZIP stays bold and visible (§7 slate).
 */
export function MilesStrip({
  practical,
  shortest,
  deadhead,
  ratePerMile = 0,
  provenance,
  fillConfidence,
  onPracticalChange,
  onShortestChange,
  onDeadheadChange,
  shortestRequired = false,
  practicalRequired = false,
  milesColumnInverted = false,
  reverseLaneShortDiff = false,
  historyOffer = null,
  onUseHistoryMiles,
  newLane = false,
  googleReferencePractical = null,
  googleReferenceEmpty = null,
}: Props) {
  // fillConfidence drives chrome; provenance is the operator sentence.
  const cell = "flex flex-1 flex-col items-center justify-center border-r border-slate-200 px-2 py-2 text-center last:border-r-0";
  const editable = Boolean(onPracticalChange && onShortestChange);
  const laneState = newLane ? "new" : historyOffer ? "thin" : fillConfidence && fillConfidence !== "operator" ? "high" : null;
  return (
    <div className="rounded-sm border border-slate-200 bg-white" data-testid="book-load-miles-strip">
      {laneState === "high" ? (
        <p className="border-b border-slate-200 px-2 py-1 text-xs text-slate-800" data-testid="book-load-miles-state-high">
          High — filled from history. Source shown under the boxes. You can still type over it.
        </p>
      ) : null}
      {laneState === "thin" ? (
        <p className="border-b border-slate-300 bg-slate-50 px-2 py-1 text-xs text-slate-800" data-testid="book-load-miles-state-thin">
          Thin — boxes stay empty. History (runs / median / spread) is below. Use only if you accept it.
        </p>
      ) : null}
      {laneState === "new" ? (
        <p className="border-b border-slate-200 px-2 py-1 text-xs text-slate-800" data-testid="book-load-miles-state-new">
          New — no history. Type practical miles. Nothing is filled.
        </p>
      ) : null}
      <div className="flex text-xs font-semibold tracking-wide text-slate-700">
        <div className={cell}>
          <label className="text-slate-600" htmlFor="book-miles-practical">
            Practical (long){practicalRequired ? " *" : ""}
          </label>
          {editable ? (
            <input
              id="book-miles-practical"
              data-testid="book-miles-practical"
              type="number"
              min={0}
              step={0.1}
              required={practicalRequired}
              className={`mt-1 w-full max-w-[7rem] rounded-sm border px-1.5 py-1 font-mono text-xs ${
                practicalRequired ? "border-slate-400 text-slate-900" : "border-slate-300 text-slate-900"
              }`}
              value={inputValue(practical)}
              onChange={(e) => onPracticalChange?.(numFromInput(e.target.value))}
            />
          ) : (
            <div className="font-mono text-xs text-slate-900">{formatMiles(practical)}</div>
          )}
          <div className="text-xs font-normal text-slate-500">revenue per mile</div>
        </div>
        <div className={`${cell} bg-slate-100`}>
          <label className="text-slate-700" htmlFor="book-miles-shortest">
            Shortest{shortestRequired ? " *" : ""}
          </label>
          {editable ? (
            <input
              id="book-miles-shortest"
              data-testid="book-miles-shortest"
              type="number"
              min={0}
              step={0.1}
              required={shortestRequired}
              className={`mt-1 w-full max-w-[7rem] rounded-sm border px-1.5 py-1 font-mono text-xs ${
                shortestRequired ? "border-slate-400 text-slate-900" : "border-slate-300 text-slate-900"
              }`}
              value={inputValue(shortest)}
              onChange={(e) => onShortestChange?.(numFromInput(e.target.value))}
            />
          ) : (
            <div className="font-mono text-xs text-slate-700">{formatMiles(shortest)}</div>
          )}
          <div className="text-xs font-normal text-slate-700">driver pay</div>
        </div>
        <div className={cell}>
          <label className="text-slate-600" htmlFor="book-miles-deadhead">
            Empty miles
          </label>
          {editable ? (
            <input
              id="book-miles-deadhead"
              data-testid="book-miles-deadhead"
              type="number"
              min={0}
              step={0.1}
              className="mt-1 w-full max-w-[7rem] rounded-sm border border-slate-300 px-1.5 py-1 font-mono text-xs text-slate-900"
              value={inputValue(deadhead)}
              onChange={(e) => onDeadheadChange?.(numFromInput(e.target.value))}
            />
          ) : (
            <div className="font-mono text-xs text-slate-900">{formatMiles(deadhead)}</div>
          )}
          <div className="text-xs font-normal text-slate-500">deadhead to pickup</div>
        </div>
        <div className={cell}>
          <div className="text-slate-600">Revenue per mile</div>
          <div className="font-mono text-xs text-slate-900">{!(ratePerMile <= 0) ? `$${ratePerMile.toFixed(3)}` : ""}</div>
        </div>
      </div>
      {historyOffer ? (
        <p className="border-t border-slate-300 bg-slate-50 px-2 py-1 text-xs text-slate-800" data-testid="book-load-lane-history">
          Seen {historyOffer.runs} times · median {historyOffer.median.toLocaleString(undefined, { maximumFractionDigits: 1 })} mi
          {historyOffer.spread != null
            ? ` · spread ${historyOffer.spread.toLocaleString(undefined, { maximumFractionDigits: 1 })}`
            : ""}{" "}
          {onUseHistoryMiles ? (
            <button
              type="button"
              data-testid="book-load-lane-history-use"
              onClick={onUseHistoryMiles}
              className="ml-2 rounded-sm border border-slate-400 bg-white px-2 py-0.5 text-xs font-semibold"
            >
              Use
            </button>
          ) : null}
        </p>
      ) : null}
      {newLane ? (
        <p className="border-t border-slate-200 px-2 py-1 text-xs text-slate-700" data-testid="book-load-lane-new">
          New lane — not in the history table. Type practical miles.
        </p>
      ) : null}
      {milesColumnInverted || reverseLaneShortDiff ? (
        <p
          className="border-t border-slate-400 bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-900"
          data-testid="book-load-miles-invert-flag"
        >
          {milesColumnInverted && reverseLaneShortDiff
            ? "Short miles exceed practical miles and the reverse lane's short miles differ by more than 100 — verify all three fields before you book."
            : milesColumnInverted
              ? "Short miles exceed practical miles on this lane — verify short miles before you book."
              : "Reverse-lane short miles differ by more than 100 on this road — verify short miles before you book."}
        </p>
      ) : null}
      {provenance ? (
        <p className={provenanceClass(fillConfidence)} data-testid="book-load-miles-provenance">
          {fillConfidence === "check_zip"
            ? `Filled from a lane whose ZIP does not match. Check these miles before you book. ${provenance}`
            : provenance}
        </p>
      ) : null}
      {googleReferencePractical ? (
        <p
          className="border-t border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-500"
          data-testid="book-load-google-reference-miles"
          title="Google car routing — reference only"
        >
          Google ref {googleReferencePractical.miles.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} mi ·{" "}
          {formatDuration(googleReferencePractical.minutes)}
        </p>
      ) : null}
      {googleReferenceEmpty ? (
        <p
          className="border-t border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-500"
          data-testid="book-load-google-reference-empty"
          title="Google car routing, yard to pickup — reference only"
        >
          Empty leg ref (yard → pickup){" "}
          {googleReferenceEmpty.miles.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} mi ·{" "}
          {formatDuration(googleReferenceEmpty.minutes)}
        </p>
      ) : null}
    </div>
  );
}
