import { useEffect, useState } from "react";
import { colors } from "../../design/tokens";
import type { SamsaraVisualStatus } from "../../lib/integration-telematics-status";
import { StatusBarMobile } from "./StatusBarMobile";

export type QboSyncPill = {
  dot: "gray" | "green" | "yellow" | "red";
  label: string;
  status: string;
  needsReconnect: boolean;
  reconnectReason: string | null;
  lastSuccessLabel: string;
};

export type TopStatusBarProps = {
  qboAvailable?: boolean;
  qboVis: { label: string; dot: "gray" | "green" | "yellow" };
  samsaraVis: SamsaraVisualStatus;
  relayVis: SamsaraVisualStatus;
  qboSyncPill: QboSyncPill | null;
  onOpenQboSyncDashboard: () => void;
  onReconnectQbo: () => void;
  onSyncNow: () => void;
  syncNowPending: boolean;
  /** Icon-only mode at/below this viewport width. AF-15: 1366 (tablet + laptop). */
  compactMaxWidth?: number;
};

function useMaxWidth(maxWidthPx: number): boolean {
  const query = `(max-width: ${maxWidthPx}px)`;
  const [matches, setMatches] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia(query).matches : false
  );

  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setMatches(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}

function topbarDotClass(dot: "gray" | "green" | "yellow" | "red"): string {
  if (dot === "green") return "bg-emerald-500";
  if (dot === "yellow") return "bg-amber-400";
  if (dot === "red") return "bg-red-500";
  return "bg-slate-500";
}

export function TopStatusBar({
  qboAvailable = true,
  qboVis,
  samsaraVis,
  relayVis,
  qboSyncPill,
  onOpenQboSyncDashboard,
  onReconnectQbo,
  onSyncNow,
  syncNowPending,
  compactMaxWidth = 1366,
}: TopStatusBarProps) {
  const compact = useMaxWidth(compactMaxWidth);
  const muted = colors.sidebarTextMuted;
  const active = colors.sidebarTextActive;

  if (compact) {
    return (
      <StatusBarMobile
        qboAvailable={qboAvailable}
        qboVis={qboVis}
        samsaraVis={samsaraVis}
        relayVis={relayVis}
        qboSyncPill={qboSyncPill}
        onOpenQboSyncDashboard={onOpenQboSyncDashboard}
        onReconnectQbo={onReconnectQbo}
        onSyncNow={onSyncNow}
        syncNowPending={syncNowPending}
      />
    );
  }

  return (
    <div
      // CUR-3 (row 51): the top status bar must render at the spec/PDF top-bar height of 26px
      // (DISPATCH-BOARD-PREVIEW-2026-09-05.pdf). py-1 + 12px/leading-snug computes to ~24.5px, ~1.5px
      // under spec after the GLB sweeps; the min-height token below restores it. Body type stays
      // text-xs = 12px (GLOBAL-TYPE-SIZE-BASELINE), palette unchanged.
      className="flex min-h-[26px] max-w-[min(760px,94vw)] flex-nowrap items-center justify-center gap-x-2 rounded-full px-2 py-1 text-xs leading-snug"
      style={{ backgroundColor: "#151A24", color: muted }}
      data-status-bar-desktop
    >
      {qboAvailable ? <span className="inline-flex items-center gap-1 whitespace-nowrap" style={{ color: active }}>
        <span className={`inline-block h-2 w-2 rounded-full ${topbarDotClass(qboVis.dot)}`} />
        {qboVis.label}
      </span> : null}
      {qboAvailable ? <span style={{ color: muted }}>·</span> : null}
      <span className="inline-flex items-center gap-1 whitespace-nowrap" style={{ color: active }} title={samsaraVis.title}>
        <span className={`inline-block h-2 w-2 rounded-full ${topbarDotClass(samsaraVis.dot)}`} />
        {samsaraVis.label}
      </span>
      <span style={{ color: muted }}>·</span>
      <span className="inline-flex items-center gap-1 whitespace-nowrap" style={{ color: active }} title={relayVis.title}>
        <span className={`inline-block h-2 w-2 rounded-full ${topbarDotClass(relayVis.dot)}`} />
        {relayVis.label}
      </span>
      {qboAvailable && qboSyncPill ? (
        <>
          <span style={{ color: muted }}>·</span>
          <button
            type="button"
            className="inline-flex cursor-pointer items-center gap-1 whitespace-nowrap underline-offset-2 hover:underline"
            style={{ color: active }}
            title="Open QBO sync dashboard"
            onClick={onOpenQboSyncDashboard}
          >
            <span className={`inline-block h-2 w-2 rounded-full ${topbarDotClass(qboSyncPill.dot)}`} />
            {qboSyncPill.label}
          </button>
          <span
            className="whitespace-nowrap text-[11px]"
            style={{ color: muted }}
            data-testid="qbo-sync-last-success"
            title={qboSyncPill.lastSuccessLabel}
          >
            {qboSyncPill.lastSuccessLabel}
          </span>
          {qboSyncPill.needsReconnect ? (
            <button
              type="button"
              className="ml-1 rounded-full border border-amber-400/60 px-2 py-0.5 text-[11px] font-semibold text-amber-100 hover:bg-amber-400/10"
              onClick={onReconnectQbo}
            >
              Reconnect QuickBooks
            </button>
          ) : (
            <button
              type="button"
              className="ml-1 rounded-full border border-slate-400/70 px-2 py-0.5 text-[11px] font-semibold text-slate-100 hover:bg-slate-400/10 disabled:cursor-not-allowed disabled:opacity-60"
              data-testid="qbo-sync-now-button"
              disabled={syncNowPending || qboSyncPill.status === "syncing"}
              onClick={onSyncNow}
            >
              {syncNowPending || qboSyncPill.status === "syncing" ? "Syncing…" : "Sync now"}
            </button>
          )}
        </>
      ) : null}
    </div>
  );
}
