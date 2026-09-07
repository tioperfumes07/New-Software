#!/usr/bin/env node
// B1 EXPAND-BOX guard (owner CONSOLIDATED 2026-09-06, item 4): "ParityTable.tsx
// [data-testid=parity-expand-toggle] measured 24x24, glyph 12px, no border. Required 28x28, 1px
// var(--ldt-rule) border, radius 4, glyph 16px, hover var(--ldt-accent-soft), aria-expanded;
// applies to every register." ParityTable is the ONE shared component every register renders
// through, so a single fix here covers them all — this guard pins that the toggle uses a
// dedicated box class (not the generic MIN_HIT_TARGET_CLASS every other 24x24 hit-target in the
// app also uses — widening that shared class would silently resize every checkbox/icon-button
// app-wide, not just this one control) and that the CSS actually delivers the 5 measurements.
//
// Usage: node scripts/verify-parity-expand-toggle-box.mjs [--selftest]

import { readFileSync } from "node:fs";

const COMPONENT = "apps/frontend/src/components/parity/ParityTable.tsx";
const CSS = "apps/frontend/src/styles/tokens-load-detail.css";

function auditComponent(src) {
  const f = [];
  const toggleMatch = src.match(/<button[\s\S]*?data-testid="parity-expand-toggle"[\s\S]*?<\/button>/);
  if (!toggleMatch) {
    f.push(`${COMPONENT}: could not find the parity-expand-toggle <button> at all`);
    return f;
  }
  const btn = toggleMatch[0];
  if (!/aria-expanded=\{isExpanded\}/.test(btn))
    f.push(`${COMPONENT}: parity-expand-toggle must carry aria-expanded={isExpanded}`);
  if (!/parity-expand-toggle-box/.test(btn))
    f.push(`${COMPONENT}: parity-expand-toggle must use the dedicated .parity-expand-toggle-box class (28x28/border/radius/hover), not the generic MIN_HIT_TARGET_CLASS`);
  return f;
}

// Isolates the .parity-expand-toggle-box{...} rule and its adjacent :hover{...} rule out of the
// full stylesheet, so selftest mutations only ever touch THIS pair's own text and can never
// collide with the many other unrelated "height: 28px;"/"border-radius: 4px;" style literals
// elsewhere in the file (the exact proximity-collision bug class this session hit repeatedly on
// non-global/non-scoped .replace() and .match()).
function extractRuleBlock(src) {
  const start = src.indexOf(".parity-expand-toggle-box {");
  if (start === -1) return null;
  const hoverStart = src.indexOf(".parity-expand-toggle-box:hover", start);
  if (hoverStart === -1) return null;
  const hoverEnd = src.indexOf("}", hoverStart) + 1;
  return src.slice(start, hoverEnd);
}

function auditCss(src) {
  const f = [];
  const block = extractRuleBlock(src);
  if (!block) {
    f.push(`${CSS}: .parity-expand-toggle-box + its :hover rule not found`);
    return f;
  }
  const ruleMatch = block.match(/\.parity-expand-toggle-box\s*\{([^}]*)\}/);
  const body = ruleMatch ? ruleMatch[1] : "";
  if (!/width:\s*28px/.test(body)) f.push(`${CSS}: .parity-expand-toggle-box must be 28px wide`);
  if (!/height:\s*28px/.test(body)) f.push(`${CSS}: .parity-expand-toggle-box must be 28px tall`);
  if (!/border:\s*1px solid var\(--ldt-rule\)/.test(body))
    f.push(`${CSS}: .parity-expand-toggle-box must have a 1px var(--ldt-rule) border`);
  if (!/border-radius:\s*4px/.test(body))
    f.push(`${CSS}: .parity-expand-toggle-box must have border-radius: 4px`);
  if (!/font-size:\s*16px/.test(body))
    f.push(`${CSS}: .parity-expand-toggle-box must render its glyph at font-size: 16px`);
  if (!/\.parity-expand-toggle-box:hover\s*\{[^}]*background:\s*var\(--ldt-accent-soft\)/.test(block))
    f.push(`${CSS}: .parity-expand-toggle-box:hover must set background: var(--ldt-accent-soft)`);
  return f;
}

function main() {
  const selftest = process.argv.includes("--selftest");
  const componentSrc = readFileSync(COMPONENT, "utf8");
  const cssSrc = readFileSync(CSS, "utf8");

  const failures = [...auditComponent(componentSrc), ...auditCss(cssSrc)];
  if (failures.length) {
    console.error("FAIL verify-parity-expand-toggle-box:");
    for (const x of failures) console.error(`  - ${x}`);
    process.exit(1);
  }

  if (selftest) {
    const mut1 = componentSrc.replace("aria-expanded={isExpanded}", "");
    if (auditComponent(mut1).length === 0) {
      console.error("SELFTEST FAIL: removing aria-expanded did not trip the guard");
      process.exit(1);
    }
    const mut2 = componentSrc.replace(
      'className="parity-expand-toggle-box flex items-center justify-center text-gray-500 hover:text-gray-800"',
      'className={`${MIN_HIT_TARGET_CLASS} text-gray-500 hover:text-gray-800`}'
    );
    if (auditComponent(mut2).length === 0) {
      console.error("SELFTEST FAIL: reverting to MIN_HIT_TARGET_CLASS did not trip the guard");
      process.exit(1);
    }
    // Every CSS mutation below rewrites ONLY the isolated block (never a bare cssSrc.replace),
    // so it can't accidentally land on an unrelated same-value literal elsewhere in the file.
    const block = extractRuleBlock(cssSrc);
    const mutateBlock = (find, replaceWith) => cssSrc.replace(block, block.replace(find, replaceWith));

    const mut3 = mutateBlock("width: 28px;", "width: 24px;");
    if (auditCss(mut3).length === 0) {
      console.error("SELFTEST FAIL: shrinking width back to 24px did not trip the guard");
      process.exit(1);
    }
    const mut4 = mutateBlock("height: 28px;", "height: 24px;");
    if (auditCss(mut4).length === 0) {
      console.error("SELFTEST FAIL: shrinking height back to 24px did not trip the guard");
      process.exit(1);
    }
    const mut5 = mutateBlock("border: 1px solid var(--ldt-rule);", "");
    if (auditCss(mut5).length === 0) {
      console.error("SELFTEST FAIL: removing the border did not trip the guard");
      process.exit(1);
    }
    const mut6 = mutateBlock("border-radius: 4px;", "");
    if (auditCss(mut6).length === 0) {
      console.error("SELFTEST FAIL: removing border-radius did not trip the guard");
      process.exit(1);
    }
    const mut7 = mutateBlock("font-size: 16px;", "font-size: 12px;");
    if (auditCss(mut7).length === 0) {
      console.error("SELFTEST FAIL: reverting the glyph to 12px did not trip the guard");
      process.exit(1);
    }
    const mut8 = mutateBlock("background: var(--ldt-accent-soft); }", "}");
    if (auditCss(mut8).length === 0) {
      console.error("SELFTEST FAIL: removing the hover state did not trip the guard");
      process.exit(1);
    }
    console.log("SELFTEST OK: guard trips on all 7 mutations");
  }

  console.log("PASS verify-parity-expand-toggle-box");
}

main();
