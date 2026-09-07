import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { LoadDetailDrawer } from "../../components/dispatch/LoadDetailDrawer";
import { useCompanyContext } from "../../contexts/CompanyContext";

/**
 * LDT-PAGE (owner 2026-09-06 04:0xZ): Dispatch → Load costs → click a load → THIS page — the approved render
 * docs/design/reference/LOAD-DETAIL-TABS-RENDERS-LIVE-13526-2026-09-05.html: breadcrumb Accounting › Load costs › <load>,
 * shared header (rate · practical · short · real driven · rev/mi · driver · truck/trailer, every stat opens its source),
 * the tab row (Overview · Stops · Costs · Driver Pay · Factoring · Settlement · Pre-Settlement · Audit), then the tab.
 * One component carries both the drawer and this page (LoadDetailDrawer mode="page") so the tabs cannot drift.
 * `?tab=` selects the opening tab (default Costs, this is the Load costs surface).
 */
const TABS = new Set(["Overview", "Stops", "Costs", "Driver Pay", "Factoring", "Settlement", "Pre-Settlement", "Audit", "Documents", "Cargo Sensors", "Geofence Timeline", "Assignment History", "Customs"]);
type Tab = "Overview" | "Stops" | "Costs" | "Driver Pay" | "Factoring" | "Settlement" | "Pre-Settlement" | "Audit" | "Documents" | "Cargo Sensors" | "Geofence Timeline" | "Assignment History" | "Customs";

export function LoadCostsLoadPage() {
  const { loadId = "" } = useParams<{ loadId: string }>();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { selectedCompanyId } = useCompanyContext();
  const raw = params.get("tab") ?? "Costs";
  const initialTab = (TABS.has(raw) ? raw : "Costs") as Tab;
  return (
    <div className="p-4" data-testid="load-costs-load-page-root" data-surface="load-detail">
      <LoadDetailDrawer
        key={`${loadId}:${initialTab}`}
        mode="page"
        loadId={loadId || null}
        isOpen={Boolean(loadId)}
        canEdit={true}
        operatingCompanyId={selectedCompanyId ?? undefined}
        initialTab={initialTab}
        openedFrom="accounting"
        onClose={() => navigate("/accounting/load-costs")}
      />
    </div>
  );
}
