import type { FastifyInstance } from "fastify";
import cron from "node-cron";
import { withLuciaBypass } from "../auth/db.js";
import { assertTenantContext } from "./_helpers/tenant-context-guard.js";
import { wrapBackgroundJobTick } from "../lib/background-jobs.js";
import { appendCrudAudit } from "../audit/crud-audit.js";

let initialized = false;

const SYSTEM_ACTOR_ID = process.env.SYSTEM_ACTOR_USER_ID ?? "00000000-0000-0000-0000-000000000001";

/**
 * WIZ-STATUS-01 DURABLE FIX, self-heal half (owner order 2026-09-05, spec §1.1 step 1b): "a
 * self-heal so any load already sitting in that state advances without waiting for a human edit
 * (service-level, not SQL by hand)."
 *
 * draft-crew-status-advance.ts (advanceDraftStatusIfCrewed) closes the hole for every KNOWN write
 * path that assigns a crew going forward. This tick is the backstop for the unknown case: a load
 * that is `draft` today while carrying a committed primary driver/team, OR an OPEN
 * driver_finance.driver_bills row, OR a proforma accounting.invoices row -- any of which means a
 * booked, money-bearing load slipped past every advance-on-write hook (a future write path nobody
 * added the hook to, a bulk import, a migration-era row, etc.). Advances ONLY to
 * `assigned_not_dispatched` -- never further; dispatch remains its own action.
 *
 * Modeled on bank-recon-auto-match.cron.ts's shape: per-company RLS-scoped loop, `withLuciaBypass`,
 * `wrapBackgroundJobTick` for /healthz staleness tracking, an env kill switch, nightly + jittered.
 */
export type DraftCrewStatusSelfHealSummary = {
  companies: number;
  scanned: number;
  advanced: number;
};

export async function runDraftCrewStatusSelfHealTick(
  log?: { info?: (obj: unknown, msg?: string) => void }
): Promise<DraftCrewStatusSelfHealSummary> {
  let totalScanned = 0;
  let totalAdvanced = 0;
  let companyCount = 0;
  await withLuciaBypass(async (client) => {
    const companies = await client.query<{ id: string }>(
      `SELECT id::text AS id FROM org.companies WHERE is_active = true AND deactivated_at IS NULL ORDER BY id`
    );
    companyCount = companies.rows.length;

    for (const company of companies.rows) {
      assertTenantContext(String(company.id ?? ""), "dispatch.draft_crew_status_selfheal_cron");
      await client.query(`SELECT set_config('app.operating_company_id', $1::text, true)`, [company.id]);

      const candidates = await client.query<{ id: string; load_number: string; reason: string }>(
        `
          SELECT l.id::text AS id, l.load_number,
                 CASE
                   WHEN l.assigned_primary_driver_id IS NOT NULL OR l.team_id IS NOT NULL THEN 'crewed'
                   WHEN EXISTS (
                     SELECT 1 FROM driver_finance.driver_bills db
                      WHERE db.load_id = l.id AND db.operating_company_id = l.operating_company_id
                        AND db.status <> 'void'
                   ) THEN 'open_driver_bill'
                   ELSE 'proforma_invoice'
                 END AS reason
            FROM mdata.loads l
           WHERE l.operating_company_id = $1::uuid
             AND l.soft_deleted_at IS NULL
             AND l.status = 'draft'
             AND (
               l.assigned_primary_driver_id IS NOT NULL
               OR l.team_id IS NOT NULL
               OR EXISTS (
                 SELECT 1 FROM driver_finance.driver_bills db
                  WHERE db.load_id = l.id AND db.operating_company_id = l.operating_company_id
                    AND db.status <> 'void'
               )
              OR EXISTS (
                SELECT 1 FROM accounting.invoices inv
                 WHERE inv.source_load_id = l.id AND inv.operating_company_id = l.operating_company_id
                   AND inv.status = 'proforma'
              )
             )
           ORDER BY l.id
           LIMIT 500
        `,
        [company.id]
      );
      totalScanned += candidates.rows.length;

      for (const load of candidates.rows) {
        const advanced = await client.query<{ id: string }>(
          `UPDATE mdata.loads
              SET status = 'assigned_not_dispatched'::mdata.load_status_enum, updated_at = now()
            WHERE id = $1::uuid AND operating_company_id = $2::uuid AND status = 'draft'
            RETURNING id`,
          [load.id, company.id]
        );
        if (advanced.rows[0]?.id) {
          totalAdvanced += 1;
          await appendCrudAudit(
            client,
            SYSTEM_ACTOR_ID,
            "dispatch.load.selfheal_draft_advance",
            {
              resource_type: "mdata.loads",
              resource_id: load.id,
              operating_company_id: company.id,
              load_number: load.load_number,
              reason: load.reason,
              prior_value: "draft",
              new_value: "assigned_not_dispatched",
            },
            "warning",
            "WIZ-STATUS-01"
          );
          log?.info?.(
            { operating_company_id: company.id, load_id: load.id, load_number: load.load_number, reason: load.reason },
            "[draft-crew-status-selfheal] advanced load out of draft"
          );
        }
      }
    }
  });
  const summary: DraftCrewStatusSelfHealSummary = { companies: companyCount, scanned: totalScanned, advanced: totalAdvanced };
  log?.info?.(summary, "[draft-crew-status-selfheal] tick summary");
  return summary;
}

export function initializeDraftCrewStatusSelfHealCron(app: FastifyInstance) {
  if (initialized) return;
  initialized = true;

  if ((process.env.DRAFT_CREW_STATUS_SELFHEAL_CRON_ENABLED ?? "true").trim() === "false") {
    app.log.info("Draft-crew-status self-heal cron disabled via DRAFT_CREW_STATUS_SELFHEAL_CRON_ENABLED=false");
    return;
  }

  // Hourly, offset from the ledger-integrity tick (:20) and staggered like every other cron in
  // this file's family — this check is cheap (LIMIT 500 per company) and default-ON, unlike the
  // heavier nightly bank-recon job, because a crewed-but-draft load blocks the owner from working
  // it at all (no costs, no invoice, no factoring) until the next tick.
  cron.schedule(
    "35 * * * *",
    async () => {
      await wrapBackgroundJobTick(
        "dispatch.draft_crew_status_selfheal_cron",
        async () => {
          await runDraftCrewStatusSelfHealTick(app.log);
        },
        app.log
      );
    },
    {
      maxRandomDelay: 20000 /* cron-stagger (code only) — see PROD-OUTAGE-STEADY-STATE-CRON-PILEUP-CONFIRMED */, timezone: "America/Chicago" }
  );

  app.log.info("Draft-crew-status self-heal cron scheduled (hourly :35, America/Chicago)");
}
