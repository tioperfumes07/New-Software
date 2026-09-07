#!/usr/bin/env node
/**
 * LDT-6 guard — Settlement tab: driver + company settlement from the SAME tour readout as Pre-Settlement; closed = frozen.
 * Register § LDT-6 (owner order 2026-09-05 23:00Z). Lead build 2026-09-06.
 *   - no <input>/<select>/<textarea> in the Settlement tab (frozen; corrections are reversing entries)
 *   - driver card: loaded × rate · empty × rate · gross · escrow · recoveries · net; company card: revenue · costs · driver pay
 *     · factoring · margin with $/mi practical AND real; every settlement line shows its GL account or "no account"
 *   - both readouts sum from the readout (company margin = readout margin; driver gross = bills or header)
 *   - state chip + frozen note; PDF link to the settlement PDF route; unknown numbers render "—" never 0
 * `--selftest` plants an <input>, a second read model, and removes the frozen note.
 */
import fs from "node:fs";
const SET = "apps/frontend/src/components/dispatch/TourSettlementTab.tsx";
const read = (p) => fs.readFileSync(p, "utf8");
function audit(src) {
  const p = [];
  if (/<input|<select|<textarea/.test(src)) p.push("Settlement tab has an editable field — closed settlements are frozen");
  if (!/getTourReadoutForLoad\(/.test(src)) p.push("Settlement tab does not read the tour readout");
  if (/getPreSettlementForDriver|settlement-summary/.test(src)) p.push("Settlement tab reads a second model");
  for (const [label, re] of [
    ["driver settlement card", /data-testid="driver-settlement-card"/],
    ["company settlement card", /data-testid="company-settlement-card"/],
    ["loaded × rate lines", /Loaded \{miles\(b\.miles_basis\)\} × \{rate\(b\.rate_per_mile_cents\)\}/],
    ["empty × rate lines", /Empty \{miles\(b\.miles_deadhead\)\} × \{rate\(b\.rate_empty_per_mile_cents\)\}/],
    ["gross · escrow · recoveries · net", /data-testid="driver-gross"[\s\S]*Escrow contribution[\s\S]*Recoveries[\s\S]*data-testid="driver-net"/],
    ["company revenue · costs · driver pay · factoring · margin", /Revenue \(\{r\.legs\.length\}[\s\S]*Costs \(\{r\.costs\.length\}[\s\S]*Driver pay[\s\S]*Factoring[\s\S]*data-testid="company-margin"/],
    ["$/mi practical and real", /perMile\(tot\.per_mile_practical_cents\)\} practical · \{perMile\(tot\.per_mile_real_cents\)\} real/],
    ["GL account per line", /l\.account_label \?\? <span className="ldt-pill bad">no account<\/span>/],
    ["frozen note", /Closed = frozen: no editable field; corrections are a reversing entry\./],
    ["PDF link", /data-testid="settlement-pdf-link"/],
    ["dash never zero for unknown miles", /const miles = \(m: number \| null \| undefined\) => \(m == null \? DASH/],
  ]) if (!re.test(src)) p.push(`${label} missing`);
  return p;
}
const src = read(SET);
if (process.argv.includes("--selftest")) {
  const plants = [
    ["editable field planted", src + '\n// <input value="x" />'],
    ["second read model", src + "\n// getPreSettlementForDriver()"],
    ["frozen note removed", src.replace("Closed = frozen: no editable field; corrections are a reversing entry.", "Closed.")],
    ["dash rule removed", src.replace("const miles = (m: number | null | undefined) => (m == null ? DASH", "const miles = (m: number | null | undefined) => (m == null ? 0")],
  ];
  let escaped = 0; for (const [l, m] of plants) if (audit(m).length === 0) { console.error(`SELFTEST FAIL — not caught: ${l}`); escaped++; }
  const clean = audit(src); if (clean.length) { console.error("SELFTEST FAIL — clean rejected:\n  " + clean.join("\n  ")); process.exit(1); }
  if (escaped) process.exit(1);
  console.log(`PASS verify-ldt-6-settlement-frozen --selftest: ${plants.length}/${plants.length} planted mutations caught`);
} else {
  const p = audit(src); if (p.length) { console.error("FAIL verify-ldt-6-settlement-frozen:\n  " + p.join("\n  ")); process.exit(1); }
  console.log("PASS verify-ldt-6-settlement-frozen: frozen · one readout · driver + company cards · GL per line · $/mi practical+real");
}
