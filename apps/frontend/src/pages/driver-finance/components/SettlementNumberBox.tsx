import { useState } from "react";
import { patchSettlementDisplayId } from "../../../api/driverFinance";
import { useToast } from "../../../components/Toast";

/**
 * SETL-DETAIL-01 (lead ROUND 14) — the reference's NUMBER box: empty by default (shows the
 * auto-assigned number), editable while OPEN, typed value wins. Mirrors LoadDetailCostsTab.tsx's
 * own "typed wins verbatim" NUMBER convention for its register rows, applied here to the
 * settlement's own display_id via the real PATCH /settlements/:id/display-id route.
 */
export function SettlementNumberBox({
  settlementId,
  companyId,
  displayId,
  isOpen,
  onSaved,
}: {
  settlementId: string;
  companyId: string;
  displayId: string | null;
  isOpen: boolean;
  onSaved: (newDisplayId: string) => void;
}) {
  const { pushToast } = useToast();
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    const typed = value.trim();
    if (!typed) return;
    setSaving(true);
    try {
      const res = await patchSettlementDisplayId(settlementId, companyId, typed);
      onSaved(res.display_id);
      setValue("");
      pushToast(`Settlement number set to ${res.display_id}`, "success");
    } catch (err) {
      pushToast(err instanceof Error ? err.message : "Could not set the settlement number", "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div data-testid="settlement-number-box">
      <div className="text-[11px] uppercase text-gray-500">Number</div>
      {isOpen ? (
        <div className="flex items-center gap-1">
          <input
            className="ldt-inp"
            style={{ width: 110 }}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={displayId ?? "auto"}
            data-testid="settlement-number-box-input"
            title="Typed value wins — blank keeps the auto-assigned number"
          />
          <button type="button" className="ldt-btn g" disabled={saving || !value.trim()} onClick={() => void handleSave()} data-testid="settlement-number-box-save">
            {saving ? "…" : "Save"}
          </button>
        </div>
      ) : (
        <div className="text-xs font-semibold" data-testid="settlement-number-box-frozen">
          {displayId ?? "—"}
        </div>
      )}
    </div>
  );
}
