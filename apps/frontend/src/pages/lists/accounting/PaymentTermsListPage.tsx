import { paymentTermsCatalogClient } from "../../../api/catalogs-accounting";
import { AccountingCatalogListPage } from "./AccountingCatalogListPage";

export function PaymentTermsListPage() {
  return (
    <AccountingCatalogListPage
      client={paymentTermsCatalogClient}
      displayName="Payment Terms"
      breadcrumbPath="Lists & Catalogs / Accounting / Payment Terms"
      codeLabel="Term Code"
      // PAYMENT-TERMS-CODE-NAME-COLUMN-COLLISION — catalogs.payment_terms has ONE physical column
      // (terms_name) backing both code and display_name (apps/backend/src/catalogs/accounting/
      // index.ts's codeColumn===nameColumn==="terms_name"); presenting two independently-editable
      // fields let them diverge and the backend correctly refused with a 400. Collapse to one field.
      singleCodeNameField
      metadataFields={[{ key: "net_days", label: "Net Days", sortable: true, type: "number", required: true }]}
      metadataSummary={(row) => `Net ${String(row.metadata.net_days ?? "—")} days`}
    />
  );
}
