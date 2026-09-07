import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ReceiptAttach } from "./ReceiptAttach";

const listAttachments = vi.fn();
const createAttachmentUploadUrl = vi.fn();
const finalizeAttachment = vi.fn();
const getAttachmentDownloadUrl = vi.fn();
vi.mock("../../api/attachments", async () => {
  const actual = await vi.importActual<typeof import("../../api/attachments")>("../../api/attachments");
  return {
    ...actual,
    listAttachments: (...a: unknown[]) => listAttachments(...a),
    createAttachmentUploadUrl: (...a: unknown[]) => createAttachmentUploadUrl(...a),
    finalizeAttachment: (...a: unknown[]) => finalizeAttachment(...a),
    getAttachmentDownloadUrl: (...a: unknown[]) => getAttachmentDownloadUrl(...a),
    deleteAttachment: vi.fn(),
  };
});

// LDT-1: the receipt control every expense/bill creator mounts. It talks to documents.attachments through the
// existing presign → PUT → finalize path with entity_type expense|bill and category 'receipt'.
describe("ReceiptAttach", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listAttachments.mockResolvedValue({ rows: [] });
  });

  it("renders the photo/PDF capture input, attach-only when there is no receipt, and lists what is on file", async () => {
    listAttachments.mockResolvedValueOnce({ rows: [{ id: "a1", entity_type: "expense", entity_id: "e1", category: "receipt", filename: "loves-99264345.jpg", content_type: "image/jpeg", size_bytes: 204800, uploaded_at: "2026-09-06T00:00:00Z" }] });
    render(<ReceiptAttach operatingCompanyId="5c854333-6ea5-4faa-af31-67cb272fef80" entityType="expense" entityId="e1" testId="r" />);
    expect(screen.getByTestId("r-input")).toHaveAttribute("accept", "image/*,application/pdf");
    expect(screen.getByTestId("r-input")).toHaveAttribute("capture", "environment");
    await waitFor(() => expect(screen.getByTestId("r-count")).toHaveTextContent("1 receipt"));
    fireEvent.click(screen.getByTestId("r-count"));
    expect(screen.getByTestId("r-list")).toHaveTextContent("loves-99264345.jpg");
    expect(screen.getByTestId("r")).toHaveAttribute("data-receipt-count", "1");
  });

  it("uploads through presign → PUT → finalize with entity_type + category 'receipt', then refreshes the count", async () => {
    createAttachmentUploadUrl.mockResolvedValue({ attachment_id: "att-1", upload_url: "https://r2.example/put", expires_in_seconds: 900, r2_object_key: "k" });
    finalizeAttachment.mockResolvedValue({ id: "att-1", deduped: false });
    const xhr: { open: () => void; setRequestHeader: () => void; send: () => void; upload: Record<string, unknown>; status: number; onload?: () => void } = {
      open: vi.fn(), setRequestHeader: vi.fn(), upload: {}, status: 0,
      send: () => { xhr.status = 200; xhr.onload?.(); },
    };
    vi.stubGlobal("XMLHttpRequest", function XMLHttpRequestStub() { return xhr; });
    if (!File.prototype.arrayBuffer) Object.defineProperty(File.prototype, "arrayBuffer", { value: function () { return Promise.resolve(new Uint8Array([1, 2, 3]).buffer); } });
    vi.stubGlobal("crypto", { ...globalThis.crypto, subtle: { digest: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]).buffer) } });
    listAttachments.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ id: "att-1", entity_type: "bill", entity_id: "draft-1", category: "receipt", filename: "invoice.pdf", content_type: "application/pdf", size_bytes: 1000, uploaded_at: "2026-09-06T00:00:00Z" }] });
    const onCountChange = vi.fn();
    render(<ReceiptAttach operatingCompanyId="5c854333-6ea5-4faa-af31-67cb272fef80" entityType="bill" entityId="draft-1" testId="r" onCountChange={onCountChange} />);
    // REG-PARSE (owner 2026-09-06): no receipt → only "+ attach" renders, no "no receipt" pill.
    await waitFor(() => expect(screen.getByTestId("r-add")).toHaveTextContent("+ attach"));
    expect(screen.queryByTestId("r-count")).toBeNull();
    const file = new File([new Uint8Array([1, 2, 3])], "invoice.pdf", { type: "application/pdf" });
    fireEvent.change(screen.getByTestId("r-input"), { target: { files: [file] } });
    await waitFor(() => { const err = screen.queryByTestId("r-error"); if (err) throw new Error("component error: " + err.textContent); expect(finalizeAttachment).toHaveBeenCalledTimes(1); });
    expect(createAttachmentUploadUrl).toHaveBeenCalledWith(expect.objectContaining({ entity_type: "bill", entity_id: "draft-1", filename: "invoice.pdf", content_type: "application/pdf" }));
    expect(finalizeAttachment).toHaveBeenCalledWith("att-1", expect.objectContaining({ entity_type: "bill", entity_id: "draft-1", category: "receipt", sha256_hash: "010203" }));
    await waitFor(() => expect(screen.getByTestId("r-count")).toHaveTextContent("1 receipt"));
    expect(onCountChange).toHaveBeenLastCalledWith(1);
    vi.unstubAllGlobals();
  });

  it("read-only mode lists and opens but never offers add/remove", async () => {
    listAttachments.mockResolvedValueOnce({ rows: [{ id: "a1", entity_type: "expense", entity_id: "e1", category: "receipt", filename: "x.jpg", content_type: "image/jpeg", size_bytes: 10, uploaded_at: "" }] });
    render(<ReceiptAttach operatingCompanyId="c" entityType="expense" entityId="e1" readOnly testId="r" />);
    await waitFor(() => expect(screen.getByTestId("r-count")).toHaveTextContent("1 receipt"));
    expect(screen.queryByTestId("r-add")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("r-count"));
    expect(screen.getByTestId("r-list")).not.toHaveTextContent("remove");
  });
});
