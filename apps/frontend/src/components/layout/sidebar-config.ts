import type { ComponentType } from "react";
import {
  Activity,
  Banknote,
  BarChart2,
  Building2,
  Calculator,
  CarFront,
  CheckSquare,
  CircleHelp,
  Container,
  FileText,
  Home,
  LineChart,
  ListChecks,
  Package,
  Radio,
  Scale,
  Shield,
  ShieldCheck,
  SlidersHorizontal,
  SquareStack,
  TrendingUp,
  Truck,
  UserCog,
  Receipt,
} from "lucide-react";
import type { UserRole } from "../../types/api";
import { MAINTENANCE_MODULE_NAV_LINKS } from "../maintenance/MAINTENANCE_NAV_CONFIG";

/** Canonical sidebar ids (locked; single source for order + prefs overrides). */
export const SIDEBAR_ITEM_IDS = [
  "home",
  "tasks",
  "fuel",
  "dispatch",
  "driver-hub",
  "maintenance",
  "safety",
  "compliance",
  "drivers",
  "fleet",
  "insurance",
  "legal",
  "eld",
  "cash-flow",
  "settlements",
  "accounting",
  "bank",
  "factoring",
  "finance",
  "customers",
  "vendors",
  "inventory",
  "form_425",
  "lists",
  "reports",
  "docs",
  "users",
  "help",
  "program",
  "system",
] as const;

export type SidebarItemId = (typeof SIDEBAR_ITEM_IDS)[number];

// "eld" is a placeholder/stub page (no real backend) — hidden from nav so there are no dead-end pages.
// "finance" (the Finance Hub) is NOW SURFACED: the hub is built and works (Overview/Projections/Scenarios
// render; Loan Wizard/Calculator/Amortization are flag-gated tabs inside it), and the flag-route fix
// (#1033) made its checks resolve. It was orphaned with no sidebar door; un-hidden here (additive),
// landing below FACT / above CUSTOMERS per the order array. Item configs + routes are KEPT.
const NAV_HIDDEN_STUB_IDS: readonly SidebarItemId[] = ["eld"];
export const SIDEBAR_DEFAULT_ORDER: readonly SidebarItemId[] = SIDEBAR_ITEM_IDS.filter(
  (id) => !NAV_HIDDEN_STUB_IDS.includes(id),
);

export type SidebarFlyoutLink = { label: string; to: string };

export type SidebarItemMeta = {
  id: SidebarItemId;
  label: string;
  Icon: ComponentType<{ className?: string }>;
  to: string;
  visibleRoles?: UserRole[];
  dataTour?: string;
  badgeKey?: "maintenance_severe";
};

/** Per-item presentation + routes. Order is controlled ONLY by `SIDEBAR_DEFAULT_ORDER` (uniform for all users; no per-user or per-role override). */
export const SIDEBAR_ITEM_META: Record<SidebarItemId, SidebarItemMeta> = {
  // Canonical training HOME = design MODULE 1 `/home`. `/app/homepage` remains QBO-style home (additive).
  home: { id: "home", label: "HOME", Icon: Home, to: "/home", dataTour: "tour-nav-home" },
  maintenance: {
    id: "maintenance",
    label: "MAINTENANCE",
    Icon: CarFront,
    to: "/maintenance",
    badgeKey: "maintenance_severe",
  },
  fuel: { id: "fuel", label: "FUEL", Icon: CarFront, to: "/fuel" },
  dispatch: { id: "dispatch", label: "DISPATCH", Icon: Truck, to: "/dispatch", dataTour: "tour-nav-dispatch" },
  drivers: { id: "drivers", label: "DRIVER PROFILE", Icon: Truck, to: "/drivers" },
  fleet: {
    id: "fleet",
    label: "FLEET",
    Icon: Container,
    to: "/fleet",
    visibleRoles: ["Owner", "Administrator", "SuperAdmin", "Manager", "Accountant", "Dispatcher", "Safety", "Mechanic"],
  },
  "driver-hub": { id: "driver-hub", label: "DRIVER HUB", Icon: Activity, to: "/driver-hub" },
  safety: { id: "safety", label: "SAFETY", Icon: ShieldCheck, to: "/safety" },
  compliance: { id: "compliance", label: "COMPLIANCE", Icon: ShieldCheck, to: "/compliance" },
  accounting: { id: "accounting", label: "ACCOUNTING", Icon: Calculator, to: "/accounting" },
  insurance: { id: "insurance", label: "INSURANCE", Icon: Shield, to: "/safety/insurance" },
  bank: { id: "bank", label: "BANKING", Icon: Banknote, to: "/banking", dataTour: "tour-nav-banking" },
  factoring: { id: "factoring", label: "FACT", Icon: Calculator, to: "/factoring" },
  customers: { id: "customers", label: "CUSTOMERS", Icon: Building2, to: "/customers", dataTour: "tour-nav-customers" },
  vendors: { id: "vendors", label: "VENDORS", Icon: Building2, to: "/vendors" },
  lists: { id: "lists", label: "LISTS", Icon: ListChecks, to: "/lists" },
  reports: { id: "reports", label: "REPORTS", Icon: BarChart2, to: "/reports" },
  legal: { id: "legal", label: "LEGAL", Icon: Scale, to: "/legal", visibleRoles: ["Owner", "Administrator"] },
  docs: { id: "docs", label: "DOCS", Icon: FileText, to: "/docs", visibleRoles: ["Owner", "Administrator"] },
  eld: { id: "eld", label: "ELD", Icon: Radio, to: "/eld", visibleRoles: ["Owner"] },
  form_425: { id: "form_425", label: "425C", Icon: SquareStack, to: "/425c" },
  tasks: { id: "tasks", label: "TASKS", Icon: CheckSquare, to: "/tasks" },
  "cash-flow": { id: "cash-flow", label: "CASH FLOW", Icon: LineChart, to: "/cash-flow" },
  settlements: { id: "settlements", label: "SETTLEMENTS", Icon: Receipt, to: "/driver-finance/settlements" },
  // FIN-2: "FINANCE HUB" lands on the real Hub dashboard at the canonical module root (/finance).
  // Overview stays reachable as a tab (FinanceModuleTabs) and in the sidebar flyout; no route removed.
  finance: { id: "finance", label: "FINANCE HUB", Icon: TrendingUp, to: "/finance" },
  inventory: { id: "inventory", label: "INVENTORY", Icon: Package, to: "/inventory" },
  users: {
    id: "users",
    label: "USERS",
    Icon: UserCog,
    to: "/users",
    visibleRoles: ["Owner", "Administrator", "SuperAdmin"],
    dataTour: "tour-nav-admin",
  },
  help: { id: "help", label: "HELP", Icon: CircleHelp, to: "/help" },
  // Program Tracker (Build Progress) — Owner/Admin internal build-status dashboard; owner-requested sidebar entry.
  program: { id: "program", label: "PROGRAM", Icon: ListChecks, to: "/program", visibleRoles: ["Owner", "Administrator", "SuperAdmin"] },
  // SYSTEM — Owner-only single home for QuickBooks Reconciliation, QuickBooks Sync, Program Tracker,
  // Software/Build health, and Claude Coder (owner-supplied design). Appended at END (additive).
  system: { id: "system", label: "SYSTEM", Icon: SlidersHorizontal, to: "/system", visibleRoles: ["Owner"] },
};

/**
 * UNIFORM sidebar order (Jorge, 2026-06-16): `SIDEBAR_DEFAULT_ORDER` is the SINGLE source of truth for
 * order — identical for every operator. Order does NOT depend on per-user prefs (`sidebar_order`) or on
 * role. Per-user customization and role-based ordering were removed so every account sees the same rail.
 * Permission-based VISIBILITY of individual items (`visibleRoles`) is unaffected — that controls *which*
 * items appear, not their order. Params are accepted (and ignored) only for call-site/test compatibility.
 * Enforced by scripts/verify-sidebar-contract.mjs.
 */
export function resolveSidebarOrder(_role?: UserRole, _preferences?: Record<string, unknown>): SidebarItemId[] {
  return [...SIDEBAR_DEFAULT_ORDER];
}

/** Flyout targets — Fuel + fleet routes live under existing modules (no top-level FUEL / DRIVERS). */
export function getSidebarFlyoutItems(id: SidebarItemId, role: UserRole): SidebarFlyoutLink[] {
  switch (id) {
    case "accounting":
      return [
        { label: "Hub", to: "/accounting" },
        { label: "Invoices", to: "/accounting/invoices" },
        { label: "Payments", to: "/accounting/payments" },
        { label: "Factoring", to: "/accounting/factoring" },
      ];
    case "maintenance":
      return MAINTENANCE_MODULE_NAV_LINKS.map((item) => ({ label: item.label, to: item.path }));
    case "bank":
      // FAIL-5: flyout must mirror BANKING_MODULE_TABS (+ additive queues/settings). Fuel Planner
      // stays on its own sidebar item (Module 5) — not duplicated here.
      return [
        { label: "Accounts", to: "/banking" },
        { label: "Transactions", to: "/banking/transactions" },
        { label: "Reconciliation", to: "/banking/reconciliation" },
        { label: "Factoring (Faro)", to: "/banking/factoring" },
        { label: "Driver Escrow", to: "/banking/driver-escrow" },
        { label: "Relay Card", to: "/banking/relay" },
        { label: "Reports", to: "/banking/reports" },
        { label: "Statement Import", to: "/banking/statement-import" },
        { label: "Plaid Connections", to: "/banking/plaid-connections" },
        { label: "Settings", to: "/banking/settings" },
        { label: "Transfers", to: "/banking/transfers" },
        { label: "Reconcile Queue", to: "/banking/reconcile" },
        { label: "Cash GL setup", to: "/banking/cash-gl-setup" },
        { label: "Email Queue", to: "/banking/email-queue" },
        // BANK-ACCOUNT-HIDE (Tier-1 HOLD): per-entity hide/exclude manager. Route + nav entry are
        // additive; the page itself is gated behind BANK_ACCOUNT_HIDE_ENABLED (default OFF) and shows
        // a plain-language notice until Jorge flips the per-entity flag.
        { label: "Account Visibility", to: "/banking/account-visibility" },
      ];
    case "safety":
      // Active-path law: flyout must land on V6.4 canonical tab routes (SAFETY_GROUPS), not
      // ComingSoon stubs. Extra live surfaces (CSA Mitigation, Anomaly Alerts) stay ADDITIVE
      // (Rule 07 — never delete); they are outside the 28-tab groups but remain reachable.
      return [
        { label: "Safety Home", to: "/safety/home" },
        { label: "Driver Files", to: "/safety/driver-files" },
        { label: "Hours of Service", to: "/safety/hos" },
        { label: "DOT Compliance", to: "/safety/dot-compliance" },
        { label: "DOT Inspections", to: "/safety/dot-inspections" },
        { label: "CSA Score", to: "/safety/csa-score" },
        { label: "Accidents & Incidents", to: "/safety/accidents" },
        { label: "Internal Fines", to: "/safety/internal-fines" },
        { label: "CSA Mitigation", to: "/safety/csa-mitigation" },
        { label: "Anomaly Alerts", to: "/safety/anomaly-alerts" },
      ];
    case "drivers":
      return [
        { label: "Drivers Home", to: "/drivers" },
        { label: "Profiles", to: "/drivers?subtab=profiles" },
        { label: "Settlements", to: "/drivers?subtab=settlements" },
        { label: "Cash Advances", to: "/drivers?subtab=cash_advances" },
        { label: "Cash Advance Requests", to: "/driver-finance/cash-advance-requests" },
        { label: "Permits", to: "/drivers?subtab=permits" },
        { label: "Messages", to: "/drivers/messages" },
        { label: "Applicants", to: "/drivers/applicants" },
      ];
    case "dispatch":
      return [
        { label: "Dispatch Home", to: "/dispatch" },
        { label: "Load costs", to: "/accounting/load-costs" },
        { label: "Loads", to: "/dispatch?view=loads" },
        { label: "Dispatch Chat", to: "/dispatch/chat" },
        { label: "At-Risk Queue", to: "/dispatch/at-risk" },
        { label: "In-Transit Issues", to: "/dispatch/in-transit-issues" },
        { label: "Assignment History", to: "/dispatch/assignment-history" },
        { label: "Planner Calendar", to: "/dispatch/planner" },
        { label: "Driver Planner", to: "/dispatch/planners/driver" },
        { label: "Truck Planner", to: "/dispatch/planners/truck" },
        { label: "Loads Planner", to: "/dispatch/planners/loads" },
        { label: "Detention Board", to: "/dispatch/detention" },
        { label: "OCR Queue", to: "/dispatch/ocr-queue" },
        { label: "Equipment Transfers", to: "/dispatch/equipment-transfers" },
        { label: "Customer ETA Notify", to: "/dispatch/notify-preferences" },
        { label: "POD Review + BOL", to: "/dispatch/pod-review" },
        { label: "Dispatch Settings", to: "/dispatch/settings" },
        { label: "Geofencing", to: "/dispatch/geofencing" },
        { label: "Alerts", to: "/dispatch/alerts" },
        { label: "Border Crossing", to: "/dispatch/border-crossing" },
        { label: "Border History", to: "/dispatch/border-crossing/history" },
        { label: "Factoring Packets", to: "/accounting/factoring" },
        { label: "Factoring Queue", to: "/dispatch/factoring-queue" },
        { label: "Daily Tasks", to: "/daily-tasks" },
        { label: "Drivers", to: "/drivers" },
        { label: "Settlements", to: "/driver-finance/settlements" },
      ];
    case "lists":
      return [
        { label: "Lists & Catalogs", to: "/lists" },
        { label: "Names Master", to: "/lists/names" },
        { label: "Maintenance Services", to: "/lists/maintenance/services-catalog" },
      ];
    case "legal":
      return [
        { label: "Contracts", to: "/legal/contracts" },
        { label: "Templates", to: "/legal/templates" },
        { label: "Policies", to: "/legal/policies" },
        { label: "Attorney Review", to: "/legal/attorney-review" },
      ];
    case "help":
      return [
        { label: "Help Center", to: "/help" },
        { label: "Overview", to: "/help/overview" },
        { label: "Runbooks", to: "/help/runbooks" },
      ];
    case "users": {
      const rows: SidebarFlyoutLink[] = [
        { label: "Users", to: "/users" },
        { label: "Operator Onboarding", to: "/onboarding" },
      ];
      if (role === "Owner") {
        rows.push(
          { label: "Migration Status", to: "/admin/migration-status" },
          // "Integrity checks" (/admin/integrity) hidden — endpoint unshipped; module-specific
          // integrity dashboards already exist. Route kept; restore link when backend lands. (#29)
          { label: "Error monitor", to: "/admin/error-monitor" },
          { label: "Launch Readiness", to: "/admin/launch-readiness" },
          { label: "QBO Vendor Linkage", to: "/admin/qbo-vendor-linkage" }
        );
      }
      if (role === "Owner" || role === "SuperAdmin") {
        rows.push({ label: "Activity log", to: "/admin/activity" });
        rows.push({ label: "Audit log", to: "/admin/audit-log" });
        rows.push({ label: "Audit Trail", to: "/audit/trail" });
      }
      return rows;
    }
    case "tasks":
      return [
        { label: "Task Board", to: "/tasks" },
        { label: "Calendar", to: "/tasks/calendar" },
        { label: "My Tasks", to: "/tasks/mine" },
        { label: "Team Chat", to: "/tasks/chat" },
        { label: "Admin Report", to: "/tasks/report" },
      ];
    case "finance":
      return [
        { label: "Overview", to: "/finance/overview" },
        { label: "Hub", to: "/finance" },
        { label: "Projections", to: "/finance/projections" },
        { label: "Scenarios", to: "/finance/scenarios" },
        { label: "Statements", to: "/finance/statements" },
        // Finance Hub is now surfaced (un-hidden); this submenu renders. Loan Wizard / Calculator /
        // Amortization remain flag-gated TABS inside FinanceModuleTabs, so their flyout links are
        // route-reachability entries here while their visibility is controlled by the flags.
        { label: "Loan Wizard", to: "/finance/loan-wizard" },
        { label: "Calculator", to: "/finance/calculator" },
        { label: "Amortization", to: "/finance/amortization" },
        { label: "Load costs", to: "/accounting/load-costs" },
      ];
    case "inventory":
      return [
        { label: "Parts & Stock", to: "/inventory" },
        { label: "Assignments", to: "/inventory/assignments" },
        { label: "Purchase History", to: "/inventory/purchases" },
      ];
    case "driver-hub":
      return [
        { label: "Driver Hub Home", to: "/driver-hub" },
        { label: "Driver App", to: "/driver-app" },
      ];
    case "reports":
      return [
        { label: "Reports Home", to: "/reports" },
        { label: "Company Settlements", to: "/driver-finance/company-settlements" },
        { label: "Late Arrival Report", to: "/reports/late-arrival" },
      ];
    default:
      return [];
  }
}
