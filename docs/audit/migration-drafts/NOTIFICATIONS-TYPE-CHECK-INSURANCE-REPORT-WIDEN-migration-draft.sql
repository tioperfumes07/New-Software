-- READY-TO-CLAIM MIGRATION DRAFT (Cursor 2026-09-06, owner "you fix them, we do not defer").
-- Author in the CC-1 morning band (HH 00–11 UTC) OR the Cursor afternoon band (HH 12–23 UTC) per the
-- migration lane-band law — claim the timestamp in db/migrations/CLAIMED-MIGRATION-NUMBERS.json FIRST,
-- merge that claim to origin/main, THEN copy this verbatim to db/migrations/<claimed>_*.sql.
--
-- ROOT CAUSE (measured live, Neon prod br-fancy-credit-akjnd07a, RLS-bypassed):
--   background_jobs.stale reported insurance.monthly_report_by_5th as never_succeeded.
--   Its last_error was the SECONDARY "current transaction is aborted, commands ignored until end of
--   transaction block" — masking the REAL first error. All four gatherReportData() queries pass for
--   USMCA; the failing statement is the notification INSERT. notifications.user_notifications carries
--     CHECK (type = ANY (ARRAY['compliance_expiring','compliance_expired','maintenance_alert',
--                              'load_status','driver_alert','system','message']))
--   but insurance-monthly-report.cron.ts inserts type='insurance_monthly_report' (and, on its own
--   error path, 'insurance_monthly_report_error'). Both values ARE declared in the TS NotificationType
--   union (apps/backend/src/notifications/notification.service.ts) — the DB CHECK was simply never
--   widened to match, so every insert of those types raises a check_violation, aborting the tick.
--
-- FIX: widen the CHECK to the full reproduced superset + the two insurance types. Additive (only
-- widens the accepted set — no existing row can violate a superset), idempotent (DROP IF EXISTS then
-- ADD). Same shape as 202613301900 (sync_alerts severity CHECK add 'error') and the bank-fee-recovery
-- CoA-role CHECK widen. CREATE-only spirit, never DROP a table, never delete a row.
BEGIN;

ALTER TABLE notifications.user_notifications
  DROP CONSTRAINT IF EXISTS user_notifications_type_check;

ALTER TABLE notifications.user_notifications
  ADD CONSTRAINT user_notifications_type_check
  CHECK (type = ANY (ARRAY[
    'compliance_expiring',
    'compliance_expired',
    'maintenance_alert',
    'load_status',
    'driver_alert',
    'system',
    'message',
    'insurance_monthly_report',
    'insurance_monthly_report_error'
  ]));

COMMIT;
