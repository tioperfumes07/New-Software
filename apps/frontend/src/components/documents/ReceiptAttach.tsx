import { useEffect, useRef, useState } from "react";
import {
  createAttachmentUploadUrl,
  deleteAttachment,
  finalizeAttachment,
  getAttachmentDownloadUrl,
  listAttachments,
  type AttachmentCategory,
  type AttachmentEntityType,
  type AttachmentRow,
} from "../../api/attachments";
import { userFacingApiError } from "../../lib/api-error-message";

/**
 * LDT-1 · ONE receipt control for EVERY expense / bill creator and editor (owner 2026-09-05: "for every
 * expense creator or bill etc we must always be able to upload the expense picture, receipt etc").
 *
 * Storage is the app's real, already-wired evidence path — `documents.attachments` (entity_type
 * 'expense' | 'bill', category 'receipt') through /api/v1/attachments/upload-url → R2 PUT → finalize.
 * On a CREATE form `entityId` is the form's draft uuid; the create payload carries it as
 * `attachment_draft_id` and the backend re-links the rows to the real record (reassignDraftAttachments).
 * On a DETAIL page `entityId` is the record id. Nothing here invents a second storage path.
 *
 * Compact by design: a button + count chip + thumbnails; it fits inside a cost card field.
 */
export type ReceiptAttachProps = {
  operatingCompanyId: string;
  // "manual" — SETL-DED-UI's settlement-deduction creator has no dedicated attachments entity_type
  // (adding one needs a migration to attachments_entity_type_check, out of that item's lane); its
  // "source doc" control reuses this existing, already-permitted generic bucket instead.
  entityType: Extract<AttachmentEntityType, "expense" | "bill" | "manual">;
  entityId: string;
  category?: AttachmentCategory;
  /** Read-only view (posted record without edit rights) — still lists and opens what is attached. */
  readOnly?: boolean;
  testId?: string;
  onCountChange?: (count: number) => void;
};

async function sha256Hex(file: File) {
  const buffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function putFile(url: string, file: File, onProgress: (pct: number) => void) {
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    xhr.upload.onprogress = (event) => { if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100)); };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`upload_failed_${xhr.status}`)));
    xhr.onerror = () => reject(new Error("upload_network_error"));
    xhr.send(file);
  });
}

export function ReceiptAttach({ operatingCompanyId, entityType, entityId, category = "receipt", readOnly = false, testId = "receipt-attach", onCountChange }: ReceiptAttachProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [rows, setRows] = useState<AttachmentRow[]>([]);
  const [open, setOpen] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previews, setPreviews] = useState<Record<string, string>>({});

  async function refresh() {
    if (!operatingCompanyId || !entityId) return;
    try {
      const result = await listAttachments({ operating_company_id: operatingCompanyId, entity_type: entityType, entity_id: entityId });
      const next = result.rows ?? [];
      setRows(next);
      onCountChange?.(next.length);
    } catch (e) {
      setError(userFacingApiError(e, "Could not list receipts."));
    }
  }

  useEffect(() => { void refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [operatingCompanyId, entityType, entityId]);

  async function openFile(row: AttachmentRow) {
    try {
      const { download_url } = await getAttachmentDownloadUrl(row.id, operatingCompanyId);
      window.open(download_url, "_blank", "noopener");
    } catch (e) { setError(userFacingApiError(e, "Could not open the receipt.")); }
  }

  async function preview(row: AttachmentRow) {
    if (previews[row.id] || !/^image\//.test(row.content_type)) return;
    try {
      const { download_url } = await getAttachmentDownloadUrl(row.id, operatingCompanyId);
      setPreviews((p) => ({ ...p, [row.id]: download_url }));
    } catch { /* thumbnail is a convenience; the row still opens */ }
  }

  useEffect(() => { if (open) rows.forEach((r) => void preview(r)); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [open, rows]);

  async function onFiles(files: FileList | null) {
    if (!files || !files.length) return;
    setError(null);
    for (const file of Array.from(files)) {
      try {
        setProgress(1);
        const up = await createAttachmentUploadUrl({ operating_company_id: operatingCompanyId, entity_type: entityType, entity_id: entityId, filename: file.name, content_type: file.type || "application/octet-stream", size_bytes: file.size });
        await putFile(up.upload_url, file, setProgress);
        const hash = await sha256Hex(file);
        await finalizeAttachment(up.attachment_id, { operating_company_id: operatingCompanyId, entity_type: entityType, entity_id: entityId, sha256_hash: hash, category });
      } catch (e) {
        setError(`${file.name}: ${userFacingApiError(e, "upload failed")}`);
      } finally { setProgress(null); }
    }
    await refresh();
    setOpen(true);
  }

  const count = rows.length;
  return (
    <div className="relative inline-flex flex-col gap-1" data-testid={testId} data-receipt-attach={entityType} data-receipt-count={count}>
      <div className="flex items-center gap-1">
        {!readOnly ? (
          <button
            type="button"
            data-testid={`${testId}-add`}
            className="ldt-att"
            disabled={progress !== null}
            onClick={() => inputRef.current?.click()}
            title="Attach a receipt photo or PDF"
          >
            {progress !== null ? `uploading ${progress}%` : count ? "+ add" : "+ attach"}
          </button>
        ) : null}
        {/* REG-PARSE (owner 2026-09-06): "IN RECEIPT IT SHOULD JUST HAVE ATTACH; IF THERE IS NO RECEIPT THERE IS NO ATTACHMENT" —
            the count pill renders only when a receipt exists. Read-only rows with none show a dash. */}
        {count > 0 ? (
          <button
            type="button"
            data-testid={`${testId}-count`}
            className="ldt-pill ok"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            title="Open receipts"
          >
            {count === 1 ? "1 receipt" : `${count} receipts`}
          </button>
        ) : readOnly ? (
          <span data-testid={`${testId}-count`} className="ldt-muted">—</span>
        ) : null}
        <input
          ref={inputRef}
          type="file"
          accept="image/*,application/pdf"
          capture="environment"
          multiple
          className="hidden"
          data-testid={`${testId}-input`}
          onChange={(e) => { void onFiles(e.target.files); e.currentTarget.value = ""; }}
        />
      </div>
      {error ? <div className="ldt-bad-text" data-testid={`${testId}-error`}>{error}</div> : null}
      {open ? (
        <div className="ldt-pop" data-testid={`${testId}-list`} role="dialog" aria-label="Receipts">
          {rows.length === 0 ? <div className="ldt-muted">No receipt attached. Photo or PDF, up to 25 MB.</div> : null}
          {rows.map((row) => (
            <div key={row.id} className="ldt-pop-row">
              {previews[row.id] ? <img src={previews[row.id]} alt="" className="ldt-thumb" /> : <span className="ldt-thumb ldt-thumb-doc">{/pdf/i.test(row.content_type) ? "PDF" : "FILE"}</span>}
              <button type="button" className="ldt-link" onClick={() => void openFile(row)}>{row.filename}</button>
              <span className="ldt-muted">{Math.round(Number(row.size_bytes || 0) / 1024)} KB</span>
              {!readOnly ? (
                <button type="button" className="ldt-att" onClick={async () => { try { await deleteAttachment(row.id, operatingCompanyId); await refresh(); } catch (e) { setError(userFacingApiError(e, "Could not remove.")); } }}>remove</button>
              ) : null}
            </div>
          ))}
          <button type="button" className="ldt-link" onClick={() => setOpen(false)}>close</button>
        </div>
      ) : null}
    </div>
  );
}
