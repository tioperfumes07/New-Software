#!/usr/bin/env node
// DISPATCH-IN-SHOP-FEED guard — the List/Table "In shop" section must bind to the live maintenance
// narrow maintenance in-shop feed, NOT the broad fleet-table roster or an empty fixture array.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");
const fail = (m) => {
  console.error(`FAIL verify-dispatch-in-shop-feed-wired: ${m}`);
  process.exit(1);
};
const selftest = process.argv.includes("--selftest");

function usesCanonicalInShopEndpoint(source) {
  return source.includes("/api/v1/maintenance/in-shop-units")
    && !source.match(/listDispatchInShopUnits[\s\S]{0,240}\/api\/v1\/maintenance\/fleet-table\/rows/);
}

function awaitingCountUsesRenderedRows(source) {
  const assignment = source.match(/const awaitingTruckCount\s*=([\s\S]{0,260}?);/)?.[1] ?? "";
  return /boardSections\.find\(\(section\) => section\.key === "awaiting"\)\?\.rows\.length/.test(assignment)
    && !/unassignedUnits\.length/.test(assignment);
}

const api = read("apps/frontend/src/api/dispatch.ts");
if (!api.includes("listDispatchInShopUnits")) fail("dispatch api must export listDispatchInShopUnits");
if (!api.includes("isDispatchInShopUnit")) fail("dispatch api must export isDispatchInShopUnit");
if (!usesCanonicalInShopEndpoint(api)) fail("in-shop feed must use the single narrow /api/v1/maintenance/in-shop-units endpoint");

const board = read("apps/frontend/src/pages/dispatch/DispatchBoard.tsx");
if (board.includes("In-shop (maintenance) feed pending")) {
  fail("hardcoded in-shop placeholder text must be removed");
}
if (!board.includes("listDispatchInShopUnits")) fail("DispatchBoard must fetch in-shop units via listDispatchInShopUnits");
if (!board.includes("isDispatchInShopUnit")) fail("DispatchBoard must filter in-shop units with isDispatchInShopUnit");
if (!board.includes("inShopUnitToBoardRow")) fail("DispatchBoard must map in-shop units via inShopUnitToBoardRow");
if (!/meta\.key === "in_shop"[\s\S]{0,120}\? inShopRows/.test(board)) {
  fail('boardSections must wire meta.key === "in_shop" to inShopRows (not an empty [] stub)');
}
if (/key:\s*"in_shop"[\s\S]{0,200}rows:\s*\[\]/.test(board)) {
  fail("in_shop section must not hardcode rows: [] in SECTION_META / boardSections");
}
if (!awaitingCountUsesRenderedRows(board)) {
  fail("awaitingTruckCount must use the same filtered rows rendered in the Awaiting section");
}
if (/const awaitingTruckCount\s*=\s*unassignedUnits\.length/.test(board)) {
  fail("awaitingTruckCount must not count raw unassignedUnits because in-shop units are filtered from visible awaiting rows");
}
if (!board.includes("inShopUnitsQuery.isError")) {
  fail("DispatchBoard must branch on inShopUnitsQuery.isError for failed in-shop feed loads");
}
if (!/const inShopUnits = inShopUnitsQuery\.isError \? \[\] : \(inShopUnitsQuery\.data \?\? \[\]\)/.test(board)) {
  fail("failed in-shop feed must suppress stale rows and section counts");
}
if (!board.includes("Couldn't load in-shop units")) {
  fail("in-shop feed failure must render an explicit error surface, not an empty placeholder");
}
if (selftest) {
  const mutations = [
    board.replace("inShopUnitsQuery.isError ? [] :", "false ? [] :"),
    board.replace(
      'boardSections.find((section) => section.key === "awaiting")?.rows.length ?? 0',
      "unassignedUnits.length",
    ),
    api.replace("/api/v1/maintenance/in-shop-units", "/api/v1/maintenance/fleet-table/rows"),
  ];
  if (/const inShopUnits = inShopUnitsQuery\.isError \? \[\] :/.test(mutations[0])) {
    fail("selftest stale-row mutation escaped");
  }
  if (awaitingCountUsesRenderedRows(mutations[1])) {
    fail("selftest awaiting-count mutation escaped");
  }
  if (usesCanonicalInShopEndpoint(mutations[2])) {
    fail("selftest broad fleet-table endpoint mutation escaped");
  }
  console.log("PASS verify-dispatch-in-shop-feed-wired SELFTEST — 3/3 mutations red");
  process.exit(0);
}

console.log("PASS verify-dispatch-in-shop-feed-wired");
