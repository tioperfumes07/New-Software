export const colors = {
  // §7 LOCKED palette (CLAUDE.md §7) — the canonical accent/emphasis tokens. Active states
  // (active tab, active sort, active page, selection, card emphasis) use navy/slate — NEVER blue/
  // purple/pink. These supersede the package's #185fa5 accent (§7 governs). Guarded by
  // verify:section7-palette-maintenance.
  navy: "#1F2A44",
  navyDk: "#0F1729",
  slate: "#334155",
  slateLt: "#64748B",
  accentTint: "#EAECF1", // §7 active-state light tint (selected row / active fill) — replaces light-blue
  // NAVY-NOT-BLACK LAW (owner ruling 2026-09-04) — "#1F2A44" and Sidebar.tsx's separate hardcoded
  // "#1B2333" both read as near-black on most monitors (low saturation despite being technically
  // navy) — the owner's literal complaint: "the app now looks BLACK; owner wants BLUE." Now the
  // same blue already owner-approved for the table header row (#14314F, 2026-09-03) — one blue
  // token for rail + topbar + table header, not three different dark shades.
  topbarBg: "#14314F",
  sidebarBg: "#14314F",
  sidebarBorder: "#2A3242",
  sidebarTextMuted: "#9CA3AF",
  sidebarTextActive: "#FFFFFF",
  sidebarActiveBorder: "#3B82F6",
  bodyBg: "#F7F8FA",
  cardBg: "#FFFFFF",
  cardBorder: "#E5E7EB",
  cardBorderStrong: "#D1D5DB",
  pageHeading: "#0F1219",
  bodyText: "#1F2937",
  mutedText: "#6B7280",
  tinyLabel: "#9CA3AF",
  // GLOBAL-TYPE-SIZE-BASELINE.md: section labels stay 11px/700/UPPERCASE/#4B5563.
  // TABLE-HEADER-RETIRE-NAVY LAW (owner ruling 2026-09-04, verbatim: "in the columns headers i
  // want all centered, and also light background color, the blue is too aggressive, and regular
  // color text centered") — SUPERSEDES the 2026-09-03 navy-fill/white-type ruling directly below.
  // Navy #14314F stays on the left rail, the top banner, and printed document headers; it leaves
  // table headers. Type scale (11px/700/uppercase) and centering are unchanged.
  columnHeader: "#4B5563",
  tableHeaderBg: "#EEF2F6",
  tableHeaderText: "#1F2937",
  // COLUMNS-MUST-DISTINGUISH LAW (owner ruling 2026-09-04, verbatim: "i want the columns to
  // distinguish as i've stated many times before") — reference render:
  // ~/Downloads/09-04-2026-Load-Costs-Board-GROUPED-render.html.
  // TABLE-HEADER-RETIRE-NAVY LAW (owner ruling 2026-09-04, verbatim: "the blue is too aggressive")
  // — navy #14314F/white left table headers for good; it stays on the rail, top banner, and
  // printed document headers only. Guard: scripts/verify-ui-design-system-ratchet.mjs fails hard
  // the moment navy comes back on this specific pair.
  tableHeaderIce: "#EEF2F6", // th-bg, same value as tableHeaderBg — named for the reference doc's own token
  tableHeaderInk: "#1F2937", // th-ink, same value as tableHeaderText
  tableColumnRule: "#C7D2DC", // --line2 (th-border) — 1px rule on header/group-band rows
  tableBodyRule: "#D8DEE6", // --line (body rule) — DESIGN-CONTRACT-LOAD-COSTS-BOARD-2026-09-05.md:
  // header/group rows are --line2 (#C7D2DC, darker); body td rules are the lighter --line (#D8DEE6)
  // — two distinct rule shades, not one reused everywhere.
  tableGroupBandBg: "#E4EAF1", // grp-bg — the grouped band row above column headers
  tableRowStripe: "#FAFBFC", // zebra strip on even body rows
  // Column-group tints (odd rows / even rows) — revenue, trip-expense, driver-pay bands.
  groupTintRevenue: "#EEF4FA",
  groupTintRevenueEven: "#E4EDF6",
  groupTintCost: "#FDF6F3",
  groupTintCostEven: "#F8EDE8",
  groupTintPay: "#F4F1FA",
  groupTintPayEven: "#EDE7F5",
  // KPI-TILE-COLOR LAW (owner ruling 2026-09-04, verbatim: "for all kpis i want different color
  // not just white background a light color to distinguish and darker border").
  kpiTileBg: "#F4F7FA",
  kpiTileBorder: "#C7D2DC",
  safety: { strong: "#DC2626", soft: "#FEE2E2" },
  maintenance: { strong: "#6B7280", soft: "#F3F4F6" },
  dispatch: { strong: "#2563EB", soft: "#DBEAFE" },
  fuel: { strong: "#CA8A04", soft: "#FEF3C7" },
  drivers: { strong: "#16A34A", soft: "#DCFCE7" },
  fleet: { strong: "#7C3AED", soft: "#EDE9FE" },
  accounting: { strong: "#374151", soft: "#F3F4F6" },
  crit: { strong: "#DC2626", soft: "#FEE2E2" },
  warn: { strong: "#CA8A04", soft: "#FEF3C7" },
  info: { strong: "#2563EB", soft: "#DBEAFE" },
  positive: { strong: "#16A34A", soft: "#DCFCE7" },
  pwaBg: "#0F1219",
  pwaCardBg: "#1A2030",
  pwaCardBorder: "#2A3242",
  pwaText: "#E5E7EB",
  pwaTextMuted: "#9CA3AF",
} as const;

export const typography = {
  fontSerif: "'Source Serif Pro', 'Charter', Georgia, serif",
  fontSans: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  pageHeading: 22,
  pageSubtitle: 12,
  sectionSubhead: 11,
  tabItem: 12,
  bodyText: 13,
  bodyTextSmall: 12,
  tableRow: 11,
  kpiLabel: 9,
  kpiNumber: 14,
  statusBadge: 10,
  panelHeader: 11,
  tightUpper: "0.6px",
  looseUpper: "0.8px",
} as const;

export const spacing = {
  topbarHeight: 48,
  topbarPaddingY: 12,
  topbarPaddingX: 18,
  sidebarWidth: 80,
  sidebarItemHeight: 56,
  sidebarItemPaddingY: 8,
  pageContentPadding: 24,
  kpiCardHeight: 30,
  kpiCardPaddingX: 12,
  kpiCardGap: 6,
  subAreaTileHeight: 60,
  subAreaTilePadding: 10,
  subAreaTileGap: 8,
  subAreaTileBorderLeft: 3,
  panelHeaderHeight: 20,
  panelDataRowHeight: 22,
  panelPaddingX: 12,
  panelPaddingY: 10,
  panelBorderTop: 2,
  tableRowHeight: 24,
  // ONE-HEIGHT LAW (owner ruling 2026-09-04, ORCH-measured) — 30, was 26 (DataTable's own prior
  // value, never shared with ParityTable, which had no explicit height at all and drifted to a
  // measured 30px on Dispatch vs 34px on Load Costs, two live instances of the same component).
  // Now the one number both DataTable and ParityTable read.
  tableHeaderHeight: 30,
  tableCellPaddingX: 8,
  // CLICKABLE-BOX-SIZE LAW (owner ruling 2026-09-04, ORCH-measured — supersedes the 2026-09-01
  // uniform-36px ruling below with a new uniform-28px target). ORCH's DESIGN-SPEC-MEASURED-LIVE
  // doc measured the banner buttons as the one already-correct case: 28px / 12px font / 2px
  // radius / 0 8px padding. View toggles (32px/4px radius) and "Back" (16px font) were the wrong
  // cases, corrected by adopting this one number everywhere rather than three.
  // Prior text (owner ruling 2026-09-01) for the record: "one height for every 'md' button
  // regardless of variant, matching filterControlHeight/FILTER_CONTROL_SIZE_CLASS so a button and
  // a filter in the same toolbar row read as one row. Was 32/28/24 (three different button
  // heights — the direct, file-level cause of the owner's 'three different box sizes' report on
  // the accounting toolbar)." That still stands for filterControlHeight (unchanged, see below) —
  // only the button height itself moved again, on new measured numbers.
  buttonHeightPrimary: 28,
  buttonHeightSecondary: 28,
  buttonHeightSmall: 28,
  buttonPaddingX: 8,
  // SQUARE-EDGES LAW (owner ruling 2026-09-04, ORCH-measured) — one token, 2px, was a 4/2/4 mix
  // (and briefly 0 earlier in this same session — corrected before it shipped).
  radiusCard: 2,
  radiusPill: 2,
  radiusButton: 2,
  // KPI-TILE-SIZE LAW (owner ruling 2026-09-04, ORCH-measured off /safety/home with
  // getComputedStyle — supersedes this session's own earlier 68px estimate, which was measured
  // off a different element / methodology). Target = Safety "Active Drivers" = 93px. Hard ceiling
  // = Safety "Total Safety Events" = 101px — nothing may render taller. Load Costs board's tile
  // measured 108px, over the ceiling, and its grid was missing gap-2 (used border-b instead of a
  // full border) — fixed to match Safety's own pattern.
  kpiTileTargetHeight: 93,
  kpiTileMaxHeight: 101,
  kpiTilePaddingY: 4,
  kpiTilePaddingX: 8,
  sectionGap: 16,
  panelGap: 12,
  /** FILTER LAW (COLUMN LAW 2026-09-01) — the one control height every list-toolbar filter shares:
   * the search box (TableSearch), every combobox filter (components/Combobox.tsx's own trigger
   * box), and the Range popover's button/date/number inputs (UniversalListToolbar). Before this,
   * TableSearch was h-8 sitting next to a h-9 Combobox in the SAME row — a real, visible size
   * mismatch across every list page, not a cosmetic nit. Change this ONE number, not per-file
   * h-8/h-9 literals, if the app's control scale ever needs to move. */
  filterControlHeight: 36,
} as const;

/** FILTER LAW — the literal Tailwind class pairing every filter-row control (search box, combobox
 * trigger, range popover fields) must share. A plain string constant (not a computed style) so
 * Tailwind's static class scanner still finds it; the underlying number is `spacing.filterControlHeight`. */
export const FILTER_CONTROL_SIZE_CLASS = "h-9 text-xs";

/** FORM FIELD LAW — a SEPARATE, deliberately shorter scale for a dense data-entry FORM (Book Load
 * and any future wizard), where `Combobox`/`ReferenceSelect`/`EntityPicker` sit on the same grid
 * row as plain `h-7` `<input>` fields, not next to a toolbar search box. FILTER_CONTROL_SIZE_CLASS
 * (h-9) is correct for a list-page toolbar filter (COLUMN LAW 2026-09-01) but produces a visible
 * baseline mismatch when the SAME shared picker is reused as a wizard field beside h-7 inputs —
 * the exact "fields on the same row do not share a baseline" defect
 * (CC-2-INSTRUCTIONS-09-02-2026.txt task 9). `Combobox`'s optional `size="sm"` prop opts into this
 * scale; the default stays `size="md"` (FILTER_CONTROL_SIZE_CLASS), so every existing toolbar/list
 * filter call site is unaffected. */
export const FORM_FIELD_CONTROL_SIZE_CLASS = "h-7 text-xs";

/** CLICKABLE-BOX-SIZE LAW (owner ruling 2026-09-04, ORCH-measured, supersedes the 2026-09-01
 * UI-CONTROL-LAW-SPEC h-9/h-8 scale below) — the app's ONE button scale is now the banner
 * buttons' own already-correct measurement: h-7 (28px), 12px font, px-2 (0 8px padding), 2px
 * radius (Button.tsx applies radiusButton itself). "iconSm" collapses onto the same h-7 — ORCH's
 * spec names one clickable-box target, not a two-tier scale. Prior text, for the record: "md" (the
 * size used everywhere a page renders a real action button — Create, Void, Clear, Export, gear)
 * matched FILTER_CONTROL_SIZE_CLASS's own height so a button and a filter in the same toolbar read
 * as one row; "iconSm" was a second, smaller tier at h-8 (32px) — the "view toggles ... wrong" case
 * in ORCH's own spec. That coupling to FILTER_CONTROL_SIZE_CLASS (filter/search INPUTS, not
 * buttons) is left as-is below; only the button scale itself moves here. */
export const BUTTON_MD_SIZE_CLASS = "h-7 px-2 text-xs font-medium";
export const BUTTON_ICON_SM_SIZE_CLASS = "h-7 text-xs font-medium";

/** UI CONTROL LAW — one size for every toolbar icon app-wide (Search, SlidersHorizontal, the
 * gear, etc.). The gear was the owner's own cited example of a control smaller than its
 * neighbours; this is the neighbours' actual size, standardized as the target rather than left
 * ambiguous. NOT the same as a control's HIT TARGET (BUTTON_ICON_SM_SIZE_CLASS above, or a
 * checkbox's wrapper) — a 16px glyph inside a 32px+ clickable button is the correct, intentional
 * combination per the owner's own ruling ("two different measurements and both must hold"). */
export const TOOLBAR_ICON_SIZE_CLASS = "h-4 w-4";

/** UI CONTROL LAW — the minimum clickable wrapper for a control whose own visual box is smaller
 * than the WCAG 2.2 SC 2.5.8 24x24 CSS px floor (a native checkbox, a small glyph). Wrap the
 * small visual element in a `min-h-6 min-w-6` (24px) flex-centered container; the wrapper is the
 * hit target, the child stays its native/small visual size. */
export const MIN_HIT_TARGET_CLASS = "flex min-h-6 min-w-6 items-center justify-center";

export const z = {
  dropdown: 30,
  modal: 50,
  toast: 60,
} as const;
