import { getDetector } from "./detector.service.js";
import { notifyAnomalyAlert } from "./notification.service.js";
import type { AnomalyRule, Queryable } from "./types.js";

export async function evaluateRule(client: Queryable, rule: AnomalyRule): Promise<number> {
  const detector = getDetector(rule.detector_function);
  if (!detector) return 0;
  const findings = await detector(client, rule.operating_company_id, rule.threshold_config ?? {});
  let inserted = 0;
  for (const finding of findings) {
    const fingerprint = JSON.stringify([
      rule.operating_company_id,
      rule.uuid,
      finding.subject_kind,
      finding.subject_uuid,
      finding.evidence,
    ]);
    // SAFETY-F6899 — evaluation can be invoked concurrently and runs repeatedly by design. Serialize
    // the canonical finding identity inside the surrounding withCurrentUser transaction, then insert
    // only when the same unresolved finding is not already open. This prevents both duplicate alerts
    // and duplicate high/critical notifications while still allowing a genuinely resolved condition
    // to alert again if it later recurs.
    await client.query(
      `SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))`,
      [fingerprint],
    );
    const res = await client.query<{ uuid: string }>(
      `INSERT INTO safety.anomaly_alerts (
        operating_company_id, rule_uuid, severity, subject_kind, subject_uuid, evidence
      )
      SELECT $1::uuid,$2::uuid,$3,$4,$5::uuid,$6::jsonb
      WHERE NOT EXISTS (
        SELECT 1
        FROM safety.anomaly_alerts existing
        WHERE existing.operating_company_id = $1::uuid
          AND existing.rule_uuid = $2::uuid
          AND existing.subject_kind IS NOT DISTINCT FROM $4
          AND existing.subject_uuid IS NOT DISTINCT FROM $5::uuid
          AND existing.evidence = $6::jsonb
          AND existing.resolution_status IN ('open', 'investigating')
      )
      RETURNING uuid::text`,
      [rule.operating_company_id, rule.uuid, rule.severity, finding.subject_kind,
       finding.subject_uuid, JSON.stringify(finding.evidence)]
    );
    if (res.rows[0]) {
      inserted += 1;
      if (rule.severity === 'high' || rule.severity === 'critical') {
        await notifyAnomalyAlert(client, rule, res.rows[0].uuid, finding.evidence);
      }
    }
  }
  await client.query(`UPDATE safety.anomaly_alert_rules SET last_evaluated_at = now() WHERE uuid = $1::uuid`, [rule.uuid]);
  return inserted;
}

export async function evaluateRulesForTenant(client: Queryable, operatingCompanyId: string, cadenceFilter?: number) {
  const params: unknown[] = [operatingCompanyId];
  let cadenceSql = '';
  if (cadenceFilter != null) {
    cadenceSql = ' AND cadence_minutes <= $2';
    params.push(cadenceFilter);
  }
  const res = await client.query<AnomalyRule>(
    `SELECT uuid::text, operating_company_id, rule_slug, rule_name, category, detector_function,
            threshold_config, severity, is_active, notify_roles, cadence_minutes
     FROM safety.anomaly_alert_rules WHERE operating_company_id = $1::uuid AND is_active = true${cadenceSql}`,
    params
  );
  // ROUND 16.4 (42P10) — evaluateRule runs on this ONE shared client/transaction, rule after rule.
  // A single detector's bad query (e.g. the SELECT DISTINCT/ORDER BY mismatch this round fixed)
  // aborts the WHOLE Postgres transaction, so every rule evaluated AFTER it then fails with
  // "current transaction is aborted, commands ignored until end of transaction block" — a real,
  // cascading production symptom (Render logs showed exactly this, every cadence, for TRANSP/TRK/
  // USMCA alike). SAVEPOINT-isolate each rule so one bad detector can never poison its siblings —
  // its own error is caught and reported, everything else in the batch still runs.
  let alerts = 0;
  const errors: Array<{ rule_slug: string; error: string }> = [];
  for (const rule of res.rows) {
    await client.query(`SAVEPOINT anomaly_rule_eval`);
    try {
      alerts += await evaluateRule(client, rule);
      await client.query(`RELEASE SAVEPOINT anomaly_rule_eval`);
    } catch (error) {
      await client.query(`ROLLBACK TO SAVEPOINT anomaly_rule_eval`);
      await client.query(`RELEASE SAVEPOINT anomaly_rule_eval`);
      errors.push({ rule_slug: rule.rule_slug, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { rules_evaluated: res.rows.length, alerts_created: alerts, errors };
}
