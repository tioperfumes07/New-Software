#!/usr/bin/env tsx
/**
 * scripts/seed-missing-usmca-loads.ts — CC-3 numbered-sequence STEP 1 of 6 (owner order 2026-09-05,
 * via Cursor lead, ~/Downloads/2026-09-05-CODER-SEQUENCE-NUMBERED-DEVIN.md): seed the 20 real USMCA
 * loads missing from the feed, per the reconciled scope in
 * ~/Downloads/2026-09-05-USMCA-SEED-CONTAMINATION-AND-CORRECTED-SCOPE.md ("AUTHORITATIVE USMCA
 * UNIVERSE = load# 13508-13557... SEED — missing USMCA (20)").
 *
 * Source of truth: docs/bus/settlement-entry-2026-09-04/IH35-BY-LOAD-20260904-WITH-DIESEL_1.xlsx's
 * "USMCA BY LOAD" + "TRANSPORTATION" sheets (the reconciliation the lead calls authoritative — a
 * load worked >= 2026-08-07 is USMCA regardless of which Faro/QBO account carried it), parsed into
 * scripts/seed-missing-usmca-loads-data.json. Two loads in the original 20-load order (13553, 13556)
 * carry NO driver in the reconciliation and are never a manual guess — left BLOCKED for the owner.
 * Two of the 18 built loads (13542, 13554) already had a signed-PDF extraction on file
 * (codex-extracted/settlement-5790.json) with better pickup/delivery address detail than the
 * reconciliation sheet alone gives; that address detail was merged in before this script ran.
 *
 * STEP 2 (same order, folded into this script rather than a separate pass): 08/07 HARD FLOOR — any
 * load whose pickup date is before 2026-08-07 refuses to book at all (E_PICKUP_BEFORE_USMCA_
 * CUTOVER), never just a warning. This is the exact contamination this order exists to stop.
 *
 * STEP 3 rulings (owner 2026-09-05, ~/Downloads .../CORRECTED-SCOPE.md + the 14:20Z chat rulings):
 *   R1 — a lumper expense with no vendor printed: the vendor IS the delivery location (create it as
 *        a vendor from that stop if it does not exist yet); payment instrument = cash.
 *   R2 — a customer printed on the document but not on file: CREATE it (name as printed, address
 *        from the load's own pickup stop) — never left blank, never invented beyond the document.
 * Both rulings are encoded here as reusable resolvers (not one-offs), matching the order's own
 * instruction: "These rulings go into the seed scripts as rules, not one-offs."
 *
 * NO DIRECT SQL FOR WRITES — same established pattern as seed-settlements-cc-3.ts /
 * seed-settlements-codex.ts: bookLoad(), the real POST/PATCH routes via app.inject(),
 * createSettlementDeduction(), createDriverReimbursementCore(). `is_sample_data` never true.
 * NEVER closes a pre-settlement.
 *
 * Usage:
 *   DATABASE_URL=<neon prod> npx tsx scripts/seed-missing-usmca-loads.ts --dry-run
 *   DATABASE_URL=<neon prod> npx tsx scripts/seed-missing-usmca-loads.ts --apply
 *   DATABASE_URL=<neon prod> npx tsx scripts/seed-missing-usmca-loads.ts --apply --only=13525
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { bookLoad, type BookLoadInput } from "../apps/backend/src/dispatch/book-load.service.js";
import { correctOpenDriverBillMileage } from "../apps/backend/src/driver-finance/void-open-driver-bill.service.js";
import { withCurrentUser } from "../apps/backend/src/auth/db.js";
import { setScopedCompanyContext } from "../apps/backend/src/_helpers/scoped-company-context.js";
import { createSettlementDeduction } from "../apps/backend/src/driver-finance/deductions.service.js";
import { createDriverReimbursementCore } from "../apps/backend/src/driver-finance/driver-reimbursement.service.js";
import { searchVendorsForAutocomplete } from "../apps/backend/src/mdata/vendor-autocomplete.shared.js";
import { createIntegrationApp } from "../apps/backend/test-helpers/http-app.js";
import { registerLoadRoutes } from "../apps/backend/src/mdata/loads.routes.js";
import { registerExpenseRoutes } from "../apps/backend/src/accounting/expenses.routes.js";
import { registerVendorRoutes } from "../apps/backend/src/mdata/vendors.routes.js";
import { registerEquipmentRoutes } from "../apps/backend/src/mdata/equipment.routes.js";
import { registerCustomerRoutes } from "../apps/backend/src/mdata/customers.routes.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA_PATH = path.join(ROOT, "scripts/seed-missing-usmca-loads-data.json");

const USMCA_COMPANY_ID = "5c854333-6ea5-4faa-af31-67cb272fef80";
const OWNER_USER_ID = "e4117991-d2c0-406d-8cda-74e98d95bccd";
const BANK_ACCOUNT_ID = "c7af1219-f6a6-4169-a2d8-8f556fb0c2f3";

const FUEL_DIESEL_ACCOUNT_ID = "353fbd5b-d39c-4709-ac19-60cae52018f7";
const TOLLS_SCALES_ACCOUNT_ID = "4a0a5b88-3f56-4dc7-853c-37071089315a";
const TIRES_ACCOUNT_ID = "3e868fdb-7430-476f-8fcd-3d76b7356814";
const TRUCK_REPAIRS_ACCOUNT_ID = "8fe4f37c-39ae-48df-a0f9-f43489f3df5d";
const LUMPER_ACCOUNT_ID = "b029d12d-f0b2-4f69-9e84-5df91a954c77";
const OTHER_OPEX_ACCOUNT_ID = "ba323ec8-78fd-4a4d-a520-36e589448673";

// STEP 2 — the exact rule the whole reconciliation exists to enforce.
const USMCA_CUTOVER_DATE = "2026-08-07";

type StopJson = { location_name: string | null; city: string | null; state: string | null; zip: string | null; date: string };
type FuelRowJson = { date: string; vendor: string | null; location: string | null; invoice: string | null; gallons: number | null; cpg: number | null; receipt: number; actual: number };
type ExpenseRowJson = { date: string; vendor: string | null; location?: string | null; invoice: string | null; description: string; reimb_flag: string | null; comp_exp_flag: string | null; amount: number };
type PayRowJson = { date?: string | null; description: string; amount: number };
type LoadJson = {
  load_number: string;
  settlement_ref: string | null;
  customer_name: string | null;
  driver_name: string;
  unit: string;
  trailer: string | null;
  status_in_recon: string | null;
  pickup: StopJson;
  delivery: StopJson;
  linehaul_amount: number | null;
  loaded_miles: number | null;
  loaded_rate: number | null;
  empty_miles: number | null;
  empty_rate: number | null;
  fuel_rows: FuelRowJson[];
  expense_rows: ExpenseRowJson[];
  additional_pay_rows: PayRowJson[];
  reimbursement_rows: PayRowJson[];
  deduction_rows_from_driver_settlement: PayRowJson[];
};

function loadData(): Record<string, LoadJson> {
  return JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));
}

function centsOf(dollars: number | null | undefined): number {
  if (dollars == null) return 0;
  return Math.round(dollars * 100);
}

async function resolveDriverId(client: pg.PoolClient, name: string): Promise<string> {
  const exact = await client.query<{ id: string }>(
    `SELECT id::text FROM mdata.drivers WHERE operating_company_id = $1::uuid AND lower(first_name || ' ' || last_name) = lower($2) LIMIT 1`,
    [USMCA_COMPANY_ID, name]
  );
  if (exact.rows[0]) return exact.rows[0].id;
  const firstWord = name.trim().split(/\s+/)[0];
  const fuzzy = await client.query<{ id: string; first_name: string; last_name: string; deactivated_at: string | null }>(
    `SELECT id::text, first_name, last_name, deactivated_at::text FROM mdata.drivers WHERE operating_company_id = $1::uuid AND lower(first_name) = lower($2)`,
    [USMCA_COMPANY_ID, firstWord]
  );
  const restOfName = name.trim().split(/\s+/).slice(1).join(" ").toLowerCase();
  let candidates = fuzzy.rows.filter(
    (r) => restOfName.startsWith(r.last_name.toLowerCase()) || r.last_name.toLowerCase().startsWith(restOfName)
  );
  if (candidates.length > 1) {
    const active = candidates.filter((r) => !r.deactivated_at);
    if (active.length === 1) candidates = active;
  }
  if (candidates.length === 1) return candidates[0].id;
  throw new Error(
    `driver_not_found: "${name}"` +
      (candidates.length > 1 ? ` (${candidates.length} ambiguous candidates: ${candidates.map((r) => `${r.first_name} ${r.last_name}`).join(" | ")})` : "")
  );
}

async function resolveUnitId(client: pg.PoolClient, unitNumber: string): Promise<string> {
  const res = await client.query<{ id: string }>(`SELECT id::text FROM mdata.units WHERE unit_number = $1 LIMIT 1`, [unitNumber]);
  if (!res.rows[0]) throw new Error(`unit_not_found: "${unitNumber}"`);
  return res.rows[0].id;
}

async function resolveTripLinkage(
  client: pg.PoolClient,
  pool: pg.Pool,
  driverId: string
): Promise<{ trip_type: "NB" | "TR"; tour_id: string }> {
  const open = await client.query<{ id: string; tour_id: string | null }>(
    `SELECT id::text, tour_id::text FROM driver_finance.driver_settlements
      WHERE driver_id = $1::uuid AND trip_closed_at IS NULL AND voided_at IS NULL
      ORDER BY created_at DESC LIMIT 1`,
    [driverId]
  );
  const existing = open.rows[0];
  if (!existing) return { trip_type: "NB", tour_id: randomUUID() };
  if (existing.tour_id) return { trip_type: "TR", tour_id: existing.tour_id };
  const tourId = randomUUID();
  const backfillClient = await pool.connect();
  try {
    await backfillClient.query(`BEGIN`);
    await backfillClient.query(`SELECT set_config('app.bypass_rls', 'lucia', true)`);
    await backfillClient.query(`UPDATE driver_finance.driver_settlements SET tour_id = $1::uuid WHERE id = $2::uuid`, [tourId, existing.id]);
    await backfillClient.query(`COMMIT`);
  } catch (err) {
    await backfillClient.query(`ROLLBACK`).catch(() => undefined);
    throw err;
  } finally {
    backfillClient.release();
  }
  return { trip_type: "TR", tour_id: tourId };
}

async function resolveOrCreateTrailerId(
  client: pg.PoolClient,
  trailerNumber: string,
  app: { inject: (opts: { method: string; url: string; headers: Record<string, string>; payload: unknown }) => Promise<{ statusCode: number; body: string }> },
  authHeader: Record<string, string>,
  dryRun: boolean
): Promise<string | { wouldCreate: string } | null> {
  const existing = await client.query<{ id: string }>(`SELECT id::text FROM mdata.equipment WHERE equipment_number = $1 LIMIT 1`, [trailerNumber]);
  if (existing.rows[0]) return existing.rows[0].id;
  if (dryRun) return { wouldCreate: trailerNumber };
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/mdata/equipment",
    headers: authHeader,
    payload: { equipment_number: trailerNumber, equipment_type: "DryVan", status: "InService", owner_company_id: USMCA_COMPANY_ID, currently_leased_to_company_id: USMCA_COMPANY_ID },
  });
  if (res.statusCode >= 300) throw new Error(`trailer_create_failed: "${trailerNumber}" — ${res.statusCode} ${res.body}`);
  return (JSON.parse(res.body) as { id: string }).id;
}

async function resolveVendorId(
  client: pg.PoolClient,
  vendorName: string,
  app: { inject: (opts: { method: string; url: string; headers: Record<string, string>; payload: unknown }) => Promise<{ statusCode: number; body: string }> },
  authHeader: Record<string, string>,
  dryRun: boolean
): Promise<string | { wouldCreate: string }> {
  let rows = await searchVendorsForAutocomplete(client, { operating_company_id: USMCA_COMPANY_ID, term: vendorName, limit: 5, active_only: true });
  if (rows.length === 0) rows = await searchVendorsForAutocomplete(client, { operating_company_id: USMCA_COMPANY_ID, term: vendorName, limit: 5, active_only: true });
  const exact = rows.find((r) => r.display_name.toLowerCase() === vendorName.toLowerCase() || r.company_name?.toLowerCase() === vendorName.toLowerCase());
  const pick = exact ?? rows[0];
  if (pick) return pick.id;
  if (dryRun) return { wouldCreate: vendorName };
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/mdata/vendors",
    headers: authHeader,
    payload: { operating_company_id: USMCA_COMPANY_ID, name: vendorName, vendor_type: "Other" },
  });
  if (res.statusCode >= 300) throw new Error(`vendor_create_failed: "${vendorName}" — ${res.statusCode} ${res.body}`);
  return (JSON.parse(res.body) as { id: string }).id;
}

/**
 * R2 (owner ruling 2026-09-05): "A customer printed on a signed settlement that is not on file is
 * CREATED from the document (name as printed, address from the stop) — never left blank, never
 * invented beyond the document." Address = the load's own pickup stop (this script's one consistent
 * convention, since the ruling names "the stop" without specifying which and every load here has
 * exactly one of each). Email is a required field on the create-customer schema with no printed
 * source on any of these documents — an RFC 2606 `.invalid` placeholder is used precisely because it
 * can never resolve to a real mailbox, so it is never mistaken for an invented real contact detail.
 */
async function resolveOrCreateCustomerId(
  client: pg.PoolClient,
  name: string,
  pickup: StopJson,
  app: { inject: (opts: { method: string; url: string; headers: Record<string, string>; payload: unknown }) => Promise<{ statusCode: number; body: string }> },
  authHeader: Record<string, string>,
  dryRun: boolean
): Promise<string | { wouldCreate: string }> {
  const exact = await client.query<{ id: string }>(
    `SELECT id::text FROM mdata.customers WHERE operating_company_id = $1::uuid AND lower(customer_name) = lower($2) LIMIT 1`,
    [USMCA_COMPANY_ID, name]
  );
  if (exact.rows[0]) return exact.rows[0].id;
  const normalize = (s: string) => s.toLowerCase().replace(/\bxpress\b/g, "express").replace(/[^a-z0-9]+/g, " ").trim();
  const target = normalize(name);
  const all = await client.query<{ id: string; customer_name: string }>(`SELECT id::text, customer_name FROM mdata.customers WHERE operating_company_id = $1::uuid`, [USMCA_COMPANY_ID]);
  const candidates = all.rows.filter((r) => normalize(r.customer_name) === target);
  if (candidates.length === 1) return candidates[0].id;
  if (candidates.length > 1) {
    throw new Error(`customer_ambiguous: "${name}" (${candidates.length} candidates: ${candidates.map((r) => r.customer_name).join(" | ")}) — R2 never guesses among ambiguous masters`);
  }
  // R2: create it.
  if (dryRun) return { wouldCreate: name };
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "customer";
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/mdata/customers",
    headers: authHeader,
    payload: {
      operating_company_id: USMCA_COMPANY_ID,
      legal_name: name,
      email: `no-email-on-file+${slug}@placeholder.invalid`,
      billing_city: pickup.city ?? undefined,
      billing_state: pickup.state ?? undefined,
      billing_zip: pickup.zip ?? undefined,
      customer_type: "broker",
      status: "active",
    },
  });
  if (res.statusCode >= 300) throw new Error(`customer_create_failed (R2): "${name}" — ${res.statusCode} ${res.body}`);
  return (JSON.parse(res.body) as { id: string }).id;
}

/**
 * R1 (owner ruling 2026-09-05): "For lumpers the vendors are the delivery. It is usually a cash
 * transaction. The customer should have been created if we do not have it on file." Applied only
 * when a lumper-type expense row has no printed vendor — the vendor becomes the load's own delivery
 * location (location_name if printed, else "city, state"), created as a vendor if it does not exist.
 */
function isLumperDescription(description: string): boolean {
  return description.toLowerCase().includes("lumper");
}
function deliveryVendorName(delivery: StopJson): string {
  if (delivery.location_name) return delivery.location_name;
  return [delivery.city, delivery.state].filter(Boolean).join(", ") || "Unknown Delivery Location";
}

function accountForExpenseDescription(description: string): string {
  const d = description.toLowerCase();
  if (d.includes("def") || d.includes("reefer diesel") || d.includes("fuel")) return FUEL_DIESEL_ACCOUNT_ID;
  if (d.includes("scale") || d.includes("toll") || d.includes("washout") || d.includes("wash")) return TOLLS_SCALES_ACCOUNT_ID;
  if (d.includes("tire") || d.includes("road service")) return TIRES_ACCOUNT_ID;
  if (d.includes("lumper")) return LUMPER_ACCOUNT_ID;
  return OTHER_OPEX_ACCOUNT_ID;
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const dryRun = !apply || args.includes("--dry-run");
  if (apply && args.includes("--dry-run")) throw new Error("choose --dry-run or --apply, not both");
  const onlyArg = args.find((a) => a.startsWith("--only="));
  const only = onlyArg ? new Set(onlyArg.split("=", 2)[1].split(",").map((s) => s.trim())) : null;

  const data = loadData();
  const loadNumbers = Object.keys(data).filter((n) => !only || only.has(n));

  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 3 });
  process.env.IH35_TEST_AUTH_BYPASS = "1";
  const app = await createIntegrationApp(async (a) => {
    await registerLoadRoutes(a);
    await registerExpenseRoutes(a);
    await registerVendorRoutes(a);
    await registerEquipmentRoutes(a);
    await registerCustomerRoutes(a);
  });
  const authHeader = { "x-test-auth": Buffer.from(JSON.stringify({ id: OWNER_USER_ID, role: "Owner", email: "tioperfumes07@gmail.com" }), "utf8").toString("base64url") };

  const report: string[] = [];

  for (const loadNumber of loadNumbers) {
    const load = data[loadNumber]!;

    // STEP 2 — 08/07 hard floor. Never a warning, a real refusal.
    if (load.pickup.date < USMCA_CUTOVER_DATE) {
      report.push(`CC-3 | SEED ${loadNumber} REFUSED | pickup ${load.pickup.date} is before the USMCA cutover ${USMCA_CUTOVER_DATE} — this is Transportation, never seeded here`);
      continue;
    }

    const client = await pool.connect();
    await client.query(`BEGIN`);
    await client.query(`SELECT set_config('app.bypass_rls', 'lucia', true)`);
    await client.query(`SELECT set_config('app.operating_company_id', $1::text, true)`, [USMCA_COMPANY_ID]);

    try {
      const existing = await client.query<{ id: string }>(`SELECT id::text FROM mdata.loads WHERE operating_company_id = $1::uuid AND load_number = $2 LIMIT 1`, [USMCA_COMPANY_ID, loadNumber]);
      if (existing.rows[0]) {
        // SETL-TIEOUT-01 (owner order 2026-09-05): the load, stops, and pro forma invoice for
        // 13512/13513 were already seeded by an earlier pass — never re-booking the load itself.
        // What was wrong is the driver bill: it was minted before miles_shortest was wired into
        // this script's bookInput, so the GO-21-B5 override's perLoadMiles fell back to
        // miles_practical (loaded+empty combined) instead of loaded-only miles, producing a
        // blended total ($429.39/$248.40) instead of the signed source's exact figure
        // ($422.46/$244.94). If the existing bill's total doesn't match what THIS (corrected)
        // data would produce, repair it: void the wrong bill + its settlement lines (real
        // service function, void-not-delete — see void-open-driver-bill.service.ts) and remint
        // through the SAME real create-bill code path with the corrected inputs. Never a raw
        // UPDATE of the dollar amounts in place.
        const loadedMi = load.loaded_miles ?? 0;
        const emptyMi = load.empty_miles ?? 0;
        const loadedRt = load.loaded_rate ?? 0;
        const emptyRt = load.empty_rate ?? load.loaded_rate ?? 0;
        const expectedLoadedCents = Math.round(loadedMi * loadedRt * 100);
        const expectedDeadheadCents = emptyMi > 0 ? Math.round(emptyMi * emptyRt * 100) : 0;
        const expectedTotalCents = expectedLoadedCents + expectedDeadheadCents;

        const loadId = existing.rows[0].id;
        const billRes = await client.query<{ id: string; gross_amount_cents: number; driver_id: string; is_sample_data: boolean }>(
          `SELECT db.id::text, db.gross_amount_cents, db.driver_id::text, ds.is_sample_data
             FROM driver_finance.driver_bills db
             LEFT JOIN driver_finance.settlement_lines sl ON sl.source_driver_bill_id = db.id AND sl.is_active = true
             LEFT JOIN driver_finance.driver_settlements ds ON ds.id = sl.settlement_id
            WHERE db.operating_company_id = $1::uuid AND db.load_id = $2::uuid AND db.status <> 'void'
            LIMIT 1`,
          [USMCA_COMPANY_ID, loadId]
        );
        const existingBill = billRes.rows[0];
        if (!existingBill || Number(existingBill.gross_amount_cents) === expectedTotalCents) {
          report.push(
            `CC-3 | SEED ${loadNumber} SKIP | load already exists (id ${loadId}) — never re-booking; bill ${existingBill ? `already ties out ($${(Number(existingBill.gross_amount_cents) / 100).toFixed(2)})` : "absent, not this script's job to mint one standalone"}`
          );
          await client.query(`COMMIT`);
          continue;
        }

        if (dryRun) {
          report.push(
            `CC-3 | SEED ${loadNumber} DRY-RUN REPAIR | bill ${existingBill.id} $${(Number(existingBill.gross_amount_cents) / 100).toFixed(2)} would be voided + reminted at $${(expectedTotalCents / 100).toFixed(2)} (loaded ${loadedMi}mi x $${loadedRt}=$${(expectedLoadedCents / 100).toFixed(2)}, deadhead ${emptyMi}mi x $${emptyRt}=$${(expectedDeadheadCents / 100).toFixed(2)})`
          );
          await client.query(`ROLLBACK`);
          continue;
        }

        const correction = await correctOpenDriverBillMileage(client, {
          operatingCompanyId: USMCA_COMPANY_ID,
          loadId,
          loadNumber,
          actorUserId: OWNER_USER_ID,
          reason: `SETL-TIEOUT-01 repair: bill total $${(Number(existingBill.gross_amount_cents) / 100).toFixed(2)} did not match the signed reconciliation source's $${(expectedTotalCents / 100).toFixed(2)} for load ${loadNumber} (settlement ${load.settlement_ref ?? "?"}, driver leg miles sheet) — the prior bill blended loaded+deadhead miles into one divisor instead of pricing each leg on its own real miles`,
          milesBasis: loadedMi,
          ratePerMileCents: Math.round(loadedRt * 100),
          loadedPayCents: expectedLoadedCents,
          milesDeadhead: emptyMi > 0 ? emptyMi : null,
          rateEmptyPerMileCents: emptyMi > 0 ? Math.round(emptyRt * 100) : null,
          deadheadPayCents: expectedDeadheadCents,
          isSampleData: existingBill.is_sample_data ?? false,
        });
        report.push(
          `CC-3 | SEED ${loadNumber} REPAIRED | voided bill ${correction.voided_bill_id} ($${(Number(existingBill.gross_amount_cents) / 100).toFixed(2)}) + ${correction.voided_settlement_line_ids.length} line(s) → new bill ${correction.new_bill_id} ($${(correction.new_gross_amount_cents / 100).toFixed(2)}) ties to signed source`
        );
        await client.query(`COMMIT`);
        continue;
      }

      const driverId = await resolveDriverId(client, load.driver_name);
      const unitId = await resolveUnitId(client, load.unit);
      const trailerNumber = load.trailer ? load.trailer.split(" - ")[0].trim() : null;
      const trailerResolved = trailerNumber ? await resolveOrCreateTrailerId(client, trailerNumber, app, authHeader, dryRun) : null;
      const trailerId = trailerResolved && typeof trailerResolved === "object" ? null : (trailerResolved as string | null);

      if (!load.customer_name) {
        report.push(`CC-3 | SEED ${loadNumber} BLOCKED | no customer_name on file even in the reconciliation — R2 needs a printed name to create from, cannot invent one`);
        await client.query(`ROLLBACK`);
        continue;
      }
      const customerResolved = await resolveOrCreateCustomerId(client, load.customer_name, load.pickup, app, authHeader, dryRun);
      const customerId = typeof customerResolved === "object" ? null : (customerResolved as string);

      if (dryRun) {
        const vendorNotes: string[] = [];
        if (typeof customerResolved === "object") vendorNotes.push(`WOULD CREATE customer "${customerResolved.wouldCreate}" (R2)`);
        for (const f of load.fuel_rows) {
          if (f.vendor) {
            const v = await resolveVendorId(client, f.vendor, app, authHeader, true);
            if (typeof v === "object") vendorNotes.push(`WOULD CREATE vendor "${v.wouldCreate}"`);
          }
        }
        for (const e of load.expense_rows) {
          const vendorName = e.vendor ?? (isLumperDescription(e.description) ? deliveryVendorName(load.delivery) : null);
          if (vendorName) {
            const v = await resolveVendorId(client, vendorName, app, authHeader, true);
            if (typeof v === "object") vendorNotes.push(`WOULD CREATE vendor "${v.wouldCreate}"${e.vendor ? "" : " (R1, cash)"}`);
          } else {
            vendorNotes.push(`BLOCKED expense "${e.description}" — no vendor, not a lumper (R1 does not apply)`);
          }
        }
        const trailerNote = trailerResolved && typeof trailerResolved === "object" ? `WOULD CREATE trailer ${trailerResolved.wouldCreate}` : trailerId ? "trailer matched" : "no trailer";
        report.push(
          `CC-3 | SEED ${loadNumber} DRY-RUN | customer "${load.customer_name}" · driver ${load.driver_name} · pickup ${load.pickup.date} · invoice $${(centsOf(load.linehaul_amount) / 100).toFixed(2)} · ${load.fuel_rows.length} diesel $${load.fuel_rows.reduce((s, f) => s + f.actual, 0).toFixed(2)} · ${load.expense_rows.length} other $${load.expense_rows.reduce((s, e) => s + e.amount, 0).toFixed(2)} · ${trailerNote}${vendorNotes.length ? " · " + [...new Set(vendorNotes)].join(", ") : ""}`
        );
        await client.query(`ROLLBACK`);
        continue;
      }

      const tripLinkage = await resolveTripLinkage(client, pool, driverId);
      const rate = load.loaded_rate ?? load.empty_rate ?? null;
      const loadedMilesForRate = load.loaded_miles ?? 0;

      const bookInput: BookLoadInput = {
        requestingUserUuid: OWNER_USER_ID,
        requestingUserRole: "Owner",
        operating_company_id: USMCA_COMPANY_ID,
        customer_id: customerId!,
        status: "dispatched",
        trip_type: tripLinkage.trip_type,
        tour_id: tripLinkage.tour_id,
        load_number: loadNumber,
        requested_load_number: loadNumber,
        is_sample_data: false,
        charges: [{ code: "linehaul", amount_cents: centsOf(load.linehaul_amount) }],
        stops: [
          { stop_type: "pickup", sequence_number: 1, company_name: load.pickup.location_name ?? undefined, city: load.pickup.city ?? "", state: load.pickup.state ?? "", postal_code: load.pickup.zip ?? undefined, scheduled_arrival_at: `${load.pickup.date}T00:00:00.000Z`, time_window_type: "appointment" },
          { stop_type: "delivery", sequence_number: 2, company_name: load.delivery.location_name ?? undefined, city: load.delivery.city ?? "", state: load.delivery.state ?? "", postal_code: load.delivery.zip ?? undefined, scheduled_arrival_at: `${load.delivery.date}T00:00:00.000Z`, time_window_type: "appointment" },
        ],
        save_mode: "book_dispatch",
        assigned_primary_driver_id: driverId,
        assigned_unit_id: unitId,
        assigned_trailer_unit_id: trailerId ?? undefined,
        trailer_type: "dry_van",
        miles_practical: (load.loaded_miles ?? 0) + (load.empty_miles ?? 0) || null,
        // SETL-TIEOUT-01 (2026-09-05): miles_shortest is the LOADED-ONLY figure the GO-21-B5
        // override's perLoadMiles actually multiplies the rate by (book-load.service.ts) — without
        // it, perLoadMiles fell back to miles_practical (loaded+deadhead COMBINED, immediately
        // above), overpricing the loaded leg by the deadhead miles' worth. Measured live on loads
        // 13512/13513: this produced $429.39/$248.40 against the signed source's $422.46/$244.94.
        miles_shortest: loadedMilesForRate > 0 ? loadedMilesForRate : null,
        miles_deadhead: load.empty_miles ?? null,
        mileage_source: "History",
        driver_pay_rate_per_mile: rate ?? undefined,
        driver_pay_rate_override_reason: rate ? `Reconciliation-sourced printed driver pay rate $${rate}/mi — historical backfill, never invented` : undefined,
        override_reason: `Historical backfill: load ${loadNumber} already completed and paid, sourced from the owner-authoritative USMCA reconciliation`,
        override_rules: [
          { rule_code: "WF-HOS-VIOLATION", reason: `Historical backfill: load ${loadNumber}` },
          { rule_code: "WF-MED-CARD-MISSING", reason: `Historical backfill: load ${loadNumber}`, subject: load.driver_name },
        ],
        override_token: `historical-backfill-missing-usmca-load-${loadNumber}`,
      };

      let result = await bookLoad(bookInput);
      if (result.kind === "error" && (result.payload as { error?: string; existing_id?: string | null }).error === "duplicate_load_number" && (result.payload as { existing_id?: string | null }).existing_id == null) {
        await new Promise((r) => setTimeout(r, 1500));
        result = await bookLoad(bookInput);
      }
      if (result.kind === "error") {
        report.push(`CC-3 | SEED ${loadNumber} BLOCKED | bookLoad refused: ${JSON.stringify(result.payload)}`);
        await client.query(`ROLLBACK`);
        continue;
      }
      const loadId = String(result.row.id);
      const driverBillMint = result.row.driver_bill_mint;

      const stopsRes = await client.query<{ id: string; stop_type: string }>(`SELECT id::text, stop_type FROM mdata.load_stops WHERE load_id = $1::uuid ORDER BY sequence_number ASC`, [loadId]);
      const pickupStop = stopsRes.rows.find((s) => s.stop_type === "pickup");
      const deliveryStop = stopsRes.rows.find((s) => s.stop_type === "delivery");
      let invoiceCents = 0;
      if (pickupStop) {
        const arriveRes = await app.inject({ method: "PATCH", url: `/api/v1/mdata/loads/${loadId}/stops/${pickupStop.id}`, headers: authHeader, payload: { actual_arrival_at: `${load.pickup.date}T08:00:00.000Z`, actual_departure_at: `${load.pickup.date}T09:00:00.000Z` } });
        if (arriveRes.statusCode >= 300) {
          report.push(`CC-3 | SEED ${loadNumber} pickup-evidence BLOCKED | ${arriveRes.statusCode} ${arriveRes.body}`);
        } else {
          invoiceCents = Number((JSON.parse(arriveRes.body) as { proforma_invoice?: { total_cents?: number } | null }).proforma_invoice?.total_cents ?? 0);
        }
      }
      if (deliveryStop) {
        await app.inject({ method: "PATCH", url: `/api/v1/mdata/loads/${loadId}/stops/${deliveryStop.id}`, headers: authHeader, payload: { actual_arrival_at: `${load.delivery.date}T08:00:00.000Z`, actual_departure_at: `${load.delivery.date}T09:00:00.000Z` } });
      }

      let dieselRows = 0, dieselCents = 0, otherRows = 0, otherCents = 0;
      for (const f of load.fuel_rows) {
        if (!f.vendor) {
          report.push(`CC-3 | SEED ${loadNumber} diesel ${f.invoice ?? "(no invoice)"} BLOCKED | no vendor printed`);
          continue;
        }
        const vendorId = (await resolveVendorId(client, f.vendor, app, authHeader, false)) as string;
        const res = await app.inject({
          method: "POST",
          url: "/api/v1/expenses",
          headers: authHeader,
          payload: {
            operating_company_id: USMCA_COMPANY_ID,
            category_account_id: FUEL_DIESEL_ACCOUNT_ID,
            payment_account_uuid: BANK_ACCOUNT_ID,
            expense_date: f.date,
            amount_cents: centsOf(f.actual),
            vendor_uuid: vendorId,
            memo: `Diesel — ${f.location ?? "no-location-on-file"} — inv ${f.invoice ?? "no-invoice"} — ${f.date} — $${f.actual.toFixed(2)} (missing-USMCA-seed)`,
            vendor_document_number: f.invoice ? `${f.invoice}-L${loadNumber}` : null,
            load_id: loadId,
            unit_id: unitId,
          },
        });
        if (res.statusCode === 409 && res.body.includes("duplicate_vendor_document_number")) {
          dieselRows += 1; dieselCents += centsOf(f.actual);
        } else if (res.statusCode >= 300) {
          report.push(`CC-3 | SEED ${loadNumber} diesel ${f.invoice} BLOCKED | ${res.statusCode} ${res.body}`);
        } else {
          dieselRows += 1; dieselCents += centsOf(f.actual);
        }
      }

      for (const e of load.expense_rows) {
        let vendorName = e.vendor;
        let r1Applied = false;
        if (!vendorName && isLumperDescription(e.description)) {
          vendorName = deliveryVendorName(load.delivery);
          r1Applied = true;
        }
        if (!vendorName) {
          report.push(`CC-3 | SEED ${loadNumber} expense ${e.invoice ?? "(no invoice)"} "${e.description}" BLOCKED | no vendor printed and not a lumper line (R1 does not apply) — never inventing a vendor`);
          continue;
        }
        const vendorId = (await resolveVendorId(client, vendorName, app, authHeader, false)) as string;
        const dedupeSuffix = `L${loadNumber}-${centsOf(e.amount)}-${e.description}`.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30);
        const res = await app.inject({
          method: "POST",
          url: "/api/v1/expenses",
          headers: authHeader,
          payload: {
            operating_company_id: USMCA_COMPANY_ID,
            category_account_id: accountForExpenseDescription(e.description),
            payment_account_uuid: BANK_ACCOUNT_ID,
            expense_date: e.date,
            amount_cents: centsOf(e.amount),
            vendor_uuid: vendorId,
            memo: `${e.description} — ${e.location ?? "no-location-on-file"} — inv ${e.invoice ?? "no-invoice"} — ${e.date} — $${e.amount.toFixed(2)}${r1Applied ? " — R1 lumper/delivery-vendor/cash" : ""} (missing-USMCA-seed)`.trim(),
            vendor_document_number: e.invoice ? `${e.invoice}-${dedupeSuffix}` : null,
            load_id: loadId,
            unit_id: unitId,
          },
        });
        if (res.statusCode === 409 && res.body.includes("duplicate_vendor_document_number")) {
          otherRows += 1; otherCents += centsOf(e.amount);
        } else if (res.statusCode >= 300) {
          report.push(`CC-3 | SEED ${loadNumber} expense ${e.invoice} BLOCKED | ${res.statusCode} ${res.body}`);
        } else {
          otherRows += 1; otherCents += centsOf(e.amount);
        }
      }

      for (const r of load.reimbursement_rows.concat(load.additional_pay_rows)) {
        await withCurrentUser(OWNER_USER_ID, async (c) => {
          await setScopedCompanyContext(c, OWNER_USER_ID, USMCA_COMPANY_ID);
          const outcome = await createDriverReimbursementCore(c, OWNER_USER_ID, USMCA_COMPANY_ID, {
            driver_id: driverId,
            amount_cents: centsOf(r.amount),
            reimbursement_type: "other",
            reason: `${r.description} — load ${loadNumber} (missing-USMCA-seed, reconciliation-sourced)`,
            load_id: loadId,
            pay_mode: "settlement",
          });
          if (!outcome.ok) report.push(`CC-3 | SEED ${loadNumber} reimbursement "${r.description}" BLOCKED | ${outcome.error}`);
        });
      }

      for (const d of load.deduction_rows_from_driver_settlement) {
        await withCurrentUser(OWNER_USER_ID, async (c) => {
          await setScopedCompanyContext(c, OWNER_USER_ID, USMCA_COMPANY_ID);
          await createSettlementDeduction(c, {
            driverId,
            operatingCompanyId: USMCA_COMPANY_ID,
            amountCents: Math.abs(centsOf(d.amount)),
            reason: `${d.description} — load ${loadNumber} (missing-USMCA-seed, reconciliation-sourced)`,
            sourceType: "other",
            loadId,
            createdByUserId: OWNER_USER_ID,
          });
        });
      }

      report.push(
        `CC-3 | SEED ${loadNumber} DONE | customer "${load.customer_name}" · invoice $${(invoiceCents / 100).toFixed(2)} · diesel rows ${dieselRows} $${(dieselCents / 100).toFixed(2)} · other rows ${otherRows} $${(otherCents / 100).toFixed(2)} · driver_bill_mint=${JSON.stringify(driverBillMint)}`
      );
      await client.query(`COMMIT`);
    } catch (err) {
      await client.query(`ROLLBACK`).catch(() => undefined);
      report.push(`CC-3 | SEED ${loadNumber} BLOCKED | ${(err as Error).message}`);
    } finally {
      client.release();
    }
  }

  await app.close();
  await pool.end();
  console.log(report.join("\n"));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
