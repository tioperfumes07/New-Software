import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { EntityLink } from "../../components/shared/EntityLink";
import { apiRequest } from "../../api/client";
import { updateDriver, deactivateDriver, reactivateDriver } from "../../api/mdata";
import { listDriverQualificationItems } from "../../api/safety";
import { formatDateUS } from "../../lib/formatDate";
import { userFacingApiError } from "../../lib/api-error-message";
import { ActionBar } from "../../components/driver-profile/ActionBar";
import { AssignTruckModal } from "../../components/driver-profile/AssignTruckModal";
import { BorderCredentialsSection } from "../../components/driver-profile/BorderCredentialsSection";
import { CurrentAssignmentSection } from "../../components/driver-profile/CurrentAssignmentSection";
import { DocumentsTab } from "../../components/documents/DocumentsTab";
import { DrugProgramSection } from "../../components/driver-profile/DrugProgramSection";
import { HOSStatusSection } from "../../components/driver-profile/HOSStatusSection";
import { IdentityHeader } from "../../components/driver-profile/IdentityHeader";
import { LicenseSection } from "../../components/driver-profile/LicenseSection";
import { MedicalCardSection } from "../../components/driver-profile/MedicalCardSection";
import { PerformanceScorecardSection } from "../../components/driver-profile/PerformanceScorecardSection";
import { SettlementsSection } from "../../components/driver-profile/SettlementsSection";
import { LoadsSection } from "../../components/driver-profile/LoadsSection";
import { DriverTeamsReverseSection } from "../../components/driver-profile/DriverTeamsReverseSection";
import { DriverTeamSplitConfigReverseSection } from "../../components/driver-profile/DriverTeamSplitConfigReverseSection";
import { DriverSettlementFinanceReverseSection } from "../../components/driver-profile/DriverSettlementFinanceReverseSection";
import { DriverCashAdvancesReverseSection } from "../../components/driver-profile/DriverCashAdvancesReverseSection";
import { DriverDeductionsReverseSection } from "../../components/driver-profile/DriverDeductionsReverseSection";
import { DriverEscrowReverseSection } from "../../components/driver-profile/DriverEscrowReverseSection";
import { DriverVendorMergesReverseSection } from "../../components/driver-profile/DriverVendorMergesReverseSection";
import { DriverPaymentMethodsCard } from "../../components/driver-profile/DriverPaymentMethodsCard";
import { LinkedBankTransactionsPanel } from "../../components/banking/LinkedBankTransactionsPanel";
import { TrainingRecordsSection } from "../../components/driver-profile/TrainingRecordsSection";
import { W8BenSection } from "../../components/driver-profile/W8BenSection";
import { AddTrainingModal } from "../../components/drivers/AddTrainingModal";
import { DriverCommunicationsTab } from "../../components/drivers/DriverCommunicationsTab";
import { EntityAuditHistoryTab } from "../../components/audit/EntityAuditHistoryTab";
import { LegalMattersReverseSection } from "../../components/legal/LegalMattersReverseSection";
import { InsuranceClaimsReverseSection } from "../../components/insurance/InsuranceClaimsReverseSection";
import { ExpensesReverseSection } from "../../components/accounting/ExpensesReverseSection";
import { BillsReverseSection } from "../../components/accounting/BillsReverseSection";
import { FuelTransactionsReverseSection } from "../../components/fuel/FuelTransactionsReverseSection";
import { DriverFinesReverseSection } from "../../components/safety/DriverFinesReverseSection";
import { DriverSafetyReverseSection } from "../../components/safety/DriverSafetyReverseSection";
import { BackgroundChecksSection } from "../../components/safety/BackgroundChecksSection";
import { MedicalCardsHistorySection } from "../../components/safety/MedicalCardsHistorySection";
import { RoadServiceReverseSection } from "../../components/maintenance/RoadServiceReverseSection";
import { DriverReportsReverseSection } from "../../components/maintenance/DriverReportsReverseSection";
import { DriverWorkOrdersReverseSection } from "../../components/maintenance/DriverWorkOrdersReverseSection";
import { DriverBorderCrossingsReverseSection } from "../../components/dispatch/DriverBorderCrossingsReverseSection";
import { DriverInTransitIssuesReverseSection } from "../../components/dispatch/DriverInTransitIssuesReverseSection";
import { DriverTempCoverReverseSection } from "../../components/safety/DriverTempCoverReverseSection";
import { DriverEquipmentTransfersReverseSection } from "../../components/dispatch/DriverEquipmentTransfersReverseSection";
import { DriverHosViolationsReverseSection } from "../../components/safety/DriverHosViolationsReverseSection";
import { SafetyAlertsReverseSection } from "../../components/safety/SafetyAlertsReverseSection";
import { InsuranceLawsuitsReverseSection } from "../../components/insurance/InsuranceLawsuitsReverseSection";
import { FuelCardOverageReverseSection } from "../../components/fuel/FuelCardOverageReverseSection";
import { CashForecastReverseSection } from "../../components/cash-flow/CashForecastReverseSection";
import { W8BenModal } from "../../components/drivers/W8BenModal";
import { KpiCard } from "../../components/layout/KpiCard";
import { KpiStrip } from "../../components/layout/KpiStrip";
import { PageHeader } from "../../components/layout/PageHeader";
import { StatusBadge } from "../../components/StatusBadge";
import { useCompanyContext } from "../../contexts/CompanyContext";
import { colors } from "../../design/tokens";
import { driverDisplayName, summarizeDriverDqf } from "../../lib/driverDqf";
import { DriverDqfComplianceChip } from "./components/DriverDqfComplianceChip";
import { DriverDqfPanel } from "./components/DriverDqfPanel";
import { DriverLateArrivalCard } from "../../components/drivers/DriverLateArrivalCard";
import { resolveApiUrl } from "../../api/client";
import { ListErrorState } from "../../components/ListErrorState";
import { addDaysIso, companyToday } from "../../lib/businessDate";

interface LayoverSummary {
  total_layovers: number;
  total_hours: number;
  billable_count: number;
  per_diem_count: number;
}

function LayoverSummaryCard({ driverId, companyId }: { driverId: string; companyId: string }) {
  const to = companyToday();
  const from = addDaysIso(to, -30);
  const { data, isLoading, isError, refetch } = useQuery<{ data: LayoverSummary[] }>({
    queryKey: ["driver-layovers-summary", driverId, companyId],
    queryFn: async () => {
      const res = await fetch(resolveApiUrl(`/api/v1/dispatch/layovers?operating_company_id=${encodeURIComponent(companyId)}&driver=${encodeURIComponent(driverId)}&from=${from}&to=${to}`),
        { credentials: "include" }
      );
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: !!driverId && !!companyId,
    staleTime: 60_000,
  });

  const rows = data?.data ?? [];
  const totalLayovers = rows.length;
  const totalHours = rows.reduce((sum: number, r: LayoverSummary) => sum + (r.total_hours ?? 0), 0);
  const billableCount = rows.filter((r: LayoverSummary) => r.billable_count > 0).length;
  const perDiemCount = rows.filter((r: LayoverSummary) => r.per_diem_count > 0).length;

  return (
    <section className="rounded-sm border border-gray-200 bg-white p-3">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xs font-semibold text-slate-900">Layovers (last 30 days)</h2>
        <EntityLink
          kind="driver_layover_history"
          id={driverId}
          label="View history"
          className="text-xs font-semibold text-slate-700 hover:underline"
        />
      </div>
      {isError ? (
        <div className="bg-red-50 p-2 text-xs text-red-700">
          Failed to load driver layovers.
          <button type="button" className="ml-2 underline" onClick={() => void refetch()}>Retry</button>
        </div>
      ) : isLoading ? (
        <p className="text-xs text-gray-400">Loading...</p>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="rounded-sm bg-gray-50 p-3 text-center">
            <p className="text-page-title font-bold text-slate-900">{totalLayovers}</p>
            <p className="text-xs text-gray-500">Total layovers</p>
          </div>
          <div className="rounded-sm bg-gray-50 p-3 text-center">
            <p className="text-page-title font-bold text-slate-900">{totalHours.toFixed(1)}</p>
            <p className="text-xs text-gray-500">Total hours</p>
          </div>
          <div className="rounded-sm bg-gray-50 p-3 text-center">
            <p className="text-page-title font-bold text-slate-900">{billableCount}</p>
            <p className="text-xs text-gray-500">Billable</p>
          </div>
          <div className="rounded-sm bg-gray-50 p-3 text-center">
            <p className="text-page-title font-bold text-slate-900">{perDiemCount}</p>
            <p className="text-xs text-gray-500">Per diem eligible</p>
          </div>
        </div>
      )}
    </section>
  );
}

export type DriverProfileAggregate = {
  driver: Record<string, unknown>;
  license: Record<string, unknown>;
  medical_card: Record<string, unknown>;
  medical_card_unavailable?: boolean;
  drug_program: Record<string, unknown>;
  drug_program_unavailable?: boolean;
  hos: Record<string, unknown> | null;
  hos_unavailable?: boolean;
  current_assignment: Record<string, unknown>;
  performance_scorecard?: Record<string, unknown> | null;
  performance_scorecard_unavailable?: boolean;
  settlements?: Record<string, unknown>;
  training_records?: Array<Record<string, unknown>>;
  training_records_total_count?: number;
  training_records_unavailable?: boolean;
  border_credentials?: Record<string, unknown>;
  w8ben?: Record<string, unknown>;
  w8ben_unavailable?: boolean;
};

function fetchDriverProfile(driverId: string, operatingCompanyId: string) {
  const query = new URLSearchParams({ operating_company_id: operatingCompanyId, aggregate: "true" });
  return apiRequest<DriverProfileAggregate>(
    `/api/v1/mdata/drivers/${encodeURIComponent(driverId)}?${query.toString()}`
  );
}

function formatSamsaraLogin(value: unknown): string {
  if (typeof value !== "string" || !value) return "Never observed";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unavailable";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    month: "2-digit",
    day: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date);
}

type DriverProfilePageProps = {
  driverId?: string;
  onBack?: () => void;
};

export function DriverProfilePage({ driverId: driverIdProp, onBack }: DriverProfilePageProps = {}) {
  const { id: routeId = "" } = useParams();
  const id = driverIdProp ?? routeId;
  const [searchParams, setSearchParams] = useSearchParams();
  const { selectedCompanyId } = useCompanyContext();
  const companyId = selectedCompanyId ?? "";
  const queryClient = useQueryClient();
  const [addTrainingOpen, setAddTrainingOpen] = useState(false);
  const [w8benOpen, setW8benOpen] = useState(false);
  const [autoPaySaving, setAutoPaySaving] = useState(false);
  const [dqfFocus, setDqfFocus] = useState<"all" | "present" | "missing" | "expired" | "expiry_alerts">("all");

  const focusDqf = (focus: typeof dqfFocus) => {
    setDqfFocus(focus);
    requestAnimationFrame(() => document.getElementById("driver-dqf-checklist")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  const refreshDriver = () => {
    void queryClient.invalidateQueries({ queryKey: ["driver", id] });
    void queryClient.invalidateQueries({ queryKey: ["driver-profile", id, companyId] });
    void queryClient.invalidateQueries({ queryKey: ["drivers"] });
  };

  // Hide/Show from TMS lists — reversible soft toggle (status Active<->Inactive). NOT a Samsara/HR action;
  // just keeps non-working drivers out of the dispatch pickers/roster. 'Terminated' is left untouched.
  const [visibilitySaving, setVisibilitySaving] = useState(false);
  const [visibilityError, setVisibilityError] = useState("");
  const toggleVisibility = async (driverId: string, isHidden: boolean) => {
    setVisibilityError("");
    setVisibilitySaving(true);
    try {
      await (isHidden ? reactivateDriver(driverId) : deactivateDriver(driverId));
      refreshDriver();
    } catch (err) {
      setVisibilityError(userFacingApiError(err, "Could not update driver list visibility"));
    } finally {
      setVisibilitySaving(false);
    }
  };

  const profileQ = useQuery({
    queryKey: ["driver-profile", id, companyId],
    queryFn: () => fetchDriverProfile(id, companyId),
    enabled: Boolean(id && companyId),
    staleTime: 30_000,
  });

  const hosQ = useQuery({
    queryKey: ["driver-profile-hos", id, companyId],
    queryFn: () => fetchDriverProfile(id, companyId),
    enabled: Boolean(id && companyId),
    refetchInterval: 30_000,
    staleTime: 30_000,
  });

  const itemsQ = useQuery({
    queryKey: ["safety", "driver-dqf", companyId, id],
    enabled: Boolean(companyId && id),
    queryFn: () => listDriverQualificationItems(id, companyId).then((result) => result.items),
  });

  const summary = summarizeDriverDqf(itemsQ.data);
  const aggregate = profileQ.data;
  // D2 fix: source the driver identity from the aggregate (scoped by the SELECTED company + its
  // driver_company_authorizations — the same scope the DQF list uses), NOT a second `getDriver` call
  // that scoped to the user's server-resolved DEFAULT company. When the selected company differed from
  // that default (or the driver was reachable only via a company authorization), the standalone read
  // 404'd and the profile fell through to "Driver not found" even though the aggregate loaded fine.
  const driverRecord = aggregate?.driver;
  const driver = driverRecord
    ? {
        id: String(driverRecord.id ?? id),
        first_name: (driverRecord.first_name as string | null | undefined) ?? null,
        last_name: (driverRecord.last_name as string | null | undefined) ?? null,
        status: String(driverRecord.status ?? ""),
      }
    : undefined;
  const hos = hosQ.data?.hos ?? aggregate?.hos ?? null;

  if (!companyId) {
    return <div className="rounded-sm border border-gray-200 bg-white p-3 text-xs text-slate-600">Select an operating company.</div>;
  }

  if (profileQ.isLoading) {
    return <div className="rounded-sm border border-gray-200 bg-white p-3 text-xs text-slate-600">Loading driver profile…</div>;
  }

  if (profileQ.isError) {
    return (
      <ListErrorState
        title="Couldn't load driver profile"
        status={0}
        message={(profileQ.error as Error)?.message}
        onRetry={() => void profileQ.refetch()}
      />
    );
  }

  if (!driver || !aggregate) {
    return (
      <div className="space-y-2 rounded-sm border border-gray-200 bg-white p-3 text-xs text-slate-600">
        <p>Driver not found.</p>
        {onBack ? (
          <button type="button" onClick={onBack} className="text-xs font-semibold text-slate-700 hover:underline">
            ← Back to driver list
          </button>
        ) : (
          <Link to="/drivers?subtab=profiles" className="text-xs font-semibold text-slate-700 hover:underline">
            ← Back to DQF profiles
          </Link>
        )}
      </div>
    );
  }

  const displayName = driverDisplayName(driver.first_name, driver.last_name, driver.id);
  const profileDriver = aggregate.driver;
  const assignTruckOpen = searchParams.get("assign_truck") === "1";

  const openAssignTruck = () => {
    const next = new URLSearchParams(searchParams);
    next.set("assign_truck", "1");
    setSearchParams(next, { replace: true });
  };

  const closeAssignTruck = () => {
    const next = new URLSearchParams(searchParams);
    next.delete("assign_truck");
    setSearchParams(next, { replace: true });
  };

  return (
    <div className="space-y-3">
      <PageHeader
        title={displayName}
        subtitle="Driver profile · qualification file (DQF)"
        breadcrumb={["Drivers", "Qualification profiles", displayName]}
        onBack={onBack}
        backHref="/drivers?subtab=profiles"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {!itemsQ.isError ? <DriverDqfComplianceChip summary={summary} /> : null}
            <StatusBadge status={driver.status} />
            {driver.status !== "Terminated" ? (
              <button
                type="button"
                disabled={visibilitySaving}
                onClick={() => void toggleVisibility(driver.id, driver.status === "Inactive")}
                className={`rounded border px-2 py-1 text-xs font-semibold disabled:opacity-50 ${
                  driver.status === "Inactive"
                    ? "border-slate-300 text-slate-700 hover:bg-slate-100"
                    : "border-slate-300 text-slate-600 hover:bg-slate-50"
                }`}
                title={driver.status === "Inactive" ? "Show this driver in dispatch pickers and lists" : "Hide this driver from dispatch pickers and lists (reversible)"}
              >
                {visibilitySaving ? "Saving…" : driver.status === "Inactive" ? "Show in lists" : "Hide from lists"}
              </button>
            ) : null}
            {visibilityError ? <span role="alert" className="text-xs text-red-600">{visibilityError}</span> : null}
            <EntityLink
              kind="driver"
              id={driver.id}
              label={displayName}
              className="text-xs font-semibold text-slate-700 hover:underline"
              data-testid="driver-profile-open-full-record-link"
            />
            {onBack ? (
              <button type="button" onClick={onBack} className="text-xs font-semibold text-slate-600 hover:underline">
                Back to list
              </button>
            ) : (
              <Link to="/drivers?subtab=profiles" className="text-xs font-semibold text-slate-600 hover:underline">
                All profiles
              </Link>
            )}
          </div>
        }
      />

      <div data-testid="dp-section-1-identity">
        <IdentityHeader
          driver={profileDriver}
          employmentStatusLabel={
            (aggregate.license as { driver_employment_status_label?: string | null } | undefined)
              ?.driver_employment_status_label ?? null
          }
        />
        <p className="mt-1 text-xs text-slate-600" data-testid="driver-last-samsara-login">
          Last Samsara login: {formatSamsaraLogin(profileDriver.last_samsara_login_at)}
        </p>
      </div>
      <div data-testid="dp-section-2-license">
        <div className="mb-2 flex justify-end">
          <EntityLink
            kind="driver_safety_profile"
            id={id}
            label="Open full safety file →"
            className="text-xs font-semibold text-slate-700 underline"
            data-testid="driver-profile-safety-file-link"
          />
        </div>
        <LicenseSection license={aggregate.license} />
      </div>
      <div data-testid="dp-section-3-medical">
        <MedicalCardSection medical={aggregate.medical_card} unavailable={aggregate.medical_card_unavailable === true} />
        <MedicalCardsHistorySection operatingCompanyId={companyId} driverId={id} />
      </div>
      <div data-testid="dp-section-4-drug">
        <DrugProgramSection drug={aggregate.drug_program} unavailable={aggregate.drug_program_unavailable === true} />
      </div>
      <div data-testid="dp-section-5-hos">
        {hosQ.isError ? (
          <ListErrorState
            title="Couldn't refresh HOS status"
            status={0}
            message={(hosQ.error as Error)?.message}
            onRetry={() => void hosQ.refetch()}
          />
        ) : null}
        <HOSStatusSection hos={hos} unavailable={aggregate.hos_unavailable === true} />
        <EntityLink
          kind="compliance_hos_driver"
          id={id}
          label="Open this driver in HOS Tracker →"
          className="mt-2 inline-block text-xs font-semibold text-slate-700 hover:underline"
        />
      </div>
      <div data-testid="dp-section-6-assignment">
        <CurrentAssignmentSection
          assignment={aggregate.current_assignment}
          companyId={companyId}
          driverId={id}
          driverName={displayName}
        />
      </div>

      {companyId ? (
        <div data-testid="dp-section-loads">
          <LoadsSection driverId={id} operatingCompanyId={companyId} />
        </div>
      ) : null}

      <DriverWorkOrdersReverseSection
        operatingCompanyId={companyId}
        driverId={id}
        data-testid="driver-profile-work-orders-reverse"
      />

      <DriverTeamsReverseSection driverId={id} operatingCompanyId={companyId} />
      <DriverTeamSplitConfigReverseSection driverId={id} operatingCompanyId={companyId} />

      <div data-testid="dp-section-7-performance">
        <PerformanceScorecardSection scorecard={aggregate.performance_scorecard ?? null} unavailable={aggregate.performance_scorecard_unavailable === true} />
      </div>
      <div data-testid="dp-section-late-arrival">
        <DriverLateArrivalCard driverId={id} operatingCompanyId={companyId} />
      </div>
      <div data-testid="dp-section-8-settlements">
        <SettlementsSection
          settlements={aggregate.settlements ?? {}}
          driverId={id}
          autoPayEnabled={Boolean((aggregate.driver as Record<string, unknown>).settlement_auto_pay_enabled)}
          autoPaySaving={autoPaySaving}
          onAutoPayChange={async (enabled) => {
            setAutoPaySaving(true);
            try {
              await updateDriver(id, { settlement_auto_pay_enabled: enabled });
              await queryClient.invalidateQueries({ queryKey: ["driver-profile", id, companyId] });
            } finally {
              setAutoPaySaving(false);
            }
          }}
        />
        <DriverPaymentMethodsCard driverId={id} companyId={companyId} />
        {companyId ? (
          <div className="mt-3" data-testid="dp-section-linked-bank-txns">
            <LinkedBankTransactionsPanel
              companyId={companyId}
              linkage={{ kind: "driver_id", id }}
              entityLabel={displayName}
            />
          </div>
        ) : null}
      </div>
      <div data-testid="dp-section-layovers">
        <LayoverSummaryCard driverId={id} companyId={companyId} />
      </div>
      <div data-testid="dp-section-9-training">
        <BackgroundChecksSection operatingCompanyId={companyId} driverId={id} />
        <TrainingRecordsSection
          records={aggregate.training_records ?? []}
          totalCount={aggregate.training_records_total_count ?? aggregate.training_records?.length ?? 0}
          driverId={id}
          unavailable={aggregate.training_records_unavailable === true}
          onAddTraining={() => setAddTrainingOpen(true)}
        />
      </div>
      <AddTrainingModal
        open={addTrainingOpen}
        driverId={id}
        companyId={companyId}
        driverName={displayName}
        onClose={() => setAddTrainingOpen(false)}
        onCreated={refreshDriver}
      />
      <div data-testid="dp-section-10-border">
        <BorderCredentialsSection
          border={aggregate.border_credentials ?? {}}
          driverId={id}
          onSaved={refreshDriver}
        />
      </div>
      <div data-testid="dp-section-w8ben">
        <W8BenSection w8ben={aggregate.w8ben ?? { status: "missing", on_file: false }} unavailable={aggregate.w8ben_unavailable === true} onCapture={() => setW8benOpen(true)} />
      </div>
      <W8BenModal
        open={w8benOpen}
        driverId={id}
        companyId={companyId}
        driverName={displayName}
        onClose={() => setW8benOpen(false)}
        onCreated={refreshDriver}
      />
      <div data-testid="dp-section-11-documents">
        {/* Inline the full Documents module (upload + R2 + versions + download) on the driver profile —
            same component DriverDetail uses. Replaces the read-only stub that only linked out to /docs, so
            CDLs / medical cards / insurance can be uploaded here directly. Per-entity scoped (driver). */}
        <DocumentsTab entityType="driver" entityId={id} entityName={displayName} operatingCompanyId={(profileDriver.operating_company_id as string | null | undefined) ?? companyId} />
      </div>

      <div data-testid="dp-section-communications" className="rounded-sm border border-gray-200 bg-white p-3">
        <DriverCommunicationsTab driverId={id} operatingCompanyId={companyId} />
      </div>

      {/* DQF summary tiles drill into the canonical checklist below with the matching exact filter. */}
      {itemsQ.isError ? (
        <ListErrorState
          title="Couldn't load DQF summary"
          status={0}
          message={(itemsQ.error as Error)?.message}
          onRetry={() => void itemsQ.refetch()}
        />
      ) : (
        <KpiStrip>
          <KpiCard
            label="Checklist items"
            number={String(summary.itemCount)}
            accent={colors.drivers.strong}
            onClick={() => focusDqf("all")}
          />
          <KpiCard
            label="Present"
            number={String(summary.presentCount)}
            accent={colors.positive.strong}
            onClick={() => focusDqf("present")}
          />
          <KpiCard
            label="Missing"
            number={String(summary.missingCount)}
            accent={colors.warn.strong}
            onClick={() => focusDqf("missing")}
          />
          <KpiCard
            label="Expired"
            number={String(summary.expiredCount)}
            accent={colors.crit.strong}
            onClick={() => focusDqf("expired")}
          />
          <KpiCard
            label="Expiry alerts"
            number={`${summary.redExpiryCount}R · ${summary.amberExpiryCount}A`}
            accent={colors.info.strong}
            onClick={() => focusDqf("expiry_alerts")}
          />
        </KpiStrip>
      )}

      {/*
        RESTORED (2026-07-27). This section was DELETED by #366 on 2026-06-02 — a §7 additive-only
        violation ("ARCHIVE, never DELETE"). Its test assertion was left in place, so
        DriverProfilePage.test.tsx has been red for nearly two months, asserting a heading that
        existed nowhere in the tree. The correct fix is to restore the section, not to delete the
        assertion: the at-a-glance CDL / medical / contact readout genuinely disappeared from the
        driver profile and nothing replaced it.

        The compliance CHIP is deliberately not repeated here — #366 moved it into the PageHeader
        actions and that placement is kept, so restoring it inside would duplicate a live element.
        Everything else the section carried is restored verbatim against columns re-verified on prod
        2026-07-27: cdl_number, cdl_state, cdl_expires_at, dot_medical_expires_at, phone, email all
        exist on mdata.drivers.
      */}
      <section id="driver-dqf-checklist" className="scroll-mt-4 rounded-sm border border-gray-200 bg-white p-3">
        <h2 className="mb-1 text-xs font-semibold text-slate-900">Compliance summary</h2>
        <p className="mb-3 text-xs text-slate-600">
          Profile readiness combines master-data credentials with DQF checklist rows from the driver-qualification API.
          File status:{" "}
          {itemsQ.isError ? (
            <span className="font-medium text-red-700">Could not be loaded.</span>
          ) : (
            <span className="font-medium text-slate-800">{summary.label}</span>
          )}
        </p>
        {/* Flat inside one frame — the inner bordered cells the 2026-06 original used are a
            box-within-box, which verify-no-nested-box now forbids (QBO/NetSuite: one frame, flat
            inside). The restored INFORMATION is what §7 protects; the obsolete framing is not. */}
        <div className="grid gap-3 text-xs text-slate-700 md:grid-cols-3">
          <div>
            <div className="font-semibold text-slate-800">CDL</div>
            <div>
              {(profileDriver.cdl_number as string | null) ?? "—"} · {(profileDriver.cdl_state as string | null) ?? "—"}
            </div>
            <div>
              Expires {formatDateUS(profileDriver.cdl_expires_at as string | null) || "—"}
            </div>
          </div>
          <div>
            <div className="font-semibold text-slate-800">Medical card</div>
            <div>
              Expires {formatDateUS(profileDriver.dot_medical_expires_at as string | null) || "—"}
            </div>
          </div>
          <div>
            <div className="font-semibold text-slate-800">Contact</div>
            <div>{(profileDriver.phone as string | null) ?? "—"}</div>
            <div>{(profileDriver.email as string | null) ?? "—"}</div>
          </div>
        </div>
      </section>

      <section className="rounded-sm border border-gray-200 bg-white p-3">
        <h2 className="mb-3 text-xs font-semibold text-slate-900">DQF checklist</h2>
        <DriverDqfPanel companyId={companyId} driverId={id} editable focus={dqfFocus} onClearFocus={() => setDqfFocus("all")} />
      </section>

      <div data-testid="dp-section-12-action-bar">
        <ActionBar
          driverId={id}
          companyId={companyId}
          driverName={displayName}
          driverStatus={driver.status}
          onActionComplete={refreshDriver}
          onAssignTruck={driver.status === "Terminated" ? undefined : openAssignTruck}
        />
      </div>

      <AssignTruckModal
        open={assignTruckOpen}
        driverId={id}
        companyId={companyId}
        driverName={displayName}
        onClose={closeAssignTruck}
        onAssigned={refreshDriver}
      />

      <div data-testid="dp-section-legal-matters">
        <LegalMattersReverseSection
          operatingCompanyId={companyId}
          filter={{ related_driver_id: id }}
          contextLabel="this driver"
          data-testid="driver-profile-legal-matters"
        />
      </div>
      <div data-testid="dp-section-insurance-claims">
        <InsuranceClaimsReverseSection
          operatingCompanyId={companyId}
          filter={{ driver_id: id }}
          contextLabel="this driver"
          data-testid="driver-profile-insurance-claims"
        />
      </div>
      {/* ACCT-F5031 / rank 6 — ExpensesReverseSection already filtered by driver_id but was only
          mounted on TrailerProfile. Same create-path reverse bar as claims/fuel. */}
      <div data-testid="dp-section-expenses-reverse">
        <ExpensesReverseSection
          operatingCompanyId={companyId}
          filter={{ driver_id: id }}
          contextLabel="this driver"
          data-testid="driver-profile-expenses-reverse"
        />
      </div>
      <div data-testid="dp-section-bills-reverse">
        <BillsReverseSection
          operatingCompanyId={companyId}
          filter={{ driver_id: id }}
          contextLabel="this driver"
          data-testid="driver-profile-bills-reverse"
        />
      </div>
      <div data-testid="dp-section-fuel-reverse">
        <FuelTransactionsReverseSection
          operatingCompanyId={companyId}
          filter={{ driver_id: id }}
          contextLabel="this driver"
          data-testid="driver-profile-fuel-reverse"
        />
      </div>
      {/* SAF-F16 — fines had no reverse surface on the driver they were imposed on. Reads BOTH
          safety.civil_fines (subject_driver_id) and safety.internal_fines (driver_id); either one
          alone would under-report. */}
      <div data-testid="dp-section-fines-reverse">
        <DriverFinesReverseSection
          operatingCompanyId={companyId}
          driverId={id}
          data-testid="driver-profile-fines-reverse"
        />
      </div>
      {/* LINK-F5171 (settlements:disputes, settlements:liabilities.list) — driver_finance.*
          disputes/liabilities already had real driver_id FKs and driver-scoped backend functions
          but no reverse surface anywhere on the driver's own profile. Same root cause as
          DriverFinesReverseSection above. */}
      <div data-testid="dp-section-settlement-finance-reverse">
        <DriverSettlementFinanceReverseSection
          operatingCompanyId={companyId}
          driverId={id}
          data-testid="driver-profile-settlement-finance-reverse"
        />
      </div>
      {/* LINK-F5171/LINK-F5185 (settlements:cash_advances, settlements:drawer.advance_detail,
          settlements:modal.mark_disbursed) — driver_finance.cash_advance_requests +
          views.cash_advances_with_context both already had real driver_id FKs but no reverse
          surface anywhere on the driver's own profile. */}
      <div data-testid="dp-section-cash-advances-reverse">
        <DriverCashAdvancesReverseSection
          operatingCompanyId={companyId}
          driverId={id}
          data-testid="driver-profile-cash-advances-reverse"
        />
      </div>
      {/* ACCT-ESCROW-VIEW-DRIVER-PROFILE — owner order item 3: "Driver Profile > Deductions: list
          BY DRIVER + add the Escrow view (per-driver escrow balance)". Both backend surfaces
          (deductions list driver_id filter, escrow account+postings by holder) already existed or
          were added this session — the gap was that neither rendered anywhere on the driver's own
          profile. */}
      <div data-testid="dp-section-deductions-reverse">
        <DriverDeductionsReverseSection
          operatingCompanyId={companyId}
          driverId={id}
          data-testid="driver-profile-deductions-reverse"
        />
      </div>
      <div data-testid="dp-section-escrow-reverse">
        <DriverEscrowReverseSection
          operatingCompanyId={companyId}
          driverId={id}
          data-testid="driver-profile-escrow-reverse"
        />
      </div>
      <div data-testid="dp-section-vendor-merges-reverse">
        <DriverVendorMergesReverseSection
          operatingCompanyId={companyId}
          driverId={id}
          data-testid="driver-profile-vendor-merges-reverse"
        />
      </div>
      <div data-testid="dp-section-safety-reverse">
        <DriverSafetyReverseSection
          operatingCompanyId={companyId}
          driverId={id}
          data-testid="driver-profile-safety-reverse"
        />
        <DriverInTransitIssuesReverseSection operatingCompanyId={companyId} driverId={id} />
        <DriverTempCoverReverseSection operatingCompanyId={companyId} driverId={id} />
        <DriverEquipmentTransfersReverseSection operatingCompanyId={companyId} driverId={id} />
        <DriverHosViolationsReverseSection operatingCompanyId={companyId} driverId={id} />
        <DriverReportsReverseSection operatingCompanyId={companyId} driverId={id} />
        <SafetyAlertsReverseSection operatingCompanyId={companyId} subjectKind="driver" subjectId={id} />
        <InsuranceLawsuitsReverseSection operatingCompanyId={companyId} filter={{ driver_id: id }} contextLabel="this driver" />
        <FuelCardOverageReverseSection operatingCompanyId={companyId} filter={{ driver_id: id }} />
        <CashForecastReverseSection operatingCompanyId={companyId} filter={{ party_ref_kind: "driver", party_ref_id: id }} />
      </div>
      <div data-testid="dp-section-road-service-reverse">
        <RoadServiceReverseSection
          filter={{ driver_id: id }}
          contextLabel="this driver"
          data-testid="driver-profile-road-service-reverse"
        />
        <DriverBorderCrossingsReverseSection operatingCompanyId={companyId} driverId={id} />
      </div>

      <section data-testid="dp-section-audit-history" className="rounded-sm border border-gray-200 bg-white p-3">
        <h2 className="mb-3 text-xs font-semibold text-slate-900">Audit History</h2>
        <EntityAuditHistoryTab operatingCompanyId={companyId} entityType="driver" entityId={id} />
      </section>
    </div>
  );
}
