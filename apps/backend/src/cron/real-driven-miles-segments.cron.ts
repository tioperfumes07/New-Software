import type { FastifyInstance } from "fastify";
import cron from "node-cron";
import { withLuciaBypass } from "../auth/db.js";
import { wrapBackgroundJobTick } from "../lib/background-jobs.js";
import { getRealDrivenMilesSegmentStatus, materializeRealDrivenMilesSegments } from "../integrations/samsara/geofences/real-driven-miles.service.js";

const USMCA_COMPANY_ID = "5c854333-6ea5-4faa-af31-67cb272fef80";
const CRON_NAME = "telematics.real_driven_miles_segments";
let initialized = false;

export function initializeRealDrivenMilesSegmentsCron(app: FastifyInstance) {
  if (initialized) return;
  initialized = true;
  cron.schedule("*/15 * * * *", async () => {
    await wrapBackgroundJobTick(CRON_NAME, async () => {
      const rows = await withLuciaBypass((client) => materializeRealDrivenMilesSegments(client, {
        operatingCompanyId: USMCA_COMPANY_ID,
      }));
      const status = await withLuciaBypass((client) => getRealDrivenMilesSegmentStatus(client, USMCA_COMPANY_ID));
      app.log.info(
        { operating_company_id: USMCA_COMPANY_ID, segments_written: rows.length, ...status },
        `${CRON_NAME} complete`
      );
    }, app.log);
  }, { timezone: "America/Chicago", maxRandomDelay: 20_000 });
  app.log.info(`${CRON_NAME} scheduled (every 15 minutes, America/Chicago)`);
}
