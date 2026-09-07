import { NavyPageSubNav, type NavyPageSubNavItem, type NavySubNavChild } from "../../components/layout/NavyPageSubNav";
import { buildCatalogPath, DOMAIN_CONFIG } from "./components/AllCatalogsMap";

const DOMAIN_ORDER = ["safety", "maintenance", "dispatch", "fuel", "drivers", "fleet", "accounting", "names_master"] as const;

const DOMAIN_LABELS: Record<(typeof DOMAIN_ORDER)[number], string> = {
  safety: "Safety",
  maintenance: "Maintenance",
  dispatch: "Dispatch",
  fuel: "Fuel",
  drivers: "Drivers",
  fleet: "Fleet",
  accounting: "Accounting",
  names_master: "Names master",
};

/** Live catalogs for a domain from DOMAIN_CONFIG — hub + subnav must not diverge (LST-F100/F101). */
function domainCatalogNavChildren(domainKey: string): NavySubNavChild[] {
  const domain = DOMAIN_CONFIG.find((d) => d.key === domainKey);
  if (!domain) return [];
  const seen = new Set<string>();
  const children: NavySubNavChild[] = [];
  for (const catalog of domain.catalogs) {
    if (!catalog.live || !catalog.catalogKey) continue;
    if (seen.has(catalog.catalogKey)) continue;
    seen.add(catalog.catalogKey);
    children.push({
      label: catalog.name,
      to: buildCatalogPath(domainKey, catalog.catalogKey),
    });
  }
  return children;
}

const SAFETY_CATALOG_CHILDREN = domainCatalogNavChildren("safety");
const SAFETY_CATALOG_HREF =
  SAFETY_CATALOG_CHILDREN[0]?.to ?? "/lists/safety/internal-fine-reasons";

const FLEET_CATALOG_CHILDREN = domainCatalogNavChildren("fleet");
const FLEET_CATALOG_HREF = FLEET_CATALOG_CHILDREN[0]?.to ?? "/lists/fleet";

const DISPATCH_CATALOG_CHILDREN = domainCatalogNavChildren("dispatch");
const DISPATCH_CATALOG_HREF = DISPATCH_CATALOG_CHILDREN[0]?.to ?? "/lists/dispatch";

/**
 * /lists module top sub-nav (invariant #20). Domain + safety/fleet/dispatch catalog links mirror
 * DomainRibbon / hub destinations; nothing removed from existing list UX.
 */
export const LISTS_SUB_NAV_ITEMS: NavyPageSubNavItem[] = [
  { label: "Lists & Catalogs", to: "/lists" },
  { label: "Names Master", to: "/lists/names" },
  { label: "Locations", to: "/lists/locations" },
  { label: "Catalog Index", to: "/lists/catalogs" },
  {
    label: "Catalog domains",
    to: "/lists",
    children: DOMAIN_ORDER.map((domain) => ({
      label: DOMAIN_LABELS[domain],
      to: `/lists/hub/${domain}`,
    })),
  },
  {
    label: "Safety catalogs",
    to: SAFETY_CATALOG_HREF,
    children: [
      { label: "Internal Fine Reasons", to: "/lists/safety/internal-fine-reasons" },
      { label: "Civil Fine Types", to: "/lists/safety/civil-fine-types" },
      { label: "Company Violation Types", to: "/lists/safety/company-violation-types" },
      ...SAFETY_CATALOG_CHILDREN.filter(
        (child) =>
          child.label !== "Internal Fine Reasons" &&
          child.label !== "Civil Fine Types" &&
          child.label !== "Company Violation Types"
      ),
    ],
  },
  {
    label: "Fleet catalogs",
    to: FLEET_CATALOG_HREF,
    children: FLEET_CATALOG_CHILDREN,
  },
  {
    label: "Dispatch catalogs",
    to: DISPATCH_CATALOG_HREF,
    children: DISPATCH_CATALOG_CHILDREN,
  },
  {
    label: "Maintenance catalogs",
    to: "/lists/maintenance/parts-catalog",
    children: [
      { label: "Parts Catalog", to: "/lists/maintenance/parts-catalog" },
    ],
  },
];

export function listsSubNavActiveHref(pathname: string): string {
  const norm = pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  if (norm === "/lists") return "/lists";
  if (norm.startsWith("/lists/names")) return "/lists/names";
  if (norm.startsWith("/lists/locations")) return "/lists/locations";
  if (norm.startsWith("/lists/hub/")) return "/lists";
  if (norm.startsWith("/lists/catalogs")) return "/lists/catalogs";
  if (norm.startsWith("/lists/maintenance/parts-catalog")) return "/lists/maintenance/parts-catalog";
  for (const child of [...SAFETY_CATALOG_CHILDREN, ...FLEET_CATALOG_CHILDREN, ...DISPATCH_CATALOG_CHILDREN]) {
    if (norm === child.to || norm.startsWith(`${child.to}/`)) return child.to;
  }
  for (const domain of DOMAIN_ORDER) {
    const prefix = `/lists/${domain}`;
    if (norm === prefix || norm.startsWith(`${prefix}/`)) return prefix;
  }
  return norm;
}

export function ListsSubNav() {
  return <NavyPageSubNav items={LISTS_SUB_NAV_ITEMS} />;
}
