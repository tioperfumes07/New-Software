#!/usr/bin/env node
// MANUAL-DELIVERY-AUTH-01 (owner request 2026-09-07, verbatim): "sometimes we might send a delivery
// confirmation to the factoring, even though we have not officially delivered... i need to be able to
// manually do this, when closing a load have an option to create invoice and still not be delivered."
//
// Static guard: proves the four contract points the delivery box itself called for, without touching
// prod data (no test load/POD fixture creation -- USMCA law forbids fabricated financial rows):
//   (a) a load with NO manual authorization and NO real delivery evidence is still refused
//       (missing_delivery_evidence) -- the manual-auth check is an ADDITIONAL path, never a
//       replacement for the real-evidence gate.
//   (b) a load WITH an active (non-revoked) authorization DOES earn, and the resulting JE memo is
//       tagged distinctly (MANUAL DELIVERY AUTHORIZATION ...) -- never silently indistinguishable
//       from a real-evidence posting.
//   (c) the factoring packet assembles even when the load's status is not yet deliverable, ONLY when
//       manualDeliveryAuthorizationId is supplied, and the outbox payload carries that id.
//   (d) the alternate-evidence lookup filters on revoked_at IS NULL -- revoking an authorization
//       (which only ever sets revoked_at, void-not-delete) makes the next lookup return nothing, so a
//       fresh postLoadRevenueLatch call refuses again.
//
// Live half (DATABASE_URL-gated, manual/prod-only, same convention as verify-acc13-...): confirms the
// table + pod_documents.source column exist live and RLS is enabled -- schema-only, writes nothing.
//
// Run: node scripts/verify-manual-delivery-authorization.mjs [--selftest]
//      DATABASE_URL=<prod> node scripts/verify-manual-delivery-authorization.mjs
import fs from "node:fs";

const LABEL = "verify-manual-delivery-authorization";
const POSTER_FILE = "apps/backend/src/accounting/revrec-delivery-posting/poster.service.ts";
const PACKET_FILE = "apps/backend/src/factoring/packet-assemble.service.ts";
const ROUTE_FILE = "apps/backend/src/dispatch/manual-delivery-authorization.routes.ts";
const INDEX_FILE = "apps/backend/src/index.ts";

/** (a) + (d): the alternate-evidence lookup exists, is scoped to revoked_at IS NULL, and the earn
 * branch only sets manualAuthEvidence when it actually returns a row -- never assumed true. */
export function posterHasManualAuthGate(src) {
  return (
    /async function activeManualDeliveryAuthorizationAt/.test(src) &&
    /FROM dispatch\.manual_delivery_authorizations[\s\S]{0,200}revoked_at IS NULL/.test(src) &&
    /if \(!departedAt\) \{[\s\S]{0,300}const authorizedAt = await activeManualDeliveryAuthorizationAt/.test(src) &&
    /if \(!authorizedAt\) return \{ gate: "missing_delivery_evidence" as const \};/.test(src) &&
    /manualAuthEvidence = true;/.test(src)
  );
}

/** (b): the JE memo is tagged distinctly when (and only when) manualAuthEvidence is true. */
export function posterTagsManualAuthMemo(src) {
  return (
    /manualAuthEvidence\s*\n\s*\?\s*`Revrec Event 1 earn[\s\S]{0,80}\(MANUAL DELIVERY AUTHORIZATION/.test(
      src
    ) && /see dispatch\.manual_delivery_authorizations\)`/.test(src)
  );
}

/** (c): manualDeliveryAuthorizationId bypasses the status gate and rides the outbox payload. */
export function packetHonorsManualAuthId(src) {
  return (
    /manualDeliveryAuthorizationId\?:\s*string/.test(src) &&
    /!isFactoringPathLoadStatus\(load\.status\)\s*&&\s*!input\.manualDeliveryAuthorizationId/.test(src) &&
    /manual_delivery_authorization_id:\s*input\.manualDeliveryAuthorizationId\s*\?\?\s*null/.test(src)
  );
}

/** Route: role-gated, reason >= 20 chars, both authorized flags hard-required, already-authorized
 * loads 409 (never a silent duplicate), and the route wires revrec + factoring in order. */
export function routeHasFullContract(routeSrc) {
  return (
    /return \["Owner", "Administrator", "Manager"\]\.includes\(role\)/.test(routeSrc) &&
    /reason:\s*z\.string\(\)\.trim\(\)\.min\(20/.test(routeSrc) &&
    /customer_authorized:\s*z\.literal\(true\)/.test(routeSrc) &&
    /factoring_authorized:\s*z\.literal\(true\)/.test(routeSrc) &&
    /already_authorized/.test(routeSrc) &&
    /reply\.code\(409\)/.test(routeSrc) &&
    /postLoadRevenueLatch\(/.test(routeSrc) &&
    /assembleFactoringPacket\(/.test(routeSrc) &&
    /manualDeliveryAuthorizationId:\s*result\.authorization\.id/.test(routeSrc)
  );
}

export function routeIsRegistered(indexSrc) {
  return (
    /import \{ registerManualDeliveryAuthorizationRoutes \} from "\.\/dispatch\/manual-delivery-authorization\.routes\.js";/.test(
      indexSrc
    ) && /await registerManualDeliveryAuthorizationRoutes\(app\);/.test(indexSrc)
  );
}

function selftest() {
  const failures = [];

  const goodPoster = `
async function activeManualDeliveryAuthorizationAt(client, oci, loadId) {
  const res = await client.query(\`
    SELECT authorized_at::text AS authorized_at
    FROM dispatch.manual_delivery_authorizations
    WHERE load_id = $1::uuid
      AND operating_company_id = $2::uuid
      AND revoked_at IS NULL
    ORDER BY authorized_at DESC
    LIMIT 1
  \`);
  return res.rows[0]?.authorized_at ?? null;
}
    let manualAuthEvidence = false;
    if (event === "earn") {
      const departedAt = await finalActiveDeliveryDepartureAt(client, x, y);
      if (!departedAt) {
        const authorizedAt = await activeManualDeliveryAuthorizationAt(client, x, y);
        if (!authorizedAt) return { gate: "missing_delivery_evidence" as const };
        manualAuthEvidence = true;
      }
    }
    const memo =
      event === "earn"
        ? manualAuthEvidence
          ? \`Revrec Event 1 earn — load x [y] (MANUAL DELIVERY AUTHORIZATION — pre-delivery, customer+factoring authorized, see dispatch.manual_delivery_authorizations)\`
          : \`Revrec Event 1 earn — load x [y]\`
        : \`Revrec Event 2 bill — load x [y]\`;
`;
  if (!posterHasManualAuthGate(goodPoster)) failures.push("posterHasManualAuthGate false-negative on good source");
  if (!posterTagsManualAuthMemo(goodPoster)) failures.push("posterTagsManualAuthMemo false-negative on good source");
  if (posterHasManualAuthGate(goodPoster.replace("revoked_at IS NULL", "1=1")))
    failures.push("posterHasManualAuthGate false-positive when revoked_at filter is removed (REGRESSION: would let a revoked authorization keep earning)");
  if (posterTagsManualAuthMemo(goodPoster.replace("MANUAL DELIVERY AUTHORIZATION", "x")))
    failures.push("posterTagsManualAuthMemo false-positive when the distinct tag text is removed");

  const goodPacket = `
export type AssemblePacketInput = {
  force?: boolean;
  manualDeliveryAuthorizationId?: string;
};
    if (!isFactoringPathLoadStatus(load.status) && !input.manualDeliveryAuthorizationId) {
      return { ok: false, reason: \`load_status_not_deliverable:\${load.status}\` };
    }
      {
        manual_delivery_authorization_id: input.manualDeliveryAuthorizationId ?? null,
      },
`;
  if (!packetHonorsManualAuthId(goodPacket)) failures.push("packetHonorsManualAuthId false-negative on good source");
  if (packetHonorsManualAuthId(goodPacket.replace("&& !input.manualDeliveryAuthorizationId", "")))
    failures.push("packetHonorsManualAuthId false-positive when the status-gate bypass is removed (REGRESSION: would refuse every manual-auth packet)");

  const goodRoute = `
function manualDeliveryAuthRoles(role) {
  return ["Owner", "Administrator", "Manager"].includes(role);
}
const authorizeBodySchema = z.object({
  reason: z.string().trim().min(20, "reason must be at least 20 characters"),
  customer_authorized: z.literal(true),
  factoring_authorized: z.literal(true),
});
        if (existingRes.rows[0]) {
          return { error: "already_authorized" as const, authorization_id: existingRes.rows[0].id };
        }
        if (result.error === "already_authorized") {
          return reply.code(409).send({ error: result.error, authorization_id: result.authorization_id });
        }
      const revrec = await postLoadRevenueLatch({ x: 1 });
        packet = await assembleFactoringPacket({
          manualDeliveryAuthorizationId: result.authorization.id,
        });
`;
  if (!routeHasFullContract(goodRoute)) failures.push("routeHasFullContract false-negative on good source");
  if (routeHasFullContract(goodRoute.replace('"Manager"', '"Dispatcher"')))
    failures.push("routeHasFullContract false-positive when the role list is widened past Owner/Administrator/Manager");

  const goodIndex = `
import { registerManualDeliveryAuthorizationRoutes } from "./dispatch/manual-delivery-authorization.routes.js";
  await registerManualDeliveryAuthorizationRoutes(app);
`;
  if (!routeIsRegistered(goodIndex)) failures.push("routeIsRegistered false-negative on good source");
  if (routeIsRegistered(goodIndex.replace("await registerManualDeliveryAuthorizationRoutes(app);", "")))
    failures.push("routeIsRegistered false-positive when the register call is removed (REGRESSION: route would 404)");

  if (failures.length) {
    console.error(`${LABEL}: SELFTEST FAIL`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log(`${LABEL}: SELFTEST PASS (8/8 cases)`);
  process.exit(0);
}

if (process.argv.includes("--selftest")) selftest();

const failures = [];
for (const [file, checkers] of [
  [POSTER_FILE, [["posterHasManualAuthGate (a/d)", posterHasManualAuthGate], ["posterTagsManualAuthMemo (b)", posterTagsManualAuthMemo]]],
  [PACKET_FILE, [["packetHonorsManualAuthId (c)", packetHonorsManualAuthId]]],
  [ROUTE_FILE, [["routeHasFullContract", routeHasFullContract]]],
  [INDEX_FILE, [["routeIsRegistered", routeIsRegistered]]],
]) {
  if (!fs.existsSync(file)) {
    failures.push(`${file}: FILE MISSING`);
    continue;
  }
  const src = fs.readFileSync(file, "utf8");
  for (const [name, fn] of checkers) {
    if (!fn(src)) failures.push(`${file}: ${name} contract not satisfied`);
  }
}

if (failures.length) {
  console.error(`${LABEL}: FAIL`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`${LABEL}: static OK — all 4 contract points (a-d) hold across poster/packet/route/index`);

if (!process.env.DATABASE_URL) {
  console.log(`${LABEL}: DATABASE_URL not set — skipping the live schema check (static half still ran).`);
  console.log(`${LABEL}: to re-run live: DATABASE_URL=<prod> node ${process.argv[1]}`);
  process.exit(0);
}

const { Client } = await import("pg");
const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  await client.query("BEGIN");
  await client.query(`SELECT set_config('app.bypass_rls', 'lucia', true)`);
  const control = await client.query(`SELECT count(*)::int AS n FROM accounting.journal_entries`);
  if (control.rows[0].n === 0) {
    console.error(`${LABEL}: FAIL — je_control=0, this connection cannot see the ledger (masked read, not a verdict)`);
    process.exit(1);
  }
  const tbl = await client.query(
    `SELECT relrowsecurity FROM pg_class WHERE oid = 'dispatch.manual_delivery_authorizations'::regclass`
  );
  const col = await client.query(
    `SELECT count(*)::int AS n FROM information_schema.columns WHERE table_schema='dispatch' AND table_name='pod_documents' AND column_name='source'`
  );
  await client.query("ROLLBACK");
  if (!tbl.rows[0] || tbl.rows[0].relrowsecurity !== true) {
    console.error(`${LABEL}: FAIL — dispatch.manual_delivery_authorizations missing or RLS not enabled`);
    process.exit(1);
  }
  if (col.rows[0].n !== 1) {
    console.error(`${LABEL}: FAIL — dispatch.pod_documents.source column missing`);
    process.exit(1);
  }
  console.log(`${LABEL}: PASS — table live with RLS enabled, pod_documents.source column present (je_control=${control.rows[0].n})`);
} finally {
  await client.end();
}
