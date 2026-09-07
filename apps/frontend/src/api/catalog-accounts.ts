import { apiRequest } from "./client";

export type CatalogAccount = {
  id: string;
  account_number: string | null;
  account_name: string;
  account_type: string;
  account_subtype: string | null;
  /** catalogs.accounts.system_purpose — role tag (bank_operating, relay_fuel_wallet, …). LDT-1 reads it
   *  to decide which accounts may appear under "Paid with". */
  system_purpose?: string | null;
  /** LINK-02 — FK to catalogs.detail_types when Neon mig applied. */
  detail_type_id?: string | null;
  parent_account_id: string | null;
  qbo_account_id: string | null;
  qbo_account_qrn: string | null;
  is_postable: boolean;
  currency_code: string;
  opening_balance_cents: number | null;
  opening_balance_as_of: string | null;
  is_locked: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
  deactivated_at: string | null;
  created_by_user_id: string | null;
  updated_by_user_id: string | null;
};

export type CreateCatalogAccountBody = {
  account_name: string;
  account_type: string;
  account_number?: string | null;
  account_subtype?: string | null;
  detail_type_id?: string | null;
  parent_account_id?: string | null;
  is_postable?: boolean;
  currency_code?: string;
  opening_balance_cents?: number | null;
  opening_balance_as_of?: string | null;
  is_locked?: boolean;
  notes?: string | null;
  operating_company_id?: string;
};

export type UpdateCatalogAccountBody = Partial<CreateCatalogAccountBody> & {
  deactivated_at?: string | null;
};

export function createCatalogAccount(body: CreateCatalogAccountBody) {
  return apiRequest<CatalogAccount>("/api/v1/catalogs/accounts", {
    method: "POST",
    body,
  });
}

export function updateCatalogAccount(id: string, body: UpdateCatalogAccountBody) {
  return apiRequest<CatalogAccount>(`/api/v1/catalogs/accounts/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body,
  });
}

export function deactivateCatalogAccountById(id: string) {
  return apiRequest<{ id: string; deactivated_at: string; was_already_deactivated: boolean }>(
    `/api/v1/catalogs/accounts/${encodeURIComponent(id)}/deactivate`,
    { method: "POST", body: {} }
  );
}

export function getCatalogAccount(id: string) {
  return apiRequest<CatalogAccount>(`/api/v1/catalogs/accounts/${encodeURIComponent(id)}`);
}

// Active chart of accounts (entity-scoped server-side). Used e.g. for the Record-Expense payment-account
// picker, where the caller filters to postable Asset (bank/cash) accounts.
//
// G9-H6: /catalogs/accounts hard-caps `limit` at 200 (accounts.routes.ts) and returns no total, while the
// chart has 371 accounts — so a single call silently drops the OLDEST accounts (ORDER BY created_at DESC).
// When the caller does not force a specific `limit`, page by offset until a short page so the FULL chart is
// returned; a caller passing an explicit `limit` still gets exactly that page (backend clamps it to <=200).
export async function listCatalogAccounts(params?: {
  status?: string;
  limit?: number;
  /** Required for USMCA/TRANSP entity charts — omitting falls back to the user's default company. */
  operating_company_id?: string;
  /** When true, only rows with is_postable=true (posting-target pickers). */
  postable_only?: boolean;
}) {
  const status = params?.status ?? "active";
  // Name locked for verify-acct-catalog-accounts-opco-scope (appendOpco). Also sends postable_only.
  const appendOpco = (qs: URLSearchParams) => {
    if (params?.operating_company_id) qs.set("operating_company_id", params.operating_company_id);
    if (params?.postable_only) qs.set("postable_only", "true");
  };
  if (params?.limit !== undefined) {
    const qs = new URLSearchParams({ status, limit: String(params.limit) });
    appendOpco(qs);
    return apiRequest<{ accounts: CatalogAccount[] }>(`/api/v1/catalogs/accounts?${qs.toString()}`);
  }
  const PAGE = 200;
  const accounts: CatalogAccount[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const qs = new URLSearchParams({ status, limit: String(PAGE), offset: String(offset) });
    appendOpco(qs);
    const res = await apiRequest<{ accounts: CatalogAccount[] }>(`/api/v1/catalogs/accounts?${qs.toString()}`);
    accounts.push(...res.accounts);
    if (res.accounts.length < PAGE) break;
  }
  return { accounts };
}
