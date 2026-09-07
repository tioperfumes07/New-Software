/**
 * VendorEditDrawer — CUR-2 (owner ruling 2026-09-05, inventory row 50):
 * "when editing, maybe it should be edited in a side modal, not full page, just like in QuickBooks."
 *
 * Edit from the Vendors list opens the vendor's core identity + payable fields in the app's right-side
 * ParityDrawer (QBO-style side panel) instead of navigating to the full-page /vendors/:id form. Save
 * reuses the SAME PATCH endpoint (updateVendor) and touches ONLY first-class columns — it never sends
 * `notes`, so the vendor's serialized contact/quality meta blob is preserved untouched. Deep sub-record
 * editing (contacts, quality, accounting category, factor schedule) stays on the full detail page, which
 * remains reachable by URL — this is additive; only the list Edit button target changed.
 */
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getVendor,
  updateVendor,
  listPaymentTermOptions,
  type UpdateVendorInput,
  type VendorOption,
} from "../../api/mdata";
import { listCatalogAccounts } from "../../api/catalog-accounts";
import { ApiError } from "../../api/client";
import { useCatalogQuery } from "../../hooks/useCatalogQuery";
import { ParityDrawer } from "../parity/ParityDrawer";
import { ReferenceSelect } from "../parity/ReferenceSelect";
import { Button } from "../Button";
import { useToast } from "../Toast";

type Props = {
  open: boolean;
  vendorId: string | null;
  vendorName?: string | null;
  operatingCompanyId?: string | null;
  onClose: () => void;
  onSaved?: () => void;
};

type VendorEditValues = {
  name: string;
  vendorType: string;
  vendorCode: string;
  taxId: string;
  phone: string;
  email: string;
  address: string;
  website: string;
  printOnCheckName: string;
  eligible1099: boolean;
  paymentTermsId: string | null;
  defaultExpenseAccountId: string | null;
};

function vendorToValues(v: VendorOption): VendorEditValues {
  return {
    name: v.name ?? "",
    vendorType: v.vendor_type ?? "",
    vendorCode: v.vendor_code ?? "",
    taxId: v.tax_id ?? "",
    phone: v.phone ?? "",
    email: v.email ?? "",
    address: v.address ?? "",
    website: v.website ?? "",
    printOnCheckName: v.print_on_check_name ?? "",
    eligible1099: Boolean(v.eligible_1099),
    paymentTermsId: v.payment_terms_id ?? null,
    defaultExpenseAccountId: v.default_expense_account_id ?? null,
  };
}

const INPUT_CLASS =
  "w-full max-w-md rounded-sm border border-gray-300 px-2 py-1 text-xs";

export function VendorEditDrawer({ open, vendorId, vendorName, operatingCompanyId, onClose, onSaved }: Props) {
  const queryClient = useQueryClient();
  const { pushToast } = useToast();
  const companyId = operatingCompanyId ?? "";
  const [values, setValues] = useState<VendorEditValues | null>(null);
  const [dirty, setDirty] = useState(false);

  const vendorQuery = useQuery({
    queryKey: ["vendor", vendorId],
    queryFn: () => getVendor(vendorId!, companyId || null),
    enabled: open && Boolean(vendorId),
  });

  useEffect(() => {
    if (open && vendorQuery.data) {
      setValues(vendorToValues(vendorQuery.data));
      setDirty(false);
    }
  }, [open, vendorQuery.data]);

  const vendorTypesQuery = useCatalogQuery({
    catalogName: "vendors.vendor_types",
    companyId,
    enabled: open && Boolean(companyId),
  });
  const vendorTypeOptions = useMemo(() => {
    type CatalogRow = { display_name?: unknown };
    const rows = (vendorTypesQuery.data?.rows ?? []) as CatalogRow[];
    return rows.map((row) => ({ value: String(row.display_name ?? ""), label: String(row.display_name ?? "") }));
  }, [vendorTypesQuery.data]);

  const paymentTermsQuery = useQuery({
    queryKey: ["payment-term-options", companyId],
    queryFn: () => listPaymentTermOptions(companyId),
    enabled: open && Boolean(companyId),
    staleTime: 5 * 60 * 1000,
  });
  const paymentTermOptions = useMemo(
    () => [
      { value: "", label: "— None —" },
      ...(paymentTermsQuery.data?.payment_terms ?? []).map((t) => ({
        value: t.id,
        label: `${t.terms_name} (${t.days_until_due}d)`,
      })),
    ],
    [paymentTermsQuery.data]
  );

  const expenseAccountsQuery = useQuery({
    queryKey: ["catalog-accounts", "expense-for-vendor-default", companyId],
    queryFn: () => listCatalogAccounts({ status: "active", operating_company_id: companyId, postable_only: true }),
    enabled: open && Boolean(companyId),
    staleTime: 5 * 60 * 1000,
  });
  const expenseAccountOptions = useMemo(
    () =>
      (expenseAccountsQuery.data?.accounts ?? [])
        .filter((a) => a.account_type === "Expense")
        .map((a) => ({ value: a.id, label: a.account_name })),
    [expenseAccountsQuery.data]
  );

  const saveMutation = useMutation({
    mutationFn: () => {
      if (!vendorId || !values) throw new Error("No vendor selected");
      // First-class columns only — NEVER `notes` (that field carries the serialized contact/quality
      // meta blob edited on the full detail page; omitting it in this PATCH preserves it).
      const payload: UpdateVendorInput = {
        name: values.name.trim(),
        vendor_type: values.vendorType,
        vendor_code: values.vendorCode.trim() || null,
        tax_id: values.taxId.trim() || null,
        phone: values.phone.trim() || null,
        email: values.email.trim() || null,
        address: values.address.trim() || null,
        website: values.website.trim() || null,
        print_on_check_name: values.printOnCheckName.trim() || null,
        eligible_1099: values.eligible1099,
        payment_terms_id: values.paymentTermsId,
        default_expense_account_id: values.defaultExpenseAccountId,
        operating_company_id: companyId || undefined,
      };
      return updateVendor(vendorId, payload);
    },
    onSuccess: async () => {
      pushToast("Vendor updated", "success");
      await queryClient.invalidateQueries({ queryKey: ["vendors"] });
      if (vendorId) await queryClient.invalidateQueries({ queryKey: ["vendor", vendorId] });
      setDirty(false);
      onSaved?.();
      onClose();
    },
    onError: (e) => pushToast(e instanceof ApiError ? e.message : "Failed to update vendor", "error"),
  });

  function patch(next: Partial<VendorEditValues>) {
    setValues((current) => (current ? { ...current, ...next } : current));
    setDirty(true);
  }

  const saveDisabled = saveMutation.isPending || !values || !values.name.trim();

  return (
    <ParityDrawer
      open={open && Boolean(vendorId)}
      title={vendorName ? `Edit Vendor · ${vendorName}` : "Edit Vendor"}
      subtitle="Side-panel edit (QuickBooks style) — saves to the same vendor record."
      onClose={onClose}
      size="wide"
      confirmDiscardOnClose
      isDirty={dirty}
      footer={
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose} data-testid="vendor-edit-drawer-cancel">
            Cancel
          </Button>
          <Button type="button" onClick={() => saveMutation.mutate()} disabled={saveDisabled} data-testid="vendor-edit-drawer-save">
            {saveMutation.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      }
    >
      {vendorQuery.isLoading || !values ? (
        <div className="text-xs text-gray-500">Loading vendor…</div>
      ) : (
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (!saveDisabled) saveMutation.mutate();
          }}
          data-testid="vendor-edit-drawer-form"
        >
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-gray-600">Vendor name</span>
            <input value={values.name} onChange={(e) => patch({ name: e.target.value })} className={INPUT_CLASS} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-gray-600">Vendor type</span>
            <ReferenceSelect
              value={values.vendorType}
              onChange={(next) => patch({ vendorType: next ?? "" })}
              options={vendorTypeOptions}
              createKind="vendor_type"
              operatingCompanyId={companyId}
              addNewLabel="+ Add new vendor type"
              onOptionCreated={(opt) => {
                patch({ vendorType: opt.label });
                void vendorTypesQuery.refetch();
              }}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-gray-600">Vendor code</span>
            <input value={values.vendorCode} onChange={(e) => patch({ vendorCode: e.target.value })} className={INPUT_CLASS} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-gray-600">Tax ID</span>
            <input value={values.taxId} onChange={(e) => patch({ taxId: e.target.value })} className={INPUT_CLASS} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-gray-600">Telephone</span>
            <input value={values.phone} onChange={(e) => patch({ phone: e.target.value })} className={INPUT_CLASS} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-gray-600">Email</span>
            <input value={values.email} onChange={(e) => patch({ email: e.target.value })} className={INPUT_CLASS} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-gray-600">Address</span>
            <input value={values.address} onChange={(e) => patch({ address: e.target.value })} className="w-full max-w-2xl rounded-sm border border-gray-300 px-2 py-1 text-xs" />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-gray-600">Website</span>
            <input value={values.website} onChange={(e) => patch({ website: e.target.value })} className={INPUT_CLASS} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-gray-600">Print on check as</span>
            <input
              value={values.printOnCheckName}
              onChange={(e) => patch({ printOnCheckName: e.target.value })}
              placeholder="Leave blank to use vendor display name"
              className={INPUT_CLASS}
            />
          </label>
          <label className="flex items-center gap-2 text-xs text-gray-700">
            <input type="checkbox" checked={values.eligible1099} onChange={(e) => patch({ eligible1099: e.target.checked })} />
            Track payments for 1099 (Form 1099-NEC)
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-gray-600">Payment terms</span>
            <ReferenceSelect
              value={values.paymentTermsId ?? ""}
              onChange={(next) => patch({ paymentTermsId: next ? next : null })}
              options={paymentTermOptions}
              createKind="payment_term"
              operatingCompanyId={companyId}
              placeholder="— None —"
              loading={paymentTermsQuery.isLoading}
              onOptionCreated={() => void paymentTermsQuery.refetch()}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-gray-600">Default expense account</span>
            <ReferenceSelect
              value={values.defaultExpenseAccountId ?? null}
              onChange={(next) => patch({ defaultExpenseAccountId: next ? next : null })}
              options={expenseAccountOptions}
              createKind="account"
              operatingCompanyId={companyId}
              placeholder="— None —"
              onOptionCreated={() => {
                void queryClient.invalidateQueries({ queryKey: ["catalog-accounts", "expense-for-vendor-default", companyId] });
              }}
            />
            <p className="mt-1 text-xs text-gray-500">
              Suggested on new bills for this vendor. Never posted automatically.
            </p>
          </label>
          <p className="border-t border-gray-100 pt-2 text-xs text-gray-500">
            Contacts, quality rating, accounting category and factor schedule are edited on the full vendor page.
          </p>
        </form>
      )}
    </ParityDrawer>
  );
}
