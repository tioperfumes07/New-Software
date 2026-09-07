# IH35-TMS — Global Type & Size Baseline (LOCKED)
Source: Claude + Jorge approved 2026-06-07. Dated measurement record for the 2026-09-04 entries
below: [DESIGN-SPEC-MEASURED-LIVE-2026-09-04.md](./DESIGN-SPEC-MEASURED-LIVE-2026-09-04.md) — this
file is kept current; that one is the "what was measured and why" record.

## Typography
- Base body: 12px
- H1: 22px / weight 600
- Column/section headers (page subheads, not table thead): 11px / weight 700 / UPPERCASE / color #4B5563
- Table header row (ParityTable thead): 11px / weight 700 / UPPERCASE / background #EEF2F6 / text #1F2937 (owner 2026-09-04 — "the blue is too aggressive"; navy #14314F/white retired from table headers, stays on rail/topbar/printed docs only); height 30px, one number for every table (owner ruling 2026-09-04, ORCH-measured — was emergent/undeclared and had drifted to 30px on Dispatch vs 34px on Load Costs)
- Text colors: primary #0F1219 | secondary #1F2A44 | muted #6B7280
- Cell padding: ~7px

## Colors
- Surface (card/panel): #FFFFFF
- Page background: #F7F8FA
- Border: 1px solid #E5E7EB
- Border radius: 2px, one token (`rounded-sm`) everywhere except deliberate pills/avatars (SQUARE-EDGES LAW, owner ruling 2026-09-04, ORCH-measured — was a 2px/4px/0px/9999px mix)
- Left rail (sidebar) + top banner: navy #14314F (NAVY-NOT-BLACK LAW, owner ruling 2026-09-04 —
  was #1B2333/#1F2A44, two different low-saturation shades that both read as near-black; now the
  same blue already owner-approved for the rail and top banner, 2026-09-03; retired from table
  headers 2026-09-04)
- Primary action / status green: #16A34A

## Layout
- Equal paired-field sizes (label + input same width pairing)
- Centered column headers in tables/lists
- Every column header is sortable (click = ascending, second click = descending)
- All headers, columns and KPI values centered, system-wide (owner ruling 2026-09-04)
- Clickable boxes size to their text: 28px height, 12px font, 2px radius, 0 8px padding
  (owner ruling 2026-09-04, ORCH-measured off the banner buttons — the one already-correct case)
- KPI tiles: target 93px (Safety "Active Drivers"), hard ceiling 101px (Safety "Total Safety
  Events"), centered, 2px radius, 1px border, padding 4px 8px, grid gap-2 (owner ruling
  2026-09-04, ORCH-measured)
- Kanban lane headers: centered title (independent of a count badge's width) + a full outline,
  not just a bottom border (owner ruling 2026-09-04, ORCH-measured)

## Application
This baseline applies to ALL screens: lists, catalogs, bills, invoices, registers, drawers, forms, modals, reports. No component may deviate without Jorge's explicit approval.
