import type { MouseEvent, ReactNode } from "react";
import { Link } from "react-router-dom";

/**
 * EntityLink — the shared drill-through primitive for total-connectivity (LAW OF THE LAND).
 *
 * Renders an entity id as a clickable link to that entity's real detail route, or as plain
 * text when no per-id detail route exists yet (never fabricates a route — see the resolver
 * comments below for the exact gaps, verified against routes/manifest.tsx).
 *
 * This consolidates the drill-through pattern already used (inconsistently, and in a few
 * places incorrectly — e.g. IntegrationTransactionsPage linking to a nonexistent
 * /accounting/bills/:id, and AuditTrailPage's sourceLink doing the same) across
 * AccountsPayableAgingPage, AccountRegisterPage, VendorsListView, CustomersListView,
 * DriversTable, and others: a react-router `<Link>` styled `text-slate-700 hover:underline`
 * (the locked §7 slate token, apps/frontend/src/design/tokens.ts).
 */

export type EntityKind =
  | "load"
  | "bill"
  | "invoice"
  | "settlement"
  | "journal_entry"
  | "vendor"
  | "customer"
  | "unit"
  | "driver"
  | "trailer"
  | "expense"
  | "liability"
  | "bank_account"
  | "factoring_advance"
  | "factoring_batch"
  | "payment"
  | "bill_payment"
  // S.1b/L5 (2026-09-05): settlement earnings/deadhead lines' source driver bill
  // (driver_finance.driver_bills) — a DIFFERENT table from accounting.bills (see
  // driver-finance-driver-bills-not-accounting-bills landmine: kind="bill" 404s here). No dedicated
  // driver_bills/:id detail page/route exists yet — falls through to the resolver's own documented
  // default (plain text, never a fabricated route), same as every other not-yet-linked kind.
  | "driver_bill"
  | "transfer"
  | "work_order"
  | "bank_transaction"
  | "claim"
  | "lawsuit"
  | "matter"
  | "cash_advance"
  | "cash_advance_request"
  | "account"
  | "prepaid_asset"
  | "sales_tax_return"
  | "fixed_asset"
  | "finance_loan"
  | "lease_contract"
  | "recurring_template"
  | "period_close"
  | "prepaid_amortization_row"
  | "depreciation_schedule_row"
  | "loan_amortization_row"
  | "insurance_policy"
  | "dvir"
  | "maintenance_inspection"
  | "warranty_claim"
  // LINK-F5171: DVIR defect inbox "Detail" used a bare Link; kind resolves to the mounted
  // /maintenance/defects/:defectId surface (routes/manifest.tsx).
  | "maintenance_defect"
  // LINK-F5171: property-tax list/unit reverse used bare Links; kind resolves to
  // /compliance/property-tax/:id (routes/manifest.tsx).
  | "property_tax_rendition"
  // LINK-F5171: applicants pipeline "Open onboarding wizard" used a bare Link; kind resolves to
  // /drivers/onboarding/:session_id (routes/manifest.tsx).
  | "onboarding_session"
  // LINK-F5171: photo-comparison + leave-request inboxes used bare Links; kinds resolve to
  // /safety/photo-comparison/:sessionUuid and /safety/scheduler/requests/:id.
  | "photo_comparison_session"
  | "scheduler_request"
  // LINK-F5171: contract detail Template used a bare Link; kind resolves to /legal/templates/:id.
  | "legal_template"
  // LINK-F5171 / SAF-F22: "Open Safety Profile" is a distinct surface from kind=driver
  // (/drivers/:id). Resolves to /safety/driver-profiles/:driverId.
  | "driver_safety_profile"
  // LINK-F5171: Reports Hub category headings used bare Links to /reports/categories/:id.
  | "report_category"
  // LINK-F5171: Driver profile "View history" used a bare Link to the per-driver layover
  // surface (/dispatch/layovers/driver/:driverId) — distinct from kind=driver.
  | "driver_layover_history"
  // LINK-F5171: Help center article slugs drill to /help/:slug (static content, not a DB row).
  | "help_article"
  // LINK-F5171: Ops work-orders console is /work-orders/:id — distinct from maintenance work_order.
  | "work_orders_console"
  // LINK-F5171: Driver-app load detail (/driver/loads/:id) ≠ office kind=load (/dispatch/loads/:id).
  | "driver_app_load"
  // LINK-F5171: Customer portal load detail (/portal/loads/:id) ≠ office kind=load.
  | "portal_load"
  // LINK-F5171: Road-service ticket reverse → /maintenance/road-service?ticket_id=
  | "road_service_ticket"
  // LINK-F5171: Form 2290 filing reverse → /compliance/form-2290?filing_id=
  | "form_2290_filing"
  | "border_crossing"
  | "fuel_card_overage_event"
  | "fuel_transaction"
  | "driver_reimbursement"
  | "driver_team_split"
  | "driver_report"
  // LINK-F5171: reverse "Open report queue" → filtered driver-reports list (not a single report row).
  | "driver_reports_driver"
  | "driver_reports_load"
  | "training_record"
  | "legal_contract"
  | "company_violation"
  | "integrity_alert"
  | "integrity_anomaly"
  | "factoring_queue_load"
  | "factoring_recourse_load"
  | "factoring_submit_queue_load"
  // LINK-F5171: customer/vendor reverse Open → filtered factoring queues.
  | "factoring_factors_customer"
  | "factoring_queue_customer"
  | "factoring_recourse_customer"
  | "factoring_chargebacks_customer"
  | "factoring_submit_queue_customer"
  | "equipment_loans_vendor"
  | "equipment_loan"
  | "equipment_transfer"
  // LINK-F5183: vendor-merges reverse Open → filtered Factoring Home tab.
  | "factoring_vendor_merges_driver"
  | "factoring_vendor_merges_vendor"
  | "load_template"
  | "cash_forecast_entry"
  // LINK-F5171: TasksTab drills chat by taskId (not a generic office entity).
  | "task"
  // LINK-F5171: Live GPS "View map" → /dispatch/map?load_id= (viewport, not kind=load).
  | "load_map"
  // LINK-F5171: VendorDetail credit # → exact vendor credit (not vendor filter).
  | "vendor_credit"
  // LINK-F5171: DriverTeamsReverseSection → lists driver team deep-link.
  | "driver_team"
  // LINK-F5171: EntityAuditHistoryTab action → exact audit trail event.
  | "audit_event"
  | "insurance_coverage_gaps"
  | "property_tax_unit"
  | "fault_drafts_unit"
  | "tire_program_equipment"
  | "driver_team_splits_filter"
  | "tire_program_unit"
  | "legal_contracts_vendor"
  | "legal_contracts_customer"
  | "unit_tires_tab"
  | "unit_brakes_tab"
  | "loads_driver_filter"
  | "unit_detail_finance"
  | "fuel_card_overage_driver"
  | "fuel_card_overage_unit"
  | "fuel_history_driver"
  | "fuel_history_unit"
  | "fuel_history_load"
  | "fuel_history_trailer"
  | "driver_deductions_filter"
  | "management_report_package"
  | "program_matrix_module"
  | "compliance_unit_overview"
  | "compliance_hos_driver"
  | "inventory_part"
  | "parts_inventory"
  | "catalog_item"
  | "maintenance_vendor"
  | "pm_schedule"
  | "safety_event"
  // LINK-F5171: reverse "Open Safety Events" / "Open Fines" → filtered list (not a single row).
  | "safety_events_driver"
  | "safety_events_unit"
  | "safety_events_load"
  | "insurance_policies_vendor"
  | "severe_repairs_unit"
  | "driver_scheduler_driver"
  | "driver_scheduler_unit"
  | "customer_notify_preferences"
  | "safety_fines_driver"
  | "safety_fines_load"
  | "safety_fines_unit"
  // LINK-F5171: reverse "Open Accidents" / "Open HOS" / "Open Internal Fines" → filtered list queues.
  | "accidents_load"
  | "accidents_driver"
  | "accidents_unit"
  | "accidents_trailer"
  | "hos_violations_load"
  | "hos_violations_driver"
  | "internal_fines_load"
  | "internal_fines_driver"
  // LINK-F5171: reverse "Open Damage/Interchange/Cargo" → filtered incident list queues.
  | "damage_reports_load"
  | "damage_reports_driver"
  | "damage_reports_unit"
  | "damage_reports_trailer"
  | "trailer_interchanges_load"
  | "trailer_interchanges_driver"
  | "trailer_interchanges_unit"
  | "trailer_interchanges_trailer"
  | "cargo_claims_load"
  | "cargo_claims_driver"
  | "cargo_claims_unit"
  | "cargo_claims_trailer"
  // LINK-F5171: reverse Open DOT / training / complaints / DVIR queues.
  | "dot_inspections_driver"
  | "dot_inspections_unit"
  | "dot_inspections_trailer"
  | "training_records_driver"
  | "complaints_driver"
  | "drug_alcohol_driver"
  | "dvir_unit"
  | "dvir_trailer"
  // LINK-F5171: driver profile "Open Disputes" → settlements disputes tab filtered by driver.
  | "settlement_disputes_driver"
  | "settlement_dispute"
  | "settlement_deduction"
  | "legal_matters_driver"
  | "legal_matters_unit"
  | "legal_matters_equipment"
  | "legal_matters_claim"
  | "legal_matters_lawsuit"
  | "insurance_claims_driver"
  | "insurance_claims_unit"
  | "insurance_claims_load"
  | "insurance_claims_trailer"
  | "active_wos_driver"
  | "active_wos_load"
  | "intransit_issues_load"
  | "intransit_issues_driver"
  | "intransit_issues_unit"
  // SAF-F33: safety records were undrillable — no module could link INTO an accident, fine,
  // complaint, DOT inspection, escrow record, or permit. These resolve to the record's list surface
  // with a query param the page honors (same drill pattern as claim/lawsuit/settlement).
  | "accident"
  | "safety_fine"
  | "internal_fine"
  | "complaint"
  | "hos_violation"
  | "dot_inspection"
  | "escrow_record"
  | "permit"
  // SAF-B30: the three safety-incident record types. F33 called this the "incident" slot, but a single
  // kind cannot resolve — an incident lives on one of THREE lists and the id alone does not say which.
  // Naming them by type keeps EntityLink's contract intact: every declared kind resolves to a real route.
  | "damage_report"
  | "trailer_interchange"
  | "cargo_claim"
  // USERS column-wave: no EntityKind existed for identity.users, so every "created by / updated
  // by / voided by / approved by" field across the app rendered as plain text — no drill-through
  // to the acting user's own profile at all. Route verified present in routes/manifest.tsx:
  // <Route path="/users/:id">.
  | "user"
  // LINK reverse_link: GeofenceBreachesTab (safety) displayed a geofence's label as dead text with
  // no way to reach the geofence record itself. GeofencesPage (operations, route verified present
  // in routes/manifest.tsx: <Route path="/dispatch/geofencing">) is the only geofence detail
  // surface; it has no per-id sub-route, so this resolves with a query param the page now honors —
  // same drill pattern as claim/lawsuit/settlement.
  | "geofence"
  | "document"
  // LINK reverse_link: ReserveDashboard/ReserveTracker rendered a reserve balance's factor as dead
  // text — no module could link INTO a factor record. FactorAdmin (route verified present in
  // routes/manifest.tsx: <Route path="/factoring/factors">) is the only factor detail surface; it
  // has no per-id sub-route, so this resolves with a query param the page now honors.
  | "factor"
  // ROUND 16.2 item 3 (owner 2026-09-06 20:3xZ) — TourSettlementTab's "Company settlement" line
  // rendered the display_id as dead text, same class as geofence/factor above. CompanySettlementsPage
  // (route verified present in routes/manifest.tsx: <Route path="/driver-finance/company-settlements">)
  // is the only company-settlement surface; it has no per-id sub-route, so this resolves with a
  // query param the page now honors (auto-opens that row's detail panel on load).
  | "company_settlement";

export interface EntityLinkProps {
  kind: EntityKind;
  id: string | null | undefined;
  /** Display text/content. Defaults to the raw id when omitted. */
  label?: ReactNode;
  className?: string;
  /**
   * Optional native title (tooltip) — required for §7 single-line ellipsis so hover still
   * reveals the full label when `className` includes `single-line-name`.
   */
  title?: string;
  /**
   * Optional click handler — passed through to the underlying <Link>. Used by parent rows that
   * also have their own onClick (e.g. a table row that opens a drawer): call
   * `event.stopPropagation()` here so the cell's drill-through link doesn't also fire the row
   * handler. No-op when the kind has no resolvable route (plain-text fallback).
   */
  onClick?: (event: MouseEvent<HTMLAnchorElement>) => void;
  /** Optional test hook, forwarded to the rendered <Link>/<span> as `data-testid`. */
  "data-testid"?: string;
}

const DEFAULT_LINK_CLASSNAME =
  "text-slate-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-1 rounded-sm";

/**
 * Resolves an entity kind + id to its real per-id detail route.
 *
 * Verified against apps/frontend/src/routes/manifest.tsx. Every declared EntityKind resolves —
 * never fabricate a dead link. Query-param drill-through kinds (settlement / liability /
 * claim / lawsuit / bank_transaction / cash_advance) require the target page to honor the param
 * (CI: verify-entitylink-deep-links, verify-legal-matter-lawsuit-linkage).
 * "payment" → /accounting/payments/:id · "bill_payment" → /accounting/bill-payments/:id
 * "transfer" → /banking/transfers?transfer_id= (TransfersListPage highlights row)
 * "work_order" → /maintenance/work-orders/:id
 * "bill" → /accounting/bills/:id · "expense" → /accounting/expenses/:id · "matter" → /legal/matters/:id
 * "lawsuit" → /safety/insurance/lawsuits?lawsuit_id= (LawsuitsTab selects+highlights the row)
 * "bank_transaction" → /banking/transactions?txn_id= (BankingHome expands row)
 */
export function resolveEntityRoute(kind: EntityKind, id: string): string | null {
  switch (kind) {
    case "load":
      return `/dispatch/loads/${id}`;
    case "bill":
      return `/accounting/bills/${id}`;
    // driver_bill is deliberately NOT routed here. ACCT-F5870: a same-day 4th-emergency
    // compile-error fix wrongly merged `case "bill": case "driver_bill":` sharing this route --
    // driver_finance.driver_bills (settlement_lines.source_driver_bill_id, S.1b/L5) is a DIFFERENT
    // table from accounting.bills with a disjoint id space (see the
    // driver-finance-driver-bills-not-accounting-bills landmine: kind="bill" 404s on a real
    // driver_finance.driver_bills id). No dedicated driver_bills/:id detail page/route exists yet --
    // falls through to `default: return null` below (plain text, never a fabricated/wrong route),
    // same as every other not-yet-linked kind.
    case "invoice":
      return `/accounting/invoices/${id}`;
    case "journal_entry":
      return `/accounting/journal-entries/${id}`;
    case "vendor":
      return `/vendors/${id}`;
    case "customer":
      return `/customers/${id}`;
    case "unit":
      return `/fleet/units/${id}`;
    case "driver":
      return `/drivers/${id}`;
    case "trailer":
      return `/fleet/trailers/${id}`;
    case "bank_account":
      return `/banking/accounts/${id}`;
    case "factoring_advance":
      return `/accounting/factoring/${id}`;
    case "factoring_batch":
      // LINK-F5178 (2026-08-14): a real batch id (factoring.batch.id — the row shown by FactorAdmin's
      // "Batch History" table) drills to /factoring/batches/:id (BatchDetail.tsx's getBatchDetail),
      // NOT /accounting/factoring/:id (accounting.factoring_advances.id — a different table/entity).
      // The batch table previously used kind="factoring_advance" for these rows, which pointed every
      // batch link at the wrong detail page.
      return `/factoring/batches/${id}`;
    case "payment":
      return `/accounting/payments/${id}`;
    case "bill_payment":
      return `/accounting/bill-payments/${id}`;
    case "transfer":
      return `/banking/transfers?transfer_id=${id}`;
    case "work_order":
      return `/maintenance/work-orders/${id}`;
    case "inventory_part":
      return `/inventory?part_id=${id}`;
    case "parts_inventory":
      return `/maintenance/parts-inventory?part_inventory_id=${id}`;
    case "catalog_item":
      return `/catalogs/items?item_id=${id}`;
    case "maintenance_vendor":
      return `/maintenance/vendors/${id}`;
    case "pm_schedule":
      return `/maintenance/pm-schedule?schedule_id=${id}`;
    case "settlement":
      return `/driver-finance/settlements?settlement_id=${id}`;
    case "settlement_disputes_driver":
      return `/driver-finance/settlements?tab=disputes&driver_id=${id}`;
    case "settlement_dispute":
      return `/driver-finance/settlements?tab=disputes&dispute_id=${id}`;
    case "settlement_deduction":
      return `/drivers/deductions?deduction_id=${id}`;
    case "liability":
      return `/liabilities?liability_id=${id}`;
    case "cash_advance":
      return `/cash-advances?advance_id=${id}`;
    case "cash_advance_request":
      return `/driver-finance/cash-advance-requests?request_id=${id}`;
    case "finance_loan":
      return `/finance/amortization?loan_id=${id}`;
    case "lease_contract":
      return `/accounting/leases/${id}`;
    case "recurring_template":
      return `/accounting/recurring-templates/${id}`;
    case "period_close":
      return `/accounting/period-closes/${encodeURIComponent(id)}`;
    case "prepaid_amortization_row":
    case "depreciation_schedule_row":
    case "loan_amortization_row":
      return `/accounting/schedule-rows/${kind}/${id}`;
    case "expense":
      return `/accounting/expenses/${id}`;
    case "bank_transaction":
      return `/banking/transactions?txn_id=${id}`;
    case "claim":
      return `/safety/insurance/claims?claim_id=${id}`;
    case "lawsuit":
      return `/safety/insurance/lawsuits?lawsuit_id=${id}`;
    case "matter":
      return `/legal/matters/${id}`;
    case "account":
      // GL account (catalogs.accounts) → its register. Route verified present in
      // routes/manifest.tsx: <Route path="/accounting/chart-of-accounts/register/:accountId">.
      // Law §9 requires every money row to drill forward to the GL account it posts to.
      return `/accounting/chart-of-accounts/register/${id}`;
    case "prepaid_asset":
      return `/accounting/prepaid-expenses?asset_id=${id}`;
    case "sales_tax_return":
      return `/accounting/sales-tax?return_id=${id}`;
    case "fixed_asset":
      return `/accounting/fixed-assets?asset_id=${id}`;
    case "insurance_policy":
      return `/safety/insurance/policies/${id}`;
    case "dvir":
      return `/safety/idvr/${id}`;
    case "maintenance_inspection":
      return `/maintenance/inspections?inspection_id=${id}`;
    case "warranty_claim":
      return `/maintenance/warranty-claims?claim_id=${id}`;
    case "maintenance_defect":
      return `/maintenance/defects/${id}`;
    case "property_tax_rendition":
      return `/compliance/property-tax/${id}`;
    case "onboarding_session":
      return `/drivers/onboarding/${id}`;
    case "photo_comparison_session":
      return `/safety/photo-comparison/${id}`;
    case "scheduler_request":
      return `/safety/scheduler/requests/${id}`;
    case "legal_template":
      return `/legal/templates/${id}`;
    case "driver_safety_profile":
      return `/safety/driver-profiles/${id}`;
    case "report_category":
      return `/reports/categories/${id}`;
    case "driver_layover_history":
      return `/dispatch/layovers/driver/${id}`;
    case "help_article":
      return `/help/${id}`;
    case "work_orders_console":
      return `/work-orders/${id}`;
    case "driver_app_load":
      return `/driver/loads/${id}`;
    case "portal_load":
      return `/portal/loads/${id}`;
    case "road_service_ticket":
      return `/maintenance/road-service?ticket_id=${id}`;
    case "form_2290_filing":
      return `/compliance/form-2290?filing_id=${id}`;
    case "border_crossing":
      return `/dispatch/border-crossing/history?crossing_id=${id}`;
    case "fuel_card_overage_event":
      return `/fuel/card-overage?event_id=${id}`;
    case "fuel_transaction":
      return `/fuel/history?transaction_id=${id}`;
    case "driver_reimbursement":
      return `/accounting/driver-reimbursements/${id}`;
    case "driver_team_split":
      return `/drivers/team-splits?team_id=${id}`;
    case "driver_report":
      return `/maintenance/driver-reports?driver_report_id=${id}`;
    case "driver_reports_driver":
      return `/maintenance/driver-reports?driver_id=${id}`;
    case "driver_reports_load":
      return `/maintenance/driver-reports?load_id=${id}`;
    case "training_record":
      return `/safety/training/records?training_id=${id}`;
    case "legal_contract":
      return `/legal/contracts?contract_id=${id}`;
    case "company_violation":
      return `/safety/external-fines?record_type=company-violation&violation_id=${id}`;
    case "integrity_alert":
      return `/safety/integrity-alerts?alert_id=${id}`;
    case "integrity_anomaly":
      return `/safety/integrity-reports?anomaly_id=${id}`;
    case "factoring_queue_load":
      return `/dispatch/factoring-queue?queue_record_id=${id}`;
    case "factoring_recourse_load":
      // LINK-F5180: recourse-pipeline.routes.ts accepts a load_id filter directly (a distinct
      // route from factoring_queue_load's dispatch/factoring-queue, whose own param convention
      // moved to queue_record_id above -- this route's param stays load_id).
      return `/factoring/recourse-pipeline?load_id=${id}`;
    case "factoring_submit_queue_load":
      // LINK-F5181: submission-queue.routes.ts accepts a load_id filter directly.
      return `/factoring/submit?load_id=${id}`;
    case "factoring_factors_customer":
      return `/factoring/factors?customer_id=${id}`;
    case "factoring_queue_customer":
      return `/dispatch/factoring-queue?customer_id=${id}`;
    case "factoring_recourse_customer":
      return `/factoring/recourse-pipeline?customer_id=${id}`;
    case "factoring_chargebacks_customer":
      return `/factoring/chargebacks-fees?customer_id=${id}`;
    case "factoring_submit_queue_customer":
      return `/factoring/submit?customer_id=${id}`;
    case "equipment_loans_vendor":
      return `/factoring/equipment-loans?vendor_id=${id}`;
    case "equipment_loan":
      return `/factoring/equipment-loans?loan_id=${id}`;
    case "equipment_transfer":
      return `/dispatch/equipment-transfers?transfer_id=${id}`;
    case "factoring_vendor_merges_driver":
      return `/factoring/vendor-merges?driver_id=${id}`;
    case "factoring_vendor_merges_vendor":
      return `/factoring/vendor-merges?vendor_id=${id}`;
    case "load_template":
      return `/dispatch/planner?panel=templates&template_id=${id}`;
    case "cash_forecast_entry":
      return `/cash-flow?tab=manual_daily_projections&entry_id=${id}`;
    case "task":
      return `/tasks/chat?taskId=${id}`;
    case "load_map":
      return `/dispatch/map?load_id=${id}`;
    case "vendor_credit":
      return `/accounting/vendor-credits?credit_id=${id}`;
    case "driver_team":
      return `/lists/driver/teams?team_id=${id}`;
    case "audit_event":
      return `/audit/trail?audit_event_id=${id}`;
    case "insurance_coverage_gaps":
      return `/safety/insurance/coverage-gaps?unit_id=${id}`;
    case "property_tax_unit":
      return `/compliance/property-tax?unit_id=${id}`;
    case "fault_drafts_unit":
      return `/maintenance/fault-drafts?unit_id=${id}`;
    case "tire_program_equipment":
      return `/maintenance/tires?equipment_id=${id}`;
    case "driver_team_splits_filter":
      return `/drivers/team-splits?driver_id=${id}`;
    case "tire_program_unit":
      return `/maintenance/tires?unit_id=${id}`;
    case "legal_contracts_vendor":
      return `/legal/contracts?signer_type=vendor&signer_entity_id=${id}`;
    case "legal_contracts_customer":
      return `/legal/contracts?signer_type=customer&signer_entity_id=${id}`;
    case "unit_tires_tab":
      return `/fleet/units/${id}/detail?tab=tires`;
    case "unit_brakes_tab":
      return `/fleet/units/${id}/detail?tab=brakes`;
    case "loads_driver_filter":
      return `/dispatch/loads?driver_id=${id}`;
    case "unit_detail_finance":
      return `/fleet/units/${id}/detail?tab=finance`;
    case "fuel_card_overage_driver":
      return `/fuel/card-overage?driver_id=${id}`;
    case "fuel_card_overage_unit":
      return `/fuel/card-overage?unit_id=${id}`;
    case "fuel_history_driver":
      return `/fuel/history?driver_id=${id}`;
    case "fuel_history_unit":
      return `/fuel/history?unit_id=${id}`;
    case "fuel_history_load":
      return `/fuel/history?load_id=${id}`;
    case "fuel_history_trailer":
      return `/fuel/history?trailer_id=${id}`;
    case "driver_deductions_filter":
      return `/drivers/deductions?driver_id=${id}`;
    case "management_report_package":
      return `/reports/management?type=${id}`;
    case "program_matrix_module":
      return `/program/matrix?module=${id}`;
    case "compliance_unit_overview":
      return `/compliance?tab=overview&unit_id=${id}`;
    case "compliance_hos_driver":
      return `/compliance?tab=hos_tracker&driver_id=${id}`;
    case "safety_event":
      return `/safety/safety-events?event_id=${id}`;
    case "safety_events_driver":
      return `/safety/safety-events?subject_driver_id=${id}`;
    case "safety_events_unit":
      return `/safety/safety-events?subject_unit_id=${id}`;
    case "safety_events_load":
      return `/safety/safety-events?related_load_id=${id}`;
    case "insurance_policies_vendor":
      return `/safety/insurance/policies?vendor_id=${id}`;
    case "severe_repairs_unit":
      return `/maintenance/severe-repairs?unit_id=${id}`;
    case "driver_scheduler_driver":
      return `/safety/driver-scheduler?driver_id=${id}`;
    case "driver_scheduler_unit":
      return `/safety/driver-scheduler?unit_id=${id}`;
    case "customer_notify_preferences":
      return `/dispatch/notify-preferences?customer_id=${id}`;
    case "safety_fines_driver":
      return `/safety/external-fines?subject_driver_id=${id}`;
    case "safety_fines_load":
      return `/safety/external-fines?related_load_id=${id}`;
    case "safety_fines_unit":
      return `/safety/external-fines?related_unit_id=${id}`;
    case "accidents_load":
      return `/safety/accidents?load_id=${id}`;
    case "accidents_driver":
      return `/safety/accidents?driver_id=${id}`;
    case "accidents_unit":
      return `/safety/accidents?unit_id=${id}`;
    case "accidents_trailer":
      return `/safety/accidents?trailer_id=${id}`;
    case "hos_violations_load":
      return `/safety/hos-violations?load_id=${id}`;
    case "hos_violations_driver":
      return `/safety/hos-violations?driver_id=${id}`;
    case "internal_fines_load":
      return `/safety/internal-fines?load_id=${id}`;
    case "internal_fines_driver":
      return `/safety/internal-fines?driver_id=${id}`;
    case "damage_reports_load":
      return `/safety/damage-reports?load_id=${id}`;
    case "damage_reports_driver":
      return `/safety/damage-reports?driver_id=${id}`;
    case "damage_reports_unit":
      return `/safety/damage-reports?unit_id=${id}`;
    case "damage_reports_trailer":
      return `/safety/damage-reports?trailer_id=${id}`;
    case "trailer_interchanges_load":
      return `/safety/trailer-interchanges?load_id=${id}`;
    case "trailer_interchanges_driver":
      return `/safety/trailer-interchanges?driver_id=${id}`;
    case "trailer_interchanges_unit":
      return `/safety/trailer-interchanges?unit_id=${id}`;
    case "trailer_interchanges_trailer":
      return `/safety/trailer-interchanges?trailer_id=${id}`;
    case "cargo_claims_load":
      return `/safety/cargo-claims?load_id=${id}`;
    case "cargo_claims_driver":
      return `/safety/cargo-claims?driver_id=${id}`;
    case "cargo_claims_unit":
      return `/safety/cargo-claims?unit_id=${id}`;
    case "cargo_claims_trailer":
      return `/safety/cargo-claims?trailer_id=${id}`;
    case "dot_inspections_driver":
      return `/safety/dot-inspections?driver_id=${id}`;
    case "dot_inspections_unit":
      return `/safety/dot-inspections?unit_id=${id}`;
    case "dot_inspections_trailer":
      return `/safety/dot-inspections?trailer_id=${id}`;
    case "training_records_driver":
      return `/safety/training/records?driver_id=${id}`;
    case "complaints_driver":
      return `/safety/complaints?driver_id=${id}`;
    case "drug_alcohol_driver":
      return `/safety/drug-alcohol?driver_id=${id}`;
    case "dvir_unit":
      return `/safety/idvr?unit_id=${id}`;
    case "dvir_trailer":
      return `/safety/idvr?trailer_id=${id}`;
    case "legal_matters_driver":
      return `/legal/matters?related_driver_id=${id}`;
    case "legal_matters_unit":
      return `/legal/matters?unit_id=${id}`;
    case "legal_matters_equipment":
      return `/legal/matters?equipment_id=${id}`;
    case "legal_matters_claim":
      return `/legal/matters?insurance_claim_id=${id}`;
    case "legal_matters_lawsuit":
      return `/legal/matters?insurance_lawsuit_id=${id}`;
    case "insurance_claims_driver":
      return `/safety/insurance/claims?driver_id=${id}`;
    case "insurance_claims_unit":
      return `/safety/insurance/claims?unit_id=${id}`;
    case "insurance_claims_load":
      return `/safety/insurance/claims?load_id=${id}`;
    case "insurance_claims_trailer":
      return `/safety/insurance/claims?trailer_id=${id}`;
    case "active_wos_driver":
      return `/maintenance/active-wos?driver_id=${id}`;
    case "active_wos_load":
      return `/maintenance/active-wos?load_id=${id}`;
    case "intransit_issues_load":
      return `/dispatch/in-transit-issues?load_id=${id}`;
    case "intransit_issues_driver":
      return `/dispatch/in-transit-issues?driver_id=${id}`;
    case "intransit_issues_unit":
      return `/dispatch/in-transit-issues?unit_id=${id}`;
    // SAF-F33 safety drill-through — each target list page reads the param and opens/highlights the row.
    case "accident":
      return `/safety/accidents?accident_id=${id}`;
    case "safety_fine":
      return `/safety/external-fines?fine_id=${id}`;
    // LIABILITY column-wave: internal fines convert to a driver liability the same way civil
    // (external) fines do (safety-v5.routes.ts sets driver_liabilities.origin='internal_fine'),
    // but no EntityKind existed to drill from the liability back to the fine that caused it.
    case "internal_fine":
      return `/safety/internal-fines?fine_id=${id}`;
    case "complaint":
      return `/safety/complaints?complaint_id=${id}`;
    case "hos_violation":
      return `/safety/hos-violations?violation_id=${id}`;
    case "dot_inspection":
      return `/safety/dot-inspections?inspection_id=${id}`;
    case "escrow_record":
      return `/safety/escrow-record?driver_id=${id}`;
    case "permit":
      return `/safety/permits?permit_id=${id}`;
    case "damage_report":
      return `/safety/damage-reports?incident_id=${id}`;
    case "trailer_interchange":
      return `/safety/trailer-interchanges?incident_id=${id}`;
    case "cargo_claim":
      return `/safety/cargo-claims?incident_id=${id}`;
    case "user":
      return `/users/${id}`;
    case "geofence":
      return `/dispatch/geofencing?geofence_id=${id}`;
    case "document":
      return `/docs?file_id=${id}`;
    case "factor":
      return `/factoring/factors?factor_id=${id}`;
    case "company_settlement":
      return `/driver-finance/company-settlements?id=${id}`;
    default:
      return null;
  }
}

/**
 * Renders `id` as a clickable drill-through link when a real detail route exists for `kind`;
 * otherwise renders plain text (no dead link, no fabricated route).
 */
export function EntityLink({ kind, id, label, className, title, onClick, "data-testid": testId }: EntityLinkProps) {
  const display = label ?? id ?? "—";

  if (!id) {
    return (
      <span className={className} title={title} data-testid={testId}>
        {display}
      </span>
    );
  }

  const route = resolveEntityRoute(kind, id);
  if (!route) {
    return (
      <span className={className} title={title} data-testid={testId}>
        {display}
      </span>
    );
  }

  return (
    <Link
      to={route}
      className={className ?? DEFAULT_LINK_CLASSNAME}
      title={title}
      data-testid={testId}
      onClick={(event) => {
        event.stopPropagation();
        onClick?.(event);
      }}
    >
      {display}
    </Link>
  );
}
