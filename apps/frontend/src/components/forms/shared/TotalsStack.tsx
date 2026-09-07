type Props = {
  subtotal: number;
  taxRate?: number;
  grandLabel: string;
  taxRateMode?: "editable" | "readonly";
  onTaxRateChange?: (next: number) => void;
  /**
   * When true (Vendor Bill / display-only tax): grand total equals line subtotal.
   * Tax % row still shows for operator awareness but does NOT inflate the amount that posts.
   */
  taxDisplayOnly?: boolean;
};

export function TotalsStack({
  subtotal,
  taxRate = 8.25,
  grandLabel,
  taxRateMode = "editable",
  onTaxRateChange,
  taxDisplayOnly = false,
}: Props) {
  const taxAmount = (subtotal * taxRate) / 100;
  const total = taxDisplayOnly ? subtotal : subtotal + taxAmount;
  const readonly = taxRateMode === "readonly";

  return (
    <div className="totals-stack overflow-hidden rounded-sm border border-gray-300 bg-white text-xs" data-testid="totals-stack">
      <div className="totals-row flex items-center justify-end gap-6 px-[18px] py-[7px]">
        <span className="font-semibold text-slate-600">Subtotal</span>
        <span className="font-semibold text-slate-900">${subtotal.toFixed(2)}</span>
      </div>
      <div className="totals-row flex items-center justify-end gap-6 border-t border-gray-200 px-[18px] py-[7px]">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-slate-600">{taxDisplayOnly ? "Tax % (display only)" : "Tax %"}</span>
          <input
            className="tax-input w-[60px] rounded-sm border border-gray-300 px-[6px] py-[3px] text-right"
            type="number"
            step="0.01"
            value={taxRate}
            readOnly={readonly}
            onChange={(event) => onTaxRateChange?.(Number(event.target.value || 0))}
            aria-label={taxDisplayOnly ? "Tax percent display only" : "Tax percent"}
          />
        </div>
        <span className="font-semibold text-slate-900" data-testid="totals-stack-tax-amount">
          ${taxAmount.toFixed(2)}
        </span>
      </div>
      <div className="totals-row grand flex items-center justify-end gap-6 bg-[#14314F] px-[18px] py-3 text-white">
        <span className="font-semibold">{grandLabel}</span>
        <span className="text-xs font-semibold" data-testid="totals-stack-grand-amount">
          ${total.toFixed(2)}
        </span>
      </div>
    </div>
  );
}
