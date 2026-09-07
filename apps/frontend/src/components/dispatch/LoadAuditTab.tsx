/**
 * LDT-7 · Audit tab in English (register § LDT-7). Replaces the generic EntityAuditHistoryTab for a
 * load: rows come from `audit.audit_events` for THIS load only (GET /api/v1/mdata/loads/:id/audit),
 * columns When · Who · What happened · Money · Opens; every row is one English sentence built by
 * describeLoadAuditEvent and links to the record it describes. Filters Range · Type · Who. CSV keeps
 * the machine codes (the file is the archival record); the screen never shows a code or block id.
 * Palette: .ldt-* classes from styles/tokens-load-detail.css — no hex literals here.
 */
import { useMemo, useState } from "react";
import type { LoadDetail } from "../../api/loads";
import { useLoadAudit } from "../../api/loads";
import { entityLabel } from "../../lib/entity-label";
import { EntityLink } from "../shared/EntityLink";
import { DatePicker } from "../forms/DatePicker";
import { formatMoneyCents } from "./constants";
import { describeLoadAuditEvent, type LoadAuditContext } from "./loadAuditSentences";

type Props = {
  load: LoadDetail;
  operatingCompanyId: string;
};

/** 5-column register grid: When · Who · What happened · Money · Opens. */
const LDT_AUDIT_GRID = "160px 130px minmax(200px, 1fr) 110px 130px";

function formatWhen(value: string): string {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString();
}

export function LoadAuditTab({ load, operatingCompanyId }: Props) {
  const auditQuery = useLoadAudit(load.id, operatingCompanyId);

  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [whoFilter, setWhoFilter] = useState("");

  const ctx: LoadAuditContext = useMemo(
    () => ({
      loadId: load.id,
      loadNumber: load.load_number ?? load.id,
      originCity: load.first_pickup_city ?? null,
      destCity: load.first_delivery_city ?? null,
      customerName: load.customer_name ?? null,
      driverName: load.assigned_primary_driver_name ?? null,
      unitNumber: load.assigned_unit_number ?? null,
    }),
    [load]
  );

  const described = useMemo(() => {
    const events = auditQuery.data ?? [];
    return events.map((ev) => ({
      ev,
      row: describeLoadAuditEvent(ev, ctx),
    }));
  }, [auditQuery.data, ctx]);

  const typeOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const { ev, row } of described) {
      if (!map.has(ev.event_class)) map.set(ev.event_class, row.text);
    }
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [described]);

  const filtered = useMemo(() => {
    const fromMs = fromDate ? new Date(`${fromDate}T00:00:00`).getTime() : null;
    const toMs = toDate ? new Date(`${toDate}T23:59:59`).getTime() : null;
    const who = whoFilter.trim().toLowerCase();
    return described.filter(({ ev }) => {
      const t = new Date(ev.created_at).getTime();
      if (fromMs != null && t < fromMs) return false;
      if (toMs != null && t > toMs) return false;
      if (typeFilter && ev.event_class !== typeFilter) return false;
      if (who) {
        const actor = entityLabel(null, ev.actor_user_uuid, "User").toLowerCase();
        if (!actor.includes(who)) return false;
      }
      return true;
    });
  }, [described, fromDate, toDate, typeFilter, whoFilter]);

  const exportCSV = () => {
    // CSV keeps the machine codes and the raw source (block id) — the file is the archival record;
    // only the screen is English. (register § LDT-7)
    const header = ["When", "Who", "What happened", "Money", "Opens", "Event code", "Source"];
    const lines = filtered.map(({ ev, row }) => {
      const money = row.moneyCents != null ? formatMoneyCents(row.moneyCents, load.currency_code) : "";
      return [
        ev.created_at,
        entityLabel(null, ev.actor_user_uuid, "User"),
        row.text,
        money,
        row.opens.label,
        ev.event_class,
        ev.source ?? "",
      ]
        .map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`)
        .join(",");
    });
    const csv = [header.join(","), ...lines].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `load-${ctx.loadNumber}-audit.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="ldt-body" data-testid="load-audit-tab">
      <div className="ldt-rowbar">
        <span className="ldt-muted">Every change to this load, in order — click a row to open the record it changed.</span>
        <div className="ldt-actions">
          <div className="ldt-fld">
            <label>Range from</label>
            <DatePicker value={fromDate} onChange={setFromDate} data-testid="load-audit-from" />
          </div>
          <div className="ldt-fld">
            <label>to</label>
            <DatePicker value={toDate} onChange={setToDate} data-testid="load-audit-to" />
          </div>
          <div className="ldt-fld">
            <label>Type</label>
            <select
              className="ldt-inp"
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              data-testid="load-audit-type"
            >
              <option value="">All types</option>
              {typeOptions.map(([code, label]) => (
                <option key={code} value={code}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div className="ldt-fld">
            <label>Who</label>
            <input
              className="ldt-inp"
              type="text"
              placeholder="user"
              value={whoFilter}
              onChange={(e) => setWhoFilter(e.target.value)}
              data-testid="load-audit-who"
            />
          </div>
          <button type="button" className="ldt-btn g" onClick={exportCSV} disabled={!filtered.length} data-testid="load-audit-export">
            Export CSV
          </button>
        </div>
      </div>

      {auditQuery.isError ? (
        <div className="ldt-note bad">Couldn't load the audit history for this load. Try again.</div>
      ) : (
        // Div-based register (no raw table element) so it routes through one consolidated surface —
        // go26 consolidation ratchet. Same .ldt-* palette, columns and behaviour as before.
        <div className="ldt-card">
          <div className="ldt-rows" role="table" data-testid="load-audit-table">
            <div className="ldt-row head" role="row" style={{ gridTemplateColumns: LDT_AUDIT_GRID }}>
              <span role="columnheader">When</span>
              <span role="columnheader">Who</span>
              <span role="columnheader">What happened</span>
              <span role="columnheader" className="ldt-right">Money</span>
              <span role="columnheader">Opens</span>
            </div>
            {auditQuery.isLoading ? (
              <div className="ldt-row" role="row">
                <span className="ldt-muted">Loading audit history…</span>
              </div>
            ) : filtered.length === 0 ? (
              <div className="ldt-row" role="row">
                <span className="ldt-muted">No audit events for this load in the selected range.</span>
              </div>
            ) : (
              filtered.map(({ ev, row }) => (
                <div
                  key={ev.uuid}
                  className="ldt-row"
                  role="row"
                  data-testid={`load-audit-row-${ev.uuid}`}
                  style={{ gridTemplateColumns: LDT_AUDIT_GRID, alignItems: "start" }}
                >
                  <span role="cell" className="ldt-mono" style={{ whiteSpace: "nowrap" }}>
                    {formatWhen(ev.created_at)}
                  </span>
                  <span role="cell">
                    {ev.actor_user_uuid ? (
                      <EntityLink kind="user" id={ev.actor_user_uuid} label={entityLabel(null, ev.actor_user_uuid, "User")} />
                    ) : (
                      <span className="ldt-muted">System</span>
                    )}
                  </span>
                  <span role="cell">{row.text}</span>
                  <span role="cell" className="ldt-m">
                    {row.moneyCents != null ? formatMoneyCents(row.moneyCents, load.currency_code) : "—"}
                  </span>
                  <span role="cell">
                    <EntityLink kind={row.opens.kind} id={row.opens.id} label={row.opens.label} />
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
