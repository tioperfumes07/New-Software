import type { ReactNode } from "react";
import type { ParityColumn } from "../../components/parity/ParityTable";
import { EntityLink } from "../../components/shared/EntityLink";
import { EntityLinkOrTombstone } from "../../components/shared/EntityLinkOrTombstone";
import { visibleDocumentLabel } from "../../lib/entity-label";

/**
 * FAC-08 (owner 2026-09-06: "THE GEAR TO INCLUDE MORE COLUMNS … DRIVER, TRUCK, LOAD AND SETTLEMENT
 * NUMBER … MOST OF THE COST COLUMNS FROM LOAD COSTS").
 *
 * The SINGLE source of truth for the Load-Costs column set the factoring registers expose. One
 * manifest, two consumers (RecoursePipelineTable + ChargebacksTable) — the columns are never
 * hand-authored twice. The cost figures come from the shared backend rollup
 * (accounting/load-cost-rollup.sql.ts), so a row's Costs ties exactly to the Load-Costs page for the
 * same load (money contract: read, never re-derive).
 */
export const LOAD_COST_COLUMN_IDS = [
  "load",
  "driver",
  "unit",
  "settlement",
  "revenue",
  "costs",
  "driver_pay",
  "margin",
  "factoring_fee",
  "reserve",
  "advanced",
  "due",
] as const;

export type LoadCostColumnId = (typeof LOAD_COST_COLUMN_IDS)[number];

/** The canonical fields each consumer adapts its own row into. Cents are integers (or null). */
export interface LoadCostColumnFields {
  loadId: string | null;
  loadNumber: string | null;
  driverId: string | null;
  driverName: string | null;
  unitNumber: string | null;
  settlementNumber: string | null;
  revenueCents: number | null;
  costsCents: number | null;
  driverPayCents: number | null;
  marginCents: number | null;
  factoringFeeCents: number | null;
  reserveCents: number | null;
  advancedCents: number | null;
  dueCents: number | null;
}

const DASH = "—";
const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

/** bigint cents arrive as strings over the wire; coerce honestly (never fabricate a 0). */
export function centsFromWire(value: string | number | null | undefined): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function money(cents: number | null): ReactNode {
  return cents == null ? DASH : usd.format(cents / 100);
}

const MONEY_CELL = "whitespace-nowrap text-right tabular-nums";

/**
 * Build the Load-Costs column set for a register whose row type is R, given an adapter mapping a row
 * to the canonical fields. Column keys are prefixed `lc_` so they never collide with a register's
 * own columns; every column is sortable and appears in the gear/column chooser.
 */
export function buildLoadCostColumns<R>(
  adapt: (row: R) => LoadCostColumnFields,
  opts: { exclude?: readonly LoadCostColumnId[] } = {},
): Array<ParityColumn<R>> {
  const excluded = new Set(opts.exclude ?? []);
  const moneyCol = (
    id: LoadCostColumnId,
    label: string,
    pick: (f: LoadCostColumnFields) => number | null,
    opts: { redWhenNegative?: boolean } = {},
  ): ParityColumn<R> => ({
    key: `lc_${id}`,
    label,
    testId: `lc-col-${id}`,
    sortable: true,
    cellClass: MONEY_CELL,
    sortValue: (row) => pick(adapt(row)) ?? Number.NEGATIVE_INFINITY,
    render: (row) => {
      const cents = pick(adapt(row));
      if (opts.redWhenNegative && cents != null && cents < 0) {
        return <span className="text-[#991B1B]">{money(cents)}</span>;
      }
      return money(cents);
    },
  });

  const all: Array<ParityColumn<R>> = [
    {
      key: "lc_load",
      label: "Load",
      testId: "lc-col-load",
      sortable: true,
      cellClass: "whitespace-nowrap",
      sortValue: (row) => adapt(row).loadNumber ?? "",
      render: (row) => {
        const f = adapt(row);
        return f.loadId ? (
          <EntityLink kind="load" id={f.loadId} label={visibleDocumentLabel(f.loadNumber, f.loadId, "No load #")} />
        ) : (
          DASH
        );
      },
    },
    {
      key: "lc_driver",
      label: "Driver",
      testId: "lc-col-driver",
      sortable: true,
      cellClass: "whitespace-nowrap",
      sortValue: (row) => adapt(row).driverName ?? "",
      render: (row) => {
        const f = adapt(row);
        return f.driverId ? (
          <EntityLinkOrTombstone kind="driver" id={f.driverId} name={f.driverName} noun="Driver" />
        ) : (
          f.driverName || DASH
        );
      },
    },
    {
      key: "lc_unit",
      label: "Truck",
      testId: "lc-col-unit",
      sortable: true,
      cellClass: "whitespace-nowrap",
      sortValue: (row) => adapt(row).unitNumber ?? "",
      render: (row) => adapt(row).unitNumber || DASH,
    },
    {
      key: "lc_settlement",
      label: "Settlement #",
      testId: "lc-col-settlement",
      sortable: true,
      cellClass: "whitespace-nowrap",
      sortValue: (row) => adapt(row).settlementNumber ?? "",
      render: (row) => adapt(row).settlementNumber || DASH,
    },
    moneyCol("revenue", "Revenue", (f) => f.revenueCents),
    moneyCol("costs", "Costs", (f) => f.costsCents),
    moneyCol("driver_pay", "Driver pay", (f) => f.driverPayCents),
    moneyCol("margin", "Margin", (f) => f.marginCents, { redWhenNegative: true }),
    moneyCol("factoring_fee", "Factoring fee", (f) => f.factoringFeeCents),
    moneyCol("reserve", "Reserve", (f) => f.reserveCents),
    moneyCol("advanced", "Advanced", (f) => f.advancedCents),
    moneyCol("due", "Due", (f) => f.dueCents),
  ];
  // A consumer that already renders a native column for one of these ids (e.g. the recourse register
  // has native Advance/Reserve dollar columns) excludes it here so the gear shows no duplicate.
  return excluded.size ? all.filter((col) => !excluded.has(String(col.key).replace(/^lc_/, "") as LoadCostColumnId)) : all;
}
