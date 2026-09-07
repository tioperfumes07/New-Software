/**
 * ParityTable — shared QBO-parity table grammar (A1).
 *
 * Additive: a NEW shared component (does not modify the existing DataTable or
 * its usages). B1–B3 pages consume this. Non-financial UI only.
 *
 * Grammar (all optional props, default to a plain dense table):
 *  - sortable columns
 *  - density toggle: Regular / Compact / Ultra compact
 *  - gear popover: column show/hide checklist + density + "Save as default"
 *  - advanced pager: First/Prev + numbered pages + "Page [input] of N" + Next/Last
 *    + configurable per-page selector + "N–M of TOTAL"
 *  - optional select-all + per-row checkboxes → batch-actions bar
 *  - optional row 3-dots action menu
 *  - toolbar slot (Print / Export / etc.)
 */
import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type TouchEvent as ReactTouchEvent,
} from "react";
import { createPortal } from "react-dom";
import { colors, spacing, typography, MIN_HIT_TARGET_CLASS, TOOLBAR_ICON_SIZE_CLASS } from "../../design/tokens";
import { Button } from "../Button";
import { Settings as GearIcon } from "lucide-react";
import { UniversalListToolbar, applyUniversalListFilters, type UniversalRange } from "../table/UniversalListToolbar";

export type ParityDensity = "regular" | "compact" | "ultra";

export type ParityColumn<T> = {
  key: keyof T | string;
  label: string;
  /** Stable element-manifest hook for this header cell. */
  testId?: string;
  /** Default true (owner 2026-09-03). Set false only when a column must not sort. */
  sortable?: boolean;
  render?: (row: T) => ReactNode;
  className?: string;
  cellClass?: string;
  /** ROUND 16.25 (owner-reported row-height defect, live-confirmed root cause 2026-09-07):
   *  body cells truncate (nowrap + ellipsis) by default so one wrapped cell can't inflate an
   *  entire row's height. Set true ONLY for a column that legitimately needs multi-line text
   *  (a long description/reason/notes column) — it opts back into wrap-break-word. Default
   *  false/omitted = truncate, matching every existing column's actual data shape. */
  allowWrap?: boolean;
  /** Optional native tooltip on the header cell (ROUND 16.1) — lets a column explain itself
   *  (e.g. "Legs = the loads in this tour, in order …"). Additive: omit for no tooltip. */
  headerTitle?: string;
  /** Floor for the auto-fit measured width (never shrinks it, only widens) — a user manual
   *  drag-resize still overrides this completely, same as autoFitWidths always did. Additive:
   *  omitting it preserves today's pure-measured width for every existing column. */
  minWidth?: number;
  /** Ceiling for the auto-fit measured width (ROUND 16.1) — caps a column so one long value can't
   *  let it occupy the whole screen (the owner's Load-Costs "a column occupies all screen" report).
   *  Overrides the global AUTO_FIT_MAX_WIDTH for this column only. A user manual drag-resize still
   *  overrides it. Additive: omitting it preserves today's global-capped measured width. */
  maxWidth?: number;
  /** Initial hidden state in the gear column-toggle (still toggleable on). */
  defaultHidden?: boolean;
  /** Exclude from the gear column-toggle list (always shown). */
  alwaysVisible?: boolean;
  /**
   * Optional sort-value extractor for columns whose sort key isn't a plain `row[key]` lookup
   * (e.g. a computed/derived display column like a running balance). Default: `row[key]`.
   */
  sortValue?: (row: T) => string | number | null | undefined;
  /**
   * PARITY-EXPORT-COMPUTED-COLUMN-BLANK: `exportCsv` used to read `row[key]` directly, never
   * calling `render`. Any column whose value only exists through `render` — a computed field
   * with no matching row property (an HOS event's duration, a module's open-item count), or a
   * `_cents` integer formatted for display — exported blank or a raw, unit-less number under a
   * dollar-labeled header while the on-screen table looked complete. Same precedent as
   * `sortValue` above: an optional plain-text extractor for export, default `row[key]`.
   */
  exportValue?: (row: T) => string | number | null | undefined;
};

export type ParityTableProps<T> = {
  columns: Array<ParityColumn<T>>;
  rows: T[];
  rowKey: (row: T) => string;
  loading?: boolean;
  onRowClick?: (row: T) => void;
  /** Optional row-level context-menu handler (e.g. right-click quick actions). Additive — omitting it renders no listener. */
  onRowContextMenu?: (row: T, event: ReactMouseEvent<HTMLTableRowElement>) => void;
  /** Optional extra className per row (e.g. highlight the currently-open record). Additive — merged with the base row class. */
  rowClassName?: (row: T) => string;
  emptyText?: string;

  density?: ParityDensity;
  pageSizeOptions?: number[];
  /**
   * VC-LIST-02 (owner "ALL PAGE SIZE", 2026-09-06): append an "All" option to the page-size
   * control that renders every matching row on one page. Sort survives it (sorting runs on the
   * full row set before slicing, and "All" simply stops slicing). Off by default so existing
   * lists are unchanged.
   */
  allowAllPageSize?: boolean;
  initialPageSize?: number;
  /** localStorage key to persist column visibility + density + per-page. */
  storageKey?: string;

  /** Left-of-gear toolbar slot (Print / Export / More actions). */
  toolbar?: ReactNode;
  /** Header select-all + per-row checkboxes. */
  selectable?: boolean;
  /** Batch-actions bar content, shown when ≥1 row selected. */
  batchActions?: (selected: T[]) => ReactNode;
  /** Per-row 3-dots action menu content. */
  rowActions?: (row: T) => ReactNode;
  /** Max selectable rows at once (mirrors useBulkSelection's cap). Unset = unlimited. Additive. */
  maxSelectable?: number;
  /** Fired when a selection toggle/select-all-on-page would exceed maxSelectable; the toggle is a no-op in that case. */
  onSelectionCapExceeded?: (attempted: number) => void;
  /**
   * OPTIONAL controlled row selection (ParityTable Phase A5).
   * Omitting keeps today's internal Set selection for existing selectable call sites.
   * Presence of `onSelectionChange` = controlled mode: page owns `selectedKeys`;
   * checkbox / select-all toggles call `onSelectionChange(nextKeys)` and never mutate
   * internal selection state. `selectedKeys` is the source of truth when controlled.
   * Keys are row ids from `rowKey` / existing key extractor (match current selection keying).
   */
  selectedKeys?: string[];
  onSelectionChange?: (keys: string[]) => void;

  /** Filter toolbar slot (search + dropdowns), rendered above the table per the universal-list standard. */
  filterBar?: ReactNode;
  /**
   * When true, hide UniversalListToolbar TableSearch (page owns server-side search in filterBar).
   * Prevents competing client search over a single page of server results (LV-WORK-ORDERS-CONSOLE-DUPLICATE-SEARCH).
   */
  suppressToolbarSearch?: boolean;
  /** Hide the Range popover when the page already owns date/unit filters. */
  suppressToolbarRange?: boolean;
  /** When set, a ⤓ Export button appears that downloads the (sorted, visible-column) rows as CSV. */
  exportFilename?: string;
  /** Sticky header row on vertical scroll (universal-list standard). Default true. */
  stickyHeader?: boolean;
  /** Minimum table width in px. When set, the table never compresses below this inside the
   *  overflow-x-auto wrapper — wide multi-column boards (Load Costs, DESIGN-CONTRACT §14
   *  min-width:1660) scroll horizontally instead of squeezing columns to truncation. Opt-in;
   *  omitting it preserves the w-full behaviour every other table relies on. */
  minWidthPx?: number;
  /** Column sizing model. "fixed" (default) = table-layout:fixed, columns take their stored/auto-fit
   *  width — every existing list relies on this. "auto" = table-layout:auto, each column sizes to its
   *  own label + widest value (DESIGN-CONTRACT §14 for the Load Costs board: NO fixed layout, NO equal
   *  split); the auto-fit/resize width becomes a min-width floor rather than a hard width so content is
   *  never truncated. Opt-in per board. */
  columnLayout?: "fixed" | "auto";
  /** Drag-to-resize columns (widths persist with storageKey). Default true. */
  enableColumnResize?: boolean;
  /** Sticky-left the first N columns, in current visible order, on horizontal scroll
   *  (DESIGN-CONTRACT-DISPATCH-BOARD-2026-09-05 §14: "first four columns sticky-left"). Unset/0 =
   *  no sticky columns, every other table's existing behaviour is unchanged. */
  stickyLeftCount?: number;
  /** Per-instance outer-frame border color override (DESIGN-CONTRACT §14: "1px #C7D2DC outer
   *  frame"). Unset keeps today's plain gray-200 shell border on every other table. */
  frameColor?: string;
  /** Drag-a-header-to-move-it column reordering (order persists per storageKey, alongside width).
   * Default true — set false only for a table with a real reason columns must stay fixed (a
   * written reason, per COLUMN LAW). */
  enableColumnReorder?: boolean;
  /**
   * OPTIONAL controlled column order (COLUMN LAW 2026-09-01) — mirrors controlled sort / A5
   * selection. Omitting keeps internal `colOrder` persisted under storageKey. Presence of
   * `onColumnOrderChange` = controlled mode: page owns `columnOrder` (e.g. from useTablePref).
   */
  columnOrder?: string[];
  onColumnOrderChange?: (order: string[]) => void;
  /**
   * AUTO-FIT (COLUMN LAW 2026-09-01): size columns to header + cell content when no manual width
   * is persisted. Default true — set false only when a table has a real reason to stay fixed-width.
   */
  autoFitColumns?: boolean;
  /**
   * Optional per-row expandable detail. When provided, a ▸/▾ toggle column is prepended; clicking it
   * reveals renderExpanded(row) in a full-width detail row beneath the parent row. Additive — existing
   * consumers that omit it are unchanged.
   */
  renderExpanded?: (row: T) => ReactNode;
  /**
   * Optional data-testid for the outer table container. Lets a migrated page keep the test/e2e hook
   * that its former hand-rolled `<table>` carried. Additive — omitting it renders no testid.
   */
  tableTestId?: string;
  /**
   * Optional data-testid for the gear (column-chooser) button (DESIGN-CONTRACT-DISPATCH-BOARD
   * §A: `data-testid="dispatch-board-column-chooser"`). Additive — omitting it renders no testid;
   * the gear itself is always present regardless of this prop.
   */
  gearButtonTestId?: string;
  /**
   * BANK-TOOLBAR-ONE (owner ROUND 16.19, 2026-09-06): additional page-specific settings rendered
   * inside THIS gear's own popover, below "Columns" and above the Reset/Cancel/Apply footer — lets
   * a page fold its own extra settings (a forced-visible column toggle, a page-size the page itself
   * paginates by, a feature flag) into the ONE canonical gear instead of standing up a second,
   * competing "View settings" gear button next to it. Additive: omitting it renders nothing extra,
   * every existing consumer is byte-identical.
   */
  gearExtra?: ReactNode;
  /**
   * Optional per-row data-testid on the rendered `<tr>`. Lets a migrated page preserve existing
   * row-level test/e2e selectors. Additive — omitting it renders no per-row testid.
   */
  rowTestId?: (row: T) => string;
  /**
   * @deprecated DSP-TBL (owner ruling 2026-09-05, "totals stay stuck"): a raw ReactNode footer
   * is one hand-built `<tr>` the caller must keep in sync with column order/visibility by hand —
   * reorder or hide a column and the totals silently misalign with the header above them. Use
   * `footerCells` instead (keyed by column, follows the same ordered visible-column list the
   * header does). Kept for back-compat; still renders, but logs a dev-only console.warn once per
   * mount so a caller update is visible without a red build. Never delete (Rule 07).
   */
  footer?: ReactNode;
  /**
   * DSP-TBL (owner ruling 2026-09-05): per-column footer content, keyed by `column.key` (as a
   * string — same convention every other column-keyed lookup in this file uses). A value may be
   * a plain ReactNode or `(visibleRows: T[]) => ReactNode` when the total depends on the current
   * rows (sorted/filtered, pre-pagination — the same rows a "grand total" caption already summed
   * over in every existing caller). Rendered as one `<td>` per column in `visibleColumns`' own
   * order — reorder/hide the column and its footer cell moves/disappears with it, automatically.
   * Money/right-aligned columns inherit their own `cellClass`/`className` in the footer cell too,
   * so a numeric total right-aligns without a separate flag. A column with no entry renders an
   * empty `<td>` in its slot (never omitted — that would desync colSpan-free alignment).
   */
  footerCells?: Partial<Record<string, ReactNode | ((visibleRows: T[]) => ReactNode)>>;

  /**
   * OPTIONAL controlled-sort mode (BANK-SORT-ROLLOUT-ACCT). Omitting these three props keeps the
   * existing uncontrolled internal-state sort (unchanged default for the ~130 existing call
   * sites). Pass all three from a page that persists sort in the URL (see `useUrlSort`) — the
   * page owns sortKey/sortDirection and is notified via onSortChange on every header click;
   * ParityTable still performs the actual row sort (using each column's `sortValue` or a
   * `row[key]` default) so pages don't have to re-implement comparison logic.
   */
  sortKey?: string;
  sortDirection?: "asc" | "desc";
  onSortChange?: (key: string, direction: "asc" | "desc") => void;
  /**
   * OPTIONAL external-sort passthrough (ParityTable Phase A4).
   * Default "internal" (current behavior): when sortKey is set, ParityTable sorts rows itself.
   * "external": ParityTable NEVER reorders rows — it only paints the sort indicator from
   * sortKey/sortDirection and fires onSortChange on header clicks. Caller owns the order
   * (server-side sort, or a pre-sorted pipeline like bankTxnSortGroup's sort→group→page).
   * Only meaningful with controlled sort (onSortChange present) — external mode requires
   * controlled sort; if onSortChange is absent, "external" falls back to "internal" so an
   * uncontrolled table can never paint a sort state nobody applied.
   */
  sortMode?: "internal" | "external";

  /**
   * OPTIONAL controlled row-expansion (ParityTable Phase A1) — mirrors the controlled-sort
   * precedent above. Omitting these props keeps the existing uncontrolled multi-expand via the
   * internal `expanded` Set (unchanged default for the ~130 existing call sites). Presence of
   * `onExpandedChange` = controlled mode (mirrors `isSortControlled = onSortChange != null`):
   * the page owns `expandedKeys` and is notified via `onExpandedChange` on every ▸/▾ toggle.
   * Only meaningful when `renderExpanded` is provided (as today).
   */
  expandedKeys?: string[];
  onExpandedChange?: (keys: string[]) => void;
  /**
   * "multi" (default, current behavior) keeps every expanded row open; "single" collapses any
   * other row when one expands. Applies in both controlled and uncontrolled modes.
   */
  expandMode?: "multi" | "single";
  /**
   * LDT-EXPAND (owner 2026-09-06 03:5xZ "I DO NOT SEE THE APP LIKE THE PICTURES … THE BOXES"): the only expand
   * target was the 6px "▸" glyph, so clicking the row did nothing. When true, a click anywhere on the row
   * (outside links / buttons / inputs) toggles the expanded panel. Ignored when onRowClick is supplied.
   */
  expandOnRowClick?: boolean;

  /**
   * OPTIONAL QBO-style group bands (ParityTable Phase A2). Omitting keeps byte-identical current
   * behavior for the ~130 existing call sites. When provided, the CURRENT page's rows are grouped
   * in their CURRENT order by getKey (stable — never re-sorted), and each group is preceded by one
   * full-width band <tr> (colSpan across all rendered columns) produced by renderHeader. Bands are
   * computed over the current page only — pagination math is unchanged. Collapse follows the
   * controlled-sort / A1 controlled-expansion precedents: presence of onCollapsedChange = controlled
   * mode (caller owns collapsedKeys); otherwise an internal Set drives uncontrolled collapse.
   */
  groupBy?: {
    /** Stable group key per row; rows keep their current order (no re-sort). */
    getKey: (row: T) => string;
    /** Full-width band row rendered above each group (spans all rendered columns). */
    renderHeader: (key: string, rows: T[]) => ReactNode;
    /** Band gets a ▸/▾ chevron toggle; collapsed groups hide their rows. Default false. */
    collapsible?: boolean;
    /** Controlled collapse — only meaningful with onCollapsedChange (mirrors expandedKeys). */
    collapsedKeys?: string[];
    /** Presence = controlled mode (mirrors onExpandedChange / onSortChange). */
    onCollapsedChange?: (keys: string[]) => void;
    /**
     * LB-DESIGN-1: fixed band order; keys listed here render a band even with ZERO rows on the page (the approved
     * Dispatch board shows "IN SHOP 0"). Keys not listed follow in first-seen order.
     */
    orderedKeys?: string[];
  };

  /**
   * OPTIONAL controlled / external pagination (ParityTable Phase A3) — mirrors the controlled-sort
   * and A1 controlled-expansion precedents. Omitting ALL of these keeps today's internal pagination
   * byte-identical for the ~130 existing call sites.
   *
   * PAGE — presence of `onPageChange` = controlled page mode (mirrors onSortChange /
   * onExpandedChange): pager clicks never mutate internal page state; ParityTable calls
   * `onPageChange(nextPage)` and renders from the `page` prop (default 1 when undefined).
   *
   * PAGE SIZE — presence of the `pageSize` VALUE = controlled page-size mode (value-presence
   * rule, deliberately NOT notifier-presence): the prop is the source of truth for slicing, the
   * built-in per-page selector fires `onPageSizeChange(size)` without mutating internal state.
   * Value-presence (not `onPageSizeChange != null`) is required so the recommended pre-paged
   * combination below works with no callback at all.
   *
   * `hidePager: true` suppresses the built-in pager / per-page chrome entirely (works in
   * controlled AND uncontrolled modes) so an external toolbar pager can own the UI. Internal page
   * slicing still applies unless the caller also feeds pre-paged rows. Recommended combinations:
   *  - "external chrome + ParityTable slices": pass full row set + page/onPageChange
   *    (+ pageSize/onPageSizeChange) + hidePager — the table slices, the page owns the chrome.
   *  - "external chrome + caller pre-pages" (e.g. server-paged): pass the CURRENT page's rows as
   *    `rows`, pageSize = rows.length (or the server page size), hidePager — no double slicing.
   */
  page?: number;
  onPageChange?: (page: number) => void;
  pageSize?: number;
  onPageSizeChange?: (size: number) => void;
  hidePager?: boolean;
  /**
   * When true, omit the outer rounded border frame so the table sits flush inside a parent
   * section card (BOX-IN-BOX flatten). Additive — default false preserves all existing surfaces.
   */
  embedded?: boolean;
  /**
   * OPTIONAL grouped column-band row (owner design law, 2026-09-04: "the piece the owner keeps
   * pointing at" -- Load Costs Board GROUPED render). Additive: omitting it keeps every existing
   * consumer byte-identical (no second header row). When provided, renders ONE extra <tr> above the
   * existing column-header row, one <th> per group in declaration order, colSpan'd to however many
   * of that group's `keys` are CURRENTLY in visibleColumns (so hide/reorder never desyncs colSpan
   * from the real header row below it). Any visible column not named in any group's `keys` gets its
   * own 1-colspan, untinted cell so the two header rows always carry the same total column count.
   */
  columnGroups?: Array<{
    label: string;
    keys: string[];
    /** Odd-row body tint for this group's columns (DESIGN-CONTRACT: .b-rev/.b-cost/.b-pay). The band
     * row itself is always the uniform group-band bg — this colour tints the BODY cells only. */
    bg?: string;
    /** Even-row body tint (DESIGN-CONTRACT even variants: --rev2/--cost2/--pay2). Falls back to `bg`
     * when omitted (a group with no zebra variant). */
    bgEven?: string;
  }>;
  /**
   * OPTIONAL per-instance header re-theme (owner design law 2026-09-04: "the navy table header is
   * RETIRED... light background, regular ink, never white -- this is system wide"). The system-wide
   * fix is CC-2 landing new values for colors.tableHeaderBg/tableHeaderText in design/tokens.ts; this
   * pair exists ONLY so an individual page can opt in ahead of that token landing without every one
   * of ParityTable's ~130 other call sites changing underneath it. Omit both to keep today's
   * colors.tableHeaderBg/tableHeaderText exactly as before (zero behavior change).
   */
  headerBg?: string;
  headerInk?: string;
  /**
   * OPTIONAL per-instance header font-weight (owner ruling 2026-09-05: the Load Costs board's
   * table headers must be REGULAR weight, not 700 — "the blue is too aggressive"). Opt-in like
   * headerBg/headerInk so the ~130 other call sites stay at the shared 700 default; omit to keep
   * today's weight exactly. Applies to both the group-band row and the column-header row.
   */
  headerWeight?: number;
};

function compareSortValues(
  a: string | number | null | undefined,
  b: string | number | null | undefined,
): number {
  const aNull = a == null || a === "";
  const bNull = b == null || b === "";
  if (aNull && bNull) return 0;
  if (aNull) return 1; // ASC: nulls last; ParityTable applies nulls before ASC/DESC flip
  if (bNull) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
}

const DENSITY: Record<ParityDensity, { rowH: number; padY: number; font: number }> = {
  regular: { rowH: 30, padY: 6, font: 12 },
  compact: { rowH: 24, padY: 3, font: 12 },
  ultra: { rowH: 20, padY: 1, font: 11 },
};

// LINK-F5171-PARITYTABLE-NESTED-DRILL — a clickable row is only the fallback target.
// Every nested control owns its own action; otherwise an EntityLink/customer/load drill can
// navigate correctly and then be overwritten by the row's detail navigation in the same click.
// Keeping this in the shared table fixes the class across every module/leaf that uses ParityTable.
const ROW_CLICK_INTERACTIVE_SELECTOR =
  "a, button, input, select, textarea, [role='button'], [role='link'], [data-row-click-ignore]";

function isParityTableInteractiveTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest(ROW_CLICK_INTERACTIVE_SELECTOR));
}

const DENSITY_LABEL: Record<ParityDensity, string> = {
  regular: "Regular",
  compact: "Compact",
  ultra: "Ultra compact",
};

// AUTO-FIT (owner law, COLUMN LAW 2026-09-01): `table-fixed` (below) never re-measures content —
// a column with no explicit width either collapses to whatever the FIRST rendered row happened to
// need or inherits a stale persisted width, silently truncating a real value (Payee/Vendor/State
// were the named examples). AUTO_FIT_MIN/MAX are a WRITTEN bound, not an arbitrary guess: MIN keeps
// a short numeric/status column from shrinking to illegible; MAX stops one long free-text column
// (a memo/description) from eating the whole table — a user who genuinely needs more still has the
// existing manual drag-resize, which always wins once used (see colWidths vs autoFitWidths below).
// VC-LIST-02 — the "All" page-size value. A large FINITE sentinel (never Infinity, which would
// make offset = 0 * Infinity = NaN and break slicing): pageCount = ceil(total / ALL_PAGE_SIZE) = 1,
// offset = 0, and slice(0, ALL_PAGE_SIZE) returns every row. Labeled "All" in the UI.
export const ALL_PAGE_SIZE = 1_000_000;
// Above this many rendered rows, mark each data row content-visibility:auto so the browser skips
// layout/paint for offscreen rows (native, no JS windowing — keeps the locked sticky-header /
// colgroup-width / resizable-th contract intact). Honors VC-LIST-02 "virtualized if >1,000".
const LARGE_RENDER_ROW_THRESHOLD = 1000;
const AUTO_FIT_MIN_WIDTH = 64;
const AUTO_FIT_MAX_WIDTH = 320;
// Cell horizontal padding (px-2 = 0.5rem each side) + the sort arrow glyph + a small buffer so a
// freshly-measured column isn't immediately re-truncated by its own chrome.
const AUTO_FIT_CHROME_PX = 28;
// AUTO-FIT measures a BOUNDED sample of the current page, not the whole dataset — the default
// `pageSizeOptions` below go up to 300 rows; measuring all of them on every keystroke of a live
// filter would be real, needless canvas work. 40 rows is enough to catch the page's longest value
// in practice without being a performance concern.
const AUTO_FIT_SAMPLE_ROWS = 40;

let measureCanvasCtx: CanvasRenderingContext2D | null | undefined;
function getMeasureCanvasCtx(): CanvasRenderingContext2D | null {
  if (measureCanvasCtx !== undefined) return measureCanvasCtx;
  if (typeof document === "undefined") {
    measureCanvasCtx = null;
    return measureCanvasCtx;
  }
  const canvas = document.createElement("canvas");
  measureCanvasCtx = canvas.getContext("2d");
  return measureCanvasCtx;
}

/** Plain-text width of `text` at the table's own font size — same measurement approach export/CSV
 * already relies on (`exportValue`) to get a real value out of a computed/rendered column. */
function measureTextWidth(text: string, fontPx: number): number {
  const ctx = getMeasureCanvasCtx();
  if (!ctx) return text.length * fontPx * 0.6; // SSR / no-canvas fallback: a reasonable estimate.
  ctx.font = `600 ${fontPx}px sans-serif`;
  return ctx.measureText(text).width;
}

/**
 * NO-TRUNCATION LAW (owner ruling 2026-09-04, verbatim: "no header label is ever truncated, the
 * column sizes to its label") — header labels needed their OWN measurement, not the body-text one
 * above. The real rendered `<th>` is `font-weight:700` (autoFitWidths measured at 600) with
 * `text-transform:uppercase` (canvas measurement never applied it — "Late Fee" measures narrower
 * than the "LATE FEE" that actually renders) and a `letterSpacing:0.3` per character canvas
 * `measureText` has no concept of. All three together under-measured just enough to clip "Late
 * Fee"/"Lumper"/"Fuel"/"R&M Exp" on the Load Costs board — confirmed live, owner screenshot. */
function measureHeaderLabelWidth(label: string, fontPx: number): number {
  const ctx = getMeasureCanvasCtx();
  const upper = label.toUpperCase();
  if (!ctx) return upper.length * fontPx * 0.65;
  ctx.font = `700 ${fontPx}px sans-serif`;
  return ctx.measureText(upper).width + upper.length * 0.3;
}

function cellTextForMeasurement<T>(column: ParityColumn<T>, row: T): string {
  const value = column.exportValue?.(row) ?? column.sortValue?.(row) ?? (row as Record<string, unknown>)[String(column.key)];
  if (value === null || value === undefined) return "";
  return String(value);
}

type Persisted = {
  hidden?: string[];
  density?: ParityDensity;
  pageSize?: number;
  colWidths?: Record<string, number>;
  /** REORDER (COLUMN LAW 2026-09-01) — column keys in display order. Missing/unknown keys keep
   * their original `columns` prop order and are appended after any explicitly ordered ones, so an
   * older saved order never silently hides a column a later release adds. */
  colOrder?: string[];
};

function loadPersisted(storageKey?: string): Persisted {
  if (!storageKey || typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(`paritytable:${storageKey}`);
    return raw ? (JSON.parse(raw) as Persisted) : {};
  } catch {
    return {};
  }
}

function savePersisted(storageKey: string | undefined, value: Persisted) {
  if (!storageKey || typeof window === "undefined") return;
  try {
    window.localStorage.setItem(`paritytable:${storageKey}`, JSON.stringify(value));
  } catch {
    /* ignore quota/serialization errors */
  }
}

export function ParityTable<T>({
  columns,
  rows: sourceRows,
  rowKey,
  loading = false,
  onRowClick,
  onRowContextMenu,
  rowClassName,
  emptyText = "No records found.",
  density: densityProp = "regular",
  pageSizeOptions = [25, 50, 100, 300],
  allowAllPageSize = false,
  initialPageSize,
  storageKey,
  toolbar,
  selectable = false,
  batchActions,
  rowActions,
  maxSelectable,
  onSelectionCapExceeded,
  selectedKeys: controlledSelectedKeys,
  onSelectionChange,
  filterBar,
  suppressToolbarSearch = false,
  suppressToolbarRange = false,
  exportFilename,
  stickyHeader = true,
  minWidthPx,
  columnLayout = "fixed",
  enableColumnResize = true,
  enableColumnReorder = true,
  stickyLeftCount = 0,
  frameColor,
  columnOrder: controlledColumnOrder,
  onColumnOrderChange,
  autoFitColumns = true,
  renderExpanded,
  tableTestId,
  gearButtonTestId,
  gearExtra,
  rowTestId,
  sortKey: controlledSortKey,
  sortDirection: controlledSortDirection,
  onSortChange,
  sortMode = "internal",
  expandedKeys: controlledExpandedKeys,
  onExpandedChange,
  expandMode = "multi",
  expandOnRowClick = false,
  groupBy,
  page: controlledPage,
  onPageChange,
  pageSize: controlledPageSize,
  onPageSizeChange,
  hidePager = false,
  embedded = false,
  columnGroups,
  headerBg,
  headerInk,
  headerWeight,
  footer,
  footerCells,
}: ParityTableProps<T>) {
  const persisted = useMemo(() => loadPersisted(storageKey), [storageKey]);

  // DSP-TBL — dev-only, once-per-mount nudge toward footerCells. Never in prod (bundlers strip
  // NODE_ENV-gated blocks like this one), never a build failure, never more than one line.
  const warnedRawFooter = useRef(false);
  if (footer != null && !warnedRawFooter.current) {
    warnedRawFooter.current = true;
    if (!import.meta.env.PROD) {
      // eslint-disable-next-line no-console
      console.warn(
        `ParityTable: the "footer" prop is deprecated (DSP-TBL, owner ruling 2026-09-05) — a raw footer desyncs from column reorder/hide. Use "footerCells" (keyed by column) instead. storageKey="${storageKey ?? "(none)"}"`
      );
    }
  }

  const isSortControlled = onSortChange != null;
  // Phase A4: external sort passthrough REQUIRES controlled sort — without onSortChange the
  // caller could never apply an order, so "external" falls back to today's internal sort.
  const isSortExternal = sortMode === "external" && isSortControlled;
  const [internalSortKey, setInternalSortKey] = useState<string>("");
  const [internalSortDirection, setInternalSortDirection] = useState<"asc" | "desc">("asc");
  const sortKey = isSortControlled ? controlledSortKey ?? "" : internalSortKey;
  const sortDirection = isSortControlled ? controlledSortDirection ?? "asc" : internalSortDirection;
  // Controlled pagination (Phase A3) mirrors the controlled-sort split: presence of onPageChange
  // switches the page source of truth from internal state to the caller-owned `page` prop.
  const isPageControlled = onPageChange != null;
  const [internalPage, setInternalPage] = useState(1);
  const page = isPageControlled ? controlledPage ?? 1 : internalPage;
  const [pageInput, setPageInput] = useState("");
  const [density, setDensity] = useState<ParityDensity>(persisted.density ?? densityProp);
  // Page size uses VALUE-presence (pageSize != null = controlled) — see the A3 prop docs — so a
  // pre-paged caller can pin the size with no callback. Internal state is unchanged otherwise.
  const isPageSizeControlled = controlledPageSize != null;
  const [internalPageSize, setInternalPageSize] = useState<number>(
    persisted.pageSize ?? initialPageSize ?? pageSizeOptions[0] ?? 25,
  );
  const pageSize = isPageSizeControlled ? controlledPageSize : internalPageSize;
  // VC-LIST-02 — page-size options as rendered: append the "All" sentinel when allowed (dedup-safe).
  const renderedPageSizeOptions =
    allowAllPageSize && !pageSizeOptions.includes(ALL_PAGE_SIZE)
      ? [...pageSizeOptions, ALL_PAGE_SIZE]
      : pageSizeOptions;
  const pageSizeOptionLabel = (opt: number) => (opt >= ALL_PAGE_SIZE ? "All" : String(opt));
  const [hidden, setHidden] = useState<Set<string>>(
    () =>
      new Set(
        persisted.hidden ??
          columns.filter((c) => c.defaultHidden).map((c) => String(c.key)),
      ),
  );
  const [gearOpen, setGearOpen] = useState(false);
  const [draftHidden, setDraftHidden] = useState<Set<string>>(() => new Set(hidden));
  const [draftDensity, setDraftDensity] = useState<ParityDensity>(density);
  const [draftPageSize, setDraftPageSize] = useState<number>(pageSize);
  const [toolbarSearch, setToolbarSearch] = useState("");
  const [toolbarRange, setToolbarRange] = useState<UniversalRange | null>(null);
  // Controlled selection (Phase A5) mirrors A1 expansion: presence of onSelectionChange
  // switches the source of truth from internal state to the caller-owned selectedKeys prop.
  const isSelectionControlled = onSelectionChange != null;
  const [internalSelected, setInternalSelected] = useState<Set<string>>(new Set());
  const selected = useMemo(
    () => (isSelectionControlled ? new Set(controlledSelectedKeys ?? []) : internalSelected),
    [isSelectionControlled, controlledSelectedKeys, internalSelected],
  );
  // Controlled expansion mirrors the controlled-sort pattern above: presence of the change
  // notifier switches the source of truth from internal state to the caller-owned prop.
  const isExpandControlled = onExpandedChange != null;
  const [internalExpanded, setInternalExpanded] = useState<Set<string>>(new Set());
  const expanded = useMemo(
    () => (isExpandControlled ? new Set(controlledExpandedKeys ?? []) : internalExpanded),
    [isExpandControlled, controlledExpandedKeys, internalExpanded],
  );
  // Group-band collapse (Phase A2) mirrors the same controlled/uncontrolled split: presence of
  // onCollapsedChange switches the source of truth from internal state to caller-owned collapsedKeys.
  const isCollapseControlled = groupBy?.onCollapsedChange != null;
  const [internalCollapsed, setInternalCollapsed] = useState<Set<string>>(new Set());
  const controlledCollapsedKeys = groupBy?.collapsedKeys;
  const collapsedGroups = useMemo(
    () => (isCollapseControlled ? new Set(controlledCollapsedKeys ?? []) : internalCollapsed),
    [isCollapseControlled, controlledCollapsedKeys, internalCollapsed],
  );
  const [colWidths, setColWidths] = useState<Record<string, number>>(persisted.colWidths ?? {});
  // REORDER — drag-to-move columns. `colOrder` holds ONLY keys the user has explicitly reordered
  // into a non-default position; `dragKey`/`dragOverKey` are transient drag-in-progress state, not
  // persisted.
  const isColumnOrderControlled = onColumnOrderChange != null;
  const [internalColOrder, setInternalColOrder] = useState<string[]>(persisted.colOrder ?? []);
  const colOrder = isColumnOrderControlled ? controlledColumnOrder ?? [] : internalColOrder;
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);
  const gearRef = useRef<HTMLDivElement>(null);
  const gearPanelRef = useRef<HTMLDivElement>(null);
  const [gearPanelStyle, setGearPanelStyle] = useState<CSSProperties>({});
  const resizing = useRef<{ key: string; startX: number; startW: number } | null>(null);

  const cancelGear = () => {
    setDraftHidden(new Set(hidden));
    setDraftDensity(density);
    setDraftPageSize(pageSize);
    setGearOpen(false);
  };

  const openGear = () => {
    setDraftHidden(new Set(hidden));
    setDraftDensity(density);
    setDraftPageSize(pageSize);
    setGearOpen(true);
  };

  const applyGear = () => {
    setHidden(new Set(draftHidden));
    setDensity(draftDensity);
    changePageSize(draftPageSize);
    savePersisted(storageKey, { hidden: [...draftHidden], density: draftDensity, pageSize: draftPageSize, colWidths, colOrder });
    setGearOpen(false);
  };

  const resetGear = () => {
    setDraftHidden(new Set(columns.filter((column) => column.defaultHidden).map((column) => String(column.key))));
    setDraftDensity(densityProp);
    setDraftPageSize(pageSizeOptions[0] ?? 25);
  };

  // Outside click / Escape cancels uncommitted gear edits. gearPanelRef is checked too because the
  // panel is portal-rendered (see below) — it no longer lives inside gearRef's DOM subtree, so a
  // click on e.g. a column checkbox would otherwise read as "outside" and cancel the whole popover.
  useEffect(() => {
    if (!gearOpen) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (gearRef.current?.contains(t) || gearPanelRef.current?.contains(t)) return;
      cancelGear();
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") cancelGear(); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [density, gearOpen, hidden]);

  // GO-23-REGRESSION-CORRECTION (owner-reported, 2026-09-07): this popover is `position: absolute`
  // with no viewport-collision handling, so a page that wraps ParityTable in a fixed-height
  // `overflow-hidden` card (e.g. LoadCostsBoardPage's <section>) clips it — not a scroll-to-reveal
  // problem, an `overflow: hidden` ancestor with no scrollbar at all, confirmed live
  // (getComputedStyle on the wrapping <section>: overflow-hidden, fixed height ~694px). Same class
  // of bug as HoverDropdownNav.tsx/DispatchSubnav.tsx's nav-dropdown clip, same fix: escape into a
  // document.body portal at `position: fixed`, measured from a live getBoundingClientRect() read,
  // right-aligned under the gear button to preserve its current visual placement.
  const PARITY_GEAR_Z_INDEX = 220;
  useLayoutEffect(() => {
    if (!gearOpen || !gearRef.current) return;
    const rect = gearRef.current.getBoundingClientRect();
    setGearPanelStyle({
      position: "fixed",
      top: rect.bottom,
      right: window.innerWidth - rect.right,
      zIndex: PARITY_GEAR_Z_INDEX,
    });
  }, [gearOpen]);

  useEffect(() => {
    if (!gearOpen) return undefined;
    function reposition() {
      if (!gearRef.current) return;
      const rect = gearRef.current.getBoundingClientRect();
      setGearPanelStyle({
        position: "fixed",
        top: rect.bottom,
        right: window.innerWidth - rect.right,
        zIndex: PARITY_GEAR_Z_INDEX,
      });
    }
    window.addEventListener("resize", reposition);
    document.addEventListener("scroll", reposition, true);
    return () => {
      window.removeEventListener("resize", reposition);
      document.removeEventListener("scroll", reposition, true);
    };
  }, [gearOpen]);

  // REORDER — apply the user's saved drag order BEFORE the hidden-column filter, so hiding/showing
  // a column never disturbs the order of the ones that stay visible.
  const orderedColumns = useMemo(() => {
    if (colOrder.length === 0) return columns;
    const byKey = new Map(columns.map((c) => [String(c.key), c]));
    const ordered: typeof columns = [];
    for (const key of colOrder) {
      const c = byKey.get(key);
      if (c) {
        ordered.push(c);
        byKey.delete(key);
      }
    }
    // Any column not in the saved order (new since the order was saved, or never dragged) keeps
    // its original relative position, appended after the explicitly ordered ones.
    for (const c of columns) {
      if (byKey.has(String(c.key))) ordered.push(c);
    }
    return ordered;
  }, [columns, colOrder]);
  const visibleColumns = orderedColumns.filter((c) => c.alwaysVisible || !hidden.has(String(c.key)));

  // COLUMNS-MUST-DISTINGUISH LAW (owner ruling 2026-09-04) — column-key -> the owning group's `bg`
  // (if any), for tinting body cells the full column height to match the group band above them.
  // Recomputed from `columnGroups` directly (not the visible/ordered list) since a column's group
  // membership doesn't depend on its current position — only the header band row's colSpans do.
  const columnBg = useMemo(() => {
    if (!columnGroups) return null;
    const map = new Map<string, { bg?: string; bgEven?: string }>();
    for (const g of columnGroups) for (const k of g.keys) map.set(k, { bg: g.bg, bgEven: g.bgEven ?? g.bg });
    return map;
  }, [columnGroups]);

  function moveColumn(sourceKey: string, targetKey: string) {
    if (sourceKey === targetKey) return;
    const currentOrder = orderedColumns.map((c) => String(c.key));
    const from = currentOrder.indexOf(sourceKey);
    const to = currentOrder.indexOf(targetKey);
    if (from === -1 || to === -1) return;
    const next = [...currentOrder];
    next.splice(from, 1);
    next.splice(to, 0, sourceKey);
    if (isColumnOrderControlled) {
      onColumnOrderChange?.(next);
      return;
    }
    setInternalColOrder(next);
    savePersisted(storageKey, { hidden: [...hidden], density, pageSize, colWidths, colOrder: next });
  }
  const toolbarFilteredRows = useMemo(
    () => applyUniversalListFilters(sourceRows, toolbarSearch, toolbarRange),
    [sourceRows, toolbarRange, toolbarSearch],
  );
  // Keep the external-sort identity contract: toolbar filtering preserves caller order, then the
  // sort pipeline receives that filtered array as its canonical `rows` input.
  const rows = toolbarFilteredRows;

  const sortedRows = useMemo(() => {
    // Phase A4 external passthrough: identity — the caller owns row order (server-side sort or a
    // pre-sorted pipeline like bankTxnSortGroup). No copy, no sort; indicator + onSortChange only.
    if (isSortExternal) return rows;
    if (!sortKey) return rows;
    const column = columns.find((c) => String(c.key) === sortKey);
    const extract = (row: T): string | number | null | undefined =>
      column?.sortValue
        ? column.sortValue(row)
        : ((row as Record<string, unknown>)[sortKey] as string | number | null | undefined);
    const copy = [...rows];
    copy.sort((a, b) => {
      const av = extract(a);
      const bv = extract(b);
      const aNull = av == null || av === "";
      const bNull = bv == null || bv === "";
      // Nulls/blanks always last — do not flip with DESC (negating compareSortValues would).
      if (aNull && bNull) return 0;
      if (aNull) return 1;
      if (bNull) return -1;
      const cmp = compareSortValues(av, bv);
      return sortDirection === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [rows, columns, sortKey, sortDirection, isSortExternal]);

  const total = sortedRows.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, pageCount);
  const offset = (safePage - 1) * pageSize;
  const pageRows = sortedRows.slice(offset, offset + pageSize);
  const d = DENSITY[density];
  // VC-LIST-02 — when "All" renders a large set, let the browser skip offscreen row paint/layout.
  const virtualizeRows = pageRows.length > LARGE_RENDER_ROW_THRESHOLD;

  // AUTO-FIT — only for columns the user has NOT manually resized (colWidths, still the source of
  // truth once set — see the `w = colWidths[key] ?? autoFitWidths[key]` lookup below). Recomputed
  // per page/column-set rather than truly once-ever: a column can legitimately need to widen again
  // when a later page's data is longer than what was on screen at mount, and the owner's actual law
  // is "must always show fully", not "measured once and then possibly wrong forever".
  const autoFitWidths = useMemo(() => {
    if (!autoFitColumns) return {};
    const widths: Record<string, number> = {};
    const sample = pageRows.slice(0, AUTO_FIT_SAMPLE_ROWS);
    for (const column of visibleColumns) {
      const key = String(column.key);
      if (colWidths[key] != null) continue; // manual resize already won for this column.
      let widest = measureHeaderLabelWidth(column.label, typography.panelHeader ?? 11);
      for (const row of sample) {
        const text = cellTextForMeasurement(column, row);
        if (!text) continue;
        const w = measureTextWidth(text, d.font);
        if (w > widest) widest = w;
      }
      // ROUND 16.1 — a per-column maxWidth (when set) caps the auto-fit below the global ceiling so
      // one long value can't stretch the column across the whole screen; minWidth still floors it.
      const ceiling = Math.min(AUTO_FIT_MAX_WIDTH, column.maxWidth ?? AUTO_FIT_MAX_WIDTH);
      const floor = Math.max(AUTO_FIT_MIN_WIDTH, column.minWidth ?? 0);
      widths[key] = Math.max(floor, Math.min(ceiling, Math.max(AUTO_FIT_MIN_WIDTH, Math.ceil(widest + AUTO_FIT_CHROME_PX))));
    }
    return widths;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- colWidths only gates which columns are
    // (re)computed; including it would recompute every autofit width on every manual drag-resize.
  }, [autoFitColumns, visibleColumns, pageRows, d.font]);

  // STICKY-LEFT (DESIGN-CONTRACT-DISPATCH-BOARD-2026-09-05 §14: "first four columns sticky-left").
  // Sticks the first `stickyLeftCount` columns in CURRENT visible order (not by key), so dragging a
  // column into/out of the leading run moves the sticky boundary with it rather than pinning a
  // stale key set. `left` is the cumulative width of the sticky columns before this one, same
  // width source (`colWidths` manual-resize wins, else `autoFitWidths`, else the 120px fallback
  // every other width lookup in this file already uses) as the header/cell width itself, so the
  // sticky offset never drifts out of sync with the actual rendered column width.
  const stickyLeftPx = useMemo(() => {
    const offsets: Record<string, number> = {};
    if (!stickyLeftCount || stickyLeftCount <= 0) return offsets;
    let cum = (renderExpanded ? 32 : 0) + (selectable ? 32 : 0);
    for (let i = 0; i < Math.min(stickyLeftCount, visibleColumns.length); i += 1) {
      const key = String(visibleColumns[i].key);
      offsets[key] = cum;
      cum += colWidths[key] ?? autoFitWidths[key] ?? 120;
    }
    return offsets;
  }, [stickyLeftCount, visibleColumns, colWidths, autoFitWidths, renderExpanded, selectable]);

  // Phase A2: group the CURRENT page's rows in their CURRENT order (stable — first appearance of
  // each key sets group order; rows are never re-sorted). Pagination math above is untouched.
  const groupGetKey = groupBy?.getKey;
  const groupOrderedKeys = groupBy?.orderedKeys;
  const groupedPageRows = useMemo(() => {
    if (!groupGetKey) return null;
    const order: string[] = [];
    const byKey = new Map<string, T[]>();
    for (const row of pageRows) {
      const key = groupGetKey(row);
      const bucket = byKey.get(key);
      if (bucket) bucket.push(row);
      else {
        byKey.set(key, [row]);
        order.push(key);
      }
    }
    if (groupOrderedKeys && groupOrderedKeys.length > 0) {
      const fixed = groupOrderedKeys.map((key) => ({ key, rows: byKey.get(key) ?? [] }));
      const rest = order.filter((key) => !groupOrderedKeys.includes(key)).map((key) => ({ key, rows: byKey.get(key)! }));
      return [...fixed, ...rest];
    }
    return order.map((key) => ({ key, rows: byKey.get(key)! }));
  }, [groupGetKey, groupOrderedKeys, pageRows]);

  const selectedRows = useMemo(
    () => rows.filter((r) => selected.has(rowKey(r))),
    [rows, selected, rowKey],
  );
  const pageAllSelected = pageRows.length > 0 && pageRows.every((r) => selected.has(rowKey(r)));
  const pageOnlySelected =
    pageAllSelected && selected.size === pageRows.length && sortedRows.length > pageRows.length;

  // BULK-SELECTION-SCOPE-01 — clear when the visible row set changes (page / sort / filter).
  const selectionScopeKey = `${safePage}|${sortKey}|${sortDirection}|${toolbarSearch}|${toolbarRange ? JSON.stringify(toolbarRange) : ""}`;
  const prevSelectionScopeRef = useRef<string | null>(null);
  useEffect(() => {
    if (prevSelectionScopeRef.current === null) {
      prevSelectionScopeRef.current = selectionScopeKey;
      return;
    }
    if (prevSelectionScopeRef.current === selectionScopeKey) return;
    prevSelectionScopeRef.current = selectionScopeKey;
    if (isSelectionControlled) {
      if ((controlledSelectedKeys?.length ?? 0) > 0) onSelectionChange?.([]);
      return;
    }
    setInternalSelected((prev) => (prev.size === 0 ? prev : new Set()));
  }, [selectionScopeKey, isSelectionControlled, controlledSelectedKeys, onSelectionChange]);

  // Drag-to-resize: capture the column + start geometry on mousedown, update width on mousemove,
  // persist on mouseup. Widths drive the table-fixed column widths and survive reloads (storageKey).
  function startResize(key: string, e: ReactMouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const th = (e.currentTarget as HTMLElement).closest("th");
    const startW = colWidths[key] || th?.getBoundingClientRect().width || 120;
    resizing.current = { key, startX: e.clientX, startW };
    const onMove = (ev: MouseEvent) => {
      if (!resizing.current) return;
      const delta = ev.clientX - resizing.current.startX;
      const w = Math.max(48, Math.round(resizing.current.startW + delta));
      setColWidths((prev) => ({ ...prev, [resizing.current!.key]: w }));
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      resizing.current = null;
      // Persist the LATEST widths (read via the state setter to avoid a stale closure value).
      setColWidths((cur) => {
        savePersisted(storageKey, { hidden: [...hidden], density, pageSize, colWidths: cur, colOrder });
        return cur;
      });
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  // Touch drag mirrors the mouse path so column resize works on tablets. Additive — the mouse
  // drag in startResize is unchanged.
  function startResizeTouch(key: string, e: ReactTouchEvent) {
    e.stopPropagation();
    const th = (e.currentTarget as HTMLElement).closest("th");
    const startX = e.touches[0]?.clientX ?? 0;
    const startW = colWidths[key] || th?.getBoundingClientRect().width || 120;
    const onMove = (ev: TouchEvent) => {
      const delta = (ev.touches[0]?.clientX ?? startX) - startX;
      const w = Math.max(48, Math.round(startW + delta));
      setColWidths((prev) => ({ ...prev, [key]: w }));
    };
    const onEnd = () => {
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", onEnd);
      setColWidths((cur) => {
        savePersisted(storageKey, { hidden: [...hidden], density, pageSize, colWidths: cur, colOrder });
        return cur;
      });
    };
    document.addEventListener("touchmove", onMove, { passive: true });
    document.addEventListener("touchend", onEnd);
  }

  // Keyboard resize: ←/→ nudge the focused column ±8px (Shift = ±32px). Additive a11y path so the
  // resize handle is reachable without a mouse; widths persist exactly like a drag.
  function nudgeWidth(key: string, delta: number, thEl: HTMLElement | null) {
    setColWidths((prev) => {
      const base = prev[key] || thEl?.getBoundingClientRect().width || 120;
      const w = Math.max(48, Math.round(base + delta));
      const next = { ...prev, [key]: w };
      savePersisted(storageKey, { hidden: [...hidden], density, pageSize, colWidths: next, colOrder });
      return next;
    });
  }

  function onResizeKey(key: string, e: ReactKeyboardEvent) {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    e.stopPropagation();
    const step = (e.shiftKey ? 32 : 8) * (e.key === "ArrowLeft" ? -1 : 1);
    nudgeWidth(key, step, (e.currentTarget as HTMLElement).closest("th"));
  }

  function exportCsv() {
    const cols = visibleColumns;
    const esc = (v: unknown) => {
      const s = v == null ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = cols.map((c) => esc(c.label)).join(",");
    const body = sortedRows
      .map((row) =>
        cols
          .map((c) => esc(c.exportValue ? c.exportValue(row) : (row as Record<string, unknown>)[String(c.key)]))
          .join(",")
      )
      .join("\n");
    const blob = new Blob([`${header}\n${body}`], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${exportFilename}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function toggleDraftColumn(key: string) {
    setDraftHidden((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleSort(key: string) {
    const nextDirection: "asc" | "desc" = sortKey === key && sortDirection === "asc" ? "desc" : "asc";
    if (isSortControlled) {
      onSortChange?.(key, nextDirection);
      return;
    }
    setInternalSortKey(key);
    setInternalSortDirection(nextDirection);
  }

  function changePage(next: number) {
    // Controlled (A3): notify the owner, never mutate internal page state — the `page` prop drives render.
    if (isPageControlled) {
      onPageChange?.(next);
      return;
    }
    setInternalPage(next);
  }

  function changePageSize(next: number) {
    onPageSizeChange?.(next);
    if (!isPageSizeControlled) setInternalPageSize(next);
    // Reset to page 1 (pre-A3 behavior); in controlled page mode this notifies onPageChange(1).
    changePage(1);
  }

  function toggleRow(id: string) {
    const applyToggle = (prev: Set<string>): Set<string> => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
        return next;
      }
      next.add(id);
      if (maxSelectable != null && next.size > maxSelectable) {
        onSelectionCapExceeded?.(next.size);
        return prev;
      }
      return next;
    };
    if (isSelectionControlled) {
      const prev = new Set(controlledSelectedKeys ?? []);
      const next = applyToggle(prev);
      // Cap no-op returns the same Set reference — do not notify (mirrors uncontrolled setState bail).
      if (next === prev) return;
      onSelectionChange?.([...next]);
      return;
    }
    setInternalSelected((prev) => applyToggle(prev));
  }

  function toggleExpanded(id: string) {
    // Shared toggle math for both modes: collapse if open; expand (alone in "single" mode) if closed.
    const computeNext = (prev: Set<string>): Set<string> => {
      if (prev.has(id)) {
        const next = new Set(prev);
        next.delete(id);
        return next;
      }
      if (expandMode === "single") return new Set([id]);
      const next = new Set(prev);
      next.add(id);
      return next;
    };
    if (isExpandControlled) {
      onExpandedChange?.([...computeNext(new Set(controlledExpandedKeys ?? []))]);
      return;
    }
    setInternalExpanded(computeNext);
  }

  function toggleGroupCollapsed(key: string) {
    const computeNext = (prev: Set<string>): Set<string> => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    };
    if (isCollapseControlled) {
      groupBy?.onCollapsedChange?.([...computeNext(new Set(controlledCollapsedKeys ?? []))]);
      return;
    }
    setInternalCollapsed(computeNext);
  }

  function togglePageAll() {
    // SEL-01 — page header unions this page into the existing selection (cross-page accumulation).
    // Deselecting the header removes only this page's rows. selectAllMatching still selects the full filtered set.
    const applyPageAll = (prev: Set<string>): Set<string> => {
      if (pageAllSelected) {
        const next = new Set(prev);
        pageRows.forEach((r) => next.delete(rowKey(r)));
        return next;
      }
      const next = new Set(prev);
      for (const row of pageRows) next.add(rowKey(row));
      if (maxSelectable != null && next.size > maxSelectable) {
        onSelectionCapExceeded?.(next.size);
        return prev;
      }
      return next;
    };
    if (isSelectionControlled) {
      const prev = new Set(controlledSelectedKeys ?? []);
      const next = applyPageAll(prev);
      if (next === prev) return;
      onSelectionChange?.([...next]);
      return;
    }
    setInternalSelected((prev) => applyPageAll(prev));
  }

  function selectAllMatching() {
    const ids = sortedRows.map((r) => rowKey(r));
    if (maxSelectable != null && ids.length > maxSelectable) {
      onSelectionCapExceeded?.(ids.length);
      return;
    }
    if (isSelectionControlled) {
      onSelectionChange?.(ids);
      return;
    }
    setInternalSelected(new Set(ids));
  }

  function clearSelection() {
    if (isSelectionControlled) {
      onSelectionChange?.([]);
      return;
    }
    setInternalSelected(new Set());
  }

  // Windowed numbered pages (max 7 buttons).
  const pageButtons = useMemo(() => {
    const out: number[] = [];
    const span = 7;
    let start = Math.max(1, safePage - 3);
    const end = Math.min(pageCount, start + span - 1);
    start = Math.max(1, end - span + 1);
    for (let p = start; p <= end; p += 1) out.push(p);
    return out;
  }, [safePage, pageCount]);

  const colSpan =
    visibleColumns.length + (selectable ? 1 : 0) + (rowActions ? 1 : 0) + (renderExpanded ? 1 : 0);

  // Shared per-row renderer so the grouped (A2) and ungrouped paths emit IDENTICAL row markup —
  // selection, expansion (incl. A1 controlled expansion), density, and row actions all compose.
  // `rowIndex` drives zebra striping (COLUMNS-MUST-DISTINGUISH LAW) — set per data-td explicitly
  // (not relied on via <tr> background) since a grouped column's own tint must win per-cell.
  const renderDataRow = (row: T, rowIndex = 0) => {
    const id = rowKey(row);
    const isExpanded = expanded.has(id);
    const isEvenRow = rowIndex % 2 === 1;
    return (
      <Fragment key={id}>
      <tr
        data-testid={rowTestId ? rowTestId(row) : undefined}
        // GLB-06 (owner 2026-09-03): "columns and rows need a real divider" -- gray-100 is a
        // near-invisible hairline next to every other border in this app (gray-200, the same
        // weight the table's own outer frame/toolbar/pager already use). One border weight.
        className={`border-t border-gray-200 ${
          onRowClick || (expandOnRowClick && renderExpanded) ? "cursor-pointer hover:bg-gray-50" : ""
        } ${rowClassName ? rowClassName(row) : ""}`}
        style={{
          height: d.rowH,
          ...(virtualizeRows ? { contentVisibility: "auto", containIntrinsicSize: `${d.rowH}px` } : {}),
          ...(selected.has(id) ? { backgroundColor: colors.accentTint } : {}),
        }}
        onClick={onRowClick ? (event) => {
          if (isParityTableInteractiveTarget(event.target)) return;
          onRowClick(row);
        } : (expandOnRowClick && renderExpanded) ? (event) => {
          if (isParityTableInteractiveTarget(event.target)) return;
          toggleExpanded(id);
        } : undefined}
        onContextMenu={onRowContextMenu ? (event) => onRowContextMenu(row, event) : undefined}
      >
        {renderExpanded ? (
          <td className="px-2 align-top" onClick={(e: { stopPropagation(): void }) => e.stopPropagation()}>
            <button
              type="button"
              aria-label={isExpanded ? "Collapse row" : "Expand row"}
              aria-expanded={isExpanded}
              className="parity-expand-toggle-box flex items-center justify-center text-gray-500 hover:text-gray-800"
              data-testid="parity-expand-toggle"
              onClick={() => toggleExpanded(id)}
            >
              {isExpanded ? "▾" : "▸"}
            </button>
          </td>
        ) : null}
        {selectable ? (
          <td className="px-2" onClick={(e: { stopPropagation(): void }) => e.stopPropagation()}>
            {/* UI CONTROL LAW — the native checkbox stays its own small visual size; the wrapper
             * is the >=24x24 WCAG 2.2 SC 2.5.8 clickable area (was a bare, unwrapped <input>). */}
            <span className={MIN_HIT_TARGET_CLASS}>
              <input
                type="checkbox"
                aria-label="Select row"
                checked={selected.has(id)}
                onChange={() => toggleRow(id)}
              />
            </span>
          </td>
        ) : null}
        {visibleColumns.map((column) => {
          // COLUMNS-MUST-DISTINGUISH LAW (owner ruling 2026-09-04) — a grouped column's own tint
          // always wins over plain zebra striping (ungrouped columns still zebra-stripe); selection
          // wins over both.
          const group = columnBg?.get(String(column.key));
          // DESIGN-CONTRACT even/odd group tints (--rev/--rev2 etc): a grouped column paints its own
          // odd tint on odd rows and its darker even variant on even rows; ungrouped columns fall
          // back to plain zebra. Selection wins over both.
          const groupBg = group ? (isEvenRow ? group.bgEven ?? group.bg : group.bg) : undefined;
          const cellBg = selected.has(id)
            ? colors.accentTint
            : groupBg
              ? groupBg
              : isEvenRow
                ? colors.tableRowStripe
                : undefined;
          return (
          <td
            key={String(column.key)}
            title={
              !column.allowWrap && column.render == null
                ? String((row as Record<string, unknown>)[String(column.key)] ?? "")
                : undefined
            }
            className={`overflow-hidden px-2 align-top text-gray-800 ${
              column.allowWrap ? "wrap-break-word" : "whitespace-nowrap text-ellipsis"
            } ${column.cellClass ?? column.className ?? ""}`}
            style={{
              paddingTop: d.padY,
              paddingBottom: d.padY,
              // DESIGN-CONTRACT-LOAD-COSTS-BOARD-2026-09-05.md: body td rules are the lighter
              // --line shade (tableBodyRule), distinct from the darker --line2 on header/group rows.
              borderRight: `1px solid ${colors.tableBodyRule}`,
              borderBottom: `1px solid ${colors.tableBodyRule}`,
              ...(cellBg ? { backgroundColor: cellBg } : {}),
              ...(String(column.key) in stickyLeftPx
                ? {
                    position: "sticky" as const,
                    left: stickyLeftPx[String(column.key)],
                    zIndex: 1,
                    // A sticky body cell needs its OWN opaque background (it renders over rows
                    // scrolling past underneath it) — fall back to white when no zebra/group/
                    // selection tint applies, same as every other cell would show as its row bg.
                    backgroundColor: cellBg ?? "#FFFFFF",
                  }
                : {}),
            }}
          >
            {column.render
              ? column.render(row)
              : String((row as Record<string, unknown>)[String(column.key)] ?? "")}
          </td>
          );
        })}
        {rowActions ? (
          <td className="px-2 text-right" onClick={(e: { stopPropagation(): void }) => e.stopPropagation()}>
            {rowActions(row)}
          </td>
        ) : null}
      </tr>
      {renderExpanded && isExpanded ? (
        <tr className="bg-gray-50/60">
          <td colSpan={colSpan} className="px-3 py-2">
            {renderExpanded(row)}
          </td>
        </tr>
      ) : null}
      </Fragment>
    );
  };

  const shellClass = embedded
    ? "overflow-visible bg-white"
    : "overflow-visible rounded-md border border-gray-200 bg-white";

  // Per-instance header re-theme (see headerBg/headerInk prop doc) -- falls back to the shared
  // token unchanged when the caller passes neither, so every existing consumer is byte-identical.
  const resolvedHeaderBg = headerBg ?? colors.tableHeaderBg;
  const resolvedHeaderInk = headerInk ?? colors.tableHeaderText;

  return (
    <div className={shellClass} style={frameColor ? { borderColor: frameColor } : undefined} data-testid={tableTestId}>
      {/* Canonical list toolbar: search + applied range filter + optional slot + gear. */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 px-2 py-1.5">
        <UniversalListToolbar
          search={toolbarSearch}
          onSearchChange={(value) => { setToolbarSearch(value); changePage(1); }}
          columns={columns.map((column) => ({ key: String(column.key), label: column.label }))}
          range={toolbarRange}
          onRangeApply={(value) => { setToolbarRange(value); changePage(1); }}
          resultCount={rows.length}
          totalCount={sourceRows.length}
          hideSearch={suppressToolbarSearch}
          hideRange={suppressToolbarRange}
          className="min-w-0 flex-1"
        />
        <div className="flex items-center gap-2 text-[11px] text-gray-600">
          {selectable && selected.size > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              <span
                className="rounded-sm bg-slate-800 px-2 py-1 text-xs font-bold tracking-wide text-white"
                data-testid="parity-selection-count"
                title={`${selected.size} row(s) selected for bulk action`}
              >
                {selected.size} selected
              </span>
              {batchActions ? batchActions(selectedRows) : null}
              <button
                type="button"
                className="rounded-sm border border-gray-300 bg-white px-1.5 py-0.5 font-semibold text-slate-700 underline-offset-2 hover:underline"
                onClick={clearSelection}
              >
                Clear selection
              </button>
              {pageOnlySelected ? (
                <button
                  type="button"
                  className="rounded-sm border border-slate-400 bg-slate-50 px-2 py-1 text-[11px] font-semibold text-slate-800"
                  data-testid="parity-select-all-matching"
                  onClick={selectAllMatching}
                >
                  {`All ${pageRows.length} on this page are selected. Select all ${sortedRows.length} matching?`}
                </button>
              ) : null}
            </div>
          ) : (
            <span className="text-gray-400">{toolbar ? null : ""}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {toolbar}
          {exportFilename ? (
            // UI CONTROL LAW — this used to be a hand-rolled <button> with its own ad-hoc,
            // smaller fixed size, a THIRD button size alongside Button.tsx's own two. Now the
            // real shared Button primitive, matching every other toolbar action's size.
            <Button type="button" variant="tertiary" size="sm" aria-label="Export CSV" onClick={exportCsv}>
              ⤓ Export
            </Button>
          ) : null}
          <div className="relative" ref={gearRef}>
            <Button
              type="button"
              variant="tertiary"
              size="icon"
              aria-label="Table settings"
              data-testid={gearButtonTestId}
              onClick={() => { if (gearOpen) cancelGear(); else openGear(); }}
            >
              {/* UI CONTROL LAW — was a bare ⚙ Unicode glyph inheriting the button's own
               * ambient font-size; now a real icon at the app's one toolbar-icon size, so the
               * gear stops being smaller than the icons next to it. */}
              <GearIcon className={TOOLBAR_ICON_SIZE_CLASS} aria-hidden />
            </Button>
            {gearOpen && typeof document !== "undefined"
              ? createPortal(
              <div ref={gearPanelRef} className="w-60 rounded-md border border-gray-200 bg-white p-2 shadow-lg" style={gearPanelStyle}>
                <div className="mb-2">
                  <label htmlFor="parity-gear-page-size" className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                    Rows per page
                  </label>
                  <select
                    id="parity-gear-page-size"
                    aria-label="Rows per page"
                    className="h-8 w-full rounded-sm border border-gray-300 px-1 text-xs"
                    value={draftPageSize}
                    onChange={(e) => {
                      const next = Number(e.target.value);
                      setDraftPageSize(next);
                      changePageSize(next);
                      savePersisted(storageKey, { hidden: [...draftHidden], density: draftDensity, pageSize: next, colWidths, colOrder });
                    }}
                  >
                    {renderedPageSizeOptions.map((opt) => (
                      <option key={opt} value={opt}>
                        {pageSizeOptionLabel(opt)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                  Density
                </div>
                <div className="mb-2 flex flex-col gap-0.5">
                  {(Object.keys(DENSITY) as ParityDensity[]).map((opt) => (
                    <label key={opt} className="flex items-center gap-2 text-xs text-gray-700">
                      <input
                        type="radio"
                        name="parity-density"
                        checked={draftDensity === opt}
                        onChange={() => setDraftDensity(opt)}
                      />
                      {DENSITY_LABEL[opt]}
                    </label>
                  ))}
                </div>
                <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                  Columns
                </div>
                <div className="max-h-48 overflow-auto">
                  {columns
                    .filter((c) => !c.alwaysVisible)
                    .map((c) => {
                      const key = String(c.key);
                      return (
                        <label
                          key={key}
                          className="flex items-center gap-2 py-0.5 text-xs text-gray-700"
                        >
                          <input
                            type="checkbox"
                            checked={!draftHidden.has(key)}
                            onChange={() => toggleDraftColumn(key)}
                          />
                          {c.label}
                        </label>
                      );
                    })}
                </div>
                {gearExtra ? (
                  <div className="mt-2 border-t border-gray-200 pt-2" data-testid="parity-gear-extra">
                    {gearExtra}
                  </div>
                ) : null}
                <div className="mt-2 flex items-center justify-end gap-2 border-t border-gray-200 pt-2">
                  <button type="button" className="rounded-sm px-2 py-1 text-xs font-semibold text-gray-600 hover:bg-gray-100" onClick={resetGear}>Reset</button>
                  <button type="button" className="rounded-sm border border-gray-300 bg-white px-2 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-50" onClick={cancelGear}>Cancel</button>
                  <button type="button" className="rounded-sm bg-[#1F2A44] px-2 py-1 text-xs font-semibold text-white hover:bg-[#172036]" onClick={applyGear}>Apply</button>
                </div>
              </div>,
              document.body,
            )
            : null}
          </div>
        </div>
      </div>

      {filterBar ? (
        <div className="border-b border-gray-200 px-2 py-1.5">{filterBar}</div>
      ) : null}

      <div className="overflow-x-auto">
      {/* CENTER-EVERYTHING LAW (owner ruling 2026-09-04) — text-align is inherited, so this is the
          one place that flips every header/column that doesn't declare its own alignment. A column
          with an explicit text-right/text-left in its own className (money columns, etc.) still
          wins on its own <td>/<th> — direct declarations beat inheritance regardless of source
          order, so deliberately right-aligned numeric columns are unaffected. */}
      <table
        className={`w-full ${columnLayout === "auto" ? "table-auto" : "table-fixed"} text-center`}
        style={{ fontSize: d.font, ...(minWidthPx ? { minWidth: minWidthPx } : {}) }}
      >
        <thead
          className={stickyHeader ? "sticky top-0 z-10" : ""}
          style={{ backgroundColor: resolvedHeaderBg, color: resolvedHeaderInk }}
          data-table-header="locked"
        >
          {columnGroups ? (
            <tr data-testid="parity-table-column-groups" style={{ height: 24 }}>
              {renderExpanded || selectable ? (
                <th
                  colSpan={(renderExpanded ? 1 : 0) + (selectable ? 1 : 0)}
                  style={{ backgroundColor: colors.tableGroupBandBg, borderRight: `1px solid ${colors.tableColumnRule}`, borderBottom: `1px solid ${colors.tableColumnRule}` }}
                />
              ) : null}
              {(() => {
                const visibleKeys = visibleColumns.map((c) => String(c.key));
                const cells: Array<{ label: string; span: number; bg?: string }> = [];
                for (const key of visibleKeys) {
                  const owningGroup = columnGroups.find((g) => g.keys.includes(key));
                  const last = cells[cells.length - 1];
                  // Coalesce consecutive visible columns belonging to the SAME group into one cell;
                  // an ungrouped column always gets its own untinted cell. Reordering/hiding columns
                  // recomputes this every render (visibleColumns, not a static layout), so a column
                  // dragged out of its group's run just yields more, narrower band cells — never a
                  // stale colspan.
                  if (owningGroup && last && last.label === owningGroup.label) {
                    last.span += 1;
                  } else if (owningGroup) {
                    cells.push({ label: owningGroup.label, span: 1, bg: owningGroup.bg });
                  } else {
                    cells.push({ label: "", span: 1 });
                  }
                }
                return cells.map((cell, index) => (
                  <th
                    key={`${cell.label || "ungrouped"}-${index}`}
                    colSpan={cell.span}
                    className="text-center font-bold uppercase"
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      letterSpacing: 0.9,
                      // DESIGN-CONTRACT: the group band row is one uniform --grp-bg shade (in the
                      // approved reference the per-group b-* classes on band cells are overridden by
                      // the more-specific `thead tr.grp th` rule). Per-group colour lives on BODY tds.
                      backgroundColor: colors.tableGroupBandBg,
                      color: colors.mutedText,
                      borderRight: `1px solid ${colors.tableColumnRule}`,
                      borderBottom: `1px solid ${colors.tableColumnRule}`,
                    }}
                  >
                    {cell.label}
                  </th>
                ));
              })()}
              {rowActions ? (
                <th
                  className="w-10 px-2"
                  style={{ backgroundColor: colors.tableGroupBandBg, borderBottom: `1px solid ${colors.tableColumnRule}` }}
                />
              ) : null}
            </tr>
          ) : null}
          <tr style={{ height: DENSITY[density].rowH }}>
            {renderExpanded ? <th className="w-8 px-2" style={{ backgroundColor: resolvedHeaderBg }} /> : null}
            {selectable ? (
              <th className="w-8 px-2" style={{ backgroundColor: resolvedHeaderBg }}>
                {/* UI CONTROL LAW — same >=24x24 hit-target wrap as the row checkbox. */}
                <span className={MIN_HIT_TARGET_CLASS}>
                  <input
                    type="checkbox"
                    aria-label="Select all on page"
                    checked={pageAllSelected}
                    onChange={togglePageAll}
                  />
                </span>
              </th>
            ) : null}
            {visibleColumns.map((column) => {
              const key = String(column.key);
              // AUTO-FIT — manual resize (colWidths) always wins once the user has dragged a
              // column; until then, size to the column's own content (autoFitWidths) instead of
              // silently truncating under table-fixed's own no-remeasure default.
              const autoFitOrFloor =
                column.minWidth != null
                  ? Math.max(autoFitWidths[key] ?? 0, column.minWidth) || undefined
                  : autoFitWidths[key];
              const w = colWidths[key] ?? autoFitOrFloor;
              return (
                <th
                  key={key}
                  data-testid={column.testId}
                  title={column.headerTitle}
                  // REORDER — draggable on the whole <th>, not a separate handle: the sort button
                  // (a click, no movement) and the resize grip (its own onMouseDown + stopPropagation)
                  // both already coexist fine with a draggable ancestor; a real drag gesture bubbles
                  // to dragstart here regardless of which child the pointer started on.
                  draggable={enableColumnReorder}
                  onDragStart={enableColumnReorder ? () => setDragKey(key) : undefined}
                  onDragOver={
                    enableColumnReorder
                      ? (e) => {
                          e.preventDefault();
                          if (dragKey && dragKey !== key) setDragOverKey(key);
                        }
                      : undefined
                  }
                  onDragLeave={enableColumnReorder ? () => setDragOverKey((cur) => (cur === key ? null : cur)) : undefined}
                  onDrop={
                    enableColumnReorder
                      ? (e) => {
                          e.preventDefault();
                          if (dragKey) moveColumn(dragKey, key);
                          setDragKey(null);
                          setDragOverKey(null);
                        }
                      : undefined
                  }
                  onDragEnd={enableColumnReorder ? () => { setDragKey(null); setDragOverKey(null); } : undefined}
                  className={`relative whitespace-nowrap px-2 font-semibold uppercase ${
                    enableColumnReorder ? "cursor-grab active:cursor-grabbing" : ""
                  } ${dragOverKey === key ? "outline outline-2 -outline-offset-2" : ""} ${column.className ?? ""}`}
                  style={{
                    // ONE-HEIGHT LAW (owner ruling 2026-09-04, ORCH-measured): 30px everywhere a
                    // ParityTable header renders — was emergent from padding/line-height alone, so
                    // two live instances (Dispatch 30px, Load Costs 34px) silently drifted apart.
                    height: spacing.tableHeaderHeight,
                    fontSize: typography.panelHeader ?? 11,
                    fontWeight: headerWeight ?? 700,
                    letterSpacing: 0.3,
                    backgroundColor: dragOverKey === key ? colors.accentTint : resolvedHeaderBg,
                    color: resolvedHeaderInk,
                    // COMPLETE-OUTLINE LAW (owner ruling 2026-09-05, supersedes the 2026-09-04
                    // bottom-only/2px COLUMNS-MUST-DISTINGUISH ruling's border-bottom width): every
                    // th gets a full 1px border box on all four sides, not just a bottom rule —
                    // measured with getComputedStyle, verify-table-design-contract.mjs asserts it.
                    borderTop: `1px solid ${colors.tableColumnRule}`,
                    borderRight: `1px solid ${colors.tableColumnRule}`,
                    borderBottom: `1px solid ${colors.tableColumnRule}`,
                    borderLeft: `1px solid ${colors.tableColumnRule}`,
                    ...(w ? (columnLayout === "auto" ? { minWidth: w } : { width: w }) : {}),
                    ...(dragOverKey === key ? { outlineColor: colors.navy } : {}),
                    ...(key in stickyLeftPx
                      ? {
                          position: "sticky" as const,
                          left: stickyLeftPx[key],
                          zIndex: 3,
                          backgroundColor: dragOverKey === key ? colors.accentTint : resolvedHeaderBg,
                        }
                      : {}),
                  }}
                >
                  {column.sortable !== false ? (
                    <button
                      type="button"
                      // GLOBAL-SORT / Cascade 2026-08-31: hit target must be the full <th> cell
                      // (DataTable already uses w-full). Label-only inline-flex left most of the
                      // header dead; enableColumnResize grip still owns the right w-2 edge.
                      // (CC-3 note: this SORT-01 fix landed via Cursor's own parallel branch first
                      // — per owner coordination, my own equivalent hunk was dropped in favor of
                      // this one rather than double-editing ParityTable's sort button.)
                      className={`inline-flex h-full w-full items-center gap-1 ${
                        /\btext-right\b/.test(column.className ?? "")
                          ? "justify-end"
                          : /\btext-left\b/.test(column.className ?? "")
                            ? "justify-start"
                            : "justify-center"
                      }`}
                      onClick={() => toggleSort(key)}
                    >
                      {column.label}
                      {sortKey === key ? (sortDirection === "asc" ? "▲" : "▼") : null}
                    </button>
                  ) : (
                    column.label
                  )}
                  {enableColumnResize ? (
                    // CUST-CHROME-03: discoverable QBO-style column grip — opaque slate strip +
                    // 8px hit target (was 4–6px near-transparent). Keyboard ←/→ still works.
                    <span
                      role="separator"
                      aria-orientation="vertical"
                      aria-label={`Resize ${column.label}`}
                      title={`Drag to resize ${column.label}`}
                      aria-valuenow={w ? Math.round(w) : undefined}
                      tabIndex={0}
                      data-testid="parity-table-col-resize"
                      onMouseDown={(e) => startResize(key, e)}
                      onTouchStart={(e) => startResizeTouch(key, e)}
                      onKeyDown={(e) => onResizeKey(key, e)}
                      onClick={(e: { stopPropagation(): void }) => e.stopPropagation()}
                      className="absolute right-0 top-0 flex h-full w-2 cursor-col-resize touch-none select-none items-center justify-center border-r border-slate-400 bg-slate-200/90 hover:bg-slate-300 focus:bg-slate-400 focus:outline-hidden"
                    >
                      <span aria-hidden className="block h-3 w-px bg-slate-500" />
                    </span>
                  ) : null}
                </th>
              );
            })}
            {rowActions ? <th className="w-10 px-2" style={{ backgroundColor: resolvedHeaderBg }} /> : null}
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr>
              <td colSpan={colSpan} className="px-2 py-3 text-center text-[11px] text-gray-500">
                Loading…
              </td>
            </tr>
          ) : pageRows.length === 0 ? (
            <tr>
              <td colSpan={colSpan} className="px-2 py-3 text-center text-[11px] text-gray-500">
                {emptyText}
              </td>
            </tr>
          ) : groupBy && groupedPageRows ? (
            // Phase A2 group bands: one full-width band <tr> above each group, rows in their
            // current order. Collapsed groups hide their rows (band stays visible).
            groupedPageRows.map((group) => {
              const isCollapsed = collapsedGroups.has(group.key);
              return (
                <Fragment key={`parity-group:${group.key}`}>
                  <tr
                    className="border-t border-gray-200 bg-gray-50"
                    data-parity-group={group.key}
                  >
                    <td
                      colSpan={colSpan}
                      className="px-2 font-semibold text-gray-800"
                      style={{ paddingTop: d.padY, paddingBottom: d.padY }}
                    >
                      <div className="flex items-center gap-1.5">
                        {groupBy.collapsible ? (
                          <button
                            type="button"
                            aria-label={isCollapsed ? `Expand group ${group.key}` : `Collapse group ${group.key}`}
                            aria-expanded={!isCollapsed}
                            className="text-gray-500 hover:text-gray-800"
                            onClick={() => toggleGroupCollapsed(group.key)}
                          >
                            {isCollapsed ? "▸" : "▾"}
                          </button>
                        ) : null}
                        <div className="min-w-0 flex-1">{groupBy.renderHeader(group.key, group.rows)}</div>
                      </div>
                    </td>
                  </tr>
                  {isCollapsed ? null : group.rows.map((row, i) => renderDataRow(row, i))}
                </Fragment>
              );
            })
          ) : (
            pageRows.map((row, i) => renderDataRow(row, i))
          )}
        </tbody>
        {footerCells ? (
          <tfoot data-testid="parity-table-footer">
            <tr
              className="border-t-2 border-slate-700 font-semibold"
              // Same shade as the group-band row (colors.tableGroupBandBg, --grp-bg) — a totals
              // row reads as its own "band" of the same visual language, not a plain data row.
              style={{ backgroundColor: colors.tableGroupBandBg }}
            >
              {renderExpanded ? <td className="w-8 px-2" /> : null}
              {selectable ? <td className="w-8 px-2" /> : null}
              {visibleColumns.map((column) => {
                const key = String(column.key);
                const entry = footerCells[key];
                const content = typeof entry === "function" ? entry(sortedRows) : entry;
                return (
                  <td
                    key={key}
                    data-testid={column.testId ? `${column.testId}-footer` : undefined}
                    // Same alignment class as this column's own body cells (cellClass ?? className)
                    // — a money/right-aligned column's total right-aligns with zero extra config.
                    className={`px-2 py-1.5 font-mono ${column.cellClass ?? column.className ?? ""}`}
                  >
                    {content ?? null}
                  </td>
                );
              })}
              {rowActions ? <td className="w-10 px-2" /> : null}
            </tr>
          </tfoot>
        ) : footer ? (
          <tfoot data-testid="parity-table-footer">
            <tr className="border-t-2 border-slate-700 bg-slate-50 font-semibold">{footer}</tr>
          </tfoot>
        ) : null}
      </table>
      </div>

      {/* Advanced pager — hidePager (A3) suppresses the built-in chrome so an external pager can own the UI. */}
      {hidePager ? null : (
      <div
        className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-200 px-2 py-1.5 text-[11px]"
        style={{ color: colors.mutedText }}
      >
        <div className="flex items-center gap-2">
          <span>{total === 0 ? "0 of 0" : `${offset + 1}–${Math.min(offset + pageSize, total)} of ${total}`}</span>
          <label className="flex items-center gap-1">
            <span>Per page</span>
            <select
              className="h-6 rounded-sm border border-gray-300 px-1"
              value={pageSize}
              onChange={(e) => changePageSize(Number(e.target.value))}
            >
              {renderedPageSizeOptions.map((opt) => (
                <option key={opt} value={opt}>
                  {pageSizeOptionLabel(opt)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="h-6 rounded-sm border border-gray-300 px-1.5 disabled:opacity-40"
            onClick={() => changePage(1)}
            disabled={safePage <= 1}
          >
            «
          </button>
          <button
            type="button"
            className="h-6 rounded-sm border border-gray-300 px-1.5 disabled:opacity-40"
            onClick={() => changePage(Math.max(1, safePage - 1))}
            disabled={safePage <= 1}
          >
            ‹
          </button>
          {pageButtons.map((p) => (
            <button
              key={p}
              type="button"
              className={`h-6 min-w-6 rounded border px-1.5 ${
                p === safePage ? "text-white" : "border-gray-300 text-gray-700 hover:bg-gray-50"
              }`}
              style={p === safePage ? { backgroundColor: colors.navy, borderColor: colors.navy } : undefined}
              onClick={() => changePage(p)}
            >
              {p}
            </button>
          ))}
          <button
            type="button"
            className="h-6 rounded-sm border border-gray-300 px-1.5 disabled:opacity-40"
            onClick={() => changePage(Math.min(pageCount, safePage + 1))}
            disabled={safePage >= pageCount}
          >
            ›
          </button>
          <button
            type="button"
            className="h-6 rounded-sm border border-gray-300 px-1.5 disabled:opacity-40"
            onClick={() => changePage(pageCount)}
            disabled={safePage >= pageCount}
          >
            »
          </button>
          <span className="ml-1 flex items-center gap-1">
            Page
            <input
              className="h-6 w-12 rounded-sm border border-gray-300 px-1 text-center"
              value={pageInput}
              placeholder={String(safePage)}
              // ARIA-COMBOBOX-NO-NAME: the "Page"/"of N" text around this input is plain sibling
              // text, not linked via htmlFor/aria-labelledby — this backs 33+ list pages app-wide.
              aria-label="Jump to page"
              onChange={(e) => setPageInput(e.target.value.replace(/[^0-9]/g, ""))}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  const n = Number(pageInput);
                  if (n >= 1 && n <= pageCount) changePage(n);
                  setPageInput("");
                }
              }}
            />
            of {pageCount}
          </span>
        </div>
      </div>
      )}
    </div>
  );
}
