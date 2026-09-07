/**
 * LdtDocumentsTab — the Load Detail drawer's Documents tab (LDT-D).
 *
 * Owner order 2026-09-05: "Documents tab = the old DocumentsTab list + a factoring-package block."
 * REQUIRED: .ldt-* palette (no hex); one table Date · Type (Rate con · BOL · POD · Invoice ·
 * Receipt · Other) · Name · Size · Linked to (load / stop / expense / bill / invoice) · Open;
 * upload via ReceiptAttach for expense/bill rows and the existing docs upload for load docs;
 * the BOL/POD chips the Stops tab (LDT-2) and Factoring packet (LDT-4) read come from the SAME
 * rows — the shared read is `useLoadDocuments` (see useLoadDocuments.ts). Customs never appears
 * here (owner).
 *
 * Storage paths reused (no new path):
 *   - Load + invoice docs → docs.files via listAllFiles (EntityDocumentUpload for new uploads)
 *   - Expense/bill receipts → documents.attachments via ReceiptAttach
 *
 * The BOL generate panel (LoadBolPanel) is kept — it generates a BOL doc that then appears
 * as a row in this same table through the shared read.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { listLoadExpenses, listBills, listLoadInvoices } from "../../../api/accounting";
import { listAttachments, getAttachmentDownloadUrl, type AttachmentRow } from "../../../api/attachments";
import { getDownloadUrl, type DocsFile } from "../../../api/docs";
import { useLoadDocuments, loadDocumentTypeLabel } from "./useLoadDocuments";
import { EntityDocumentUpload } from "../../documents/EntityDocumentUpload";
import { ReceiptAttach } from "../../documents/ReceiptAttach";
import { LoadBolPanel } from "../LoadBolPanel";
import { useToast } from "../../Toast";
import { userFacingApiError } from "../../../lib/api-error-message";
import { ParityTable, type ParityColumn } from "../../parity/ParityTable";

type Props = {
  loadId: string;
  operatingCompanyId: string;
  loadNumber: string;
  canEdit: boolean;
};

// ─── row model (unified across docs.files + documents.attachments) ───────────

type DocRowKind = "docs_file" | "attachment";

type UnifiedDocRow = {
  id: string;
  kind: DocRowKind;
  date: string; // ISO
  typeLabel: string; // Rate con · BOL · POD · Invoice · Receipt · Other
  name: string;
  sizeBytes: number;
  linkedTo: { label: string; kind: "load" | "invoice" | "expense" | "bill" };
  open: () => void;
};

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDateShort(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

// ─── component ───────────────────────────────────────────────────────────────

export function LdtDocumentsTab({ loadId, operatingCompanyId, loadNumber, canEdit }: Props) {
  const { pushToast } = useToast();

  // SHARED READ — the single source of truth for load + invoice docs.
  // FactoringTab (LDT-4) and LoadStopsRecordTab (LDT-2) consume the same hook.
  const { docs, invoiceDocs, isLoading: docsLoading, isError: docsError } = useLoadDocuments({
    operatingCompanyId,
    loadId,
    enabled: true,
  });

  // Load's invoices — to find the linked invoice id and label
  const invoicesQuery = useQuery({
    queryKey: ["ldt-documents", "load-invoices", operatingCompanyId, loadId],
    queryFn: () => listLoadInvoices(operatingCompanyId, loadId, { limit: 50 }),
    enabled: Boolean(operatingCompanyId && loadId),
  });
  const linkedInvoice = useMemo(() => (invoicesQuery.data?.invoices ?? [])[0] ?? null, [invoicesQuery.data?.invoices]);

  // Load's expenses — for receipt attachment rows + ReceiptAttach controls
  const expensesQuery = useQuery({
    queryKey: ["ldt-documents", "load-expenses", operatingCompanyId, loadId],
    queryFn: () => listLoadExpenses(operatingCompanyId, loadId, { limit: 100 }),
    enabled: Boolean(operatingCompanyId && loadId),
  });
  const expenses = useMemo(() => expensesQuery.data?.rows ?? [], [expensesQuery.data?.rows]);

  // Load's bills — for receipt attachment rows + ReceiptAttach controls
  const billsQuery = useQuery({
    queryKey: ["ldt-documents", "load-bills", operatingCompanyId, loadId],
    queryFn: () => listBills(operatingCompanyId, { load_id: loadId, limit: 100 }),
    enabled: Boolean(operatingCompanyId && loadId),
  });
  const bills = useMemo(() => billsQuery.data?.rows ?? [], [billsQuery.data?.rows]);

  // Receipt attachments for each expense — one query per expense (reuses listAttachments)
  const expenseReceiptQueries = useQuery({
    queryKey: ["ldt-documents", "expense-receipts", operatingCompanyId, expenses.map((e) => e.id).join(",")],
    queryFn: async () => {
      const results: Array<{ expenseId: string; rows: AttachmentRow[] }> = [];
      for (const expense of expenses) {
        try {
          const res = await listAttachments({ operating_company_id: operatingCompanyId, entity_type: "expense", entity_id: expense.id });
          results.push({ expenseId: expense.id, rows: res.rows ?? [] });
        } catch {
          results.push({ expenseId: expense.id, rows: [] });
        }
      }
      return results;
    },
    enabled: expenses.length > 0,
  });

  // Receipt attachments for each bill — one query per bill (reuses listAttachments)
  const billReceiptQueries = useQuery({
    queryKey: ["ldt-documents", "bill-receipts", operatingCompanyId, bills.map((b) => b.id).join(",")],
    queryFn: async () => {
      const results: Array<{ billId: string; rows: AttachmentRow[] }> = [];
      for (const bill of bills) {
        try {
          const res = await listAttachments({ operating_company_id: operatingCompanyId, entity_type: "bill", entity_id: bill.id });
          results.push({ billId: bill.id, rows: res.rows ?? [] });
        } catch {
          results.push({ billId: bill.id, rows: [] });
        }
      }
      return results;
    },
    enabled: bills.length > 0,
  });

  // ─── open handlers ─────────────────────────────────────────────────────────

  async function openDocsFile(file: DocsFile) {
    try {
      const res = await getDownloadUrl(file.id);
      window.open(res.presigned_url, "_blank", "noopener,noreferrer");
    } catch (e) {
      pushToast(userFacingApiError(e, "Could not open the document."), "error");
    }
  }

  async function openAttachment(row: AttachmentRow) {
    try {
      const res = await getAttachmentDownloadUrl(row.id, operatingCompanyId);
      window.open(res.download_url, "_blank", "noopener");
    } catch (e) {
      pushToast(userFacingApiError(e, "Could not open the receipt."), "error");
    }
  }

  // ─── unified rows ──────────────────────────────────────────────────────────

  const rows: UnifiedDocRow[] = useMemo(() => {
    const out: UnifiedDocRow[] = [];

    // Load docs (docs.files, entity_type=load)
    for (const f of docs) {
      out.push({
        id: `doc:${f.id}`,
        kind: "docs_file",
        date: f.document_date ?? f.created_at,
        typeLabel: loadDocumentTypeLabel(f.category_code),
        name: f.original_filename,
        sizeBytes: Number(f.size_bytes ?? 0),
        linkedTo: { label: `Load ${loadNumber}`, kind: "load" },
        open: () => void openDocsFile(f),
      });
    }

    // Invoice docs (docs.files, entity_type=invoice)
    for (const f of invoiceDocs) {
      out.push({
        id: `invdoc:${f.id}`,
        kind: "docs_file",
        date: f.document_date ?? f.created_at,
        typeLabel: loadDocumentTypeLabel(f.category_code),
        name: f.original_filename,
        sizeBytes: Number(f.size_bytes ?? 0),
        linkedTo: { label: linkedInvoice ? `Invoice ${linkedInvoice.display_id ?? linkedInvoice.id}` : "Invoice", kind: "invoice" },
        open: () => void openDocsFile(f),
      });
    }

    // Expense receipts (documents.attachments, entity_type=expense)
    for (const group of expenseReceiptQueries.data ?? []) {
      const expense = expenses.find((e) => e.id === group.expenseId);
      for (const r of group.rows) {
        out.push({
          id: `expreceipt:${r.id}`,
          kind: "attachment",
          date: r.uploaded_at,
          typeLabel: "Receipt",
          name: r.filename,
          sizeBytes: Number(r.size_bytes ?? 0),
          linkedTo: { label: `Expense ${expense?.expense_number ?? "untitled"}`, kind: "expense" },
          open: () => void openAttachment(r),
        });
      }
    }

    // Bill receipts (documents.attachments, entity_type=bill)
    for (const group of billReceiptQueries.data ?? []) {
      const bill = bills.find((b) => b.id === group.billId);
      for (const r of group.rows) {
        out.push({
          id: `billreceipt:${r.id}`,
          kind: "attachment",
          date: r.uploaded_at,
          typeLabel: "Receipt",
          name: r.filename,
          sizeBytes: Number(r.size_bytes ?? 0),
          linkedTo: { label: `Bill ${bill?.display_id ?? "untitled"}`, kind: "bill" },
          open: () => void openAttachment(r),
        });
      }
    }

    // Sort newest-first by date
    out.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docs, invoiceDocs, expenses, bills, expenseReceiptQueries.data, billReceiptQueries.data, linkedInvoice, loadNumber]);

  // ─── columns (ParityTable — no raw table element per go26-consolidation-ratchet) ──
  const docColumns: Array<ParityColumn<UnifiedDocRow>> = [
    { key: "date", label: "Date", render: (row) => formatDateShort(row.date), cellClass: "ldt-m" },
    { key: "typeLabel", label: "Type", render: (row) => (
      <span className={`ldt-pill ${row.typeLabel === "Other" ? "warn" : "ok"}`}>{row.typeLabel}</span>
    ) },
    { key: "name", label: "Name" },
    { key: "sizeBytes", label: "Size", render: (row) => formatBytes(row.sizeBytes), cellClass: "ldt-m" },
    { key: "linkedTo", label: "Linked to", render: (row) => row.linkedTo.label },
    { key: "open", label: "Open", render: (row) => (
      <button type="button" className="ldt-link" onClick={() => row.open()} data-testid="ldt-documents-open">
        Open
      </button>
    ) },
  ];

  // ─── render ────────────────────────────────────────────────────────────────

  return (
    <div className="ldt-body" data-testid="ldt-documents-tab" data-ldt-surface="documents">
      {/* Actions: load docs upload + BOL generate */}
      <div className="ldt-rowbar">
        <div className="ldt-muted">Documents for Load {loadNumber}</div>
        <div className="ldt-actions">
          {canEdit ? (
            <EntityDocumentUpload
              entityType="load"
              entityId={loadId}
              entityName={`Load ${loadNumber}`}
              operatingCompanyId={operatingCompanyId}
              buttonLabel="+ Upload load doc"
              buttonTestId="ldt-documents-upload"
              onUploadSuccess={() => {
                /* shared read refetches via query invalidation */
              }}
            />
          ) : null}
        </div>
      </div>

      {/* BOL generate panel — generates a BOL doc that appears as a row above */}
      <LoadBolPanel loadId={loadId} companyId={operatingCompanyId} />

      {/* ONE table: Date · Type · Name · Size · Linked to · Open */}
      <div className="ldt-card">
        <div className="ldt-ch">
          <span>Documents ({rows.length})</span>
          <span className="ldt-open">shared read: useLoadDocuments</span>
        </div>
        {docsError ? (
          <div className="ldt-note bad">Could not load all documents. Some rows may be missing.</div>
        ) : null}
        {docsLoading && rows.length === 0 ? (
          <div className="ldt-muted" style={{ padding: "12px 10px" }}>Loading documents…</div>
        ) : rows.length === 0 ? (
          <div className="ldt-muted" style={{ padding: "12px 10px" }}>No documents yet. Upload a load doc above.</div>
        ) : (
          <ParityTable
            rows={rows}
            columns={docColumns}
            rowKey={(row) => row.id}
            tableTestId="ldt-documents-table"
            rowTestId={() => "ldt-documents-row"}
            storageKey="ldt-documents"
            suppressToolbarSearch
            suppressToolbarRange
            initialPageSize={25}
          />
        )}
      </div>

      {/* Receipts on this load's costs — ReceiptAttach for each expense/bill.
          CappedListNotice: expenses/bills use limit=100; the total from the list endpoint
          is shown so the operator knows if there are more rows. */}
      {expenses.length > 0 || bills.length > 0 ? (
        <div className="ldt-card">
          <div className="ldt-ch">
            <span>Receipts on this load's costs</span>
            <span className="ldt-open">
              {expensesQuery.data?.total != null || billsQuery.data?.total != null
                ? `total: ${expensesQuery.data?.total ?? 0} expenses · ${billsQuery.data?.total ?? 0} bills`
                : "upload via ReceiptAttach"}
            </span>
          </div>
          <div className="ldt-rows" style={{ padding: "6px 0" }}>
            {expenses.map((expense) => (
              <div key={`expense-${expense.id}`} className="ldt-row" data-testid="ldt-documents-expense-receipt">
                <div>
                  <div className="ldt-k">Expense {expense.expense_number ?? "untitled"}</div>
                  <div className="ldt-sub">
                    {expense.vendor_name ?? "—"} · {formatDateShort(expense.transaction_date)}
                  </div>
                </div>
                <div style={{ display: "flex", justifyContent: "flex-end" }}>
                  <ReceiptAttach
                    operatingCompanyId={operatingCompanyId}
                    entityType="expense"
                    entityId={expense.id}
                    readOnly={!canEdit}
                    testId={`ldt-documents-receipt-expense-${expense.id}`}
                  />
                </div>
              </div>
            ))}
            {bills.map((bill) => (
              <div key={`bill-${bill.id}`} className="ldt-row" data-testid="ldt-documents-bill-receipt">
                <div>
                  <div className="ldt-k">Bill {bill.display_id ?? "untitled"}</div>
                  <div className="ldt-sub">
                    {bill.vendor_name ?? "—"} · {formatDateShort(bill.bill_date ?? bill.created_at)}
                  </div>
                </div>
                <div style={{ display: "flex", justifyContent: "flex-end" }}>
                  <ReceiptAttach
                    operatingCompanyId={operatingCompanyId}
                    entityType="bill"
                    entityId={bill.id}
                    readOnly={!canEdit}
                    testId={`ldt-documents-receipt-bill-${bill.id}`}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* Customs is NEVER shown here (owner) — customs docs live on the Customs tab */}
    </div>
  );
}
