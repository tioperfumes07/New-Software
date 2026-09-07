type Queryable = {
  query: <R = Record<string, unknown>>(sql: string, values?: unknown[]) => Promise<{ rows: R[]; rowCount?: number }>;
};

export type FactorRow = {
  id: string;
  tenant_id: string;
  name: string;
  advance_rate: number;
  fee_rate: number;
  reserve_rate: number;
  recourse_days: number;
  active: boolean;
  fee_schedule: unknown[] | null;
  reserve_schedule: unknown[] | null;
  fee_application_mode: string;
  remittance_details: unknown | null;
  noa_stamp_text: string | null;
  noa_remit_to_name: string | null;
  noa_remit_to_addr: string | null;
  noa_remit_to_wire_ref: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  // LIABILITY column-wave: only listFactors() computes this (via a LEFT JOIN on
  // factoring.v_factor_reserve_balance) — other mapFactorRow call sites (get/create/update a single
  // factor) never queried it, so it's optional/null there rather than fabricated as 0.
  reserve_balance_cents?: number | null;
};

export type LetterOfReleaseRow = {
  id: string;
  tenant_id: string;
  factor_id: string;
  issued_date: string;
  effective_release_date: string;
  released_by_user_id: string | null;
  notes: string | null;
  created_at: string;
};

export class FactorLorError extends Error {
  constructor(readonly code: "active_assignments_exist" | "lor_not_found", readonly statusCode: number) {
    super(code);
  }
}

export type CustomerFactorAssignmentRow = {
  id: string;
  tenant_id: string;
  customer_id: string;
  factor_id: string;
  factor_name: string;
  effective_from: string;
  effective_to: string | null;
  created_at: string;
};

export type BatchFactorHistoryRow = {
  id: string;
  batch_number: string;
  status: string;
  submitted_at: string | null;
  funded_at: string | null;
  total_face_cents: number;
  expected_advance_cents: number;
  expected_fee_cents: number;
};

export class FactorServiceError extends Error {
  constructor(readonly code: "factor_not_found" | "factor_name_conflict", readonly statusCode: number) {
    super(code);
  }
}

function mapLorRow(row: Record<string, unknown>): LetterOfReleaseRow {
  return {
    id: String(row.id),
    tenant_id: String(row.tenant_id),
    factor_id: String(row.factor_id),
    issued_date: String(row.issued_date),
    effective_release_date: String(row.effective_release_date),
    released_by_user_id: row.released_by_user_id != null ? String(row.released_by_user_id) : null,
    notes: row.notes != null ? String(row.notes) : null,
    created_at: String(row.created_at),
  };
}

function toNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value);
  return Number(value ?? 0);
}

function mapFactorRow(row: Record<string, unknown>): FactorRow {
  return {
    id: String(row.id),
    tenant_id: String(row.tenant_id),
    name: String(row.name),
    advance_rate: toNumber(row.advance_rate),
    fee_rate: toNumber(row.fee_rate),
    reserve_rate: toNumber(row.reserve_rate),
    recourse_days: toNumber(row.recourse_days),
    active: Boolean(row.active),
    fee_schedule: Array.isArray(row.fee_schedule) ? row.fee_schedule : null,
    reserve_schedule: Array.isArray(row.reserve_schedule) ? row.reserve_schedule : null,
    fee_application_mode: String(row.fee_application_mode ?? "replace"),
    remittance_details: row.remittance_details ?? null,
    noa_stamp_text: row.noa_stamp_text != null ? String(row.noa_stamp_text) : null,
    noa_remit_to_name: row.noa_remit_to_name != null ? String(row.noa_remit_to_name) : null,
    noa_remit_to_addr: row.noa_remit_to_addr != null ? String(row.noa_remit_to_addr) : null,
    noa_remit_to_wire_ref: row.noa_remit_to_wire_ref != null ? String(row.noa_remit_to_wire_ref) : null,
    notes: row.notes != null ? String(row.notes) : null,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
    reserve_balance_cents: row.reserve_balance_cents != null ? toNumber(row.reserve_balance_cents) : null,
  };
}

function mapAssignmentRow(row: Record<string, unknown>): CustomerFactorAssignmentRow {
  return {
    id: String(row.id),
    tenant_id: String(row.tenant_id),
    customer_id: String(row.customer_id),
    factor_id: String(row.factor_id),
    factor_name: String(row.factor_name),
    effective_from: String(row.effective_from),
    effective_to: row.effective_to ? String(row.effective_to) : null,
    created_at: String(row.created_at),
  };
}

function mapBatchHistoryRow(row: Record<string, unknown>): BatchFactorHistoryRow {
  return {
    id: String(row.id),
    batch_number: String(row.batch_number),
    status: String(row.status),
    submitted_at: row.submitted_at ? String(row.submitted_at) : null,
    funded_at: row.funded_at ? String(row.funded_at) : null,
    total_face_cents: toNumber(row.total_face_cents),
    expected_advance_cents: toNumber(row.expected_advance_cents),
    expected_fee_cents: toNumber(row.expected_fee_cents),
  };
}

export async function listFactors(
  tenantId: string,
  opts: { activeOnly?: boolean },
  deps: { client: Queryable }
): Promise<FactorRow[]> {
  const values: unknown[] = [tenantId];
  const filters = ["f.tenant_id = $1::uuid"];
  if (opts.activeOnly) filters.push("f.active = true");

  const res = await deps.client.query<Record<string, unknown>>(
    `
      SELECT
        f.id::text,
        f.tenant_id::text,
        f.name,
        f.advance_rate::numeric,
        f.fee_rate::numeric,
        f.reserve_rate::numeric,
        f.recourse_days,
        f.active,
        f.fee_schedule,
        f.reserve_schedule,
        f.fee_application_mode,
        f.remittance_details,
        f.noa_stamp_text,
        f.noa_remit_to_name,
        f.noa_remit_to_addr,
        f.noa_remit_to_wire_ref,
        f.notes,
        f.created_at::text,
        f.updated_at::text,
        -- LIABILITY column-wave: factors.admin previously showed only contract-term percentages,
        -- never the outstanding dollar reserve/liability balance Faro currently holds per factor
        -- — reused the same real, live, correctly-cents-suffixed view reserves.dashboard already
        -- uses (factoring.v_factor_reserve_balance), not the broken to_jsonb(fa) view family
        -- FACT-PHANTOM-01 diagnosed and is queued (HOLD-FOR-JORGE) to fix separately.
        COALESCE(rb.balance_cents, 0)::bigint AS reserve_balance_cents
      FROM factoring.factor f
      LEFT JOIN factoring.v_factor_reserve_balance rb
        ON rb.factor_id = f.id
       AND rb.tenant_id = f.tenant_id
      WHERE ${filters.join(" AND ")}
      ORDER BY f.active DESC, f.name ASC
    `,
    values
  );

  return res.rows.map(mapFactorRow);
}

export async function getFactorForCustomer(
  tenantId: string,
  customerId: string,
  asOfDate: string,
  deps: { client: Queryable }
): Promise<(FactorRow & { assignment_id: string; effective_from: string; effective_to: string | null }) | null> {
  const res = await deps.client.query<Record<string, unknown>>(
    `
      SELECT
        f.id::text,
        f.tenant_id::text,
        f.name,
        f.advance_rate::numeric,
        f.fee_rate::numeric,
        f.reserve_rate::numeric,
        f.recourse_days,
        f.active,
        f.fee_schedule,
        f.reserve_schedule,
        f.fee_application_mode,
        f.remittance_details,
        f.noa_stamp_text,
        f.noa_remit_to_name,
        f.noa_remit_to_addr,
        f.noa_remit_to_wire_ref,
        f.notes,
        f.created_at::text,
        f.updated_at::text,
        a.id::text AS assignment_id,
        a.effective_from::text,
        a.effective_to::text
      FROM factoring.customer_factor_assignment a
      JOIN factoring.factor f ON f.id = a.factor_id
      WHERE a.tenant_id = $1::uuid
        AND a.customer_id = $2::uuid
        AND a.effective_from <= $3::date
        AND (a.effective_to IS NULL OR a.effective_to > $3::date)
        -- FACT-RESOLVER-03 — a voided assignment or a deactivated/inactive factor still resolved
        -- and still priced money: this WHERE clause checked tenant/customer/dates only, never the
        -- assignment's own voided_at, the factor's own voided_at, or the factor's active flag.
        AND a.voided_at IS NULL
        AND f.voided_at IS NULL
        AND f.active IS TRUE
      ORDER BY a.effective_from DESC, a.created_at DESC
      LIMIT 1
    `,
    [tenantId, customerId, asOfDate]
  );

  const row = res.rows[0];
  if (!row) return null;
  const factor = mapFactorRow(row);
  return {
    ...factor,
    assignment_id: String(row.assignment_id),
    effective_from: String(row.effective_from),
    effective_to: row.effective_to ? String(row.effective_to) : null,
  };
}

export async function createFactor(
  tenantId: string,
  input: {
    name: string;
    advance_rate: number;
    fee_rate: number;
    reserve_rate: number;
    recourse_days: number;
    active?: boolean;
    fee_schedule?: unknown[] | null;
    reserve_schedule?: unknown[] | null;
    fee_application_mode?: string;
    remittance_details?: unknown | null;
    noa_stamp_text?: string | null;
    noa_remit_to_name?: string | null;
    noa_remit_to_addr?: string | null;
    noa_remit_to_wire_ref?: string | null;
    notes?: string | null;
  },
  deps: { client: Queryable }
): Promise<FactorRow> {
  try {
    const insert = await deps.client.query<Record<string, unknown>>(
      `
        INSERT INTO factoring.factor (
          tenant_id,
          name,
          advance_rate,
          fee_rate,
          reserve_rate,
          recourse_days,
          active,
          fee_schedule,
          reserve_schedule,
          fee_application_mode,
          remittance_details,
          noa_stamp_text,
          noa_remit_to_name,
          noa_remit_to_addr,
          noa_remit_to_wire_ref,
          notes,
          created_at,
          updated_at
        )
        VALUES (
          $1::uuid,
          $2,
          $3::numeric,
          $4::numeric,
          $5::numeric,
          $6::int,
          COALESCE($7::boolean, true),
          $8::jsonb,
          $9::jsonb,
          COALESCE($10, 'replace'),
          $11::jsonb,
          $12,
          $13,
          $14,
          $15,
          $16,
          now(),
          now()
        )
        RETURNING
          id::text,
          tenant_id::text,
          name,
          advance_rate::numeric,
          fee_rate::numeric,
          reserve_rate::numeric,
          recourse_days,
          active,
          fee_schedule,
          reserve_schedule,
          fee_application_mode,
          remittance_details,
          noa_stamp_text,
          noa_remit_to_name,
          noa_remit_to_addr,
          noa_remit_to_wire_ref,
          notes,
          created_at::text,
          updated_at::text
      `,
      [
        tenantId,
        input.name.trim(),
        input.advance_rate,
        input.fee_rate,
        input.reserve_rate,
        input.recourse_days,
        input.active,
        input.fee_schedule != null ? JSON.stringify(input.fee_schedule) : null,
        input.reserve_schedule != null ? JSON.stringify(input.reserve_schedule) : null,
        input.fee_application_mode ?? null,
        input.remittance_details != null ? JSON.stringify(input.remittance_details) : null,
        input.noa_stamp_text ?? null,
        input.noa_remit_to_name ?? null,
        input.noa_remit_to_addr ?? null,
        input.noa_remit_to_wire_ref ?? null,
        input.notes ?? null,
      ]
    );
    return mapFactorRow(insert.rows[0] ?? {});
  } catch (error) {
    if (String((error as { code?: string }).code) === "23505") {
      throw new FactorServiceError("factor_name_conflict", 409);
    }
    throw error;
  }
}

export async function updateFactor(
  tenantId: string,
  factorId: string,
  patch: Partial<{
    name: string;
    advance_rate: number;
    fee_rate: number;
    reserve_rate: number;
    recourse_days: number;
    active: boolean;
    fee_schedule: unknown[] | null;
    reserve_schedule: unknown[] | null;
    fee_application_mode: string;
    remittance_details: unknown | null;
    noa_stamp_text: string | null;
    noa_remit_to_name: string | null;
    noa_remit_to_addr: string | null;
    noa_remit_to_wire_ref: string | null;
    notes: string | null;
  }>,
  deps: { client: Queryable }
): Promise<FactorRow> {
  const updates: string[] = [];
  const values: unknown[] = [tenantId, factorId];

  if (patch.name !== undefined) {
    values.push(patch.name.trim());
    updates.push(`name = $${values.length}`);
  }
  if (patch.advance_rate !== undefined) {
    values.push(patch.advance_rate);
    updates.push(`advance_rate = $${values.length}::numeric`);
  }
  if (patch.fee_rate !== undefined) {
    values.push(patch.fee_rate);
    updates.push(`fee_rate = $${values.length}::numeric`);
  }
  if (patch.reserve_rate !== undefined) {
    values.push(patch.reserve_rate);
    updates.push(`reserve_rate = $${values.length}::numeric`);
  }
  if (patch.recourse_days !== undefined) {
    values.push(patch.recourse_days);
    updates.push(`recourse_days = $${values.length}::int`);
  }
  if (patch.active !== undefined) {
    values.push(patch.active);
    updates.push(`active = $${values.length}::boolean`);
  }
  if (Object.prototype.hasOwnProperty.call(patch, "fee_schedule")) {
    values.push(patch.fee_schedule != null ? JSON.stringify(patch.fee_schedule) : null);
    updates.push(`fee_schedule = $${values.length}::jsonb`);
  }
  if (Object.prototype.hasOwnProperty.call(patch, "reserve_schedule")) {
    values.push(patch.reserve_schedule != null ? JSON.stringify(patch.reserve_schedule) : null);
    updates.push(`reserve_schedule = $${values.length}::jsonb`);
  }
  if (patch.fee_application_mode !== undefined) {
    values.push(patch.fee_application_mode);
    updates.push(`fee_application_mode = $${values.length}`);
  }
  if (Object.prototype.hasOwnProperty.call(patch, "remittance_details")) {
    values.push(patch.remittance_details != null ? JSON.stringify(patch.remittance_details) : null);
    updates.push(`remittance_details = $${values.length}::jsonb`);
  }
  if (Object.prototype.hasOwnProperty.call(patch, "notes")) {
    values.push(patch.notes ?? null);
    updates.push(`notes = $${values.length}`);
  }
  if (Object.prototype.hasOwnProperty.call(patch, "noa_stamp_text")) {
    values.push(patch.noa_stamp_text ?? null);
    updates.push(`noa_stamp_text = $${values.length}`);
  }
  if (Object.prototype.hasOwnProperty.call(patch, "noa_remit_to_name")) {
    values.push(patch.noa_remit_to_name ?? null);
    updates.push(`noa_remit_to_name = $${values.length}`);
  }
  if (Object.prototype.hasOwnProperty.call(patch, "noa_remit_to_addr")) {
    values.push(patch.noa_remit_to_addr ?? null);
    updates.push(`noa_remit_to_addr = $${values.length}`);
  }
  if (Object.prototype.hasOwnProperty.call(patch, "noa_remit_to_wire_ref")) {
    values.push(patch.noa_remit_to_wire_ref ?? null);
    updates.push(`noa_remit_to_wire_ref = $${values.length}`);
  }

  if (updates.length === 0) {
    const current = await deps.client.query<Record<string, unknown>>(
      `
        SELECT
          id::text,
          tenant_id::text,
          name,
          advance_rate::numeric,
          fee_rate::numeric,
          reserve_rate::numeric,
          recourse_days,
          active,
          fee_schedule,
          reserve_schedule,
          fee_application_mode,
          remittance_details,
          noa_stamp_text,
          noa_remit_to_name,
          noa_remit_to_addr,
          noa_remit_to_wire_ref,
          notes,
          created_at::text,
          updated_at::text
        FROM factoring.factor
        WHERE tenant_id = $1::uuid
          AND id = $2::uuid
        LIMIT 1
      `,
      [tenantId, factorId]
    );
    if (!current.rows[0]) throw new FactorServiceError("factor_not_found", 404);
    return mapFactorRow(current.rows[0]);
  }

  updates.push("updated_at = now()");

  try {
    const res = await deps.client.query<Record<string, unknown>>(
      `
        UPDATE factoring.factor
        SET ${updates.join(", ")}
        WHERE tenant_id = $1::uuid
          AND id = $2::uuid
        RETURNING
          id::text,
          tenant_id::text,
          name,
          advance_rate::numeric,
          fee_rate::numeric,
          reserve_rate::numeric,
          recourse_days,
          active,
          fee_schedule,
          reserve_schedule,
          fee_application_mode,
          remittance_details,
          noa_stamp_text,
          noa_remit_to_name,
          noa_remit_to_addr,
          noa_remit_to_wire_ref,
          notes,
          created_at::text,
          updated_at::text
      `,
      values
    );

    if (!res.rows[0]) throw new FactorServiceError("factor_not_found", 404);
    return mapFactorRow(res.rows[0]);
  } catch (error) {
    if (String((error as { code?: string }).code) === "23505") {
      throw new FactorServiceError("factor_name_conflict", 409);
    }
    throw error;
  }
}

export async function deactivateFactor(tenantId: string, factorId: string, deps: { client: Queryable }): Promise<FactorRow> {
  // LOR required when active customer assignments still open (UCC 9-406 compliance)
  const assignmentCheck = await deps.client.query<{ cnt: string }>(
    `
      SELECT COUNT(*)::text AS cnt
      FROM factoring.customer_factor_assignment
      WHERE tenant_id = $1::uuid
        AND factor_id = $2::uuid
        AND effective_to IS NULL
    `,
    [tenantId, factorId]
  );
  const openAssignments = Number(assignmentCheck.rows[0]?.cnt ?? 0);
  if (openAssignments > 0) {
    // Check that at least one LOR exists for this factor
    const lorCheck = await deps.client.query<{ cnt: string }>(
      `
        SELECT COUNT(*)::text AS cnt
        FROM factoring.letter_of_release
        WHERE tenant_id = $1::uuid
          AND factor_id = $2::uuid
      `,
      [tenantId, factorId]
    );
    const lorCount = Number(lorCheck.rows[0]?.cnt ?? 0);
    if (lorCount === 0) {
      throw new FactorLorError("active_assignments_exist", 409);
    }
  }

  const res = await deps.client.query<Record<string, unknown>>(
    `
      UPDATE factoring.factor
      SET active = false,
          updated_at = now()
      WHERE tenant_id = $1::uuid
        AND id = $2::uuid
      RETURNING
        id::text,
        tenant_id::text,
        name,
        advance_rate::numeric,
        fee_rate::numeric,
        reserve_rate::numeric,
        recourse_days,
        active,
        fee_schedule,
        reserve_schedule,
        fee_application_mode,
        remittance_details,
        noa_stamp_text,
        noa_remit_to_name,
        noa_remit_to_addr,
        noa_remit_to_wire_ref,
        notes,
        created_at::text,
        updated_at::text
    `,
    [tenantId, factorId]
  );

  if (!res.rows[0]) throw new FactorServiceError("factor_not_found", 404);
  return mapFactorRow(res.rows[0]);
}

export async function createLetterOfRelease(
  tenantId: string,
  input: {
    factor_id: string;
    issued_date: string;
    effective_release_date: string;
    released_by_user_id?: string | null;
    notes?: string | null;
  },
  deps: { client: Queryable }
): Promise<LetterOfReleaseRow> {
  const res = await deps.client.query<Record<string, unknown>>(
    `
      INSERT INTO factoring.letter_of_release (
        tenant_id,
        factor_id,
        issued_date,
        effective_release_date,
        released_by_user_id,
        notes,
        created_at
      )
      VALUES (
        $1::uuid,
        $2::uuid,
        $3::date,
        $4::date,
        $5::uuid,
        $6,
        now()
      )
      RETURNING
        id::text,
        tenant_id::text,
        factor_id::text,
        issued_date::text,
        effective_release_date::text,
        released_by_user_id::text,
        notes,
        created_at::text
    `,
    [
      tenantId,
      input.factor_id,
      input.issued_date,
      input.effective_release_date,
      input.released_by_user_id ?? null,
      input.notes ?? null,
    ]
  );
  return mapLorRow(res.rows[0] ?? {});
}

export async function listLetterOfReleases(
  tenantId: string,
  factorId: string,
  deps: { client: Queryable }
): Promise<LetterOfReleaseRow[]> {
  const res = await deps.client.query<Record<string, unknown>>(
    `
      SELECT
        id::text,
        tenant_id::text,
        factor_id::text,
        issued_date::text,
        effective_release_date::text,
        released_by_user_id::text,
        notes,
        created_at::text
      FROM factoring.letter_of_release
      WHERE tenant_id = $1::uuid
        AND factor_id = $2::uuid
      ORDER BY created_at DESC
    `,
    [tenantId, factorId]
  );
  return res.rows.map(mapLorRow);
}

export async function assignCustomerToFactor(
  tenantId: string,
  customerId: string,
  factorId: string,
  effectiveFrom: string,
  deps: { client: Queryable }
): Promise<CustomerFactorAssignmentRow> {
  const factorRes = await deps.client.query<Record<string, unknown>>(
    `
      SELECT id::text
      FROM factoring.factor
      WHERE tenant_id = $1::uuid
        AND id = $2::uuid
      LIMIT 1
    `,
    [tenantId, factorId]
  );
  if (!factorRes.rows[0]) throw new FactorServiceError("factor_not_found", 404);

  await deps.client.query(
    `
      UPDATE factoring.customer_factor_assignment
      SET effective_to = ($3::date - INTERVAL '1 day')::date
      WHERE tenant_id = $1::uuid
        AND customer_id = $2::uuid
        AND effective_to IS NULL
        AND effective_from < $3::date
    `,
    [tenantId, customerId, effectiveFrom]
  );

  const inserted = await deps.client.query<Record<string, unknown>>(
    `
      INSERT INTO factoring.customer_factor_assignment (
        tenant_id,
        customer_id,
        factor_id,
        effective_from,
        effective_to,
        created_at,
        -- FACT-ASSIGN-05 correction (2026-08-30) -- operating_company_id is nullable and this
        -- INSERT never set it, so every row this function ever wrote left it NULL. The table's
        -- own factoring_customer_factor_assignment_opco_scope RLS policy gates on this exact
        -- column (the same hazard class documented at batch.service.ts LV-TXN-016); a second,
        -- newer tenant_id-keyed policy happened to also cover writes so this never surfaced as a
        -- write failure, but every row was left unscoped by its own intended column. tenant_id IS
        -- the operating_company_id for this table (tenant_id references org.companies(id)) --
        -- same value, not a new lookup.
        operating_company_id
      )
      VALUES (
        $1::uuid,
        $2::uuid,
        $3::uuid,
        $4::date,
        NULL,
        now(),
        $1::uuid
      )
      RETURNING
        id::text,
        tenant_id::text,
        customer_id::text,
        factor_id::text,
        effective_from::text,
        effective_to::text,
        created_at::text
    `,
    [tenantId, customerId, factorId, effectiveFrom]
  );

  // FACT-MIRROR-SYNC (owner 2026-09-06) — the effective-dated factoring.customer_factor_assignment
  // above is the SYSTEM OF RECORD, but mdata.customers.factoring_company_vendor_id is the denormalized
  // mirror the "submit to Faro" queue (submission-queue.service.ts) and every AP/rollup consumer reads.
  // This function historically wrote the assignment and NEVER the mirror, so 1,220 of 1,221 assigned
  // USMCA customers carried a NULL mirror and their invoices never entered the submit queue (measured:
  // 28 sent, Faro-assigned invoices stranded with no advance). Resolve the factor's AP vendor from the
  // effective canonical agreement (factor_profile_id = this assignment's factor_id) and write it here so
  // the mirror can never drift from the assignment again. If no effective agreement resolves a vendor we
  // leave the mirror untouched rather than invent one — a customer with no funding agreement is correctly
  // absent from the submit queue.
  await deps.client.query(
    `
      UPDATE mdata.customers c
      SET factoring_company_vendor_id = cfa.factor_vendor_id,
          updated_at = now()
      FROM factoring.canonical_factor_agreements cfa
      WHERE c.id = $2::uuid
        AND c.operating_company_id = $1::uuid
        AND cfa.tenant_id = $1::uuid
        AND cfa.factor_profile_id = $3::uuid
        AND cfa.factor_vendor_id IS NOT NULL
        AND cfa.voided_at IS NULL
        AND cfa.effective_from <= $4::date
        AND (cfa.effective_to IS NULL OR cfa.effective_to > $4::date)
        AND c.factoring_company_vendor_id IS DISTINCT FROM cfa.factor_vendor_id
    `,
    [tenantId, customerId, factorId, effectiveFrom]
  );

  const assignment = inserted.rows[0] ?? {};
  const factor = await deps.client.query<Record<string, unknown>>(
    `
      SELECT name
      FROM factoring.factor
      WHERE tenant_id = $1::uuid
        AND id = $2::uuid
      LIMIT 1
    `,
    [tenantId, factorId]
  );

  return {
    ...mapAssignmentRow({
      ...assignment,
      factor_name: factor.rows[0]?.name ?? "Unknown factor",
    }),
  };
}

export async function listFactorAssignmentsForCustomer(
  tenantId: string,
  customerId: string,
  deps: { client: Queryable }
): Promise<CustomerFactorAssignmentRow[]> {
  const res = await deps.client.query<Record<string, unknown>>(
    `
      SELECT
        a.id::text,
        a.tenant_id::text,
        a.customer_id::text,
        a.factor_id::text,
        f.name AS factor_name,
        a.effective_from::text,
        a.effective_to::text,
        a.created_at::text
      FROM factoring.customer_factor_assignment a
      JOIN factoring.factor f ON f.id = a.factor_id
      WHERE a.tenant_id = $1::uuid
        AND a.customer_id = $2::uuid
      ORDER BY a.effective_from DESC, a.created_at DESC
    `,
    [tenantId, customerId]
  );

  return res.rows.map(mapAssignmentRow);
}

export async function listFactorBatchHistoryForCustomer(
  tenantId: string,
  customerId: string,
  deps: { client: Queryable }
): Promise<BatchFactorHistoryRow[]> {
  const res = await deps.client.query<Record<string, unknown>>(
    `
      SELECT DISTINCT
        b.id::text,
        b.batch_number,
        b.status,
        b.submitted_at::text,
        b.funded_at::text,
        b.total_face_cents::bigint,
        b.expected_advance_cents::bigint,
        b.expected_fee_cents::bigint,
        -- FACT-F5986 — SQLSTATE 42P10 ("for SELECT DISTINCT, ORDER BY expressions must appear in
        -- select list"): b.submitted_at and b.funded_at were both individually selected, but
        -- Postgres does not treat COALESCE(a, b) as "appearing in select list" just because a and b
        -- do — the ORDER BY expression itself must be projected. Projecting the same COALESCE as its
        -- own column (rather than re-deriving it in JS after the fact) keeps the sort key identical
        -- to what the query intends and lets DISTINCT + ORDER BY agree; it cannot change which rows
        -- are distinct since it is a pure function of two columns already in the SELECT list.
        COALESCE(b.submitted_at, b.funded_at) AS sort_key
      FROM factoring.batch b
      JOIN accounting.invoices i ON i.id = ANY(b.invoice_ids)
      WHERE b.tenant_id = $1::uuid
        AND i.operating_company_id = $1::uuid
        AND i.customer_id = $2::uuid
      ORDER BY sort_key DESC NULLS LAST, b.batch_number DESC
      LIMIT 200
    `,
    [tenantId, customerId]
  );
  return res.rows.map(mapBatchHistoryRow);
}
