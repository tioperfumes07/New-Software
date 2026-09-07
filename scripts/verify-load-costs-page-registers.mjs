#!/usr/bin/env node
/**
 * LCB-REG (owner 2026-09-05, "the Documents tab is a note"). Before this guard, Broker advances
 * and Documents rendered a static <p> instead of a real register, and the Driver pay register's
 * own fetcher silently always returned empty (listDriverBills() returns { driver_bills }, this
 * file read .rows). This guard locks all four fetchers to their REAL source and forbids the note
 * from ever coming back, comments masked so a fixture's own prose can't fool the scan.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { maskComments } from "./lib/mask-comments.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const LABEL = "verify-load-costs-page-registers";
const PAGE = "apps/frontend/src/pages/accounting/LoadCostsBoardPage.tsx";

function read(rel, root = ROOT) {
  return maskComments(readFileSync(join(root, rel), "utf8"));
}

/** The new-register source region only -- from the driver-pay columns through the Documents
 *  column factory -- so the hex-free check never trips on the pre-existing board table above it
 *  (additive-only law: this task's OWN new work stays .ldt-* only; the older board section is out
 *  of scope and not touched here). */
function newRegisterRegion(src) {
  const start = src.indexOf("function milesRateCell");
  const end = src.indexOf("const REGISTER_LIMIT");
  if (start < 0 || end < 0 || end <= start) return null;
  return src.slice(start, end);
}

export function collectProblems(root = ROOT) {
  const problems = [];
  let src;
  try {
    src = read(PAGE, root);
  } catch {
    return [`missing ${PAGE}`];
  }

  // 1. The two previously-inert tabs must never fall back to the old static note again.
  if (/data-testid="reg-note"/.test(src)) {
    problems.push(`${PAGE}: "reg-note" must not exist -- Broker advances and Documents render real registers now, never a static note`);
  }

  // 2. Each of the four real fetchers this task exists to wire up, present and reachable.
  if (!/listBrokerAdvances\(companyId\)/.test(src)) {
    problems.push(`${PAGE}: Broker advances tab must call listBrokerAdvances(companyId) -- the real GET /api/v1/accounting/broker-advances register`);
  }
  if (!/\/api\/v1\/accounting\/load-costs-board\/documents/.test(src)) {
    problems.push(`${PAGE}: Documents tab must call the real load-costs-board/documents endpoint (documents.attachments + docs.file_links)`);
  }
  if (!/res\.driver_bills/.test(src)) {
    problems.push(`${PAGE}: Driver pay must read listDriverBills()'s real "driver_bills" field -- reading ".rows" (the old bug) leaves this register always empty`);
  }
  if (!/loadedMiles:/.test(src) || !/loadedRateCents:/.test(src) || !/emptyMiles:/.test(src) || !/emptyRateCents:/.test(src)) {
    problems.push(`${PAGE}: Driver pay rows must carry the SET-RATE breakdown fields (loadedMiles/loadedRateCents/emptyMiles/emptyRateCents), not just a lump amount`);
  }
  if (!/company_fuel_advance_expense/.test(src)) {
    problems.push(`${PAGE}: Fuel advances must include company fuel-advance EXPENSES (the company_fuel_advance_expense CoA role), not cash advances alone`);
  }
  if (!/listCashAdvances\(companyId/.test(src)) {
    problems.push(`${PAGE}: Fuel advances must still include cash advances alongside the company-expense rows`);
  }

  // 3. "Which is which" labelling on the merged fuel-advances feed -- two real transaction kinds,
  // never rendered identically.
  if (!/Fuel cash advance/.test(src) || !/Company fuel expense/.test(src)) {
    problems.push(`${PAGE}: the merged fuel-advances register must label which row is a cash advance and which is a company expense`);
  }

  // 4. Palette rule (owner 2026-09-05): this task's own new register code is .ldt-* only, no new
  // hex. Scoped to the new-register region so the pre-existing (untouched) board table above it
  // is never flagged.
  const region = newRegisterRegion(src);
  if (!region) {
    problems.push(`${PAGE}: could not locate the new-register source region (DRIVER_PAY_COLUMNS .. REGISTER_LIMIT) -- guard scoping assumption broke`);
  } else {
    const hexMatches = region.match(/#[0-9a-fA-F]{3,8}\b/g);
    if (hexMatches) {
      problems.push(`${PAGE}: new register code must use .ldt-* classes only, no hex -- found ${[...new Set(hexMatches)].join(", ")}`);
    }
  }

  return problems;
}

function fail(messages) {
  console.error(`${LABEL} FAIL:`);
  for (const m of messages) console.error(`  - ${m}`);
  process.exit(1);
}

if (process.argv.includes("--selftest")) {
  const baseline = collectProblems();
  if (baseline.length) fail(baseline);

  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");

  const GOOD = read(PAGE);

  const cases = [
    { name: "good fixture (the real file)", mutate: (src) => src, expectProblems: 0 },
    {
      name: "Broker advances swapped back to the static note (the exact regression this guard exists to catch)",
      mutate: (src) => src.replace(
        /if \(tab === "broker_advances"\) \{[\s\S]*?\n      \}/,
        `if (tab === "broker_advances") { return [{ id: "x", number: "—", date: null, party: "—", loadNumber: null, loadId: null, detail: "note", amountCents: 0, status: "" }]; } // data-testid="reg-note"`
      ),
      expectProblems: 1,
    },
    { name: "listBrokerAdvances call removed", mutate: (src) => src.replace("listBrokerAdvances(companyId)", "listNothing(companyId)"), expectProblems: 1 },
    { name: "documents endpoint call removed", mutate: (src) => src.replace("/api/v1/accounting/load-costs-board/documents", "/api/v1/nowhere"), expectProblems: 1 },
    { name: "driver_bills field reverted to the old .rows bug", mutate: (src) => src.replace("res.driver_bills", "res.rows"), expectProblems: 1 },
    { name: "SET-RATE breakdown fields removed from driver_pay rows", mutate: (src) => src.replace("loadedMiles:", "loadedMilesX:"), expectProblems: 1 },
    { name: "fuel-advances company-expense merge removed", mutate: (src) => src.replace(/company_fuel_advance_expense/g, "removed_role"), expectProblems: 1 },
    { name: "cash advances dropped from the fuel-advances merge", mutate: (src) => src.replace("listCashAdvances(companyId", "listNothing(companyId"), expectProblems: 1 },
    { name: "'which is which' labels removed", mutate: (src) => src.replace("Fuel cash advance", "Fuel row").replace("Company fuel expense", "Fuel row"), expectProblems: 1 },
    {
      name: "a new hex colour reintroduced into the new-register region",
      mutate: (src) => src.replace('className="ldt-sub" style={{ display: "inline" }}>×', 'style={{ color: "#9CA3AF" }}>×'),
      expectProblems: 1,
    },
  ];

  for (const { name, mutate, expectProblems } of cases) {
    const mutated = mutate(GOOD);
    if (expectProblems > 0 && mutated === GOOD) {
      console.error(`${LABEL} SELFTEST FAIL: case "${name}" fixture text is stale -- mutate() made no change`);
      process.exit(1);
    }
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "load-costs-page-registers-guard-"));
    try {
      const full = path.join(tmpRoot, PAGE);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, mutated);
      const problems = collectProblems(tmpRoot);
      if (problems.length !== expectProblems) {
        console.error(
          `${LABEL} SELFTEST FAIL: case "${name}" expected ${expectProblems} problem(s), got ${problems.length}: ${JSON.stringify(problems)}`
        );
        process.exit(1);
      }
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  }
  console.log(`${LABEL} SELFTEST OK (${cases.length}/${cases.length} cases)`);
} else {
  const problems = collectProblems();
  if (problems.length > 0) fail(problems);
  console.log(`${LABEL} OK — Broker advances/Documents/Driver pay/Fuel advances all render real registers, no static note, no new hex`);
}
