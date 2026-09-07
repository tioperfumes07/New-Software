#!/usr/bin/env node
// VC-10 / VC-LIST-02 guard (owner "ALL PAGE SIZE", 2026-09-06).
//
// MEASURED: components/shared/SidebarPagination.tsx page-size options were [25, 50, 100, 250] with no
// "All", and Vendors/Customers held the sidebar page size in a bare useState(50) that reset on reload.
// The owner ordered an "All" page size on BOTH the vendor and customer master-detail lists, and the
// chosen size must persist across reloads.
//
// END STATE this guard pins:
//   1. SidebarPagination exports the ALL_PAGE_SIZE sentinel, accepts an `allowAll` prop, and — when
//      allowAll — renders an "All" <option> whose value is ALL_PAGE_SIZE (so the whole roster shows).
//   2. Both VendorListSidebar and CustomerListSidebar pass `allowAll` to SidebarPagination.
//   3. Both Vendors.tsx and Customers.tsx source the sidebar page size from the PERSISTED
//      useListPageSizePref hook (not a bare useState), so the size survives a reload.
//   4. useListPageSizePref actually persists to localStorage.
//
// --selftest mutates each load-bearing fact and requires each mutation to FAIL; clean sources pass.
import fs from "node:fs";

const PAGER = "apps/frontend/src/components/shared/SidebarPagination.tsx";
const HOOK = "apps/frontend/src/hooks/useListPageSizePref.ts";
const VSIDEBAR = "apps/frontend/src/pages/vendors/VendorListSidebar.tsx";
const CSIDEBAR = "apps/frontend/src/pages/customers/CustomerListSidebar.tsx";
const VPAGE = "apps/frontend/src/pages/Vendors.tsx";
const CPAGE = "apps/frontend/src/pages/Customers.tsx";

function analyze(src) {
  const { pager, hook, vsidebar, csidebar, vpage, cpage } = src;
  const errors = [];

  // 1. SidebarPagination: ALL_PAGE_SIZE sentinel + allowAll prop + rendered "All" option.
  if (!/export const ALL_PAGE_SIZE\b/.test(pager))
    errors.push("SidebarPagination must export the ALL_PAGE_SIZE sentinel");
  if (!/allowAll\b/.test(pager))
    errors.push("SidebarPagination must accept an allowAll prop");
  if (!/allowAll\s*\?[\s\S]*?value=\{ALL_PAGE_SIZE\}[\s\S]*?All/.test(pager))
    errors.push("SidebarPagination must render an 'All' option (value ALL_PAGE_SIZE) when allowAll");

  // 2. Both sidebars opt in.
  if (!/allowAll/.test(vsidebar))
    errors.push("VendorListSidebar must pass allowAll to SidebarPagination");
  if (!/allowAll/.test(csidebar))
    errors.push("CustomerListSidebar must pass allowAll to SidebarPagination");

  // 3. Both pages use the persisted hook for the sidebar page size (no bare useState reset-on-reload).
  if (!/useListPageSizePref\(\s*"vendors"/.test(vpage))
    errors.push("Vendors.tsx must source sidebar page size from useListPageSizePref('vendors') (persisted)");
  if (!/useListPageSizePref\(\s*"customers"/.test(cpage))
    errors.push("Customers.tsx must source sidebar page size from useListPageSizePref('customers') (persisted)");

  // 4. The hook actually persists.
  if (!/localStorage\.setItem/.test(hook))
    errors.push("useListPageSizePref must persist the page size to localStorage");

  return errors;
}

const base = {
  pager: fs.readFileSync(PAGER, "utf8"),
  hook: fs.readFileSync(HOOK, "utf8"),
  vsidebar: fs.readFileSync(VSIDEBAR, "utf8"),
  csidebar: fs.readFileSync(CSIDEBAR, "utf8"),
  vpage: fs.readFileSync(VPAGE, "utf8"),
  cpage: fs.readFileSync(CPAGE, "utf8"),
};

function withField(field, transform) {
  return { ...base, [field]: transform(base[field]) };
}

if (process.argv.includes("--selftest")) {
  const clean = analyze(base);
  if (clean.length) {
    console.error(`SELFTEST FAIL — clean source rejected:\n- ${clean.join("\n- ")}`);
    process.exit(1);
  }
  const mutations = [
    ["pager drops ALL_PAGE_SIZE export", withField("pager", (s) => s.replace(/export const ALL_PAGE_SIZE\b/g, "const GONE_SIZE"))],
    ["pager drops allowAll prop", withField("pager", (s) => s.replace(/allowAll/g, "noAll"))],
    ["pager drops rendered All option", withField("pager", (s) => s.replace(/value=\{ALL_PAGE_SIZE\}/g, "value={999}"))],
    ["vendor sidebar drops allowAll", withField("vsidebar", (s) => s.replace(/allowAll/g, "noAll"))],
    ["customer sidebar drops allowAll", withField("csidebar", (s) => s.replace(/allowAll/g, "noAll"))],
    ["vendors page not persisted", withField("vpage", (s) => s.replace(/useListPageSizePref\(\s*"vendors"/g, 'useState(50); void ("vendors"'))],
    ["customers page not persisted", withField("cpage", (s) => s.replace(/useListPageSizePref\(\s*"customers"/g, 'useState(50); void ("customers"'))],
    ["hook stops persisting", withField("hook", (s) => s.replace(/localStorage\.setItem/g, "void 0; noStore"))],
  ];
  let caught = 0;
  for (const [label, mutated] of mutations) {
    if (analyze(mutated).length > 0) { caught += 1; continue; }
    console.error(`SELFTEST FAIL — mutation escaped: ${label}`);
    process.exit(1);
  }
  console.log(`PASS verify-list-page-size-all --selftest ${caught}/${mutations.length}`);
  process.exit(0);
}

const failures = analyze(base);
if (failures.length) {
  console.error("FAIL verify-list-page-size-all");
  failures.forEach((f) => console.error(`- ${f}`));
  process.exit(1);
}
console.log("PASS verify-list-page-size-all");
