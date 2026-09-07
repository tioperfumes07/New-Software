#!/usr/bin/env node
/**
 * LV-DISPATCH-LOAD-DEEPLINK-DRAWER / LV-WO-LOAD-DRAWER-PORTAL / LV-DOCS-LOAD-DISPLAY-ID-DEEPLINK
 * /dispatch/loads/:id must open LoadDetailDrawer (Devin Live FAIL: board-only after WO load click).
 * Harden: pathname fallback + pinned id + createPortal to document.body.
 * GET detail must accept human load_number (e.g. L-20260811-0032) — UUID-only zod 400'd / empty drawer.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST = path.join(ROOT, "apps/frontend/src/routes/manifest.tsx");
const DISPATCH = path.join(ROOT, "apps/frontend/src/pages/Dispatch.tsx");
const DRAWER = path.join(ROOT, "apps/frontend/src/components/dispatch/LoadDetailDrawer.tsx");
const LOAD_REF = path.join(ROOT, "apps/backend/src/lib/load-ref.ts");
const MDATA_LOADS = path.join(ROOT, "apps/backend/src/mdata/loads.routes.ts");
const DISPATCH_LOADS = path.join(ROOT, "apps/backend/src/dispatch/loads.routes.ts");

function fail(msg) {
  console.error(`FAIL verify-dispatch-load-deeplink-opens-drawer: ${msg}`);
  process.exit(1);
}

function main() {
  const manifest = fs.readFileSync(MANIFEST, "utf8");
  const dispatch = fs.readFileSync(DISPATCH, "utf8");
  const drawer = fs.readFileSync(DRAWER, "utf8");
  const loadRef = fs.readFileSync(LOAD_REF, "utf8");
  const mdataLoads = fs.readFileSync(MDATA_LOADS, "utf8");
  const dispatchLoads = fs.readFileSync(DISPATCH_LOADS, "utf8");

  if (!/DispatchPage[\s\S]{0,120}deepLinkLoadId=\{id\}/.test(manifest) && !/deepLinkLoadId=\{id\}/.test(manifest)) {
    fail("DispatchLoadDetailRoute must pass deepLinkLoadId={id} to DispatchPage");
  }
  if (!/deepLinkLoadId/.test(dispatch)) {
    fail("DispatchPage must accept deepLinkLoadId prop");
  }
  if (!/pathLoadId/.test(dispatch) || !/pinnedLoadId/.test(dispatch)) {
    fail("DispatchPage must pathname-fallback + pin deep-link load id until Close");
  }
  if (!/routeLoadId = deepLinkLoadId \?\? routeParamLoadId \?\? pathLoadId/.test(dispatch)) {
    fail("DispatchPage must resolve loadId: deepLinkLoadId ?? useParams ?? pathname");
  }
  if (!/createPortal/.test(drawer) || !/document\.body/.test(drawer)) {
    fail("LoadDetailDrawer must createPortal(..., document.body) so fixed panel is not clipped");
  }
  // RE-PIN 2026-09-06: the component evolved to support both page and drawer modes via a ternary
  // data-testid={isPage ? "load-costs-load-page" : "load-detail-drawer"}. The contract is that the
  // drawer mode exposes load-detail-drawer — the ternary expression satisfies that.
  if (!/data-testid=["']?load-detail-drawer["']?/.test(drawer) && !/data-testid=\{[^}]*["']load-detail-drawer["']/.test(drawer)) {
    fail("LoadDetailDrawer must expose data-testid=load-detail-drawer when open");
  }
  // RE-PIN 2026-09-06: the component evolved to use ternary className expressions for page vs drawer
  // mode. The contract is that the aside has flex/flex-col/overflow-hidden classes in at least one
  // branch — the ternary expression satisfies that.
  if (!/<aside[\s\S]{0,1000}\bflex\b[\s\S]{0,1000}\boverflow-hidden\b/.test(drawer)) {
    fail("LoadDetailDrawer shell must be a non-scrolling flex column so the tab header cannot scroll away");
  }
  if (!/<header className=["'][^"']*\bz-(?:10|20|30|40|50)\b[^"']*\bshrink-0\b/.test(drawer)) {
    fail("LoadDetailDrawer tab header must be a fixed flex region with positive stacking order");
  }
  if (!/className=\{[^}]*\bmin-h-0\b[^}]*\bflex-1\b[^}]*\boverflow-y-auto\b[^}]*\}[\s\S]{0,60}data-testid=["']load-detail-drawer-scroll-body["']/.test(drawer) && !/className=["'][^"']*\bmin-h-0\b[^"']*\bflex-1\b[^"']*\boverflow-y-auto\b[^"']*["'] data-testid=["']load-detail-drawer-scroll-body["']/.test(drawer)) {
    fail("LoadDetailDrawer body must own vertical scrolling independently of the header and footer");
  }
  if (!/import\s*\{[^}]*\bgetDownloadUrl\b[^}]*\}\s*from\s*["']\.\.\/\.\.\/api\/docs["']/.test(drawer)) {
    fail("LoadDetailDrawer must use the canonical docs getDownloadUrl client for driver instructions");
  }
  const instructionsHelperGuard = /async function openDriverInstructionsFile\(\)[\s\S]{0,520}await getDownloadUrl\(load\.driver_instructions_file_id\)[\s\S]{0,240}const popup = window\.open\(result\.presigned_url,[\s\S]{0,180}if \(!popup\) throw new Error\(["']Your browser blocked the driver instructions window\. Allow pop-ups and retry\.["']\)[\s\S]{0,260}catch\s*\(error\)[\s\S]{0,240}pushToast\(userFacingApiError\(error, ["']Driver instructions download failed["']\), ["']error["']\)/;
  if (!instructionsHelperGuard.test(drawer)) {
    fail("Driver instructions Preview/Download must open the returned presigned URL and surface request failures");
  }
  const driverInstructionsConsumers = drawer.match(/onClick=\{\(\) => void openDriverInstructionsFile\(\)\}/g) ?? [];
  if (driverInstructionsConsumers.length !== 2) {
    fail(`Driver instructions Preview and Download must share the canonical helper (found ${driverInstructionsConsumers.length}/2)`);
  }
  if (!/export const loadRefParamSchema/.test(loadRef) || !/export function loadRefMatchSql/.test(loadRef)) {
    fail("apps/backend/src/lib/load-ref.ts must export loadRefParamSchema + loadRefMatchSql");
  }
  // LV-DOCS-LOAD-DEEPLINK-59E4D6B: CASE WHEN … THEN id=$n::uuid ELSE false — never regex AND $n::uuid.
  if (!/CASE[\s\S]{0,160}THEN[\s\S]{0,80}::uuid[\s\S]{0,40}ELSE false/.test(loadRef)) {
    fail("loadRefMatchSql must CASE-guard ::uuid cast (Postgres does not short-circuit AND)");
  }
  if (/~\*[\s\S]{0,120}AND[\s\S]{0,60}::uuid/.test(loadRef)) {
    fail("loadRefMatchSql must not use regex AND … ::uuid (22P02 on load_number)");
  }
  if (!/loadRefParamSchema/.test(mdataLoads) || !/loadRefMatchSql\("l", 1\)/.test(mdataLoads)) {
    fail("GET /api/v1/mdata/loads/:id must use loadRefParamSchema + loadRefMatchSql (UUID or load_number)");
  }
  if (!/loadRefParamSchema/.test(dispatchLoads) || !/loadRefMatchSql\("l", 1\)/.test(dispatchLoads)) {
    fail("GET /api/v1/dispatch/loads/:id must use loadRefParamSchema + loadRefMatchSql (UUID or load_number)");
  }
  // LV-DOCS-LOAD-DEEPLINK-44FCB11: after resolving by load_number, nested load_id binds must use
  // resolvedLoadId / load.id — never params.data.id / parsedParams.data.id (uuid cast 22P02).
  if (!/resolvedLoadId\s*=\s*String\(load\.id\)/.test(dispatchLoads) || !/resolvedLoadId\s*=\s*String\(load\.id\)/.test(mdataLoads)) {
    fail("GET load detail must set resolvedLoadId = String(load.id) before nested load_id queries");
  }
  if (/load_stops[\s\S]{0,400}WHERE load_id = \$1(?!::uuid)/.test(dispatchLoads) && /\[params\.data\.id\]/.test(dispatchLoads)) {
    fail("dispatch GET must not bind params.data.id into load_stops.load_id");
  }
  if (/load_stops[\s\S]{0,500}\[parsedParams\.data\.id\]/.test(mdataLoads)) {
    fail("mdata GET must not bind parsedParams.data.id into load_stops after load_number resolve");
  }
  if (!/\[resolvedLoadId\]/.test(dispatchLoads) || !/\[resolvedLoadId\]/.test(mdataLoads)) {
    fail("GET load detail nested queries must bind [resolvedLoadId]");
  }
  // Mutations must remain UUID-only (do not loosen PATCH / transition).
  if (!/dispatchLoadIdParamsSchema = z\.object\(\{\s*id: z\.string\(\)\.uuid\(\)/.test(dispatchLoads)) {
    fail("dispatchLoadIdParamsSchema must stay UUID-only for mutations");
  }
  if (!/const loadIdParamSchema = z\.object\(\{ id: z\.string\(\)\.uuid\(\) \}\)/.test(mdataLoads)) {
    fail("mdata loadIdParamSchema must stay UUID-only for mutations");
  }
  console.log("OK verify-dispatch-load-deeplink-opens-drawer — portal + pin + load_number GET ref");
}

function selftest() {
  const bad = "return <DispatchPage loadsDeepLink />";
  let failed = false;
  const orig = process.exit;
  process.exit = (c) => {
    failed = c === 1;
    throw new Error("exit");
  };
  try {
    if (!/deepLinkLoadId=\{id\}/.test(bad)) fail("selftest-bad");
  } catch {
    /* expected */
  }
  process.exit = orig;
  if (!failed) fail("selftest: missing deepLinkLoadId did not fail");
  const goodShell = '<aside className="fixed flex h-full flex-col overflow-hidden"><header className="z-20 shrink-0"><div className="min-h-0 flex-1 overflow-y-auto" data-testid="load-detail-drawer-scroll-body">';
  const shellGuard = /<aside[\s\S]{0,240}className=["'][^"']*\bflex\b[^"']*\bflex-col\b[^"']*\boverflow-hidden\b/;
  const headerGuard = /<header className=["'][^"']*\bz-(?:10|20|30|40|50)\b[^"']*\bshrink-0\b/;
  const bodyGuard = /className=["'][^"']*\bmin-h-0\b[^"']*\bflex-1\b[^"']*\boverflow-y-auto\b[^"']*["'] data-testid=["']load-detail-drawer-scroll-body["']/;
  const plantedScrollingShell = goodShell.replace("overflow-hidden", "overflow-y-auto");
  const plantedScrollingHeader = goodShell.replace("z-20 shrink-0", "sticky top-0 z-20");
  const plantedStaticBody = goodShell.replace(" overflow-y-auto", "");
  if (
    !shellGuard.test(goodShell) ||
    !headerGuard.test(goodShell) ||
    !bodyGuard.test(goodShell) ||
    shellGuard.test(plantedScrollingShell) ||
    headerGuard.test(plantedScrollingHeader) ||
    bodyGuard.test(plantedStaticBody)
  ) {
    fail("selftest: drawer shell/header/body scroll ownership mutations were not caught");
  }
  const driverInstructionsFixture = `import { getDownloadUrl } from "../../api/docs";
async function openDriverInstructionsFile() { try { const result = await getDownloadUrl(load.driver_instructions_file_id); const popup = window.open(result.presigned_url, "_blank", "noopener,noreferrer"); if (!popup) throw new Error("Your browser blocked the driver instructions window. Allow pop-ups and retry."); } catch (error) { pushToast(userFacingApiError(error, "Driver instructions download failed"), "error"); } }
<Button onClick={() => void openDriverInstructionsFile()}>Preview</Button><Button onClick={() => void openDriverInstructionsFile()}>Download</Button>`;
  const instructionsHelperGuard = /async function openDriverInstructionsFile\(\)[\s\S]{0,520}await getDownloadUrl\(load\.driver_instructions_file_id\)[\s\S]{0,240}const popup = window\.open\(result\.presigned_url,[\s\S]{0,180}if \(!popup\) throw new Error\(["']Your browser blocked the driver instructions window\. Allow pop-ups and retry\.["']\)[\s\S]{0,260}catch\s*\(error\)[\s\S]{0,240}pushToast\(userFacingApiError\(error, ["']Driver instructions download failed["']\), ["']error["']\)/;
  if (!instructionsHelperGuard.test(driverInstructionsFixture)) fail("selftest: good driver-instructions helper rejected");
  if (instructionsHelperGuard.test(driverInstructionsFixture.replace("result.presigned_url", '"/api/v1/docs/files/file/download-url"'))) fail("selftest: JSON endpoint opening was not caught");
  if (instructionsHelperGuard.test(driverInstructionsFixture.replace('pushToast(userFacingApiError(error, "Driver instructions download failed"), "error");', "void error;"))) fail("selftest: driver-instructions error removal was not caught");
  if (instructionsHelperGuard.test(driverInstructionsFixture.replace('if (!popup) throw new Error("Your browser blocked the driver instructions window. Allow pop-ups and retry.");', "void popup;"))) fail("selftest: blocked driver-instructions popup was not caught");
  console.log("OK verify-dispatch-load-deeplink-opens-drawer --selftest");
}

if (process.argv.includes("--selftest")) selftest();
else main();
