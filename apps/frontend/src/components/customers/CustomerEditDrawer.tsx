/**
 * CustomerEditDrawer — CUR-2 (owner ruling 2026-09-05, inventory row 50):
 * "when editing, maybe it should be edited in a side modal, not full page, just like in QuickBooks."
 *
 * Edit from the Customers list now opens the SAME CustomerProfileForm the +Create / full-edit modal
 * uses, hosted in the app's right-side ParityDrawer (the QBO-style side panel) instead of navigating
 * to the full-page /customers/:id form. Save reuses the SAME PATCH endpoint (updateCustomer); the
 * list row refreshes in place via the ["customers"] query invalidation. The full-page route stays
 * reachable by URL — this is additive; only the Edit button target changed.
 */
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  listAllCustomers,
  listPaymentTermOptions,
  updateCustomer,
  type Customer,
} from "../../api/mdata";
import { customerIsSelectable } from "../../lib/customer-selectable";
import { ApiError } from "../../api/client";
import { ParityDrawer } from "../parity/ParityDrawer";
import { Button } from "../Button";
import { ListErrorState } from "../ListErrorState";
import { useToast } from "../Toast";
import {
  CustomerProfileForm,
  customerToProfileValues,
  emptyCustomerProfileValues,
  profileValuesToUpdatePayload,
  type CustomerProfileFormValues,
} from "./CustomerProfileForm";

type Props = {
  open: boolean;
  customer: Customer | null;
  operatingCompanyId?: string | null;
  onClose: () => void;
  /** Called after a successful save so the caller can surface a row-in-place refresh. */
  onSaved?: (updated: Customer) => void;
};

export function CustomerEditDrawer({ open, customer, operatingCompanyId, onClose, onSaved }: Props) {
  const queryClient = useQueryClient();
  const { pushToast } = useToast();
  const [values, setValues] = useState<CustomerProfileFormValues>(() =>
    customer ? customerToProfileValues(customer) : emptyCustomerProfileValues()
  );
  const [formError, setFormError] = useState("");
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (open && customer) {
      setValues(customerToProfileValues(customer));
      setFormError("");
      setDirty(false);
    }
  }, [open, customer]);

  const companyId = operatingCompanyId ?? customer?.operating_company_id ?? "";

  const paymentTermsQuery = useQuery({
    queryKey: ["payment-term-options", companyId],
    queryFn: () => listPaymentTermOptions(companyId),
    enabled: open && Boolean(companyId),
    staleTime: 5 * 60 * 1000,
  });
  const paymentTermOptions = useMemo(() => {
    const raw = paymentTermsQuery.data?.payment_terms;
    return Array.isArray(raw) ? raw : [];
  }, [paymentTermsQuery.data]);

  const parentCandidatesQuery = useQuery({
    queryKey: ["customer-parent-options", companyId],
    queryFn: () => listAllCustomers({ operating_company_id: companyId }).then((r) => r.customers),
    enabled: open && Boolean(companyId),
    staleTime: 60_000,
  });
  const parentCustomerOptions = useMemo(() => {
    const rows = Array.isArray(parentCandidatesQuery.data) ? parentCandidatesQuery.data : [];
    return rows
      .filter((c) => !c.parent_customer_id && c.id !== customer?.id && customerIsSelectable(c))
      .map((c) => ({ id: c.id, name: c.name, customer_code: c.customer_code }));
  }, [parentCandidatesQuery.data, customer?.id]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!customer) throw new Error("No customer selected");
      return updateCustomer(customer.id, {
        ...profileValuesToUpdatePayload(values),
        operating_company_id: companyId || undefined,
      });
    },
    onSuccess: async (updated) => {
      pushToast("Customer updated", "success");
      await queryClient.invalidateQueries({ queryKey: ["customers"] });
      if (customer) await queryClient.invalidateQueries({ queryKey: ["customer-detail", customer.id] });
      setDirty(false);
      onSaved?.(updated);
      onClose();
    },
    onError: (e) => pushToast(e instanceof ApiError ? e.message : "Failed to update customer", "error"),
  });

  function patch(next: Partial<CustomerProfileFormValues>) {
    setValues((current) => ({ ...current, ...next }));
    setDirty(true);
  }

  function submit() {
    if (!values.customer_type) {
      setFormError("Customer type is required.");
      return;
    }
    if (!values.email.trim()) {
      setFormError("Email is required.");
      return;
    }
    setFormError("");
    saveMutation.mutate();
  }

  const optionsFailed = paymentTermsQuery.isError || parentCandidatesQuery.isError;
  const saveDisabled =
    saveMutation.isPending ||
    optionsFailed ||
    !values.name.trim() ||
    !values.customer_type ||
    !values.email.trim();

  return (
    <ParityDrawer
      open={open && Boolean(customer)}
      title={customer ? `Edit Customer · ${customer.name}` : "Edit Customer"}
      subtitle="Side-panel edit (QuickBooks style) — saves to the same customer record."
      onClose={onClose}
      size="wide"
      confirmDiscardOnClose
      isDirty={dirty}
      footer={
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose} data-testid="customer-edit-drawer-cancel">
            Cancel
          </Button>
          <Button
            type="button"
            onClick={submit}
            disabled={saveDisabled}
            data-testid="customer-edit-drawer-save"
          >
            {saveMutation.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      }
    >
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        data-testid="customer-edit-drawer-form"
      >
        {formError ? (
          <div role="alert" className="rounded-sm border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-700">
            {formError}
          </div>
        ) : null}
        {paymentTermsQuery.isError ? (
          <ListErrorState
            title="Couldn't load payment terms"
            status={0}
            message={(paymentTermsQuery.error as Error)?.message}
            onRetry={() => void paymentTermsQuery.refetch()}
          />
        ) : null}
        {parentCandidatesQuery.isError ? (
          <ListErrorState
            title="Couldn't load parent customer choices"
            status={0}
            message={(parentCandidatesQuery.error as Error)?.message}
            onRetry={() => void parentCandidatesQuery.refetch()}
          />
        ) : null}
        {customer && !optionsFailed ? (
          <CustomerProfileForm
            values={values}
            onPatch={patch}
            operatingCompanyId={companyId}
            mode="edit"
            paymentTermOptions={paymentTermOptions}
            onPaymentTermCreated={() => void paymentTermsQuery.refetch()}
            parentCustomerOptions={parentCustomerOptions}
            onParentCustomerCreated={() => void parentCandidatesQuery.refetch()}
            customerId={customer.id}
          />
        ) : null}
      </form>
    </ParityDrawer>
  );
}
