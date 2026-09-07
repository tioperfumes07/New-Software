/**
 * LDT-7 · Audit tab in English (register § LDT-7, DESIGN-CONTRACT § Audit).
 *
 * Owner 22:55Z, measured live on load 13526: the Audit tab printed machine codes
 * (`dispatch.load_created`) in the Action column and the block id `P6-D3` (the audit row's
 * `source`) in a column of its own. Law (rule 00 §"Plain English on every operator-visible surface"):
 * no underscores, no machine names, no all-capitals data on screen.
 *
 * This module is the single template dictionary that turns a load's `audit.audit_events`
 * (`event_class` + `payload`) into one English sentence per row, plus the record each row opens.
 * It is deliberately pure and side-effect free so the guard (`scripts/verify-ldt-7-audit-english.mjs`)
 * can exercise it with real and adversarial rows.
 *
 * Codes covered were read from Neon (USMCA, bypass_rls) — the 21 load-scoped `event_class` values
 * present today. Anything not in the dictionary still renders English via `humanizeAuditEventType`
 * (Title-Case with spaces), never the raw code, and the final text is scrubbed of any block-id token
 * so a machine code can never reach the screen.
 */
import type { LoadAuditEvent } from "../../api/loads";
import { humanizeAuditEventType } from "../../lib/humanizeAuditEventType";
import { humanizeEnumLabel } from "../../lib/humanizeEnumLabel";

export type LoadAuditContext = {
  loadId: string;
  loadNumber: string;
  originCity: string | null;
  destCity: string | null;
  customerName: string | null;
  driverName: string | null;
  unitNumber: string | null;
};

/** Every audit row opens the record it describes. For a load-scoped event that is always at least
 *  the load itself, so an Opens target is guaranteed (the guard asserts it can never be null). */
export type LoadAuditOpens = { kind: "load"; id: string; label: string };

export type DescribedLoadAuditRow = {
  /** raw event_class — kept for the CSV export (machine codes stay in the file), never shown. */
  code: string;
  /** raw source (e.g. block id `P6-D3`) — kept for the CSV export, never shown on screen. */
  source: string | null;
  /** the English sentence for the "What happened" column. */
  text: string;
  /** money the event moved, in cents, or null when the event is not a money event. */
  moneyCents: number | null;
  /** the record this row opens. */
  opens: LoadAuditOpens;
};

/** The two shapes a machine token can take on screen, per the guard. Kept in one place so the
 *  sentence builder and the guard test the exact same rule. */
export const RAW_CODE_RE = /^[a-z_.]+$/;
export const BLOCK_ID_RE = /[A-Z]+-\d+-/;

function trimCity(city: string | null | undefined): string | null {
  if (!city) return null;
  const t = String(city).trim();
  return t.length ? t : null;
}

function routeClause(ctx: LoadAuditContext): string {
  const o = trimCity(ctx.originCity);
  const d = trimCity(ctx.destCity);
  return o && d ? ` — ${o} → ${d}` : "";
}

function partiesClause(ctx: LoadAuditContext): string {
  const bits: string[] = [];
  if (ctx.customerName) bits.push(ctx.customerName);
  if (ctx.driverName) bits.push(`driver ${ctx.driverName}`);
  if (ctx.unitNumber) bits.push(ctx.unitNumber);
  return bits.length ? `, ${bits.join(", ")}` : "";
}

function statusClause(ev: LoadAuditEvent): string {
  const p = ev.payload ?? {};
  const raw = p.new_status ?? p.status ?? p.to_status;
  const status = typeof raw === "string" && raw.trim() ? humanizeEnumLabel(raw) : null;
  return status ? `Load status changed to ${status}` : "Load status changed";
}

function channelsClause(ev: LoadAuditEvent): string {
  const c = ev.payload?.channels;
  if (typeof c === "string" && c.trim()) return ` (${c.trim()})`;
  if (Array.isArray(c) && c.length) return ` (${c.map(String).join(", ")})`;
  return "";
}

type Builder = (ev: LoadAuditEvent, ctx: LoadAuditContext) => string;

const DICTIONARY: Record<string, Builder> = {
  "dispatch.load_created": (_e, ctx) => `Load ${ctx.loadNumber} booked${routeClause(ctx)}${partiesClause(ctx)}`,
  "mdata.loads.created": (_e, ctx) => `Load ${ctx.loadNumber} created${routeClause(ctx)}`,
  "dispatch.load.instructions_generated": (_e, ctx) =>
    `Driver and customer instruction sheets generated for load ${ctx.loadNumber}`,
  "dispatch.load.instructions_distributed": (ev, ctx) =>
    `Instruction sheets sent for load ${ctx.loadNumber}${channelsClause(ev)}`,
  "dispatch.load.patched": (_e, ctx) => `Load ${ctx.loadNumber} details edited`,
  "mdata.loads.updated": (_e, ctx) => `Load ${ctx.loadNumber} details updated`,
  "mdata.loads.assigned": (_e, ctx) =>
    `Load ${ctx.loadNumber} assigned to ${ctx.unitNumber ?? "a truck"}${ctx.driverName ? ` and ${ctx.driverName}` : ""}`,
  "dispatch.load.assign_unit": (_e, ctx) => `Truck ${ctx.unitNumber ?? ""} assigned to load ${ctx.loadNumber}`.replace(/\s{2,}/g, " ").trim(),
  "dispatch.load.quick_assigned": (_e, ctx) => `Load ${ctx.loadNumber} quick-assigned to ${ctx.unitNumber ?? "a truck"}`,
  "dispatch.load.reassigned": (_e, ctx) => `Load ${ctx.loadNumber} reassigned to a different truck or driver`,
  "mdata.loads.status_changed": (ev) => statusClause(ev),
  "mdata.load.status_changed": (ev) => statusClause(ev),
  "load.bulk_set_status": (ev) => statusClause(ev),
  "mdata.load_stops.created": (_e, ctx) => `A stop was added to load ${ctx.loadNumber}`,
  "accounting.revrec.earn.posted": (_e, ctx) => `Revenue earned on load ${ctx.loadNumber} posted to the ledger`,
  "accounting.revrec.bill.posted": (_e, ctx) => `Driver pay for load ${ctx.loadNumber} accrued to the ledger`,
  "dispatch.load.cancellation_requested": (_e, ctx) => `Cancellation requested for load ${ctx.loadNumber}`,
  "dispatch.load.cancellation_money_artifacts": (_e, ctx) => `Cancellation reversed the money booked on load ${ctx.loadNumber}`,
  "mdata.loads.cancelled": (_e, ctx) => `Load ${ctx.loadNumber} cancelled`,
  "mdata.loads.quarantined_wrong_entity": (_e, ctx) => `Load ${ctx.loadNumber} quarantined — booked under the wrong company`,
  "mdata.load.quarantine_voided": (_e, ctx) => `Wrong-entity quarantine voided for load ${ctx.loadNumber}`,
  "mdata.loads.restored_for_wrong_entity_void": (_e, ctx) => `Load ${ctx.loadNumber} restored after a wrong-entity void`,
};

const MONEY_KEYS = [
  "amount_cents",
  "total_cents",
  "rate_total_cents",
  "net_cents",
  "gross_cents",
  "driver_pay_cents",
  "revenue_cents",
] as const;

function pickMoneyCents(payload: Record<string, unknown>): number | null {
  for (const k of MONEY_KEYS) {
    const v = payload[k];
    if (typeof v === "number" && Number.isFinite(v) && v !== 0) return v;
  }
  return null;
}

/**
 * Turn one audit event into an English row. The output text is guaranteed to be a plain-English
 * sentence: a known code uses its template, an unknown code is humanized (Title-Case, spaces), and
 * in every case any block-id token is scrubbed — so the result can never match {@link RAW_CODE_RE}
 * or contain a {@link BLOCK_ID_RE} token.
 */
export function describeLoadAuditEvent(ev: LoadAuditEvent, ctx: LoadAuditContext): DescribedLoadAuditRow {
  const builder = DICTIONARY[ev.event_class];
  let text = builder ? builder(ev, ctx) : `${humanizeAuditEventType(ev.event_class)} — load ${ctx.loadNumber}`;

  // Defense-in-depth: strip any block-id token (P6-D3, BT-3-DISPATCH-AUTH-GATES) that a payload
  // string might have carried into a sentence, then collapse whitespace.
  text = text.replace(/\b[A-Z0-9]{1,6}(?:-[A-Z0-9]+){1,}\b/g, "").replace(/\s{2,}/g, " ").trim();

  // Absolute floor: a bare code must never survive as the visible text.
  if (!text || RAW_CODE_RE.test(text) || BLOCK_ID_RE.test(text)) {
    text = `${humanizeAuditEventType(ev.event_class)} — load ${ctx.loadNumber}`;
  }

  return {
    code: ev.event_class,
    source: ev.source ?? null,
    text,
    moneyCents: pickMoneyCents(ev.payload ?? {}),
    opens: { kind: "load", id: ctx.loadId, label: `Load ${ctx.loadNumber}` },
  };
}
