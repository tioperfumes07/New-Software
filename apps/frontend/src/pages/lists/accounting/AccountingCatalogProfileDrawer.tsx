import type { AccountingCatalogRow } from "../../../api/catalogs-accounting";
import { Button } from "../../../components/Button";
import { ParityDrawer } from "../../../components/parity/ParityDrawer";

type Props = {
  open: boolean;
  displayName: string;
  codeLabel?: string;
  // PAYMENT-TERMS-CODE-NAME-COLUMN-COLLISION — see AccountingCatalogModal's own doc comment; hides
  // the redundant Name field when code and display_name are the same physical column.
  singleCodeNameField?: boolean;
  row: AccountingCatalogRow | null;
  canEdit: boolean;
  onClose: () => void;
  onEdit: () => void;
};

function formatTimestamp(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}

function formatMetadataValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "string" || typeof value === "number") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return "—";
  }
}

function metadataLabel(key: string) {
  return key
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

export function AccountingCatalogProfileDrawer({
  open,
  displayName,
  codeLabel = "Code",
  singleCodeNameField = false,
  row,
  canEdit,
  onClose,
  onEdit,
}: Props) {
  if (!row) return null;
  const metadataEntries = Object.entries(row.metadata ?? {});

  return (
    <ParityDrawer
      open={open}
      onClose={onClose}
      title={`${displayName} profile`}
      subtitle={row.display_name || row.code || "Catalog entry"}
      footer={
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Close
          </Button>
          {canEdit ? (
            <Button type="button" onClick={onEdit}>
              Edit
            </Button>
          ) : null}
        </div>
      }
    >
      <dl className="grid gap-3 text-xs sm:grid-cols-2">
        <div>
          <dt className="text-xs font-semibold text-slate-500">{codeLabel}</dt>
          <dd className="mt-1 break-words text-slate-900">{row.code || "—"}</dd>
        </div>
        {singleCodeNameField ? null : (
          <div>
            <dt className="text-xs font-semibold text-slate-500">Name</dt>
            <dd className="mt-1 break-words text-slate-900">{row.display_name || "—"}</dd>
          </div>
        )}
        <div className="sm:col-span-2">
          <dt className="text-xs font-semibold text-slate-500">Description</dt>
          <dd className="mt-1 whitespace-pre-wrap break-words text-slate-900">{row.description || "—"}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold text-slate-500">Status</dt>
          <dd className="mt-1 text-slate-900">{row.is_active ? "Active" : "Inactive"}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold text-slate-500">Sort order</dt>
          <dd className="mt-1 text-slate-900">{Number.isFinite(row.sort_order) ? row.sort_order : "—"}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold text-slate-500">Created</dt>
          <dd className="mt-1 text-slate-900">{formatTimestamp(row.created_at)}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold text-slate-500">Updated</dt>
          <dd className="mt-1 text-slate-900">{formatTimestamp(row.updated_at)}</dd>
        </div>
      </dl>

      <section className="mt-5 border-t border-slate-200 pt-4" aria-label="Metadata">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Metadata</h3>
        {metadataEntries.length ? (
          <dl className="mt-3 grid gap-3 text-xs sm:grid-cols-2">
            {metadataEntries.map(([key, value]) => (
              <div key={key}>
                <dt className="text-xs font-semibold text-slate-500">{metadataLabel(key)}</dt>
                <dd className="mt-1 break-words text-slate-900">{formatMetadataValue(value)}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="mt-2 text-xs text-slate-500">No metadata.</p>
        )}
      </section>
    </ParityDrawer>
  );
}
