import type { NavItem } from "../../components/forms/shared/HoverDropdownNav";
import { COLLECTIONS_SUBNAV_ITEM } from "./subnav-collections";

/**
 * Accounting top-bar sub-nav — GROUPED click-open dropdowns.
 *
 * Source of truth (LOCKED): `docs/approved-screens/3-Accounting-Dropdown.png`
 * (Jorge, approved 2026-05) + `docs/specs/NAVIGATION-PATTERN-RULE.md` (Jorge directive
 * 2026-06-09: top-bar sub-nav groups open on CLICK and STAY OPEN until an item is chosen /
 * outside-click / Escape — NOT hover). Recorded in `docs/lockdown/00_LOCKED_DECISIONS.md`.
 *
 * The approved top row is exactly:
 *   Accounting · Bills ▾ · Expenses ▾ · Bill payment ▾ · Invoices ▾ · Maintenance & shop ▾ ·
 *   Vendors · Customers · Reports · More ▾
 * **ACCT-F5050 (owner 2026-08-13):** Invoices ▾ promoted from More overflow to a first-class top
 * node (peer of Bills / Expenses / Bill payment) — operators could not find the AR list when it was
 * buried in the alphabetized More ▾. Receive Payment / Undeposited Funds / AR Aging / Collections
 * travel with that group. Overflow **More ▾** keeps factoring / ledger / period / back-office /
 * catalogs so every routed accounting page stays reachable by a click.
 *
 * This grouped model SUPERSEDES the flat `ACCOUNTING_CLEAN_TABS` / `ACCOUNTING_MORE_TABS` tab bar that
 * the nav-unification (undocumented drift, PR #1552) rendered. Per CLAUDE.md §7/§9 the approved screen
 * wins over undocumented drift. `ACCOUNTING_CLEAN_TABS` / `ACCOUNTING_MORE_TABS` are RETAINED below as
 * exports ONLY because several CI guards still assert against them (verify-accounting-nav Check 2,
 * verify-ob1-nav-header-unify, verify-chain07-settlements-redirect, verify-daily-recon); they are NO
 * LONGER RENDERED. `SUBNAV_ITEMS` (with `path` + `section`) is the flat registry; `bySection()` is the
 * grouping primitive; `ACCOUNTING_SUB_NAV_ITEMS` is the single rendered nav model.
 *
 * Do NOT re-introduce a competing left-rail QBO subnav component — `QboAccountingSubNav.tsx` is
 * CI-enforced absent (`scripts/verify-accounting-nav.mjs` Check 7; CLAUDE.md §7: all nav on the top bar).
 */

export type AccountingSubNavSection =
  | "home"
  | "bills"
  | "expenses"
  | "billpay"
  | "invoices"
  | "maint_shop"
  | "vendors"
  | "customers"
  | "reports"
  | "more";

export type AccountingSubNavItem = {
  label: string;
  path: string;
  section: AccountingSubNavSection;
};

/** Approved top-node group labels (PNG source-of-truth). */
export const GROUP_LABELS = {
  home: "Accounting",
  bills: "Bills",
  expenses: "Expenses",
  billpay: "Bill payment",
  invoices: "Invoices",
  maint_shop: "Maintenance & shop",
  vendors: "Vendors",
  customers: "Customers",
  reports: "Reports",
  more: "More",
} as const satisfies Record<AccountingSubNavSection, string>;

/**
 * Flat registry of every accounting sub-nav destination + its primary group. Every `path` resolves to
 * a mounted route (or canonical redirect) — enforced by `scripts/verify-nav-integrity.mjs`.
 */
export const SUBNAV_ITEMS: readonly AccountingSubNavItem[] = [
  // Home
  { label: "Accounting", path: "/accounting", section: "home" },

  // Bills ▾ (PNG order)
  { label: "Bill", path: "/accounting/bills", section: "bills" },
  { label: "Maintenance bill", path: "/accounting/bills/maintenance", section: "bills" },
  { label: "Repair bill", path: "/accounting/bills/repair", section: "bills" },
  { label: "Fuel bill", path: "/accounting/bills/fuel", section: "bills" },
  { label: "Driver bill", path: "/accounting/bills/driver", section: "bills" },
  { label: "Vendor bill", path: "/accounting/bills/vendor", section: "bills" },
  { label: "Multiple bills", path: "/accounting/bills/multiple", section: "bills" },
  { label: "Recurring bills", path: "/accounting/bills/recurring", section: "bills" },

  // Expenses ▾ — browse first; bare route is the locked creator hub. /new is route-only legacy.
  { label: "Expenses List", path: "/accounting/expenses/list", section: "expenses" },
  { label: "Load costs", path: "/accounting/load-costs", section: "expenses" },
  { label: "Expenses", path: "/accounting/expenses", section: "expenses" },
  { label: "Receipts", path: "/accounting/receipts", section: "expenses" },

  // Bill payment ▾
  { label: "Bill payment", path: "/accounting/bill-payments", section: "billpay" },
  { label: "Vendor balances", path: "/accounting/vendor-balances", section: "billpay" },
  { label: "Vendor credits", path: "/accounting/vendor-credits", section: "billpay" },
  { label: "Accounts payable", path: "/accounting/accounts-payable", section: "billpay" },
  { label: "AP Aging", path: "/reports/ap-aging", section: "billpay" },

  // Maintenance & shop ▾
  { label: "Maintenance & shop", path: "/accounting/maintenance-shop", section: "maint_shop" },

  // Vendors / Customers / Reports (top-level leaves)
  { label: "Vendors", path: "/accounting/vendors", section: "vendors" },
  { label: "Customers", path: "/accounting/customers", section: "customers" },
  { label: "Reports", path: "/accounting/reports", section: "reports" },

  // Invoices ▾ — AR / receivables (ACCT-F5050 — promoted from More ▾)
  { label: "Invoices", path: "/accounting/invoices", section: "invoices" },
  { label: "Credit memos", path: "/accounting/credit-memos", section: "invoices" },
  { label: "Receive Payment", path: "/accounting/payments", section: "invoices" },
  { label: "Undeposited Funds", path: "/accounting/undeposited-funds", section: "invoices" },
  { label: "AR Aging", path: "/reports/ar-aging", section: "invoices" },
  COLLECTIONS_SUBNAV_ITEM,

  // More ▾ — factoring
  { label: "Factoring", path: "/accounting/factoring", section: "more" },
  { label: "Faro CSV import", path: "/factoring/faro-import", section: "more" },
  { label: "Factor reconciliation", path: "/accounting/factor-reconciliation", section: "more" },

  // More ▾ — reconciliation
  { label: "Daily Recon", path: "/accounting/daily-recon", section: "more" },
  { label: "Reconciliation", path: "/accounting/reconciliation", section: "more" },
  { label: "QBO reconcile", path: "/accounting/qbo-reconcile", section: "more" },

  // More ▾ — loans & advances. Backend (migrations 202611230000 / 202611260000, posting,
  // auto-deduct, reminder worker) shipped with no frontend door at all; this is that door.
  { label: "Loans & Advances", path: "/accounting/loans-advances", section: "more" },

  // More ▾ — settlements / driver finance
  { label: "Settlements", path: "/driver-finance/settlements", section: "more" },
  { label: "Pre-settlements", path: "/accounting/pre-settlements", section: "more" },
  { label: "Dispute queue", path: "/accounting/dispute-queue", section: "more" },
  { label: "Abandonment queue", path: "/accounting/abandonment-queue", section: "more" },
  { label: "Escrow", path: "/accounting/escrow", section: "more" },

  // More ▾ — ledger / transactions
  { label: "Journal entries", path: "/accounting/journal-entries", section: "more" },
  { label: "Account Register", path: "/accounting/account-register", section: "more" },
  { label: "All Transactions", path: "/accounting/transactions", section: "more" },
  { label: "Recurring transactions", path: "/accounting/recurring-transactions", section: "more" },
  { label: "Integration transactions", path: "/accounting/integration-transactions", section: "more" },

  // More ▾ — period / analysis
  { label: "Opening Balance Register", path: "/accounting/opening-balance-register", section: "more" },
  { label: "Sales tax", path: "/accounting/sales-tax", section: "more" },
  { label: "Month close", path: "/accounting/month-close", section: "more" },
  { label: "Period close", path: "/accounting/period-close", section: "more" },
  { label: "Period comparison", path: "/accounting/period-comparison", section: "more" },
  { label: "Cash forecast", path: "/accounting/cash-forecast", section: "more" },
  { label: "Multi-entity", path: "/accounting/multi-entity", section: "more" },

  // More ▾ — QBO-parity back office
  { label: "Revenue recognition", path: "/accounting/revenue-recognition", section: "more" },
  { label: "Fixed assets", path: "/accounting/fixed-assets", section: "more" },
  { label: "Allocations", path: "/accounting/allocations", section: "more" },
  { label: "Prepaid expenses", path: "/accounting/prepaid-expenses", section: "more" },
  { label: "My accountant", path: "/accounting/my-accountant", section: "more" },
  { label: "Payroll", path: "/accounting/payroll", section: "more" },

  // More ▾ — audit / lineage / sync
  { label: "Audit trail", path: "/accounting/audit-trail", section: "more" },
  { label: "Proof trail", path: "/accounting/proof-trail", section: "more" },
  { label: "Posting lineage", path: "/accounting/posting-lineage", section: "more" },
  { label: "Posting Templates", path: "/lists/accounting/posting-templates", section: "more" },
  { label: "QBO sync drift", path: "/accounting/qbo-sync", section: "more" },

  // More ▾ — catalogs / settings
  { label: "Chart of Accounts", path: "/lists/accounting/chart-of-accounts", section: "more" },
  { label: "Account Type Catalog", path: "/accounting/account-type-catalog", section: "more" },
  { label: "Detail Type", path: "/lists/accounting/detail-types", section: "more" },
  { label: "Payment methods catalog", path: "/accounting/payment-methods-catalog", section: "more" },
  { label: "Expense category map", path: "/accounting/settings/expense-category-map", section: "more" },
  { label: "CoA roles", path: "/accounting/settings/coa-roles", section: "more" },
] as const;

/** HOME quick-jump badge — every mounted accounting sub-nav destination. */
export const ACCOUNTING_HOME_QUICK_JUMP_COUNT = SUBNAV_ITEMS.length;

export function bySection(section: AccountingSubNavSection): AccountingSubNavItem[] {
  return SUBNAV_ITEMS.filter((item) => item.section === section);
}

function leafOf(path: string): { label: string; href: string } {
  const found = SUBNAV_ITEMS.find((item) => item.path === path);
  if (!found) throw new Error(`subnav-manifest: no registry entry for ${path}`);
  return { label: found.label, href: found.path };
}

function childrenOf(section: AccountingSubNavSection) {
  const items = bySection(section).map((item) => ({ label: item.label, href: item.path }));
  // ORPH-002 — the More ▾ overflow carries 44 entries. Source order is grouped by THEME (see the
  // `// More ▾ — AR / receivables`, `— factoring`, `— reconciliation` comments), which is useful to a
  // reader of this file and useless to an operator hunting one item in a 44-row dropdown. Sort ONLY
  // the overflow, and only at RENDER time, so the curated grouping + its comments survive in source.
  // The approved-PNG top nodes (Bills/Expenses/Bill payment/Maintenance & shop) keep their locked
  // order — More is the overflow bucket, not part of the approved screen.
  if (section === "more") {
    return [...items].sort((a, b) => a.label.localeCompare(b.label, "en", { sensitivity: "base" }));
  }
  return items;
}

/**
 * OB1 (RETAINED, NO LONGER RENDERED) — the pre-redesign flat QBO-parity tab bar. Kept as an export
 * because CI guards still assert its shape (see file header). The live render is
 * `ACCOUNTING_SUB_NAV_ITEMS` (grouped, below).
 */
export const ACCOUNTING_CLEAN_TABS = [
  { label: "Home",             to: "/accounting" },
  { label: "Bills",            to: "/accounting/bills" },
  { label: "Expenses List",    to: "/accounting/expenses/list" },
  { label: "Expenses",         to: "/accounting/expenses" },
  { label: "Bill Payment",     to: "/accounting/bill-payments" },
  { label: "Invoices",         to: "/accounting/invoices" },
  { label: "Receive Payment",  to: "/accounting/payments" },
  { label: "Settlements",      to: "/driver-finance/settlements" },
  { label: "Factoring",        to: "/accounting/factoring" },
  { label: "Journal Entries",  to: "/accounting/journal-entries" },
  { label: "Account Register", to: "/accounting/account-register" },
  { label: "A/P Aging",        to: "/accounting/accounts-payable" },
  { label: "All Transactions", to: "/accounting/transactions" },
  { label: "Daily Recon",      to: "/accounting/daily-recon" },
  { label: "Reports",          to: "/reports" },
] as const;

/** OB1 (RETAINED, NO LONGER RENDERED) — former "More ▾" back-office submenu. See file header. */
export const ACCOUNTING_MORE_TABS = [
  { label: "Chart of Accounts", to: "/lists/accounting/chart-of-accounts" },
  { label: "Month Close",       to: "/accounting/month-close" },
  { label: "Multi-entity",      to: "/accounting/multi-entity" },
  { label: "Audit Trail",       to: "/accounting/audit-trail" },
  { label: "Posting Lineage",   to: "/accounting/posting-lineage" },
  { label: "QBO Sync Drift",    to: "/accounting/qbo-sync" },
  { label: "Account Type Catalog", to: "/accounting/account-type-catalog" },
  { label: "Detail Type", to: "/lists/accounting/detail-types" },
  { label: "Payment Methods Catalog", to: "/accounting/payment-methods-catalog" },
  { label: "Settings",          to: "/accounting/settings/expense-category-map" },
] as const;

/**
 * LIVE rendered model — the approved grouped click-open sub-nav (PNG source-of-truth).
 * Rendered by `AccountingSubNavWrapper` through the shared `HoverDropdownNav` (openOn="click").
 *
 * Maintenance & shop ▾ surfaces the maintenance-shop overview plus the three shop-cost bill types as
 * contextual shortcuts (their primary home is Bills ▾, per the PNG) so the group has label-appropriate
 * content with no dead nodes.
 */
export const ACCOUNTING_SUB_NAV_ITEMS: readonly NavItem[] = [
  leafOf("/accounting"), // Accounting (Home)
  // Group labels navigate to the primary list (nav-split); chevron opens the dropdown.
  { label: GROUP_LABELS.bills, href: "/accounting/bills", children: childrenOf("bills") },
  { label: GROUP_LABELS.expenses, href: "/accounting/expenses/list", children: childrenOf("expenses") },
  // NAV-LOAD-COSTS-01 (owner 2026-09-06 04:5xZ "IN ACCOUNTING, WHERE ARE THE TABS?") — Load costs is a top-row leaf,
  // not only buried under Expenses ▾: it is the same board Dispatch → Load costs opens, with its own tab row.
  leafOf("/accounting/load-costs"),
  { label: GROUP_LABELS.billpay, href: "/accounting/bill-payments", children: childrenOf("billpay") },
  // ACCT-F5050 — Invoices ▾ peer of Bills / Expenses / Bill payment (group label → list).
  { label: GROUP_LABELS.invoices, href: "/accounting/invoices", children: childrenOf("invoices") },
  // NAV-RECEIVE-PAYMENT-01 — top-row leaf (not only under Invoices ▾). Owner reported missing
  // from the accounting nav row three times; route + hub tab already exist.
  leafOf("/accounting/payments"),
  {
    label: GROUP_LABELS.maint_shop,
    href: "/accounting/maintenance-shop",
    children: [
      leafOf("/accounting/maintenance-shop"),
      leafOf("/accounting/bills/maintenance"),
      leafOf("/accounting/bills/repair"),
      leafOf("/accounting/bills/fuel"),
    ],
  },
  leafOf("/accounting/vendors"), // Vendors
  leafOf("/accounting/customers"), // Customers
  leafOf("/accounting/reports"), // Reports
  // More stays chevron-only (no single default destination).
  { label: GROUP_LABELS.more, children: childrenOf("more") },
];
