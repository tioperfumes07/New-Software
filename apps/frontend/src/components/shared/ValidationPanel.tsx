// GAP-14: Reusable ValidationPanel — used by pre-dispatch, pre-settlement (GAP-15), pre-accounting (GAP-16).
// P0 2026-09-03: blockers render as a table with an Override column (one button per row).

import { useMemo, useState } from "react";

export type ValidationSeverity = "block" | "warn" | "info";

export type ValidationItem = {
  rule_id: string;
  severity: ValidationSeverity;
  message: string;
  evidence: Record<string, unknown>;
};

export type ValidationResult = {
  blockers: ValidationItem[];
  warnings: ValidationItem[];
  info: ValidationItem[];
  can_dispatch: boolean;
};

export type BlockOverrideRecord = {
  reason: string;
  at: string;
};

type Props = {
  result: ValidationResult;
  loading?: boolean;
  acknowledgedRules?: Set<string>;
  onAck?: (ruleId: string) => void;
  /** Owner P0 — one Override control per blocker row. */
  allowBlockOverride?: boolean;
  canOwnerOverride?: boolean;
  blockOverrides?: Record<string, BlockOverrideRecord>;
  rowReasons?: Record<string, string>;
  onRowReasonChange?: (ruleId: string, reason: string) => void;
  onOverrideBlocker?: (ruleId: string) => void;
};

const SEVERITY_STYLES: Record<ValidationSeverity, { bg: string; border: string; icon: string; iconBg: string; label: string }> = {
  block: {
    bg: "bg-red-50",
    border: "border-red-300",
    icon: "✕",
    iconBg: "bg-red-600",
    label: "Block",
  },
  warn: {
    bg: "bg-amber-50",
    border: "border-amber-300",
    icon: "!",
    iconBg: "bg-amber-500",
    label: "Warning",
  },
  info: {
    bg: "bg-slate-100",
    border: "border-slate-300",
    icon: "i",
    iconBg: "bg-slate-500",
    label: "Info",
  },
};

function ruleCodeLabel(item: ValidationItem): string {
  return `${item.rule_id}`;
}

function subjectFromItem(item: ValidationItem): string {
  const ev = item.evidence ?? {};
  if (typeof ev.driver_name === "string" && ev.driver_name.trim()) return ev.driver_name;
  const msg = item.message;
  const colon = msg.indexOf(":");
  if (colon > 0 && colon < 80) return msg.slice(0, colon).trim();
  return "—";
}

function missingFromItem(item: ValidationItem): string {
  const colon = item.message.indexOf(":");
  if (colon > 0) return item.message.slice(colon + 1).trim();
  return item.message;
}

function ValidationRow({
  item,
  acknowledged,
  onAck,
}: {
  item: ValidationItem;
  acknowledged: boolean;
  onAck?: (ruleId: string) => void;
}) {
  const styles = SEVERITY_STYLES[item.severity];

  return (
    <div
      className={`flex items-start gap-2.5 rounded-sm border px-3 py-2 text-xs ${styles.bg} ${styles.border} ${acknowledged ? "opacity-60" : ""}`}
    >
      <span
        className={`mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white ${styles.iconBg}`}
      >
        {acknowledged ? "✓" : styles.icon}
      </span>
      <span className="flex-1 leading-snug">
        <span className="mr-1 font-mono text-xs text-gray-400">[{item.rule_id}]</span>
        {item.message}
      </span>
      {item.severity === "warn" && onAck && !acknowledged && (
        <button
          type="button"
          onClick={() => onAck(item.rule_id)}
          className="ml-1 shrink-0 rounded-sm border border-amber-400 bg-white px-1.5 py-0.5 text-xs font-semibold text-amber-700 hover:bg-amber-50"
        >
          {item.evidence?.confirmation_required ? "Confirm" : "Ack"}
        </button>
      )}
    </div>
  );
}

export function ValidationPanel({
  result,
  loading,
  acknowledgedRules,
  onAck,
  allowBlockOverride = false,
  canOwnerOverride = false,
  blockOverrides = {},
  rowReasons = {},
  onRowReasonChange,
  onOverrideBlocker,
}: Props) {
  const [sortKey, setSortKey] = useState<"rule" | "subject" | "missing">("rule");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const sortedBlockers = useMemo(() => {
    const rows = result.blockers.map((item) => ({
      item,
      rule: item.rule_id,
      subject: subjectFromItem(item),
      missing: missingFromItem(item),
    }));
    const dir = sortDir === "asc" ? 1 : -1;
    rows.sort((a, b) => a[sortKey].localeCompare(b[sortKey]) * dir);
    return rows.map((r) => r.item);
  }, [result.blockers, sortDir, sortKey]);

  function toggleSort(key: "rule" | "subject" | "missing") {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-sm border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-500">
        <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        Running pre-dispatch checks…
      </div>
    );
  }

  const allItems = [...result.blockers, ...result.warnings, ...result.info];

  if (allItems.length === 0) {
    if (!result.can_dispatch) {
      return (
        <div
          className="rounded-sm border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600"
          data-testid="pre-dispatch-checks-incomplete"
        >
          Checks have not passed yet.
        </div>
      );
    }
    return (
      <div className="flex items-center gap-2 rounded-sm border border-green-300 bg-green-50 px-3 py-2 text-xs text-green-800">
        <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-green-600 text-xs font-bold text-white">✓</span>
        All pre-dispatch checks pass. Ready to book.
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      {allowBlockOverride && result.blockers.length > 0 ? (
        <div className="overflow-x-auto" data-testid="pre-dispatch-blocker-override-table">
          <table className="w-full border-collapse text-xs">
            {/* TABLE-HEADER-RETIRE-NAVY LAW (owner ruling 2026-09-04, verbatim: "the blue is too
               * aggressive") -- navy #14314F/white left table headers for good. This thead used to
               * hardcode navy on the <tr> itself, which sits on top of the global `thead { !important }`
               * light-gray rule (index.css GLB-02) since that rule targets the <thead> element's own
               * background, not a child <tr>'s explicit background -- a real loophole the design-system
               * ratchet guard never checked for. Removed the override; the locked #eef2f6/#1f2937 11px
               * token now applies here exactly like every other table header in the app. */}
            <thead data-table-header="locked">
              <tr className="h-[26px] tracking-[0.5px]">
                <th className="border-r border-gray-300 px-2 text-center">
                  <button type="button" className="w-full font-bold uppercase" onClick={() => toggleSort("rule")}>
                    Rule code
                  </button>
                </th>
                <th className="border-r border-gray-300 px-2 text-center">
                  <button type="button" className="w-full font-bold uppercase" onClick={() => toggleSort("subject")}>
                    Subject
                  </button>
                </th>
                <th className="border-r border-gray-300 px-2 text-center">
                  <button type="button" className="w-full font-bold uppercase" onClick={() => toggleSort("missing")}>
                    What is missing
                  </button>
                </th>
                <th className="px-2 text-center">Override</th>
              </tr>
            </thead>
            <tbody>
              {sortedBlockers.map((item) => {
                const rec = blockOverrides[item.rule_id];
                const reason = rowReasons[item.rule_id] ?? "";
                return (
                  <tr key={item.rule_id} className="h-[30px] border-b border-gray-200 even:bg-slate-50">
                    <td className="border-r border-gray-200 px-2 font-mono">{ruleCodeLabel(item)}</td>
                    <td className="border-r border-gray-200 px-2">{subjectFromItem(item)}</td>
                    <td className="border-r border-gray-200 px-2">{missingFromItem(item)}</td>
                    <td className="px-2 py-1">
                      {rec ? (
                        <span data-testid={`blocker-overridden-${item.rule_id}`}>
                          Overridden {new Date(rec.at).toLocaleString()} — {rec.reason.slice(0, 48)}
                          {rec.reason.length > 48 ? "…" : ""}
                        </span>
                      ) : canOwnerOverride ? (
                        <div className="flex min-w-[14rem] flex-col gap-1">
                          <input
                            data-testid={`blocker-override-reason-${item.rule_id}`}
                            value={reason}
                            onChange={(e) => onRowReasonChange?.(item.rule_id, e.target.value)}
                            placeholder="Reason (min 10 chars)"
                            className="h-7 w-full rounded-sm border border-red-300 px-1 text-xs"
                          />
                          <button
                            type="button"
                            data-testid={`blocker-override-${item.rule_id}`}
                            disabled={reason.trim().length < 10 || !onOverrideBlocker}
                            onClick={() => onOverrideBlocker?.(item.rule_id)}
                            className="rounded-sm border border-red-300 bg-white px-2 py-1 text-xs font-semibold text-red-800 disabled:opacity-40 hover:bg-red-100"
                          >
                            Override
                          </button>
                        </div>
                      ) : (
                        <span className="text-red-600">Owner only</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        result.blockers.map((item) => (
          <ValidationRow
            key={item.rule_id}
            item={item}
            acknowledged={acknowledgedRules?.has(item.rule_id) ?? false}
            onAck={onAck}
          />
        ))
      )}
      {result.warnings.map((item) => (
        <ValidationRow
          key={item.rule_id}
          item={item}
          acknowledged={acknowledgedRules?.has(item.rule_id) ?? false}
          onAck={onAck}
        />
      ))}
      {result.info.map((item) => (
        <ValidationRow
          key={item.rule_id}
          item={item}
          acknowledged={acknowledgedRules?.has(item.rule_id) ?? false}
          onAck={onAck}
        />
      ))}
    </div>
  );
}
