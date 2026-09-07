const MapView = React.lazy(() => import("../pages/dispatch/MapView").then((m) => ({ default: m.MapView })));
const ApiDocumentPassthrough = React.lazy(() =>
  import("../pages/ApiDocumentPassthrough").then((m) => ({ default: m.ApiDocumentPassthrough }))
);
const LoadBankingLinkagePage = React.lazy(() =>
  import("../pages/dispatch/LoadBankingLinkagePage").then((m) => ({ default: m.LoadBankingLinkagePage }))
);
import React from "react";
import { Navigate, Route, useLocation, useParams } from "react-router-dom";
import type { ReactNode } from "react";
import { useAuth } from "../auth/useAuth";
import { useCompanyContext } from "../contexts/CompanyContext";
import { Shell } from "../components/Shell";
import { resolveListsDomainHubKey } from "../pages/lists/components/AllCatalogsMap";
import { catalogKeyToCatalogName } from "../hooks/useCatalogQuery";
const CustomersPage = React.lazy(() => import("../pages/Customers").then((m) => ({ default: m.CustomersPage })));
const CustomerDetailPage = React.lazy(() => import("../pages/CustomerDetail").then((m) => ({ default: m.CustomerDetailPage })));
const CustomerStatementPage = React.lazy(() => import("../pages/reports/CounterpartyStatementPage").then((m) => ({ default: m.CustomerStatementPage })));
const VendorStatementPage = React.lazy(() => import("../pages/reports/CounterpartyStatementPage").then((m) => ({ default: m.VendorStatementPage })));
const ListsHubPage = React.lazy(() => import("../pages/lists/ListsHubPage").then((m) => ({ default: m.ListsHubPage })));
const ProgramBoardPage = React.lazy(() => import("../pages/program/ProgramBoardPage").then((m) => ({ default: m.ProgramBoardPage })));
const FinalAdditionsPage = React.lazy(() => import("../pages/program/FinalAdditionsPage").then((m) => ({ default: m.FinalAdditionsPage })));
const ProgramTrackerPage = React.lazy(() => import("../pages/program/ProgramTrackerPage").then((m) => ({ default: m.ProgramTrackerPage })));
const ModuleCompletionPage = React.lazy(() => import("../pages/program/ModuleCompletionPage").then((m) => ({ default: m.ModuleCompletionPage })));
const AuditScoreboardPage = React.lazy(() =>
  import("../pages/program/AuditScoreboardPage").then((m) => ({ default: m.AuditScoreboardPage }))
);
const LegacyAuditScoreboardPage = React.lazy(() =>
  import("../pages/program/LegacyAuditScoreboardPage").then((m) => ({ default: m.LegacyAuditScoreboardPage }))
);
const ModuleMatrixPreviewPage = React.lazy(() =>
  import("../pages/program/ModuleMatrixPreviewPage").then((m) => ({ default: m.ModuleMatrixPreviewPage }))
);
const SystemModulePage = React.lazy(() => import("../pages/system/SystemModulePage").then((m) => ({ default: m.SystemModulePage })));
const DomainCatalogHubPage = React.lazy(() => import("../pages/lists/DomainCatalogHubPage").then((m) => ({ default: m.DomainCatalogHubPage })));
// CATALOG-2 — factory-backed generic catalog CRUD (registry-driven, additive to the hand-rolled
// per-catalog list pages). Distinct route namespace (/lists/catalogs/...) so it never collides with
// an existing hand-rolled catalog route (e.g. /lists/fleet/equipment-types stays on its own page).
const CatalogIndex = React.lazy(() => import("../pages/lists/CatalogIndex").then((m) => ({ default: m.CatalogIndex })));
const GenericCatalogPage = React.lazy(() => import("../pages/lists/GenericCatalogPage").then((m) => ({ default: m.GenericCatalogPage })));
// CLOSURE-10 — enhanced maintenance parts search (by manufacturer/category), additive to the
// existing Maintenance Parts master CRUD list at /lists/maintenance/parts.
const MaintenancePartsCatalog = React.lazy(() => import("../pages/lists/MaintenancePartsCatalog").then((m) => ({ default: m.MaintenancePartsCatalog })));
// LST-F20b — bespoke page: its backend answers at /api/v1/catalogs/dispatch-flag-colors, not the
// generic /api/v1/catalogs/{domain}/{segment}, so it cannot ride GenericCatalogPage.
// LST-F20d — global reference catalogs (no operating_company_id); read-only by design.
const StatesCatalogPage = React.lazy(() => import("../pages/lists/reference/StatesCatalogPage").then((m) => ({ default: m.StatesCatalogPage })));
const DispatchFlagColorsCatalog = React.lazy(() => import("../pages/lists/dispatch/DispatchFlagColorsCatalog").then((m) => ({ default: m.DispatchFlagColorsCatalog })));
const DetailTypesListPage = React.lazy(() => import("../pages/lists/accounting/DetailTypesListPage").then((m) => ({ default: m.DetailTypesListPage })));
const NamesMasterHub = React.lazy(() => import("../pages/lists/names/NamesMasterHub").then((m) => ({ default: m.NamesMasterHub })));
const BrokersListPage = React.lazy(() => import("../pages/lists/names/BrokersListPage").then((m) => ({ default: m.BrokersListPage })));
const LocationsListPage = React.lazy(() => import("../pages/lists/LocationsListPage").then((m) => ({ default: m.LocationsListPage })));
const DriverDetailPage = React.lazy(() => import("../pages/DriverDetail").then((m) => ({ default: m.DriverDetailPage })));
const DriverProfilePage = React.lazy(() => import("../pages/drivers/DriverProfilePage").then((m) => ({ default: m.DriverProfilePage })));
const DriverLayoverHistoryPage = React.lazy(() => import("../pages/drivers/DriverLayoverHistoryPage").then((m) => ({ default: m.DriverLayoverHistoryPage })));
const DriverHosDetailPage = React.lazy(() => import("../pages/drivers/DriverHosDetailPage").then((m) => ({ default: m.DriverHosDetailPage })));
const MessagesInboxPage = React.lazy(() => import("../pages/drivers/MessagesInboxPage").then((m) => ({ default: m.MessagesInboxPage })));
const DocumentAlertsPage = React.lazy(() => import("../pages/alerts/DocumentAlertsPage").then((m) => ({ default: m.DocumentAlertsPage })));
const OnboardingWizardPage = React.lazy(() => import("../pages/drivers/OnboardingWizardPage").then((m) => ({ default: m.OnboardingWizardPage })));
const ApplicantsPipelinePage = React.lazy(() => import("../pages/drivers/ApplicantsPipelinePage").then((m) => ({ default: m.ApplicantsPipelinePage })));
const ApplicationPage = React.lazy(() => import("../pages/public/ApplicationPage").then((m) => ({ default: m.ApplicationPage })));
const DriverLoadStatusesPage = React.lazy(() => import("../pages/DriverLoadStatusesPage").then((m) => ({ default: m.DriverLoadStatusesPage })));
const DriversPage = React.lazy(() => import("../pages/Drivers").then((m) => ({ default: m.DriversPage })));
const RetentionDashboard = React.lazy(() => import("../pages/drivers/RetentionDashboard").then((m) => ({ default: m.RetentionDashboard })));
import type { DriversSubnavId } from "../components/drivers/DRIVERS_TABS_CONFIG";
const DispatchPage = React.lazy(() => import("../pages/Dispatch").then((m) => ({ default: m.DispatchPage })));
const GeofencesPage = React.lazy(() => import("../pages/operations/GeofencesPage").then((m) => ({ default: m.GeofencesPage })));
const DispatchAlertsPage = React.lazy(() => import("../pages/dispatch/DispatchAlertsPage").then((m) => ({ default: m.DispatchAlertsPage })));
const LateArrivalsPage = React.lazy(() => import("../pages/dispatch/LateArrivalsPage").then((m) => ({ default: m.LateArrivalsPage })));
const AtRiskQueuePage = React.lazy(() => import("../pages/dispatch/AtRiskQueuePage").then((m) => ({ default: m.AtRiskQueuePage })));
const FactoringQueuePage = React.lazy(() => import("../pages/dispatch/FactoringQueuePage").then((m) => ({ default: m.FactoringQueuePage })));
const DriverBillRemintScreen = React.lazy(() => import("../pages/dispatch/DriverBillRemintScreen").then((m) => ({ default: m.DriverBillRemintScreen })));
const InTransitIssuesPage = React.lazy(() => import("../pages/dispatch/InTransitIssuesPage").then((m) => ({ default: m.InTransitIssuesPage })));
const AssignmentHistoryPage = React.lazy(() => import("../pages/dispatch/AssignmentHistoryPage").then((m) => ({ default: m.AssignmentHistoryPage })));
const OwnerOverrideLogPage = React.lazy(() => import("../pages/dispatch/OwnerOverrideLogPage").then((m) => ({ default: m.OwnerOverrideLogPage })));
const PlannerCalendarPage = React.lazy(() => import("../pages/dispatch/PlannerCalendarPage").then((m) => ({ default: m.PlannerCalendarPage })));
import { DispatchPlannersLayout } from "../pages/dispatch/planners/DispatchPlannersLayout";
const UnifiedTimelinePlanner = React.lazy(() => import("../pages/dispatch/planners/UnifiedTimelinePlanner").then((m) => ({ default: m.UnifiedTimelinePlanner })));
const DriverPlanner = React.lazy(() => import("../pages/dispatch/planners/DriverPlanner").then((m) => ({ default: m.DriverPlanner })));
const TruckPlanner = React.lazy(() => import("../pages/dispatch/planners/TruckPlanner").then((m) => ({ default: m.TruckPlanner })));
const LoadsPlanner = React.lazy(() => import("../pages/dispatch/planners/LoadsPlanner").then((m) => ({ default: m.LoadsPlanner })));
const DetentionBoardPage = React.lazy(() => import("../pages/dispatch/DetentionBoardPage").then((m) => ({ default: m.DetentionBoardPage })));
const EquipmentTransferRequestsPage = React.lazy(() => import("../pages/dispatch/EquipmentTransferRequests").then((m) => ({ default: m.EquipmentTransferRequestsPage })));
const OcrQueuePage = React.lazy(() => import("../pages/dispatch/OcrQueuePage").then((m) => ({ default: m.OcrQueuePage })));
const NotifyPreferencesPage = React.lazy(() => import("../pages/dispatch/NotifyPreferencesPage").then((m) => ({ default: m.NotifyPreferencesPage })));
const PodReviewPage = React.lazy(() => import("../pages/dispatch/PodReviewPage").then((m) => ({ default: m.PodReviewPage })));
const DispatchSettingsPage = React.lazy(() => import("../pages/dispatch/DispatchSettingsPage").then((m) => ({ default: m.DispatchSettingsPage })));
const BorderCrossingWizardPage = React.lazy(() => import("../pages/dispatch/BorderCrossingWizardPage").then((m) => ({ default: m.BorderCrossingWizardPage })));
const BorderCrossingHistoryPage = React.lazy(() => import("../pages/dispatch/BorderCrossingHistoryPage").then((m) => ({ default: m.BorderCrossingHistoryPage })));
import { BorderCrossingHistory as GpsBorderCrossingHistory } from "../pages/dispatch/borders/BorderCrossingHistory";
const SettlementsPage = React.lazy(() => import("../pages/driver-finance/SettlementsPage").then((m) => ({ default: m.SettlementsPage })));
const CashAdvanceRequestsPage = React.lazy(() => import("../pages/driver-finance/CashAdvanceRequestsPage").then((m) => ({ default: m.CashAdvanceRequestsPage })));
const CompanySettlementsPage = React.lazy(() => import("../pages/driver-finance/CompanySettlementsPage").then((m) => ({ default: m.CompanySettlementsPage })));
const SettlementCloseArrivalPage = React.lazy(() => import("../pages/driver-finance/SettlementCloseArrivalPage").then((m) => ({ default: m.SettlementCloseArrivalPage })));
const OwnerApprovalPortalPage = React.lazy(() => import("../pages/driver-finance/OwnerApprovalPortalPage").then((m) => ({ default: m.OwnerApprovalPortalPage })));
import { PortalLayout } from "../portal/PortalLayout";
const PortalLoginPage = React.lazy(() => import("../portal/PortalLoginPage").then((m) => ({ default: m.PortalLoginPage })));
const PortalDashboardPage = React.lazy(() => import("../portal/PortalDashboardPage").then((m) => ({ default: m.PortalDashboardPage })));
const PortalLoadDetailPage = React.lazy(() => import("../portal/PortalLoadDetailPage").then((m) => ({ default: m.PortalLoadDetailPage })));
const PortalProfilePage = React.lazy(() => import("../portal/PortalProfilePage").then((m) => ({ default: m.PortalProfilePage })));
import { PortalRouteGuard } from "../portal/PortalRouteGuard";
import { FuelPlannerHomePage, type FuelTabId } from "../pages/fuel/FuelPlannerHome";
const FraudAlertsListPage = React.lazy(() => import("../pages/fuel/fraud-alerts/FraudAlertsList").then((m) => ({ default: m.FraudAlertsListPage })));
const CardOverageQueuePage = React.lazy(() =>
  import("../pages/fuel/card-overage/CardOverageQueuePage").then((m) => ({ default: m.CardOverageQueuePage }))
);
const BankingHomePage = React.lazy(() => import("../pages/banking/BankingHome").then((m) => ({ default: m.BankingHomePage })));
const TransfersListPage = React.lazy(() => import("../pages/banking/TransfersListPage").then((m) => ({ default: m.TransfersListPage })));
const BankingObligationReconcilePage = React.lazy(() => import("../pages/banking/BankingObligationReconcilePage").then((m) => ({ default: m.BankingObligationReconcilePage })));
const ReconciliationWorkspacePage = React.lazy(() => import("../pages/banking/ReconciliationWorkspace").then((m) => ({ default: m.ReconciliationWorkspacePage })));
const BankReconciliationPage = React.lazy(() => import("../pages/banking/BankReconciliationPage").then((m) => ({ default: m.BankReconciliationPage })));
const CategorizationRulesPage = React.lazy(() => import("../pages/banking/CategorizationRulesPage").then((m) => ({ default: m.CategorizationRulesPage })));
const QboSyncQueuePage = React.lazy(() => import("../pages/banking/QboSyncQueuePage").then((m) => ({ default: m.QboSyncQueuePage })));
const EmailQueuePage = React.lazy(() => import("../pages/banking/EmailQueuePage").then((m) => ({ default: m.EmailQueuePage })));
const BankAccountDetailPage = React.lazy(() => import("../pages/banking/BankAccountDetail").then((m) => ({ default: m.BankAccountDetailPage })));
const BankAccountVisibilityPage = React.lazy(() => import("../pages/banking/BankAccountVisibilityPage").then((m) => ({ default: m.BankAccountVisibilityPage })));
const CashGlSetupPage = React.lazy(() => import("../pages/banking/CashGlSetupPage").then((m) => ({ default: m.CashGlSetupPage })));
import { SafetyLayout } from "../pages/safety/SafetyLayout";
const EldAuditTrailViewer = React.lazy(() => import("../pages/safety/eld/EldAuditTrailViewer").then((m) => ({ default: m.EldAuditTrailViewer })));
import {
  AccidentsIncidentsTab,
  CargoClaimsTab,
  ComplaintsTab,
  CSAScoreTab,
  DamageReportsTab,
  DOTComplianceTab,
  SafetyEventsTab,
  DOTInspectionsTab,
  DriverScoringTab,
  DriverFilesTab,
  DrugAlcoholTab,
  EscrowRecordTab,
  ExternalFinesTab,
  GeofenceBreachesTab,
  HOSViolationsTab,
  HoursOfServiceTab,
  IDVRTab,
  IntegrityReportsTab,
  PositionHistoryPage,
  InsuranceTab,
  InternalFinesTab,
  PermitsTab,
  SafetyHomeTab,
  SafetyMeetingsTab,
  SettingsTab,
  TrailerInterchangesTab,
} from "../pages/safety/tabs";
// SAFETY-2: Cert Expiry is a distinct route — ExpiryDashboard only (not DOTComplianceTab).
import { ExpiryDashboard } from "../pages/safety/expiry-tracking/ExpiryDashboard";
const LiabilitiesHomePage = React.lazy(() => import("../pages/liabilities/LiabilitiesHome").then((m) => ({ default: m.LiabilitiesHomePage })));
import { MaintenanceHomePage, MaintenanceShell } from "../pages/maintenance/MaintenanceHome";
import type { MaintenanceTabId } from "../pages/maintenance/MaintenanceHome";
const WorkOrdersConsoleDetailPage = React.lazy(() => import("../pages/work-orders/WorkOrdersConsoleDetailPage").then((m) => ({ default: m.WorkOrdersConsoleDetailPage })));
const WorkOrdersConsoleListPage = React.lazy(() => import("../pages/work-orders/WorkOrdersConsoleListPage").then((m) => ({ default: m.WorkOrdersConsoleListPage })));
const WorkOrderDetailPage = React.lazy(() => import("../pages/maintenance/WorkOrderDetailPage").then((m) => ({ default: m.WorkOrderDetailPage })));
const WorkOrderNewPage = React.lazy(() => import("../pages/maintenance/WorkOrderNewPage").then((m) => ({ default: m.WorkOrderNewPage })));
const DefectsInboxPage = React.lazy(() => import("../pages/maintenance/DefectsInboxPage").then((m) => ({ default: m.DefectsInboxPage })));
const DefectDetailPage = React.lazy(() => import("../pages/maintenance/DefectDetailPage").then((m) => ({ default: m.DefectDetailPage })));
const VehiclesMasterDataPage = React.lazy(() => import("../pages/maintenance/vehicles/VehiclesMasterDataPage").then((m) => ({ default: m.VehiclesMasterDataPage })));
const DriversMasterDataPage = React.lazy(() => import("../pages/maintenance/drivers/DriversMasterDataPage").then((m) => ({ default: m.DriversMasterDataPage })));
const PartsMasterDataPage = React.lazy(() => import("../pages/maintenance/parts/PartsMasterDataPage").then((m) => ({ default: m.PartsMasterDataPage })));
const PmSchedulePage = React.lazy(() => import("../pages/maintenance/pm-schedule/PmSchedulePage").then((m) => ({ default: m.PmSchedulePage })));
const PmAutoEnginePage = React.lazy(() => import("../pages/maintenance/PmAutoEnginePage").then((m) => ({ default: m.PmAutoEnginePage })));
const MaintKpiDashboardPage = React.lazy(() => import("../pages/maintenance/MaintKpiDashboardPage").then((m) => ({ default: m.MaintKpiDashboardPage })));
const InspectionsPage = React.lazy(() => import("../pages/maintenance/inspections/InspectionsPage").then((m) => ({ default: m.InspectionsPage })));
const TireProgramPage = React.lazy(() => import("../pages/maintenance/TireProgramPage").then((m) => ({ default: m.TireProgramPage })));
const WarrantyClaimsPage = React.lazy(() => import("../pages/maintenance/WarrantyClaimsPage").then((m) => ({ default: m.WarrantyClaimsPage })));
import { VendorsPage as MaintenanceVendorsPage } from "../pages/maintenance/vendors/VendorsPage";
import { VendorDetailPage as MaintenanceVendorDetailPage } from "../pages/maintenance/VendorDetailPage";
const MaintenanceReportsPage = React.lazy(() => import("../pages/maintenance/reports/MaintenanceReportsPage").then((m) => ({ default: m.MaintenanceReportsPage })));
const Compliance425CPage = React.lazy(() => import("../pages/maintenance/compliance/Compliance425CPage").then((m) => ({ default: m.Compliance425CPage })));
const CashAdvancesHomePage = React.lazy(() => import("../pages/cash-advances/CashAdvancesHome").then((m) => ({ default: m.CashAdvancesHomePage })));
const FactoringHomePage = React.lazy(() => import("../pages/factoring/FactoringHome").then((m) => ({ default: m.FactoringHomePage })));
const BatchWizard = React.lazy(() => import("../pages/factoring/BatchWizard").then((m) => ({ default: m.BatchWizard })));
const BatchDetail = React.lazy(() => import("../pages/factoring/BatchDetail").then((m) => ({ default: m.BatchDetail })));
const FactorAdmin = React.lazy(() => import("../pages/factoring/FactorAdmin").then((m) => ({ default: m.FactorAdmin })));
const ReserveDashboard = React.lazy(() => import("../pages/factoring/ReserveDashboard").then((m) => ({ default: m.ReserveDashboard })));
const FaroImportPage = React.lazy(() => import("../pages/factoring/FaroImportPage").then((m) => ({ default: m.FaroImportPage })));
const SubmissionQueue = React.lazy(() =>
  import("../pages/factoring/SubmissionQueue").then((m) => ({ default: m.SubmissionQueue }))
);
const VehicleProfilePage = React.lazy(() => import("../pages/fleet/VehicleProfilePage").then((m) => ({ default: m.VehicleProfilePage })));
const FleetHomePage = React.lazy(() => import("../pages/fleet/FleetHomePage").then((m) => ({ default: m.FleetHomePage })));
const TrailerProfilePage = React.lazy(() => import("../pages/fleet/TrailerProfilePage").then((m) => ({ default: m.TrailerProfilePage })));
const TransfersInProgressPage = React.lazy(() => import("../pages/fleet/TransfersInProgressPage").then((m) => ({ default: m.TransfersInProgressPage })));
const ComplianceDashboardPage = React.lazy(() => import("../pages/compliance/ComplianceDashboardPage").then((m) => ({ default: m.ComplianceDashboardPage })));
const PropertyTaxRenditionPage = React.lazy(() => import("../pages/compliance/PropertyTaxRenditionPage").then((m) => ({ default: m.PropertyTaxRenditionPage })));
const Form2290Filings = React.lazy(() => import("../pages/compliance/Form2290Filings").then((m) => ({ default: m.Form2290Filings })));
const NotificationCenterPage = React.lazy(() => import("../pages/notifications/NotificationCenterPage").then((m) => ({ default: m.NotificationCenterPage })));
const EquipmentTypesPage = React.lazy(() => import("../pages/EquipmentTypesPage").then((m) => ({ default: m.EquipmentTypesPage })));
const HomePage = React.lazy(() => import("../pages/Home").then((m) => ({ default: m.HomePage })));
const OwnerHome = React.lazy(() => import("../pages/home/OwnerHome").then((m) => ({ default: m.OwnerHome })));
// QBO-style home stays mounted at /app/homepage (bookmarks + never-delete). Sidebar HOME → /home.
const QboStyleHomePage = React.lazy(() => import("../pages/home/QboStyleHomePage").then((m) => ({ default: m.QboStyleHomePage })));
const LoginPage = React.lazy(() => import("../pages/Login").then((m) => ({ default: m.LoginPage })));
const LoginResetRequestPage = React.lazy(() => import("../pages/LoginResetRequestPage").then((m) => ({ default: m.LoginResetRequestPage })));
const LoginResetConfirmPage = React.lazy(() => import("../pages/LoginResetConfirmPage").then((m) => ({ default: m.LoginResetConfirmPage })));
const ComingSoonPage = React.lazy(() => import("../pages/ComingSoonPage").then((m) => ({ default: m.ComingSoonPage })));
const IntegrationTransactionsPage = React.lazy(() => import("../pages/accounting/IntegrationTransactionsPage").then((m) => ({ default: m.IntegrationTransactionsPage })));
const ReceiptsPage = React.lazy(() => import("../pages/accounting/ReceiptsPage").then((m) => ({ default: m.ReceiptsPage })));
const UndepositedFundsPage = React.lazy(() => import("../pages/accounting/UndepositedFundsPage").then((m) => ({ default: m.UndepositedFundsPage })));
const PrepaidExpensesPage = React.lazy(() => import("../pages/accounting/PrepaidExpensesPage").then((m) => ({ default: m.PrepaidExpensesPage })));
const RevenueRecognitionPage = React.lazy(() => import("../pages/accounting/RevenueRecognitionPage").then((m) => ({ default: m.RevenueRecognitionPage })));
const FixedAssetsPage = React.lazy(() => import("../pages/accounting/FixedAssetsPage").then((m) => ({ default: m.FixedAssetsPage })));
const AllocationsPage = React.lazy(() => import("../pages/accounting/AllocationsPage").then((m) => ({ default: m.AllocationsPage })));
const MaintenanceShopHubPage = React.lazy(() =>
  import("../pages/accounting/MaintenanceShopHubPage").then((m) => ({ default: m.MaintenanceShopHubPage }))
);
const QboReconcileCapturesPage = React.lazy(() => import("../pages/accounting/QboReconcileCapturesPage").then((m) => ({ default: m.QboReconcileCapturesPage })));
const AccountTypeCatalogPage = React.lazy(() => import("../pages/accounting/AccountTypeCatalogPage").then((m) => ({ default: m.AccountTypeCatalogPage })));
const MyAccountantPage = React.lazy(() => import("../pages/accounting/MyAccountantPage").then((m) => ({ default: m.MyAccountantPage })));
const PaymentMethodsCatalogPage = React.lazy(() => import("../pages/accounting/PaymentMethodsCatalogPage").then((m) => ({ default: m.PaymentMethodsCatalogPage })));
const BulkDemoPage = React.lazy(() => import("../pages/dev/BulkDemoPage").then((m) => ({ default: m.BulkDemoPage })));
const SamsaraIntegrationPage = React.lazy(() => import("../pages/integrations/SamsaraIntegrationPage").then((m) => ({ default: m.SamsaraIntegrationPage })));
const DriverAppLandingPage = React.lazy(() => import("../pages/DriverAppLandingPage").then((m) => ({ default: m.DriverAppLandingPage })));
const DisputesPage = React.lazy(() => import("../pages/driver/DisputesPage").then((m) => ({ default: m.DisputesPage })));
import { DriverShell } from "../pages/driver/DriverShell";
const DriverLoginPage = React.lazy(() => import("../pages/driver/DriverLoginPage").then((m) => ({ default: m.DriverLoginPage })));
const DriverLoadsPage = React.lazy(() => import("../pages/driver/DriverLoadsPage").then((m) => ({ default: m.DriverLoadsPage })));
const DriverLoadDetailPage = React.lazy(() => import("../pages/driver/DriverLoadDetailPage").then((m) => ({ default: m.DriverLoadDetailPage })));
const DriverHosPage = React.lazy(() => import("../pages/driver/DriverHosPage").then((m) => ({ default: m.DriverHosPage })));
const DriverSettingsPage = React.lazy(() => import("../pages/driver/DriverSettingsPage").then((m) => ({ default: m.DriverSettingsPage })));
const FuelReceiptPage = React.lazy(() => import("../pages/driver/FuelReceiptPage").then((m) => ({ default: m.FuelReceiptPage })));
const NotificationPreferencesPage = React.lazy(() => import("../pages/settings/NotificationPreferencesPage").then((m) => ({ default: m.NotificationPreferencesPage })));
const UserProfileSettingsPage = React.lazy(() => import("../pages/settings/UserProfileSettingsPage").then((m) => ({ default: m.UserProfileSettingsPage })));
const DocumentsPage = React.lazy(() => import("../pages/Documents").then((m) => ({ default: m.DocumentsPage })));
const DocsHomePage = React.lazy(() => import("../pages/docs/DocsHomePage").then((m) => ({ default: m.DocsHomePage })));
const EldPage = React.lazy(() => import("../pages/eld/EldPage").then((m) => ({ default: m.EldPage })));
const CashFlowPage = React.lazy(() => import("../pages/cash-flow/CashFlowPage").then((m) => ({ default: m.CashFlowPage })));
const DriverHubPage = React.lazy(() => import("../pages/home/DriverHubPage").then((m) => ({ default: m.DriverHubPage })));
const DriverHubReportingPage = React.lazy(() => import("../pages/home/DriverHubReportingPage").then((m) => ({ default: m.DriverHubReportingPage })));
const UserDetailPage = React.lazy(() => import("../pages/UserDetail").then((m) => ({ default: m.UserDetailPage })));
const UsersPage = React.lazy(() => import("../pages/Users").then((m) => ({ default: m.UsersPage })));
const VendorsPage = React.lazy(() => import("../pages/Vendors").then((m) => ({ default: m.VendorsPage })));
const VendorDetailPage = React.lazy(() => import("../pages/VendorDetail").then((m) => ({ default: m.VendorDetailPage })));
const Form425CHome = React.lazy(() => import("../pages/form425c/Form425CHome").then((m) => ({ default: m.Form425CHome })));
const HelpCenterPage = React.lazy(() => import("../pages/help/HelpCenterPage").then((m) => ({ default: m.HelpCenterPage })));
const HelpArticlePage = React.lazy(() => import("../pages/help/HelpArticlePage").then((m) => ({ default: m.HelpArticlePage })));
const HelpPage = React.lazy(() => import("../pages/help/HelpPage").then((m) => ({ default: m.HelpPage })));
const RunbooksIndex = React.lazy(() => import("../pages/help/RunbooksIndex").then((m) => ({ default: m.RunbooksIndex })));
const OnboardingWizard = React.lazy(() => import("../pages/onboarding/OnboardingWizard").then((m) => ({ default: m.OnboardingWizard })));
const ReportsHomePage = React.lazy(() => import("../pages/reports/ReportsHome").then((m) => ({ default: m.ReportsHomePage })));
import IftaPreparer from "../pages/reports/tax-regulatory/IftaPreparer";
const ReportsRunnerPage = React.lazy(() => import("../pages/reports/ReportsRunner").then((m) => ({ default: m.ReportsRunnerPage })));
const ARAgingPage = React.lazy(() => import("../pages/reports/ARAgingPage").then((m) => ({ default: m.ARAgingPage })));
const APAgingPage = React.lazy(() => import("../pages/reports/APAgingPage").then((m) => ({ default: m.APAgingPage })));
const DuplicateMastersReport = React.lazy(() => import("../pages/reports/DuplicateMastersReport").then((m) => ({ default: m.DuplicateMastersReport })));
const TrialBalancePage = React.lazy(() => import("../pages/reports/TrialBalancePage").then((m) => ({ default: m.TrialBalancePage })));
const ManagementReportPackagePage = React.lazy(() => import("../pages/reports/ManagementReportPackagePage").then((m) => ({ default: m.ManagementReportPackagePage })));
const ProfitLossPage = React.lazy(() => import("../pages/reports/ProfitLossPage").then((m) => ({ default: m.ProfitLossPage })));
const BalanceSheetPage = React.lazy(() => import("../pages/reports/BalanceSheetPage").then((m) => ({ default: m.BalanceSheetPage })));
const CashFlowStatementPage = React.lazy(() => import("../pages/reports/CashFlowStatementPage").then((m) => ({ default: m.CashFlowStatementPage })));
const CashFlowOverviewPage = React.lazy(() => import("../pages/reports/CashFlowOverviewPage").then((m) => ({ default: m.CashFlowOverviewPage })));
const CashFlowReport = React.lazy(() => import("../pages/reports/CashFlowReport").then((m) => ({ default: m.CashFlowReport })));
const PerTruckCpmReport = React.lazy(() => import("../pages/reports/PerTruckCpmReport").then((m) => ({ default: m.PerTruckCpmReport })));
const SettlementSummaryPage = React.lazy(() => import("../pages/reports/SettlementSummaryPage").then((m) => ({ default: m.SettlementSummaryPage })));
const CustomerProfitabilityPage = React.lazy(() => import("../pages/reports/CustomerProfitabilityPage").then((m) => ({ default: m.CustomerProfitabilityPage })));
const ProfitPerTruckPage = React.lazy(() => import("../pages/reports/ProfitPerTruckPage").then((m) => ({ default: m.ProfitPerTruckPage })));
const LaneProfitabilityPage = React.lazy(() => import("../pages/reports/LaneProfitabilityPage").then((m) => ({ default: m.LaneProfitabilityPage })));
const CancellationsReportPage = React.lazy(() => import("../pages/reports/CancellationsReportPage").then((m) => ({ default: m.CancellationsReportPage })));
const DriverQualificationReportPage = React.lazy(() => import("../pages/reports/DriverQualificationReportPage").then((m) => ({ default: m.DriverQualificationReportPage })));
const InvoiceSearchReportPage = React.lazy(() => import("../pages/reports/InvoiceSearchReportPage").then((m) => ({ default: m.InvoiceSearchReportPage })));
const FuelReconciliationPage = React.lazy(() => import("../pages/reports/FuelReconciliationPage").then((m) => ({ default: m.FuelReconciliationPage })));
const MaintenanceCostPerUnitPage = React.lazy(() => import("../pages/reports/MaintenanceCostPerUnitPage").then((m) => ({ default: m.MaintenanceCostPerUnitPage })));
const DispatchMarginPage = React.lazy(() => import("../pages/reports/DispatchMarginPage").then((m) => ({ default: m.DispatchMarginPage })));
const SubscriptionManager = React.lazy(() => import("../pages/reports/SubscriptionManager").then((m) => ({ default: m.SubscriptionManager })));
const GeofenceDwellReport = React.lazy(() => import("../pages/reports/GeofenceDwellReport").then((m) => ({ default: m.GeofenceDwellReport })));
const GeofenceReconciliationReport = React.lazy(() => import("../pages/reports/GeofenceReconciliationReport").then((m) => ({ default: m.GeofenceReconciliationReport })));
import BookingGapReport from "../pages/reports/BookingGapReport";
const FaultDraftsPage = React.lazy(() => import("../pages/maintenance/FaultDraftsPage").then((m) => ({ default: m.FaultDraftsPage })));
const FaultRulesPage = React.lazy(() => import("../pages/maintenance/FaultRulesPage").then((m) => ({ default: m.FaultRulesPage })));
const DeadheadReportPage = React.lazy(() => import("../pages/reports/DeadheadReportPage").then((m) => ({ default: m.DeadheadReportPage })));
const PostedWhileTourOpenReportPage = React.lazy(() => import("../pages/reports/PostedWhileTourOpenReportPage").then((m) => ({ default: m.PostedWhileTourOpenReportPage })));
const AuditActivityByUserPage = React.lazy(() => import("../pages/reports/audit/AuditActivityByUserPage").then((m) => ({ default: m.AuditActivityByUserPage })));
const AuditActivityByModulePage = React.lazy(() => import("../pages/reports/audit/AuditActivityByModulePage").then((m) => ({ default: m.AuditActivityByModulePage })));
const AuditFinancialChangeLogPage = React.lazy(() => import("../pages/reports/audit/AuditFinancialChangeLogPage").then((m) => ({ default: m.AuditFinancialChangeLogPage })));
const AuditMaintenanceDecisionLogPage = React.lazy(() => import("../pages/reports/audit/AuditMaintenanceDecisionLogPage").then((m) => ({ default: m.AuditMaintenanceDecisionLogPage })));
const AuditDeductionTrailPage = React.lazy(() => import("../pages/reports/audit/AuditDeductionTrailPage").then((m) => ({ default: m.AuditDeductionTrailPage })));
const AuditVoidReversalPage = React.lazy(() => import("../pages/reports/audit/AuditVoidReversalPage").then((m) => ({ default: m.AuditVoidReversalPage })));
const ReportsHubPage = React.lazy(() => import("../pages/reports/ReportsHub").then((m) => ({ default: m.ReportsHubPage })));
const OpsDispatchCategoryPage = React.lazy(() => import("../pages/reports/categories/ops-dispatch").then((m) => ({ default: m.OpsDispatchCategoryPage })));
const DriverPerfCategoryPage = React.lazy(() => import("../pages/reports/categories/driver-perf").then((m) => ({ default: m.UdriverUperfCategoryPage })));
const EquipmentCategoryPage = React.lazy(() => import("../pages/reports/categories/equipment").then((m) => ({ default: m.UequipmentCategoryPage })));
const SafetyCategoryPage = React.lazy(() => import("../pages/reports/categories/safety").then((m) => ({ default: m.UsafetyCategoryPage })));
const CustomersCategoryPage = React.lazy(() => import("../pages/reports/categories/customers").then((m) => ({ default: m.UcustomersCategoryPage })));
const VendorsCategoryPage = React.lazy(() => import("../pages/reports/categories/vendors").then((m) => ({ default: m.UvendorsCategoryPage })));
const AccountingCategoryPage = React.lazy(() => import("../pages/reports/categories/accounting").then((m) => ({ default: m.UaccountingCategoryPage })));
const TaxRegCategoryPage = React.lazy(() => import("../pages/reports/categories/tax-reg").then((m) => ({ default: m.UtaxUregCategoryPage })));
const MultiCompanyCategoryPage = React.lazy(() => import("../pages/reports/categories/multi-company").then((m) => ({ default: m.UmultiUcompanyCategoryPage })));
const ScheduledReportsPage = React.lazy(() => import("../pages/reports/ScheduledReportsPage").then((m) => ({ default: m.ScheduledReportsPage })));
const Form425CExhibitsViewer = React.lazy(() => import("../pages/reports/form-425c/ExhibitsViewer").then((m) => ({ default: m.ExhibitsViewer })));
const AuditPeriodCloseHistoryPage = React.lazy(() => import("../pages/reports/audit/AuditPeriodCloseHistoryPage").then((m) => ({ default: m.AuditPeriodCloseHistoryPage })));
const QboSyncDetailPage = React.lazy(() => import("../pages/qbo-sync-detail/QboSyncDetailPage").then((m) => ({ default: m.QboSyncDetailPage })));
const InvoicesListPage = React.lazy(() => import("../pages/accounting/InvoicesListPage").then((m) => ({ default: m.InvoicesListPage })));
const TransactionRegisterPage = React.lazy(() => import("../pages/accounting/TransactionRegisterPage").then((m) => ({ default: m.TransactionRegisterPage })));
const MultiEntityAccountingPage = React.lazy(() => import("../pages/accounting/MultiEntityAccountingPage").then((m) => ({ default: m.MultiEntityAccountingPage })));
const AccountingHubPage = React.lazy(() => import("../pages/accounting/AccountingHubPage").then((m) => ({ default: m.AccountingHubPage })));
const MoneyProofTrailPage = React.lazy(() => import("../pages/accounting/MoneyProofTrailPage").then((m) => ({ default: m.MoneyProofTrailPage })));
const LoadCostsBoardPage = React.lazy(() => import("../pages/accounting/LoadCostsBoardPage").then((m) => ({ default: m.LoadCostsBoardPage })));
const LoadCostsLoadPage = React.lazy(() => import("../pages/accounting/LoadCostsLoadPage").then((m) => ({ default: m.LoadCostsLoadPage })));
const DisputeQueuePage = React.lazy(() => import("../pages/accounting/DisputeQueuePage").then((m) => ({ default: m.DisputeQueuePage })));
const AbandonmentQueuePage = React.lazy(() => import("../pages/accounting/AbandonmentQueuePage").then((m) => ({ default: m.AbandonmentQueuePage })));
const LoansAdvancesPage = React.lazy(() => import("../pages/accounting/loans/LoansAdvancesPage").then((m) => ({ default: m.LoansAdvancesPage })));
const AccountingLeaseDetailPage = React.lazy(() => import("../pages/accounting/AccountingLeaseDetailPage").then((m) => ({ default: m.AccountingLeaseDetailPage })));
const AccountingRecurringTemplateDetailPage = React.lazy(() => import("../pages/accounting/AccountingRecurringTemplateDetailPage").then((m) => ({ default: m.AccountingRecurringTemplateDetailPage })));
const AccountingPeriodCloseDetailPage = React.lazy(() => import("../pages/accounting/AccountingPeriodCloseDetailPage").then((m) => ({ default: m.AccountingPeriodCloseDetailPage })));
const AccountingScheduleRowDetailPage = React.lazy(() => import("../pages/accounting/AccountingScheduleRowDetailPage").then((m) => ({ default: m.AccountingScheduleRowDetailPage })));
const AccountingDriverReimbursementDetailPage = React.lazy(() => import("../pages/accounting/AccountingDriverReimbursementDetailPage").then((m) => ({ default: m.AccountingDriverReimbursementDetailPage })));
const InvoiceDetailPage = React.lazy(() => import("../pages/accounting/InvoiceDetailPage").then((m) => ({ default: m.InvoiceDetailPage })));
const PaymentsListPage = React.lazy(() => import("../pages/accounting/PaymentsListPage").then((m) => ({ default: m.PaymentsListPage })));
const PaymentDetailPage = React.lazy(() => import("../pages/accounting/PaymentDetailPage").then((m) => ({ default: m.PaymentDetailPage })));
const BillDetailPage = React.lazy(() => import("../pages/accounting/BillDetailPage").then((m) => ({ default: m.BillDetailPage })));
const FactoringListPage = React.lazy(() => import("../pages/accounting/FactoringListPage").then((m) => ({ default: m.FactoringListPage })));
const FactoringDetailPage = React.lazy(() => import("../pages/accounting/FactoringDetailPage").then((m) => ({ default: m.FactoringDetailPage })));
const FactorReconciliationPage = React.lazy(() => import("../pages/accounting/FactorReconciliationPage").then((m) => ({ default: m.FactorReconciliationPage })));
import { ReconciliationWorkspacePage as AccountingReconciliationWorkspacePage } from "../pages/accounting/ReconciliationWorkspacePage";
const VendorBillCreatePage = React.lazy(() => import("../pages/accounting/VendorBillCreatePage").then((m) => ({ default: m.VendorBillCreatePage })));
const CreateMultipleBillsPage = React.lazy(() => import("../pages/accounting/CreateMultipleBillsPage").then((m) => ({ default: m.CreateMultipleBillsPage })));
const RecurringBillList = React.lazy(() => import("../pages/accounting/bills/RecurringBillList").then((m) => ({ default: m.RecurringBillList })));
const RecurringBillCreate = React.lazy(() => import("../pages/accounting/bills/RecurringBillCreate").then((m) => ({ default: m.RecurringBillCreate })));
const ExpenseCreatePage = React.lazy(() => import("../pages/accounting/ExpenseCreatePage").then((m) => ({ default: m.ExpenseCreatePage })));
const ExpensesListPage = React.lazy(() => import("../pages/accounting/ExpensesListPage").then((m) => ({ default: m.ExpensesListPage })));
const ExpenseDetailPage = React.lazy(() => import("../pages/accounting/ExpenseDetailPage").then((m) => ({ default: m.ExpenseDetailPage })));
const BillsPage = React.lazy(() => import("../pages/accounting/BillsPage").then((m) => ({ default: m.BillsPage })));
const VendorBalancesPage = React.lazy(() => import("../pages/accounting/VendorBalancesPage").then((m) => ({ default: m.VendorBalancesPage })));
const VendorCreditsPage = React.lazy(() => import("../pages/accounting/VendorCreditsPage").then((m) => ({ default: m.VendorCreditsPage })));
const CreditMemosPage = React.lazy(() => import("../pages/accounting/CreditMemosPage").then((m) => ({ default: m.CreditMemosPage })));
const ManualJEListPage = React.lazy(() => import("../pages/accounting/ManualJEListPage").then((m) => ({ default: m.ManualJEListPage })));
const BillPaymentsListPage = React.lazy(() => import("../pages/accounting/BillPaymentsListPage").then((m) => ({ default: m.BillPaymentsListPage })));
const BillPaymentDetailPage = React.lazy(() => import("../pages/accounting/BillPaymentDetailPage").then((m) => ({ default: m.BillPaymentDetailPage })));
const JournalEntryDetailPage = React.lazy(() => import("../pages/accounting/journal-entries/JournalEntryDetailPage").then((m) => ({ default: m.JournalEntryDetailPage })));
const AccountRegisterPage = React.lazy(() => import("../pages/accounting/AccountRegisterPage").then((m) => ({ default: m.AccountRegisterPage })));
const AccountingPreSettlementsPage = React.lazy(() => import("../pages/accounting/AccountingPreSettlementsPage").then((m) => ({ default: m.AccountingPreSettlementsPage })));
const PayrollAggregatedPage = React.lazy(() => import("../pages/accounting/PayrollAggregatedPage").then((m) => ({ default: m.PayrollAggregatedPage })));
const ExpenseCategoryMapPage = React.lazy(() => import("../pages/accounting/ExpenseCategoryMapPage").then((m) => ({ default: m.ExpenseCategoryMapPage })));
const CoaRolesPage = React.lazy(() => import("../pages/accounting/CoaRolesPage").then((m) => ({ default: m.CoaRolesPage })));
const DailyReconPage = React.lazy(() => import("../pages/accounting/DailyReconPage").then((m) => ({ default: m.DailyReconPage })));
const QboReconciliationPage = React.lazy(() => import("../pages/accounting/QboReconciliationPage").then((m) => ({ default: m.QboReconciliationPage })));
const OpeningBalanceRegisterPage = React.lazy(() =>
  import("../pages/accounting/OpeningBalanceRegisterPage").then((m) => ({ default: m.OpeningBalanceRegisterPage }))
);
const SalesTaxPage = React.lazy(() => import("../pages/accounting/SalesTaxPage").then((m) => ({ default: m.SalesTaxPage })));
const AccountingAuditTrailPage = React.lazy(() => import("../pages/accounting/AccountingAuditTrailPage").then((m) => ({ default: m.AccountingAuditTrailPage })));
const PostingLineagePage = React.lazy(() => import("../pages/accounting/PostingLineagePage").then((m) => ({ default: m.PostingLineagePage })));
const MonthClosePage = React.lazy(() => import("../pages/accounting/MonthClosePage").then((m) => ({ default: m.MonthClosePage })));
const EscrowPage = React.lazy(() => import("../pages/accounting/EscrowPage").then((m) => ({ default: m.EscrowPage })));
const CashForecastPage = React.lazy(() => import("../pages/accounting/CashForecastPage").then((m) => ({ default: m.CashForecastPage })));
const PeriodComparisonPage = React.lazy(() => import("../pages/accounting/PeriodComparisonPage").then((m) => ({ default: m.PeriodComparisonPage })));
const QBOSyncDriftDashboard = React.lazy(() => import("../pages/accounting/QBOSyncDriftDashboard").then((m) => ({ default: m.QBOSyncDriftDashboard })));
import { COLLECTIONS_ROUTE } from "./collections.routes";
import { TRIP_PAIRING_BOARD_ROUTE } from "./trip-pairing-board.routes";
import { AP_AGING_ROUTE } from "./ap-aging.routes";
import { resolveUnderscoreRedirectPath } from "./url-canonicalize";
const ForensicReviewPage = React.lazy(() => import("../pages/forensic/ForensicReviewPage").then((m) => ({ default: m.ForensicReviewPage })));
const AdminPage = React.lazy(() => import("../pages/admin/AdminPage").then((m) => ({ default: m.AdminPage })));
const USMCAActivationPanel = React.lazy(() => import("../pages/admin/USMCAActivationPanel").then((m) => ({ default: m.USMCAActivationPanel })));
const ActivityLogPage = React.lazy(() => import("../pages/admin/ActivityLogPage").then((m) => ({ default: m.ActivityLogPage })));
import AuditEventsList from "../pages/audit/AuditEventsList";
import AuditLogViewer from "../pages/admin/audit-log/AuditLogViewer";
import AuditTrailPage from "../pages/audit/AuditTrailPage";
const MigrationStatusPage = React.lazy(() => import("../pages/admin/MigrationStatus").then((m) => ({ default: m.MigrationStatusPage })));
const ErrorMonitorPage = React.lazy(() => import("../pages/admin/ErrorMonitor").then((m) => ({ default: m.ErrorMonitorPage })));
const IntegrityAdminPage = React.lazy(() => import("../pages/admin/IntegrityAdminPage").then((m) => ({ default: m.IntegrityAdminPage })));
const DataImportPage = React.lazy(() => import("../pages/admin/DataImportPage").then((m) => ({ default: m.DataImportPage })));
const CarrierBootstrapPage = React.lazy(() => import("../pages/admin/CarrierBootstrap").then((m) => ({ default: m.CarrierBootstrapPage })));
const LaunchTogglesPage = React.lazy(() => import("../pages/admin/LaunchToggles").then((m) => ({ default: m.LaunchTogglesPage })));
const LaunchReadinessPage = React.lazy(() => import("../pages/admin/LaunchReadinessPage").then((m) => ({ default: m.LaunchReadinessPage })));
const QboVendorLinkagePage = React.lazy(() => import("../pages/admin/QboVendorLinkagePage").then((m) => ({ default: m.QboVendorLinkagePage })));
const TripProfitabilityPage = React.lazy(() => import("../pages/dispatch/TripProfitability").then((m) => ({ default: m.TripProfitability })));
const EdiSetupWizard = React.lazy(() => import("../pages/integrations/edi/EdiSetupWizard").then((m) => ({ default: m.EdiSetupWizard })));
const EdiTransactionLog = React.lazy(() => import("../pages/integrations/edi/EdiTransactionLog").then((m) => ({ default: m.EdiTransactionLog })));
const LateArrivalReport = React.lazy(() => import("../pages/reports/LateArrivalReport").then((m) => ({ default: m.LateArrivalReport })));
const CSAMitigationQueuePage = React.lazy(() => import("../pages/safety/CSAMitigationQueue").then((m) => ({ default: m.CSAMitigationQueuePage })));
const CSAFmcsaTrendPage = React.lazy(() => import("../pages/safety/CSAScore").then((m) => ({ default: m.CSAScorePage })));
const AnomalyAlertsPage = React.lazy(() => import("../pages/safety/anomaly/AnomalyAlertsPage").then((m) => ({ default: m.AnomalyAlertsPage })));
const PhotoComparisonPage = React.lazy(() => import("../pages/safety/photo-comparison/PhotoComparisonPage").then((m) => ({ default: m.PhotoComparisonPage })));
const SessionDetailPage = React.lazy(() => import("../pages/safety/photo-comparison/SessionDetailPage").then((m) => ({ default: m.SessionDetailPage })));
const IdvrDetailPage = React.lazy(() => import("../pages/safety/IdvrDetailPage").then((m) => ({ default: m.IdvrDetailPage })));
const FeatureFlagsManager = React.lazy(() => import("../pages/admin/feature-flags/FeatureFlagsManager").then((m) => ({ default: m.FeatureFlagsManager })));
const ObservabilityPage = React.lazy(() => import("../pages/admin/ObservabilityPage").then((m) => ({ default: m.ObservabilityPage })));
const UnitDetail = React.lazy(() => import("../pages/units/UnitDetail").then((m) => ({ default: m.UnitDetail })));
const MobileAuditReport = React.lazy(() => import("../pages/admin/mobile-audit/MobileAuditReport").then((m) => ({ default: m.MobileAuditReport })));
const AccountRoleBindingsListPage = React.lazy(() => import("../pages/lists/accounting/AccountRoleBindingsListPage").then((m) => ({ default: m.AccountRoleBindingsListPage })));
const ChartOfAccountsListPage = React.lazy(() => import("../pages/lists/accounting/ChartOfAccountsListPage").then((m) => ({ default: m.ChartOfAccountsListPage })));
const ChartOfAccountsSeedsListPage = React.lazy(() => import("../pages/lists/accounting/ChartOfAccountsSeedsListPage").then((m) => ({ default: m.ChartOfAccountsSeedsListPage })));
const ClassesListPage = React.lazy(() => import("../pages/lists/accounting/ClassesListPage").then((m) => ({ default: m.ClassesListPage })));
const CurrencyCodesListPage = React.lazy(() => import("../pages/lists/accounting/CurrencyCodesListPage").then((m) => ({ default: m.CurrencyCodesListPage })));
const ExpenseCategoriesListPage = React.lazy(() => import("../pages/lists/accounting/ExpenseCategoriesListPage").then((m) => ({ default: m.ExpenseCategoriesListPage })));
const ItemsListPage = React.lazy(() => import("../pages/lists/accounting/ItemsListPage").then((m) => ({ default: m.ItemsListPage })));
const JournalEntryTypesListPage = React.lazy(() => import("../pages/lists/accounting/JournalEntryTypesListPage").then((m) => ({ default: m.JournalEntryTypesListPage })));
const PaymentTermsListPage = React.lazy(() => import("../pages/lists/accounting/PaymentTermsListPage").then((m) => ({ default: m.PaymentTermsListPage })));
const VoidCancelReasonsListPage = React.lazy(() => import("../pages/lists/accounting/VoidCancelReasonsListPage").then((m) => ({ default: m.VoidCancelReasonsListPage })));
const PaymentMethodsListPage = React.lazy(() => import("../pages/lists/accounting/PaymentMethodsListPage").then((m) => ({ default: m.PaymentMethodsListPage })));
const PostingTemplatesListPage = React.lazy(() => import("../pages/lists/accounting/PostingTemplatesListPage").then((m) => ({ default: m.PostingTemplatesListPage })));
const QBOBulkLinkPage = React.lazy(() => import("../pages/lists/accounting/QBOBulkLinkPage").then((m) => ({ default: m.QBOBulkLinkPage })));
const QboCategoriesListPage = React.lazy(() => import("../pages/lists/accounting/QboCategoriesListPage").then((m) => ({ default: m.QboCategoriesListPage })));
const TaxCodesListPage = React.lazy(() => import("../pages/lists/accounting/TaxCodesListPage").then((m) => ({ default: m.TaxCodesListPage })));
const AbandonmentDefaultsPage = React.lazy(() => import("../pages/lists/accounting/AbandonmentDefaultsPage").then((m) => ({ default: m.AbandonmentDefaultsPage })));
const AdditionalChargesListPage = React.lazy(() => import("../pages/lists/dispatch/AdditionalChargesListPage").then((m) => ({ default: m.AdditionalChargesListPage })));
const DetentionReasonsListPage = React.lazy(() => import("../pages/lists/dispatch/DetentionReasonsListPage").then((m) => ({ default: m.DetentionReasonsListPage })));
const LoadCancellationReasonsListPage = React.lazy(() => import("../pages/lists/dispatch/LoadCancellationReasonsListPage").then((m) => ({ default: m.LoadCancellationReasonsListPage })));
const LoadTypesListPage = React.lazy(() => import("../pages/lists/dispatch/LoadTypesListPage").then((m) => ({ default: m.LoadTypesListPage })));
const PickupTimeTypesListPage = React.lazy(() => import("../pages/lists/dispatch/PickupTimeTypesListPage").then((m) => ({ default: m.PickupTimeTypesListPage })));
const DriverDeductionTypesListPage = React.lazy(() => import("../pages/lists/driver/DriverDeductionTypesListPage").then((m) => ({ default: m.DriverDeductionTypesListPage })));
const DriverPayTypesListPage = React.lazy(() => import("../pages/lists/driver/DriverPayTypesListPage").then((m) => ({ default: m.DriverPayTypesListPage })));
const DriverTeamsPage = React.lazy(() => import("../pages/lists/driver/DriverTeamsPage").then((m) => ({ default: m.DriverTeamsPage })));
const EscrowTypesListPage = React.lazy(() => import("../pages/lists/driver/EscrowTypesListPage").then((m) => ({ default: m.EscrowTypesListPage })));
const PayRateTemplatesListPage = React.lazy(() => import("../pages/lists/driver/PayRateTemplatesListPage").then((m) => ({ default: m.PayRateTemplatesListPage })));
import { Catalog as DriversLicenseClassesCatalog } from "../pages/lists/drivers/license-classes/Catalog";
import { Catalog as DriversEndorsementsCatalog } from "../pages/lists/drivers/endorsements/Catalog";
import { Catalog as DriversRestrictionsCatalog } from "../pages/lists/drivers/restrictions/Catalog";
import { Catalog as DriversMedicalCardStatusCatalog } from "../pages/lists/drivers/medical-card-status/Catalog";
import { Catalog as DriversEmploymentStatusCatalog } from "../pages/lists/drivers/employment-status/Catalog";
const TerminationReasonsListPage = React.lazy(() => import("../pages/lists/drivers/TerminationReasonsListPage").then((m) => ({ default: m.TerminationReasonsListPage })));
const ConditionCodesListPage = React.lazy(() => import("../pages/lists/fleet/ConditionCodesListPage").then((m) => ({ default: m.ConditionCodesListPage })));
const AssetLocationsListPage = React.lazy(() => import("../pages/lists/fleet/AssetLocationsListPage").then((m) => ({ default: m.AssetLocationsListPage })));
const AssetStatusesListPage = React.lazy(() => import("../pages/lists/fleet/AssetStatusesListPage").then((m) => ({ default: m.AssetStatusesListPage })));
const EquipmentTypesListPage = React.lazy(() => import("../pages/lists/fleet/EquipmentTypesListPage").then((m) => ({ default: m.EquipmentTypesListPage })));
const LeaseTermsListPage = React.lazy(() => import("../pages/lists/fleet/LeaseTermsListPage").then((m) => ({ default: m.LeaseTermsListPage })));
const OwnershipTypesListPage = React.lazy(() => import("../pages/lists/fleet/OwnershipTypesListPage").then((m) => ({ default: m.OwnershipTypesListPage })));
const TirePositionsListPage = React.lazy(() => import("../pages/lists/fleet/TirePositionsListPage").then((m) => ({ default: m.TirePositionsListPage })));
const TractorStatusesListPage = React.lazy(() => import("../pages/lists/fleet/TractorStatusesListPage").then((m) => ({ default: m.TractorStatusesListPage })));
const TrailerStatusesListPage = React.lazy(() => import("../pages/lists/fleet/TrailerStatusesListPage").then((m) => ({ default: m.TrailerStatusesListPage })));
const TrailerTypesListPage = React.lazy(() => import("../pages/lists/fleet/TrailerTypesListPage").then((m) => ({ default: m.TrailerTypesListPage })));
const ExpensiveStatesListPage = React.lazy(() => import("../pages/lists/fuel/ExpensiveStatesListPage").then((m) => ({ default: m.ExpensiveStatesListPage })));
const FuelBrandsListPage = React.lazy(() => import("../pages/lists/fuel/FuelBrandsListPage").then((m) => ({ default: m.FuelBrandsListPage })));
const FuelCardTypesListPage = React.lazy(() => import("../pages/lists/fuel/FuelCardTypesListPage").then((m) => ({ default: m.FuelCardTypesListPage })));
const FuelExceptionTypesListPage = React.lazy(() => import("../pages/lists/fuel/FuelExceptionTypesListPage").then((m) => ({ default: m.FuelExceptionTypesListPage })));
const FuelGradesListPage = React.lazy(() => import("../pages/lists/fuel/FuelGradesListPage").then((m) => ({ default: m.FuelGradesListPage })));
const FuelStationBrandsListPage = React.lazy(() => import("../pages/lists/fuel/FuelStationBrandsListPage").then((m) => ({ default: m.FuelStationBrandsListPage })));
const FuelStopReasonCodesListPage = React.lazy(() => import("../pages/lists/fuel/FuelStopReasonCodesListPage").then((m) => ({ default: m.FuelStopReasonCodesListPage })));
const FuelTaxJurisdictionsListPage = React.lazy(() => import("../pages/lists/fuel/FuelTaxJurisdictionsListPage").then((m) => ({ default: m.FuelTaxJurisdictionsListPage })));
const FuelDispatchRoutesListPage = React.lazy(() => import("../pages/lists/fuel/FuelDispatchRoutesListPage").then((m) => ({ default: m.FuelDispatchRoutesListPage })));
const FuelPumpTypesListPage = React.lazy(() => import("../pages/lists/fuel/FuelPumpTypesListPage").then((m) => ({ default: m.FuelPumpTypesListPage })));
const FuelStationStatesListPage = React.lazy(() => import("../pages/lists/fuel/FuelStationStatesListPage").then((m) => ({ default: m.FuelStationStatesListPage })));
const MpgBandsListPage = React.lazy(() => import("../pages/lists/fuel/MpgBandsListPage").then((m) => ({ default: m.MpgBandsListPage })));
const MaintenanceFailureCodesListPage = React.lazy(() => import("../pages/lists/maintenance/MaintenanceFailureCodesListPage").then((m) => ({ default: m.MaintenanceFailureCodesListPage })));
const MaintenanceLaborCodesListPage = React.lazy(() => import("../pages/lists/maintenance/MaintenanceLaborCodesListPage").then((m) => ({ default: m.MaintenanceLaborCodesListPage })));
const MaintenancePartsListPage = React.lazy(() => import("../pages/lists/maintenance/MaintenancePartsListPage").then((m) => ({ default: m.MaintenancePartsListPage })));
const OemPartsCatalog = React.lazy(() => import("../pages/lists/maintenance/OemPartsCatalog").then((m) => ({ default: m.OemPartsCatalog })));
const MaintenancePriorityLevelsListPage = React.lazy(() => import("../pages/lists/maintenance/MaintenancePriorityLevelsListPage").then((m) => ({ default: m.MaintenancePriorityLevelsListPage })));
const MaintenanceServiceTasksListPage = React.lazy(() => import("../pages/lists/maintenance/MaintenanceServiceTasksListPage").then((m) => ({ default: m.MaintenanceServiceTasksListPage })));
const MaintenanceServicesCatalog = React.lazy(() => import("../pages/lists/MaintenanceServicesCatalog").then((m) => ({ default: m.MaintenanceServicesCatalog })));
const MaintenanceShopLocationsListPage = React.lazy(() => import("../pages/lists/maintenance/MaintenanceShopLocationsListPage").then((m) => ({ default: m.MaintenanceShopLocationsListPage })));
const MaintenanceVendorsListPage = React.lazy(() => import("../pages/lists/maintenance/MaintenanceVendorsListPage").then((m) => ({ default: m.MaintenanceVendorsListPage })));
const WorkOrderStatusesListPage = React.lazy(() => import("../pages/lists/maintenance/WorkOrderStatusesListPage").then((m) => ({ default: m.WorkOrderStatusesListPage })));
const AccidentTypesListPage = React.lazy(() => import("../pages/lists/safety/AccidentTypesListPage").then((m) => ({ default: m.AccidentTypesListPage })));
const WorkplaceIncidentTypesListPage = React.lazy(() => import("../pages/lists/safety/WorkplaceIncidentTypesListPage").then((m) => ({ default: m.WorkplaceIncidentTypesListPage })));
const CivilFineTypesListPage = React.lazy(() => import("../pages/lists/safety/CivilFineTypesListPage").then((m) => ({ default: m.CivilFineTypesListPage })));
const CompanyViolationTypesListPage = React.lazy(() => import("../pages/lists/safety/CompanyViolationTypesListPage").then((m) => ({ default: m.CompanyViolationTypesListPage })));
const ComplaintTypesListPage = React.lazy(() => import("../pages/lists/safety/ComplaintTypesListPage").then((m) => ({ default: m.ComplaintTypesListPage })));
const DotViolationTypesListPage = React.lazy(() => import("../pages/lists/safety/DotViolationTypesListPage").then((m) => ({ default: m.DotViolationTypesListPage })));
const CargoClaimReasonsListPage = React.lazy(() => import("../pages/lists/safety/CargoClaimReasonsListPage").then((m) => ({ default: m.CargoClaimReasonsListPage })));
const InternalFineReasonsListPage = React.lazy(() => import("../pages/lists/safety/InternalFineReasonsListPage").then((m) => ({ default: m.InternalFineReasonsListPage })));
const LegalTemplateDetailPage = React.lazy(() => import("../pages/legal/templates/LegalTemplateDetailPage").then((m) => ({ default: m.LegalTemplateDetailPage })));
const LegalTemplatesListPage = React.lazy(() => import("../pages/legal/templates/LegalTemplatesListPage").then((m) => ({ default: m.LegalTemplatesListPage })));
const LegalSignPage = React.lazy(() => import("../pages/legal/sign/LegalSignPage").then((m) => ({ default: m.LegalSignPage })));
const LegalAttorneyReviewPortalPage = React.lazy(() => import("../pages/legal/attorney-review/LegalAttorneyReviewPortalPage").then((m) => ({ default: m.LegalAttorneyReviewPortalPage })));
const LegalLandingPage = React.lazy(() => import("../pages/legal/LegalLandingPage").then((m) => ({ default: m.LegalLandingPage })));
const LegalContractInstancesPage = React.lazy(() => import("../pages/legal/contracts/LegalContractInstancesPage").then((m) => ({ default: m.LegalContractInstancesPage })));
const LegalPoliciesPage = React.lazy(() => import("../pages/legal/LegalPoliciesPage").then((m) => ({ default: m.LegalPoliciesPage })));
const PrivacyPolicyPage = React.lazy(() => import("../pages/legal/PrivacyPolicyPage").then((m) => ({ default: m.PrivacyPolicyPage })));
const TermsOfServicePage = React.lazy(() => import("../pages/legal/TermsOfServicePage").then((m) => ({ default: m.TermsOfServicePage })));
const LegalAttorneyReviewPage = React.lazy(() => import("../pages/legal/LegalAttorneyReviewPage").then((m) => ({ default: m.LegalAttorneyReviewPage })));
const LegalMattersListPage = React.lazy(() => import("../pages/legal/matters/LegalMattersListPage").then((m) => ({ default: m.LegalMattersListPage })));
const LegalMatterNewPage = React.lazy(() => import("../pages/legal/matters/LegalMatterNewPage").then((m) => ({ default: m.LegalMatterNewPage })));
const LegalMatterDetailPage = React.lazy(() => import("../pages/legal/matters/LegalMatterDetailPage").then((m) => ({ default: m.LegalMatterDetailPage })));
const LegalReportsLandingPage = React.lazy(() => import("../pages/legal/reports/LegalReportsLandingPage").then((m) => ({ default: m.LegalReportsLandingPage })));
const DriverSchedulerGridPage = React.lazy(() => import("../pages/safety/driver-scheduler/DriverSchedulerGridPage").then((m) => ({ default: m.DriverSchedulerGridPage })));
const DriverSchedulerRequestInboxPage = React.lazy(() => import("../pages/safety/driver-scheduler/DriverSchedulerRequestInboxPage").then((m) => ({ default: m.DriverSchedulerRequestInboxPage })));
const DriverSchedulerRequestDetailPage = React.lazy(() => import("../pages/safety/driver-scheduler/DriverSchedulerRequestDetailPage").then((m) => ({ default: m.DriverSchedulerRequestDetailPage })));
const DriverLeaveBalancesPage = React.lazy(() => import("../pages/safety/driver-scheduler/DriverLeaveBalancesPage").then((m) => ({ default: m.DriverLeaveBalancesPage })));
import Audit425cPage from "../pages/safety/audit-425c/Audit425cPage";
import HosExceptionsPage from "../pages/safety/hos/HosExceptionsPage";
import TrainingProgramsTab from "../pages/safety/tabs/TrainingProgramsTab";
const TrainingRecordsTab = React.lazy(() => import("../pages/safety/tabs/TrainingRecordsTab").then((m) => ({ default: m.TrainingRecordsTab })));
import SafetyReportsPage from "../pages/safety/reports/SafetyReportsPage";
import DriverSafetyProfilePage from "../pages/safety/driver-safety/DriverSafetyProfilePage";
const IntegrityAlertsPage = React.lazy(() => import("../pages/safety/IntegrityAlertsPage").then((m) => ({ default: m.IntegrityAlertsPage })));
const DailyTasksPage = React.lazy(() => import("../pages/daily-tasks/DailyTasksPage").then((m) => ({ default: m.DailyTasksPage })));
const VendorMappingResolutionPage = React.lazy(() => import("../pages/samsara-vendor-mapping/VendorMappingResolutionPage").then((m) => ({ default: m.VendorMappingResolutionPage })));
const HosDriverMapPreviewPage = React.lazy(() => import("../pages/samsara-vendor-mapping/HosDriverMapPreviewPage").then((m) => ({ default: m.HosDriverMapPreviewPage })));

// Tasks module (SIDEBAR-V2-REORG-25)
const TaskBoardPage = React.lazy(() => import("../pages/tasks/TaskBoardPage").then((m) => ({ default: m.TaskBoardPage })));
const TasksCalendarPage = React.lazy(() => import("../pages/tasks/TasksCalendarPage").then((m) => ({ default: m.TasksCalendarPage })));
const TasksMinePage = React.lazy(() => import("../pages/tasks/TasksMinePage").then((m) => ({ default: m.TasksMinePage })));
const TasksChatPage = React.lazy(() => import("../pages/tasks/TasksChatPage").then((m) => ({ default: m.TasksChatPage })));
const DispatchChatPage = React.lazy(() => import("../pages/chat/DispatchChatPage").then((m) => ({ default: m.DispatchChatPage })));
const TasksReportPage = React.lazy(() => import("../pages/tasks/TasksReportPage").then((m) => ({ default: m.TasksReportPage })));

// Finance module (SIDEBAR-V2-REORG-25)
const FinanceOverviewPage = React.lazy(() => import("../pages/finance/FinanceOverviewPage").then((m) => ({ default: m.FinanceOverviewPage })));
const FinanceProjectionsPage = React.lazy(() => import("../pages/finance/FinanceProjectionsPage").then((m) => ({ default: m.FinanceProjectionsPage })));
const LoanWizardPage = React.lazy(() => import("../pages/finance/LoanWizardPage").then((m) => ({ default: m.LoanWizardPage })));
const CalculatorPage = React.lazy(() => import("../pages/finance/CalculatorPage").then((m) => ({ default: m.CalculatorPage })));
const AmortizationPage = React.lazy(() => import("../pages/finance/AmortizationPage").then((m) => ({ default: m.AmortizationPage })));
const FinanceScenariosPage = React.lazy(() => import("../pages/finance/FinanceScenariosPage").then((m) => ({ default: m.FinanceScenariosPage })));
const FinanceScenarioDetailPage = React.lazy(() => import("../pages/finance/FinanceScenarioDetailPage").then((m) => ({ default: m.FinanceScenarioDetailPage })));
import { ArApAgingPage } from "../pages/finance/ArApAgingPage"; // FIN-20 (read-only, flag-gated)
const FinancialStatementsPage = React.lazy(() => import("../pages/finance/FinancialStatementsPage").then((m) => ({ default: m.FinancialStatementsPage })));
import { FinanceHubPage } from "../pages/finance/FinanceHubPage"; // AF-6 (read-only, flag-gated)
import { BreakEvenPage } from "../pages/finance/BreakEvenPage"; // F1 (read-only analytics, flag-gated)

// Inventory module (SIDEBAR-V2-REORG-25)
const InventoryPartsStockPage = React.lazy(() => import("../pages/inventory/InventoryPartsStockPage").then((m) => ({ default: m.InventoryPartsStockPage })));
const InventoryAssignmentsPage = React.lazy(() => import("../pages/inventory/InventoryAssignmentsPage").then((m) => ({ default: m.InventoryAssignmentsPage })));
const InventoryPurchasesPage = React.lazy(() => import("../pages/inventory/InventoryPurchasesPage").then((m) => ({ default: m.InventoryPurchasesPage })));

// G5-3 — content-area fallback for React.lazy route chunks. Rendered INSIDE the
// Shell so the top nav/sidebar stay mounted while a route's JS chunk loads; only
// the content region shows this placeholder. Route-based code-splitting keeps the
// initial bundle small so mobile LCP stays under the 4s ceiling.
export function RouteFallback() {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className="flex min-h-[40vh] w-full items-center justify-center text-xs text-gray-500"
    >
      Loading…
    </div>
  );
}

function SessionCheckRetry({ refetch }: { refetch: () => unknown }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 px-6 text-center text-xs text-gray-700">
      <p role="alert">Session check timed out. The API hung — you may still be signed in.</p>
      <button
        type="button"
        className="rounded-sm border border-gray-300 bg-white px-3 py-1.5 text-xs text-gray-900"
        onClick={() => void refetch()}
      >
        Retry session
      </button>
    </div>
  );
}

function sessionGate(auth: ReturnType<typeof useAuth>) {
  if (auth.isLoading) {
    return <div className="flex min-h-screen items-center justify-center text-xs text-gray-500">Checking session...</div>;
  }
  if (auth.isUnauthenticated) return <Navigate to="/login" replace />;
  if (!auth.user && auth.isError) return <SessionCheckRetry refetch={auth.refetch} />;
  if (!auth.user) return <Navigate to="/login" replace />;
  return null;
}

/**
 * React Router schedules link navigation as a transition.  A previously
 * revealed Suspense boundary is therefore allowed to keep showing its old
 * child while the next lazy route resolves.  Reusing that boundary across
 * locations left detail pages visibly mounted under the destination URL when
 * a route chunk was not already warm (most visibly Driver profile -> Fleet).
 *
 * Key the content boundary to the location so each navigation gets a fresh
 * fallback/child lifecycle.  The Shell remains outside this boundary, so the
 * sidebar and header stay mounted while the destination chunk loads.
 */
function RouteContentBoundary({ children }: { children: ReactNode }) {
  const location = useLocation();
  return (
    <React.Suspense key={`${location.pathname}${location.search}`} fallback={<RouteFallback />}>
      {children}
    </React.Suspense>
  );
}

function RootRedirect() {
  const auth = useAuth();
  const gate = sessionGate(auth);
  if (gate) return gate;
  return <Navigate to="/home" replace />;
}

function ProtectedRoute({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const gate = sessionGate(auth);
  if (gate) return gate;
  if (!auth.user) return <Navigate to="/login" replace />;
  return (
    <Shell auth={auth.user}>
      <RouteContentBoundary>{children}</RouteContentBoundary>
    </Shell>
  );
}

function OwnerAdminRoute({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const gate = sessionGate(auth);
  if (gate) return gate;
  if (!auth.user) return <Navigate to="/login" replace />;
  const role = String(auth.user.role ?? "");
  if (role !== "Owner" && role !== "Administrator") {
    return <Navigate to="/home" replace />;
  }
  return (
    <Shell auth={auth.user}>
      <RouteContentBoundary>{children}</RouteContentBoundary>
    </Shell>
  );
}

function OwnerSuperAdminRoute({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const gate = sessionGate(auth);
  if (gate) return gate;
  if (!auth.user) return <Navigate to="/login" replace />;
  const role = String(auth.user.role ?? "");
  if (role !== "Owner" && role !== "SuperAdmin") {
    return <Navigate to="/home" replace />;
  }
  return (
    <Shell auth={auth.user}>
      <RouteContentBoundary>{children}</RouteContentBoundary>
    </Shell>
  );
}

function OwnerOnlyRoute({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const gate = sessionGate(auth);
  if (gate) return gate;
  if (!auth.user) return <Navigate to="/login" replace />;
  if (String(auth.user.role ?? "") !== "Owner") {
    return <Navigate to="/home" replace />;
  }
  return (
    <Shell auth={auth.user}>
      <RouteContentBoundary>{children}</RouteContentBoundary>
    </Shell>
  );
}

function HomeRoute() {
  const auth = useAuth();
  if (!auth.user) return null;
  // /home stays role homes until GUARD verifies live GET /api/v1/home/scenario-tracker
  // (staleness heartbeat + entity chips). Tracker is mounted additively at /home/scenario-tracker.
  if (auth.user.role === "Owner") return <OwnerHome auth={auth.user} />;
  return <HomePage auth={auth.user} />;
}

function HomeOpsRoute() {
  const auth = useAuth();
  if (!auth.user) return null;
  if (auth.user.role === "Owner") return <OwnerHome auth={auth.user} />;
  return <HomePage auth={auth.user} />;
}

function QboHomepageRoute() {
  const auth = useAuth();
  if (!auth.user) return null;
  return <QboStyleHomePage auth={auth.user} />;
}

function MaintenanceTabRoute({ tabId }: { tabId: MaintenanceTabId }) {
  return <MaintenanceHomePage initialTab={tabId} />;
}

function DriversSubtabRoute({
  subnav,
}: {
  subnav: DriversSubnavId | "disputes" | "team_splits";
}) {
  return <DriversPage initialSubnav={subnav} />;
}

type FactoringTabId =
  | "recourse_pipeline"
  | "chargebacks_fees"
  | "statements_settings"
  | "faro_imports"
  | "equipment_loans"
  | "vendor_merges"
  | "reserve_tracker";

function FactoringTabRoute({ tabId }: { tabId: FactoringTabId }) {
  return <FactoringHomePage initialTab={tabId} />;
}

function FuelTabRoute({ tabId }: { tabId: FuelTabId }) {
  return <FuelPlannerHomePage initialTab={tabId} />;
}

function DispatchLoadsRoute() {
  return <DispatchPage loadsDeepLink />;
}

type DispatchSecondarySubTabId = "load_board" | "book_load" | "assignments" | "settlements" | "pre_settlements";

function DispatchSecondaryTabRoute({ subTab }: { subTab: DispatchSecondarySubTabId }) {
  return <DispatchPage initialSubTab={subTab} />;
}

function RoundTripsRoute() {
  return <DispatchPage roundTripsDeepLink />;
}

function FactoringBatchDetailRoute() {
  const { id } = useParams<{ id: string }>();
  const { selectedCompanyId } = useCompanyContext();

  if (!id || !selectedCompanyId) {
    return <div className="text-xs text-gray-500">Batch detail unavailable.</div>;
  }

  return <BatchDetail batchId={id} companyId={selectedCompanyId} />;
}

// Locked UI-surface sentinel paths verified by architecture guard.
function IntegrityAlertsTab() {
  const { selectedCompanyId } = useCompanyContext();
  return <IntegrityAlertsPage operatingCompanyId={selectedCompanyId ?? ""} />;
}

function DriverSafetyProfileTab() {
  const { driverId } = useParams();
  return <DriverSafetyProfilePage key={driverId} />;
}

/**
 * C5 — the canonical load address. EntityLink kind="load" (48+ callers) opens the load HERE.
 *
 * This used to be `DispatchLoadDetailRedirect`, whose whole body was
 * `<Navigate to={`/dispatch?load_id=${id}`} replace />` — so the canonical route existed, passed
 * every route audit, and then bounced straight back to the query-param board. It now renders the
 * Dispatch board itself, which reads the `:id` PATH param (pages/Dispatch.tsx) and opens the load
 * drawer. `?load_id=` / `?load=` remain honoured there as legacy bookmarks.
 *
 * Reverse Law §9 bank linkage stays at /dispatch/loads/:id/banking (LoadBankingLinkagePage) —
 * never hijack the load-detail target with that surface.
 */
function DispatchLoadDetailRoute() {
  const { id } = useParams<{ id: string }>();
  if (!id) return <Navigate to="/dispatch/loads" replace />;
  // Pass :id explicitly — Live FAIL: WO→load landed on board with ?view=list and drawer never opened.
  return <DispatchPage loadsDeepLink deepLinkLoadId={id} />;
}

/** Legacy `/loads/:id` bookmarks → the canonical `/dispatch/loads/:id` (kept, never dropped). */
function DispatchLoadLegacyPathRedirect() {
  const { id } = useParams<{ id: string }>();
  if (!id) return <Navigate to="/dispatch/loads" replace />;
  return <Navigate to={`/dispatch/loads/${encodeURIComponent(id)}`} replace />;
}

/** Legacy `/fleet/:unitId` bookmarks → canonical `/fleet/units/:id` (never collide with known fleet leaves). */
const FLEET_LEAF_SEGMENTS = new Set(["transfers-in-progress", "units", "trailers", "map"]);
function FleetUnitLegacyRedirect() {
  const { id } = useParams<{ id: string }>();
  if (!id || FLEET_LEAF_SEGMENTS.has(id)) return <Navigate to="/fleet" replace />;
  return <Navigate to={`/fleet/units/${encodeURIComponent(id)}`} replace />;
}

/** Legacy bookmarked underscore paths → hyphen canonical routes (Block A10). */
const UNDERSCORE_LEGACY_REDIRECTS: ReadonlyArray<readonly [string, string]> = [
  ["/lists/driver/pay_rate_templates", "/lists/driver/pay-rate-templates"],
  ["/lists/dispatch/load_types", "/lists/dispatch/load-types"],
  ["/lists/dispatch/detention_reasons", "/lists/dispatch/detention-reasons"],
  ["/lists/dispatch/pickup_time_types", "/lists/dispatch/pickup-time-types"],
  ["/lists/dispatch/additional_charges", "/lists/dispatch/additional-charges"],
  ["/lists/dispatch/load_cancellation_reasons", "/lists/dispatch/load-cancellation-reasons"],
];

function UnderscoreLegacyRedirect({ from, to }: { from: string; to: string }) {
  void from;
  return <Navigate to={to} replace />;
}

/** Preserve ?query + #hash on alias redirects (LAW: never drop driver_id / settlement_id). */
function PreserveSearchNavigate({ to }: { to: string }) {
  const location = useLocation();
  return <Navigate to={`${to}${location.search}${location.hash}`} replace />;
}

function ListsDomainRoute() {
  const { domain } = useParams();
  const location = useLocation();
  if (domain) {
    const redirectPath = resolveUnderscoreRedirectPath(`/lists/${domain}`);
    if (redirectPath) {
      return <Navigate to={`${redirectPath}${location.search}${location.hash}`} replace />;
    }
    const hubKey = resolveListsDomainHubKey(domain);
    if (hubKey) {
      return <Navigate to={`/lists/hub/${hubKey}${location.search}${location.hash}`} replace />;
    }
  }
  return <ComingSoonPage />;
}

function ListsCatalogKeyRoute() {
  const { domain, catalogKey } = useParams();
  const location = useLocation();
  if (domain && catalogKey) {
    const redirectPath = resolveUnderscoreRedirectPath(`/lists/${domain}/${catalogKey}`);
    if (redirectPath) {
      return <Navigate to={`${redirectPath}${location.search}${location.hash}`} replace />;
    }
    // LST-F324 — hub cards use the stable /lists/:domain/:catalogKey namespace. Bespoke routes
    // declared above this catch-all keep winning normally; only an otherwise-unmatched,
    // registry-backed catalog reaches here. Send that card to its real GenericCatalogPage instead
    // of the Coming Soon fallback. Drivers is the one hub/API domain alias.
    const registryDomain = domain === "drivers" ? "driver" : domain;
    if (catalogKeyToCatalogName(registryDomain, catalogKey)) {
      return (
        <Navigate
          to={`/lists/catalogs/${registryDomain}/${catalogKey}${location.search}${location.hash}`}
          replace
        />
      );
    }
  }
  return <ComingSoonPage />;
}

const LOCKED_SAFETY_TAB_PATHS = ["/safety/driver-files"];
void LOCKED_SAFETY_TAB_PATHS;


export const ROUTES = React.Children.toArray(
  <>
<Route path="/" element={<RootRedirect />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/login/reset" element={<LoginResetRequestPage />} />
        <Route path="/login/reset/confirm" element={<LoginResetConfirmPage />} />
        <Route path="/legal/privacy" element={<PrivacyPolicyPage />} />
        <Route path="/legal/terms" element={<TermsOfServicePage />} />
        <Route path="/sign/:token" element={<LegalSignPage />} />
        <Route path="/attorney-review/:token" element={<LegalAttorneyReviewPortalPage />} />
        <Route path="/owner-approval/:token" element={<OwnerApprovalPortalPage />} />
        <Route path="/apply/:token" element={<ApplicationPage />} />
        <Route path="/portal/login" element={<PortalLoginPage />} />
        <Route
          path="/portal"
          element={
            <PortalRouteGuard>
              <PortalLayout />
            </PortalRouteGuard>
          }
        >
          <Route index element={<Navigate to="/portal/dashboard" replace />} />
          <Route path="dashboard" element={<PortalDashboardPage />} />
          <Route path="loads/:id" element={<PortalLoadDetailPage />} />
          <Route path="profile" element={<PortalProfilePage />} />
        </Route>
        <Route
          path="/home"
          element={
            <ProtectedRoute>
              <HomeRoute />
            </ProtectedRoute>
          }
        />
        {/* PROG-NAV-01 (owner 2026-08-05 → 2026-08-08): Scenario Tracker is Program home.
            /program mounts ScenarioTrackerHome only (no blocks/tabs chrome). Legacy path
            /home/scenario-tracker redirects to /program. */}
        <Route path="/home/scenario-tracker" element={<Navigate to="/program" replace />} />
        {/* Additive: role dashboards also kept at /home/ops (never-delete). */}
        <Route
          path="/home/ops"
          element={
            <ProtectedRoute>
              <HomeOpsRoute />
            </ProtectedRoute>
          }
        />
        {/* Program home = Scenario Tracker only (owner 2026-08-08). */}
        <Route
          path="/program"
          element={
            <ProtectedRoute>
              <AuditScoreboardPage />
            </ProtectedRoute>
          }
        />
        {/* Module Completion — the build scoreboard (N of M acceptance items per module), read from
            docs/module-completion/*.json via the generated data module. Additive route; no sidebar
            item is added, so the locked sidebar count is unchanged. */}
        <Route
          path="/program/modules"
          element={
            <ProtectedRoute>
              <ModuleCompletionPage />
            </ProtectedRoute>
          }
        />
        {/* Former dedicated tracker URL — redirect to Program home (same surface). */}
        <Route path="/program/scenario-tracker" element={<Navigate to="/program" replace />} />
        {/* Owner-approved module matrix scoreboard (preview / sample until live R/M/D). */}
        <Route
          path="/program/matrix"
          element={
            <ProtectedRoute>
              <ModuleMatrixPreviewPage />
            </ProtectedRoute>
          }
        />
        {/* Archived 13-gate / blocks certification board — reachable until matrix is live-sourced. */}
        <Route
          path="/program/legacy-scoreboard"
          element={
            <ProtectedRoute>
              <LegacyAuditScoreboardPage />
            </ProtectedRoute>
          }
        />
        {/* Tracker remains reachable — additive; no longer the /program index. */}
        <Route
          path="/program/tracker"
          element={
            <ProtectedRoute>
              <ProgramTrackerPage />
            </ProtectedRoute>
          }
        />
        {/* Old Audit-Truth board ARCHIVED here (never deleted) — reachable, no longer the default. */}
        <Route
          path="/program/legacy-board"
          element={
            <ProtectedRoute>
              <ProgramBoardPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/program/final-additions"
          element={
            <ProtectedRoute>
              <FinalAdditionsPage />
            </ProtectedRoute>
          }
        />
        {/* SYSTEM — Owner-only module (owner-supplied design): QBO Reconciliation, QBO Sync, Program
            Tracker, Software/Build health, Claude Coder. Read-only; posts nothing. */}
        <Route
          path="/system"
          element={
            <OwnerOnlyRoute>
              <SystemModulePage />
            </OwnerOnlyRoute>
          }
        />
        {/* Additive QBO-style home (C6): bookmarks keep working. Canonical training HOME is /home (sidebar). */}
        <Route
          path="/app/homepage"
          element={
            <ProtectedRoute>
              <QboHomepageRoute />
            </ProtectedRoute>
          }
        />
        <Route
          path="/settings/notifications"
          element={
            <ProtectedRoute>
              <NotificationPreferencesPage />
            </ProtectedRoute>
          }
        />
        {/* LV-SETTINGS-COMPANY-REDIRECT — Live walks hit /settings/company; company ops live under /system */}
        <Route
          path="/settings/company"
          element={
            <ProtectedRoute>
              <PreserveSearchNavigate to="/system" />
            </ProtectedRoute>
          }
        />
        <Route
          path="/settings"
          element={
            <ProtectedRoute>
              <UserProfileSettingsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/users"
          element={
            <ProtectedRoute>
              <UsersPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/users/:id"
          element={
            <ProtectedRoute>
              <UserDetailPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/drivers/profiles"
          element={
            <ProtectedRoute>
              <DriversSubtabRoute subnav="profiles" />
            </ProtectedRoute>
          }
        />
        <Route
          path="/drivers/settlements"
          element={
            <ProtectedRoute>
              {/* FAIL-S2: Drivers "Settlements" tab must land on the canonical list/detail subledger —
                  not PreSettlementsPanel (same defect as CHAIN-07 accounting redirect). */}
              <PreserveSearchNavigate to="/driver-finance/settlements" />
            </ProtectedRoute>
          }
        />
        <Route
          path="/drivers/pre-settlements"
          element={
            <ProtectedRoute>
              <DriversSubtabRoute subnav="pre_settlements" />
            </ProtectedRoute>
          }
        />
        <Route
          path="/drivers/cash-advances"
          element={
            <ProtectedRoute>
              <DriversSubtabRoute subnav="cash_advances" />
            </ProtectedRoute>
          }
        />
        <Route
          path="/drivers/permits"
          element={
            <ProtectedRoute>
              <DriversSubtabRoute subnav="permits" />
            </ProtectedRoute>
          }
        />
        <Route
          path="/drivers/pay-rate-templates"
          element={
            <ProtectedRoute>
              <DriversSubtabRoute subnav="pay_rate_templates" />
            </ProtectedRoute>
          }
        />
        <Route
          path="/drivers/deductions"
          element={
            <ProtectedRoute>
              <DriversSubtabRoute subnav="deductions" />
            </ProtectedRoute>
          }
        />
        <Route
          path="/drivers/auto-deductions"
          element={<Navigate to="/drivers/deductions" replace />}
        />
        <Route
          path="/drivers/team-splits"
          element={
            <ProtectedRoute>
              <DriversSubtabRoute subnav="team_splits" />
            </ProtectedRoute>
          }
        />
        <Route
          path="/drivers/disputes"
          element={
            <ProtectedRoute>
              <DriversSubtabRoute subnav="disputes" />
            </ProtectedRoute>
          }
        />
        <Route
          path="/drivers/leave"
          element={
            <ProtectedRoute>
              <DriversSubtabRoute subnav="leave" />
            </ProtectedRoute>
          }
        />
        <Route
          path="/drivers"
          element={
            <ProtectedRoute>
              <DriversPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/customers"
          element={
            <ProtectedRoute>
              <CustomersPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/customers/:id"
          element={
            <ProtectedRoute>
              <CustomerDetailPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/customers/:id/statement"
          element={
            <ProtectedRoute>
              <CustomerStatementPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/vendors"
          element={
            <ProtectedRoute>
              <VendorsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/vendors/:id"
          element={
            <ProtectedRoute>
              <VendorDetailPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/vendors/:id/statement"
          element={
            <ProtectedRoute>
              <VendorStatementPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/documents"
          element={
            <ProtectedRoute>
              <DocumentsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/docs"
          element={
            <OwnerAdminRoute>
              <DocsHomePage />
            </OwnerAdminRoute>
          }
        />
        <Route
          path="/eld"
          element={
            <OwnerOnlyRoute>
              <EldPage />
            </OwnerOnlyRoute>
          }
        />
        <Route
          path="/cash-flow"
          element={
            <ProtectedRoute>
              <CashFlowPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/driver-hub"
          element={
            <ProtectedRoute>
              <DriverHubPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/driver-hub/reporting"
          element={
            <ProtectedRoute>
              <DriverHubReportingPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/dispatch/at-risk"
          element={
            <ProtectedRoute>
              <AtRiskQueuePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/dispatch/factoring-queue"
          element={
            <ProtectedRoute>
              <FactoringQueuePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/dispatch/driver-bill-remint"
          element={
            <ProtectedRoute>
              <DriverBillRemintScreen />
            </ProtectedRoute>
          }
        />
        <Route
          path="/dispatch/in-transit-issues"
          element={
            <ProtectedRoute>
              <InTransitIssuesPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/dispatch/assignment-history"
          element={
            <ProtectedRoute>
              <AssignmentHistoryPage />
            </ProtectedRoute>
          }
        />
        {/* DISPATCH-F6251-OWNER-OVERRIDE-LOG / OWNER-OVERRIDE-LOG — action_link target for the critical
            "Owner override — driver qualification (CDL / DOT medical)" notification
            (dispatch-override-notice.handler.ts). Route previously did not exist; "Open" silently
            fell through the catch-all to "/". */}
        <Route
          path="/dispatch/owner-override-log"
          element={
            <ProtectedRoute>
              <OwnerOverrideLogPage />
            </ProtectedRoute>
          }
        />
        {/* Unified Timeline is the default planner view (Phase 1). The 3 legacy tabs stay reachable (archive-not-delete). */}
        <Route path="/dispatch/planners" element={<Navigate replace to="/dispatch/planners/timeline" />} />
        <Route
          path="/dispatch/planners/timeline"
          element={
            <ProtectedRoute>
              <DispatchPlannersLayout><UnifiedTimelinePlanner /></DispatchPlannersLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/dispatch/planner"
          element={
            <ProtectedRoute>
              <PlannerCalendarPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/dispatch/planners/driver"
          element={
            <ProtectedRoute>
              <DispatchPlannersLayout><DriverPlanner /></DispatchPlannersLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/dispatch/planners/truck"
          element={
            <ProtectedRoute>
              <DispatchPlannersLayout><TruckPlanner /></DispatchPlannersLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/dispatch/planners/loads"
          element={
            <ProtectedRoute>
              <DispatchPlannersLayout><LoadsPlanner /></DispatchPlannersLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/dispatch/detention"
          element={
            <ProtectedRoute>
              <DetentionBoardPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/dispatch/equipment-transfers"
          element={
            <ProtectedRoute>
              <EquipmentTransferRequestsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/dispatch/ocr-queue"
          element={
            <ProtectedRoute>
              <OcrQueuePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/dispatch/notify-preferences"
          element={
            <ProtectedRoute>
              <NotifyPreferencesPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/dispatch/pod-review"
          element={
            <ProtectedRoute>
              <PodReviewPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/dispatch/settings"
          element={
            <ProtectedRoute>
              <DispatchSettingsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/dispatch/alerts"
          element={
            <ProtectedRoute>
              <DispatchAlertsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/dispatch/alerts/late-arrivals"
          element={
            <ProtectedRoute>
              <LateArrivalsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/dispatch/border-crossing/history"
          element={
            <ProtectedRoute>
              <BorderCrossingHistoryPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/dispatch/border-crossing"
          element={
            <ProtectedRoute>
              <BorderCrossingWizardPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/dispatch/borders/geofence-history"
          element={
            <ProtectedRoute>
              <GpsBorderCrossingHistory />
            </ProtectedRoute>
          }
        />
        <Route
          path="/dispatch/map"
          element={
            <ProtectedRoute>
              <MapView />
            </ProtectedRoute>
          }
        />
        <Route
          path="/dispatch/book-load"
          element={
            <ProtectedRoute>
              <DispatchSecondaryTabRoute subTab="book_load" />
            </ProtectedRoute>
          }
        />
        <Route path="/dispatch/book_load" element={<Navigate to="/dispatch/book-load?book_load=1" replace />} />
        <Route
          path="/dispatch/assignments"
          element={
            <ProtectedRoute>
              <DispatchSecondaryTabRoute subTab="assignments" />
            </ProtectedRoute>
          }
        />
        <Route
          path="/dispatch/settlements"
          element={
            <ProtectedRoute>
              {/* FAIL-S2 / E1: Dispatch "Settlements" must land on the canonical subledger —
                  not the local quicklink stub (same pattern as /drivers/settlements). */}
              <PreserveSearchNavigate to="/driver-finance/settlements" />
            </ProtectedRoute>
          }
        />
        <Route
          path="/dispatch/pre-settlements"
          element={
            <ProtectedRoute>
              <DispatchSecondaryTabRoute subTab="pre_settlements" />
            </ProtectedRoute>
          }
        />
        <Route
          path="/dispatch/round-trips"
          element={
            <ProtectedRoute>
              <RoundTripsRoute />
            </ProtectedRoute>
          }
        />
        <Route
          path="/dispatch"
          element={
            <ProtectedRoute>
              <DispatchPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/dispatch/geofencing"
          element={
            <ProtectedRoute>
              <GeofencesPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/dispatch/loads/:id/banking"
          element={
            <ProtectedRoute>
              <LoadBankingLinkagePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/dispatch/loads/:id"
          element={
            <ProtectedRoute>
              <DispatchLoadDetailRoute />
            </ProtectedRoute>
          }
        />
        <Route
          path="/dispatch/loads"
          element={
            <ProtectedRoute>
              <DispatchLoadsRoute />
            </ProtectedRoute>
          }
        />
        <Route
          path="/dispatch/incidents"
          element={
            <ProtectedRoute>
              <Navigate to="/dispatch/alerts" replace />
            </ProtectedRoute>
          }
        />
        <Route
          path="/dispatch/layovers/driver/:driverId"
          element={
            <ProtectedRoute>
              <DriverLayoverHistoryPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/dispatch/factoring-packets"
          element={
            <ProtectedRoute>
              <Navigate to="/accounting/factoring" replace />
            </ProtectedRoute>
          }
        />
        <Route
          path="/daily-tasks"
          element={
            <ProtectedRoute>
              <DailyTasksPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/fuel"
          element={
            <ProtectedRoute>
              <FuelTabRoute tabId="home" />
            </ProtectedRoute>
          }
        />
        <Route
          path="/fuel/planner"
          element={
            <ProtectedRoute>
              <FuelTabRoute tabId="planner" />
            </ProtectedRoute>
          }
        />
        <Route
          path="/fuel/inbox"
          element={
            <ProtectedRoute>
              <FuelTabRoute tabId="relay_inbox" />
            </ProtectedRoute>
          }
        />
        {/* LV-FUEL-RELAY-INBOX-REDIRECT — Live walks hit /fuel/relay-inbox; canonical leaf is /fuel/inbox */}
        <Route
          path="/fuel/relay-inbox"
          element={
            <ProtectedRoute>
              <FuelTabRoute tabId="relay_inbox" />
            </ProtectedRoute>
          }
        />
        <Route
          path="/fuel/settings"
          element={
            <ProtectedRoute>
              <FuelTabRoute tabId="settings" />
            </ProtectedRoute>
          }
        />
        <Route
          path="/fuel/expense-mapping"
          element={
            <ProtectedRoute>
              <FuelTabRoute tabId="expense_mapping" />
            </ProtectedRoute>
          }
        />
        <Route
          path="/fuel/history"
          element={
            <ProtectedRoute>
              <FuelTabRoute tabId="history" />
            </ProtectedRoute>
          }
        />
        <Route
          path="/fuel/loves-prices"
          element={
            <ProtectedRoute>
              <FuelTabRoute tabId="loves_prices" />
            </ProtectedRoute>
          }
        />
        <Route
          path="/fuel/compliance"
          element={
            <ProtectedRoute>
              <FuelTabRoute tabId="compliance" />
            </ProtectedRoute>
          }
        />
        <Route
          path="/fuel/fraud-alerts"
          element={
            <ProtectedRoute>
              <FraudAlertsListPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/fuel/card-overage"
          element={
            <ProtectedRoute>
              <CardOverageQueuePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/banking/transactions"
          element={
            <ProtectedRoute>
              <BankingHomePage initialTab="transactions" />
            </ProtectedRoute>
          }
        />
        <Route
          path="/banking/factoring"
          element={
            <ProtectedRoute>
              <BankingHomePage initialTab="factoring" />
            </ProtectedRoute>
          }
        />
        <Route
          path="/banking/driver-escrow"
          element={
            <ProtectedRoute>
              <BankingHomePage initialTab="driver_escrow" />
            </ProtectedRoute>
          }
        />
        <Route
          path="/banking/relay"
          element={
            <ProtectedRoute>
              <BankingHomePage initialTab="relay_card" />
            </ProtectedRoute>
          }
        />
        <Route
          path="/banking/reports"
          element={
            <ProtectedRoute>
              <BankingHomePage initialTab="reports" />
            </ProtectedRoute>
          }
        />
        <Route
          path="/banking/statement-import"
          element={
            <ProtectedRoute>
              <BankingHomePage initialTab="statement_import" />
            </ProtectedRoute>
          }
        />
        <Route
          path="/banking/plaid-connections"
          element={
            <ProtectedRoute>
              <BankingHomePage initialTab="plaid_connections" />
            </ProtectedRoute>
          }
        />
        <Route
          path="/banking/settings"
          element={
            <ProtectedRoute>
              <BankingHomePage initialTab="settings" />
            </ProtectedRoute>
          }
        />
        <Route
          path="/banking"
          element={
            <ProtectedRoute>
              <BankingHomePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/banking/transfers"
          element={
            <ProtectedRoute>
              <TransfersListPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/banking/reconcile"
          element={
            <ProtectedRoute>
              <BankingObligationReconcilePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/banking/reconciliation"
          element={
            <ProtectedRoute>
              <BankReconciliationPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/banking/reconciliation-workspace"
          element={
            <ProtectedRoute>
              <ReconciliationWorkspacePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/banking/categorization-rules"
          element={
            <ProtectedRoute>
              <CategorizationRulesPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/banking/qbo-sync-queue"
          element={
            <ProtectedRoute>
              <QboSyncQueuePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/banking/email-queue"
          element={
            <ProtectedRoute>
              <EmailQueuePage />
            </ProtectedRoute>
          }
        />
        {/* Workflow-B legacy aliases — @archived BankTxCategorizationPage was never a manifest route;
            these redirects preserve bookmarks/deep links on the single live categorize surface. */}
        <Route
          path="/banking/uncategorized"
          element={
            <ProtectedRoute>
              <Navigate to="/banking/transactions?type=uncategorized" replace />
            </ProtectedRoute>
          }
        />
        <Route
          path="/banking/categorize"
          element={
            <ProtectedRoute>
              <Navigate to="/banking/transactions?type=uncategorized" replace />
            </ProtectedRoute>
          }
        />
        <Route
          path="/banking/accounts/:id"
          element={
            <ProtectedRoute>
              <BankAccountDetailPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/banking/account-visibility"
          element={
            <ProtectedRoute>
              <BankAccountVisibilityPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/banking/cash-gl-setup"
          element={
            <ProtectedRoute>
              <CashGlSetupPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/compliance"
          element={
            <ProtectedRoute>
              <ComplianceDashboardPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/compliance/property-tax"
          element={
            <ProtectedRoute>
              <PropertyTaxRenditionPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/compliance/property-tax/:id"
          element={
            <ProtectedRoute>
              <PropertyTaxRenditionPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/compliance/form-2290"
          element={
            <ProtectedRoute>
              <Form2290Filings />
            </ProtectedRoute>
          }
        />
        <Route
          path="/notifications"
          element={
            <ProtectedRoute>
              <NotificationCenterPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/safety"
          element={
            <ProtectedRoute>
              <SafetyLayout />
            </ProtectedRoute>
          }
        >
          {/* S-11: Safety previously had no home dashboard and landed directly on the "Incidents &
              Claims" tab (Safety Events). Now lands on a dedicated aggregate-KPI home page. */}
          <Route index element={<Navigate to="/safety/home" replace />} />
          <Route path="home" element={<SafetyHomeTab />} />
          {/* SAF-F27: relative children only under SafetyLayout (V6.4 canonical pattern).
              Absolute /safety/* path= strings caused dual-registration drift with sibling
              relative routes; URLs unchanged (/safety/home, /safety/idvr, …). */}
          <Route path="driver-files" element={<DriverFilesTab />} />
          <Route path="drug-alcohol" element={<DrugAlcoholTab />} />
          <Route path="safety-meetings" element={<SafetyMeetingsTab />} />
          <Route path="training/programs" element={<TrainingProgramsTab />} />
          <Route path="training/records" element={<TrainingRecordsTab />} />
          {/* Parent /safety/training used to miss both leaves and fall through the app catch-all to /home. */}
          <Route path="training" element={<Navigate to="/safety/training/programs" replace />} />
          <Route path="hos" element={<HoursOfServiceTab />} />
          <Route path="eld/audit-trail" element={<EldAuditTrailViewer />} />
          <Route path="hos/exceptions" element={<HosExceptionsPage />} />
          <Route path="hos-violations" element={<HOSViolationsTab />} />
          <Route path="idvr" element={<IDVRTab />} />
          <Route path="idvr/:id" element={<IdvrDetailPage />} />
          <Route path="dot-inspections" element={<DOTInspectionsTab />} />
          <Route path="driver-scoring" element={<DriverScoringTab />} />
          <Route path="csa-score" element={<CSAScoreTab />} />
          <Route path="dot-compliance" element={<DOTComplianceTab />} />
          <Route path="cert-expiry" element={<ExpiryDashboard />} />
          <Route path="safety-events" element={<SafetyEventsTab />} />
          <Route path="accidents" element={<AccidentsIncidentsTab />} />
          <Route path="damage-reports" element={<DamageReportsTab />} />
          <Route path="trailer-interchanges" element={<TrailerInterchangesTab />} />
          <Route path="cargo-claims" element={<CargoClaimsTab />} />
          <Route path="internal-fines" element={<InternalFinesTab />} />
          <Route path="external-fines" element={<ExternalFinesTab />} />
          <Route path="complaints" element={<ComplaintsTab />} />
          <Route path="escrow-record" element={<EscrowRecordTab />} />
          <Route path="geofence-alerts" element={<GeofenceBreachesTab />} />
          <Route path="insurance" element={<InsuranceTab />} />
          <Route path="insurance/*" element={<InsuranceTab />} />
          <Route path="permits" element={<PermitsTab />} />
          <Route path="integrity-reports" element={<IntegrityReportsTab />} />
          <Route path="position-history" element={<PositionHistoryPage />} />
          <Route path="integrity-alerts" element={<IntegrityAlertsTab />} />
          <Route path="csa-mitigation" element={<CSAMitigationQueuePage />} />
          <Route path="csa-fmcsa-trend" element={<CSAFmcsaTrendPage />} />
          <Route path="anomaly-alerts" element={<AnomalyAlertsPage />} />
          <Route path="audit-425c" element={<Audit425cPage />} />
          <Route path="photo-comparison" element={<PhotoComparisonPage />} />
          <Route path="photo-comparison/:sessionUuid" element={<SessionDetailPage />} />
          <Route path="reports" element={<SafetyReportsPage />} />
          <Route path="driver-profiles/:driverId" element={<DriverSafetyProfileTab />} />
          {/* Block K (Driver Scheduler): canonical paths under /safety/* — see IH35_UNIFIED_BLUEPRINT_ADDITIONS.md §14 */}
          <Route path="driver-scheduler" element={<DriverSchedulerGridPage />} />
          <Route path="scheduler/pending-requests" element={<DriverSchedulerRequestInboxPage />} />
          <Route path="scheduler/requests/:id" element={<DriverSchedulerRequestDetailPage />} />
          <Route path="leave-balances" element={<DriverLeaveBalancesPage />} />
          <Route path="settings" element={<SettingsTab />} />
          <Route path="vehicle-inspections" element={<Navigate to="/safety/idvr" replace />} />
          {/* SYS-04 (Wave 2) — restore 5 Safety sub-routes that previously fell through to the
              catch-all and silently redirected to Home. Registered as children of /safety so the
              SAFETY sidebar item stays active and the Safety subnav renders.
              Active-path law (2026-07-21): group bookmark URLs must Navigate to the first Live
              V6.4 tab in that group — never ComingSoon while real tabs exist (ARCHIVE-not-DELETE
              on legacy shells; stubs are not an allowed active mount). */}
          <Route path="hours-of-service" element={<Navigate to="/safety/hos" replace />} />
          <Route path="inspections" element={<Navigate to="/safety/dot-inspections" replace />} />
          <Route path="fines-and-discipline" element={<Navigate to="/safety/internal-fines" replace />} />
          <Route path="driver-financial-safety" element={<Navigate to="/safety/escrow-record" replace />} />
          <Route path="workforce-planning" element={<Navigate to="/safety/driver-scheduler" replace />} />
        </Route>
        <Route
          path="/liabilities"
          element={
            <ProtectedRoute>
              <LiabilitiesHomePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/maintenance/work-orders/new"
          element={
            <ProtectedRoute>
              <WorkOrderNewPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/maintenance/work-orders/:id"
          element={
            <ProtectedRoute>
              <WorkOrderDetailPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/maintenance/defects/:defectId"
          element={
            <ProtectedRoute>
              <MaintenanceShell>
                <DefectDetailPage />
              </MaintenanceShell>
            </ProtectedRoute>
          }
        />
        <Route
          path="/maintenance/defects"
          element={
            <ProtectedRoute>
              <MaintenanceShell>
                <DefectsInboxPage />
              </MaintenanceShell>
            </ProtectedRoute>
          }
        />
        <Route
          path="/maintenance/work-orders"
          element={
            <ProtectedRoute>
              <WorkOrdersConsoleListPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/maintenance"
          element={
            <ProtectedRoute>
              <MaintenanceHomePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/maintenance/active-wos"
          element={
            <ProtectedRoute>
              <MaintenanceTabRoute tabId="active_wos" />
            </ProtectedRoute>
          }
        />
        <Route
          path="/maintenance/fleet-table"
          element={
            <ProtectedRoute>
              <MaintenanceTabRoute tabId="fleet_table" />
            </ProtectedRoute>
          }
        />
        <Route
          path="/maintenance/rm-status-board"
          element={
            <ProtectedRoute>
              <MaintenanceTabRoute tabId="rm_status_board" />
            </ProtectedRoute>
          }
        />
        <Route
          path="/maintenance/service-location"
          element={
            <ProtectedRoute>
              <MaintenanceTabRoute tabId="service_location" />
            </ProtectedRoute>
          }
        />
        <Route
          path="/maintenance/in-transit-issues"
          element={
            <ProtectedRoute>
              <MaintenanceTabRoute tabId="in_transit_issues" />
            </ProtectedRoute>
          }
        />
        <Route
          path="/maintenance/in-transit"
          element={
            <ProtectedRoute>
              <MaintenanceTabRoute tabId="in_transit_issues" />
            </ProtectedRoute>
          }
        />
        <Route
          path="/maintenance/triage"
          element={
            <ProtectedRoute>
              <MaintenanceTabRoute tabId="in_transit_issues" />
            </ProtectedRoute>
          }
        />
        <Route
          path="/maintenance/damage-reports"
          element={
            <ProtectedRoute>
              <MaintenanceTabRoute tabId="damage_reports" />
            </ProtectedRoute>
          }
        />
        <Route
          path="/maintenance/driver-reports"
          element={
            <ProtectedRoute>
              <MaintenanceTabRoute tabId="driver_reports" />
            </ProtectedRoute>
          }
        />
        <Route
          path="/maintenance/severe-repairs"
          element={
            <ProtectedRoute>
              <MaintenanceTabRoute tabId="severe_repairs" />
            </ProtectedRoute>
          }
        />
        <Route
          path="/maintenance/road-service"
          element={
            <ProtectedRoute>
              <MaintenanceTabRoute tabId="road_service" />
            </ProtectedRoute>
          }
        />
        <Route
          path="/maintenance/parts-inventory"
          element={
            <ProtectedRoute>
              <MaintenanceTabRoute tabId="parts_inventory" />
            </ProtectedRoute>
          }
        />
        <Route
          path="/maintenance/settings"
          element={
            <ProtectedRoute>
              <MaintenanceTabRoute tabId="settings" />
            </ProtectedRoute>
          }
        />
        <Route
          path="/maintenance/vehicles"
          element={
            <ProtectedRoute>
              <MaintenanceShell>
                <VehiclesMasterDataPage />
              </MaintenanceShell>
            </ProtectedRoute>
          }
        />
        <Route
          path="/maintenance/drivers"
          element={
            <ProtectedRoute>
              <DriversMasterDataPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/maintenance/parts"
          element={
            <ProtectedRoute>
              <MaintenanceShell>
                <PartsMasterDataPage />
              </MaintenanceShell>
            </ProtectedRoute>
          }
        />
        <Route
          path="/maintenance/arriving-soon"
          element={
            <ProtectedRoute>
              <MaintenanceTabRoute tabId="arriving_soon" />
            </ProtectedRoute>
          }
        />
        <Route
          path="/maintenance/pm-schedule"
          element={
            <ProtectedRoute>
              <MaintenanceShell>
                <PmSchedulePage />
              </MaintenanceShell>
            </ProtectedRoute>
          }
        />
        <Route
          path="/maintenance/pm-auto-engine"
          element={
            <ProtectedRoute>
              <MaintenanceShell>
                <PmAutoEnginePage />
              </MaintenanceShell>
            </ProtectedRoute>
          }
        />
        <Route
          path="/maintenance/kpi-dashboard"
          element={
            <ProtectedRoute>
              <MaintenanceShell>
                <MaintKpiDashboardPage />
              </MaintenanceShell>
            </ProtectedRoute>
          }
        />
        <Route
          path="/maintenance/inspections"
          element={
            <ProtectedRoute>
              <MaintenanceShell>
                <InspectionsPage />
              </MaintenanceShell>
            </ProtectedRoute>
          }
        />
        <Route
          path="/maintenance/tires"
          element={
            <ProtectedRoute>
              <MaintenanceShell>
                <TireProgramPage />
              </MaintenanceShell>
            </ProtectedRoute>
          }
        />
        <Route
          path="/maintenance/warranty-claims"
          element={
            <ProtectedRoute>
              <MaintenanceShell>
                <WarrantyClaimsPage />
              </MaintenanceShell>
            </ProtectedRoute>
          }
        />
        <Route
          path="/maintenance/vendors"
          element={
            <ProtectedRoute>
              <MaintenanceShell>
                <MaintenanceVendorsPage />
              </MaintenanceShell>
            </ProtectedRoute>
          }
        />
        <Route
          path="/maintenance/vendors/:vendorId"
          element={
            <ProtectedRoute>
              <MaintenanceShell>
                <MaintenanceVendorDetailPage />
              </MaintenanceShell>
            </ProtectedRoute>
          }
        />
        <Route
          path="/maintenance/reports"
          element={
            <ProtectedRoute>
              <MaintenanceShell>
                <MaintenanceReportsPage />
              </MaintenanceShell>
            </ProtectedRoute>
          }
        />
        <Route
          path="/maintenance/compliance"
          element={
            <ProtectedRoute>
              <MaintenanceShell>
                <Compliance425CPage />
              </MaintenanceShell>
            </ProtectedRoute>
          }
        />
        <Route
          path="/maintenance/position-history"
          element={
            <ProtectedRoute>
              <MaintenanceShell>
                <PositionHistoryPage />
              </MaintenanceShell>
            </ProtectedRoute>
          }
        />
        <Route
          path="/maintenance/fault-drafts"
          element={
            <ProtectedRoute>
              <MaintenanceShell>
                <FaultDraftsPage />
              </MaintenanceShell>
            </ProtectedRoute>
          }
        />
        <Route
          path="/maintenance/fault-rules"
          element={
            <ProtectedRoute>
              <MaintenanceShell>
                <FaultRulesPage />
              </MaintenanceShell>
            </ProtectedRoute>
          }
        />
        <Route
          path="/maintenance/brake-wear"
          element={
            <ProtectedRoute>
              <MaintenanceTabRoute tabId="brake_wear" />
            </ProtectedRoute>
          }
        />
        <Route
          path="/maintenance/pre-flight-dvir"
          element={
            <ProtectedRoute>
              <MaintenanceTabRoute tabId="pre_flight_dvir" />
            </ProtectedRoute>
          }
        />
        {/* LV-MAINTENANCE-DVIR-ROUTE-REDIRECTS — short alias used in Live walks; must not fall through to catch-all → /home */}
        <Route
          path="/maintenance/dvir"
          element={
            <ProtectedRoute>
              <MaintenanceTabRoute tabId="pre_flight_dvir" />
            </ProtectedRoute>
          }
        />
        <Route
          path="/maintenance/tire-wear"
          element={
            <ProtectedRoute>
              <MaintenanceTabRoute tabId="tire_wear" />
            </ProtectedRoute>
          }
        />
        <Route
          path="/maintenance/predictive-alerts"
          element={
            <ProtectedRoute>
              <MaintenanceTabRoute tabId="predictive_alerts" />
            </ProtectedRoute>
          }
        />
        <Route
          path="/cash-advances"
          element={
            <ProtectedRoute>
              <CashAdvancesHomePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/factoring/recourse-pipeline"
          element={
            <ProtectedRoute>
              <FactoringTabRoute tabId="recourse_pipeline" />
            </ProtectedRoute>
          }
        />
        <Route
          path="/factoring/chargebacks-fees"
          element={
            <ProtectedRoute>
              <FactoringTabRoute tabId="chargebacks_fees" />
            </ProtectedRoute>
          }
        />
        <Route
          path="/factoring/statements-settings"
          element={
            <ProtectedRoute>
              <FactoringTabRoute tabId="statements_settings" />
            </ProtectedRoute>
          }
        />
        <Route
          path="/factoring/faro-imports"
          element={
            <ProtectedRoute>
              <FactoringTabRoute tabId="faro_imports" />
            </ProtectedRoute>
          }
        />
        <Route
          path="/factoring/equipment-loans"
          element={
            <ProtectedRoute>
              <FactoringTabRoute tabId="equipment_loans" />
            </ProtectedRoute>
          }
        />
        <Route
          path="/factoring/vendor-merges"
          element={
            <ProtectedRoute>
              <FactoringTabRoute tabId="vendor_merges" />
            </ProtectedRoute>
          }
        />
        <Route
          path="/factoring/reserve-tracker"
          element={
            <ProtectedRoute>
              <FactoringTabRoute tabId="reserve_tracker" />
            </ProtectedRoute>
          }
        />
        <Route
          path="/factoring"
          element={
            <ProtectedRoute>
              <FactoringHomePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/factoring/submit"
          element={
            <ProtectedRoute>
              <SubmissionQueue />
            </ProtectedRoute>
          }
        />
        <Route
          path="/factoring/batches/new"
          element={
            <ProtectedRoute>
              <BatchWizard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/factoring/batches/:id"
          element={
            <ProtectedRoute>
              <FactoringBatchDetailRoute />
            </ProtectedRoute>
          }
        />
        <Route
          path="/factoring/factors"
          element={
            <ProtectedRoute>
              <FactorAdmin />
            </ProtectedRoute>
          }
        />
        <Route
          path="/factoring/reserves"
          element={
            <ProtectedRoute>
              <ReserveDashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/factoring/faro-import"
          element={
            <ProtectedRoute>
              <FaroImportPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/driver-finance"
          element={
            <ProtectedRoute>
              <PreserveSearchNavigate to="/driver-finance/settlements" />
            </ProtectedRoute>
          }
        />
        <Route
          path="/driver-finance/settlements"
          element={
            <ProtectedRoute>
              <SettlementsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/driver-finance/cash-advance-requests"
          element={
            <ProtectedRoute>
              <CashAdvanceRequestsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/driver-finance/company-settlements"
          element={
            <ProtectedRoute>
              <CompanySettlementsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/driver-finance/settlement-close"
          element={
            <ProtectedRoute>
              <SettlementCloseArrivalPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/425c"
          element={
            <ProtectedRoute>
              <Form425CHome />
            </ProtectedRoute>
          }
        />
        <Route path="/form-425c" element={<Navigate to="/425c" replace />} />
        <Route
          path="/425c/exhibits"
          element={
            <ProtectedRoute>
              <Form425CExhibitsViewer />
            </ProtectedRoute>
          }
        />
        <Route
          path="/work-orders"
          element={
            <ProtectedRoute>
              <WorkOrdersConsoleListPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/work-orders/:id"
          element={
            <ProtectedRoute>
              <WorkOrdersConsoleDetailPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/catalogs"
          element={
            <ProtectedRoute>
              <Navigate to="/lists" replace />
            </ProtectedRoute>
          }
        />
        <Route
          path="/lists"
          element={
            <ProtectedRoute>
              <ListsHubPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/lists/names"
          element={
            <ProtectedRoute>
              <NamesMasterHub />
            </ProtectedRoute>
          }
        />
        <Route
          path="/lists/names/brokers"
          element={
            <ProtectedRoute>
              <BrokersListPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/lists/locations"
          element={
            <ProtectedRoute>
              <LocationsListPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/lists/dispatch/load-types"
          element={
            <ProtectedRoute>
              <LoadTypesListPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/lists/dispatch/detention-reasons"
          element={
            <ProtectedRoute>
              <DetentionReasonsListPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/lists/dispatch/load-cancellation-reasons"
          element={
            <ProtectedRoute>
              <LoadCancellationReasonsListPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/lists/dispatch/pickup-time-types"
          element={
            <ProtectedRoute>
              <PickupTimeTypesListPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/lists/dispatch/additional-charges"
          element={
            <ProtectedRoute>
              <AdditionalChargesListPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/lists/driver/pay-rate-templates"
          element={
            <ProtectedRoute>
              <PayRateTemplatesListPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/lists/driver/teams"
          element={
            <ProtectedRoute>
              <DriverTeamsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/lists/driver/deduction-types"
          element={
            <ProtectedRoute>
              <DriverDeductionTypesListPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/lists/driver/pay-types"
          element={
            <ProtectedRoute>
              <DriverPayTypesListPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/lists/driver/escrow-types"
          element={
            <ProtectedRoute>
              <EscrowTypesListPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/lists/driver/license-classes"
          element={<Navigate to="/lists/drivers/license-classes" replace />}
        />
        <Route
          path="/lists/driver/endorsements"
          element={<Navigate to="/lists/drivers/endorsements" replace />}
        />
        <Route
          path="/lists/driver/restrictions"
          element={<Navigate to="/lists/drivers/restrictions" replace />}
        />
        <Route
          path="/lists/driver/medical-card-status"
          element={<Navigate to="/lists/drivers/medical-card-status" replace />}
        />
        <Route
          path="/lists/driver/employment-status"
          element={<Navigate to="/lists/drivers/employment-status" replace />}
        />
        <Route
          path="/lists/drivers/license-classes"
          element={
            <ProtectedRoute>
              <DriversLicenseClassesCatalog />
            </ProtectedRoute>
          }
        />
        <Route
          path="/lists/drivers/endorsements"
          element={
            <ProtectedRoute>
              <DriversEndorsementsCatalog />
            </ProtectedRoute>
          }
        />
        <Route
          path="/lists/drivers/restrictions"
          element={
            <ProtectedRoute>
              <DriversRestrictionsCatalog />
            </ProtectedRoute>
          }
        />
        <Route
          path="/lists/drivers/medical-card-status"
          element={
            <ProtectedRoute>
              <DriversMedicalCardStatusCatalog />
            </ProtectedRoute>
          }
        />
        <Route
          path="/lists/drivers/employment-status"
          element={
            <ProtectedRoute>
              <DriversEmploymentStatusCatalog />
            </ProtectedRoute>
          }
        />
        <Route
          path="/lists/drivers/termination-reasons"
          element={
            <ProtectedRoute>
              <TerminationReasonsListPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/lists/drivers/driver-load-statuses"
          element={
            <ProtectedRoute>
              <DriverLoadStatusesPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/lists/maintenance/failure-codes"
          element={
            <ProtectedRoute>
              <MaintenanceFailureCodesListPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/lists/maintenance/labor-codes"
          element={
            <ProtectedRoute>
              <MaintenanceLaborCodesListPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/lists/reference/us-states"
          element={
            <ProtectedRoute>
              <StatesCatalogPage variant="us" />
            </ProtectedRoute>
          }
        />
        <Route
          path="/lists/reference/mexico-states"
          element={
            <ProtectedRoute>
              <StatesCatalogPage variant="mx" />
            </ProtectedRoute>
          }
        />
        <Route
          path="/lists/dispatch/dispatch-flag-colors"
          element={
            <ProtectedRoute>
              <DispatchFlagColorsCatalog />
            </ProtectedRoute>
          }
        />
        <Route
          path="/lists/maintenance/parts"
          element={
            <ProtectedRoute>
              <MaintenancePartsListPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/lists/maintenance/oem-parts-reference"
          element={
            <ProtectedRoute>
              <OemPartsCatalog />
            </ProtectedRoute>
          }
        />
        <Route
          path="/lists/maintenance/parts-catalog"
          element={
            <ProtectedRoute>
              <MaintenancePartsCatalog />
            </ProtectedRoute>
          }
        />
        <Route
          path="/lists/maintenance/priority-levels"
          element={
            <ProtectedRoute>
              <MaintenancePriorityLevelsListPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/lists/maintenance/service-tasks"
          element={
            <ProtectedRoute>
              <MaintenanceServiceTasksListPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/lists/maintenance/services-catalog"
          element={
            <ProtectedRoute>
              <MaintenanceServicesCatalog />
            </ProtectedRoute>
          }
        />
        <Route
          path="/lists/maintenance/shop-locations"
          element={
            <ProtectedRoute>
              <MaintenanceShopLocationsListPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/lists/maintenance/vendors"
          element={
            <ProtectedRoute>
              <MaintenanceVendorsListPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/lists/maintenance/work-order-statuses"
          element={
            <ProtectedRoute>
              <WorkOrderStatusesListPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/lists/fuel/card-types"
          element={
            <ProtectedRoute>
              <FuelCardTypesListPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/lists/fuel/exception-types"
          element={
            <ProtectedRoute>
              <FuelExceptionTypesListPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/lists/fuel/station-brands"
          element={
            <ProtectedRoute>
              <FuelStationBrandsListPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/lists/fuel/stop-reason-codes"
          element={
            <ProtectedRoute>
              <FuelStopReasonCodesListPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/lists/fuel/mpg-bands"
          element={
            <ProtectedRoute>
              <MpgBandsListPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/lists/fuel/expensive-states"
          element={
            <ProtectedRoute>
              <ExpensiveStatesListPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/lists/fuel/tax-jurisdictions"
          element={
            <ProtectedRoute>
              <FuelTaxJurisdictionsListPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/lists/fuel/brands"
          element={
            <ProtectedRoute>
              <FuelBrandsListPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/lists/fuel/station-states"
          element={
            <ProtectedRoute>
              <FuelStationStatesListPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/lists/fuel/pump-types"
          element={
            <ProtectedRoute>
              <FuelPumpTypesListPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/lists/fuel/grades"
          element={
            <ProtectedRoute>
              <FuelGradesListPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/lists/fuel/dispatch-routes"
          element={
            <ProtectedRoute>
              <FuelDispatchRoutesListPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/lists/fleet/tractor-statuses"
          element={
            <ProtectedRoute>
              <TractorStatusesListPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/lists/fleet/trailer-statuses"
          element={
            <ProtectedRoute>
              <TrailerStatusesListPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/lists/fleet/condition-codes"
          element={
            <ProtectedRoute>
              <ConditionCodesListPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/lists/fleet/equipment-types"
          element={
            <ProtectedRoute>
              <EquipmentTypesListPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/lists/fleet/tire-positions"
          element={
            <ProtectedRoute>
              <TirePositionsListPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/lists/fleet/ownership-types"
          element={
            <ProtectedRoute>
              <OwnershipTypesListPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/lists/fleet/trailer-types"
          element={
            <ProtectedRoute>
              <TrailerTypesListPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/lists/fleet/lease-terms"
          element={
            <ProtectedRoute>
              <LeaseTermsListPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/lists/fleet/asset-statuses"
          element={
            <ProtectedRoute>
              <AssetStatusesListPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/lists/fleet/asset-locations"
          element={
            <ProtectedRoute>
              <AssetLocationsListPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/lists/accounting/chart-of-accounts"
          element={
            <ProtectedRoute>
              <ChartOfAccountsListPage />
            </ProtectedRoute>
          }
        />
        {/* Block 4: Account Type (read-only reference, reuses the existing catalog page) + Detail Type (creator). */}
        <Route
          path="/lists/accounting/account-types"
          element={
            <ProtectedRoute>
              <AccountTypeCatalogPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/lists/accounting/detail-types"
          element={
            <ProtectedRoute>
              <DetailTypesListPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/lists/accounting/classes"
          element={
            <ProtectedRoute>
              <ClassesListPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/lists/accounting/payment-terms"
          element={
            <ProtectedRoute>
              <PaymentTermsListPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/lists/accounting/void-cancel-reasons"
          element={
            <ProtectedRoute>
              <VoidCancelReasonsListPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/lists/accounting/posting-templates"
          element={
            <ProtectedRoute>
              <PostingTemplatesListPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/lists/accounting/journal-entry-types"
          element={
            <ProtectedRoute>
              <JournalEntryTypesListPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/lists/accounting/qbo-bulk-link"
          element={
            <ProtectedRoute>
              <QBOBulkLinkPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/lists/accounting/qbo-categories"
          element={
            <ProtectedRoute>
              <QboCategoriesListPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/lists/accounting/items"
          element={
            <ProtectedRoute>
              <ItemsListPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/lists/accounting/account-role-bindings"
          element={
            <ProtectedRoute>
              <AccountRoleBindingsListPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/lists/accounting/chart-of-accounts-seeds"
          element={
            <ProtectedRoute>
              <ChartOfAccountsSeedsListPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/lists/accounting/expense-categories"
          element={
            <ProtectedRoute>
              <ExpenseCategoriesListPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/lists/accounting/payment-methods"
          element={
            <ProtectedRoute>
              <PaymentMethodsListPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/lists/accounting/tax-codes"
          element={
            <ProtectedRoute>
              <TaxCodesListPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/lists/accounting/abandonment-defaults"
          element={
            <OwnerAdminRoute>
              <AbandonmentDefaultsPage />
            </OwnerAdminRoute>
          }
        />
        <Route
          path="/lists/accounting/currency-codes"
          element={
            <ProtectedRoute>
              <CurrencyCodesListPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/lists/safety/accident-types"
          element={
            <ProtectedRoute>
              <AccidentTypesListPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/lists/safety/workplace-incident-types"
          element={
            <ProtectedRoute>
              <WorkplaceIncidentTypesListPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/lists/safety/internal-fine-reasons"
          element={
            <ProtectedRoute>
              <InternalFineReasonsListPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/lists/safety/civil-fine-types"
          element={
            <ProtectedRoute>
              <CivilFineTypesListPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/lists/safety/company-violation-types"
          element={
            <ProtectedRoute>
              <CompanyViolationTypesListPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/lists/safety/complaint-types"
          element={
            <ProtectedRoute>
              <ComplaintTypesListPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/lists/safety/dot-violation-types"
          element={
            <ProtectedRoute>
              <DotViolationTypesListPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/lists/safety/cargo-claim-reasons"
          element={
            <ProtectedRoute>
              <CargoClaimReasonsListPage />
            </ProtectedRoute>
          }
        />
        {UNDERSCORE_LEGACY_REDIRECTS.map(([from, to]) => (
          <Route
            key={from}
            path={from}
            element={
              <ProtectedRoute>
                <UnderscoreLegacyRedirect from={from} to={to} />
              </ProtectedRoute>
            }
          />
        ))}
        {/* Per-domain Lists hub — registered BEFORE the /lists/:domain(/:catalogKey) catch-alls so
            /lists/hub/<domain> resolves to the real hub (static "hub" segment out-ranks the dynamic
            :domain/:catalogKey pattern). Additive. */}
        <Route
          path="/lists/hub/:domain"
          element={
            <ProtectedRoute>
              <DomainCatalogHubPage />
            </ProtectedRoute>
          }
        />
        {/* LISTS-1: the bare /lists/chart-of-accounts path fell through the dynamic /lists/:domain route
            to the "Module in active development" stub. Redirect it (additive, Block-C precedent — the
            path is kept, never deleted) to the canonical Chart of Accounts page shipped in #1793. This
            explicit route is declared BEFORE /lists/:domain so it wins the match. */}
        <Route path="/lists/chart-of-accounts" element={<Navigate replace to="/lists/accounting/chart-of-accounts" />} />
        {/* CATALOG-2 factory index + dynamic catalog page — registered BEFORE /lists/:domain(/:catalogKey)
            so the literal "catalogs" segment always wins over the dynamic domain catch-all. */}
        <Route
          path="/lists/catalogs"
          element={
            <ProtectedRoute>
              <CatalogIndex />
            </ProtectedRoute>
          }
        />
        <Route
          path="/lists/catalogs/:domain/:catalogKey"
          element={
            <ProtectedRoute>
              <GenericCatalogPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/lists/:domain"
          element={
            <ProtectedRoute>
              <ListsDomainRoute />
            </ProtectedRoute>
          }
        />
        <Route
          path="/lists/:domain/:catalogKey"
          element={
            <ProtectedRoute>
              <ListsCatalogKeyRoute />
            </ProtectedRoute>
          }
        />
        <Route
          path="/coming-soon"
          element={
            <ProtectedRoute>
              <ComingSoonPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/integrations/samsara"
          element={
            <OwnerOnlyRoute>
              <SamsaraIntegrationPage />
            </OwnerOnlyRoute>
          }
        />
        <Route
          path="/integrations/edi"
          element={
            <OwnerOnlyRoute>
              <EdiSetupWizard />
            </OwnerOnlyRoute>
          }
        />
        <Route
          path="/integrations/edi/transaction-log"
          element={
            <OwnerOnlyRoute>
              <EdiTransactionLog />
            </OwnerOnlyRoute>
          }
        />
        <Route
          path="/samsara/vendor-mapping-integrity"
          element={
            <ProtectedRoute>
              <VendorMappingResolutionPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/samsara/hos-driver-map"
          element={
            <OwnerOnlyRoute>
              <HosDriverMapPreviewPage />
            </OwnerOnlyRoute>
          }
        />
        <Route
          path="/help"
          element={
            <ProtectedRoute>
              <HelpCenterPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/help/overview"
          element={
            <ProtectedRoute>
              <HelpPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/help/runbooks"
          element={
            <ProtectedRoute>
              <RunbooksIndex />
            </ProtectedRoute>
          }
        />
        <Route
          path="/help/:slug"
          element={
            <ProtectedRoute>
              <HelpArticlePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/onboarding"
          element={
            <ProtectedRoute>
              <OnboardingWizard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/reports"
          element={
            <ProtectedRoute>
              <ReportsHomePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/reports/management"
          element={
            <ProtectedRoute>
              <ManagementReportPackagePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/reports/ifta"
          element={
            <ProtectedRoute>
              {/* LV-REPORTS-IFTA-RUNNER-DUPLICATE-POLICY-CHROME: legacy alias → canonical preparer (no-ledger boundary). */}
              <Navigate to="/reports/ifta-preparer" replace />
            </ProtectedRoute>
          }
        />
        <Route
          path="/reports/ifta-preparer"
          element={
            <ProtectedRoute>
              <IftaPreparer />
            </ProtectedRoute>
          }
        />
        <Route
          path="/reports/ar-aging"
          element={
            <ProtectedRoute>
              <ARAgingPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/reports/ap-aging"
          element={
            <ProtectedRoute>
              <APAgingPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/reports/duplicate-masters"
          element={
            <ProtectedRoute>
              <DuplicateMastersReport />
            </ProtectedRoute>
          }
        />
        <Route
          path="/reports/trial-balance"
          element={
            <ProtectedRoute>
              <TrialBalancePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/reports/profit-loss"
          element={
            <ProtectedRoute>
              <ProfitLossPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/reports/balance-sheet"
          element={
            <ProtectedRoute>
              <BalanceSheetPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/reports/cash-flow-statement"
          element={
            <ProtectedRoute>
              <CashFlowStatementPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/reports/cash-flow"
          element={
            <ProtectedRoute>
              <CashFlowReport />
            </ProtectedRoute>
          }
        />
        <Route
          path="/reports/per-truck-cpm"
          element={
            <ProtectedRoute>
              <PerTruckCpmReport />
            </ProtectedRoute>
          }
        />
        <Route
          path="/reports/cash-flow-overview"
          element={
            <ProtectedRoute>
              <CashFlowOverviewPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/reports/settlement-summary"
          element={
            <ProtectedRoute>
              <SettlementSummaryPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/reports/customer-profitability"
          element={
            <ProtectedRoute>
              <CustomerProfitabilityPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/reports/profit-per-truck"
          element={
            <ProtectedRoute>
              <ProfitPerTruckPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/reports/lane-profitability"
          element={
            <ProtectedRoute>
              <LaneProfitabilityPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/reports/cancellations"
          element={
            <ProtectedRoute>
              <CancellationsReportPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/reports/driver-qualification"
          element={
            <ProtectedRoute>
              <DriverQualificationReportPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/reports/invoice-search"
          element={
            <ProtectedRoute>
              <InvoiceSearchReportPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/reports/late-arrival"
          element={
            <ProtectedRoute>
              <LateArrivalReport />
            </ProtectedRoute>
          }
        />
        <Route
          path="/dispatch/trip-profitability"
          element={
            <ProtectedRoute>
              <TripProfitabilityPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/reports/trip-profitability"
          element={
            <ProtectedRoute>
              <TripProfitabilityPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/qbo/sync-dashboard"
          element={
            <ProtectedRoute>
              <QboSyncDetailPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/reports/fuel-reconciliation"
          element={
            <ProtectedRoute>
              <FuelReconciliationPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/reports/maintenance-cost-per-unit"
          element={
            <ProtectedRoute>
              <MaintenanceCostPerUnitPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/reports/dispatch-margin"
          element={
            <ProtectedRoute>
              <DispatchMarginPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/reports/geofence-dwell"
          element={
            <ProtectedRoute>
              <GeofenceDwellReport />
            </ProtectedRoute>
          }
        />
        <Route
          path="/reports/geofence-reconciliation"
          element={
            <ProtectedRoute>
              <GeofenceReconciliationReport />
            </ProtectedRoute>
          }
        />
        <Route
          path="/reports/booking-gap"
          element={
            <ProtectedRoute>
              <BookingGapReport />
            </ProtectedRoute>
          }
        />
        <Route
          path="/reports/deadhead"
          element={
            <ProtectedRoute>
              <DeadheadReportPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/reports/posted-while-tour-open"
          element={
            <ProtectedRoute>
              <PostedWhileTourOpenReportPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/reports/scheduled"
          element={
            <ProtectedRoute>
              <SubscriptionManager />
            </ProtectedRoute>
          }
        />
        <Route
          path="/reports/scheduled-custom"
          element={
            <ProtectedRoute>
              <ScheduledReportsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/reports/hub"
          element={
            <ProtectedRoute>
              <ReportsHubPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/reports/categories/ops-dispatch"
          element={
            <ProtectedRoute>
              <OpsDispatchCategoryPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/reports/categories/driver-perf"
          element={
            <ProtectedRoute>
              <DriverPerfCategoryPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/reports/categories/equipment"
          element={
            <ProtectedRoute>
              <EquipmentCategoryPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/reports/categories/safety"
          element={
            <ProtectedRoute>
              <SafetyCategoryPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/reports/categories/customers"
          element={
            <ProtectedRoute>
              <CustomersCategoryPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/reports/categories/vendors"
          element={
            <ProtectedRoute>
              <VendorsCategoryPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/reports/categories/accounting"
          element={
            <ProtectedRoute>
              <AccountingCategoryPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/reports/categories/tax-reg"
          element={
            <ProtectedRoute>
              <TaxRegCategoryPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/reports/categories/multi-company"
          element={
            <ProtectedRoute>
              <MultiCompanyCategoryPage />
            </ProtectedRoute>
          }
        />
        <Route path="/reports/audit/activity-by-user" element={<OwnerAdminRoute><AuditActivityByUserPage /></OwnerAdminRoute>} />
        <Route path="/reports/audit/activity-by-module" element={<OwnerAdminRoute><AuditActivityByModulePage /></OwnerAdminRoute>} />
        <Route path="/reports/audit/financial-change-log" element={<OwnerAdminRoute><AuditFinancialChangeLogPage /></OwnerAdminRoute>} />
        <Route path="/reports/audit/maintenance-decision-log" element={<OwnerAdminRoute><AuditMaintenanceDecisionLogPage /></OwnerAdminRoute>} />
        <Route path="/reports/audit/deduction-trail" element={<OwnerAdminRoute><AuditDeductionTrailPage /></OwnerAdminRoute>} />
        <Route path="/reports/audit/void-reversal" element={<OwnerAdminRoute><AuditVoidReversalPage /></OwnerAdminRoute>} />
        <Route path="/reports/audit/period-close-history" element={<OwnerAdminRoute><AuditPeriodCloseHistoryPage /></OwnerAdminRoute>} />
        <Route
          path="/legal"
          element={
            <OwnerAdminRoute>
              <LegalLandingPage />
            </OwnerAdminRoute>
          }
        />
        <Route
          path="/legal/contracts"
          element={
            <OwnerAdminRoute>
              <LegalContractInstancesPage />
            </OwnerAdminRoute>
          }
        />
        <Route
          path="/legal/templates"
          element={
            <OwnerAdminRoute>
              <LegalTemplatesListPage />
            </OwnerAdminRoute>
          }
        />
        <Route
          path="/legal/templates/:id"
          element={
            <OwnerAdminRoute>
              <LegalTemplateDetailPage />
            </OwnerAdminRoute>
          }
        />
        <Route
          path="/legal/policies"
          element={
            <OwnerAdminRoute>
              <LegalPoliciesPage />
            </OwnerAdminRoute>
          }
        />
        <Route
          path="/legal/matters"
          element={
            <ProtectedRoute>
              <LegalMattersListPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/legal/matters/new"
          element={
            <ProtectedRoute>
              <LegalMatterNewPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/legal/matters/:id"
          element={
            <ProtectedRoute>
              <LegalMatterDetailPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/legal/reports"
          element={
            <ProtectedRoute>
              <LegalReportsLandingPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/legal/attorney-review"
          element={
            <OwnerAdminRoute>
              <LegalAttorneyReviewPage />
            </OwnerAdminRoute>
          }
        />
        <Route
          path="/admin"
          element={
            <OwnerAdminRoute>
              <AdminPage />
            </OwnerAdminRoute>
          }
        />
        <Route
          path="/admin/usmca-activation"
          element={
            <OwnerOnlyRoute>
              <USMCAActivationPanel />
            </OwnerOnlyRoute>
          }
        />
        <Route
          path="/admin/data-import"
          element={
            <OwnerAdminRoute>
              <DataImportPage />
            </OwnerAdminRoute>
          }
        />
        <Route
          path="/admin/carrier-bootstrap"
          element={
            <OwnerAdminRoute>
              <CarrierBootstrapPage />
            </OwnerAdminRoute>
          }
        />
        <Route
          path="/admin/launch-toggles"
          element={
            <OwnerAdminRoute>
              <LaunchTogglesPage />
            </OwnerAdminRoute>
          }
        />
        <Route
          path="/admin/feature-flags"
          element={
            <OwnerAdminRoute>
              <FeatureFlagsManager />
            </OwnerAdminRoute>
          }
        />
        <Route
          path="/admin/forensic-review"
          element={
            <OwnerAdminRoute>
              <ForensicReviewPage />
            </OwnerAdminRoute>
          }
        />
        <Route
          path="/admin/activity"
          element={
            <OwnerSuperAdminRoute>
              <ActivityLogPage />
            </OwnerSuperAdminRoute>
          }
        />
        <Route
          path="/admin/audit-events"
          element={
            <OwnerSuperAdminRoute>
              <AuditEventsList />
            </OwnerSuperAdminRoute>
          }
        />
        <Route
          path="/admin/audit-log"
          element={
            <OwnerSuperAdminRoute>
              <AuditLogViewer />
            </OwnerSuperAdminRoute>
          }
        />
        <Route
          path="/audit/trail"
          element={
            <OwnerSuperAdminRoute>
              <AuditTrailPage />
            </OwnerSuperAdminRoute>
          }
        />
        <Route
          path="/admin/migration-status"
          element={
            <OwnerOnlyRoute>
              <MigrationStatusPage />
            </OwnerOnlyRoute>
          }
        />
        <Route
          path="/admin/error-monitor"
          element={
            <OwnerOnlyRoute>
              <ErrorMonitorPage />
            </OwnerOnlyRoute>
          }
        />
        <Route
          path="/admin/observability"
          element={
            <OwnerAdminRoute>
              <ObservabilityPage />
            </OwnerAdminRoute>
          }
        />
        <Route
          path="/admin/integrity"
          element={
            <OwnerOnlyRoute>
              <IntegrityAdminPage />
            </OwnerOnlyRoute>
          }
        />
        <Route
          path="/admin/launch-readiness"
          element={
            <OwnerAdminRoute>
              <LaunchReadinessPage />
            </OwnerAdminRoute>
          }
        />
        <Route
          path="/admin/qbo-vendor-linkage"
          element={
            <OwnerAdminRoute>
              <QboVendorLinkagePage />
            </OwnerAdminRoute>
          }
        />
        <Route
          path="/admin/mobile-audit"
          element={
            <OwnerAdminRoute>
              <MobileAuditReport />
            </OwnerAdminRoute>
          }
        />
        <Route
          path="/accounting"
          element={
            <ProtectedRoute>
              <AccountingHubPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/accounting/load-costs"
          element={
            <ProtectedRoute>
              <LoadCostsBoardPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/accounting/load-costs/:loadId"
          element={
            <ProtectedRoute>
              <LoadCostsLoadPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/accounting/vendors"
          element={
            <ProtectedRoute>
              <Navigate to="/vendors" replace />
            </ProtectedRoute>
          }
        />
        <Route
          path="/accounting/customers"
          element={
            <ProtectedRoute>
              <Navigate to="/customers" replace />
            </ProtectedRoute>
          }
        />
        <Route
          path="/accounting/reports"
          element={
            <ProtectedRoute>
              <Navigate to="/reports" replace />
            </ProtectedRoute>
          }
        />
        <Route
          path="/accounting/maintenance-shop"
          element={
            <ProtectedRoute>
              <MaintenanceShopHubPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/accounting/invoices"
          element={
            <ProtectedRoute>
              <InvoicesListPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/accounting/transactions"
          element={
            <ProtectedRoute>
              <TransactionRegisterPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/accounting/multi-entity"
          element={
            <ProtectedRoute>
              <MultiEntityAccountingPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/accounting/dispute-queue"
          element={
            <ProtectedRoute>
              <DisputeQueuePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/accounting/abandonment-queue"
          element={
            <ProtectedRoute>
              <AbandonmentQueuePage />
            </ProtectedRoute>
          }
        />
        {/* Loans & Advances register + 5-step application wizard. The data model, routes, poster,
            auto-deduct and reminder worker already shipped; this route is the first frontend door. */}
        <Route
          path="/accounting/loans-advances"
          element={
            <ProtectedRoute>
              <LoansAdvancesPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/accounting/invoices/:id"
          element={
            <ProtectedRoute>
              <InvoiceDetailPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/accounting/payments"
          element={
            <ProtectedRoute>
              <PaymentsListPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/accounting/payments/:id"
          element={
            <ProtectedRoute>
              <PaymentDetailPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/accounting/factoring"
          element={
            <ProtectedRoute>
              <FactoringListPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/accounting/factoring/:id"
          element={
            <ProtectedRoute>
              <FactoringDetailPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/accounting/factor-reconciliation"
          element={
            <ProtectedRoute>
              <FactorReconciliationPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/accounting/reconciliation"
          element={
            <ProtectedRoute>
              <AccountingReconciliationWorkspacePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/accounting/daily-recon"
          element={
            <ProtectedRoute>
              <DailyReconPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/accounting/qbo-reconciliation"
          element={
            <ProtectedRoute>
              <QboReconciliationPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/accounting/opening-balance-register"
          element={
            <ProtectedRoute>
              <OpeningBalanceRegisterPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/accounting/sales-tax"
          element={
            <ProtectedRoute>
              <SalesTaxPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/accounting/month-close"
          element={
            <ProtectedRoute>
              <MonthClosePage />
            </ProtectedRoute>
          }
        />
        {/* DUALPATH-09 (2026-07-22): IH35_ARCHITECTURAL_DESIGN.md tab "Period Close" — operators and
            deep links expect /accounting/period-close while the Live wizard is MonthClosePage at
            /accounting/month-close. Redirect the alias; never delete the canonical mount (Rule 07). */}
        <Route
          path="/accounting/period-close"
          element={<Navigate to="/accounting/month-close" replace />}
        />
        <Route
          path="/accounting/audit-trail"
          element={
            <ProtectedRoute>
              <AccountingAuditTrailPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/accounting/proof-trail"
          element={
            <ProtectedRoute>
              <MoneyProofTrailPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/accounting/proof-trail/:documentType/:id"
          element={
            <ProtectedRoute>
              <MoneyProofTrailPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/accounting/posting-lineage"
          element={
            <ProtectedRoute>
              <PostingLineagePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/accounting/escrow"
          element={
            <ProtectedRoute>
              <EscrowPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/accounting/cash-forecast"
          element={
            <ProtectedRoute>
              <CashForecastPage />
            </ProtectedRoute>
          }
        />
        <Route
          path={COLLECTIONS_ROUTE.path}
          element={
            <ProtectedRoute>
              {COLLECTIONS_ROUTE.component}
            </ProtectedRoute>
          }
        />
        <Route
          path="/accounting/accounts-payable"
          element={
            <ProtectedRoute>
              {AP_AGING_ROUTE.component}
            </ProtectedRoute>
          }
        />
        <Route
          path="/dispatch/trip-pairing"
          element={
            <ProtectedRoute>
              {TRIP_PAIRING_BOARD_ROUTE.component}
            </ProtectedRoute>
          }
        />
        <Route
          path="/accounting/period-comparison"
          element={
            <ProtectedRoute>
              <PeriodComparisonPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/accounting/pre-settlements"
          element={
            <ProtectedRoute>
              <AccountingPreSettlementsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/accounting/payroll"
          element={
            <ProtectedRoute>
              <PayrollAggregatedPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/accounting/bills"
          element={
            <ProtectedRoute>
              <BillsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/accounting/bills/maintenance"
          element={
            <ProtectedRoute>
              <Navigate to="/accounting/bills?category=maintenance&create=1" replace />
            </ProtectedRoute>
          }
        />
        <Route
          path="/accounting/bills/repair"
          element={
            <ProtectedRoute>
              <Navigate to="/accounting/bills?category=repair&create=1" replace />
            </ProtectedRoute>
          }
        />
        <Route
          path="/accounting/bills/fuel"
          element={
            <ProtectedRoute>
              <Navigate to="/accounting/bills?category=fuel&create=1" replace />
            </ProtectedRoute>
          }
        />
        <Route
          path="/accounting/bills/driver"
          element={
            <ProtectedRoute>
              <Navigate to="/accounting/bills?category=driver&create=1" replace />
            </ProtectedRoute>
          }
        />
        <Route
          path="/accounting/bills/vendor"
          element={
            <ProtectedRoute>
              <VendorBillCreatePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/accounting/bills/multiple"
          element={
            <ProtectedRoute>
              <CreateMultipleBillsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/accounting/bills/recurring"
          element={
            <ProtectedRoute>
              <RecurringBillList />
            </ProtectedRoute>
          }
        />
        <Route
          path="/accounting/bills/recurring/create"
          element={
            <ProtectedRoute>
              <RecurringBillCreate />
            </ProtectedRoute>
          }
        />
        <Route
          path="/accounting/bills/:id"
          element={
            <ProtectedRoute>
              <BillDetailPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/accounting/expenses/new"
          element={
            <ProtectedRoute>
              <ExpenseCreatePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/accounting/expenses/list"
          element={
            <ProtectedRoute>
              <ExpensesListPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/accounting/expenses/:id"
          element={
            <ProtectedRoute>
              <ExpenseDetailPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/accounting/expenses"
          element={
            <ProtectedRoute>
              <ExpensesListPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/accounting/vendor-balances"
          element={
            <ProtectedRoute>
              <VendorBalancesPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/accounting/vendor-credits"
          element={
            <ProtectedRoute>
              <VendorCreditsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/accounting/credit-memos"
          element={
            <ProtectedRoute>
              <CreditMemosPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/accounting/journal-entries"
          element={
            <ProtectedRoute>
              <ManualJEListPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/accounting/account-register"
          element={
            <ProtectedRoute>
              <AccountRegisterPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/accounting/chart-of-accounts"
          element={
            <ProtectedRoute>
              <Navigate to="/lists/accounting/chart-of-accounts" replace />
            </ProtectedRoute>
          }
        />
        <Route
          path="/accounting/chart-of-accounts/register/:accountId"
          element={
            <ProtectedRoute>
              <AccountRegisterPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/accounting/journal-entries/:id"
          element={
            <ProtectedRoute>
              <JournalEntryDetailPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/accounting/settings/expense-category-map"
          element={
            <ProtectedRoute>
              <ExpenseCategoryMapPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/accounting/settings/coa-roles"
          element={
            <ProtectedRoute>
              <CoaRolesPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/accounting/bill-payments"
          element={
            <ProtectedRoute>
              <BillPaymentsListPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/accounting/bill-payments/:id"
          element={
            <ProtectedRoute>
              <BillPaymentDetailPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/accounting/qbo-sync"
          element={
            <ProtectedRoute>
              <QBOSyncDriftDashboard />
            </ProtectedRoute>
          }
        />
        <Route path="/safety/accidents-incidents" element={<Navigate replace to="/safety/accidents" />} />
        {/* DUALPATH-08 (2026-07-22): "/accounting/recurring-transactions" was a dead-end ComingSoon
            mount while the Live surface already existed at /accounting/bills/recurring
            (RecurringBillList). Active-path law (same pattern as Safety #3183): redirect the alias
            to the canonical Live tab instead of rendering a stub. ARCHIVE-not-DELETE — the Live
            route below is untouched; only this alias's element changes. */}
        <Route
          path="/accounting/recurring-transactions"
          element={<Navigate to="/accounting/bills/recurring" replace />}
        />
        {/* UI-1: 6/6 modules built (prepaid, integration-transactions, receipts, revenue-recognition, fixed-assets, my-accountant). */}
        <Route path="/accounting/integration-transactions" element={<ProtectedRoute><IntegrationTransactionsPage /></ProtectedRoute>} />
        <Route path="/accounting/receipts" element={<ProtectedRoute><ReceiptsPage /></ProtectedRoute>} />
        <Route path="/accounting/undeposited-funds" element={<ProtectedRoute><UndepositedFundsPage /></ProtectedRoute>} />
        <Route path="/accounting/revenue-recognition" element={<ProtectedRoute><RevenueRecognitionPage /></ProtectedRoute>} />
        <Route path="/accounting/fixed-assets" element={<ProtectedRoute><FixedAssetsPage /></ProtectedRoute>} />
        <Route path="/accounting/leases/:id" element={<ProtectedRoute><AccountingLeaseDetailPage /></ProtectedRoute>} />
        <Route path="/accounting/recurring-templates/:id" element={<ProtectedRoute><AccountingRecurringTemplateDetailPage /></ProtectedRoute>} />
        <Route path="/accounting/period-closes/:fiscalYearId" element={<ProtectedRoute><AccountingPeriodCloseDetailPage /></ProtectedRoute>} />
        <Route path="/accounting/schedule-rows/:kind/:id" element={<ProtectedRoute><AccountingScheduleRowDetailPage /></ProtectedRoute>} />
        <Route path="/accounting/driver-reimbursements/:id" element={<ProtectedRoute><AccountingDriverReimbursementDetailPage /></ProtectedRoute>} />
        {/* Accounting PR 3/6 — FH-7 §3.14 Allocations tab: read-only rollup of bill_unit_allocation. */}
        <Route path="/accounting/allocations" element={<ProtectedRoute><AllocationsPage /></ProtectedRoute>} />
        {/* FIN-23 — QBO reconcile / modify captures (read-only, behind QBO_RECONCILE_UI_ENABLED). */}
        <Route path="/accounting/qbo-reconcile" element={<ProtectedRoute><QboReconcileCapturesPage /></ProtectedRoute>} />
        <Route path="/accounting/prepaid-expenses" element={<ProtectedRoute><PrepaidExpensesPage /></ProtectedRoute>} />
        <Route path="/accounting/account-type-catalog" element={<ProtectedRoute><AccountTypeCatalogPage /></ProtectedRoute>} />
        <Route path="/accounting/my-accountant" element={<ProtectedRoute><MyAccountantPage /></ProtectedRoute>} />
        <Route path="/accounting/payment-methods-catalog" element={<ProtectedRoute><PaymentMethodsCatalogPage /></ProtectedRoute>} />
        <Route
          path="/reports/run/:reportId"
          element={
            <ProtectedRoute>
              <ReportsRunnerPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/driver-app"
          element={
            <ProtectedRoute>
              <DriverAppLandingPage />
            </ProtectedRoute>
          }
        />
        <Route path="/pwa/fuel-receipt" element={<DriverShell />}>
          <Route index element={<FuelReceiptPage />} />
        </Route>
        <Route path="/driver/login" element={<DriverLoginPage />} />
        <Route path="/driver" element={<DriverShell />}>
          <Route index element={<Navigate to="loads" replace />} />
          <Route path="loads" element={<DriverLoadsPage />} />
          <Route path="loads/:id" element={<DriverLoadDetailPage />} />
          <Route path="hos" element={<DriverHosPage />} />
          <Route path="disputes" element={<DisputesPage />} />
          <Route path="settings" element={<DriverSettingsPage />} />
        </Route>
        <Route
          path="/catalogs/equipment-types"
          element={
            <ProtectedRoute>
              <EquipmentTypesPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/catalogs/driver-load-statuses"
          element={
            <ProtectedRoute>
              <DriverLoadStatusesPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/catalogs/accounts"
          element={
            <ProtectedRoute>
              <Navigate to="/lists/accounting/chart-of-accounts" replace />
            </ProtectedRoute>
          }
        />
        <Route
          path="/catalogs/classes"
          element={
            <ProtectedRoute>
              <Navigate to="/lists/accounting/classes" replace />
            </ProtectedRoute>
          }
        />
        <Route
          path="/catalogs/items"
          element={
            <ProtectedRoute>
              <Navigate to="/lists/accounting/items" replace />
            </ProtectedRoute>
          }
        />
        <Route
          path="/catalogs/payment-terms"
          element={
            <ProtectedRoute>
              <Navigate to="/lists/accounting/payment-terms" replace />
            </ProtectedRoute>
          }
        />
        <Route
          path="/catalogs/posting-templates"
          element={
            <ProtectedRoute>
              <Navigate to="/lists/accounting/posting-templates" replace />
            </ProtectedRoute>
          }
        />
        <Route
          path="/catalogs/account-role-bindings"
          element={
            <ProtectedRoute>
              <Navigate to="/lists/accounting/account-role-bindings" replace />
            </ProtectedRoute>
          }
        />
        <Route
          path="/drivers/onboarding/:session_id"
          element={
            <ProtectedRoute>
              <OnboardingWizardPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/drivers/:id"
          element={
            <ProtectedRoute>
              <DriverDetailPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/drivers/applicants"
          element={
            <ProtectedRoute>
              <ApplicantsPipelinePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/drivers/messages"
          element={
            <ProtectedRoute>
              <MessagesInboxPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/drivers/retention"
          element={
            <ProtectedRoute>
              <RetentionDashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/drivers/alerts"
          element={
            <ProtectedRoute>
              <DocumentAlertsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/drivers/:id/profile"
          element={
            <ProtectedRoute>
              <DriverProfilePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/drivers/:id/hos"
          element={
            <ProtectedRoute>
              <DriverHosDetailPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/fleet/transfers-in-progress"
          element={
            <ProtectedRoute>
              <TransfersInProgressPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/fleet"
          element={
            <ProtectedRoute>
              <FleetHomePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/fleet/units/:id"
          element={
            <ProtectedRoute>
              <VehicleProfilePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/fleet/units/:id/detail"
          element={
            <ProtectedRoute>
              <UnitDetail />
            </ProtectedRoute>
          }
        />
        <Route
          path="/fleet/trailers/:id"
          element={
            <ProtectedRoute>
              <TrailerProfilePage />
            </ProtectedRoute>
          }
        />
        {/* Legacy dead hrefs from driver profile / bookmarks — preserve query (driver, load_id). */}
        <Route
          path="/fleet/map"
          element={
            <ProtectedRoute>
              <PreserveSearchNavigate to="/dispatch/map" />
            </ProtectedRoute>
          }
        />
        <Route
          path="/fleet/:id"
          element={
            <ProtectedRoute>
              <FleetUnitLegacyRedirect />
            </ProtectedRoute>
          }
        />
        <Route
          path="/loads/:id"
          element={
            <ProtectedRoute>
              <DispatchLoadLegacyPathRedirect />
            </ProtectedRoute>
          }
        />
        <Route
          path="/dev/bulk-demo"
          element={
            <ProtectedRoute>
              <BulkDemoPage />
            </ProtectedRoute>
          }
        />
        {/* Tasks module (SIDEBAR-V2-REORG-25) */}
        <Route path="/tasks" element={<ProtectedRoute><TaskBoardPage /></ProtectedRoute>} />
        <Route path="/tasks/calendar" element={<ProtectedRoute><TasksCalendarPage /></ProtectedRoute>} />
        <Route path="/tasks/mine" element={<ProtectedRoute><TasksMinePage /></ProtectedRoute>} />
        <Route path="/tasks/chat" element={<ProtectedRoute><TasksChatPage /></ProtectedRoute>} />
        <Route path="/dispatch/chat" element={<ProtectedRoute><DispatchChatPage /></ProtectedRoute>} />
        <Route path="/tasks/report" element={<ProtectedRoute><TasksReportPage /></ProtectedRoute>} />
        {/* Finance module (SIDEBAR-V2-REORG-25) */}
        {/* FIN-2 — canonical Finance entry mounts the real read-only Hub. The placeholder Overview remains
            reachable at /finance/overview, and /finance/hub remains mounted as an additive legacy alias. */}
        <Route path="/finance" element={<ProtectedRoute><FinanceHubPage /></ProtectedRoute>} />
        <Route path="/finance/overview" element={<ProtectedRoute><FinanceOverviewPage /></ProtectedRoute>} />
        <Route path="/finance/projections" element={<ProtectedRoute><FinanceProjectionsPage /></ProtectedRoute>} />
        <Route path="/finance/scenarios" element={<ProtectedRoute><FinanceScenariosPage /></ProtectedRoute>} />
        <Route path="/finance/scenarios/:scenarioId" element={<ProtectedRoute><FinanceScenarioDetailPage /></ProtectedRoute>} />
        <Route path="/finance/loan-wizard" element={<ProtectedRoute><LoanWizardPage /></ProtectedRoute>} />
        <Route path="/finance/calculator" element={<ProtectedRoute><CalculatorPage /></ProtectedRoute>} />
        <Route path="/finance/amortization" element={<ProtectedRoute><AmortizationPage /></ProtectedRoute>} />
        <Route path="/finance/ar-ap-aging" element={<ProtectedRoute><ArApAgingPage /></ProtectedRoute>} />
        {/* FIN-19 — Financial statements (P&L / BS / TB). flag FINANCE_STATEMENTS_UI_ENABLED — default_enabled=true in lib.feature_flags (resolves ON unless a per-entity/user override disables it); read-only, no money posting. */}
        <Route path="/finance/statements" element={<ProtectedRoute><FinancialStatementsPage /></ProtectedRoute>} />
        {/* AF-6 — Finance Hub landing dashboard. flag FINANCE_HUB_UI_ENABLED in lib.feature_flags — default OFF, per-entity-only (owner enables per operating company via override); same DB flag gates the backend via isEnabled; read-only, no money posting. */}
        <Route path="/finance/hub" element={<ProtectedRoute><FinanceHubPage /></ProtectedRoute>} />
        {/* F1 — Break-Even Analysis. flag FINANCE_BREAK_EVEN_UI_ENABLED (OFF by default — owner sign-off gate); read-only analytics/estimate, no money posting. */}
        <Route path="/finance/break-even" element={<ProtectedRoute><BreakEvenPage /></ProtectedRoute>} />
        {/* Inventory module (SIDEBAR-V2-REORG-25) */}
        <Route path="/inventory" element={<ProtectedRoute><InventoryPartsStockPage /></ProtectedRoute>} />
        <Route path="/inventory/assignments" element={<ProtectedRoute><InventoryAssignmentsPage /></ProtectedRoute>} />
        <Route path="/inventory/purchases" element={<ProtectedRoute><InventoryPurchasesPage /></ProtectedRoute>} />
        {/* SYS-04 (Wave 2) — restore broken routes that silently redirected to Home via the
            catch-all below. Each maps a legacy/alternate URL to its already-registered canonical
            page instead of falling through to `Navigate to="/"`. Additive redirect aliases only —
            no existing route touched. Guarded by scripts/verify-broken-routes-restored.mjs. */}
        <Route path="/accounting/ap-aging" element={<ProtectedRoute><Navigate to="/accounting/accounts-payable" replace /></ProtectedRoute>} />
        <Route path="/accounting/all-transactions" element={<ProtectedRoute><Navigate to="/accounting/transactions" replace /></ProtectedRoute>} />
        <Route path="/accounting/receive-payment" element={<ProtectedRoute><Navigate to="/accounting/payments" replace /></ProtectedRoute>} />
        <Route path="/accounting/bill-payment" element={<ProtectedRoute><Navigate to="/accounting/bill-payments" replace /></ProtectedRoute>} />
        <Route path="/settlements" element={<ProtectedRoute><PreserveSearchNavigate to="/driver-finance/settlements" /></ProtectedRoute>} />
        {/* CHAIN-07 — the accounting "Settlements" surface is redirected to the single canonical
            driver-finance settlements subledger. The legacy accounting/settlement.* duplicate ledger
            is RETIRED (see apps/backend/src/settlements/pre-settlements.routes.ts). Single-subledger
            rule (QBO/NetSuite/McLeod/Alvys): never resurrect a 2nd settlement ledger.
            Guarded by scripts/verify-chain07-settlements-redirect.mjs.
            PreserveSearchNavigate keeps driver_id / settlement_id (LAW — never drop deep-link params). */}
        <Route path="/accounting/settlements" element={<ProtectedRoute><PreserveSearchNavigate to="/driver-finance/settlements" /></ProtectedRoute>} />
        <Route path="/finance-hub" element={<ProtectedRoute><Navigate to="/finance/hub" replace /></ProtectedRoute>} />
        {/* PROGRAM-CARD-FALSE-GREEN-b711699 — guessed Complete-card URLs were catch-all → Home (or last Program). Canonical redirects only. */}
        <Route path="/finance/cash-flow" element={<ProtectedRoute><Navigate to="/cash-flow" replace /></ProtectedRoute>} />
        <Route path="/dispatch/assign-equipment" element={<ProtectedRoute><Navigate to="/dispatch/assignments" replace /></ProtectedRoute>} />
        <Route path="/dispatch/deliveries" element={<ProtectedRoute><Navigate to="/dispatch/loads?view=kanban" replace /></ProtectedRoute>} />
        <Route path="/dispatch/build-trip" element={<ProtectedRoute><Navigate to="/dispatch/trip-pairing" replace /></ProtectedRoute>} />
        <Route path="/api/*" element={<ApiDocumentPassthrough />} />
        <Route path="*" element={<Navigate to="/" replace />} />
        <Route path="/insurance" element={<Navigate to="/safety/insurance" replace />} />
  </>
) as React.ReactElement[];
