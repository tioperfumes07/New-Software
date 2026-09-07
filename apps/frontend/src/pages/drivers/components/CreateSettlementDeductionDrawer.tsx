import { useMemo, useState } from "react";
import { ParityDrawer } from "../../../components/parity/ParityDrawer";
import { Button } from "../../../components/Button";
import { EntityPicker } from "../../../components/EntityPicker";
import { MoneyInput } from "../../../components/forms/MoneyInput";
import { SelectCombobox } from "../../../components/Combobox";
import { ReceiptAttach } from "../../../components/documents/ReceiptAttach";
import { createSettlementDeduction, type CreateSettlementDeductionTypedType } from "../../../api/driverFinance";
import { userFacingApiError } from "../../../lib/api-error-message";
import { EntityLink } from "../../../components/shared/EntityLink";

/**
 * SETL-DED-UI (owner item, deadline 05:30Z) — "the deduction creator you say does not exist —
 * build it." Type select LIMITED to the four typed, GL-bound kinds SETL-DED-GL introduced —
 * no "other" (that generic bucket is retired going forward; the backend's own
 * createDeductionBodySchema rejects anything else). Posts through the REAL, existing
 * driver_finance/deductions.service.ts writer via a new thin POST route — never a raw INSERT.
 */

const TYPE_OPTIONS: { value: CreateSettlementDeductionTypedType; label: string }[] = [
  { value: "wire_fee", label: "Wire fee (recovers a company wire fee)" },
  { value: "ach_fee", label: "ACH fee (recovers a company ACH fee)" },
  { value: "company_vehicle_fuel", label: "Company vehicle fuel (recovers company-paid fuel)" },
  { value: "escrow_contribution", label: "Escrow contribution (adds to the driver's own escrow)" },
];

type Props = {
  open: boolean;
  operatingCompanyId: string;
  onClose: () => void;
  onCreated: () => void;
  // SET-01 — opened FROM a settlement's own detail page (never a picker there: this deduction is
  // for the settlement you're already looking at, not a new one to go find). When set, the driver
  // step is a fixed read-only label instead of the EntityPicker below.
  presetDriverId?: string | null;
  presetDriverName?: string | null;
};

export function CreateSettlementDeductionDrawer({ open, operatingCompanyId, onClose, onCreated, presetDriverId, presetDriverName }: Props) {
  const [driverId, setDriverId] = useState<string | null>(presetDriverId ?? null);
  const [deductionType, setDeductionType] = useState<CreateSettlementDeductionTypedType | "">("");
  const [amountUsd, setAmountUsd] = useState<number | null>(null);
  const [loadId, setLoadId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ReceiptAttach's own doc comment: on a CREATE form entityId is a draft uuid the create payload
  // carries as attachment_draft_id, and the backend re-links the rows to the real record on submit
  // (reassignDraftAttachments) — the SAME pattern expenses/bills/invoices already use.
  const draftId = useMemo(() => crypto.randomUUID(), []);
  const [attachmentCount, setAttachmentCount] = useState(0);

  const reset = () => {
    setDriverId(presetDriverId ?? null);
    setDeductionType("");
    setAmountUsd(null);
    setLoadId(null);
    setReason("");
    setError(null);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const amountCents = Math.round(Number(amountUsd ?? 0) * 100);
  const reasonTooShort = reason.trim().length < 10;
  const submitDisabled = submitting || !driverId || !deductionType || amountCents <= 0 || reasonTooShort;

  const submit = async () => {
    if (!driverId || !deductionType) return;
    setSubmitting(true);
    setError(null);
    try {
      await createSettlementDeduction({
        operating_company_id: operatingCompanyId,
        driver_id: driverId,
        deduction_type: deductionType,
        amount_cents: amountCents,
        reason: reason.trim(),
        load_id: loadId ?? undefined,
        attachment_draft_id: attachmentCount > 0 ? draftId : undefined,
      });
      reset();
      onCreated();
      onClose();
    } catch (e) {
      setError(userFacingApiError(e, "Could not create the deduction."));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ParityDrawer open={open} onClose={handleClose} title="+ Add deduction">
      <div className="space-y-3 text-xs text-gray-700" data-testid="create-settlement-deduction-drawer">
        <label className="block text-xs">
          <span className="text-slate-600">Driver *</span>
          {presetDriverId ? (
            <div className="mt-1 rounded-sm border border-gray-200 bg-gray-50 px-2 py-1.5" data-testid="create-settlement-deduction-driver-preset">
              <EntityLink kind="driver" id={presetDriverId} label={presetDriverName ?? presetDriverId} />{" "}
              <span className="text-slate-500">— this settlement's driver</span>
            </div>
          ) : (
            <EntityPicker
              kind="driver"
              operatingCompanyId={operatingCompanyId}
              value={driverId}
              onChange={(id) => setDriverId(id)}
              allowCreate={false}
              placeholder="Select a driver…"
              className="mt-1"
              dataTestId="create-settlement-deduction-driver"
            />
          )}
        </label>

        <label className="block text-xs">
          <span className="text-slate-600">Type *</span>
          <div className="mt-1" data-testid="create-settlement-deduction-type">
            <SelectCombobox
              className="h-9 w-full rounded-sm border border-gray-300 px-2 text-xs"
              value={deductionType}
              onChange={(e) => setDeductionType(e.target.value as CreateSettlementDeductionTypedType | "")}
            >
              <option value="">Select a type…</option>
              {TYPE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </SelectCombobox>
          </div>
        </label>

        <label className="block text-xs">
          <span className="text-slate-600">Amount *</span>
          <div data-testid="create-settlement-deduction-amount">
            <MoneyInput
              valueDollars={amountUsd}
              onChangeDollars={setAmountUsd}
              className="mt-1 h-9 w-full rounded-sm border border-gray-300 px-2"
              ariaLabel="Deduction amount"
            />
          </div>
        </label>

        <label className="block text-xs">
          <span className="text-slate-600">Load (optional)</span>
          <EntityPicker
            kind="load"
            operatingCompanyId={operatingCompanyId}
            value={loadId}
            onChange={(id) => setLoadId(id)}
            allowCreate={false}
            allowClear
            placeholder="Link to a load…"
            className="mt-1"
            dataTestId="create-settlement-deduction-load"
          />
        </label>

        <label className="block text-xs">
          <span className="text-slate-600">Reason *</span>
          <textarea
            className="mt-1 w-full rounded-sm border border-gray-300 px-2 py-1.5"
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why this deduction — at least 10 characters (cited source, if any)"
            data-testid="create-settlement-deduction-reason"
          />
          {reason.length > 0 && reasonTooShort ? (
            <span className="mt-1 block text-xs text-red-600">Reason needs at least 10 characters.</span>
          ) : null}
        </label>

        <label className="block text-xs">
          <span className="text-slate-600">Source doc (optional)</span>
          <div className="mt-1">
            <ReceiptAttach
              operatingCompanyId={operatingCompanyId}
              entityType="manual"
              entityId={draftId}
              testId="create-settlement-deduction-source-doc"
              onCountChange={setAttachmentCount}
            />
          </div>
        </label>

        {error ? (
          <p className="text-xs text-red-700" data-testid="create-settlement-deduction-error">
            {error}
          </p>
        ) : null}

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={handleClose} disabled={submitting}>
            Cancel
          </Button>
          <Button data-testid="create-settlement-deduction-submit" loading={submitting} disabled={submitDisabled} onClick={() => void submit()}>
            Create deduction
          </Button>
        </div>
      </div>
    </ParityDrawer>
  );
}
