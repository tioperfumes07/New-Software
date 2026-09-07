/**
 * LDT-D · Shared load-document read — the SINGLE source of truth for the documents
 * shown on the load-detail drawer's Documents tab, the Factoring packet (LDT-4), and
 * the Stops tab BOL/POD chips (LDT-2). Owner order 2026-09-05: the BOL/POD chips the
 * Stops tab and the Factoring packet read come from the SAME rows as the Documents
 * tab — never three independent `listAllFiles` calls that can drift.
 *
 * This hook wraps the existing `listAllFiles` docs API (no new storage path) and
 * exposes derived helpers that every consumer reuses:
 *   - `docs`              — every non-deleted docs.files row linked to the load
 *                           (entity_type='load') plus, when an invoice is linked,
 *                           the invoice's docs (entity_type='invoice').
 *   - `packetDocuments`   — { rateCon, bol, pod, invoicePdf } resolved from the
 *                           same rows by `category_code`. Used by Factoring + Stops.
 *   - `docTypeLabel(code)`— maps a category_code to the operator-facing Type label
 *                           (Rate con · BOL · POD · Invoice · Receipt · Other).
 *
 * Customs is NEVER surfaced here (owner) — customs docs live on the Customs tab
 * under their own entity link, not on the load Documents tab.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { listAllFiles, type DocsFile } from "../../../api/docs";

export type LoadDocumentType = "rate_con" | "bol" | "pod" | "invoice" | "receipt" | "other";

export type PacketDocuments = {
  rateCon: DocsFile | null;
  bol: DocsFile | null;
  pod: DocsFile | null;
  invoicePdf: DocsFile | null;
};

/** Category code → operator-facing Type label (LDT-D required set). Customs never appears. */
export const LOAD_DOCUMENT_TYPE_LABELS: Record<LoadDocumentType, string> = {
  rate_con: "Rate con",
  bol: "BOL",
  pod: "POD",
  invoice: "Invoice",
  receipt: "Receipt",
  other: "Other",
};

/** Map a docs.files `category_code` to the LDT-D Type bucket. Unknown → Other. */
export function loadDocumentTypeFromCategory(categoryCode: string | null | undefined): LoadDocumentType {
  switch (categoryCode) {
    case "rate_confirmation":
    case "rate_con":
      return "rate_con";
    case "bol":
      return "bol";
    case "pod":
      return "pod";
    case "invoice":
    case "invoice_pdf":
      return "invoice";
    case "receipt":
      return "receipt";
    default:
      return "other";
  }
}

/** Operator-facing label for a docs row, used by every consumer of the shared read. */
export function loadDocumentTypeLabel(categoryCode: string | null | undefined): string {
  return LOAD_DOCUMENT_TYPE_LABELS[loadDocumentTypeFromCategory(categoryCode)];
}

/**
 * Derive the factoring/stops packet documents (rate con · BOL · POD · invoice PDF)
 * from a single shared docs array. Every consumer calls THIS, never its own
 * `docs.find(...)` against a separately-fetched list.
 */
export function derivePacketDocuments(docs: DocsFile[], invoiceDocs: DocsFile[] = []): PacketDocuments {
  const live = docs.filter((f) => !f.deleted_at);
  const liveInvoice = invoiceDocs.filter((f) => !f.deleted_at);
  return {
    rateCon: live.find((f) => loadDocumentTypeFromCategory(f.category_code) === "rate_con") ?? null,
    bol: live.find((f) => loadDocumentTypeFromCategory(f.category_code) === "bol") ?? null,
    pod: live.find((f) => loadDocumentTypeFromCategory(f.category_code) === "pod") ?? null,
    invoicePdf: liveInvoice.find((f) => loadDocumentTypeFromCategory(f.category_code) === "invoice") ?? null,
  };
}

type UseLoadDocumentsArgs = {
  operatingCompanyId: string | undefined;
  loadId: string | undefined;
  /** Linked invoice id (optional — when present, invoice docs are fetched too). */
  invoiceId?: string | undefined;
  /** Tab-gate: only fetch when the consumer tab is active (or always for Factoring/Stops). */
  enabled?: boolean;
};

/**
 * The shared load-document read. Returns `docs` (load-linked), `invoiceDocs`, and the
 * derived `packetDocuments`. Query keys are stable so Documents / Factoring / Stops
 * share the same cache entry — no triple-fetch, no drift.
 */
export function useLoadDocuments({ operatingCompanyId, loadId, invoiceId, enabled = true }: UseLoadDocumentsArgs) {
  const loadDocsQuery = useQuery({
    queryKey: ["ldt-load-documents", "load", operatingCompanyId, loadId],
    queryFn: () =>
      listAllFiles({
        operating_company_id: operatingCompanyId!,
        entity_type: "load",
        entity_id: loadId!,
      }).then((res) => res.files),
    enabled: Boolean(enabled && operatingCompanyId && loadId),
    staleTime: 30_000,
  });

  const invoiceDocsQuery = useQuery({
    queryKey: ["ldt-load-documents", "invoice", operatingCompanyId, invoiceId],
    queryFn: () =>
      listAllFiles({
        operating_company_id: operatingCompanyId!,
        entity_type: "invoice",
        entity_id: invoiceId!,
      }).then((res) => res.files),
    enabled: Boolean(enabled && operatingCompanyId && invoiceId),
    staleTime: 30_000,
  });

  const docs = useMemo(() => (loadDocsQuery.data ?? []).filter((f) => !f.deleted_at), [loadDocsQuery.data]);
  const invoiceDocs = useMemo(() => (invoiceDocsQuery.data ?? []).filter((f) => !f.deleted_at), [invoiceDocsQuery.data]);

  const packetDocuments = useMemo(() => derivePacketDocuments(docs, invoiceDocs), [docs, invoiceDocs]);

  return {
    docs,
    invoiceDocs,
    packetDocuments,
    isLoading: loadDocsQuery.isLoading || invoiceDocsQuery.isLoading,
    isError: loadDocsQuery.isError || invoiceDocsQuery.isError,
    error: loadDocsQuery.error ?? invoiceDocsQuery.error ?? null,
    refetch: () => Promise.all([loadDocsQuery.refetch(), invoiceDocsQuery.refetch()]),
  };
}
