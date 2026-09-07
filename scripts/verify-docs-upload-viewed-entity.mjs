#!/usr/bin/env node
/**
 * verify-docs-upload-viewed-entity.mjs
 *
 * FIX-2 (docs-upload-viewed-entity): the "+ Upload" button on an entity profile MUST file the
 * document under the VIEWED operating_company_id, not the uploader's default_company_id.
 *
 * ROOT CAUSE (fixed): UploadModal.tsx called requestUploadUrl() with entity_links but no
 * operating_company_id, so the backend (files.routes.ts) fell back to resolveOperatingCompanyId()
 * — the caller's default_company_id. But the unit/equipment/driver aggregates that render each
 * profile's document list read documents scoped to the VIEWED company with an EXACT match
 * (`f.operating_company_id = $2`, e.g. unit-aggregate.service.ts). For a multi-entity user whose
 * default company != the company being viewed, the upload silently filed under the wrong entity
 * and never reappeared on refetch.
 *
 * This guard is a REGRESSION guard on the fix. It asserts, per profile:
 *   1. UploadModal.tsx accepts an `operatingCompanyId` prop and forwards it as
 *      `operating_company_id` in the requestUploadUrl() call.
 *   2. Every mount site that has the VIEWED company available in scope (vehicle, trailer,
 *      customer-contracts, driver/customer/vendor/load via the generic DocumentsTab, and
 *      DocsHomePage's standalone upload) passes `operatingCompanyId=` through to <UploadModal>
 *      or <DocumentsTab>.
 *
 * Deliberately NOT required:
 *   - VersionHistoryModal's UploadModal (parentFileId flow) — the backend inherits
 *     operating_company_id from the PARENT file row server-side, so no prop is needed there.
 *   - pages/Documents.tsx's standalone UploadModal — that page has no "viewed entity"/company
 *     concept at all (it's the unfiltered cross-company library), so there is no viewed company
 *     to thread through; the documented server-side default-company fallback is correct there.
 *
 * Usage:
 *   node scripts/verify-docs-upload-viewed-entity.mjs            # scan real files
 *   node scripts/verify-docs-upload-viewed-entity.mjs --selftest # inject regressions -> must FAIL
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LABEL = "verify-docs-upload-viewed-entity";

const UPLOAD_MODAL = "apps/frontend/src/components/documents/UploadModal.tsx";
const DOCUMENTS_TAB = "apps/frontend/src/components/documents/DocumentsTab.tsx";
// EntityDocumentUpload.tsx ("One component so profiles/lists stop re-implementing UploadModal
// wiring") is a thin wrapper around UploadModal, added after this guard shipped — DocumentsTab.tsx
// and the direct mount sites below now mount THIS instead of <UploadModal> directly (confirmed
// live: both still correctly thread operatingCompanyId down to the real <UploadModal>). The
// mount-site regexes below accept either component name; a NEW check just below asserts
// EntityDocumentUpload.tsx itself keeps forwarding the prop, so this indirection can't quietly
// break the thread a second time without this guard catching it.
const ENTITY_DOCUMENT_UPLOAD = "apps/frontend/src/components/documents/EntityDocumentUpload.tsx";
const MOUNT_MARKER_RE = "(?:UploadModal|EntityDocumentUpload)";

// Mount sites that render <UploadModal> directly and MUST pass operatingCompanyId=.
const DIRECT_MOUNT_SITES = [
  "apps/frontend/src/components/vehicle-profile/DocumentsSection.tsx",
  "apps/frontend/src/components/trailer-profile/DocumentsSection.tsx",
  "apps/frontend/src/components/customers/CustomerContractsTab.tsx",
  "apps/frontend/src/pages/docs/DocsHomePage.tsx",
];

// Mount sites that render <DocumentsTab> (the generic entity-doc tab) and MUST pass
// operatingCompanyId= so DocumentsTab can forward it to its own <UploadModal>.
const DOCUMENTS_TAB_MOUNT_SITES = [
  "apps/frontend/src/components/dispatch/LoadDetailDrawer.tsx",
  "apps/frontend/src/pages/VendorDetail.tsx",
  "apps/frontend/src/pages/drivers/DriverProfilePage.tsx",
  "apps/frontend/src/pages/DriverDetail.tsx",
  "apps/frontend/src/pages/CustomerDetail.tsx",
];

function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

/**
 * Pure evaluation.
 * @param {{
 *   uploadModal: string,
 *   documentsTab: string,
 *   directMounts: Record<string, string>,
 *   documentsTabMounts: Record<string, string>,
 * }} args raw file text keyed by relative path (for the mount maps)
 * @returns {string[]} errors
 */
export function assertGuard({ uploadModal, documentsTab, directMounts, documentsTabMounts, entityDocumentUpload }) {
  const errors = [];
  const um = stripComments(uploadModal);
  const mountMarkerRe = new RegExp(`<${MOUNT_MARKER_RE}`);

  // 1. UploadModal must declare + accept + forward operatingCompanyId.
  if (!/operatingCompanyId\??:\s*string/.test(um)) {
    errors.push(`${UPLOAD_MODAL}: UploadModalProps lost the operatingCompanyId prop`);
  }
  if (!/\boperatingCompanyId\b/.test(um.replace(/operatingCompanyId\??:\s*string/, ""))) {
    errors.push(`${UPLOAD_MODAL}: operatingCompanyId prop is declared but never destructured/used`);
  }
  if (!/operating_company_id:\s*operatingCompanyId/.test(um)) {
    errors.push(`${UPLOAD_MODAL}: requestUploadUrl() call no longer forwards operatingCompanyId as operating_company_id`);
  }

  // 1b. EntityDocumentUpload.tsx (a thin wrapper introduced after this guard shipped — see the
  //     comment on ENTITY_DOCUMENT_UPLOAD above) must keep forwarding operatingCompanyId down to
  //     its own <UploadModal> mount. Only checked when the file exists, so this guard still works
  //     against a repo state from before the wrapper existed (e.g. the selftest fixtures below).
  if (entityDocumentUpload != null) {
    const edu = stripComments(entityDocumentUpload);
    if (!/operatingCompanyId\??:\s*string/.test(edu)) {
      errors.push(`${ENTITY_DOCUMENT_UPLOAD}: EntityDocumentUploadProps lost the operatingCompanyId prop`);
    }
    if (!/<UploadModal[\s\S]{0,400}?operatingCompanyId=\{operatingCompanyId\}/.test(edu)) {
      errors.push(`${ENTITY_DOCUMENT_UPLOAD}: <UploadModal> no longer receives operatingCompanyId={operatingCompanyId}`);
    }
  }

  // 2. DocumentsTab (the generic entity-doc tab used by driver/customer/vendor/load) must accept
  //    operatingCompanyId and forward it to its own <UploadModal operatingCompanyId=...> (or the
  //    <EntityDocumentUpload> wrapper mounting one).
  const dt = stripComments(documentsTab);
  if (!/operatingCompanyId\??:\s*string/.test(dt)) {
    errors.push(`${DOCUMENTS_TAB}: DocumentsTabProps lost the operatingCompanyId prop`);
  }
  if (!mountMarkerRe.test(dt) || !new RegExp(`<${MOUNT_MARKER_RE}[\\s\\S]{0,400}?operatingCompanyId=\\{operatingCompanyId\\}`).test(dt)) {
    errors.push(`${DOCUMENTS_TAB}: <UploadModal> no longer receives operatingCompanyId={operatingCompanyId}`);
  }

  // 3. Every direct mount site must pass operatingCompanyId= into <UploadModal> (or the
  //    <EntityDocumentUpload> wrapper).
  for (const rel of DIRECT_MOUNT_SITES) {
    const src = directMounts[rel];
    if (src == null) {
      errors.push(`${rel}: file missing`);
      continue;
    }
    const stripped = stripComments(src);
    if (!mountMarkerRe.test(stripped) || !new RegExp(`<${MOUNT_MARKER_RE}[\\s\\S]{0,400}?operatingCompanyId=`).test(stripped)) {
      errors.push(`${rel}: <UploadModal> mount no longer passes operatingCompanyId= (viewed-company thread dropped)`);
    }
  }

  // 4. Every DocumentsTab mount site must pass operatingCompanyId= (the viewed company: either a
  //    CompanyContext-derived companyId, or a per-record operating_company_id like load.operating_company_id).
  //    LoadDetailDrawer.tsx specifically mounts <LdtDocumentsTab>, a load-specific rename of the
  //    generic <DocumentsTab> (adds invoice/expense/bill receipt aggregation the other entities
  //    don't need) -- confirmed live (2026-09-07) that it still threads operatingCompanyId all the
  //    way to <EntityDocumentUpload operatingCompanyId={operatingCompanyId}>, so this is a component
  //    rename, not a dropped prop. The guard's string match had not been updated for the rename,
  //    producing a false FAIL on every PR repo-wide. Recognizing both tag names here is the fix;
  //    it does not weaken the check -- a real drop of the prop on either tag name still fails below.
  const MOUNT_TAB_RE = /<(?:DocumentsTab|LdtDocumentsTab)/;
  for (const rel of DOCUMENTS_TAB_MOUNT_SITES) {
    const src = documentsTabMounts[rel];
    if (src == null) {
      errors.push(`${rel}: file missing`);
      continue;
    }
    const stripped = stripComments(src);
    if (!MOUNT_TAB_RE.test(stripped) || !new RegExp(MOUNT_TAB_RE.source + "[\\s\\S]{0,400}?operatingCompanyId=").test(stripped)) {
      errors.push(`${rel}: <DocumentsTab>/<LdtDocumentsTab> mount no longer passes operatingCompanyId= (viewed-company thread dropped)`);
    }
  }

  return errors;
}

function readReal(rel) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) return null;
  return fs.readFileSync(abs, "utf8");
}

function selftest() {
  const goodUploadModal = `
    type UploadModalProps = {
      entityType?: FileEntityType;
      entityId?: string;
      operatingCompanyId?: string;
      onClose: () => void;
    };
    export function UploadModal({ entityType, entityId, operatingCompanyId, onClose }: UploadModalProps) {
      async function handleSubmit() {
        const uploadInit = await requestUploadUrl({
          original_filename: selectedFile.name,
          ...(operatingCompanyId ? { operating_company_id: operatingCompanyId } : {}),
        });
      }
    }
  `;
  const goodDocumentsTab = `
    type DocumentsTabProps = { entityType: string; entityId: string; operatingCompanyId?: string; };
    export function DocumentsTab({ entityType, entityId, operatingCompanyId }: DocumentsTabProps) {
      return (
        <UploadModal
          entityType={entityType}
          entityId={entityId}
          operatingCompanyId={operatingCompanyId}
          onClose={() => setUploadOpen(false)}
        />
      );
    }
  `;
  const goodDirectMount = `<UploadModal entityType="unit" entityId={unitId} operatingCompanyId={companyId} onClose={close} />`;
  const goodTabMount = `<DocumentsTab entityType="driver" entityId={id} entityName={name} operatingCompanyId={companyId} />`;
  const goodEntityDocumentUpload = `
    type EntityDocumentUploadProps = { entityType: string; entityId: string; operatingCompanyId?: string; };
    export function EntityDocumentUpload({ entityType, entityId, operatingCompanyId }: EntityDocumentUploadProps) {
      return (
        <UploadModal
          entityType={entityType}
          entityId={entityId}
          operatingCompanyId={operatingCompanyId}
          onClose={() => setOpen(false)}
        />
      );
    }
  `;
  const goodDirectMountViaWrapper = `<EntityDocumentUpload entityType="unit" entityId={unitId} operatingCompanyId={companyId} />`;

  function mounts(overrideRel, overrideSrc, list, goodSrc) {
    const m = {};
    for (const rel of list) m[rel] = rel === overrideRel ? overrideSrc : goodSrc;
    return m;
  }

  const cases = [
    {
      name: "all wired → 0 errors",
      in: {
        uploadModal: goodUploadModal,
        documentsTab: goodDocumentsTab,
        directMounts: mounts(null, null, DIRECT_MOUNT_SITES, goodDirectMount),
        documentsTabMounts: mounts(null, null, DOCUMENTS_TAB_MOUNT_SITES, goodTabMount),
      },
      want: 0,
    },
    {
      name: "UploadModal prop dropped from props type → FAIL",
      in: {
        uploadModal: goodUploadModal.replace("operatingCompanyId?: string;\n", ""),
        documentsTab: goodDocumentsTab,
        directMounts: mounts(null, null, DIRECT_MOUNT_SITES, goodDirectMount),
        documentsTabMounts: mounts(null, null, DOCUMENTS_TAB_MOUNT_SITES, goodTabMount),
      },
      wantMin: 1,
    },
    {
      name: "UploadModal stops forwarding operating_company_id to requestUploadUrl → FAIL",
      in: {
        uploadModal: goodUploadModal.replace("...(operatingCompanyId ? { operating_company_id: operatingCompanyId } : {}),", ""),
        documentsTab: goodDocumentsTab,
        directMounts: mounts(null, null, DIRECT_MOUNT_SITES, goodDirectMount),
        documentsTabMounts: mounts(null, null, DOCUMENTS_TAB_MOUNT_SITES, goodTabMount),
      },
      wantMin: 1,
    },
    {
      name: "vehicle-profile DocumentsSection reverts to discarding companyId (the original bug) → FAIL",
      in: {
        uploadModal: goodUploadModal,
        documentsTab: goodDocumentsTab,
        directMounts: mounts(
          "apps/frontend/src/components/vehicle-profile/DocumentsSection.tsx",
          `<UploadModal entityType="unit" entityId={unitId} onClose={close} />`,
          DIRECT_MOUNT_SITES,
          goodDirectMount
        ),
        documentsTabMounts: mounts(null, null, DOCUMENTS_TAB_MOUNT_SITES, goodTabMount),
      },
      wantMin: 1,
    },
    {
      name: "DocumentsTab loses operatingCompanyId prop → FAIL",
      in: {
        uploadModal: goodUploadModal,
        documentsTab: goodDocumentsTab.replace("operatingCompanyId?: string; };", "};").replace(", operatingCompanyId }", " }"),
        directMounts: mounts(null, null, DIRECT_MOUNT_SITES, goodDirectMount),
        documentsTabMounts: mounts(null, null, DOCUMENTS_TAB_MOUNT_SITES, goodTabMount),
      },
      wantMin: 1,
    },
    {
      name: "DriverProfilePage's <DocumentsTab> mount drops operatingCompanyId= → FAIL",
      in: {
        uploadModal: goodUploadModal,
        documentsTab: goodDocumentsTab,
        directMounts: mounts(null, null, DIRECT_MOUNT_SITES, goodDirectMount),
        documentsTabMounts: mounts(
          "apps/frontend/src/pages/drivers/DriverProfilePage.tsx",
          `<DocumentsTab entityType="driver" entityId={id} entityName={displayName} />`,
          DOCUMENTS_TAB_MOUNT_SITES,
          goodTabMount
        ),
      },
      wantMin: 1,
    },
    {
      name: "LoadDetailDrawer's <LdtDocumentsTab> mount, correctly wired (renamed tag) → 0 errors",
      in: {
        uploadModal: goodUploadModal,
        documentsTab: goodDocumentsTab,
        directMounts: mounts(null, null, DIRECT_MOUNT_SITES, goodDirectMount),
        documentsTabMounts: mounts(
          "apps/frontend/src/components/dispatch/LoadDetailDrawer.tsx",
          `<LdtDocumentsTab loadId={load.id} operatingCompanyId={load.operating_company_id} loadNumber={load.load_number} canEdit={canEdit} />`,
          DOCUMENTS_TAB_MOUNT_SITES,
          goodTabMount
        ),
      },
      want: 0,
    },
    {
      name: "LoadDetailDrawer's <LdtDocumentsTab> mount drops operatingCompanyId= (renamed tag, real regression) → FAIL",
      in: {
        uploadModal: goodUploadModal,
        documentsTab: goodDocumentsTab,
        directMounts: mounts(null, null, DIRECT_MOUNT_SITES, goodDirectMount),
        documentsTabMounts: mounts(
          "apps/frontend/src/components/dispatch/LoadDetailDrawer.tsx",
          `<LdtDocumentsTab loadId={load.id} loadNumber={load.load_number} canEdit={canEdit} />`,
          DOCUMENTS_TAB_MOUNT_SITES,
          goodTabMount
        ),
      },
      wantMin: 1,
    },
    {
      name: "missing file in a mount site → FAIL",
      in: {
        uploadModal: goodUploadModal,
        documentsTab: goodDocumentsTab,
        directMounts: mounts("apps/frontend/src/pages/docs/DocsHomePage.tsx", null, DIRECT_MOUNT_SITES, goodDirectMount),
        documentsTabMounts: mounts(null, null, DOCUMENTS_TAB_MOUNT_SITES, goodTabMount),
      },
      wantMin: 1,
    },
    {
      name: "mount sites through <EntityDocumentUpload> wrapper, correctly wired → 0 errors",
      in: {
        uploadModal: goodUploadModal,
        documentsTab: goodDocumentsTab.replace(/<UploadModal/, "<EntityDocumentUpload"),
        directMounts: mounts(null, null, DIRECT_MOUNT_SITES, goodDirectMountViaWrapper),
        documentsTabMounts: mounts(null, null, DOCUMENTS_TAB_MOUNT_SITES, goodTabMount),
        entityDocumentUpload: goodEntityDocumentUpload,
      },
      want: 0,
    },
    {
      name: "EntityDocumentUpload wrapper stops forwarding operatingCompanyId to UploadModal → FAIL",
      in: {
        uploadModal: goodUploadModal,
        documentsTab: goodDocumentsTab.replace(/<UploadModal/, "<EntityDocumentUpload"),
        directMounts: mounts(null, null, DIRECT_MOUNT_SITES, goodDirectMountViaWrapper),
        documentsTabMounts: mounts(null, null, DOCUMENTS_TAB_MOUNT_SITES, goodTabMount),
        entityDocumentUpload: goodEntityDocumentUpload.replace("operatingCompanyId={operatingCompanyId}", ""),
      },
      wantMin: 1,
    },
  ];

  let failed = 0;
  for (const c of cases) {
    const errs = assertGuard(c.in);
    const n = errs.length;
    const ok = c.want !== undefined ? n === c.want : n >= c.wantMin;
    if (!ok) failed++;
    console.log(`${ok ? "ok  " : "FAIL"}  ${c.name}  (errors=${n})`);
  }
  if (failed) { console.error(`\n${LABEL} SELFTEST FAILED: ${failed}`); process.exit(1); }
  console.log(`\n${LABEL} SELFTEST PASS`);
}

/**
 * Comprehensive scan: EVERY frontend file that calls requestUploadUrl() directly must pass
 * operating_company_id in the call object — otherwise the backend falls back to the uploader's
 * default_company_id and the doc is filed under the wrong entity. This catches direct callers that
 * bypass UploadModal/DocumentsTab entirely (e.g. the onboarding wizard, inspection-photo upload), which
 * the hardcoded mount-site lists above cannot see.
 * @returns {string[]} errors
 */
function scanDirectRequestUploadCallers() {
  const errors = [];
  const root = path.join(ROOT, "apps/frontend/src");
  if (!fs.existsSync(root)) return errors;
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== "node_modules" && e.name !== "__tests__") stack.push(p); continue; }
      // Product code only — test/story files may call requestUploadUrl with mocks/fixtures.
      if (!/\.tsx?$/.test(e.name) || /\.(test|spec|stories)\.tsx?$/.test(e.name)) continue;
      const src = stripComments(fs.readFileSync(p, "utf8"));
      let i = 0;
      while ((i = src.indexOf("requestUploadUrl(", i)) !== -1) {
        const open = src.indexOf("{", i);
        if (open === -1) { i += "requestUploadUrl(".length; continue; }
        let depth = 0, j = open;
        for (; j < src.length; j++) { if (src[j] === "{") depth++; else if (src[j] === "}") { depth--; if (depth === 0) break; } }
        const call = src.slice(open, j + 1);
        if (!/operating_company_id/.test(call)) {
          errors.push(
            `${path.relative(ROOT, p)}: a requestUploadUrl() call does not pass operating_company_id — ` +
              "the doc files under the uploader's default company, not the viewed entity"
          );
        }
        i = j + 1;
      }
    }
  }
  return errors;
}

if (process.argv.includes("--selftest")) { selftest(); process.exit(0); }

const uploadModal = readReal(UPLOAD_MODAL);
const documentsTab = readReal(DOCUMENTS_TAB);
const entityDocumentUpload = readReal(ENTITY_DOCUMENT_UPLOAD);
if (uploadModal === null) { console.error(`[${LABEL}] FAILED — missing file ${UPLOAD_MODAL}`); process.exit(1); }
if (documentsTab === null) { console.error(`[${LABEL}] FAILED — missing file ${DOCUMENTS_TAB}`); process.exit(1); }

const directMounts = {};
for (const rel of DIRECT_MOUNT_SITES) directMounts[rel] = readReal(rel);
const documentsTabMounts = {};
for (const rel of DOCUMENTS_TAB_MOUNT_SITES) documentsTabMounts[rel] = readReal(rel);

const errors = assertGuard({ uploadModal, documentsTab, directMounts, documentsTabMounts, entityDocumentUpload });
errors.push(...scanDirectRequestUploadCallers());
if (errors.length) {
  console.error(`[${LABEL}] FAILED — ${errors.length} issue(s):`);
  for (const e of errors) console.error(`  ✗ ${e}`);
  process.exit(1);
}
console.log(
  `[${LABEL}] OK — UploadModal threads operatingCompanyId (the VIEWED company) into requestUploadUrl's ` +
    `operating_company_id; DocumentsTab forwards it; ${DIRECT_MOUNT_SITES.length} direct mount sites + ` +
    `${DOCUMENTS_TAB_MOUNT_SITES.length} DocumentsTab mount sites all pass it. A "+ Upload" on a viewed ` +
    `company that differs from the uploader's default no longer files under the wrong entity.`
);
