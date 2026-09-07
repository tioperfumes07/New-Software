import { withSavepoint } from "../auth/db.js";
import { getComparableMetrics, getUnitFinancialYTD } from "./unit-financial.service.js";
import { getLatestHosClocksByDriver } from "../integrations/samsara/samsara-hos-clocks-pull.service.js";
import type { PgClient } from "../integrations/samsara/samsara.service.js";
import { excludeInsuranceFixtureSql } from "../insurance/insurance-visibility.js";
import { form2290DueDateForFirstUse } from "../compliance/form-2290-generator.js";

type DbClient = {
  query: <T = Record<string, unknown>>(sql: string, values?: unknown[]) => Promise<{ rows: T[] }>;
};

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function numericFromUnknown(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim()) return Number(value);
  const obj = asObject(value);
  if (!obj) return NaN;
  if (obj.value != null) return Number(obj.value);
  if (obj.meters != null) return Number(obj.meters);
  return NaN;
}

function milesFromPossibleMeters(raw: unknown, treatAsMeters: boolean): number {
  const n = numericFromUnknown(raw);
  if (!Number.isFinite(n) || n < 0) return NaN;
  if (treatAsMeters) return n * 0.000621371;
  return n;
}

export function parseSamsaraVehiclePayload(raw: unknown) {
  const payload = asObject(raw) ?? {};
  const record = asObject(payload.data) ?? asObject(payload.vehicle) ?? asObject(payload.stats) ?? payload;
  const odometerMeters =
    record.obdOdometerMeters ?? record.gatewayOdometerMeters ?? payload.obdOdometerMeters ?? payload.gatewayOdometerMeters;
  const odometerRaw =
    odometerMeters ??
    record.odometer_mi ??
    record.odometerMiles ??
    record.odometer_miles ??
    record.odometer ??
    payload.odometer;
  const odometer = milesFromPossibleMeters(odometerRaw, Boolean(odometerMeters));
  const engineSeconds = record.obdEngineSeconds ?? payload.obdEngineSeconds;
  const engineHoursRaw =
    record.engine_hours ?? record.engineHours ?? payload.engine_hours ?? engineSeconds ?? record.engineHours;
  const engineHours = engineSeconds
    ? numericFromUnknown(engineSeconds) / 3600
    : numericFromUnknown(engineHoursRaw);
  const fuelRaw =
    record.fuelPercents ??
    record.fuelPercent ??
    record.fuel_level_pct ??
    record.fuel_level ??
    payload.fuel_level_pct ??
    payload.fuelPercents;
  const fuel = numericFromUnknown(fuelRaw);
  const faults: Array<{ code: string; severity: string; description: string | null }> = [];
  for (const key of ["dtc_codes", "diagnostics", "faults", "faultCodes"]) {
    const arr = record[key] ?? payload[key];
    if (!Array.isArray(arr)) continue;
    for (const item of arr) {
      const obj = asObject(item);
      if (!obj) continue;
      const code = String(obj.code ?? obj.dtc_code ?? obj.id ?? "").trim();
      if (!code) continue;
      faults.push({
        code,
        severity: String(obj.severity ?? obj.level ?? "unknown"),
        description: typeof obj.description === "string" ? obj.description : null,
      });
    }
  }
  return {
    odometer_miles: Number.isFinite(odometer) && odometer >= 0 ? Math.round(odometer) : null,
    engine_hours: Number.isFinite(engineHours) && engineHours >= 0 ? engineHours : null,
    fuel_level_pct: Number.isFinite(fuel) && fuel >= 0 && fuel <= 100 ? fuel : null,
    fault_codes: faults,
  };
}

function daysUntil(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return null;
  return Math.ceil((d.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
}

function complianceColor(days: number | null): "green" | "yellow" | "red" | "gray" {
  if (days === null) return "gray";
  if (days < 0 || days < 7) return "red";
  if (days <= 30) return "yellow";
  return "green";
}

/** Read-only: sum active policy_unit cost_per_month_cents for a unit policy number (insurance.policy). */
async function lookupPolicyMonthlyPremiumCents(
  client: DbClient,
  operatingCompanyId: string,
  unitNumber: string | null | undefined,
  policyNumber: string | null | undefined
): Promise<number | null> {
  if (!policyNumber || !unitNumber) return null;
  const res = await withSavepoint(
    client,
    "unit_aggregate_insurance_premium",
    () =>
      client.query<{ cents: string | null }>(
        `
          SELECT COALESCE(SUM(pu.cost_per_month_cents), 0)::bigint AS cents
          FROM mdata.assets a
          JOIN insurance.policy_unit pu
            ON pu.asset_id = a.id AND pu.removed_at IS NULL
          JOIN insurance.policy p
            ON p.id = pu.policy_id AND p.tenant_id = pu.tenant_id
          WHERE a.tenant_id = $1::uuid
            AND a.unit_code = $2
            AND p.policy_number = $3
            AND p.status = 'active'
            AND p.effective_date <= CURRENT_DATE
            AND p.expiry_date >= CURRENT_DATE
            AND ${excludeInsuranceFixtureSql("p.policy_number")}
        `,
        [operatingCompanyId, unitNumber, policyNumber]
      ),
    { rows: [{ cents: null }] }
  );
  const cents = res.rows[0]?.cents;
  if (cents == null) return null;
  const n = Number(cents);
  return Number.isFinite(n) && n > 0 ? n : null;
}

type LinkedPolicyRow = {
  policy_id: string;
  policy_number: string;
  insurer_name: string;
  coverage_type: string;
  status: string;
  expiration: string | null;
  monthly_premium_cents: string | null;
};

/**
 * P19-MODULE-12-INSURANCE-VEHICLE-PROFILE-REVERSE-LINK — the canonical, real FK chain
 * (mdata.assets.unit_id -> insurance.policy_unit.asset_id -> insurance.policy) is the actual source
 * of truth for a unit's insurance coverage, written by the Insurance module's policy-unit attach
 * flow. Everything else on this page (us_policy/mx_policy below) reads legacy free-text columns on
 * mdata.units that nothing auto-populates from a real policy attach — a unit can carry a genuine,
 * active, FK-linked policy and this page would show "No US or MX policy on file" regardless, because
 * the legacy text fields were never typed in. insurance.policy has no US/MX jurisdiction column (see
 * db/migrations/0274_insurance.sql), so this does not attempt to guess a US/MX slot for a linked
 * policy — it surfaces every real linked policy generically, labelled by coverage type, alongside
 * (never replacing) the legacy us_policy/mx_policy cards.
 *
 * INSURANCE-DASHBOARD-FIXTURE-LEAK (2026-08-23): live-verified on prod — unit T120's "real, FK-linked"
 * policy cited above at fix-time was in fact SAMPLE-REPROVE-5094-VENDOR-0809, an agent guard-selftest
 * fixture (insurer_name "CC3 Verify Vendor"), so this card showed T120 as insured when it carries no
 * real policy. Both this lookup and lookupPolicyMonthlyPremiumCents now exclude fixture-named policies
 * (excludeInsuranceFixtureSql, insurance/insurance-visibility.ts) so a fixture policy can no longer
 * mask a real truck's real coverage gap on the Fleet Unit Profile page.
 */
async function lookupLinkedPolicies(
  client: DbClient,
  operatingCompanyId: string,
  unitId: string
): Promise<{ policies: LinkedPolicyRow[]; unavailable: boolean }> {
  const res = await withSavepoint<{ rows: LinkedPolicyRow[]; unavailable: boolean }>(
    client,
    "unit_aggregate_linked_policies",
    () =>
      client.query<LinkedPolicyRow>(
        `
          SELECT
            p.id::text AS policy_id,
            p.policy_number,
            p.insurer_name,
            p.coverage_type,
            p.status,
            p.expiry_date::text AS expiration,
            pu.cost_per_month_cents::text AS monthly_premium_cents
          FROM mdata.assets a
          JOIN insurance.policy_unit pu
            ON pu.asset_id = a.id AND pu.removed_at IS NULL
          JOIN insurance.policy p
            ON p.id = pu.policy_id AND p.tenant_id = pu.tenant_id
          WHERE a.tenant_id = $1::uuid
            AND a.unit_id = $2::uuid
            AND ${excludeInsuranceFixtureSql("p.policy_number")}
          ORDER BY (p.status = 'active') DESC, p.expiry_date DESC
        `,
        [operatingCompanyId, unitId]
      ).then((result) => ({ ...result, unavailable: false })),
    { rows: [], unavailable: true }
  );
  return { policies: res.rows, unavailable: res.unavailable };
}

async function mapDriverRow(row: Record<string, unknown> | undefined, extra?: Record<string, unknown>) {
  if (!row) return null;
  return {
    id: String(row.id),
    name: [row.first_name, row.last_name].filter(Boolean).join(" ").trim() || null,
    phone: row.phone ?? null,
    photo_url: row.photo_url ?? null,
    ...extra,
  };
}

export async function buildUnitAggregate(
  client: DbClient,
  unitId: string,
  operatingCompanyId: string
): Promise<Record<string, unknown> | null> {
  await client.query(`SELECT set_config('app.operating_company_id', $1::text, true)`, [operatingCompanyId]);

  const unitRes = await client.query(
    `
      SELECT u.*
      FROM mdata.units u
      WHERE u.id = $1::uuid
        AND (
          u.owner_company_id = $2::uuid
          OR u.currently_leased_to_company_id = $2::uuid
        )
      LIMIT 1
    `,
    [unitId, operatingCompanyId]
  );
  const unit = unitRes.rows[0];
  if (!unit) return null;
  const unitCompanyScope = [
    operatingCompanyId,
    unit.owner_company_id ?? null,
    unit.currently_leased_to_company_id ?? null,
  ];

  const platesRes = await client.query(
    `
      SELECT id, country, jurisdiction, plate_number, expiration::text, status
      FROM mdata.unit_plates
      WHERE unit_id = $1::uuid
        AND operating_company_id = $2::uuid
        AND status <> 'archived'
      ORDER BY country, jurisdiction
    `,
    [unitId, operatingCompanyId]
  );

  const samsaraRes = await client.query(
    `
      SELECT sv.samsara_vehicle_id, sv.last_seen_at::text, sv.raw_payload
      FROM integrations.samsara_vehicles sv
      WHERE (
          sv.local_unit_id = $1::uuid
          OR (
            NULLIF(BTRIM(COALESCE($3::text, '')), '') IS NOT NULL
            AND sv.samsara_vehicle_id = BTRIM($3::text)
          )
        )
        AND sv.operating_company_id IN ($2::uuid, $4::uuid, $5::uuid)
      ORDER BY sv.last_seen_at DESC NULLS LAST
      LIMIT 1
    `,
    [unitId, operatingCompanyId, unit.samsara_vehicle_id ?? null, ...unitCompanyScope.slice(1)]
  );
  const samsaraRow = samsaraRes.rows[0];

  const locPayloadRes = await client.query(
    `
      SELECT odometer_mi
      FROM telematics.vehicle_locations
      WHERE unit_id = $1::uuid
        AND operating_company_id IN ($2::uuid, $3::uuid, $4::uuid)
      ORDER BY captured_at DESC NULLS LAST
      LIMIT 1
    `,
    [unitId, ...unitCompanyScope]
  );
  const locParsed = parseSamsaraVehiclePayload(locPayloadRes.rows[0] ?? null);
  const inventoryParsed = parseSamsaraVehiclePayload(samsaraRow?.raw_payload ?? null);
  const mergedParsed = {
    odometer_miles: locParsed.odometer_miles ?? inventoryParsed.odometer_miles,
    engine_hours: locParsed.engine_hours ?? inventoryParsed.engine_hours,
    fuel_level_pct: locParsed.fuel_level_pct ?? inventoryParsed.fuel_level_pct,
    fault_codes: inventoryParsed.fault_codes.length ? inventoryParsed.fault_codes : locParsed.fault_codes,
  };

  const posRes = await client.query(
    `
      SELECT * FROM (
        SELECT
          lat,
          lng,
          speed_mph,
          heading_deg,
          engine_state,
          captured_at,
          odometer_mi,
          city,
          formatted_location,
          'telematics_latest'::text AS source
        FROM telematics.vehicle_latest_position
        WHERE unit_id = $1::uuid
          AND operating_company_id IN ($2::uuid, $3::uuid, $4::uuid)
        UNION ALL
        SELECT
          lat,
          lng,
          speed_mph,
          NULL::numeric AS heading_deg,
          NULL::text AS engine_state,
          recorded_at AS captured_at,
          NULL::double precision AS odometer_mi,
          NULL::text AS city,
          NULL::text AS formatted_location,
          'samsara_positions'::text AS source
        FROM integrations.samsara_vehicle_positions
        WHERE unit_uuid = $1::uuid
          AND operating_company_id IN ($2::uuid, $3::uuid, $4::uuid)
      ) positions
      WHERE lat IS NOT NULL AND lng IS NOT NULL
      ORDER BY captured_at DESC NULLS LAST
      LIMIT 1
    `,
    [unitId, ...unitCompanyScope]
  );
  const posRow = posRes.rows[0] ?? null;
  const latest_position = posRow
    ? {
        ...posRow,
        captured_at: posRow.captured_at != null ? String(posRow.captured_at) : null,
        geofence_label: null,
        book_odometer_mi: unit.odometer_mi ?? null,
      }
    : unit.odometer_mi != null
      ? {
          lat: null,
          lng: null,
          speed_mph: null,
          heading_deg: null,
          engine_state: null,
          captured_at: null,
          odometer_mi: unit.odometer_mi,
          city: null,
          formatted_location: null,
          source: "unit_book",
          geofence_label: null,
          book_odometer_mi: unit.odometer_mi,
        }
      : null;
  const gpsCaptured =
    posRow?.captured_at != null
      ? String(posRow.captured_at)
      : latest_position && typeof latest_position === "object" && "captured_at" in latest_position
        ? (latest_position.captured_at as string | null)
        : null;
  const telemetryParsed = {
    odometer_miles:
      mergedParsed.odometer_miles ??
      (posRow?.odometer_mi != null ? Math.round(Number(posRow.odometer_mi)) : null) ??
      (unit.odometer_mi != null ? Math.round(Number(unit.odometer_mi)) : null),
    engine_hours: mergedParsed.engine_hours,
    fuel_level_pct: mergedParsed.fuel_level_pct,
    fault_codes: mergedParsed.fault_codes,
  };
  const samsara = samsaraRow
    ? {
        samsara_vehicle_id: samsaraRow.samsara_vehicle_id,
        last_seen_at: samsaraRow.last_seen_at ?? gpsCaptured,
        raw_payload_parsed: telemetryParsed,
      }
    : unit.samsara_vehicle_id || telemetryParsed.odometer_miles != null || telemetryParsed.engine_hours != null || telemetryParsed.fuel_level_pct != null
      ? {
          samsara_vehicle_id: unit.samsara_vehicle_id ?? null,
          last_seen_at: gpsCaptured,
          raw_payload_parsed: telemetryParsed,
        }
      : null;

  const defaultDriverRes = await client.query(
    `
      SELECT d.id, d.first_name, d.last_name, d.phone, vda.started_at::text
      FROM telematics.vehicle_driver_assignments vda
      JOIN mdata.drivers d ON d.id = vda.driver_id
                          AND (d.operating_company_id = vda.operating_company_id OR EXISTS (
                            SELECT 1 FROM mdata.driver_company_authorizations aggregate_default_dca
                             WHERE aggregate_default_dca.driver_id = d.id
                               AND aggregate_default_dca.company_id = vda.operating_company_id
                               AND aggregate_default_dca.is_authorized = true
                               AND aggregate_default_dca.deactivated_at IS NULL
                          ))
      WHERE vda.unit_id = $1::uuid
        AND vda.operating_company_id = $2::uuid
        AND vda.is_default = true
        AND vda.ended_at IS NULL
      ORDER BY vda.started_at DESC
      LIMIT 1
    `,
    [unitId, operatingCompanyId]
  );

  const currentDriverRes = await client.query(
    `
      SELECT d.id, d.first_name, d.last_name, d.phone, vda.started_at::text AS logged_in_at, vda.source
      FROM telematics.vehicle_driver_assignments vda
      JOIN mdata.drivers d ON d.id = vda.driver_id
                          AND (d.operating_company_id = vda.operating_company_id OR EXISTS (
                            SELECT 1 FROM mdata.driver_company_authorizations aggregate_current_dca
                             WHERE aggregate_current_dca.driver_id = d.id
                               AND aggregate_current_dca.company_id = vda.operating_company_id
                               AND aggregate_current_dca.is_authorized = true
                               AND aggregate_current_dca.deactivated_at IS NULL
                          ))
      WHERE vda.unit_id = $1::uuid
        AND vda.operating_company_id = $2::uuid
        AND vda.source = 'samsara_webhook'
        AND vda.ended_at IS NULL
      ORDER BY vda.started_at DESC
      LIMIT 1
    `,
    [unitId, operatingCompanyId]
  );

  const default_driver = await mapDriverRow(defaultDriverRes.rows[0]);

  // HOS-FANOUT (Jorge 2026-07-05) — Fleet/Maintenance vehicle profile: the currently-driving
  // (Samsara-linked) driver's HOS is relevant here too (can this truck be released for a road trip /
  // maintenance run right now?). Read the SAME certified Samsara ELD snapshot the dispatch board and
  // driver profile read — verbatim, no re-derivation — so this never drifts from board == roster ==
  // certified ELD. Null (never fabricated) when Samsara hasn't polled this driver.
  const currentDriverId = currentDriverRes.rows[0]?.id ? String(currentDriverRes.rows[0].id) : null;
  const currentDriverEld = currentDriverId
    ? (await getLatestHosClocksByDriver(client as unknown as PgClient, operatingCompanyId)).get(currentDriverId) ?? null
    : null;

  let current_driver = await mapDriverRow(currentDriverRes.rows[0], {
    source: currentDriverRes.rows[0]?.source ?? null,
    logged_in_at: currentDriverRes.rows[0]?.logged_in_at ?? null,
    hos_drive_remaining_min: currentDriverEld?.drive_remaining_min ?? null,
    hos_on_duty_remaining_min: currentDriverEld?.shift_remaining_min ?? null,
    hos_cycle_remaining_min: currentDriverEld?.cycle_remaining_min ?? null,
    hos_source: currentDriverEld ? "samsara_certified_eld" : null,
    hos_polled_at: currentDriverEld?.polled_at ?? null,
    hos_violation: currentDriverEld?.violation ?? null,
  });

  const loadRes = await client.query(
    `
      SELECT
        l.id::text AS load_id,
        l.load_number,
        l.status,
        l.customer_id::text AS customer_id,
        c.customer_name AS customer,
        d.id::text AS driver_id,
        d.first_name AS driver_first_name,
        d.last_name AS driver_last_name,
        (
          SELECT NULLIF(TRIM(CONCAT_WS(', ', ls.city, ls.state)), '')
          FROM mdata.load_stops ls
          WHERE ls.load_id = l.id
          ORDER BY ls.sequence_number ASC
          LIMIT 1
        ) AS pickup,
        (
          SELECT NULLIF(TRIM(CONCAT_WS(', ', ls.city, ls.state)), '')
          FROM mdata.load_stops ls
          WHERE ls.load_id = l.id
          ORDER BY ls.sequence_number DESC
          LIMIT 1
        ) AS delivery,
        (
          SELECT ls.scheduled_arrival_at::text
          FROM mdata.load_stops ls
          WHERE ls.load_id = l.id
          ORDER BY ls.sequence_number DESC
          LIMIT 1
        ) AS eta
      FROM mdata.loads l
      LEFT JOIN LATERAL (
        SELECT scoped_customer.customer_name
        FROM mdata.get_customer_same_company(l.customer_id, l.operating_company_id) scoped_customer
        LIMIT 1
      ) c ON TRUE
      LEFT JOIN mdata.drivers d
        ON d.id = l.assigned_primary_driver_id
       AND (
         d.operating_company_id = l.operating_company_id
         OR EXISTS (
           SELECT 1 FROM mdata.driver_company_authorizations unit_load_driver_dca
           WHERE unit_load_driver_dca.driver_id = d.id
             AND unit_load_driver_dca.company_id = l.operating_company_id
             AND unit_load_driver_dca.is_authorized = true
             AND unit_load_driver_dca.deactivated_at IS NULL
         )
       )
      WHERE l.assigned_unit_id = $1::uuid
        AND l.operating_company_id = $2::uuid
        AND l.soft_deleted_at IS NULL
        AND l.status::text NOT IN ('delivered', 'cancelled', 'void', 'completed', 'closed')
      ORDER BY l.updated_at DESC
      LIMIT 1
    `,
    [unitId, operatingCompanyId]
  );
  const current_load = loadRes.rows[0] ?? null;
  if (!current_driver && current_load?.driver_id) {
    current_driver = await mapDriverRow({
      id: current_load.driver_id,
      first_name: current_load.driver_first_name,
      last_name: current_load.driver_last_name,
    }, {
      source: "dispatch_load",
      logged_in_at: null,
    });
  }

  const woRes = await client.query(
    `
      SELECT
        COUNT(*) FILTER (
          WHERE COALESCE(
            w.bucket::text,
            CASE
              WHEN w.repair_location = 'mobile_roadside' THEN 'roadside'
              WHEN w.repair_location = 'in_house' THEN 'in_house'
              ELSE 'external'
            END
          ) = 'in_house'
        )::int AS in_house,
        COUNT(*) FILTER (
          WHERE COALESCE(
            w.bucket::text,
            CASE
              WHEN w.repair_location = 'mobile_roadside' THEN 'roadside'
              WHEN w.repair_location = 'in_house' THEN 'in_house'
              ELSE 'external'
            END
          ) = 'external'
        )::int AS external,
        COUNT(*) FILTER (
          WHERE COALESCE(
            w.bucket::text,
            CASE
              WHEN w.repair_location = 'mobile_roadside' THEN 'roadside'
              WHEN w.repair_location = 'in_house' THEN 'in_house'
              ELSE 'external'
            END
          ) = 'roadside'
        )::int AS roadside,
        COUNT(*)::int AS total
      FROM maintenance.work_orders w
      WHERE w.unit_id = $1::uuid
        AND w.operating_company_id = $2::uuid
        AND w.voided_at IS NULL
        AND w.status NOT IN ('complete', 'completed', 'cancelled')
    `,
    [unitId, operatingCompanyId]
  );
  const wo = woRes.rows[0] ?? { in_house: 0, external: 0, roadside: 0, total: 0 };

  const pmRes = await client.query(
    `
      SELECT ps.label, ps.next_due_odometer::int, ps.last_service_odometer::int
      FROM maintenance.pm_alerts pa
      JOIN maintenance.pm_schedules ps ON ps.id = pa.pm_schedule_id
                                      AND ps.operating_company_id = pa.operating_company_id
      WHERE pa.unit_id = $1::uuid
        AND pa.operating_company_id = $2::uuid
        AND pa.state IN ('open', 'acknowledged')
      ORDER BY ps.next_due_odometer ASC NULLS LAST
      LIMIT 4
    `,
    [unitId, operatingCompanyId]
  );
  const next_pm_due: Record<string, unknown> = {};
  for (const row of pmRes.rows) {
    const key = String(row.label ?? "general").toLowerCase().replace(/\s+/g, "_");
    const milesRemaining =
      row.next_due_odometer != null && samsara?.raw_payload_parsed?.odometer_miles != null
        ? Number(row.next_due_odometer) - Number(samsara.raw_payload_parsed.odometer_miles)
        : null;
    next_pm_due[key] = {
      miles_remaining: milesRemaining,
      due_date_est: null,
      last_done_odometer: row.last_service_odometer,
    };
  }

  const lastServiceRes = await client.query(
    `
      SELECT
        w.id::text AS wo_id,
        w.display_id,
        w.updated_at::text AS date,
        NULL::int AS odometer,
        w.total_actual_cost AS cost,
        COALESCE(w.external_vendor_id, w.vendor_id)::text AS vendor_id,
        v.vendor_name AS vendor
      FROM maintenance.work_orders w
      LEFT JOIN LATERAL (
        SELECT scoped_vendor.vendor_name
        FROM mdata.get_vendor_same_company(
          COALESCE(w.external_vendor_id, w.vendor_id),
          w.operating_company_id
        ) scoped_vendor
        LIMIT 1
      ) v ON TRUE
      WHERE w.unit_id = $1::uuid
        AND w.operating_company_id = $2::uuid
        AND w.voided_at IS NULL
        AND w.status IN ('complete', 'completed')
      ORDER BY w.updated_at DESC NULLS LAST
      LIMIT 1
    `,
    [unitId, operatingCompanyId]
  );
  const last_service = lastServiceRes.rows[0] ?? null;

  const registration_plates = platesRes.rows.map((p) => ({
    country: p.country,
    jurisdiction: p.jurisdiction,
    expiration: p.expiration,
    days_until_expiration: daysUntil(p.expiration as string),
  }));

  const [annualDotRes, iftaRes, form2290Res, linkedPolicyRead] = await Promise.all([
    client.query(
      `SELECT inspection_date::text AS completed_at, outcome,
              (inspection_date + INTERVAL '1 year')::date::text AS due_at
       FROM maintenance.inspections
       WHERE unit_id = $1::uuid AND operating_company_id = $2::uuid
         AND inspection_type = 'annual_dot' AND status = 'completed' AND archived_at IS NULL
       ORDER BY inspection_date DESC NULLS LAST LIMIT 1`,
      [unitId, operatingCompanyId]
    ),
    client.query(
      `SELECT issued_date::text, expiry_date::text AS due_at, permit_number
       FROM safety.permits
       WHERE unit_id = $1::uuid AND operating_company_id = $2::uuid
         AND permit_type = 'ifta_sticker' AND archived_at IS NULL
       ORDER BY expiry_date DESC LIMIT 1`,
      [unitId, operatingCompanyId]
    ),
    client.query(
      `SELECT f.filing_status, f.tax_period_start::text, f.tax_period_end::text
       FROM compliance.form_2290_filing_vehicles fv
       JOIN compliance.form_2290_filings f
         ON f.id = fv.filing_id AND f.operating_company_id = fv.operating_company_id
       WHERE fv.vehicle_id = $1::uuid AND fv.operating_company_id = $2::uuid
       ORDER BY f.tax_period_start DESC LIMIT 1`,
      [unitId, operatingCompanyId]
    ),
    lookupLinkedPolicies(client, operatingCompanyId, unitId),
  ]);
  const annualDot = annualDotRes.rows[0] ?? null;
  const ifta = iftaRes.rows[0] ?? null;
  const form2290 = form2290Res.rows[0] ?? null;
  const activePolicy = linkedPolicyRead.policies.find((p) => p.status === "active") ?? linkedPolicyRead.policies[0] ?? null;
  const registrationDue = unit.irp_expiration ?? registration_plates.map((p) => p.expiration).filter(Boolean).sort()[0] ?? null;
  const form2290Due = unit.acquired_date ? form2290DueDateForFirstUse(String(unit.acquired_date)) : null;
  const regulatoryStatus = (dueAt: unknown, present: boolean) => {
    if (!present) return "missing";
    const days = daysUntil(dueAt == null ? null : String(dueAt));
    if (days === null) return "needs review";
    if (days < 0) return "expired";
    if (days <= 30) return "due soon";
    return "current";
  };
  const regulatory_requirements = [
    { id: "annual-dot", requirement: "Annual DOT inspection", status: regulatoryStatus(annualDot?.due_at, annualDot?.outcome === "pass"), due_at: annualDot?.due_at ?? null, cadence: "Every 12 months", authority: "49 CFR 396.17" },
    { id: "registration", requirement: "Registration / IRP", status: regulatoryStatus(registrationDue, Boolean(registrationDue)), due_at: registrationDue, cadence: "Recorded registration expiry", authority: "IRP cab card / issuing jurisdiction" },
    { id: "ifta", requirement: "IFTA license / decal", status: regulatoryStatus(ifta?.due_at, Boolean(ifta)), due_at: ifta?.due_at ?? null, cadence: "Recorded permit expiry", authority: "IFTA license and decal" },
    { id: "form-2290", requirement: "Form 2290 HVUT", status: form2290?.filing_status === "accepted" ? "current" : regulatoryStatus(form2290Due, Boolean(form2290)), due_at: form2290Due, cadence: "Last day of month after first use", authority: "IRS Form 2290" },
    { id: "insurance", requirement: "Insurance", status: regulatoryStatus(activePolicy?.expiration, Boolean(activePolicy)), due_at: activePolicy?.expiration ?? null, cadence: "Recorded policy expiry", authority: "Carrier policy term" },
  ];

  const compliance = {
    dot_inspection: { last_date: null, result: null, next_due: null, days_until_due: null },
    us_insurance: {
      policy: unit.us_insurance_policy_number,
      carrier: unit.us_insurance_carrier,
      expiration: unit.us_insurance_expiration,
      days_until_expiration: daysUntil(unit.us_insurance_expiration as string),
      color: complianceColor(daysUntil(unit.us_insurance_expiration as string)),
    },
    mx_insurance: {
      policy: unit.mx_insurance_policy_number,
      carrier: unit.mx_insurance_carrier,
      expiration: unit.mx_insurance_expiration,
      days_until_expiration: daysUntil(unit.mx_insurance_expiration as string),
      color: complianceColor(daysUntil(unit.mx_insurance_expiration as string)),
    },
    registration_plates,
    irp: {
      texas_irp_number: unit.texas_irp_number,
      account: unit.irp_account_number,
      expiration: unit.irp_expiration,
      jurisdictions: unit.irp_registered_jurisdictions,
    },
    sct_permit: {
      number: unit.sct_permit_number,
      expiration: unit.sct_permit_expiration,
      days_until_expiration: daysUntil(unit.sct_permit_expiration as string),
    },
    pita: {
      permit_number: unit.pita_permit_number,
      status: unit.pita_status,
      expiration: unit.pita_expiration,
    },
    ifta_current_quarter_filed: false,
    annual_inspection_status: "unknown",
    regulatory_requirements,
  };

  const maintenance_alerts: Array<{ severity: string; message: string; source: string; created_at: string }> = [];
  for (const fault of samsara?.raw_payload_parsed?.fault_codes ?? []) {
    if (String(fault.severity).toLowerCase() === "high") {
      maintenance_alerts.push({
        severity: "high",
        message: `Fault code ${fault.code}${fault.description ? `: ${fault.description}` : ""}`,
        source: "samsara",
        created_at: new Date().toISOString(),
      });
    }
  }
  const usDays = daysUntil(unit.us_insurance_expiration as string);
  if (usDays !== null && usDays < 0) {
    maintenance_alerts.push({
      severity: "high",
      message: "US insurance expired",
      source: "compliance",
      created_at: new Date().toISOString(),
    });
  } else if (usDays !== null && usDays <= 30) {
    maintenance_alerts.push({
      severity: "medium",
      message: `US insurance expires in ${usDays} days`,
      source: "compliance",
      created_at: new Date().toISOString(),
    });
  }
  for (const plate of registration_plates) {
    const d = plate.days_until_expiration as number | null;
    if (d !== null && d < 0) {
      maintenance_alerts.push({
        severity: "high",
        message: `Plate ${plate.jurisdiction} (${plate.country}) expired`,
        source: "compliance",
        created_at: new Date().toISOString(),
      });
    } else if (d !== null && d <= 60) {
      maintenance_alerts.push({
        severity: "low",
        message: `Plate ${plate.jurisdiction} expires in ${d} days`,
        source: "compliance",
        created_at: new Date().toISOString(),
      });
    }
  }

  const reeferRes = await client.query(
    `
      SELECT
        e.id::text AS attached_trailer_id,
        e.equipment_number,
        e.vin,
        e.reefer_year,
        e.reefer_brand,
        e.reefer_model,
        e.reefer_setpoint_temp_f,
        e.reefer_fuel_capacity_gal,
        e.reefer_service_interval_hours,
        e.reefer_last_service_hours,
        e.reefer_last_service_date::text,
        e.reefer_notes
      FROM mdata.equipment e
      WHERE e.current_unit_id = $1::uuid
        AND (e.owner_company_id = $2::uuid OR e.currently_leased_to_company_id = $2::uuid)
        AND e.equipment_type = 'Reefer'
        AND e.deactivated_at IS NULL
      ORDER BY e.updated_at DESC
      LIMIT 1
    `,
    [unitId, operatingCompanyId]
  );
  const reeferRow = reeferRes.rows[0];
  const engineHours = samsara?.raw_payload_parsed?.engine_hours ?? null;
  const serviceInterval = reeferRow?.reefer_service_interval_hours != null ? Number(reeferRow.reefer_service_interval_hours) : 2000;
  const lastServiceHours = reeferRow?.reefer_last_service_hours != null ? Number(reeferRow.reefer_last_service_hours) : null;
  const hoursUntilService =
    engineHours != null && lastServiceHours != null ? Math.max(0, serviceInterval - (engineHours - lastServiceHours)) : null;
  const reefer = reeferRow
    ? {
        attached_trailer_id: reeferRow.attached_trailer_id,
        equipment_number: reeferRow.equipment_number,
        vin: reeferRow.vin,
        year: reeferRow.reefer_year,
        brand: reeferRow.reefer_brand,
        model: reeferRow.reefer_model,
        setpoint_temp_f: reeferRow.reefer_setpoint_temp_f,
        fuel_capacity_gal: reeferRow.reefer_fuel_capacity_gal,
        service_interval_hours: serviceInterval,
        last_service_hours: reeferRow.reefer_last_service_hours,
        last_service_date: reeferRow.reefer_last_service_date,
        current_hours_from_samsara: engineHours,
        hours_until_service: hoursUntilService,
        cargo_temp_f_current: null,
        notes: reeferRow.reefer_notes,
      }
    : null;

  const financial_ytd = await getUnitFinancialYTD(client, unitId, operatingCompanyId, "YTD");
  const comparable_metrics = await getComparableMetrics(client, unitId, operatingCompanyId, "YTD");

  const recentLoadsRes = await client.query(
    `
      SELECT
        l.id::text AS load_id,
        l.load_number,
        l.created_at::text AS date,
        (
          SELECT NULLIF(TRIM(CONCAT_WS(', ', ls.city, ls.state)), '')
          FROM mdata.load_stops ls WHERE ls.load_id = l.id ORDER BY ls.sequence_number ASC LIMIT 1
        ) AS origin,
        (
          SELECT NULLIF(TRIM(CONCAT_WS(', ', ls.city, ls.state)), '')
          FROM mdata.load_stops ls WHERE ls.load_id = l.id ORDER BY ls.sequence_number DESC LIMIT 1
        ) AS dest,
        l.rate_total_cents AS revenue_cents,
        l.status::text AS status
      FROM mdata.loads l
      WHERE l.assigned_unit_id = $1::uuid
        AND l.operating_company_id = $2::uuid
        AND l.soft_deleted_at IS NULL
      ORDER BY l.created_at DESC
      LIMIT 10
    `,
    [unitId, operatingCompanyId]
  );

  const statusChangesRes = await client.query(
    `
      SELECT uuid::text AS id, created_at::text, event_class, payload
      FROM audit.audit_events
      WHERE (
        (payload->>'resource_type' = 'mdata.units' AND payload->>'resource_id' = $1)
        OR (payload->>'entity_type' = 'unit' AND payload->>'entity_id' = $1)
      )
      ORDER BY created_at DESC
      LIMIT 10
    `,
    [unitId]
  );

  const recentWoRes = await client.query(
    `
      SELECT
        w.id::text AS wo_id,
        w.display_id,
        w.status,
        w.opened_at::text,
        w.total_actual_cost,
        w.description
      FROM maintenance.work_orders w
      WHERE w.unit_id = $1::uuid
        AND w.operating_company_id = $2::uuid
        AND w.voided_at IS NULL
        AND w.status IN ('open', 'in_progress', 'awaiting_parts', 'awaiting_approval', 'scheduled')
      ORDER BY COALESCE(w.updated_at, w.opened_at) DESC NULLS LAST
    `,
    [unitId, operatingCompanyId]
  );

  const photosRes = await client.query(
    `
      SELECT
        p.id::text,
        p.photo_url AS url,
        p.photo_type AS type,
        p.caption,
        p.taken_at::text,
        NULLIF(TRIM(CONCAT_WS(' ', d.first_name, d.last_name)), '') AS driver_name
      FROM mdata.unit_photos p
      LEFT JOIN mdata.drivers d ON d.id = p.uploaded_by_driver_id
                               AND (d.operating_company_id = p.operating_company_id OR EXISTS (
                                 SELECT 1 FROM mdata.driver_company_authorizations photo_dca
                                  WHERE photo_dca.driver_id = d.id
                                    AND photo_dca.company_id = p.operating_company_id
                                    AND photo_dca.is_authorized = true
                                    AND photo_dca.deactivated_at IS NULL
                               ))
      WHERE p.unit_id = $1::uuid
        AND p.operating_company_id = $2::uuid
        AND p.archived_at IS NULL
      ORDER BY p.taken_at DESC NULLS LAST, p.created_at DESC
    `,
    [unitId, operatingCompanyId]
  );

  const documentsRes = await client.query(
    `
      SELECT
        f.id::text AS file_id,
        f.original_filename AS name,
        fc.code AS category,
        f.expiration_date::text AS expiration_date,
        f.created_at::text AS uploaded_at,
        f.r2_key AS url
      FROM docs.file_links fl
      JOIN docs.files f ON f.id = fl.file_id
      LEFT JOIN catalogs.file_categories fc ON fc.id = f.category_id
      WHERE fl.entity_type = 'unit'
        AND fl.entity_id = $1::uuid
        AND fl.deleted_at IS NULL
        AND f.deleted_at IS NULL
        AND f.upload_completed_at IS NOT NULL
        AND f.operating_company_id = $2::uuid
      ORDER BY f.created_at DESC
    `,
    [unitId, operatingCompanyId]
  );

  const assetRes = await withSavepoint(
    client,
    "unit_aggregate_assets",
    () =>
      client.query<{ acquisition_cost_cents: string | null }>(
        `
      SELECT acquisition_cost_cents
      FROM mdata.assets
      WHERE tenant_id = $2::uuid
        AND samsara_unit_id = $3
      LIMIT 1
    `,
        [unitId, operatingCompanyId, unit.samsara_vehicle_id ?? null]
      ),
    { rows: [] as Array<{ acquisition_cost_cents: string | null }> }
  );

  const lifetimeMaintRes = await client.query(
    `
      SELECT COALESCE(SUM(ROUND(COALESCE(total_actual_cost, 0)::numeric * 100)), 0)::bigint AS cents
      FROM maintenance.work_orders
      WHERE unit_id = $1::uuid AND operating_company_id = $2::uuid
    `,
    [unitId, operatingCompanyId]
  );
  const lifetimeFuelRes = await withSavepoint(
    client,
    "unit_aggregate_lifetime_fuel",
    () =>
      client.query<{ cents: string }>(
        `
        SELECT COALESCE(SUM(ROUND(ft.total_cost::numeric * 100)), 0)::bigint AS cents
        FROM fuel.fuel_transactions ft
        JOIN mdata.loads l ON l.id = ft.load_id
                           AND l.operating_company_id = $2::uuid
        WHERE l.assigned_unit_id = $1::uuid AND ft.operating_company_id = $2::uuid
      `,
        [unitId, operatingCompanyId]
      ),
    { rows: [{ cents: "0" }] }
  );

  const purchase_price_cents = assetRes.rows[0]?.acquisition_cost_cents != null ? Number(assetRes.rows[0].acquisition_cost_cents) : null;
  const lifetime_maintenance_cents = Number(lifetimeMaintRes.rows[0]?.cents ?? 0);
  const lifetime_fuel_cents = Number(lifetimeFuelRes.rows[0]?.cents ?? 0);
  const acquired = unit.acquired_date ? new Date(String(unit.acquired_date)) : unit.created_at ? new Date(String(unit.created_at)) : null;
  const months_owned =
    acquired && !Number.isNaN(acquired.getTime())
      ? Math.max(1, Math.round((Date.now() - acquired.getTime()) / (30 * 24 * 60 * 60 * 1000)))
      : null;
  const total_cost_to_date_cents =
    (purchase_price_cents ?? 0) + lifetime_maintenance_cents + lifetime_fuel_cents;

  const unitNumber = unit.unit_number != null ? String(unit.unit_number) : null;
  const [usMonthlyPremiumCents, mxMonthlyPremiumCents] = await Promise.all([
    lookupPolicyMonthlyPremiumCents(client, operatingCompanyId, unitNumber, unit.us_insurance_policy_number as string | null),
    lookupPolicyMonthlyPremiumCents(client, operatingCompanyId, unitNumber, unit.mx_insurance_policy_number as string | null),
  ]);

  return {
    unit,
    plates: platesRes.rows,
    samsara,
    latest_position,
    default_driver,
    current_driver,
    current_load,
    open_wo_count: wo,
    next_pm_due,
    last_service,
    compliance,
    maintenance_alerts,
    reefer,
    financial_ytd,
    recent_activity: {
      loads: recentLoadsRes.rows,
      status_changes: statusChangesRes.rows,
      work_orders: recentWoRes.rows,
    },
    photos: photosRes.rows,
    documents: documentsRes.rows,
    insurance_summary: {
      us_policy: unit.us_insurance_policy_number
        ? {
            number: unit.us_insurance_policy_number,
            carrier: unit.us_insurance_carrier,
            expiration: unit.us_insurance_expiration,
            monthly_premium: usMonthlyPremiumCents,
          }
        : null,
      mx_policy: unit.mx_insurance_policy_number
        ? {
            number: unit.mx_insurance_policy_number,
            carrier: unit.mx_insurance_carrier,
            expiration: unit.mx_insurance_expiration,
            monthly_premium: mxMonthlyPremiumCents,
          }
        : null,
      // Real FK-linked policies (insurance.policy_unit) — never gated on the legacy text fields
      // above, so a policy attached through the Insurance module is visible here even when nobody
      // has hand-typed a matching policy number into this unit's legacy us_/mx_insurance_* columns.
      linked_policies: linkedPolicyRead.policies.map((p) => ({
        policy_id: p.policy_id,
        number: p.policy_number,
        carrier: p.insurer_name,
        expiration: p.expiration,
        monthly_premium: p.monthly_premium_cents != null ? Number(p.monthly_premium_cents) || null : null,
        coverage_type: p.coverage_type,
        status: p.status,
      })),
      linked_policies_unavailable: linkedPolicyRead.unavailable,
      // FLT-08: coverage and documentary evidence are separate facts. Policies use the
      // canonical asset -> policy_unit chain above; signed COIs/policies are canonical
      // docs.files rows linked directly to this unit. Never infer evidence from a policy row.
      insurance_document_count: documentsRes.rows.filter(
        (row) => String(row.category) === "insurance_policy",
      ).length,
    },
    total_ownership_cost: {
      purchase_price_cents,
      lifetime_maintenance_cents,
      lifetime_fuel_cents,
      lifetime_insurance_cents: 0,
      total_cost_to_date_cents,
      months_owned,
      cost_per_month_cents: months_owned ? Math.round(total_cost_to_date_cents / months_owned) : null,
    },
    comparable_metrics,
  };
}
