// ROUND 16.1 (owner 2026-09-06 20:2xZ "THE LEGS, WHAT IS THAT, THE COLUMNS NEED TO AUTO ADJUST … WE
// CANNOT HAVE A COLUMN OCCUPY ALL SCREEN, BE LOGICAL"). The tour register's Legs cell used to be one
// long wrapping string ("7 · NB 13519 → NB 13550 → …") that blew a row up to 265px tall. This shared
// cell renders ONE nowrap line: a count pill first ("7 legs"), then each leg as a compact
// type-colored pill (NB accent-soft · TR rule2 · SB warn-soft · LOCAL muted) that is an EntityLink to
// the load; the overflow collapses to a "+N more" pill whose title lists every leg in order. Used by
// BOTH the Load-Costs Settlement/Pre-Settlement register and the /settlements Tours register so the
// two surfaces stay identical.
import { EntityLink } from "../shared/EntityLink";
import type { TourLegBrief } from "../../api/tourReadout";

const DASH = "\u2014";

/** The Legs header explains itself (the owner asked "WHAT IS THAT"). */
export const LEGS_HEADER_TITLE =
  "Legs = the loads in this tour, in order: NB Laredo pickup · TR triangle · SB Laredo delivery · LOCAL Laredo→Laredo";

/** How many leg pills render before the rest collapse to "+N more". */
export const LEGS_VISIBLE = 4;

export function legPillClass(tripType: string | null): string {
  switch ((tripType ?? "").toUpperCase()) {
    case "NB":
      return "ldt-legpill nb";
    case "TR":
      return "ldt-legpill tr";
    case "SB":
      return "ldt-legpill sb";
    case "LOCAL":
      return "ldt-legpill local";
    default:
      return "ldt-legpill local";
  }
}

export function TourLegsCell({ legs, legsLabel }: { legs: TourLegBrief[] | null | undefined; legsLabel?: string }) {
  const list = legs ?? [];
  if (list.length === 0) return <span className="ldt-muted">{DASH}</span>;
  const shown = list.slice(0, LEGS_VISIBLE);
  const hidden = list.length - shown.length;
  const fullList = legsLabel ?? list.map((l) => `${l.trip_type ?? "?"} ${l.load_number}`).join(" → ");
  return (
    <span className="ldt-legs" data-testid="tour-legs-cell" title={fullList}>
      <span className="ldt-legcount" data-testid="tour-legs-count">
        {list.length} legs
      </span>
      {shown.map((l) => (
        <EntityLink
          key={l.load_id}
          kind="load"
          id={l.load_id}
          label={`${l.trip_type ?? "?"} ${l.load_number}`}
          className={legPillClass(l.trip_type)}
          title={`${l.trip_type ?? "?"} ${l.load_number}`}
        />
      ))}
      {hidden > 0 ? (
        <span className="ldt-legmore" data-testid="tour-legs-more" title={fullList}>
          +{hidden} more
        </span>
      ) : null}
    </span>
  );
}
