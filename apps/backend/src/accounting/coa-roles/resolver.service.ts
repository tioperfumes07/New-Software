export const COA_ROLE_VALUES = [
  "ar_control",
  "ap_control",
  "cash_clearing",
  "undeposited_funds",
  /**
   * ACCT-F345 — the account a DISBURSEMENT credits when the operator did not pick a source.
   *
   * Distinct from cash_clearing/undeposited_funds on purpose. Those are RECEIPT-side clearing
   * accounts (money received, not yet deposited); crediting one for money LEAVING the business drove
   * USMCA's Undeposited Funds to a -$350.00 credit balance and overstated the bank by the same amount.
   *
   * DELIBERATELY ABSENT FROM ROLE_FALLBACKS — owner designates, exactly like the lease roles above.
   * A heuristic here would have to choose between "Bank of America - Operating" and "Relay Fuel
   * Wallet" (the diesel card) by name-matching, and guessing which account real money left is the
   * failure this role exists to end. Unmapped resolves to null and the poster fails closed.
   *
   * Owner 2026-08-11: "THE DEFAULT BANK SHOULD BE BANK OF AMERICA ... WE NEED TO PICK THE SOURCE
   * BECAUSE WE MIGHT SIGN CASH ADVANCE FROM BANK OF AMERICA ACCOUNT, OR USE CASH APP, OR CREDIT CARD,
   * OR DIESEL CARD, ETC." — so this is the DEFAULT only; an explicit operator-chosen source always wins.
   */
  "operating_bank",
  "revenue_default",
  "expense_default",
  "factor_reserve_default",
  "escrow_liability_default",
  "sales_tax_payable",
  "cash_basis_adjustment_equity",
  "retained_earnings",
  "uncategorized_expense",
  // FIN-22 lessor lease (ASC 842) roles — per-opco (TRK) mappings in accounting.chart_of_accounts_roles.
  "rental_income",
  "lease_receivable",
  "interest_income",
  "gain_loss_on_disposal",
  // LEASE-BRIDGE — lessee operating rent expense (TRANSP/USMCA). Dr rent_expense / Cr ap_control.
  // DELIBERATELY absent from ROLE_FALLBACKS — owner designates (soft-bound by migration to
  // "Leased Trucks from IH35 TRUCKING" when present); fails closed until then.
  "rent_expense",
  // CODER-34 factoring secured-borrowing roles (per-opco TRANSP) — migration
  // 202607013000_factoring_secured_borrowing_coa_roles.sql. factor_reserve_held is the canonical reserve
  // role (an ASSET; supersedes the code's old factor_reserve_default, which the shape-fallback mis-typed
  // as a Liability). factor_fee_expense/default_interest_expense are sub-accounts of Interest & Financing.
  "factoring_advance_liability",
  "ar_assigned_to_factor",
  "factoring_recoursed_ar",
  "default_interest_expense",
  "factor_reserve_held",
  "factor_fee_expense",
  // FACT-05 — ACH/wire transaction fee (BC-Ach & Wire Fees); distinct from factor_fee_expense financing.
  // DELIBERATELY absent from ROLE_FALLBACKS — unbound opcos (USMCA) fail closed when ACH>0.
  "factor_wire_fee",
  // Business-Property Allocation (TX personal-property tax) — per-opco (TRANSP/TRK) mappings in
  // accounting.chart_of_accounts_roles, migration 202607080310_property_tax_accrual_posting.sql.
  // ACCRUAL Dr property_tax_expense / Cr property_tax_payable; PAYMENT Dr property_tax_payable / Cr cash.
  "property_tax_expense",
  "property_tax_payable",
  // Settlement / driver / fuel / period-close poster roles (migration 202607670000). These are the
  // role keys the settlement, bill-payment, reimbursement, and period-close posters resolve. They were
  // previously resolvable ONLY from the (empty in prod) catalogs.account_role_bindings legacy table;
  // they are now first-class PRIMARY roles in accounting.chart_of_accounts_roles so the owner can
  // designate them via the CoaRoles page and posters resolve them primary-first.
  "driver_pay_expense",
  "driver_payroll_clearing",
  "reimbursement_expense",
  // DWELL-01-D3 slice 2 (2026-08-30) — driver-side detention pay, the NET-formula/JE-integration slice
  // of a 3-slice finding (slice 1: detention-pay-posting.service.ts's postDetentionPayForEvent, already
  // shipped and live). Dr detention_pay_expense — a single debit leg, mirroring reimbursement_expense's
  // shape exactly (no paired credit leg here; the JE balances against the final net-cash credit).
  // DELIBERATELY absent from ROLE_FALLBACKS — owner designates; fails closed until then.
  "detention_pay_expense",
  "advance_recovery",
  "damage_recovery",
  "lease_recovery",
  "insurance_recovery",
  "fuel_advance_recovery",
  // FUEL-04 — dedicated driver fuel-overage receivable (Asset 1250); never Cash Advance.
  "fuel_overage_receivable",
  "other_recovery",
  // Pay-run close residual (#3109 left this on the legacy table): abandonment chargeback recovery credit.
  "abandonment_chargeback_recovery",
  // ACCT-F5616 — settlement dispute corrective JE credit. createCorrectiveJournalEntry
  // (settlement-dispute.service.ts) previously picked whichever TWO accounts sorted first by
  // created_at (`ORDER BY created_at ASC LIMIT 2`) — exactly the anti-pattern "never ORDER BY
  // created_at LIMIT 2" documented a few roles below in this same file. Dr driver_pay_expense /
  // Cr settlement_dispute_correction_recovery, mirroring reimbursement_expense's shape.
  // DELIBERATELY absent from ROLE_FALLBACKS — a dispute-correction offset account is an owner
  // accounting-treatment decision, never a guess; fails closed until designated.
  "settlement_dispute_correction_recovery",
  // Settlement BillPayment DIP cash bridge (lane defect A / 202607760000): was legacy-bindings-only.
  "cash_dip",
  // SAFETY FINE-GL HOP (migration 202608110000) — the COMPANY-PAID civil fine expense leg.
  // Dr civil_fines_expense / Cr cash_clearing, posted by accounting/safety-fine-posting/poster.service.ts
  // behind SAFETY_FINE_GL_POSTING_ENABLED (default OFF). Driver-recovery fines do NOT use this role —
  // they flow to driver_finance.driver_liabilities + a settlement deduction.
  // DELIBERATELY absent from ROLE_FALLBACKS below: a penalties/fines account must be DESIGNATED by the
  // owner, never shape-matched by name or subtype, so this role fails CLOSED until designated.
  "civil_fines_expense",
  // MNT-ECON-01 (migration 202609030000) — standalone parts purchase expense (periodic / expense-on-
  // purchase). Dr maintenance_parts_expense / Cr ap_control (vendor) or cash_clearing (cash).
  // DELIBERATELY absent from ROLE_FALLBACKS — owner designates; fails closed until then.
  "maintenance_parts_expense",
  // MNT-ECON-04 (migration 202609050000) — warranty reimbursement recovery credit.
  // Dr cash_clearing / Cr warranty_recovery. Owner designates (contra-expense — NEVER sales income).
  // DELIBERATELY absent from ROLE_FALLBACKS.
  "warranty_recovery",
  // INS-01 — fleet add/remove pro-rata premium expense (Truck/Vehicle Insurance).
  // Dr insurance_expense / Cr ap_control. DELIBERATELY absent from ROLE_FALLBACKS — fail closed
  // until designated (never ORDER BY created_at LIMIT 2).
  "insurance_expense",
  // DISP-01 — two-event delivery revenue latch (Unbilled Revenue 1240/1150).
  // Dr unbilled_revenue / Cr revenue_default (earn); Dr ar_control / Cr unbilled_revenue (bill).
  // DELIBERATELY absent from ROLE_FALLBACKS — owner designates via system_purpose bind or CoaRoles.
  "unbilled_revenue",
  // ND-FA-01 / A4-D2 — Heavy Repair Expense (expense path under $7,000 capitalize threshold).
  // DELIBERATELY absent from ROLE_FALLBACKS — owner designates; fails closed until Neon seed/bind.
  "heavy_repair_expense",
  // Fixed-asset defaults (202609100050) — create-UI / Claude backfill helpers. FIN-21 posts from
  // accounting.fixed_assets row columns, not these roles. DELIBERATELY absent from ROLE_FALLBACKS.
  "fixed_asset_default",
  "accum_depr_default",
  "depr_expense_default",
  // Held posting flags CoA (202610131200) — picker defaults; posters may still use row FKs.
  "prepaid_asset_default",
  "amortization_expense_default",
  // LOAN-06 (202611250000) — related-party (owner/insider) loan interest expense. SEPARATE from
  // default_interest_expense, which resolves to 6830 Factoring Default Interest on both operating
  // entities: a receivables-financing penalty is a different fact from the cost of insider money, and
  // ASC 850 requires related-party interest to be separately disclosable. DELIBERATELY absent from
  // ROLE_FALLBACKS — bound on prod for TRANSP+USMCA (6810); fails closed anywhere it is not bound.
  "related_party_interest_expense",
  // ND-INV-01 (202609100090) — "Broker/customer advance liability role admits designation; poster
  // reuse only (no new GL math)" per that migration's own header. Admitted at the DB CHECK level and
  // in the frontend CoaRoles designation enum (apps/frontend/src/api/accounting.ts) since ND-INV-01,
  // but NEVER added here — so even an owner who designated an account for it on the CoaRoles page had
  // no backend poster that could resolve it (isCoaRole would reject it, resolveRoleAccount couldn't
  // accept it as a CoaRole). LOAD-COSTS-COMPLETE item (4/5) (owner order 2026-09-04): a broker advance
  // received/disbursed BEFORE an invoice exists for its load has no receivable yet to net against —
  // this is the liability that holds it until buildInvoiceFromLoad reclassifies it into A/R at mint.
  // DELIBERATELY absent from ROLE_FALLBACKS — owner designates; fails closed until then.
  "broker_customer_advance_liability",
  // LOAD-COSTS-COMPLETE-VERTICAL spec 09-04-2026 §1.2 — owner ruling: "the fuel advance from us to
  // the driver is a company expense... bind by role, never by name." LoadDetailCostsTab.tsx's
  // `+ Fuel advance` control previously picked the debit account by NAME regex (`/fuel/i` against
  // account_name), which can resolve to an ASSET receivable (e.g. "1250 Driver Fuel-Overage
  // Receivable") instead of the expense account — a company fuel advance posting into a driver
  // receivable is exactly what the owner ruled must never happen. This role is the fail-closed
  // replacement: seeded for USMCA (migration 202613750001) to account 5000 "Fuel & Diesel"
  // (CostOfGoodsSold). DELIBERATELY absent from ROLE_FALLBACKS — a fuel-advance debit account is an
  // owner designation, never name-matched; fails closed (control disables, names the missing role)
  // anywhere it is not bound.
  "company_fuel_advance_expense",
  // SETL-DED-UI (owner item, deadline 05:30Z) — wire/ACH fee recovery from the driver credits the
  // SAME expense account the fee itself posted to (6300 Bank Service Charges & Wire Fees), never a
  // new revenue line. NOT yet admitted by the DB CHECK constraint (accounting.chart_of_accounts_
  // roles_role_check) — CC-3 has no migration lane (verify-migration-lane-band.mjs: cc-3/ = chrome-
  // only, authorMigrations:false); a ready-to-apply draft migration + seed live in
  // docs/audit/migration-drafts/BANK-FEE-RECOVERY-*.sql for a migration-lane seat to author. Adding
  // the TS member now is safe/inert (isCoaRole() accepting the string does not INSERT anything) and
  // means the code needs ZERO further change the moment the migration lands and the role is bound —
  // resolveRoleAccountOptional correctly returns null (never guessed) until then.
  // DELIBERATELY absent from ROLE_FALLBACKS — owner designates; fails closed until then.
  "bank_fee_recovery",
] as const;

export type CoaRole = (typeof COA_ROLE_VALUES)[number];

const COA_ROLE_SET: ReadonlySet<string> = new Set<string>(COA_ROLE_VALUES);

/**
 * Type guard: is an arbitrary string a known CoaRole? Used by posters that compute a role key
 * dynamically (e.g. bucketRecoveryRoleKey -> `${type}_recovery`) so an unrecognized key fails CLOSED
 * (never posts) instead of being force-cast into the resolver.
 */
export function isCoaRole(role: string): role is CoaRole {
  return COA_ROLE_SET.has(role);
}

type DbClient = {
  query: <T = Record<string, unknown>>(sql: string, values?: unknown[]) => Promise<{ rows: T[] }>;
};

// CoaRole -> legacy catalogs.account_role_bindings.role_key, so the resolver's LEGACY FALLBACK tier
// (resolveLegacyRoleBinding) keeps working for these roles when the PRIMARY chart_of_accounts_roles
// mapping is absent (Rule 07 never-delete — the legacy table + path stay as a fallback, never the fix).
// For most settlement roles the CoaRole name IS the legacy role_key; ap_control/undeposited_funds keep
// their historical role_key aliases.
const LEGACY_ROLE_BINDINGS: Partial<Record<CoaRole, string>> = {
  ar_control: "ar_clearing",
  ap_control: "ap_clearing",
  undeposited_funds: "undeposited_funds",
  retained_earnings: "retained_earnings",
  driver_pay_expense: "driver_pay_expense",
  driver_payroll_clearing: "driver_payroll_clearing",
  reimbursement_expense: "reimbursement_expense",
  detention_pay_expense: "detention_pay_expense",
  advance_recovery: "advance_recovery",
  damage_recovery: "damage_recovery",
  lease_recovery: "lease_recovery",
  insurance_recovery: "insurance_recovery",
  fuel_advance_recovery: "fuel_advance_recovery",
  other_recovery: "other_recovery",
  abandonment_chargeback_recovery: "abandonment_chargeback_recovery",
  cash_dip: "cash_dip",
};

const ROLE_FALLBACKS: Partial<Record<CoaRole, { subtype?: string[]; type?: string[]; nameHints?: string[] }>> = {
  ar_control: { subtype: ["AccountsReceivable"], type: ["Asset"], nameHints: ["accounts receivable", "a/r"] },
  ap_control: { subtype: ["AccountsPayable"], type: ["Liability"], nameHints: ["accounts payable", "a/p"] },
  cash_clearing: {
    subtype: ["Checking", "Savings", "CashOnHand", "UndepositedFunds"],
    type: ["Asset"],
    nameHints: ["cash", "bank", "checking"],
  },
  undeposited_funds: { subtype: ["UndepositedFunds"], type: ["Asset"], nameHints: ["undeposited funds"] },
  revenue_default: { type: ["Income", "OtherIncome"] },
  expense_default: { type: ["Expense", "OtherExpense", "CostOfGoodsSold"] },
  factor_reserve_default: { type: ["Liability"], nameHints: ["factor reserve", "factoring reserve"] },
  escrow_liability_default: { type: ["Liability"], nameHints: ["escrow"] },
  sales_tax_payable: { subtype: ["SalesTaxPayable"], type: ["Liability"], nameHints: ["sales tax payable", "tax payable"] },
  cash_basis_adjustment_equity: { type: ["Equity"], nameHints: ["cash basis adjustment"] },
  retained_earnings: { subtype: ["RetainedEarnings"], type: ["Equity"], nameHints: ["retained earnings"] },
};

export class CoaRoleResolutionError extends Error {
  code: "COA_ROLE_MAPPING_NOT_FOUND";
  role: CoaRole;
  operating_company_id: string;

  constructor(operatingCompanyId: string, role: CoaRole) {
    super(`No active chart_of_accounts role mapping found for ${role} in ${operatingCompanyId}`);
    this.code = "COA_ROLE_MAPPING_NOT_FOUND";
    this.role = role;
    this.operating_company_id = operatingCompanyId;
  }
}

// Control accounts (A/R, A/P) MUST be uniquely designated. Unlike "default" roles, they can never be
// resolved by a loose `account_subtype` LIMIT 1 tiebreaker: several accounts legitimately carry
// account_subtype='AccountsReceivable'/'AccountsPayable' (real control + mis-classified advances), so an
// arbitrary pick silently posts to the WRONG account (root cause of the GUARD Module 15 invoice A/R bug —
// A/R was debited to "Unauthorized Expenses Ignacio Muñoz"). For these roles we FAIL CLOSED.
const CONTROL_ROLES: ReadonlySet<CoaRole> = new Set<CoaRole>(["ar_control", "ap_control"]);

export class ControlAccountDesignationError extends Error {
  code: "CONTROL_ACCOUNT_NOT_UNIQUELY_DESIGNATED";
  role: CoaRole;
  operating_company_id: string;
  candidate_count: number;
  designation_source: "role_mapping" | "account_subtype_fallback";

  constructor(
    operatingCompanyId: string,
    role: CoaRole,
    candidateCount: number,
    source: "role_mapping" | "account_subtype_fallback"
  ) {
    super(
      `${role}_account_not_uniquely_designated: found ${candidateCount} candidate account(s) via ` +
        `${source} for operating_company_id=${operatingCompanyId}. Exactly one explicitly-designated ` +
        `control account is required — refusing to silently pick one via account_subtype. ` +
        `Designate the control account in accounting.chart_of_accounts_roles (role='${role}').`
    );
    this.code = "CONTROL_ACCOUNT_NOT_UNIQUELY_DESIGNATED";
    this.role = role;
    this.operating_company_id = operatingCompanyId;
    this.candidate_count = candidateCount;
    this.designation_source = source;
  }
}

// USMCA cross-entity-leak fix (5th leak): this role→account mapping runs on the is_lucia_bypass() poster
// path, where the entity-scoped catalogs.accounts RLS is DEFEATED. Scoping the mapping row by
// car.operating_company_id alone is NOT enough — a role row in THIS entity whose account_id points at
// ANOTHER entity's account would still resolve and post a journal line cross-entity. So we pin BOTH sides:
// the role mapping must be this entity's (car.operating_company_id = $1) AND the resolved account must
// itself belong to this entity (a.operating_company_id = $1), symmetric with the legacy-binding
// (resolveLegacyRoleBinding) and shape-fallback (resolveFallbackByAccountShape) paths, which already pin
// the account's own entity. A foreign-entity account now falls through / returns null (fail-closed) exactly
// as an unmapped role would, so the poster fails CLOSED (CoaRoleResolutionError) rather than mis-posting.
async function resolveMappedRoleAccount(client: DbClient, operatingCompanyId: string, role: CoaRole): Promise<string | null> {
  const mapped = await client.query<{ account_id: string }>(
    `
      SELECT car.account_id::text AS account_id
      FROM accounting.chart_of_accounts_roles car
      JOIN catalogs.accounts a ON a.id = car.account_id
      WHERE car.operating_company_id = $1::uuid
        AND a.operating_company_id = $1::uuid
        AND car.role = $2
        AND car.is_active = true
        AND a.deactivated_at IS NULL
        AND a.is_postable = true
      ORDER BY car.updated_at DESC
      LIMIT 1
    `,
    [operatingCompanyId, role]
  );
  return mapped.rows[0]?.account_id ?? null;
}

// USMCA cross-entity-leak fix: catalogs.account_role_bindings is now per-entity (operating_company_id).
// This resolver can run on the is_lucia_bypass() poster path, where the entity-scoped catalogs.accounts RLS
// is DEFEATED, so we pin resolution to the posting entity via TWO explicit predicates: (a) the binding must
// be this entity's row OR a legacy global (NULL-entity) binding, preferring the entity-scoped one; and
// (b) the resolved account must itself belong to this entity. Behavior is identical for TRANSP (all existing
// bindings backfilled to TRANSP → the entity-scoped branch matches), and a foreign-entity account can never
// be returned (fail-closed) even under bypass.
async function resolveLegacyRoleBinding(client: DbClient, operatingCompanyId: string, role: CoaRole): Promise<string | null> {
  const roleKey = LEGACY_ROLE_BINDINGS[role];
  if (!roleKey) return null;
  const legacy = await client.query<{ account_id: string }>(
    `
      SELECT arb.account_id::text AS account_id
      FROM catalogs.account_role_bindings arb
      JOIN catalogs.accounts a ON a.id = arb.account_id
      WHERE arb.role_key = $1
        AND arb.deactivated_at IS NULL
        AND a.deactivated_at IS NULL
        AND a.is_postable = true
        AND (arb.operating_company_id = $2::uuid OR arb.operating_company_id IS NULL)
        AND a.operating_company_id = $2::uuid
      ORDER BY (arb.operating_company_id IS NOT NULL) DESC
      LIMIT 1
    `,
    [roleKey, operatingCompanyId]
  );
  return legacy.rows[0]?.account_id ?? null;
}

function buildFallbackQueryParts(operatingCompanyId: string, fallback: { subtype?: string[]; type?: string[]; nameHints?: string[] }) {
  // operating_company_id is bound as $1 and added as a LITERAL `operating_company_id = $1::uuid`
  // predicate in each query template below — both for entity isolation (never resolve a control
  // account from another company) and so the static entity-scope guard sees the predicate. Fallback
  // params therefore start at $2.
  const clauses: string[] = ["deactivated_at IS NULL", "is_postable = true"];
  const values: unknown[] = [operatingCompanyId];
  if (fallback.subtype?.length) {
    values.push(fallback.subtype);
    clauses.push(`account_subtype = ANY($${values.length}::text[])`);
  }
  if (fallback.type?.length) {
    values.push(fallback.type);
    clauses.push(`account_type = ANY($${values.length}::text[])`);
  }
  if (fallback.nameHints?.length) {
    const hintClauses: string[] = [];
    for (const hint of fallback.nameHints) {
      values.push(`%${hint}%`);
      hintClauses.push(`account_name ILIKE $${values.length}`);
    }
    clauses.push(`(${hintClauses.join(" OR ")})`);
  }
  return { clauses, values };
}

async function resolveFallbackByAccountShape(client: DbClient, operatingCompanyId: string, role: CoaRole): Promise<string | null> {
  const fallback = ROLE_FALLBACKS[role];
  if (!fallback) return null;
  const { clauses, values } = buildFallbackQueryParts(operatingCompanyId, fallback);
  const fallbackRow = await client.query<{ id: string }>(
    `
      SELECT id::text
      FROM catalogs.accounts
      WHERE operating_company_id = $1::uuid AND ${clauses.join(" AND ")}
      ORDER BY updated_at DESC
      LIMIT 1
    `,
    values
  );
  return fallbackRow.rows[0]?.id ?? null;
}

// Count-based variant of resolveMappedRoleAccount: returns the DISTINCT designated account ids for a role
// (no ORDER BY / LIMIT), so control-role resolution can detect ambiguity (>1) and fail closed instead of
// silently picking the most-recently-updated mapping.
async function listMappedRoleAccountIds(client: DbClient, operatingCompanyId: string, role: CoaRole): Promise<string[]> {
  // Same 5th cross-entity-leak fix as resolveMappedRoleAccount: pin the account's OWN entity
  // (a.operating_company_id = $1) in addition to the mapping row's, so a control-role mapping that points
  // at a foreign-entity account can never be counted/returned on the RLS-defeated bypass poster path.
  const mapped = await client.query<{ account_id: string }>(
    `
      SELECT DISTINCT car.account_id::text AS account_id
      FROM accounting.chart_of_accounts_roles car
      JOIN catalogs.accounts a ON a.id = car.account_id
      WHERE car.operating_company_id = $1::uuid
        AND a.operating_company_id = $1::uuid
        AND car.role = $2
        AND car.is_active = true
        AND a.deactivated_at IS NULL
        AND a.is_postable = true
    `,
    [operatingCompanyId, role]
  );
  return mapped.rows.map((r) => r.account_id);
}

// Count-based variant of resolveFallbackByAccountShape: returns ALL DISTINCT account ids matching the
// role's account-shape fallback (no LIMIT), so a control role can refuse to guess when the subtype is
// shared by more than one account.
async function listFallbackAccountIds(client: DbClient, operatingCompanyId: string, role: CoaRole): Promise<string[]> {
  const fallback = ROLE_FALLBACKS[role];
  if (!fallback) return [];
  const { clauses, values } = buildFallbackQueryParts(operatingCompanyId, fallback);
  const rows = await client.query<{ id: string }>(
    `
      SELECT DISTINCT id::text AS id
      FROM catalogs.accounts
      WHERE operating_company_id = $1::uuid AND ${clauses.join(" AND ")}
    `,
    values
  );
  return rows.rows.map((r) => r.id);
}

// Fail-closed resolution for control accounts (A/R, A/P). Authoritative source is the explicit
// designation in accounting.chart_of_accounts_roles; the account_subtype fallback is allowed ONLY when it
// resolves to exactly one account. 0 or >1 candidates -> throw rather than mis-post.
async function resolveControlRoleAccount(client: DbClient, operatingCompanyId: string, role: CoaRole): Promise<string | null> {
  // 1) Explicit designation (the field the resolver keys on — NOT catalogs.accounts.system_purpose).
  const mapped = await listMappedRoleAccountIds(client, operatingCompanyId, role);
  if (mapped.length > 1) {
    throw new ControlAccountDesignationError(operatingCompanyId, role, mapped.length, "role_mapping");
  }
  if (mapped.length === 1) return mapped[0] ?? null;

  // 2) Legacy single binding (catalogs.account_role_bindings — entity-scoped, falls back to global).
  const fromLegacyBinding = await resolveLegacyRoleBinding(client, operatingCompanyId, role);
  if (fromLegacyBinding) return fromLegacyBinding;

  // 3) account_subtype fallback — FAIL CLOSED: never silently pick one of many.
  const candidates = await listFallbackAccountIds(client, operatingCompanyId, role);
  if (candidates.length > 1) {
    throw new ControlAccountDesignationError(operatingCompanyId, role, candidates.length, "account_subtype_fallback");
  }
  if (candidates.length === 1) return candidates[0] ?? null;
  return null;
}

export async function resolveRoleAccountOptional(client: DbClient, operatingCompanyId: string, role: CoaRole): Promise<string | null> {
  if (CONTROL_ROLES.has(role)) {
    return resolveControlRoleAccount(client, operatingCompanyId, role);
  }

  const fromMapped = await resolveMappedRoleAccount(client, operatingCompanyId, role);
  if (fromMapped) return fromMapped;

  const fromLegacyBinding = await resolveLegacyRoleBinding(client, operatingCompanyId, role);
  if (fromLegacyBinding) return fromLegacyBinding;

  return resolveFallbackByAccountShape(client, operatingCompanyId, role);
}

export async function resolveRoleAccount(client: DbClient, operatingCompanyId: string, role: CoaRole): Promise<string> {
  const resolved = await resolveRoleAccountOptional(client, operatingCompanyId, role);
  if (!resolved) throw new CoaRoleResolutionError(operatingCompanyId, role);
  return resolved;
}
