import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { z } from "zod";
import { countUncategorizedTransactions } from "../banking/pending-categorization.js";
import { companyQuerySchema, currentAuthUser, validationError, withCompanyScope } from "./shared.js";

/** TAB-COMPLETION-STANDARD A — twelve hubs, both-way or explicit N/A. Silence is a defect. */
export const LOAD_COSTS_HUB_LINKAGE = {
  1: { hub: "org.companies", via: "operating_company_id on loads, expenses, bills, driver_bills", reverse: "company-scoped lists" },
  2: { hub: "identity.users", via: "created_by / actor on expense and bill rows when present", reverse: "user activity / audit" },
  3: { hub: "mdata.drivers", via: "load.assigned_primary_driver_id; expense.driver_uuid; bill.driver_id", reverse: "driver profile costs / bills" },
  4: { hub: "mdata.units", via: "load.assigned_unit_id", reverse: "unit profile loads" },
  5: { hub: "mdata.loads", via: "load_id on expenses, bill_lines, driver_bills — the board key", reverse: "this board and load Costs tab" },
  6: { hub: "catalogs.accounts", via: "expense and bill line GL account when coded", reverse: "GL / account register" },
  7: { hub: "mdata.customers", via: "load.customer_id", reverse: "customer loads" },
  8: { hub: "maintenance.work_orders", via: "same-load linked_work_order_uuid on the expense or bill; only direct trip repairs enter R&M", reverse: "work order financial links and load Costs board" },
  9: { hub: "mdata.vendors", via: "expense.vendor_id and bills.vendor_id", reverse: "vendor bills / expenses" },
  10: { hub: "accounting.journal_entries", via: "posting on the expense or bill, never a parallel ledger", reverse: "JE source links" },
  11: { hub: "docs.files", via: "receipts / attachments on the expense or bill", reverse: "Docs module by source id" },
  12: { hub: "mdata.equipment", via: "dispatch.load_assignment_history.new_trailer_id, most recent row (mdata.loads has no trailer_id column)", reverse: "equipment / trailer loads" },
} as const;

export async function registerLoadCostsBoardRoutes(app: FastifyInstance) {
  app.get("/api/v1/accounting/load-costs-board", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req, reply) => {
    const user = currentAuthUser(req, reply);
    if (!user) return;
    if (!["Owner", "Administrator", "Accountant", "Dispatcher", "SuperAdmin"].includes(String(user.role ?? ""))) {
      return reply.code(403).send({ error: "forbidden" });
    }
    // Spec 09-04-2026 (Load Costs Board 19 Columns) §3: "every one of the 19 is server-side
    // sortable, ascending and descending. A column the owner cannot sort is not delivered." Each key
    // below matches a frontend ParityColumn `key` 1:1 (LoadCostsBoardPage.tsx) so the page can pass
    // the clicked column key straight through as load_costs_sort with no translation table to drift.
    const parsed = companyQuerySchema.extend({
      load_costs_sort: z.enum([
        "load", "unit", "driver_name", "pu_date", "del_date", "status", "revenue",
        "late_fee", "lumper", "fuel", "repairs_maintenance", "other",
        "short_miles", "rate_loaded", "loaded_pay", "empty_miles", "rate_empty", "deadhead_pay", "gross", "margin",
      ]).default("load"),
      sort_direction: z.enum(["asc", "desc"]).default("desc"),
      /** LOAD-COSTS-COMPLETE item (3): voided (cancelled) loads hidden by default. */
      show_voided: z.coerce.boolean().default(false),
    }).safeParse(req.query ?? {});
    if (!parsed.success) return validationError(reply, parsed.error);

    return withCompanyScope(String(user.uuid), parsed.data.operating_company_id, async (client) => {
      // Sort by the raw numeric/timestamp CTE expression, never the ::text-cast SELECT-list alias --
      // a text cast would sort "1000" before "200" lexicographically. `status` mirrors the frontend's
      // own serviceStatus() branch order (LoadCostsBoardPage.tsx): In transit(0) < Delivered-no-
      // appt(1) < On Time(2) < Late(3), so ascending server sort visually matches ascending column
      // click same as every other column.
      const sortColumns = {
        load: "l.load_number",
        unit: "u.unit_number",
        driver_name: "mdata.resolve_driver_label_same_company(l.assigned_primary_driver_id,l.operating_company_id)",
        pu_date: "pickup.scheduled_arrival_at",
        del_date: "delivery.actual_arrival_at",
        status: "CASE WHEN delivery.actual_arrival_at IS NULL THEN 0 WHEN delivery.scheduled_arrival_at IS NULL THEN 1 WHEN delivery.actual_arrival_at <= delivery.scheduled_arrival_at THEN 2 ELSE 3 END",
        revenue: "l.rate_total_cents",
        late_fee: "COALESCE(cb.late_fee_cents,0)",
        lumper: "COALESCE(cb.lumper_cents,0)",
        fuel: "COALESCE(cb.fuel_cents,0)",
        repairs_maintenance: "COALESCE(rm.repairs_maintenance_cents,0)",
        other: "(COALESCE(ec.expense_cents,0)+COALESCE(bc.bill_cents,0)-COALESCE(rm.repairs_maintenance_cents,0)-COALESCE(cb.fuel_cents,0)-COALESCE(cb.lumper_cents,0)-COALESCE(cb.late_fee_cents,0))",
        short_miles: "dpd.short_miles",
        rate_loaded: "dpd.rate_loaded_cents",
        loaded_pay: "COALESCE(dpa.loaded_pay_cents,0)",
        empty_miles: "dpd.empty_miles",
        rate_empty: "dpd.rate_empty_cents",
        deadhead_pay: "CASE WHEN COALESCE(dpa.has_deadhead_miles,false) THEN COALESCE(dpa.deadhead_pay_cents,0) END",
        gross: "COALESCE(dp.driver_pay_cents,0)",
        margin: "(l.rate_total_cents-COALESCE(ec.expense_cents,0)-COALESCE(bc.bill_cents,0)-COALESCE(dp.driver_pay_cents,0))",
      } as const;
      const sortSql = `${sortColumns[parsed.data.load_costs_sort]} ${parsed.data.sort_direction.toUpperCase()} NULLS LAST, l.load_number ASC`;
      const result = await client.query(
        `WITH expense_costs AS (
           SELECT e.load_id,
                  COALESCE(SUM(e.total_amount_cents), 0)::bigint AS expense_cents,
                  COUNT(*)::int AS expense_count
             FROM accounting.expenses e
            WHERE e.operating_company_id = $1::uuid
              AND e.load_id IS NOT NULL
              AND e.status <> 'void'
            GROUP BY e.load_id
         ), bill_costs AS (
           SELECT bl.load_id,
                  COALESCE(SUM(ROUND(bl.amount * 100)), 0)::bigint AS bill_cents,
                  COUNT(DISTINCT b.id)::int AS bill_count,
                  COUNT(DISTINCT b.id) FILTER (WHERE b.status IN ('open','unpaid','partial','partially_paid'))::int AS unpaid_bill_count
             FROM accounting.bill_lines bl
             JOIN accounting.bills b
               ON b.id = bl.bill_id
              AND b.operating_company_id = $1::uuid
            WHERE bl.load_id IS NOT NULL
              AND b.status NOT IN ('void','voided')
              AND b.revoked_at IS NULL
              AND bl.voided_at IS NULL
            GROUP BY bl.load_id
         -- LOAD-COSTS-COMPLETE item (3): owner's exact board-column list breaks "Costs" into
         -- Late Fee / Lumper / Fuel / R&M Exp (already computed below, own WO-linkage mechanism) /
         -- Other. RECONCILED with Cursor-load-costs-board-columns (#20360, merged same day): both
         -- lanes built this bucketing independently -- Cursor's landed first and used the REAL
         -- canonical taxonomy (accounting.line_category_load_required: def/detention_paid/diesel/
         -- lumper/over_road_other/parking/roadside_repair/scale/toll, already populated directly on
         -- expense_lines.line_category / bill_lines.line_category), strictly better than this
         -- file's own first draft (a catalogs.accounts.account_name ILIKE match, the same fallback
         -- convention LoadDetailCostsTab.tsx's Fuel-advance feature uses when no canonical category
         -- exists -- it does here, so the fallback is dropped in favor of the real spine). Late Fee
         -- maps to detention_paid (Cursor's own mapping, kept for consistency -- no distinct
         -- "late fee" category exists in the spine). "Other" is the honest residual (all costs minus
         -- every named bucket including R&M's own separate WO-linkage mechanism below), not a
         -- second scan -- over_road_other/parking/scale/toll all fall into it naturally.
         -- EXCLUDES lines whose HEADER is WO-linked (e.linked_work_order_uuid /
         -- b.linked_work_order_uuid): those already count toward repairs_maintenance_cents below,
         -- via its own, separately-guarded mechanism. Without this exclusion a line could double-
         -- count into BOTH R&M and a category bucket (e.g. diesel bought for a roadside repair job)
         -- -- live-verified 0 such rows exist today, but the exclusion makes the ZERO structural,
         -- not incidental, so Late Fee+Lumper+Fuel+R&M+Other keeps footing to the same-load total
         -- even after a future WO-linked, categorized line is entered.
         ), category_costs AS (
           SELECT load_id,
                  COALESCE(SUM(amount_cents) FILTER (WHERE line_category = 'detention_paid'), 0)::bigint AS late_fee_cents,
                  COALESCE(SUM(amount_cents) FILTER (WHERE line_category = 'lumper'), 0)::bigint AS lumper_cents,
                  COALESCE(SUM(amount_cents) FILTER (WHERE line_category IN ('diesel','def')), 0)::bigint AS fuel_cents
             FROM (
               SELECT el.load_id, el.line_category, el.amount_cents
                 FROM accounting.expense_lines el
                 JOIN accounting.expenses e ON e.id = el.expense_id AND e.operating_company_id = $1::uuid
                WHERE el.load_id IS NOT NULL
                  AND e.status <> 'void'
                  AND e.linked_work_order_uuid IS NULL
               UNION ALL
               SELECT bl.load_id, bl.line_category, ROUND(bl.amount * 100)::bigint AS amount_cents
                 FROM accounting.bill_lines bl
                 JOIN accounting.bills b ON b.id = bl.bill_id AND b.operating_company_id = $1::uuid
                WHERE bl.load_id IS NOT NULL
                  AND b.status NOT IN ('void','voided')
                  AND b.revoked_at IS NULL
                  AND bl.voided_at IS NULL
                  AND b.linked_work_order_uuid IS NULL
             ) x
            GROUP BY load_id
         -- Driver-pay DETAIL (Short Miles / Rate Loaded / Loaded Pay / Empty Miles / Rate Empty /
         -- Deadhead Pay): one representative driver_bills row per load (the primary, non-team,
         -- most-recent bill) -- these are PER-BILL figures (a rate is never summed across bills),
         -- unlike driver_pay_cents below which correctly sums gross across every bill on the load.
         -- Short Miles = the LOADED miles the driver's bill is actually paid on = db.miles_basis,
         -- WHATEVER the basis type ('short' OR 'practical'): loaded_pay_cents = miles_basis *
         -- rate_per_mile_cents, so miles_basis IS the loaded-leg mileage the loaded rate applies to.
         -- Owner ruling 2026-09-05 (13508 pays 1319.7 practical miles @ 48c -> $633.46 loaded pay,
         -- yet the old CASE gated on type='short' left the column blank). It stays NULL only when the
         -- bill itself has no basis, never because the basis happens to be 'practical'.
         ), driver_pay_detail AS (
           SELECT DISTINCT ON (db.load_id)
                  db.load_id,
                  db.miles_basis AS short_miles,
                  db.rate_per_mile_cents AS rate_loaded_cents,
                  db.miles_deadhead AS empty_miles,
                  db.rate_empty_per_mile_cents AS rate_empty_cents
             FROM driver_finance.driver_bills db
            WHERE db.operating_company_id = $1::uuid
              AND db.load_id IS NOT NULL
              AND db.status <> 'void'
              AND db.team_driver_id IS NULL
            ORDER BY db.load_id, db.created_at DESC
         ), driver_pay_amounts AS (
           SELECT db.load_id,
                  COALESCE(SUM(db.loaded_pay_cents), 0)::bigint AS loaded_pay_cents,
                  COALESCE(SUM(db.deadhead_pay_cents), 0)::bigint AS deadhead_pay_cents,
                  BOOL_OR(db.miles_deadhead IS NOT NULL) AS has_deadhead_miles
             FROM driver_finance.driver_bills db
            WHERE db.operating_company_id = $1::uuid
              AND db.load_id IS NOT NULL
              AND db.status <> 'void'
            GROUP BY db.load_id
         ), repair_documents AS (
           SELECT e.load_id, e.total_amount_cents::bigint AS amount_cents
             FROM accounting.expenses e
             JOIN maintenance.work_orders wo
               ON wo.id = e.linked_work_order_uuid
              AND wo.operating_company_id = e.operating_company_id
              AND wo.load_id = e.load_id
              AND wo.load_id IS NOT NULL
              AND wo.status <> 'cancelled'
            WHERE e.operating_company_id = $1::uuid
              AND e.load_id IS NOT NULL
              AND e.status <> 'void'
           UNION ALL
           SELECT bl.load_id, ROUND(bl.amount * 100)::bigint AS amount_cents
             FROM accounting.bill_lines bl
             JOIN accounting.bills b
               ON b.id = bl.bill_id
              AND b.operating_company_id = $1::uuid
             JOIN maintenance.work_orders wo
               ON wo.id = b.linked_work_order_uuid
              AND wo.operating_company_id = b.operating_company_id
              AND wo.load_id = bl.load_id
              AND wo.load_id IS NOT NULL
              AND wo.status <> 'cancelled'
            WHERE bl.load_id IS NOT NULL
              AND b.status NOT IN ('void','voided')
              AND b.revoked_at IS NULL
              AND bl.voided_at IS NULL
         ), repair_costs AS (
           SELECT load_id, COALESCE(SUM(amount_cents), 0)::bigint AS repairs_maintenance_cents
             FROM repair_documents
            GROUP BY load_id
         ), driver_pay AS (
           SELECT db.load_id,
                  COALESCE(SUM(db.gross_amount_cents), 0)::bigint AS driver_pay_cents
             FROM driver_finance.driver_bills db
            WHERE db.operating_company_id = $1::uuid
              AND db.load_id IS NOT NULL
              AND db.status <> 'void'
            GROUP BY db.load_id
         )
         SELECT l.id::text AS load_id, l.load_number, l.status::text, COALESCE(c.customer_name, mdata.resolve_customer_label_same_company(l.customer_id,l.operating_company_id)) AS customer_name,
                mdata.resolve_driver_label_same_company(l.assigned_primary_driver_id,l.operating_company_id) AS driver_name,
                u.unit_number, tr.equipment_number AS trailer_number, pickup.city AS pickup_city, delivery.city AS delivery_city,
                pickup.scheduled_arrival_at::text AS pickup_date, delivery.scheduled_arrival_at::text AS scheduled_delivery_at,
                delivery.actual_arrival_at::text AS actual_delivery_at, l.created_at::text, l.rate_total_cents::text AS revenue_cents,
                COALESCE(ec.expense_cents, 0)::text AS expense_cents,
                COALESCE(bc.bill_cents, 0)::text AS bill_cents,
                COALESCE(rm.repairs_maintenance_cents, 0)::text AS repairs_maintenance_cents,
                COALESCE(dp.driver_pay_cents, 0)::text AS driver_pay_cents,
                COALESCE(ec.expense_count, 0)::int AS expense_count,
                COALESCE(bc.bill_count, 0)::int AS bill_count,
                COALESCE(bc.unpaid_bill_count, 0)::int AS unpaid_bill_count,
                COALESCE(cb.fuel_cents, 0)::text AS fuel_cents,
                COALESCE(cb.lumper_cents, 0)::text AS lumper_cents,
                COALESCE(cb.late_fee_cents, 0)::text AS late_fee_cents,
                -- Spec 09-04-2026 §2.4: "Other is the honest remainder and must foot ... If it does
                -- not foot, the board is lying." A zero-floor clamp here would silently mask a
                -- footing failure (a would-be-negative residual, which can ONLY happen from a bug in
                -- the bucket CTEs above) by hiding it behind a false 0 -- removed on purpose. Verified
                -- guard: verify-load-costs-cost-split-foots asserts Late Fee+Lumper+Fuel+R&M+Other ==
                -- the non-void expense+bill total on live USMCA data every push.
                (COALESCE(ec.expense_cents,0) + COALESCE(bc.bill_cents,0) - COALESCE(rm.repairs_maintenance_cents,0) - COALESCE(cb.fuel_cents,0) - COALESCE(cb.lumper_cents,0) - COALESCE(cb.late_fee_cents,0))::text AS other_cost_cents,
                dpd.short_miles::text AS short_miles,
                dpd.rate_loaded_cents::text AS rate_loaded_cents,
                dpd.empty_miles::text AS empty_miles,
                dpd.rate_empty_cents::text AS rate_empty_cents,
                COALESCE(dpa.loaded_pay_cents, 0)::text AS loaded_pay_cents,
                CASE WHEN COALESCE(dpa.has_deadhead_miles, false) THEN COALESCE(dpa.deadhead_pay_cents, 0)::text ELSE NULL END AS deadhead_pay_cents
           FROM views.dispatch_load_with_driver_status l
           LEFT JOIN expense_costs ec ON ec.load_id=l.id LEFT JOIN bill_costs bc ON bc.load_id=l.id LEFT JOIN repair_costs rm ON rm.load_id=l.id LEFT JOIN driver_pay dp ON dp.load_id=l.id
           LEFT JOIN category_costs cb ON cb.load_id=l.id LEFT JOIN driver_pay_detail dpd ON dpd.load_id=l.id LEFT JOIN driver_pay_amounts dpa ON dpa.load_id=l.id
           LEFT JOIN mdata.customers c ON c.id=l.customer_id AND c.operating_company_id=l.operating_company_id
           -- W-FIX-3b (loads.routes.ts, same rule): mdata.units has owner_company_id /
           -- currently_leased_to_company_id, never operating_company_id. mdata.loads has NO
           -- trailer_id column at all -- the only real trailer<->load link is
           -- dispatch.load_assignment_history.new_trailer_id (mdata.equipment). Both were wrong
           -- here (confirmed live: HTTP 500 on this exact endpoint); fixed to the same pattern
           -- already used by GET /api/v1/dispatch/loads (loads.routes.ts).
           LEFT JOIN mdata.units u ON u.id=l.assigned_unit_id AND COALESCE(u.currently_leased_to_company_id, u.owner_company_id)=l.operating_company_id
           LEFT JOIN LATERAL (
             SELECT eq.equipment_number
               FROM dispatch.load_assignment_history lah
               JOIN mdata.equipment eq ON eq.id = lah.new_trailer_id
                                      AND (eq.owner_company_id = l.operating_company_id OR eq.currently_leased_to_company_id = l.operating_company_id)
              WHERE lah.load_id = l.id AND lah.new_trailer_id IS NOT NULL
              ORDER BY lah.assigned_at DESC
              LIMIT 1
           ) tr ON true
           LEFT JOIN LATERAL (SELECT city,scheduled_arrival_at FROM mdata.load_stops WHERE load_id=l.id AND stop_type='pickup' AND soft_deleted_at IS NULL ORDER BY sequence_number ASC LIMIT 1) pickup ON true
           LEFT JOIN LATERAL (SELECT city,scheduled_arrival_at,actual_arrival_at FROM mdata.load_stops WHERE load_id=l.id AND stop_type='delivery' AND soft_deleted_at IS NULL ORDER BY sequence_number DESC LIMIT 1) delivery ON true
          WHERE l.operating_company_id=$1::uuid AND l.soft_deleted_at IS NULL
            -- LOAD-COSTS-COMPLETE item (3): drafts never appear on this board (owner order
            -- 2026-09-04) -- a draft is not a real, money-bearing load yet. Voided (cancelled)
            -- loads are hidden by default, toggle-able via show_voided.
            AND l.status <> 'draft'
            ${parsed.data.show_voided ? "" : "AND l.status <> 'cancelled'"}
          ORDER BY ${sortSql}`,
        [parsed.data.operating_company_id]
      );
      const unmatchedBank = await countUncategorizedTransactions(client, parsed.data.operating_company_id);
      return { rows: result.rows, unmatched_bank_count: unmatchedBank, linkage: LOAD_COSTS_HUB_LINKAGE };
    });
  });

  // LCB-REG (owner 2026-09-05, "the Documents tab is a note"). Real register of every document
  // linked to a load on this board, from BOTH document mechanisms this repo has (hub item 11
  // above, extended): docs.files (the newer generic uploader -- linked to a load either directly
  // via dispatch_load_id, the driver/shipper-portal path, OR polymorphically via docs.file_links
  // entity_type='load', the UploadZone path -- confirmed live, 2026-09-05: 0 overlap between the
  // two, safe to UNION) and documents.attachments (the older receipt mechanism, entity_type
  // expense/bill, joined back to its load). Read-only, company-scoped, capped like every other
  // register on this page.
  app.get(
    "/api/v1/accounting/load-costs-board/documents",
    { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const user = currentAuthUser(req, reply);
      if (!user) return;
      if (!["Owner", "Administrator", "Accountant", "Dispatcher", "SuperAdmin"].includes(String(user.role ?? ""))) {
        return reply.code(403).send({ error: "forbidden" });
      }
      const parsed = companyQuerySchema.safeParse(req.query ?? {});
      if (!parsed.success) return validationError(reply, parsed.error);

      return withCompanyScope(String(user.uuid), parsed.data.operating_company_id, async (client) => {
        const result = await client.query(
          `
            SELECT * FROM (
              SELECT f.id::text, f.created_at AS date, f.dispatch_load_id::text AS load_id,
                     COALESCE(fc.label, 'Document') AS type, f.original_filename AS filename,
                     f.size_bytes::text, 'docs.files' AS source, NULL::text AS entity_type, NULL::text AS entity_id
                FROM docs.files f
                LEFT JOIN catalogs.file_categories fc ON fc.id = f.category_id
               WHERE f.operating_company_id = $1::uuid AND f.deleted_at IS NULL
                 AND f.upload_completed_at IS NOT NULL AND f.dispatch_load_id IS NOT NULL
              UNION ALL
              SELECT f.id::text, f.created_at AS date, fl.entity_id::text AS load_id,
                     COALESCE(fc.label, 'Document') AS type, f.original_filename AS filename,
                     f.size_bytes::text, 'docs.files' AS source, NULL::text AS entity_type, NULL::text AS entity_id
                FROM docs.files f
                JOIN docs.file_links fl ON fl.file_id = f.id AND fl.deleted_at IS NULL AND fl.entity_type = 'load'
                LEFT JOIN catalogs.file_categories fc ON fc.id = f.category_id
               WHERE f.operating_company_id = $1::uuid AND f.deleted_at IS NULL AND f.upload_completed_at IS NOT NULL
              UNION ALL
              SELECT a.id::text, a.uploaded_at AS date, e.load_id::text AS load_id,
                     COALESCE(a.category, 'Receipt') AS type, a.filename,
                     a.size_bytes::text, 'documents.attachments' AS source, a.entity_type, a.entity_id::text AS entity_id
                FROM documents.attachments a
                JOIN accounting.expenses e ON e.id = a.entity_id AND e.operating_company_id = $1::uuid
               WHERE a.operating_company_id = $1::uuid AND a.is_deleted = false
                 AND a.entity_type = 'expense' AND e.load_id IS NOT NULL
              UNION ALL
              SELECT a.id::text, a.uploaded_at AS date, bl_load.load_id::text AS load_id,
                     COALESCE(a.category, 'Receipt') AS type, a.filename,
                     a.size_bytes::text, 'documents.attachments' AS source, a.entity_type, a.entity_id::text AS entity_id
                FROM documents.attachments a
                JOIN LATERAL (
                  SELECT bl.load_id FROM accounting.bill_lines bl
                   WHERE bl.bill_id = a.entity_id AND bl.load_id IS NOT NULL
                   ORDER BY bl.created_at ASC LIMIT 1
                ) bl_load ON true
               WHERE a.operating_company_id = $1::uuid AND a.is_deleted = false AND a.entity_type = 'bill'
            ) docs
            WHERE docs.load_id IS NOT NULL
            ORDER BY docs.date DESC
            LIMIT 500
          `,
          [parsed.data.operating_company_id]
        );
        return { rows: result.rows };
      });
    }
  );
}

export default fp(async (app) => {
  await registerLoadCostsBoardRoutes(app);
}, { name: "accounting.registerLoadCostsBoardRoutes" });
