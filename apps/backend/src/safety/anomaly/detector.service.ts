export type AnomalyFinding = {
  subject_kind: string | null;
  subject_uuid: string | null;
  evidence: Record<string, unknown>;
};

export type DetectorFn = (
  client: { query: <T = Record<string, unknown>>(sql: string, values?: unknown[]) => Promise<{ rows: T[] }> },
  operatingCompanyId: string,
  config: Record<string, unknown>
) => Promise<AnomalyFinding[]>;

async function detectDuplicateLoadNumber(client: Parameters<DetectorFn>[0], oci: string, _config: Record<string, unknown>) {
  const res = await client.query<{ load_number: string; cnt: string; load_ids: string[] }>(
    `SELECT load_number, COUNT(*)::text AS cnt, array_agg(id::text ORDER BY id) AS load_ids
     FROM mdata.loads
     WHERE operating_company_id = $1::uuid AND load_number IS NOT NULL AND load_number <> ''
     GROUP BY load_number HAVING COUNT(*) > 1
     ORDER BY load_number`,
    [oci]
  );
  return res.rows.map((row) => ({
    subject_kind: 'load',
    subject_uuid: row.load_ids?.[0] ?? null,
    evidence: { load_number: row.load_number, duplicate_count: Number(row.cnt), load_ids: row.load_ids },
  }));
}

// BLOCK-1 — fuel-off-route detection is a SAFE NO-OP (returns no findings) until a real data source
// exists. The original query threw Postgres 42P01 on EVERY run: it selected FROM a phantom relation
// (the real table is fuel.fuel_transactions, with a different name) AND read a non-existent
// metadata->>'route_deviation_miles' (fuel.fuel_transactions has NO jsonb/metadata column and no
// precomputed deviation; it does carry location_lat/lng). So this detector never produced findings —
// it only spammed errors. Returning [] stops that. Building real off-route detection (compare each fuel
// stop's location_lat/lng against the load's planned route) is a separate follow-up; flagged for Jorge.
async function detectFuelOffRoute(
  _client: Parameters<DetectorFn>[0],
  _operatingCompanyId: string,
  _config: Record<string, unknown>
): Promise<AnomalyFinding[]> {
  return [];
}

async function detectDvirMajorOpen(client: Parameters<DetectorFn>[0], oci: string, _config: Record<string, unknown>) {
  // Real schema: the DVIR header is safety.dvir_submissions (NOT safety.dvir_reports — phantom), and it
  // carries a precomputed `has_major_defect` boolean. The old query joined a non-existent dvir_reports +
  // dd.dvir_report_id (the FK is dvir_defects.dvir_submission_id) and filtered a non-existent resolved_at,
  // so it threw 42P01/42703 every run. Use the major-defect flag directly.
  //
  // ROUND 16.4 (42P10) — "for SELECT DISTINCT, ORDER BY expressions must appear in select list".
  // `d.id::text AS dvir_id` (a CAST) is a different expression than the bare `d.id` the ORDER BY
  // clause used — Postgres does not treat them as the same select-list item under DISTINCT, so
  // every run threw, aborting the transaction, so EVERY OTHER rule for that tenant then failed
  // with "current transaction is aborted" (evaluateRulesForTenant runs every rule on one client).
  // Fix: order by the output alias, which IS the exact select-list expression.
  const res = await client.query<{ unit_id: string; dvir_id: string }>(
    `SELECT DISTINCT d.unit_id::text AS unit_id, d.id::text AS dvir_id
     FROM safety.dvir_submissions d
     WHERE d.operating_company_id = $1::uuid AND d.has_major_defect = true
     ORDER BY dvir_id`,
    [oci]
  );
  return res.rows.map((row) => ({
    subject_kind: 'unit',
    subject_uuid: row.unit_id,
    evidence: { dvir_id: row.dvir_id, wf: 'WF-050' },
  }));
}

async function detectInactiveDriverAssignment(client: Parameters<DetectorFn>[0], oci: string, _config: Record<string, unknown>) {
  // ROUND 16.4 (42P10) — same class of bug as detectDvirMajorOpen above: `d.id::text AS driver_id`
  // is a cast, a different expression than the bare `d.id` the ORDER BY clause used. Order by the
  // output alias instead.
  const res = await client.query<{ driver_id: string; status: string }>(
    `SELECT DISTINCT d.id::text AS driver_id, d.status::text AS status
     FROM mdata.drivers d
     JOIN mdata.loads l ON l.assigned_primary_driver_id = d.id
                        AND l.operating_company_id = $1::uuid
     WHERE d.operating_company_id = $1::uuid
       AND (d.status <> 'Active' OR d.deactivated_at IS NOT NULL OR d.archived_at IS NOT NULL)
       AND l.status IN ('assigned','dispatched','in_transit')
     ORDER BY driver_id`,
    [oci]
  );
  return res.rows.map((row) => ({
    subject_kind: 'driver',
    subject_uuid: row.driver_id,
    evidence: { status: row.status, wf: 'WF-038' },
  }));
}

async function detectGeofenceDuplicateFire(client: Parameters<DetectorFn>[0], oci: string, _config: Record<string, unknown>) {
  const res = await client.query<{ geofence_id: string; unit_id: string; fire_count: string }>(
    `SELECT geofence_id, unit_id, COUNT(*)::text AS fire_count
     FROM safety.integrity_findings
     WHERE operating_company_id = $1::uuid AND anomaly_class = 'duplicate_fire'
       AND report_date >= CURRENT_DATE - 1 AND resolved = false
     GROUP BY geofence_id, unit_id
     ORDER BY geofence_id, unit_id`,
    [oci]
  );
  return res.rows.map((row) => ({
    subject_kind: 'geofence',
    subject_uuid: null,
    evidence: { geofence_id: row.geofence_id, unit_id: row.unit_id, fire_count: Number(row.fire_count) },
  }));
}

// PM-due detection is a SAFE NO-OP — maintenance.work_orders has NO scheduling-date column
// (the query read wo.scheduled_start_at + wo.category='pm', neither of which exists; the real columns are
// wo_type/source_type/status). It threw 42703 every run. PM-due advisories belong to the PM-interval /
// countdown system, not a WO scheduled date; flagged for a real implementation. Returning [] stops the error.
async function detectPmDueAdvisory(
  _client: Parameters<DetectorFn>[0],
  _operatingCompanyId: string,
  _config: Record<string, unknown>
): Promise<AnomalyFinding[]> {
  return [];
}

export const DETECTOR_REGISTRY: Record<string, DetectorFn> = {
  duplicate_load_number: detectDuplicateLoadNumber,
  fuel_off_route_geo: detectFuelOffRoute,
  dvir_major_open_unit: detectDvirMajorOpen,
  inactive_driver_assignment: detectInactiveDriverAssignment,
  geofence_duplicate_fire: detectGeofenceDuplicateFire,
  pm_due_advisory: detectPmDueAdvisory,
};

export function getDetector(name: string): DetectorFn | undefined {
  return DETECTOR_REGISTRY[name];
}
