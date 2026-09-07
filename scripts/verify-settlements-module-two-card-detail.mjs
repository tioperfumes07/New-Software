#!/usr/bin/env node
// SETL-MOD-02 guard (owner ROUND 10). The Settlements-module DETAIL (?settlement_id=) must BE the
// approved Settlement design (docs/design/reference/LOAD-DETAIL-TABS-RENDERS-2026-09-05.html § Settlement
// + DRIVER-SETTLEMENT-DETAIL-REFERENCE-2026-09-05.html): a driver settlement card and a company
// settlement card side by side, using ONLY the .ldt-card / .ldt-ch / .ldt-rows classes from
// styles/tokens-load-detail.css (no local <style>, no Tailwind card re-styling), a GL account on every
// settlement line, a PDF link, and a frozen note when the tour is closed. It reuses TourSettlementTab
// by settlementId (the SAME readout the Load-costs board Settlement tab uses), so the two surfaces show
// one truth.
//
// --selftest mutates each load-bearing fact and requires each mutation to FAIL; the real sources pass.
import fs from "node:fs";

const DETAIL = "apps/frontend/src/pages/driver-finance/SettlementDetailPage.tsx";
const TAB = "apps/frontend/src/components/dispatch/TourSettlementTab.tsx";

function analyze(detail, tab) {
  const errors = [];

  // 1) The detail page mounts the approved design via TourSettlementTab keyed by settlementId.
  if (!/import\s*\{[^}]*\bTourSettlementTab\b[^}]*\}\s*from\s*["'][^"']*dispatch\/TourSettlementTab["']/.test(detail))
    errors.push("SettlementDetailPage does not import TourSettlementTab (must reuse the SAME readout as the board)");
  if (!/<TourSettlementTab\b[^>]*settlementId=\{settlementId\}/.test(detail))
    errors.push("SettlementDetailPage does not render <TourSettlementTab settlementId={settlementId} …>");
  if (!/settlement-detail-approved-design/.test(detail))
    errors.push("SettlementDetailPage lacks the approved-design wrapper (data-testid=settlement-detail-approved-design)");

  // 2) The approved design = driver card + company card SIDE BY SIDE, .ldt-* classes only.
  if (!/data-testid="driver-settlement-card"/.test(tab))
    errors.push("TourSettlementTab lacks the driver settlement card");
  if (!/data-testid="company-settlement-card"/.test(tab))
    errors.push("TourSettlementTab lacks the company settlement card");
  if (!/ldt-grid2/.test(tab))
    errors.push("TourSettlementTab does not lay the two cards side by side (ldt-grid2)");
  for (const cls of ["ldt-card", "ldt-ch", "ldt-rows"]) {
    if (!new RegExp(`\\b${cls}\\b`).test(tab)) errors.push(`TourSettlementTab does not use the ${cls} token class`);
  }
  // Palette LAW: the approved cards carry no local <style> block and no raw hex card styling.
  if (/<style\b/.test(tab)) errors.push("TourSettlementTab injects a local <style> (palette must come from tokens-load-detail.css only)");

  // 3) Driver card money spine: loaded × rate, empty × rate, gross, escrow, recoveries, net (5% floor).
  if (!/Loaded\b/.test(tab) || !/Empty\b/.test(tab)) errors.push("driver card missing Loaded/Empty line labels");
  if (!/data-testid="driver-gross"/.test(tab)) errors.push("driver card missing Gross line");
  if (!/Escrow/.test(tab)) errors.push("driver card missing Escrow line");
  if (!/Recoveries/.test(tab)) errors.push("driver card missing Recoveries line");
  if (!/5% floor/.test(tab) || !/data-testid="driver-net"/.test(tab)) errors.push("driver card missing Net pay · 5% floor line");

  // 4) Company card money spine: revenue, costs, driver pay, factoring, margin with $/mi practical AND real.
  if (!/Revenue/.test(tab)) errors.push("company card missing Revenue line");
  if (!/Costs/.test(tab)) errors.push("company card missing Costs line");
  if (!/Driver pay/.test(tab)) errors.push("company card missing Driver pay line");
  if (!/Factoring/.test(tab)) errors.push("company card missing Factoring line");
  if (!/data-testid="company-margin"/.test(tab) || !/practical/.test(tab) || !/real/.test(tab))
    errors.push("company card missing Margin with $/mi practical AND real");

  // 5) GL account on every settlement line, PDF link, frozen note when closed.
  if (!/account_label/.test(tab) || !/no account/.test(tab))
    errors.push("TourSettlementTab does not surface the GL account on each line (account_label / 'no account')");
  if (!/data-testid="settlement-pdf-link"/.test(tab)) errors.push("TourSettlementTab lacks the Settlement PDF link");
  if (!/frozen/.test(tab) || !/reversing entry/.test(tab))
    errors.push("TourSettlementTab lacks the closed=frozen note (corrections are a reversing entry)");

  return errors;
}

const detail = fs.readFileSync(DETAIL, "utf8");
const tab = fs.readFileSync(TAB, "utf8");

if (process.argv.includes("--selftest")) {
  const clean = analyze(detail, tab);
  if (clean.length) {
    console.error(`SELFTEST FAIL — clean source rejected:\n- ${clean.join("\n- ")}`);
    process.exit(1);
  }
  const mutations = [
    ["drop TourSettlementTab import", [detail.replace(/import\s*\{[^}]*\bTourSettlementTab\b[^}]*\}\s*from\s*["'][^"']*dispatch\/TourSettlementTab["'];?/, ""), tab]],
    ["unmount approved design", [detail.replace(/<TourSettlementTab\b[^>]*settlementId=\{settlementId\}[^>]*\/>/, "<Nope />"), tab]],
    ["remove approved wrapper testid", [detail.replace(/settlement-detail-approved-design/g, "x-removed"), tab]],
    ["drop company card", [detail, tab.replace(/data-testid="company-settlement-card"/g, "data-testid=\"x\"")]],
    ["drop ldt-grid2 side-by-side", [detail, tab.replace(/ldt-grid2/g, "x-grid")]],
    ["inject local style block", [detail, tab.replace("return <div", "return <div><style>{`.x{}`}</style>").replace(/;\s*}\s*$/, "; }")]],
    ["drop GL account on lines", [detail, tab.replace(/account_label/g, "x_label").replace(/no account/g, "x")]],
    ["drop PDF link", [detail, tab.replace(/data-testid="settlement-pdf-link"/g, "data-testid=\"x\"")]],
    ["drop frozen note", [detail, tab.replace(/reversing entry/g, "an edit")]],
    ["drop 5% floor net", [detail, tab.replace(/5% floor/g, "").replace(/data-testid="driver-net"/g, "data-testid=\"x\"")]],
    ["drop margin practical/real", [detail, tab.replace(/data-testid="company-margin"/g, "data-testid=\"x\"")]],
  ];
  let caught = 0;
  for (const [label, [d, t]] of mutations) {
    if (analyze(d, t).length > 0) { caught += 1; continue; }
    console.error(`SELFTEST FAIL — mutation escaped: ${label}`);
    process.exit(1);
  }
  console.log(`PASS verify-settlements-module-two-card-detail --selftest ${caught}/${mutations.length}`);
  process.exit(0);
}

const failures = analyze(detail, tab);
if (failures.length) {
  console.error("FAIL verify-settlements-module-two-card-detail");
  failures.forEach((f) => console.error(`- ${f}`));
  process.exit(1);
}
console.log("PASS verify-settlements-module-two-card-detail");
