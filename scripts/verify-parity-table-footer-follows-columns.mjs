#!/usr/bin/env node
/**
 * DSP-TBL (owner ruling 2026-09-05) — ParityTable footer must follow the columns.
 *
 * Before: `footer?: ReactNode` was rendered as one raw <tr> the caller hand-built — column
 * reorder/resize/hide re-laid-out thead/tbody only, so a moved or hidden column's total stayed
 * frozen in its old slot (or kept showing after the column was hidden). `footerCells` fixes this
 * by rendering the footer from the SAME ordered `visibleColumns` list the header <th> loop uses,
 * one <td> per visible column, in its column's own slot — by construction, not by convention.
 *
 * Static checks (source-of-truth, run every time):
 *   1. ParityTable.tsx declares `footerCells` (keyed-by-column prop).
 *   2. ParityTable.tsx keeps a dev-only deprecation warning on the raw `footer` prop.
 *   3. Zero remaining `<ParityTable ... footer={...}/>` call sites anywhere in the app (AST scan,
 *      not regex — a naive scan both false-positives on unrelated `footer=` props, e.g. a Modal,
 *      and false-negatives on multi-line JSX braces).
 *
 * Live check (real behavior, not statically provable — mirrors verify-driver-pwa-vitest.mjs):
 *   4. A dedicated vitest file renders ParityTable with footerCells and proves (a) footer cell
 *      order matches header order across a drag-reorder, (b) hiding a column removes its footer
 *      cell too. Spawned for real; fails the guard if that suite doesn't exit 0.
 *
 * --selftest mutates an in-memory fixture (never a real repo file) to reintroduce a raw `footer=`
 * call site and proves the AST scanner catches it, per the task's own requirement: "--selftest
 * reintroduces a raw footer → FAIL".
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LABEL = "verify-parity-table-footer-follows-columns";
const SELFTEST = process.argv.includes("--selftest");
const FRONTEND_ROOT = path.join(ROOT, "apps/frontend/src");
const PARITY_TABLE_FILE = path.join(FRONTEND_ROOT, "components/parity/ParityTable.tsx");
const FRONTEND_APP = path.join(ROOT, "apps/frontend");
const FOOTER_TEST = "src/components/parity/ParityTable.footer.test.tsx";
const REGRESSION_TEST = "src/components/parity/ParityTable.test.tsx";
const SKIP_RE = /(\/__tests__\/|\.test\.(tsx|ts)$|\.deprecated\.)/;

function fail(msg) {
  console.error(`${LABEL} FAIL: ${msg}`);
  process.exit(1);
}

function parse(file, source) {
  return ts.createSourceFile(file, source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TSX);
}

function walkFiles(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walkFiles(absolute));
    else if (/\.tsx$/.test(entry.name) && !SKIP_RE.test(absolute.replaceAll("\\", "/"))) files.push(absolute);
  }
  return files;
}

/** Every `<ParityTable ... footer={...}/>` (or `footer=".."`) call site in one source file. */
function findRawFooterAttrs(file, source) {
  const sf = parse(file, source);
  const hits = [];
  const visit = (node) => {
    if (
      (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) &&
      node.tagName.getText(sf) === "ParityTable"
    ) {
      const attr = node.attributes.properties.find(
        (p) => ts.isJsxAttribute(p) && p.name.getText(sf) === "footer",
      );
      if (attr) {
        const line = sf.getLineAndCharacterOfPosition(attr.getStart()).line + 1;
        hits.push(`${file}:${line}`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return hits;
}

/** Scan every real .tsx file under apps/frontend/src for a raw ParityTable footer= call site. */
function scanRepoForRawFooters() {
  const hits = [];
  for (const file of walkFiles(FRONTEND_ROOT)) {
    if (path.resolve(file) === path.resolve(PARITY_TABLE_FILE)) continue; // the definition itself
    const source = fs.readFileSync(file, "utf8");
    if (!source.includes("ParityTable")) continue;
    hits.push(...findRawFooterAttrs(file, source));
  }
  return hits;
}

function verifyParityTableSource(src) {
  const failures = [];
  if (!/footerCells\??:\s*Partial<Record</.test(src)) {
    failures.push("ParityTable.tsx must declare a keyed-by-column footerCells prop");
  }
  if (!/warnedRawFooter/.test(src) || !/console\.warn/.test(src) || !/deprecated/i.test(src)) {
    failures.push("ParityTable.tsx must keep a dev-only deprecation warning on the raw footer prop");
  }
  if (!/visibleColumns\.map\(\(column\)/.test(src.slice(src.indexOf("footerCells ?")))) {
    failures.push("footer row must be built from the same visibleColumns list the header uses");
  }
  return failures;
}

function runLiveVitest() {
  if (!fs.existsSync(FRONTEND_APP)) fail(`missing ${FRONTEND_APP}`);
  const r = spawnSync("npx", ["vitest", "run", FOOTER_TEST, REGRESSION_TEST], {
    cwd: FRONTEND_APP,
    encoding: "utf8",
    stdio: "inherit",
    env: process.env,
  });
  if (r.status !== 0) fail(`frontend vitest (footer reorder/hide behavior) exited ${r.status}`);
}

function selftest() {
  // 1) Live source must be clean right now.
  const liveSrc = fs.readFileSync(PARITY_TABLE_FILE, "utf8");
  const liveFailures = verifyParityTableSource(liveSrc);
  if (liveFailures.length) fail(`selftest: live ParityTable.tsx is unclean: ${liveFailures.join("; ")}`);
  const liveHits = scanRepoForRawFooters();
  if (liveHits.length) fail(`selftest: live repo already has raw footer= call sites: ${liveHits.join(", ")}`);

  // 2) A clean in-memory fixture (no raw footer) must pass the AST scan.
  const CLEAN_FIXTURE = `
    import { ParityTable } from "../../components/parity/ParityTable";
    export function Board() {
      return <ParityTable columns={cols} rows={rows} rowKey={(r) => r.id} footerCells={{ total: "$1" }} />;
    }
  `;
  if (findRawFooterAttrs("fixture-clean.tsx", CLEAN_FIXTURE).length !== 0) {
    fail("selftest: clean fixture (footerCells only) must NOT be flagged as a raw footer");
  }

  // 3) A fixture that reintroduces a raw footer= must be caught — the task's own requirement:
  //    "--selftest reintroduces a raw footer → FAIL". Also cover a self-closing tag and a
  //    same-file decoy `footer=` on an unrelated component (must not false-negative OR false-positive).
  const REGRESSED_FIXTURE = `
    import { ParityTable } from "../../components/parity/ParityTable";
    import { Modal } from "../shared/Modal";
    export function Board() {
      return (
        <div>
          <Modal footer={<button>Close</button>} />
          <ParityTable columns={cols} rows={rows} rowKey={(r) => r.id} footer={<tr><td>Total</td></tr>} />
        </div>
      );
    }
  `;
  const regressedHits = findRawFooterAttrs("fixture-regressed.tsx", REGRESSED_FIXTURE);
  if (regressedHits.length !== 1) {
    fail(
      `selftest mutation escaped: reintroducing a raw ParityTable footer= must be caught exactly once ` +
        `(and the unrelated Modal footer= must not false-positive) — got ${regressedHits.length} hit(s)`,
    );
  }

  const REGRESSED_SELF_CLOSING = `
    <ParityTable columns={cols} rows={rows} rowKey={(r) => r.id} footer={staticFooterNode} />
  `;
  if (findRawFooterAttrs("fixture-self-closing.tsx", REGRESSED_SELF_CLOSING).length !== 1) {
    fail("selftest mutation escaped: self-closing <ParityTable ... footer=.../> must be caught");
  }

  // 4) A source-level mutation removing the footerCells prop / dev-warning must fail verifyParityTableSource.
  const mutations = [
    liveSrc.replace(/footerCells\??:\s*Partial<Record</, "footerCellsREMOVED?: Partial<Record<"),
    liveSrc.replace(/warnedRawFooter/g, "xRemovedFlag"),
  ];
  mutations.forEach((mutation, index) => {
    if (mutation === liveSrc || verifyParityTableSource(mutation).length === 0) {
      fail(`selftest mutation escaped: ParityTable.tsx source check ${index + 1}`);
    }
  });

  console.log(`${LABEL} selftest PASS (4/4)`);
}

function main() {
  if (SELFTEST) {
    selftest();
    return;
  }
  const srcFailures = verifyParityTableSource(fs.readFileSync(PARITY_TABLE_FILE, "utf8"));
  if (srcFailures.length) fail(srcFailures.join("; "));

  const rawFooterHits = scanRepoForRawFooters();
  if (rawFooterHits.length) {
    fail(
      `${rawFooterHits.length} raw ParityTable footer= call site(s) remain — migrate to footerCells: ` +
        rawFooterHits.join(", "),
    );
  }

  runLiveVitest();
  console.log(`${LABEL} PASS — footerCells present, 0 raw footers, reorder/hide vitest green`);
}

main();
