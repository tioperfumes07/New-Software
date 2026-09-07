import Fastify from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import { CLOUDFLARE_IP_RANGES, resolveClientIp, type IpResolvable } from "./config/client-ip.js";
import { installEmptyJsonBodyParser } from "./config/empty-json-body-parser.js";
import cron from "node-cron";
import { registerPhoneAuthRoutes } from "./auth/phone-routes.js";
import { registerEmailAuthRoutes } from "./auth/email-routes.js";
import { registerOfficeLoginRoutes } from "./auth/office-login.routes.js";
import { registerInviteAuthRoutes } from "./auth/invite.routes.js";
import { registerAuthRoutes } from "./auth/routes.js";
import { registerSessionMiddleware } from "./auth/session-middleware.js";
import { registerQboOAuthRoutes } from "./integrations/qbo/oauth.routes.js";
import { registerQboWebhookRoutes } from "./integrations/qbo/qbo-webhook.routes.js";
import { registerSamsaraConfigRoutes } from "./integrations/samsara/samsara-config.routes.js";
import { registerSamsaraMasterSyncRoutes } from "./integrations/samsara/samsara-master-sync.routes.js";
import { registerSamsaraLivePositionRoutes } from "./integrations/samsara/positions/live-position.routes.js";
import { registerSamsaraRoutesIntegration } from "./integrations/samsara/routes-integration.routes.js";
import { registerTriSignalRoutes } from "./dispatch/load-status-signal/tri-signal.routes.js";
import { initializeSamsaraPositionPollWorker } from "./jobs/samsara-position-poll-worker.js";
import { registerSamsaraHealthRoutes } from "./integrations/samsara/samsara-health.routes.js";
import { registerSamsaraStatsProbeRoutes } from "./integrations/samsara/samsara-stats-probe.routes.js";
import { registerHosDriverMapPreviewRoutes } from "./integrations/samsara/hos-driver-map-preview.routes.js";
import { registerDriverInactivityPreviewRoutes } from "./mdata/driver-inactivity-preview.routes.js";
import { registerProgramBoardRoutes } from "./program/program-board.routes.js";
import { registerAuditScoreboardRoutes } from "./program/audit-scoreboard.routes.js";
import { warmSystemModuleMatrixAtBoot } from "./program/module-matrix.service.js";
import { registerSamsaraHosReadinessRoutes } from "./integrations/samsara/hos-readiness.routes.js";
import { registerIntegrationHealthRoutes } from "./integrations/integration-health.routes.js";
import { initializeDataSovereigntyDailySync } from "./integrations/samsara/daily-sync-job.js";
import { registerSamsaraEngineFaultRoutes } from "./integrations/samsara/engine-faults/routes.js";
import { registerSamsaraWebhookRoutes } from "./integrations/samsara/samsara-webhook.routes.js";
import { registerRelayFuelBackfillRoute } from "./integrations/relay-payments/relay-fuel-backfill.routes.js";
import { registerRelayFuelCsvImportRoute } from "./integrations/relay-payments/relay-fuel-csv-import.routes.js";
import { registerRelayFuelDriverRematchRoute } from "./integrations/relay-payments/relay-fuel-driver-rematch.routes.js";
import { registerRelayFuelLoadRematchRoute } from "./integrations/relay-payments/relay-fuel-load-rematch.routes.js";
import { registerRelayWalletBankFeedBackfillRoute } from "./integrations/relay-payments/relay-wallet-bank-feed-backfill.routes.js";
import { registerRelayDepositReviewRoutes } from "./integrations/relay-payments/relay-deposit-review.routes.js";
import { registerRelayHealthRoutes } from "./integrations/relay-payments/relay-health.routes.js";
import { registerSamsaraVendorMappingActionsRoutes } from "./integrations/samsara/vendor-mapping-actions.routes.js";
import { registerSamsaraVendorMappingIntegrityRoutes } from "./integrations/samsara/vendor-mapping.routes.js";
import { registerDriverVendorMappingIntegrityRoutes } from "./integrations/integrity-monitors/driver-vendor-mapping.routes.js";
import { initializeDriverVendorMappingWorker } from "./jobs/driver-vendor-mapping-worker.js";
import { registerGeofenceReconciliationRoutes } from "./integrations/samsara/geofences/reconciliation.routes.js";
import { registerGeofenceStateMachineRoutes } from "./integrations/samsara/geofences/state-machine/routes.js";
import { initializeGeofenceReconciliationWorker } from "./jobs/geofence-reconciliation-daily.js";
import { initializeGeofenceStateWatcher } from "./jobs/geofence-state-watcher.js";
import { registerBorderCrossingDetectorRoutes } from "./integrations/samsara/border-crossings/routes.js";
import { registerAutoStatusSwitchRoutes } from "./integrations/samsara/auto-status-switch/routes.js";
import { initializeBorderCrossingDetectorWorker } from "./jobs/border-crossing-detector.js";
import { registerSamsaraVehicleDriverPairingRoutes } from "./integrations/samsara/vehicle-driver-pairing/routes.js";
import { initializeVehicleDriverPairingWorker } from "./jobs/vehicle-driver-pairing-worker.js";
import { initializeAutoStatusSwitchWorker } from "./jobs/auto-status-switch-worker.js";
import { registerActiveDriverSetRoutes } from "./integrations/samsara/active-driver-set/routes.js";
import { initializeActiveDriverSetRecomputeWorker } from "./jobs/active-driver-set-recompute.js";
import { initializeDriverActive30dWorker } from "./jobs/driver-active-30d-worker.js";
import { registerQboForensicAdminRoutes } from "./integrations/qbo/forensic-admin.routes.js";
import { registerQboSyncAdminRoutes } from "./integrations/qbo/qbo-sync-admin.routes.js";
import { registerQboVendorLinkageRoutes } from "./integrations/qbo/qbo-vendor-linkage.routes.js";
import { registerTrkMigrationRoutes } from "./integrations/qbo/trk-migration.js";
import { registerIdentityRoutes } from "./identity/users.routes.js";
import { registerCompanyContextRoutes } from "./identity/company-context.routes.js";
import { registerPasswordResetRoutes } from "./identity/password-reset.routes.js";
import { registerNotificationPreferenceRoutes } from "./identity/notification-prefs.routes.js";
import { registerUserPreferencesRoutes } from "./identity/user-preferences.routes.js";
import { registerWorkflowRoutes } from "./identity/workflow-routes.js";
import { registerVoidCancelRequestRoutes } from "./governance/void-cancel-requests.routes.js";
import { registerIdentityApplicantRoutes } from "./identity/applicants.routes.js";
import { registerAccountingCatalogRoutes } from "./catalogs/accounting/index.js";
import { registerDriverCatalogRoutes } from "./catalogs/driver/index.js";
import { registerSafetyDocRoutes } from "./safetydoc/safetydoc.routes.js";
import { registerDriverAlertRoutes } from "./driveralert/driveralert.routes.js";
import { registerFleetCatalogRoutes } from "./catalogs/fleet/index.js";
import { registerGenericCatalogRoutes } from "./catalogs/generic-catalog.routes.js";
import { registerStubCatalogPurgeRoutes } from "./catalogs/stub-catalog-purge.routes.js";
import { registerFuelCatalogRoutes } from "./catalogs/fuel/index.js";
import { registerCatalogsRoutes } from "./catalogs/index.js";
import { registerCatalogRegistryRoutes } from "./catalogs/catalog-registry.routes.js";
import { registerFileCategoriesRoutes } from "./catalogs/file-categories.routes.js";
import { registerDriverLoadStatusRoutes } from "./catalogs/driver-load-statuses.routes.js";
import { registerEquipmentTypeRoutes } from "./catalogs/equipment-types.routes.js";
import { registerStatesRoutes } from "./catalogs/states.routes.js";
import { registerCatalogsWorkflowRoutes } from "./catalogs/workflow-routes.js";
import { registerLoadCancellationReasonRoutes } from "./catalogs/load-cancellation-reasons.routes.js";
import { registerVoidCancelReasonRoutes } from "./catalogs/void-cancel-reasons.routes.js";
import { registerDispatchFlagColorRoutes } from "./catalogs/dispatch-flag-colors.routes.js";
import { registerDispatchCatalogRoutes } from "./catalogs/dispatch/index.js";
import { registerFactoringQueueRoutes } from "./dispatch/factoring-queue.routes.js";
import { registerSafetyCatalogRoutes } from "./catalogs/safety/index.js";
import { registerDocsFoundationRoutes } from "./docs/docs.routes.js";
import { registerDocsFilesRoutes } from "./docs/files.routes.js";
import { registerAttachmentsRoutes } from "./documents/attachments.routes.js";
import { registerDispatchLoadRoutes } from "./dispatch/loads.routes.js";
import { registerLoadSettlementSummaryRoutes } from "./dispatch/load-settlement-summary.routes.js";
// Orphan-route mounts (batch 1, non-financial) — these route files existed and the frontend calls
// them, but they were never registered (404). Verified uncalled + collision-free before mounting.
import { registerLoadProfitabilityRoutes } from "./dispatch/load-profitability.routes.js";
import { registerCancellationsReportRoutes } from "./dispatch/cancellations-report.routes.js";
import { registerLoadCancellationsAnalyticsRoutes } from "./dispatch/load-cancellations-analytics.routes.js";
import { registerLoadGeofenceTimelineRoutes } from "./dispatch/load-geofence-timeline.routes.js";
import { registerLoadStopsRecordRoutes } from "./dispatch/load-stops-record.routes.js";
import { registerTripPairingBoardRoutes } from "./dispatch/trip-pairing-board.routes.js";
import { registerDriverCommunicationsRoutes } from "./drivers/communications.routes.js";
import { registerDriverAdvancesRoutes } from "./drivers/advances.routes.js";
import { registerMaintenancePartsMasterRoutes } from "./catalogs/maintenance/parts.routes.js";
import { registerMaintenanceServicesCatalogRoutes } from "./catalogs/maintenance/services.routes.js";
// C10 route-manifest parity: the eight maintenance catalogs were exported here and registered
// nowhere, so every one of them 404'd while apps/frontend/src/api/catalogs-maintenance.ts called
// them. Distinct paths from the two lines above (`parts-master`, `services-catalog`) — no collision.
import { registerMaintenanceCatalogRoutes } from "./catalogs/maintenance/index.js";
import { registerDamagePhotoEvidenceRoutes } from "./safety/damage-reports/photo-evidence.routes.js";
import { registerEdiRoutes } from "./integrations/edi/edi.routes.js";
import { registerLoadsBulkRoutes } from "./dispatch/loads-bulk.routes.js";
import { registerDispatchCancelLoadRoutes } from "./dispatch/cancel-load.routes.js";
import { registerDispatchSheetHtmlRoutes } from "./dispatch/dispatch-sheet.routes.js";
import { registerDispatchLoadAssignRoutes } from "./dispatch/load-assign.routes.js";
import { registerDispatchQuicksaveRoutes } from "./dispatch/quicksave.routes.js";
import { registerDispatchAssignmentsQuicksaveRoutes } from "./dispatch/assignments/quicksave.routes.js";
import { registerDispatchCancellationRoutes } from "./dispatch/cancellation.routes.js";
import { registerRateConExtractRoutes } from "./dispatch/ratecon-extract.routes.js";
import { registerDispatchRefinementsRoutes } from "./dispatch/dispatch-refinements.routes.js";
import { registerDeadheadOptimizerRoutes } from "./dispatch/deadhead/routes.js";
import { registerIntransitIssuesRoutes } from "./dispatch/intransit-issues.routes.js";
import { registerDispatchArchTabsRoutes } from "./dispatch/arch-tabs.routes.js";
import { registerDriverDispatchEligibilityRoutes } from "./dispatch/driver-eligibility.routes.js";
import { registerDispatchAlertsRoutes } from "./dispatch/alerts.routes.js";
import { registerDispatchPlannerRoutes } from "./dispatch/planner.routes.js";
import { registerDispatchDetentionRoutes } from "./dispatch/detention.routes.js";
import { registerLayoverRoutes } from "./dispatch/layovers/routes.js";
import { initializeLayoverDetectorWorker } from "./jobs/layover-detector-worker.js";
import { registerEquipmentTransferRoutes } from "./dispatch/equipment-transfer/routes.js";
import { registerLoadStopExtraRateRoutes } from "./dispatch/loads/multi-stop/extra-rate.routes.js";
import { registerDispatchOcrIntakeRoutes } from "./dispatch/ocr-intake.routes.js";
import { registerDispatchCustomerNotifyRoutes } from "./dispatch/customer-notify.routes.js";
import { registerDispatchPodBolRoutes } from "./dispatch/pod.routes.js";
import { registerDispatchViewRoutes } from "./dispatch/driver-pwa/dispatch-view.routes.js";
import { registerDispatcherRoleViewRoutes } from "./dispatcher-board/role-views/routes.js";
import { registerDriverRoutes } from "./driver/index.js";
import { registerDriversMessagesRoutes } from "./drivers/messages.routes.js";
import { registerDriversDocumentAlertsRoutes } from "./drivers/document-alerts.routes.js";
import { initializeDocumentAlertEngineCron } from "./drivers/document-alerts.cron.js";
import { registerGeofencesRoutes } from "./telematics/geofences.routes.js";
import { registerStopsGeocodeBackfillRoutes } from "./telematics/stops-geocode-backfill.routes.js";
import { registerDashcamOnDemandRoutes } from "./telematics/dashcam-on-demand.routes.js";
import { registerTelematicsPositionsRoutes } from "./telematics/positions.routes.js";
import { registerTourCloseRoutes } from "./dispatch/driver-pwa/tour-close.routes.js";
import { registerFleetLocationHosRoutes } from "./telematics/fleet-location-hos.routes.js";
import { registerDriverDaySummaryRoutes } from "./telematics/driver-day-summary.routes.js";
import { registerTelematicsHeatmapRoutes } from "./telematics/heatmap.routes.js";
import { registerDriverFinanceSettlementRoutes } from "./driver-finance/settlements.routes.js";
import { registerSettlementsBulkRoutes } from "./driver-finance/settlements-bulk.routes.js";
import { registerPreSettlementsRoutes as registerC1PreSettlementsRoutes } from "./settlements/pre-settlements.routes.js";
import { registerCustomerContractRoutes } from "./customer-contracts/customer-contract.routes.js";
import { registerPreSettlementRoutes } from "./driver-finance/pre-settlement.routes.js";
import { registerTourReadoutRoutes } from "./driver-finance/tour-readout.routes.js";
import { registerDriverFinanceSettlementHtmlRoutes } from "./driver-finance/settlement-render.routes.js";
import { registerDriverFinanceDriverBillsRoutes } from "./driver-finance/driver-bills.routes.js";
import { registerDriverFinanceDriverBillsListRoutes } from "./driver-finance/driver-bills-list.routes.js";
import { registerDriverFinanceDebtRoutes } from "./driver-finance/debt.routes.js";
import { registerDriverFinanceDeductionRoutes } from "./driver-finance/deductions.routes.js";
import { registerEscrowDeductionPendingRoutes } from "./driver-finance/escrow-deduction-pending.routes.js";
import { registerDriverEscrowSeparationRoutes } from "./driver-finance/escrow-separation.routes.js";
import { registerDriverEscrowForfeitRoutes } from "./driver-finance/escrow-forfeit.routes.js";
import { registerCashAdvanceRequestRoutes } from "./driver-finance/cash-advance-requests.routes.js";
import { registerDriverPaymentMethodRoutes } from "./driver-finance/driver-payment-methods.routes.js";
import { registerPaymentMethodsCatalogRoutes } from "./driver-finance/payment-methods-catalog.routes.js";
import { registerSettlementPayRunCloseRoutes } from "./driver-finance/settlement-payrun-close.routes.js";
import { registerDriverInboxReportingRoutes } from "./driver-finance/inbox-reporting.routes.js";
import { registerOwnerApprovalPortalRoutes } from "./driver-finance/owner-approval.routes.js";
import { registerAbandonmentRoutes } from "./driver-finance/abandonment.routes.js";
import { registerDetentionPayPostingRoutes } from "./driver-finance/detention-pay-posting.routes.js";
import { registerSettlementsDisputesRoutes } from "./settlements/disputes/disputes.routes.js";
import { registerSettlementApprovalRoutes } from "./settlements/approval.routes.js";
import { registerAutoDeductionPolicyRoutes } from "./settlements/auto-deductions/policy.routes.js";
import { registerSettlementDisputeRoutes } from "./driver-finance/settlement-dispute.routes.js";
import { registerSettlementPaymentRoutes } from "./driver-finance/settlement-payment.routes.js";
import { registerHomeRoutes } from "./home/home.routes.js";
import { registerReportsRoutes } from "./reports/index.js";
import { registerReportsScheduledCrudRoutes } from "./reports/scheduled-reports.routes.js";
import { registerScheduledSubscriptionRoutes } from "./reports/scheduled/routes.js";
import { registerCustomReportBuilderRoutes } from "./reports/custom-report-builder.routes.js";
import { initializeReportsRoleScheduler, stopReportsRoleScheduler } from "./reports/scheduler.js";
import { initializeScheduledReportsEmailer } from "./jobs/scheduled-reports-emailer.js";
// LV-REPORTS-CUSTOM-SCHEDULER-CANONICAL-SOR-UNMOUNTED (owner-locked §9.6): reporting.scheduled_reports
// is the canonical scheduled-report engine — fully built (routes + worker) but never mounted until now.
// registerReportsScheduledCrudRoutes (reports.scheduled_reports, legacy) stays mounted for
// ScheduledReportsPanel's read path and archive-only continuity; it is superseded, not deleted.
import { registerScheduledReportsRoutes } from "./scheduled-reports/scheduled-reports.routes.js";
import { initializeScheduledReportsWorker } from "./scheduled-reports/scheduled-reports-worker.js";
import { registerIftaQuarterlyPreparerRoutes } from "./ifta/ifta-quarterly-preparer.routes.js";
import { registerFleetTrailerRoutes } from "./fleet/index.js";
import { registerFuelPlannerRoutes } from "./fuel/planner.routes.js";
import { registerFuelLovesUploadRoutes } from "./fuel/loves-upload.routes.js";
import { registerDispatchOverrideAuditRoutes } from "./audit/dispatch-overrides.routes.js";
import { registerBrokerUpdateRoutes } from "./brokerupdate/brokerupdate.routes.js";
import { registerDamageContinuityRoutes } from "./safety/damage-continuity/continuity.routes.js";
import { registerUserLocalePreferenceRoutes } from "./users/preferences/locale.routes.js";
import { registerUtilizationRoutes } from "./utilization/utilization.routes.js";
import { registerFuelTransactionImportRoutes } from "./fuel/fuel-transaction-import.routes.js";
import { registerFuelTransactionsRoutes } from "./fuel/fuel-transactions.routes.js";
import { registerFuelGlReflushRoutes } from "./fuel/fuel-gl-reflush.routes.js";
import { registerFuelCardOverageRoutes } from "./fuel/fuel-card-overage.routes.js";
import { registerFuelFraudAlertRoutes } from "./integrations/fuel/fraud-detector/routes.js";
import { registerSafetyRoutes } from "./safety/safety.routes.js";
import { registerSafetyAudit425cRoutes } from "./safety/audit-425c.routes.js";
import { registerSafetyBackgroundChecksRoutes } from "./safety/background-checks.routes.js";
import { registerDriverSchedulerRoutes } from "./safety/driver-scheduler.routes.js";
import { registerSafetyDriverDocumentsRoutes } from "./safety/driver-documents.routes.js";
// Orphan-route mounts (batch 2, non-financial) — frontend calls these, never registered (404).
// Verified uncalled + collision-free. (IFTA exhibits + fuel-fraud remain held as financial-adjacent.
// The 425-C exhibits generator is NO LONGER held — it is mounted below next to registerForm425CRoutes,
// read-only and role-gated, so the exhibits can be rendered and reviewed. Rendering is not filing.)
import { registerCap12TireTreadRoutes } from "./integrations/samsara/cap-12-tire-tread/routes.js";
import { initializeCap12TireTreadWorker } from "./jobs/cap-12-tire-tread-worker.js";
import { registerCap13BrakeWearRoutes } from "./integrations/samsara/cap-13-brake-wear/routes.js";
import { initializeCap13BrakeWearWorker } from "./jobs/cap-13-brake-wear-worker.js";
import { initializePredictiveAlertsWorker } from "./jobs/predictive-alerts-worker.js";
import { registerReportCategoryCatalogRoutes } from "./reports/categories/routes.js";
import { registerPhotoComparisonRoutes } from "./safety/photo-comparison/routes.js";
import { registerSafetyDriverProfileRoutes } from "./safety/driver-profile.routes.js";
import { registerSafetyFinesRoutes } from "./safety/fines.routes.js";
import { registerSafetyCompanyViolationsRoutes } from "./safety/company-violations.routes.js";
import { registerSafetyV5Routes } from "./safety/safety-v5.routes.js";
import { registerDriverScoringRoutes } from "./safety/driver-scoring.routes.js";
import { registerDriverCompositeScoringRoutes } from "./safety/driver-scoring/scoring.routes.js";
import { registerFuelGpsMatchRoutes } from "./safety/fuel-gps-match.routes.js";
import { registerGeofenceBreachRoutes } from "./safety/geofence-breach.routes.js";
import { registerDotInspectionEventsRoutes } from "./safety/dot-inspection-events.routes.js";
import { registerSafetyFoundationKpiRoutes } from "./safety/foundation-kpis.routes.js";
import { registerSafetyEventsRoutes } from "./safety/events/safety-events.routes.js";
import { registerSafetyDriverQualificationRoutes } from "./safety/driver-qualification.routes.js";
import { registerSafetyHosRoutes } from "./safety/hos.routes.js";
import { registerSafetyHosViolationsRoutes } from "./routes/safety/hos-violations.js";
import { registerSafetyIntegrityAlertsRoutes } from "./safety/integrity-alerts.routes.js";
import { registerAccidentLiabilitiesRoutes } from "./safety/accident-liabilities.routes.js";
import { registerSafetyDotInspectionsRoutes } from "./routes/safety/dot-inspections.js";
import { registerSafetyCsaScoresRoutes } from "./routes/safety/csa-scores.js";
import { registerSafetyComplaintsRoutes } from "./routes/safety/complaints.js";
import { registerSafetyIntegrityRoutes } from "./routes/safety/integrity.js";
import { positionHistoryRoutes } from "./safety/position-history/position-history.routes.js";
import { registerSafetyMedicalCardsRoutes } from "./safety/medical-cards.routes.js";
import { registerSafetyRemindersRoutes } from "./safety/reminders.routes.js";
import { registerSafetyReportsRoutes } from "./safety/reports/safety-reports.routes.js";
import { registerSafetyDrugProgramRoutes } from "./safety/drug-program.routes.js";
import { registerDrugAlcoholProgramRoutes } from "./safety/drug-alcohol/routes.js";
import { registerCertExpiryTrackingRoutes } from "./safety/expiry-tracking/routes.js";
import { registerFeatureFlagRoutes } from "./lib/feature-flags/routes.js";
import { registerEldAuditTrailRoutes } from "./safety/eld-audit-trail/routes.js";
import { registerSafetyRtdRoutes } from "./safety/rtd.routes.js";
import { registerSafetySettingsRoutes } from "./safety/settings.routes.js";
import { registerSafetyTrainingProgramsRoutes } from "./safety/training-programs.routes.js";
import { registerSafetyTrainingRecordsRoutes } from "./safety/training-records.routes.js";
import { registerSafetyDvirRoutes } from "./safety/dvir.routes.js";
import { registerSafetyIncidentsRoutes } from "./safety/incidents.routes.js";
import { registerSafetyIncidentFullReportRoutes } from "./safety/incidents/full-report.routes.js";
import { registerSafetyPermitsRoutes } from "./safety/permits.routes.js";
import { registerSafetyOnboardingRoutes } from "./safety/onboarding.routes.js";
import { registerOnboardingStateRoutes } from "./onboarding/state.routes.js";
import { registerLiabilitiesRoutes } from "./liabilities/liabilities.routes.js";
import { registerBankTxCategorizationRoutes } from "./banking/categorization.routes.js";
import { registerCategorizationRulesRoutes } from "./banking/categorization-rules.routes.js";
import { registerBankingRoutes } from "./banking/banking.routes.js";
import { registerBankingDriftAlertsRoutes } from "./banking/drift-alerts.routes.js";
import { registerTrailerInterchangeRoutes } from "./dispatch/trailer-interchange.routes.js";
import { registerPresettlementLinkRoutes } from "./dispatch/presettlement-link.routes.js";
import { registerBankAccountCompanyAuditRoutes } from "./banking/integrity/account-company-audit.routes.js";
import { registerAccountBalanceRoutes } from "./banking/account-balance.routes.js";
import { registerPlaidLinkRoutes } from "./integrations/plaid/link.routes.js";
import { registerPlaidAdminRoutes } from "./integrations/plaid/admin.routes.js";
import { registerPlaidWebhookRoutes } from "./integrations/plaid/webhook.routes.js";
import { registerBankingPlaidWebhookRoutes } from "./banking/plaid/webhook.routes.js";
import { registerBankingTransfersRoutes } from "./banking/transfers.routes.js";
import { registerCcPaymentRoutes } from "./bill-payments/cc-payment.routes.js";
import { registerBankingFactoringVirtualRoutes } from "./banking/factoring-virtual.routes.js";
import { registerBankingEscrowVisualizerRoutes } from "./banking/escrow-visualizer.routes.js";
import { registerBankingReconciliationRoutes } from "./banking/reconciliation.routes.js";
import { registerBankingP7Wave2Routes } from "./banking/p7-wave2.routes.js";
import { registerBankingObligationReconcileRoutes } from "./banking/obligation-reconcile.routes.js";
import { registerReconRoutes } from "./accounting/recon/recon.routes.js";
import { registerFactoringRoutes } from "./factoring/factoring.routes.js";
import { registerFactoringBatchRoutes } from "./factoring/batch.routes.js";
import { registerFactorRoutes } from "./factoring/factor.routes.js";
import { registerReserveRoutes } from "./factoring/reserve.routes.js";
import { registerFaroCsvImportRoutes } from "./factoring/faro-csv-import.routes.js";
import { registerSubmissionQueueRoutes } from "./factoring/submission-queue.routes.js";
import { registerScanDuplicateVendorRoutes } from "./factoring/scan-duplicate-vendors.routes.js";
import { registerCashAdvancesRoutes } from "./cash-advances/cash-advances.routes.js";
import { registerDriverHubRequestRoutes } from "./cash-advances/driver-hub-requests.routes.js";
import { registerMaintenanceWorkOrderRoutes } from "./maintenance/work-orders.routes.js";
import { registerWorkOrdersV1Routes } from "./work-orders/work-orders.routes.js";
import { registerMaintenanceDashboardRoutes } from "./maintenance/dashboard.routes.js";
import { registerMaintenanceSettingsRoutes } from "./maintenance/settings.routes.js";
import { registerMaintenanceDashboardKpisRoutes } from "./maintenance/dashboard-kpis.routes.js";
import { registerMaintenancePmAlertsRoutes } from "./maintenance/pm-alerts.routes.js";
import { registerMaintenancePredictiveAlertsRoutes } from "./maintenance/predictive-alerts.routes.js";
import { registerMaintenanceTriageRoutes } from "./maintenance/triage.routes.js";
import { registerMaintenanceArrivingSoonRoutes } from "./maintenance/arriving-soon.routes.js";
import { registerRoadServiceTicketRoutes } from "./maintenance/road-service/tickets.routes.js";
import { registerMaintenanceDriverReportsRoutes } from "./maintenance/driver-reports.routes.js";
import { registerMaintenanceLaborRoutes } from "./maintenance/labor.routes.js";
import { registerWoTimeEntriesRoutes } from "./maintenance/time-entries.routes.js";
import { registerMaintenancePartsInventoryRoutes } from "./maintenance/parts-inventory.routes.js";
import { internalLaborRoutes } from "./maintenance/internal-labor.routes.js";
import { registerMaintenancePartsInvoiceLinksRoutes } from "./maintenance/parts-invoice-links.routes.js";
import { registerMaintenanceSevereRepairEstimateRoutes } from "./maintenance/severe-repair-estimate.routes.js";
import { registerMaintenanceIntegrityRoutes } from "./maintenance/integrity.routes.js";
import { registerWoCostContextRoutes } from "./maintenance/wo-cost-context.routes.js";
import { registerMaintenancePmScheduleRoutes } from "./maintenance/pm-schedule.routes.js";
import { registerMaintenanceInspectionsRoutes } from "./maintenance/inspections.routes.js";
import { registerMaintenanceTiresRoutes } from "./maintenance/tires.routes.js";
import { registerMaintenanceWarrantyRoutes } from "./maintenance/warranty.routes.js";
import { registerMaintenanceReeferHoursRoutes } from "./maintenance/reefer-hours.routes.js";
import { registerMaintenanceVendorsRoutes } from "./maintenance/vendors.routes.js";
import { registerMaintenanceReportsRoutes } from "./maintenance/reports.routes.js";
import { registerMaintenanceComplianceRoutes } from "./maintenance/compliance.routes.js";
import { registerMaintenanceVehiclesRoutes } from "./maintenance/vehicles.routes.js";
import { registerMaintenanceDriversRoutes } from "./maintenance/drivers.routes.js";
import { registerMaintenancePartsRoutes } from "./maintenance/parts.routes.js";
import { registerMaintenanceDefectsRoutes } from "./maintenance/defects.routes.js";
import { registerPreFlightDvirRoutes } from "./maintenance/pre-flight-dvir.routes.js";
import { registerMaintenancePmAutoEngineRoutes } from "./maintenance/pm-auto-engine.service.js";
import { registerMaintenanceServiceTimelineRoutes } from "./maintenance/service-timeline.service.js";
import { registerMaintenanceKpiRoutes } from "./maintenance/kpi.routes.js";
import { initializePmAutoEngineCron } from "./maintenance/pm-auto-engine.cron.js";
import { registerMaintPartsRoutes } from "./maint/parts.routes.js";
import { registerMaintPmRoutes } from "./maint/pm.routes.js";
import { registerMaintWoApRoutes } from "./maint/wo-ap.routes.js";
import { registerInsuranceCoiRequestRoutes } from "./insurance/coi-request.routes.js";
import { registerInsuranceClaimRoutes } from "./insurance/claim.routes.js";
import { registerInsuranceDispersalRoutes } from "./insurance/dispersal.routes.js";
import { registerInsuranceLawsuitRoutes } from "./insurance/lawsuit.routes.js";
import { registerInsurancePolicyCreateAtomicRoutes } from "./insurance/policy-create-atomic.routes.js";
import { initializeInsurancePaymentReminderCron } from "./insurance/payment-reminder.service.js";
import { initializeInsuranceLateFeeCron } from "./insurance/late-fee.service.js";
import { initializeFactoringPacketSweepCron } from "./factoring/packet-assemble.service.js";
import { registerInsurancePaymentScheduleRoutes } from "./insurance/payment-schedule.routes.js";
import { registerInsurancePolicyRoutes } from "./insurance/policy.routes.js";
import { registerScheduleConfirmationRoutes } from "./insurance/schedule-confirmations.routes.js";
import { registerInsuranceSummaryRoutes } from "./insurance/summary.routes.js";
import { registerInsuranceTypeCatalogRoutes } from "./insurance/type-catalog.routes.js";
import { registerCashFlowModuleRoutes } from "./cash-flow/cash-flow.routes.js";
import { registerFinanceLoanWizardRoutes } from "./finance/loan-wizard/routes.js";
import { registerFinanceCalculatorRoutes } from "./finance/calculator/routes.js";
import { registerFinanceAmortizationRoutes } from "./finance/amortization/routes.js";
import { registerFinanceScenariosRoutes } from "./finance/scenarios/routes.js";
import { registerAuditRoutes } from "./audit/audit.routes.js";
import { registerDriverAuditEventsRoutes } from "./audit/driver-events.routes.js";
import { registerSpineEventsRoutes } from "./audit/spine-events.routes.js";
import { registerAuditViewerRoutes } from "./audit/viewer/routes.js";
import { registerAuditReportRoutes } from "./audit/audit-reports.routes.js";
import { registerDriverMetricsRoutes } from "./integrity/driver-metrics.routes.js";
import { registerAnomalyStatusRoutes } from "./integrity/anomaly-status.routes.js";
import { runAnomalyDetectionForTenant } from "./integrity/anomaly-detector.service.js";
import { registerForm425CRoutes } from "./compliance/form-425c.routes.js";
import { registerForm425cExhibitsRoutes } from "./reports/form-425c/exhibits/routes.js";
import { registerTaxDocumentRoutes } from "./tax-documents/tax-documents.routes.js";
import { registerListsHubRoutes } from "./lists/lists-hub.routes.js";
import { registerListsCountsRoutes } from "./lists/lists-counts.routes.js";
import { registerLocationsListRoutes } from "./lists/locations-list.routes.js";
import { registerDriverCatalogDeprecatedRoutes } from "./lists/driver-catalogs.routes.js";
import { registerNamesMasterRoutes } from "./lists/names-master.routes.js";
import { registerDriversReferenceRoutes } from "./lists/drivers-reference.routes.js";
import { registerOemPartsRoutes } from "./lists/oem-parts.routes.js";
import { registerAssetsRoutes } from "./assets/assets.routes.js";
import { registerDriverProfileRoutes } from "./mdata/driver-profile.routes.js";
import { registerDriverReturningDetectionRoutes } from "./mdata/driver-returning-detection.routes.js";
import { registerDriverSafetyEventsRoutes } from "./mdata/driver-safety-events.routes.js";
import { registerDispatcherSafetyEventsRoutes } from "./mdata/dispatcher-safety-events.routes.js";
import { registerCustomerContactRoutes } from "./mdata/customer-contacts.routes.js";
import { registerCustomerQualityEventsRoutes } from "./mdata/customer-quality-events.routes.js";
import { registerCustomerBillingRoutes } from "./mdata/customer-billing.routes.js";
import { registerCustomerLanesRoutes } from "./mdata/customer-lanes.routes.js";
import { registerCustomerDetailAliasRoutes } from "./mdata/customer-detail-alias.routes.js";
import { registerCustomerRoutes } from "./customers/index.js";
import { registerCustomerRelationshipScoreRoutes } from "./customers/relationship-score/routes.js";
import { registerDriverRetentionRoutes } from "./drivers/retention/routes.js";
import { registerAssignmentsQuicksaveRoutes } from "./assignments/quicksave.routes.js";
import { registerMdataRoutes } from "./mdata/index.js";
import { registerReclassifyRoutes } from "./mdata/reclassify.routes.js";
import { registerQboAutocompleteRoutes } from "./mdata/qbo-autocomplete.routes.js";
import { registerQboMasterWriteRoutes } from "./mdata/qbo-master-write.routes.js";
import { registerDriverTeamsAliasRoutes } from "./mdata/driver-teams-alias.routes.js";
import { registerTeamSplitRoutes } from "./settlements/team-splits/team-splits.routes.js";
import { registerMdataWorkflowRoutes } from "./mdata/workflow-routes.js";
import { registerUnitPermitsRoutes } from "./master-data/units/permits/routes.js";
import { registerUnitTollTagsRoutes } from "./master-data/units/toll-tags/routes.js";
import { registerDriverOperationsDepthRoutes } from "./master-data/drivers/operations-depth/routes.js";
import { registerCustomerFreeTimeDetentionRoutes } from "./master-data/customers/free-time-detention.routes.js";
import { initializeAccountingCrons, registerAccountingRoutes } from "./accounting/index.js";
import { registerDriverReimbursementDetailRoutes } from "./accounting/driver-reimbursement-detail.routes.js";
import { registerCashFlowRoutes } from "./accounting/cash-flow.routes.js";
import { registerCashForecastRoutes } from "./accounting/cash-forecast.routes.js";
import { registerFinanceHubRoutes } from "./accounting/finance-hub.routes.js";
import { registerApPaymentApplicationRoutes } from "./ap/payment-application.routes.js";
import { registerDataInfrastructureRoutes } from "./data-infra/data-infra.routes.js";
import { registerOcrRoutes } from "./ocr/ocr.routes.js";
import { registerCompanyRoutes } from "./org/companies.routes.js";
import { registerLegalTemplateRoutes } from "./legal/templates.routes.js";
import { registerLegalContractRoutes } from "./legal/contracts.routes.js";
import { registerLegalSignRoutes } from "./legal/sign.routes.js";
import { registerLegalAttorneyReviewRoutes } from "./legal/attorney-review.routes.js";
import { registerLegalMattersRoutes } from "./legal/matters.routes.js";
import { startOutboxProcessor, stopOutboxProcessor } from "./outbox/index.js";
import { initializeQboHistoricalImportRunner } from "./cron/qbo-historical-import-runner.js";
import { initializeQboSyncQueueRunner } from "./cron/qbo-sync-queue-runner.js";
import { initializeQboInboundSyncCron, stopQboInboundSyncCron } from "./cron/qbo-inbound-sync.cron.js";
import { initializeQboCdcPollCron } from "./cron/qbo-cdc-poll.cron.js";
import { initializeDepreciationAutopostCron } from "./cron/depreciation-autopost.cron.js";
import { initializeBankDriftAlertsCron } from "./cron/bank-drift-alerts.cron.js";
import { initializeCashFlowProjectionSnapshotCron } from "./cron/cash-flow-projection-snapshot.cron.js";
import { initializeCashFlowRollingLedgerNotifyCron } from "./cron/cash-flow-rolling-ledger-notify.cron.js";
import { initializeRecurringTemplatesCron } from "./cron/recurring-templates.cron.js";
import { initializeRecurringBillGeneratorWorker, stopRecurringBillGeneratorWorker } from "./jobs/recurring-bill-generator-worker.js";
import { initializeQboTokenRefreshCron } from "./cron/qbo-token-refresh-cron.js";
import { initializeCashAdvanceRequestExpiryCron } from "./cron/cash-advance-request-expiry-cron.js";
import { initializeGoogleReferenceMilesExpiryCron } from "./cron/google-reference-miles-expiry-cron.js";
import { initializeChatConfirmationEscalationCron } from "./cron/chat-confirmation-escalation.cron.js";
import { initializeSamsaraHealthCheckCron } from "./cron/samsara-health-cron.js";
import { initializeModelLifecycleMonitorCron } from "./cron/model-lifecycle-monitor.cron.js";
import { initializeSamsaraWebhookProjectionCron } from "./cron/samsara-webhook-projection.cron.js";
import { initializeSamsaraRemoteCountCollectorCron } from "./cron/samsara-remote-count-collector.cron.js";
import { initializeSamsaraMasterSyncCron } from "./cron/samsara-master-sync.cron.js";
import { initializeSamsaraHosPullCron } from "./cron/samsara-hos-pull.cron.js";
import { initializeSamsaraPositionsCron } from "./cron/samsara-positions-cron.js";
import { initializeReeferHoursPollCron } from "./cron/reefer-hours-poll.cron.js";
import { initializeRealDrivenMilesSegmentsCron } from "./cron/real-driven-miles-segments.cron.js";
import { initializeFuelGpsMatchCron } from "./cron/fuel-gps-match.cron.js";
import { initializeBankReconAutoMatchCron } from "./cron/bank-recon-auto-match.cron.js";
import { initializeDraftCrewStatusSelfHealCron } from "./cron/draft-crew-status-selfheal.cron.js";
import { initializeGeofenceBreachDetectorCron } from "./cron/geofence-breach-detector.cron.js";
import { initializeDriverLeaveAdvanceReminderCron } from "./cron/driver-leave-advance-reminder.cron.js";
import { initializeDriverLeaveBalanceRolloverCron } from "./cron/driver-leave-balance-rollover.cron.js";
import { initializeDriverLeavePendingEscalationCron } from "./cron/driver-leave-pending-escalation.cron.js";
import { initializeLegalMattersReminderCron } from "./legal/matters-reminder.cron.js";
import { backfillLegalTemplateLibraries } from "./legal/template-library-provision.service.js";
import { initializeSafetyRemindersCron } from "./safety/reminders.cron.js";
import { initializeIntegrityAlertEngineCron } from "./safety/integrity-alert-engine.cron.js";
import { initializeMasterDataSyncCron } from "./qbo/master-data-sync.cron.js";
import { registerMasterDataSyncRoutes } from "./qbo/master-data-sync.routes.js";
import { registerChartOfAccountsSyncRoutes } from "./qbo-sync/chart-of-accounts.routes.js";
import { registerItemsSyncRoutes } from "./qbo-sync/items.routes.js";
import { registerCustomersSyncRoutes } from "./qbo-sync/customers.routes.js";
import { registerVendorsSyncRoutes } from "./qbo-sync/vendors.routes.js";
import { registerQboSyncDriftDashboardRoutes } from "./qbo-sync/drift-dashboard.routes.js";
import { initializeQboSyncDriftScheduler } from "./qbo-sync/sync-scheduler.js";
import { registerAccountingCatalogLookupRoutes } from "./accounting/items.routes.js";
import { initializeQboSyncAlertsCron } from "./qbo/sync-alerts-cron.js";
import { initializeQboRemoteCountCollectorCron } from "./cron/qbo-remote-count-collector.cron.js";
import { initializeReconciliationWorkerCron } from "./cron/reconciliation-worker.cron.js";
import { initializeLedgerIntegrityCron } from "./cron/ledger-integrity.cron.js";
import { startInProcessJobCatchup } from "./cron/in-process-startup-catchup.js";
import { registerEmailRoutes } from "./email/email.routes.js";
import { registerEmailQueueAdminRoutes } from "./admin/email-queue-admin.routes.js";
import { registerAdminActivityRoutes } from "./admin/activity.routes.js";
import { registerAdminAccountingSyncRoutes } from "./admin/accounting-sync.routes.js";
import { registerAdminSyncHealthRoutes } from "./admin/sync-health.routes.js";
import { registerAdminClientErrorRoutes } from "./admin/client-errors.routes.js";
import { initializeEmailCron } from "./email/cron.js";
import { initializeQboOutboxDispatcher, stopQboOutboxDispatcher } from "./integrations/qbo/outbox-dispatcher.js";
import { initializeQboSyncWorker, stopQboSyncWorker } from "./integrations/qbo/qbo-sync-worker.js";
import { registerQboSyncAlertsRoutes } from "./qbo/sync-alerts.routes.js";
import { registerQboSyncActionsRoutes } from "./qbo/sync-actions.routes.js";
import { registerQboSyncRunsListRoutes } from "./qbo/sync-runs-list.routes.js";
import { registerQboSyncConflictDetectionRoutes } from "./qbo/sync-conflict-detection.routes.js";
import { registerQboUnlinkedEntitiesRoutes } from "./qbo/unlinked-entities.routes.js";
import { registerQboBulkLinkRoutes } from "./qbo/bulk-link.routes.js";
import { registerQboSyncHealthRoutes } from "./qbo/sync-health.routes.js";
import { registerQboCustomersPushStatusRoutes } from "./sync/qbo-customers-status.routes.js";
import { initializeQboCustomersPushScheduler, stopQboCustomersPushScheduler } from "./sync/qbo-customers-push.js";
import { registerQboVendorsPushStatusRoutes } from "./sync/qbo-vendors-status.routes.js";
import { initializeQboVendorsPushScheduler, stopQboVendorsPushScheduler } from "./sync/qbo-vendors-push.js";
import { registerQboAccountsPushStatusRoutes } from "./sync/qbo-accounts-status.routes.js";
import { initializeQboAccountsPushScheduler, stopQboAccountsPushScheduler } from "./sync/qbo-accounts-push.js";
import { registerLovesSyncStatusRoutes } from "./sync/loves-status.routes.js";
import { initializeLovesCardImportCron } from "./cron/loves-card-import.cron.js";
import { initializeReconCron } from "./cron/recon.cron.js";
import { initializeAuditChainVerifyCron } from "./cron/audit-chain-verify.cron.js";
import { initializeRelayFuelIngestCron } from "./integrations/relay-payments/relay-fuel-ingest.cron.js";
import { initializePlaidDailySyncCron } from "./cron/plaid-daily-sync.js";
import { initializePlaidDailyRefreshCron } from "./integrations/plaid/daily-refresh.cron.js";
import { initializeDriverSettlementAutoPayCron } from "./driver-finance/auto-pay.cron.js";
import { registerQboSyncEventLogRoutes } from "./qbo/sync-event-log.routes.js";
import { default as registerLedgerHealthRoutes } from "./system/ledger-health.routes.js";
import { registerTransactionHealthRoutes } from "./system/transaction-health.routes.js";
import { registerRunnerStatusRoutes } from "./admin/runner-status.routes.js";
import { registerForensicLiveRoutes } from "./admin/forensic-live.routes.js";
import { registerLaunchReadinessRoutes } from "./admin/launch-readiness.routes.js";
import { registerHealthDeepRoutes } from "./admin/health-deep.routes.js";
import { registerSmokeProbeRoutes } from "./admin/smoke-probe.routes.js";
import { registerAdminJobsRoutes } from "./admin/admin-jobs.routes.js";
import { registerVendorCreditsRoutes } from "./accounting/vendor-credits.routes.js";
import { registerCreditMemosRoutes } from "./accounting/credit-memos.routes.js";
import { registerDataImportAdminRoutes } from "./admin/data-import.routes.js";
import { resolveMonorepoRoot } from "./lib/monorepo-root.js";
import { attachSentryRequestScope, initBackendSentry, registerSentryFastifyErrorHandler } from "./lib/sentry.js";
import { runStartupEnvironmentChecks } from "./lib/env-validation.js";
import { verifyMigrationsOnStartup } from "./lib/migration-verification.js";
import { registerHealthRoutes } from "./health/health.routes.js";
import { setAppReady } from "./lib/startup-ready.js";
import { assertNoDuplicateFastifyRoutes } from "./lib/fastify-route-duplicates.js";
import { assertMigrationDriftBootGuard } from "./lib/migration-status.js";
import { attachHttpErrorMonitor } from "./lib/error-monitor-hooks.js";
import { pool, withLuciaBypass } from "./auth/db.js";
import { registerUrlCanonicalizeMiddleware } from "./middleware/url-canonicalize.js";
import { registerRequestIdMiddleware } from "./middleware/request-id.js";
import { registerSecurityHeaders } from "./middleware/security-headers.js";
import { registerIdempotencyMiddleware } from "./middleware/idempotency.js";
import { registerCsrfOriginGuard } from "./middleware/csrf-origin-guard.js";
import { initializeIdempotencyCleanupCron } from "./middleware/idempotency-cleanup.cron.js";
import { registerScenarioCertifyCron } from "./home/scenario-certify.cron.js";
import { registerMigrationStatusRoutes } from "./admin/migration-status.routes.js";
import { registerAdminObservabilityRoutes } from "./admin/observability.routes.js";
import { registerHomeWidgetRoutes } from "./home/home-widgets.routes.js";
import { registerOwnerTodaysAttentionRoutes } from "./owner/todays-attention/routes.js";
import { registerAccountingRoleHomeRoutes } from "./accounting/role-home/routes.js";
import { registerBillGlDraftRoutes } from "./accounting/bill-gl-draft.routes.js";
import { registerBillPaymentGlRoutes } from "./accounting/bill-payment-gl.routes.js";
import { registerRelatedPartyLoanRoutes } from "./accounting/related-party-loan-posting/routes.js";
import { registerCashForecastManualRoutes } from "./forecast/cash-forecast-manual.routes.js";
import { registerGeocodingRoutes } from "./integrations/trimble/geocoding.routes.js";
import { registerRouteReferenceRoutes } from "./integrations/google/route-reference.routes.js";
import { registerGooglePlacesRoutes } from "./integrations/google/places.routes.js";
import { registerSafetyOfficerRoleHomeRoutes } from "./safety-officer/role-views/routes.js";
import { registerDriverManagerRoleHomeRoutes } from "./driver-manager/role-views/routes.js";
import { initializeTodaysAttentionWorker, stopTodaysAttentionWorker } from "./jobs/todays-attention-worker.js";
import { registerPlaidBankingItemsRoutes } from "./banking/plaid-items.routes.js";
import { registerWeeklyCloseRoutes } from "./driver-finance/weekly-close.routes.js";
import { registerErrorMonitorRoutes } from "./admin/error-monitor.routes.js";
import { initializeErrorDigestCron } from "./cron/error-digest.cron.js";
import { initializeEvidencePresenceReconcileCron } from "./cron/evidence-presence-reconcile.cron.js";
import { registerDailyTasksRoutes } from "./daily-tasks/daily-tasks.routes.js";
import taskRoutes from "./tasks/task.routes.js";
import { initializeDailyTaskAlertsCron, stopDailyTaskAlertsCron } from "./cron/daily-task-alerts.cron.js";
import { initializeAdminJobsWorker, stopAdminJobsWorker } from "./admin/admin-jobs.service.js";
import { initializeDaRandomPoolDrawWorker } from "./jobs/da-random-pool-draw-worker.js";
import { initializeCertExpiryMonitor } from "./jobs/cert-expiry-monitor.js";
import { initializeInsuranceMonthlyReportCron } from "./cron/insurance-monthly-report.cron.js";
import { initializeLoanPaymentReminder } from "./jobs/loan-payment-reminder-worker.js";
import { initializeSamsaraCacheWarmer } from "./integrations/samsara/cache/cache-warmer.js";
import { initializeSearchIndexerIncremental } from "./jobs/search-indexer-incremental.js";
import { registerUniversalSearchRoutes } from "./search/universal/routes.js";
import { runStartupMigrationDriftGuard } from "./db/startup-migration-drift-guard.js";
import { registerTelematicsHosRoutes } from "./telematics/hos.routes.js";
import { registerHosTrackerRoutes } from "./telematics/hos-tracker.routes.js";
import { registerPredictedDeliveryRoutes } from "./dispatch/predicted-delivery.routes.js";
import { registerVehicleDriverPairingRoutes } from "./telematics/vehicle-driver-pairing.routes.js";
import { registerPayrollDriverSettlementRoutes } from "./payroll/driver-settlement.routes.js";
import { registerSettlementShadowRoutes } from "./payroll/settlement-shadow.routes.js";
import { registerDriverSubAccountBackfillRoutes } from "./accounting/driver-subaccount-backfill.routes.js";
import { registerBankOrphanBackfillRoutes } from "./banking/bank-orphan-backfill.routes.js";
import { registerPayrollAggregatedRoutes } from "./payroll/aggregated.routes.js";
import { registerUsmcaActivationRoutes } from "./usmca/activation/activation.routes.js";
import { applyEnvStartupChecks, isFeatureDisabled, setDisabledFeatures } from "./config/required-env.js";
import { getCorsAllowedOrigins } from "./config/cors-allowed-origins.js";
import { registerBookingGapRoutes } from "./dispatch/analytics/booking-gap.routes.js";
import { initializeBookingGapAggregatorWorker, stopBookingGapAggregatorWorker } from "./jobs/booking-gap-aggregator-worker.js";
import { registerLateArrivalAnalyticsRoutes } from "./dispatch/analytics/late-arrival.routes.js";
import { initializeLateArrivalAggregatorWorker } from "./jobs/late-arrival-aggregator-worker.js";
import {
  initializeCustomerRelationshipScorerWorker,
  stopCustomerRelationshipScorerWorker,
} from "./jobs/customer-relationship-scorer.js";
import {
  initializeDriverRetentionScorerWorker,
  stopDriverRetentionScorerWorker,
} from "./jobs/driver-retention-scorer-worker.js";
import { initializeDriverScoringAggregatorWorker } from "./jobs/driver-scoring-aggregator-worker.js";
import { registerPreDispatchValidationRoutes } from "./dispatch/validation/pre-dispatch.routes.js";
import { registerCap14CargoSensorRoutes } from "./integrations/samsara/cap-14-cargo-sensors/routes.js";
import { initializeCap14CargoSensorWorker, stopCap14CargoSensorWorker } from "./jobs/cap-14-cargo-sensor-worker.js";
import { registerDispatchAuthGateRoutes } from "./dispatch/auth-gates/routes.js";
import { registerAnomalyDetectionRoutes } from "./safety/anomaly/routes.js";
import { initializeAnomalyDetectorWorker } from "./jobs/anomaly-detector-worker.js";
import { initializeFuelFraudDetectorWorker } from "./jobs/fuel-fraud-detector-worker.js";
import { initializeDamageContinuityWorker } from "./jobs/damage-continuity-worker.js";
import { registerDispatchDetentionApprovalRoutes } from "./dispatch/detention-approval.routes.js";
import { registerChatRoutes } from "./chat/chat.routes.js";

type CorsOriginValue = string | boolean | RegExp | Array<string | boolean | RegExp>;

const repoRoot = resolveMonorepoRoot(import.meta.url);

// trustProxy is scoped to Cloudflare's published ranges, never `true`. Without it `req.ip` is the
// Cloudflare edge, so every per-route rate limit bucketed the whole internet into a handful of
// egress IPs (see config/client-ip.ts). `true` would be worse than nothing — it trusts any caller's
// X-Forwarded-For, letting a client pick its own rate-limit bucket.
const app = Fastify({ logger: true, trustProxy: [...CLOUDFLARE_IP_RANGES] });
// Tolerate an empty application/json body on POST actions whose inputs are all in the URL/query (e.g.
// categorization-rules/:id/apply-historical). Must run before routes are registered. See the helper.
installEmptyJsonBodyParser(app);
attachHttpErrorMonitor(app);
let shuttingDown = false;

// 0243-h1-2: delegate to the single shared source of truth (config/cors-allowed-origins.ts) so the
// boot-time CORS registration and the CSRF-origin guard can never diverge, prod origins are versioned
// in code, localhost is dev-only, and an unset CORS_ALLOWED_ORIGINS in production fails loud.
function getAllowedOrigins(): string[] {
  return getCorsAllowedOrigins();
}

// Required for BT-1-AUTH-DRIVER phone auth:
// - TWILIO_ACCOUNT_SID
// - TWILIO_AUTH_TOKEN
// - TWILIO_VERIFY_SERVICE_SID

app.get("/api/v1/_healthcheck", async () => {
  return { status: "ok" };
});

app.get("/api/v1/health", async () => {
  return { status: "ok" };
});

app.get("/api/v1/me", async (_req, reply) => {
  return reply.redirect("/api/v1/auth/me", 307);
});

async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info({ signal }, "Shutdown signal received");
  try {
    await stopOutboxProcessor();
  } catch (error) {
    app.log.error({ err: error }, "Failed to stop outbox processor cleanly");
  }
  try {
    stopQboSyncWorker();
    stopQboOutboxDispatcher();
    stopQboCustomersPushScheduler();
    stopQboVendorsPushScheduler();
    stopQboAccountsPushScheduler();
    stopQboInboundSyncCron();
    stopDailyTaskAlertsCron();
    stopTodaysAttentionWorker();
    stopCap14CargoSensorWorker();
    stopAdminJobsWorker();
    stopBookingGapAggregatorWorker();
    stopCustomerRelationshipScorerWorker();
    stopDriverRetentionScorerWorker();
    stopRecurringBillGeneratorWorker();
  } catch (error) {
    app.log.error({ err: error }, "Failed to stop QBO sync processors cleanly");
  }
  try {
    await app.close();
  } catch (error) {
    app.log.error({ err: error }, "Error while closing Fastify");
  }
  process.exit(0);
}

async function main() {
  initBackendSentry();
  await runStartupEnvironmentChecks();
  const envCheck = applyEnvStartupChecks(app.log);
  setDisabledFeatures(envCheck.disabled_features);
  if (envCheck.hard_fail_messages.length > 0) {
    throw new Error(`required_env_missing:\n${envCheck.hard_fail_messages.join("\n")}`);
  }

  if (!app.hasDecorator("forensicRunnerStatus")) {
    app.decorate("forensicRunnerStatus", "pending");
  }

  registerSentryFastifyErrorHandler(app);
  await registerRequestIdMiddleware(app);
  await registerUrlCanonicalizeMiddleware(app);
  await registerHealthRoutes(app);

  const driftConn = await pool.connect();
  try {
    await runStartupMigrationDriftGuard({
      repoRoot,
      client: driftConn,
    });
  } finally {
    driftConn.release();
  }

  try {
    await Promise.race([
      verifyMigrationsOnStartup(repoRoot),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("migration_verification_timeout_10s")), 10000)
      ),
    ]);
  } catch (error) {
    app.log.error(
      { err: error },
      "[STARTUP] migration verification failed or timed out — continuing without it"
    );
  }
  setAppReady(true);

  await registerSecurityHeaders(app);
  await registerIdempotencyMiddleware(app);
  await app.register(cors, {
    origin: (origin: string | undefined, cb: (err: Error | null, allow: CorsOriginValue) => void) => {
      if (!origin) return cb(null, true);
      if (getAllowedOrigins().includes(origin)) return cb(null, true);
      return cb(new Error("CORS: origin not allowed"), false);
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "Idempotency-Key"],
  });
  await app.register(cookie);
  // Multipart body limits (G3-3 hardening). Without explicit caps @fastify/multipart
  // defaults fileSize/files to Infinity, so a single request can stream unbounded bytes
  // and memory-exhaust the process (DoS) — every direct-upload route uses part.toBuffer(),
  // which buffers the whole file into memory. Caps below are a defense-in-depth transport
  // ceiling, NOT the business rule: the app's own per-attachment cap is 25 MB
  // (documents/attachments.service.ts MAX_SIZE_BYTES), so fileSize=50 MB gives 2x headroom
  // and never truncates a legit evidence photo/short mp4, rate-con/BOL PDF, or CSV/Excel
  // import while still bounding per-file memory. files=20 covers bulk-attach; fieldSize=1 MB
  // is ample for the small text fields (company id, etc.) these routes carry.
  await app.register(multipart, {
    limits: {
      fileSize: 50 * 1024 * 1024, // 50 MB per file
      files: 20, // max file parts per request
      fieldSize: 1 * 1024 * 1024, // 1 MB per non-file field value
    },
  });
  // Per-route rate limiting (opt-in only: global:false → zero effect on routes that don't set
  // config.rateLimit). Applied to the task-chat write/read routes to prevent comment-spam/DoS.
  // keyGenerator: bucket by the REAL caller. Default keying is `req.ip`, which behind Cloudflare is
  // the edge — so the ~141 opt-in limits shared buckets across all users (one busy tenant could
  // exhaust the limit for everyone; an attacker got the same allowance as the entire user base).
  await app.register(rateLimit, {
    global: false,
    keyGenerator: (req) => resolveClientIp(req as unknown as IpResolvable),
  });
  await registerSessionMiddleware(app);
  // G3-1 CSRF guard — must be registered BEFORE route plugins so the onRequest hook
  // propagates into every child context. Only engages on cookie-authenticated,
  // state-changing requests; webhooks/S2S (no session cookie) and GET/OPTIONS pass through.
  await registerCsrfOriginGuard(app);
  app.addHook("preHandler", async (req, _reply) => {
    const url = req.raw.url ?? "";
    if (url.startsWith("/api/v1/healthz")) {
      return;
    }
    attachSentryRequestScope(req);
  });
  await registerRunnerStatusRoutes(app);
  await registerForensicLiveRoutes(app);
  await registerAuthRoutes(app);
  await registerQboOAuthRoutes(app);
  await registerQboWebhookRoutes(app);
  await registerSamsaraWebhookRoutes(app);
  await registerRelayFuelBackfillRoute(app);
  await registerRelayFuelCsvImportRoute(app);
  await registerRelayFuelDriverRematchRoute(app);
  await registerRelayFuelLoadRematchRoute(app);
  await registerRelayWalletBankFeedBackfillRoute(app);
  await registerRelayDepositReviewRoutes(app);
  await registerRelayHealthRoutes(app);
  await registerSamsaraEngineFaultRoutes(app);
  await registerSamsaraConfigRoutes(app);
  // SAMSARA-MASTER-SYNC-ROUTES-ORPHANED: this file has no `export default fp(...)`, so it is not
  // covered by any directory-wide autoload (every other integrations/samsara/*.routes.ts file gets
  // its own explicit register call here too) -- it was simply never added, so the manual "sync now"
  // drivers/assets endpoints 404'd live despite existing in the repo and being fully implemented.
  await registerSamsaraMasterSyncRoutes(app);
  await registerSamsaraLivePositionRoutes(app);
  await registerSamsaraRoutesIntegration(app);
  await registerTriSignalRoutes(app);
  await registerSamsaraHealthRoutes(app);
  await registerSamsaraStatsProbeRoutes(app);
  await registerHosDriverMapPreviewRoutes(app);
  await registerDriverInactivityPreviewRoutes(app);
  await registerProgramBoardRoutes(app);
  await registerAuditScoreboardRoutes(app);
  await registerSamsaraHosReadinessRoutes(app);
  await registerSamsaraVehicleDriverPairingRoutes(app);
  await registerActiveDriverSetRoutes(app);
  await registerIntegrationHealthRoutes(app);
  await registerSamsaraVendorMappingIntegrityRoutes(app);
  await registerSamsaraVendorMappingActionsRoutes(app);
  await registerDriverVendorMappingIntegrityRoutes(app);
  await registerGeofenceReconciliationRoutes(app);
  await registerGeofenceStateMachineRoutes(app);
  await registerBorderCrossingDetectorRoutes(app);
  await registerAutoStatusSwitchRoutes(app);
  await registerBookingGapRoutes(app);
  await registerQboForensicAdminRoutes(app);
  await registerQboSyncAdminRoutes(app);
  await registerQboVendorLinkageRoutes(app);
  await registerTrkMigrationRoutes(app);
  await registerMasterDataSyncRoutes(app);
  await registerChartOfAccountsSyncRoutes(app);
  await registerItemsSyncRoutes(app);
  await registerCustomersSyncRoutes(app);
  await registerVendorsSyncRoutes(app);
  await registerQboSyncDriftDashboardRoutes(app);
  await registerAccountingCatalogLookupRoutes(app);
  // Block F: firewalled manual cash forecast (non-posting, per-company RLS, audited). Migration
  // 202606162000 enabled the feature (lib.feature_flags → the MDP tab renders), but the routes were
  // additionally gated by the CASH_FORECAST_ENABLED env var on Render which was never set — so the tab
  // rendered while every /api/v1/forecast/* write 404'd (opening-balance + income/expense saves). Register
  // unconditionally like every other route; frontend visibility stays controlled by the DB feature flag.
  await registerCashForecastManualRoutes(app);
  // PC*MILER/Trimble geocoding proxy — always mounts; PCMILER_ENABLED flag is checked inside the handler
  // (registration must NOT depend on an env var — that 404'd the forecast routes). Key stays server-side.
  await registerGeocodingRoutes(app);
  await registerRouteReferenceRoutes(app);
  // Google address-autocomplete proxy (RULING 3, 2026-09-02) — address field only, never miles.
  // Same always-mounts / gate-inside-handler shape as the Trimble route above.
  await registerGooglePlacesRoutes(app);
  await registerQboSyncAlertsRoutes(app);
  await registerQboSyncRunsListRoutes(app);
  await registerQboSyncConflictDetectionRoutes(app);
  await registerQboSyncActionsRoutes(app);
  await registerQboUnlinkedEntitiesRoutes(app);
  await registerQboBulkLinkRoutes(app);
  await registerQboSyncHealthRoutes(app);
  await registerQboCustomersPushStatusRoutes(app);
  await registerQboVendorsPushStatusRoutes(app);
  await registerQboAccountsPushStatusRoutes(app);
  await registerLovesSyncStatusRoutes(app);
  await registerQboSyncEventLogRoutes(app);
  await registerLedgerHealthRoutes(app);
  await registerTransactionHealthRoutes(app);
  await registerEmailRoutes(app);
  await registerEmailQueueAdminRoutes(app);
  await registerAdminClientErrorRoutes(app);
  await registerErrorMonitorRoutes(app);
  await registerAdminActivityRoutes(app);
  await registerAdminAccountingSyncRoutes(app);
  await registerAdminSyncHealthRoutes(app);
  await registerLaunchReadinessRoutes(app);
  await registerHealthDeepRoutes(app);
  await registerSmokeProbeRoutes(app);
  await registerAdminJobsRoutes(app);
  await registerVendorCreditsRoutes(app);
  await registerCreditMemosRoutes(app);
  await registerMigrationStatusRoutes(app);
  await registerAdminObservabilityRoutes(app);
  await registerDataImportAdminRoutes(app);
  await registerPhoneAuthRoutes(app);
  await registerEmailAuthRoutes(app);
  await registerOfficeLoginRoutes(app);
  await registerInviteAuthRoutes(app);
  await registerIdentityRoutes(app);
  await registerCompanyContextRoutes(app);
  await registerPasswordResetRoutes(app);
  await registerNotificationPreferenceRoutes(app);
  await registerUserPreferencesRoutes(app);
  await registerWorkflowRoutes(app);
  await registerVoidCancelRequestRoutes(app);
  await registerIdentityApplicantRoutes(app);
  await registerMdataRoutes(app);
  await registerUnitPermitsRoutes(app);
  await registerUnitTollTagsRoutes(app);
  await registerDriverOperationsDepthRoutes(app);
  await registerCustomerFreeTimeDetentionRoutes(app);
  await registerAssignmentsQuicksaveRoutes(app);
  await registerFleetTrailerRoutes(app);
  await registerAssetsRoutes(app);
  await registerQboAutocompleteRoutes(app);
  await registerQboMasterWriteRoutes(app);
  await registerDriverProfileRoutes(app);
  await registerDriverReturningDetectionRoutes(app);
  await registerDriverSafetyEventsRoutes(app);
  await registerSafetyDocRoutes(app);
  await registerDriverAlertRoutes(app);
  await registerDispatcherSafetyEventsRoutes(app);
  await registerCustomerContactRoutes(app);
  await registerCustomerQualityEventsRoutes(app);
  await registerCustomerBillingRoutes(app);
  await registerCustomerLanesRoutes(app);
  await registerCustomerDetailAliasRoutes(app);
  await registerCustomerRoutes(app);
  await registerReclassifyRoutes(app);
  await registerCustomerRelationshipScoreRoutes(app);
  await registerDriverRetentionRoutes(app);
  await registerMdataWorkflowRoutes(app);
  await registerDriverTeamsAliasRoutes(app);
  // P2b/P2f: plural team-splits facade over mdata.driver_teams (fixes TeamSplitConfigPanel 404).
  await registerTeamSplitRoutes(app);
  await registerCatalogsRoutes(app);
  await registerDriverCatalogRoutes(app);
  await registerDriverCatalogDeprecatedRoutes(app);
  await registerFuelCatalogRoutes(app);
  await registerFleetCatalogRoutes(app);
  // FIX-3: the dispatch catalog group (load-types, detention-reasons, pickup-time-types, additional-charges)
  // was DEFINED in catalogs/dispatch/index.ts but never mounted here alongside its siblings — so
  // GET /api/v1/catalogs/dispatch/additional-charges (the Book Load "+ Create charge" code list) 404'd.
  await registerDispatchCatalogRoutes(app);
  // Factoring-packet ops surface (DISP-FACTORING-PACKET): the queue routes were built but never mounted.
  await registerFactoringQueueRoutes(app);
  await registerGenericCatalogRoutes(app);
  await registerStubCatalogPurgeRoutes(app);
  await registerAccountingCatalogRoutes(app);
  await registerCatalogRegistryRoutes(app);
  await registerEquipmentTypeRoutes(app);
  await registerDriverLoadStatusRoutes(app);
  await registerStatesRoutes(app);
  await registerLoadCancellationReasonRoutes(app);
  await registerVoidCancelReasonRoutes(app);
  await registerDispatchFlagColorRoutes(app);
  // ─── Safety catalog routes (T11.21.2A) ───
  await registerSafetyCatalogRoutes(app);
  // ─── End Safety catalog routes ───
  await registerCatalogsWorkflowRoutes(app);
  await registerFileCategoriesRoutes(app);
  await registerDocsFoundationRoutes(app);
  await registerDocsFilesRoutes(app);
  await registerAttachmentsRoutes(app);
  await registerDispatchLoadRoutes(app);
  await registerLoadSettlementSummaryRoutes(app);
  // Orphan-route mounts (batch 1, non-financial) — see import block above.
  await registerLoadProfitabilityRoutes(app);
  await registerCancellationsReportRoutes(app);
  await registerLoadCancellationsAnalyticsRoutes(app);
  await registerLoadGeofenceTimelineRoutes(app);
  await registerLoadStopsRecordRoutes(app);
  await registerTripPairingBoardRoutes(app);
  await registerDriverCommunicationsRoutes(app);
  await registerDriverAdvancesRoutes(app);
  await registerMaintenancePartsMasterRoutes(app);
  await registerMaintenanceServicesCatalogRoutes(app);
  await registerMaintenanceCatalogRoutes(app);
  await registerDamagePhotoEvidenceRoutes(app);
  await registerEdiRoutes(app);
  await registerLoadsBulkRoutes(app);
  await registerDispatchCancelLoadRoutes(app);
  await registerDispatchSheetHtmlRoutes(app);
  await registerDispatchLoadAssignRoutes(app);
  await registerDispatchQuicksaveRoutes(app);
  await registerDispatchAssignmentsQuicksaveRoutes(app);
  await registerDispatchCancellationRoutes(app);
  await registerRateConExtractRoutes(app);
  await registerDispatchRefinementsRoutes(app);
  await registerDeadheadOptimizerRoutes(app);
  await registerIntransitIssuesRoutes(app);
  await registerDispatchArchTabsRoutes(app);
  await registerDriverDispatchEligibilityRoutes(app);
  await registerDispatchAlertsRoutes(app);
  await registerDispatchPlannerRoutes(app);
  await registerDispatchDetentionRoutes(app);
  await registerLayoverRoutes(app);
  await registerEquipmentTransferRoutes(app);
  await registerLoadStopExtraRateRoutes(app);
  await registerLateArrivalAnalyticsRoutes(app);
  await registerPreDispatchValidationRoutes(app);
  await registerCap14CargoSensorRoutes(app);
  await registerDispatchAuthGateRoutes(app);
  await registerAnomalyDetectionRoutes(app);
  await registerDispatchDetentionApprovalRoutes(app);
  await registerDispatchOcrIntakeRoutes(app);
  await registerDispatchCustomerNotifyRoutes(app);
  await registerDispatchPodBolRoutes(app);
  // GAP-34 — the driver dispatch view and stop mutations were complete but orphaned, so the PWA's
  // mounted screen received 404s. Register beside the other dispatch capture routes.
  await registerDispatchViewRoutes(app);
  await registerDispatcherRoleViewRoutes(app);
  await registerDriverRoutes(app);
  await registerDriversMessagesRoutes(app);
  await registerChatRoutes(app);
  await registerDriversDocumentAlertsRoutes(app);
  await registerGeofencesRoutes(app);
  await registerStopsGeocodeBackfillRoutes(app);
  await registerDriverDaySummaryRoutes(app);
  await registerTelematicsHeatmapRoutes(app);
  await registerDashcamOnDemandRoutes(app);
  await registerTelematicsPositionsRoutes(app);
  await registerTourCloseRoutes(app);
  await registerFleetLocationHosRoutes(app);
  await registerDriverFinanceSettlementRoutes(app);
  await registerSettlementsBulkRoutes(app);
  await registerPreSettlementRoutes(app);
  await registerTourReadoutRoutes(app);
  await registerC1PreSettlementsRoutes(app);
  await registerCustomerContractRoutes(app);
  await registerWeeklyCloseRoutes(app);
  await registerSettlementsDisputesRoutes(app);
  // ACCT-R-13 (2026-07-25): built but never mounted (live 404 on all 9 endpoints). SettlementsMvp
  // (registerSettlementsMvpRoutes) stays UNMOUNTED — see scripts/verify-no-orphan-routes.mjs.
  await registerSettlementApprovalRoutes(app);
  await registerSettlementDisputeRoutes(app);
  // LV-SETTLEMENT-DETAIL-CALLS-REFUSED-ROUTE — FE already calls queue/mark-sent/cleared/bounced/
  // paid-manually + payment-events. Refusal was "owner OK" theater; OWNER LAW 2026-08-03 = mount on proof.
  await registerSettlementPaymentRoutes(app);
  await registerAutoDeductionPolicyRoutes(app);
  await registerDriverFinanceSettlementHtmlRoutes(app);
  await registerDriverFinanceDriverBillsRoutes(app);
  await registerDriverFinanceDriverBillsListRoutes(app);
  await registerDriverFinanceDebtRoutes(app);
  await registerDriverFinanceDeductionRoutes(app);
  await registerEscrowDeductionPendingRoutes(app);
  await registerDriverEscrowSeparationRoutes(app);
  await registerDriverEscrowForfeitRoutes(app);
  await registerOwnerApprovalPortalRoutes(app);
  await registerCashAdvanceRequestRoutes(app);
  await registerDriverPaymentMethodRoutes(app);
  registerPaymentMethodsCatalogRoutes(app);
  registerSettlementPayRunCloseRoutes(app);
  registerDriverInboxReportingRoutes(app);
  await registerAbandonmentRoutes(app);
  await registerDetentionPayPostingRoutes(app);
  await registerHomeRoutes(app);
  await registerHomeWidgetRoutes(app);
  await registerOwnerTodaysAttentionRoutes(app);
  await registerAccountingRoleHomeRoutes(app);
  await registerBillGlDraftRoutes(app);
  // ACC-51 posted-while-tour-open-report.routes.ts is autoload-mounted (default fp) — see DUPLICATE-ROUTE-BOOT-CRASH note below.
  await registerBillPaymentGlRoutes(app);
  await registerRelatedPartyLoanRoutes(app);
  await registerSafetyOfficerRoleHomeRoutes(app);
  await registerDriverManagerRoleHomeRoutes(app);
  await registerReportsRoutes(app);
  await registerReportsScheduledCrudRoutes(app);
  await registerScheduledReportsRoutes(app);
  await registerScheduledSubscriptionRoutes(app);
  await registerCustomReportBuilderRoutes(app);
  await registerIftaQuarterlyPreparerRoutes(app);
  await registerFuelPlannerRoutes(app);
  await registerFuelLovesUploadRoutes(app);
  // UNREACHABLE-ROUTE FIX (verify-route-file-mounted). These six route files declared endpoints that
  // NO server ever served: they are outside every @fastify/autoload directory and exported no default
  // plugin, so nothing mounted them. Live-proven on the deployed API before the fix — each path
  // returned 404 while a mounted path returns 401, and a definitely-nonexistent /api/v1 path also
  // returns 404, which is the discriminator that makes the 404 mean 'unmounted' rather than 'auth'.
  await registerDispatchOverrideAuditRoutes(app);
  await registerBrokerUpdateRoutes(app);
  await registerDamageContinuityRoutes(app);
  await registerUserLocalePreferenceRoutes(app);
  await registerUtilizationRoutes(app);
  await registerFuelTransactionImportRoutes(app);
  await registerFuelTransactionsRoutes(app);
  // FUEL-01 — owner-gated idempotent re-flush for unposted fuel.fuel_transactions → GL
  await registerFuelGlReflushRoutes(app);
  // BANK-F10 / FUEL-03 — list + approve-then-recover for fuel-card overage events
  await registerFuelCardOverageRoutes(app);
  // FIX (W: fuel fraud-alerts 404): registerFuelFraudAlertRoutes was defined but never mounted, so
  // GET /api/v1/fuel/fraud-alerts/summary 404'd and the "Open Fraud Alerts" KPI showed 0.
  await registerFuelFraudAlertRoutes(app);
  await registerSafetyRoutes(app);
  await registerSafetyAudit425cRoutes(app);
  await registerSafetyBackgroundChecksRoutes(app);
  await registerDriverSchedulerRoutes(app);
  await registerSafetyDriverDocumentsRoutes(app);
  // Orphan-route mounts (batch 2, non-financial) — see import block above.
  await registerCap12TireTreadRoutes(app);
  await registerCap13BrakeWearRoutes(app);
  await registerReportCategoryCatalogRoutes(app);
  await registerPhotoComparisonRoutes(app);
  await registerSafetyDriverProfileRoutes(app);
  await registerSafetyFinesRoutes(app);
  await registerSafetyCompanyViolationsRoutes(app);
  await registerSafetyV5Routes(app);
  await registerDriverScoringRoutes(app);
  await registerDriverCompositeScoringRoutes(app);
  await registerFuelGpsMatchRoutes(app);
  await registerGeofenceBreachRoutes(app);
  await registerDotInspectionEventsRoutes(app);
  await registerSafetyFoundationKpiRoutes(app);
  await registerSafetyEventsRoutes(app);
  await registerSafetyDriverQualificationRoutes(app);
  await registerSafetyHosRoutes(app);
  await registerSafetyHosViolationsRoutes(app);
  await registerSafetyDotInspectionsRoutes(app);
  await registerSafetyCsaScoresRoutes(app);
  await registerSafetyComplaintsRoutes(app);
  await registerSafetyIntegrityRoutes(app);
  await positionHistoryRoutes(app);
  await registerSafetyIntegrityAlertsRoutes(app);
  await registerAccidentLiabilitiesRoutes(app);
  await registerSafetyMedicalCardsRoutes(app);
  await registerSafetyRemindersRoutes(app);
  await registerSafetyReportsRoutes(app);
  await registerSafetyDrugProgramRoutes(app);
  await registerDrugAlcoholProgramRoutes(app);
  await registerCertExpiryTrackingRoutes(app);
  await registerFeatureFlagRoutes(app);
  await registerUniversalSearchRoutes(app);
  await registerEldAuditTrailRoutes(app);
  await registerSafetyRtdRoutes(app);
  await registerSafetySettingsRoutes(app);
  await registerSafetyTrainingProgramsRoutes(app);
  await registerSafetyTrainingRecordsRoutes(app);
  await registerSafetyDvirRoutes(app);
  await registerSafetyIncidentsRoutes(app);
  await registerSafetyIncidentFullReportRoutes(app);
  await registerSafetyPermitsRoutes(app);
  await registerSafetyOnboardingRoutes(app);
  await registerOnboardingStateRoutes(app);
  await registerLiabilitiesRoutes(app);
  await registerCashAdvancesRoutes(app);
  await registerDriverHubRequestRoutes(app);
  await registerBankTxCategorizationRoutes(app);
  // ACCT-LINK-06 — apply-historical + rules CRUD (was orphan HELD; owner live-ops 2026-07-30).
  await registerCategorizationRulesRoutes(app);
  await registerBankingRoutes(app);
  await registerBankingDriftAlertsRoutes(app);
  await registerTrailerInterchangeRoutes(app);
  await registerPresettlementLinkRoutes(app);
  await registerBankAccountCompanyAuditRoutes(app);
  await registerPlaidBankingItemsRoutes(app);
  await registerAccountBalanceRoutes(app);
  await registerPlaidLinkRoutes(app);
  await registerPlaidAdminRoutes(app);
  await registerPlaidWebhookRoutes(app);
  await registerBankingPlaidWebhookRoutes(app);
  await registerBankingTransfersRoutes(app);
  await registerCcPaymentRoutes(app);
  // registerBankingManualJeRoutes — ARCHIVED 2026-06-24 (Tier-1 H-1). Dead path (zero callers) that wrote the
  // forbidden accounting.journal_entry_lines. UNMOUNTED; original preserved in manual-je.routes.deprecated.ts.
  // Canonical JE path = POST /api/v1/accounting/journal-entries.
  await registerBankingFactoringVirtualRoutes(app);
  await registerBankingEscrowVisualizerRoutes(app);
  await registerBankingReconciliationRoutes(app);
  await registerBankingP7Wave2Routes(app);
  await registerBankingObligationReconcileRoutes(app);
  await registerReconRoutes(app);
  await registerFactoringRoutes(app);
  await registerFactoringBatchRoutes(app);
  await registerFactorRoutes(app);
  await registerReserveRoutes(app);
  await registerFaroCsvImportRoutes(app);
  await registerSubmissionQueueRoutes(app);
  await registerScanDuplicateVendorRoutes(app);
  await registerDataInfrastructureRoutes(app);
  await registerOcrRoutes(app);
  await registerMaintenanceWorkOrderRoutes(app);
  await registerWorkOrdersV1Routes(app);
  await registerMaintenanceLaborRoutes(app);
  await registerWoTimeEntriesRoutes(app);
  await registerMaintenanceDriverReportsRoutes(app);
  await registerMaintenanceDashboardKpisRoutes(app);
  await registerMaintenanceDashboardRoutes(app);
  await registerMaintenanceSettingsRoutes(app);
  await registerMaintenancePmAlertsRoutes(app);
  await registerMaintenancePredictiveAlertsRoutes(app);
  await registerMaintenanceTriageRoutes(app);
  await registerMaintenanceArrivingSoonRoutes(app);
  await registerRoadServiceTicketRoutes(app);
  await registerMaintenancePartsInventoryRoutes(app);
  await internalLaborRoutes(app);
  await registerMaintenancePartsInvoiceLinksRoutes(app);
  await registerMaintenanceSevereRepairEstimateRoutes(app);
  await registerMaintenanceIntegrityRoutes(app);
  await registerWoCostContextRoutes(app);
  await registerMaintenancePmScheduleRoutes(app);
  await registerMaintenanceInspectionsRoutes(app);
  await registerMaintenanceTiresRoutes(app);
  await registerMaintenanceWarrantyRoutes(app);
  await registerMaintenanceReeferHoursRoutes(app);
  await registerMaintenanceVendorsRoutes(app);
  await registerMaintenanceReportsRoutes(app);
  await registerMaintenanceComplianceRoutes(app);
  await registerMaintenanceVehiclesRoutes(app);
  await registerMaintenanceDriversRoutes(app);
  await registerMaintenancePartsRoutes(app);
  await registerMaintenanceDefectsRoutes(app);
  await registerPreFlightDvirRoutes(app);
  await registerMaintenancePmAutoEngineRoutes(app);
  await registerMaintenanceServiceTimelineRoutes(app);
  await registerMaintenanceKpiRoutes(app);
  await registerMaintPartsRoutes(app);
  await registerInsurancePolicyRoutes(app);
  await registerScheduleConfirmationRoutes(app);
  await registerInsuranceSummaryRoutes(app);
  await registerInsurancePolicyCreateAtomicRoutes(app);
  await registerInsuranceClaimRoutes(app);
  await registerInsuranceLawsuitRoutes(app);
  await registerInsurancePaymentScheduleRoutes(app);
  await registerInsuranceDispersalRoutes(app);
  await registerInsuranceCoiRequestRoutes(app);
  await registerInsuranceTypeCatalogRoutes(app);
  await registerCashFlowModuleRoutes(app);
  await registerFinanceLoanWizardRoutes(app);
  await registerFinanceCalculatorRoutes(app);
  await registerFinanceAmortizationRoutes(app);
  await registerFinanceScenariosRoutes(app);
  // GET /api/v1/finance/break-even is autoload-mounted via break-even.routes.ts default fp.
  // Do not also call that registrar from this file — Fastify throws duplicate GET and never binds PORT.
  await registerAuditRoutes(app);
  await registerDriverAuditEventsRoutes(app);
  await registerSpineEventsRoutes(app);
  await registerAuditViewerRoutes(app);
  await registerAuditReportRoutes(app);
  await registerDriverMetricsRoutes(app);
  await registerAnomalyStatusRoutes(app);
  await registerMaintPmRoutes(app);
  await registerMaintWoApRoutes(app);
  await registerForm425CRoutes(app);
  // Form 425-C Exhibits A–F generator. Previously left unmounted (held as "financial-adjacent"),
  // which made the mounted /reports/form-425c/exhibits page call a route that returned 404 — the
  // exhibits could not be produced or reviewed at all. Mounting EXPOSES THE GENERATOR ONLY:
  // rendering an exhibit is not filing one, and the routes are read-only (no write, no posting, no
  // flag). Auth is unchanged and already enforced inside the handlers — currentAuthUser + a
  // canAccess425cExhibits role check (403) + withCompanyScope entity scoping on every read.
  await registerForm425cExhibitsRoutes(app);
  await registerTaxDocumentRoutes(app);
  await registerListsHubRoutes(app);
  await registerListsCountsRoutes(app);
  await registerLocationsListRoutes(app);
  await registerDriversReferenceRoutes(app);
  await registerOemPartsRoutes(app);
  await registerNamesMasterRoutes(app);
  await registerAccountingRoutes(app);
  // ACCT-F5726 / DUPLICATE-ROUTE-BOOT-CRASH — only driver-reimbursement-detail is mounted here.
  // registerAccountingRoutes() above runs @fastify/autoload over this directory with
  // matchFilter /\.routes\.(ts|js)$/, so any accounting route file that has a
  // `export default fp(...)` is ALREADY mounted by it. recurring-template-detail,
  // period-close-detail and schedule-row-detail all export that default, so registering them
  // again here threw `Method 'GET' already declared for route` inside main() BEFORE app.listen(),
  // as an unhandled rejection: the process stayed alive but never listened, so every instance sat
  // RUNNING/ready=false and Render cancelled the deploy at its 15-minute health-check limit.
  // driver-reimbursement-detail.routes.ts has NO default export, so autoload skips it and it
  // genuinely does need this explicit mount — that is the 404 the original fix was chasing.
  // Adding a new accounting route file: give it `export default fp(...)` and add NOTHING here.
  await registerDriverReimbursementDetailRoutes(app);
  // 0441-mod10: explicit mount — accounting autoload alone left these as silent orphans in route audits.
  await registerCashFlowRoutes(app);
  await registerCashForecastRoutes(app);
  await registerFinanceHubRoutes(app);
  await registerApPaymentApplicationRoutes(app);
  await registerCompanyRoutes(app);
  await registerLegalTemplateRoutes(app);
  await registerLegalContractRoutes(app);
  await registerLegalSignRoutes(app);
  await registerLegalAttorneyReviewRoutes(app);
  await registerLegalMattersRoutes(app);
  await registerDailyTasksRoutes(app);
  await app.register(taskRoutes, { prefix: "/api/v1/tasks" });
  await registerTelematicsHosRoutes(app);
  await registerHosTrackerRoutes(app);
  await registerPredictedDeliveryRoutes(app);
  await registerVehicleDriverPairingRoutes(app);
  await registerPayrollDriverSettlementRoutes(app);
  await registerSettlementShadowRoutes(app);
  await registerDriverSubAccountBackfillRoutes(app);
  await registerBankOrphanBackfillRoutes(app);
  await registerPayrollAggregatedRoutes(app);
  await registerUsmcaActivationRoutes(app);

  // Render healthCheckPath cannot bind until listen(). Starting ~20 in-process workers BEFORE
  // listen starves the event loop: pre_deploy smoke dies ~86s AND rolling updates sit in
  // update_in_progress then update_failed while prod keeps the old SHA. Bind first, then workers.
  // IH35_BOOT_API_SMOKE=true still skips workers (GitHub CI boot smokes).
  const bootApiSmoke = process.env.IH35_BOOT_API_SMOKE === "true";
  if (bootApiSmoke) {
    app.log.info("[STARTUP] IH35_BOOT_API_SMOKE — skipping in-process workers so listen() can answer health");
  }


  const port = Number(process.env.PORT || 3000);
  const host = "0.0.0.0";
  try {
    await app.ready();
    assertNoDuplicateFastifyRoutes(app);

    // Bind PORT before the Neon drift query. A hung/slow boot guard after ready() left
    // Render scanning "No open ports" then update_failed (prod stuck on old SHA).
    await app.listen({ port, host });
    app.log.info({ port, host }, "Server started");

    const conn = await pool.connect();
    try {
      await assertMigrationDriftBootGuard({
        repoRoot,
        client: conn,
        logError: (obj, msg) => app.log.error(obj, msg),
      });
    } finally {
      conn.release();
    }
    if (!bootApiSmoke) {
    try {
      initializeAccountingCrons(app);
      app.log.info("[STARTUP] accounting cron suite initialized");
    } catch (error) {
      app.log.error({ err: error }, "[STARTUP] accounting cron suite failed");
    }

    try {
      // FLT-01: monthly asset-depreciation batch; per-entity FIXED_ASSET_AUTOPOST_ENABLED stays OFF
      // unless Jorge explicitly enables it. Each eligible asset receives an append-only run receipt.
      initializeDepreciationAutopostCron(app);
      app.log.info("[STARTUP] depreciation-autopost cron initialized");
    } catch (error) {
      app.log.error({ err: error }, "[STARTUP] depreciation-autopost cron failed");
    }

    try {
      // GO-20 slice A — nightly leg of the drift detector (the other leg runs synchronously after
      // every reconciliation-session finalize, apps/backend/src/banking/p7-wave2.routes.ts).
      initializeBankDriftAlertsCron(app);
      app.log.info("[STARTUP] bank-drift-alerts cron initialized");
    } catch (error) {
      app.log.error({ err: error }, "[STARTUP] bank-drift-alerts cron failed");
    }

    try {
      // CASH-FLOW-ACTUAL-VS-PROJECTED-INCOME-STRUCTURALLY-ALWAYS-ZERO — daily append-only snapshot
      // of each company's projected income, captured before the day's loads can complete their
      // lifecycle and retroactively zero out the live projection query.
      initializeCashFlowProjectionSnapshotCron(app);
      app.log.info("[STARTUP] cash-flow-projection-snapshot cron initialized");
    } catch (error) {
      app.log.error({ err: error }, "[STARTUP] cash-flow-projection-snapshot cron failed");
    }

    try {
      // CASH-FLOW-02 part (b) (owner order 2026-09-06 20:1xZ): a Rolling Ledger row overdue more
      // than 3 days raises exactly one in-app notification, deduped by entity, never re-fired.
      initializeCashFlowRollingLedgerNotifyCron(app);
      app.log.info("[STARTUP] cash-flow-rolling-ledger-notify cron initialized");
    } catch (error) {
      app.log.error({ err: error }, "[STARTUP] cash-flow-rolling-ledger-notify cron failed");
    }

    try {
      await initializeQboHistoricalImportRunner(app);
      app.log.info("[STARTUP] qbo-forensic-runner initialized");
    } catch (error) {
      app.log.error({ err: error }, "[STARTUP] qbo-forensic-runner failed");
      (app as unknown as { forensicRunnerStatus?: string }).forensicRunnerStatus = "failed";
    }

    try {
      await initializeQboSyncQueueRunner(app);
      app.log.info("[STARTUP] qbo-sync-runner initialized");
    } catch (error) {
      app.log.error({ err: error }, "[STARTUP] qbo-sync-runner failed");
    }

    try {
      initializeQboInboundSyncCron(app);
      app.log.info("[STARTUP] qbo-inbound-sync initialized");
    } catch (error) {
      app.log.error({ err: error }, "[STARTUP] qbo-inbound-sync failed");
    }

    try {
      initializeQboCdcPollCron(app);
      app.log.info("[STARTUP] qbo-cdc-poll initialized");
    } catch (error) {
      app.log.error({ err: error }, "[STARTUP] qbo-cdc-poll failed");
    }

    try {
      initializeRecurringTemplatesCron(app);
      app.log.info("[STARTUP] recurring-templates cron initialized");
    } catch (error) {
      app.log.error({ err: error }, "[STARTUP] recurring-templates cron failed");
    }

    // GAP-20 / HOLD-FOR-JORGE: the recurring-bill-templates generator (accounting.recurring_bill_templates
    // -> creates a real accounting.bills AP row on every due template, daily at 06:00 CT) was fully built
    // (table + generator.service.ts + this worker) but never started -- the FE pages that create templates
    // were also unrouted until this change. Bill CREATION here is unconditional (not gated by the
    // BILL_GL_POSTING_ENABLED flag, which only gates the SEPARATE auto-post-to-GL sub-step inside
    // generateFromTemplate). Starting this daily job therefore makes the server autonomously write
    // accounting.bills rows for any active template -- a financial-cluster write with no per-action human
    // confirmation. Per CLAUDE.md SS1.4 (never enable money-moving/posting automation without explicit
    // owner OK) this ships OFF by default behind an explicit opt-in env var; Jorge decides when to flip it.
    if (process.env.RECURRING_BILL_GENERATOR_CRON_ENABLED === "true") {
      try {
        initializeRecurringBillGeneratorWorker(app);
        app.log.info("[STARTUP] recurring-bill-generator-worker initialized (RECURRING_BILL_GENERATOR_CRON_ENABLED=true)");
      } catch (error) {
        app.log.error({ err: error }, "[STARTUP] recurring-bill-generator-worker failed");
      }
    } else {
      app.log.info("[STARTUP] recurring-bill-generator-worker NOT started (RECURRING_BILL_GENERATOR_CRON_ENABLED != 'true' -- default OFF, HOLD-FOR-JORGE)");
    }

    try {
      await initializeQboTokenRefreshCron(app);
      app.log.info("[STARTUP] qbo-token-refresh-cron initialized");
    } catch (error) {
      app.log.error({ err: error }, "[STARTUP] qbo-token-refresh-cron failed");
    }

    try {
      initializeCashAdvanceRequestExpiryCron(app);
      initializeGoogleReferenceMilesExpiryCron(app);
      app.log.info("[STARTUP] cash-advance-request-expiry-cron initialized");
    } catch (error) {
      app.log.error({ err: error }, "[STARTUP] cash-advance-request-expiry-cron failed");
    }

    try {
      initializeChatConfirmationEscalationCron(app);
      app.log.info("[STARTUP] chat-confirmation-escalation-cron initialized");
    } catch (error) {
      app.log.error({ err: error }, "[STARTUP] chat-confirmation-escalation-cron failed");
    }

    try {
      initializeSamsaraHealthCheckCron(app);
      app.log.info("[STARTUP] samsara-health-cron initialized");
    } catch (error) {
      app.log.error({ err: error }, "[STARTUP] samsara-health-cron failed");
    }

    try {
      // RELAY-FUEL-INGEST-1 (doc 21 Part A gap 1): the cron was defined but never registered. It is
      // gated by RELAY_FUEL_INGEST_CRON_ENABLED (env, default true) AND the per-entity RELAY_FUEL_INGEST_ENABLED
      // flag (default OFF), so wiring it here is a no-op until the owner sets the key + flips the flag. Staging
      // ingest only — writes integrations.relay_fuel_transactions*, no GL, no accounting.* / fuel.* write.
      initializeRelayFuelIngestCron(app);
      app.log.info("[STARTUP] relay-fuel-ingest-cron initialized");
    } catch (error) {
      app.log.error({ err: error }, "[STARTUP] relay-fuel-ingest-cron failed");
    }

    try {
      initializeModelLifecycleMonitorCron(app);
      app.log.info("[STARTUP] model-lifecycle-monitor-cron initialized");
    } catch (error) {
      app.log.error({ err: error }, "[STARTUP] model-lifecycle-monitor-cron failed");
    }

    try {
      initializeSamsaraWebhookProjectionCron(app);
      app.log.info("[STARTUP] samsara-webhook-projection-cron initialized");
    } catch (error) {
      app.log.error({ err: error }, "[STARTUP] samsara-webhook-projection-cron failed");
    }

    try {
      initializeSamsaraRemoteCountCollectorCron(app);
      app.log.info("[STARTUP] samsara-remote-count-collector-cron initialized");
    } catch (error) {
      app.log.error({ err: error }, "[STARTUP] samsara-remote-count-collector-cron failed");
    }

    try {
      initializeSamsaraPositionsCron(app);
      app.log.info("[STARTUP] samsara-positions-cron initialized");
    } catch (error) {
      app.log.error({ err: error }, "[STARTUP] samsara-positions-cron failed");
    }

    try {
      initializeReeferHoursPollCron(app);
      app.log.info("[STARTUP] reefer-hours-poll-cron initialized");
    } catch (error) {
      app.log.error({ err: error }, "[STARTUP] reefer-hours-poll-cron failed");
    }

    try {
      initializeRealDrivenMilesSegmentsCron(app);
      app.log.info("[STARTUP] real-driven-miles-segments-cron initialized");
    } catch (error) {
      app.log.error({ err: error }, "[STARTUP] real-driven-miles-segments-cron failed");
    }

    try {
      if (isFeatureDisabled("samsara_master_sync")) {
        app.log.warn("[STARTUP] samsara-master-sync-cron disabled by required env checks");
      } else {
        initializeSamsaraMasterSyncCron(app);
        app.log.info("[STARTUP] samsara-master-sync-cron initialized");
      }
    } catch (error) {
      app.log.error({ err: error }, "[STARTUP] samsara-master-sync-cron failed");
    }

    try {
      initializeSamsaraHosPullCron(app);
      app.log.info("[STARTUP] samsara-hos-pull-cron initialized");
    } catch (error) {
      app.log.error({ err: error }, "[STARTUP] samsara-hos-pull-cron failed");
    }

    try {
      initializeFuelGpsMatchCron(app);
      initializeBankReconAutoMatchCron(app);
      initializeDraftCrewStatusSelfHealCron(app);
      app.log.info("[STARTUP] fuel-gps-match-cron initialized");
    } catch (error) {
      app.log.error({ err: error }, "[STARTUP] fuel-gps-match-cron failed");
    }

    try {
      initializeLovesCardImportCron(app);
      app.log.info("[STARTUP] loves-card-import-cron initialized");
    } catch (error) {
      app.log.error({ err: error }, "[STARTUP] loves-card-import-cron failed");
    }

    try {
      initializeReconCron(app);
      app.log.info("[STARTUP] recon-cron initialized");
    } catch (error) {
      app.log.error({ err: error }, "[STARTUP] recon-cron failed");
    }

    try {
      initializeAuditChainVerifyCron(app);
      app.log.info("[STARTUP] audit-chain-verify-cron initialized");
    } catch (error) {
      app.log.error({ err: error }, "[STARTUP] audit-chain-verify-cron failed");
    }

    try {
      initializePlaidDailySyncCron(app);
      initializePlaidDailyRefreshCron(app);
      app.log.info("[STARTUP] plaid-daily-sync-cron initialized");
    } catch (error) {
      app.log.error({ err: error }, "[STARTUP] plaid-daily-sync-cron failed");
    }

    try {
      initializeDriverSettlementAutoPayCron(app);
      app.log.info("[STARTUP] driver-settlement-auto-pay-cron initialized");
    } catch (error) {
      app.log.error({ err: error }, "[STARTUP] driver-settlement-auto-pay-cron failed");
    }

    try {
      initializeGeofenceBreachDetectorCron(app);
      app.log.info("[STARTUP] geofence-breach-cron initialized");
    } catch (error) {
      app.log.error({ err: error }, "[STARTUP] geofence-breach-cron failed");
    }

    try {
      // P8C-K driver scheduler leave crons — each self-gates OFF unless its env flag is set to "true".
      initializeDriverLeaveAdvanceReminderCron(app);
      initializeDriverLeaveBalanceRolloverCron(app);
      initializeDriverLeavePendingEscalationCron(app);
      app.log.info("[STARTUP] driver-leave scheduler crons initialized");
    } catch (error) {
      app.log.error({ err: error }, "[STARTUP] driver-leave scheduler crons failed");
    }

    try {
      initializeDriverVendorMappingWorker(app);
      initializeSamsaraPositionPollWorker(app);
      initializeGeofenceStateWatcher(app);
      initializeGeofenceReconciliationWorker(app);
      initializeAnomalyDetectorWorker(app);
      initializeFuelFraudDetectorWorker(app);
      initializeDataSovereigntyDailySync(app);
      app.log.info("[STARTUP] geofence-reconciliation-daily worker initialized");
    } catch (error) {
      app.log.error({ err: error }, "[STARTUP] geofence-reconciliation-daily worker failed");
    }

    try {
      initializeBorderCrossingDetectorWorker(app);
      app.log.info("[STARTUP] border-crossing-detector-worker initialized");
    } catch (error) {
      app.log.error({ err: error }, "[STARTUP] border-crossing-detector-worker failed");
    }

    try {
      initializeVehicleDriverPairingWorker(app);
      app.log.info("[STARTUP] vehicle-driver-pairing-worker initialized");
    } catch (error) {
      app.log.error({ err: error }, "[STARTUP] vehicle-driver-pairing-worker failed");
    }

    try {
      initializeLayoverDetectorWorker(app);
      app.log.info("[STARTUP] layover-detector-worker initialized");
    } catch (error) {
      app.log.error({ err: error }, "[STARTUP] layover-detector-worker failed");
    }

    try {
      initializeActiveDriverSetRecomputeWorker(app);
      app.log.info("[STARTUP] active-driver-set-recompute worker initialized");
    } catch (error) {
      app.log.error({ err: error }, "[STARTUP] active-driver-set-recompute worker failed");
    }

    try {
      initializeDriverActive30dWorker(app);
      app.log.info("[STARTUP] driver-active-30d worker initialized");
    } catch (error) {
      app.log.error({ err: error }, "[STARTUP] driver-active-30d worker failed");
    }

    try {
      initializeAutoStatusSwitchWorker(app);
      app.log.info("[STARTUP] auto-status-switch-worker initialized");
    } catch (error) {
      app.log.error({ err: error }, "[STARTUP] auto-status-switch-worker failed");
    }

    try {
      initializeCap14CargoSensorWorker(app);
      app.log.info("[STARTUP] cap-14-cargo-sensor-worker initialized");
    } catch (error) {
      app.log.error({ err: error }, "[STARTUP] cap-14-cargo-sensor-worker failed");
    }

    try {
      initializeCap12TireTreadWorker(app);
      app.log.info("[STARTUP] cap-12-tire-tread-worker initialized");
    } catch (error) {
      app.log.error({ err: error }, "[STARTUP] cap-12-tire-tread-worker failed");
    }

    try {
      initializeCap13BrakeWearWorker(app);
      app.log.info("[STARTUP] cap-13-brake-wear-worker initialized");
    } catch (error) {
      app.log.error({ err: error }, "[STARTUP] cap-13-brake-wear-worker failed");
    }

    try {
      initializePredictiveAlertsWorker(app);
      app.log.info("[STARTUP] predictive-alerts-worker initialized");
    } catch (error) {
      app.log.error({ err: error }, "[STARTUP] predictive-alerts-worker failed");
    }

    try {
      initializeBookingGapAggregatorWorker(app);
      app.log.info("[STARTUP] booking-gap aggregator worker initialized");
    } catch (error) {
      app.log.error({ err: error }, "[STARTUP] booking-gap aggregator worker failed");
    }

    try {
      cron.schedule(
        "*/30 * * * *",
        async () => {
          await withLuciaBypass(async (client) => {
            const companies = await client.query<{ id: string }>(
              `SELECT id::text AS id FROM org.companies WHERE is_active = true AND deactivated_at IS NULL ORDER BY id`
            );
            for (const company of companies.rows) {
              await client.query(`SELECT set_config('app.operating_company_id', $1::text, true)`, [company.id]);
              const result = await runAnomalyDetectionForTenant(client, company.id);
              app.log.info(
                { operating_company_id: company.id, scanned: result.scanned, inserted: result.inserted },
                "[STARTUP] anomaly detector run complete"
              );
            }
          });
        },
        {
        maxRandomDelay: 20000 /* cron-stagger (code only) — see PROD-OUTAGE-STEADY-STATE-CRON-PILEUP-CONFIRMED */, timezone: "America/Chicago" }
      );
      app.log.info("[STARTUP] anomaly-detector-cron initialized");
    } catch (error) {
      app.log.error({ err: error }, "[STARTUP] anomaly-detector-cron failed");
    }

    try {
      initializeLegalMattersReminderCron(app);
      app.log.info("[STARTUP] legal-matters-reminder-cron initialized");
    } catch (error) {
      app.log.error({ err: error }, "[STARTUP] legal-matters-reminder-cron failed");
    }

    try {
      initializeInsurancePaymentReminderCron(app);
      app.log.info("[STARTUP] insurance-payment-reminder-cron initialized");
    } catch (error) {
      app.log.error({ err: error }, "[STARTUP] insurance-payment-reminder-cron failed");
    }

    try {
      initializeInsuranceLateFeeCron(app);
      app.log.info("[STARTUP] insurance-late-fee-cron initialized");
    } catch (error) {
      app.log.error({ err: error }, "[STARTUP] insurance-late-fee-cron failed");
    }

    try {
      initializeFactoringPacketSweepCron(app);
      app.log.info("[STARTUP] factoring-packet-sweep-cron initialized");
    } catch (error) {
      app.log.error({ err: error }, "[STARTUP] factoring-packet-sweep-cron failed");
    }

    try {
      initializeSafetyRemindersCron(app);
      app.log.info("[STARTUP] safety-reminders-cron initialized");

      initializeIntegrityAlertEngineCron(app);
      app.log.info("[STARTUP] integrity-alert-engine-cron initialized");

      initializeDocumentAlertEngineCron(app);
      app.log.info("[STARTUP] document-alert-engine-cron initialized");

      initializeDaRandomPoolDrawWorker(app);
      app.log.info("[STARTUP] da-random-pool-draw-worker initialized");

      initializeDamageContinuityWorker(app);
      app.log.info("[STARTUP] damage-continuity-worker initialized");

      initializeCertExpiryMonitor(app);
      initializeInsuranceMonthlyReportCron(app);
      app.log.info("[STARTUP] insurance-monthly-report-cron initialized");
      initializeSamsaraCacheWarmer(app);
      app.log.info("[STARTUP] samsara-cache-warmer initialized");
      initializeSearchIndexerIncremental(app);
      app.log.info("[STARTUP] cert-expiry-monitor initialized");

      initializeLoanPaymentReminder(app);
      app.log.info("[STARTUP] loan-payment-reminder initialized");

      initializePmAutoEngineCron(app);
      app.log.info("[STARTUP] pm-auto-engine-cron initialized");
    } catch (error) {
      app.log.error({ err: error }, "[STARTUP] safety-reminders-cron failed");
    }

    try {
      await initializeMasterDataSyncCron(app);
      app.log.info("[STARTUP] qbo-master-data-sync-cron initialized");
    } catch (error) {
      app.log.error({ err: error }, "[STARTUP] qbo-master-data-sync-cron failed");
    }

    try {
      initializeQboSyncAlertsCron(app);
      app.log.info("[STARTUP] qbo-sync-alerts-cron initialized");
    } catch (error) {
      app.log.error({ err: error }, "[STARTUP] qbo-sync-alerts-cron failed");
    }

    try {
      initializeQboSyncDriftScheduler(app);
      app.log.info("[STARTUP] qbo-sync-drift-scheduler initialized");
    } catch (error) {
      app.log.error({ err: error }, "[STARTUP] qbo-sync-drift-scheduler failed");
    }

    try {
      initializeQboRemoteCountCollectorCron(app);
      app.log.info("[STARTUP] qbo-remote-count-collector-cron initialized");
    } catch (error) {
      app.log.error({ err: error }, "[STARTUP] qbo-remote-count-collector-cron failed");
    }

    try {
      initializeReconciliationWorkerCron(app);
      app.log.info("[STARTUP] reconciliation-worker-cron initialized");
    } catch (error) {
      app.log.error({ err: error }, "[STARTUP] reconciliation-worker-cron failed");
    }

    try {
      initializeLedgerIntegrityCron(app);
      app.log.info("[STARTUP] ledger-integrity-cron initialized");
    } catch (error) {
      app.log.error({ err: error }, "[STARTUP] ledger-integrity-cron failed");
    }

    try {
      initializeEmailCron(app);
      app.log.info("[STARTUP] email-cron initialized");
    } catch (error) {
      app.log.error({ err: error }, "[STARTUP] email-cron failed");
    }

    try {
      initializeReportsRoleScheduler(app);
      app.log.info("[STARTUP] reports-role-scheduler initialized");
      initializeScheduledReportsEmailer(app);
      app.log.info("[STARTUP] scheduled-reports-emailer initialized");
      initializeScheduledReportsWorker(app);
      app.log.info("[STARTUP] scheduled-reports-worker (canonical, reporting.scheduled_reports) initialized");
    } catch (error) {
      app.log.error({ err: error }, "[STARTUP] reports-role-scheduler failed");
    }

    try {
      initializeErrorDigestCron(app);
      app.log.info("[STARTUP] error-digest scheduler initialized");
    } catch (error) {
      app.log.error({ err: error }, "[STARTUP] error-digest scheduler failed");
    }

    try {
      // FINDING H5-3 — nightly R2-evidence presence reconcile (read-only; default OFF via
      // EVIDENCE_PRESENCE_RECONCILE_ENABLED). Fail-loud CRITICAL alarm on any evidence object missing in R2.
      initializeEvidencePresenceReconcileCron(app);
      app.log.info("[STARTUP] evidence-presence reconcile scheduler initialized");
    } catch (error) {
      app.log.error({ err: error }, "[STARTUP] evidence-presence reconcile scheduler failed");
    }

    try {
      initializeIdempotencyCleanupCron(app);
      app.log.info("[STARTUP] idempotency-cleanup cron initialized");
    } catch (error) {
      app.log.error({ err: error }, "[STARTUP] idempotency-cleanup cron failed");
    }

    // SYSTEM-BACKGROUND-JOB-LEDGER-STALE-AFTER-SUCCESSFUL-TICKS — fire-and-forget one tick for
    // overdue in-process jobs node-cron missed during deploys. Does not hide genuine stalls.
    try {
      startInProcessJobCatchup(app);
      app.log.info("[STARTUP] in-process overdue job catch-up armed");
    } catch (error) {
      app.log.error({ err: error }, "[STARTUP] in-process job catch-up failed to arm");
    }

    try {
      registerScenarioCertifyCron(app);
      app.log.info("[STARTUP] scenario-certify cron initialized");
    } catch (error) {
      app.log.error({ err: error }, "[STARTUP] scenario-certify cron failed");
    }

    try {
      initializeDailyTaskAlertsCron(app);
      app.log.info("[STARTUP] daily-task-alerts cron initialized");
      initializeTodaysAttentionWorker(app);
      app.log.info("[STARTUP] todays-attention worker initialized");
    } catch (error) {
      app.log.error({ err: error }, "[STARTUP] daily-task-alerts cron failed");
    }

    try {
      initializeAdminJobsWorker(app);
      app.log.info("[STARTUP] admin-jobs-worker initialized");
    } catch (error) {
      app.log.error({ err: error }, "[STARTUP] admin-jobs-worker failed");
    }

    try {
      initializeLateArrivalAggregatorWorker(app);
      app.log.info("[STARTUP] late-arrival aggregator worker initialized");
    } catch (error) {
      app.log.error({ err: error }, "[STARTUP] late-arrival aggregator worker failed");
    }

    try {
      initializeCustomerRelationshipScorerWorker(app);
      app.log.info("[STARTUP] customer-relationship scorer worker initialized");
      initializeDriverRetentionScorerWorker(app);
      app.log.info("[STARTUP] driver-retention scorer worker initialized");
    } catch (error) {
      app.log.error({ err: error }, "[STARTUP] customer-relationship scorer worker failed");
    }

    try {
      initializeDriverScoringAggregatorWorker(app);
      app.log.info("[STARTUP] driver-scoring aggregator worker initialized");
    } catch (error) {
      app.log.error({ err: error }, "[STARTUP] driver-scoring aggregator worker failed");
    }

    try {
      initializeQboCustomersPushScheduler(app);
      app.log.info("[STARTUP] qbo-customers-push scheduler initialized");
    } catch (error) {
      app.log.error({ err: error }, "[STARTUP] qbo-customers-push scheduler failed");
    }

    try {
      initializeQboVendorsPushScheduler(app);
      app.log.info("[STARTUP] qbo-vendors-push scheduler initialized");
    } catch (error) {
      app.log.error({ err: error }, "[STARTUP] qbo-vendors-push scheduler failed");
    }

    try {
      initializeQboAccountsPushScheduler(app);
      app.log.info("[STARTUP] qbo-accounts-push scheduler initialized");
    } catch (error) {
      app.log.error({ err: error }, "[STARTUP] qbo-accounts-push scheduler failed");
    }

    try {
      initializeQboSyncWorker(app);
      app.log.info("[STARTUP] qbo-sync-run-worker initialized");
    } catch (error) {
      app.log.error({ err: error }, "[STARTUP] qbo-sync-run-worker failed");
    }

    try {
      initializeQboOutboxDispatcher(app);
      app.log.info("[STARTUP] qbo-outbox-dispatcher initialized");
    } catch (error) {
      app.log.error({ err: error }, "[STARTUP] qbo-outbox-dispatcher failed");
    }
    }
    if (!bootApiSmoke && process.env.ENABLE_OUTBOX_PROCESSOR !== "false") {
      startOutboxProcessor();
      app.log.info("Outbox processor started");
    }
    if (!bootApiSmoke) {
      setTimeout(() => {
        warmSystemModuleMatrixAtBoot({
          info: (obj, msg) => app.log.info(obj, msg),
          warn: (obj, msg) => app.log.warn(obj, msg),
        });
      }, 0);
    }

    // LEGAL-SEED-01: provision the per-entity legal template library for every active entity on
    // boot (idempotent — ON CONFLICT DO NOTHING). Fire-and-forget AFTER listen so it can never
    // block or fail the boot; the library works on deploy with no manual "Seed library" click.
    if (!bootApiSmoke) {
    void backfillLegalTemplateLibraries({
      logInfo: (obj, msg) => app.log.info(obj, msg),
      logError: (obj, msg) => app.log.error(obj, msg),
    })
      .then((res) =>
        app.log.info(
          {
            companies_seen: res.companies_seen,
            companies_seeded: res.companies_seeded,
            companies_skipped: res.companies_skipped,
            total_inserted: res.total_inserted,
          },
          "[STARTUP] legal-template-library backfill complete"
        )
      )
      .catch((err) => app.log.error({ err }, "[STARTUP] legal-template-library backfill failed"));
    }
  } catch (err) {
    app.log.error(err, "Server failed to start");
    process.exit(1);
  }
}

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

main();
