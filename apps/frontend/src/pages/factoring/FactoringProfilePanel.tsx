import { useState } from "react";
import { Button } from "../../components/Button";
import { FlatFieldGrid } from "../../components/layout/FlatFieldGrid";
import { EntityLink } from "../../components/shared/EntityLink";
import type { Factor } from "../../api/factoring";
import { parseRemittanceDetails, rateToPctString } from "../../lib/factorProfile";

type Props = {
  factor: Factor;
  saving?: boolean;
  onSave: () => void;
  /**
   * FAC-07 (owner 2026-09-06 22:3xZ "THE FACTORING PROFILE OCCUPIES THE ENTIRE SCREEN"). The
   * full 15-field grid pushed the tab strip below the fold. `compact` renders the ≤220px card
   * that sits in the right 5/12 column next to the KPI tiles: name + EntityLink to the vendor,
   * one rate line, one contact line, and the full grid tucked behind a "Details ▾" disclosure.
   */
  variant?: "full" | "compact";
  /** mdata.vendors id (FactoringSummary.active_factor_id) — the real vendor this factor is. */
  vendorId?: string | null;
};

function dash(value: string | number | null | undefined): string {
  if (value == null || value === "") return "—";
  return String(value);
}

const FULL_FIELDS = (factor: Factor) => {
  const remit = parseRemittanceDetails(factor.remittance_details);
  const feeTiers = Array.isArray(factor.fee_schedule) ? factor.fee_schedule.length : 0;
  const reserveTiers = Array.isArray(factor.reserve_schedule) ? factor.reserve_schedule.length : 0;
  return [
    { label: "Advance rate %", value: dash(rateToPctString(factor.advance_rate)) },
    { label: "Fee rate %", value: dash(rateToPctString(factor.fee_rate)) },
    { label: "Reserve rate %", value: dash(rateToPctString(factor.reserve_rate)) },
    { label: "Recourse days", value: dash(factor.recourse_days) },
    { label: "Telephone", value: dash(remit.telephone) },
    { label: "Address", value: dash(remit.address) },
    { label: "General email", value: dash(remit.generalEmail) },
    { label: "Primary contact", value: dash(remit.primaryContactName) },
    { label: "Primary contact email", value: dash(remit.primaryContactEmail) },
    { label: "Accounting contact", value: dash(remit.accountingContact) },
    { label: "Disputes contact", value: dash(remit.disputesContact) },
    { label: "Escrow reserves % (extra)", value: dash(remit.escrowReservesPct) },
    { label: "Late fees % (extra)", value: dash(remit.lateFeesPct) },
    { label: "Chargebacks % (extra)", value: dash(remit.chargebacksPct) },
    {
      label: "Tier schedules",
      value: feeTiers || reserveTiers ? `fee ${feeTiers} · reserve ${reserveTiers}` : "Flat rates only",
    },
  ];
};

export function FactoringProfilePanel({ factor, saving, onSave, variant = "full", vendorId }: Props) {
  const [detailsOpen, setDetailsOpen] = useState(false);

  if (variant === "compact") {
    const remit = parseRemittanceDetails(factor.remittance_details);
    const contact = remit.primaryContactName || remit.telephone || remit.generalEmail || "—";
    return (
      <section
        className="rounded-sm border border-gray-200 bg-white p-3 text-xs"
        data-testid="factoring-profile-panel"
        data-factoring-profile-panel
        data-factoring-profile-compact
        // FAC-07 hard ceiling: the collapsed card never grows past 220px next to the KPI row.
        style={detailsOpen ? undefined : { maxHeight: 220, overflow: "hidden" }}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="truncate font-semibold text-gray-900" title={factor.name}>
              {vendorId ? (
                <EntityLink kind="vendor" id={vendorId} label={factor.name} />
              ) : (
                factor.name
              )}
            </h3>
            <p className="text-xs text-gray-500">Primary factoring company on file</p>
          </div>
          <Button size="sm" variant="secondary" onClick={onSave} loading={saving} data-testid="factoring-profile-edit">
            Edit
          </Button>
        </div>
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-700" data-testid="factoring-profile-rates">
          <span>Advance <b className="text-gray-900">{dash(rateToPctString(factor.advance_rate))}%</b></span>
          <span>Reserve <b className="text-gray-900">{dash(rateToPctString(factor.reserve_rate))}%</b></span>
          <span>Fee <b className="text-gray-900">{dash(rateToPctString(factor.fee_rate))}%</b></span>
          <span>Recourse <b className="text-gray-900">{dash(factor.recourse_days)}d</b></span>
        </div>
        <div className="mt-1 truncate text-xs text-gray-600" title={contact}>Contact: {contact}</div>
        <button
          type="button"
          className="mt-2 text-xs font-medium text-slate-700 hover:underline"
          data-testid="factoring-profile-details-toggle"
          aria-expanded={detailsOpen}
          onClick={() => setDetailsOpen((v) => !v)}
        >
          {detailsOpen ? "Details ▴" : "Details ▾"}
        </button>
        {detailsOpen ? (
          <div className="mt-2 border-t border-gray-100 pt-2">
            <FlatFieldGrid columns={2} fields={FULL_FIELDS(factor)} />
          </div>
        ) : null}
      </section>
    );
  }

  return (
    <section className="rounded-sm border border-gray-200 bg-white p-3 text-xs" data-testid="factoring-profile-panel" data-factoring-profile-panel>
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <h3 className="font-medium text-gray-900">Active factoring company profile</h3>
          <p className="text-xs text-gray-500">{factor.name} · primary factoring company on file</p>
        </div>
        <Button size="sm" variant="secondary" onClick={onSave} loading={saving} data-testid="factoring-profile-edit">
          Edit factoring profile
        </Button>
      </div>
      <FlatFieldGrid columns={3} fields={FULL_FIELDS(factor)} />
    </section>
  );
}
