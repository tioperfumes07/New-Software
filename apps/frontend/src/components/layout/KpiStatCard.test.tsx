// B3 BANK-KPI-CARDS (owner CONSOLIDATED 2026-09-06, item 6): KpiStatCard is "the same component
// Cursor uses on Factoring" — extracted out of pages/factoring/ReserveTracker.tsx's own local
// KpiCard so Banking's Accounts band and Factoring's Reserve Tracker render the literal same
// component. Locks the label/value/tone contract both pages depend on.
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { KpiStatCard } from "./KpiStatCard";

describe("KpiStatCard", () => {
  it("renders label + value with a title on the value for exact-amount assertions", () => {
    render(<KpiStatCard label="Cash posting" value="-$173,932.02" />);
    expect(screen.getByText("Cash posting")).toBeInTheDocument();
    expect(screen.getByTitle("-$173,932.02")).toBeInTheDocument();
  });

  it("renders as a clickable button when onClick is given", () => {
    const onClick = vi.fn();
    render(<KpiStatCard label="Uncategorized" value="12" onClick={onClick} />);
    screen.getByRole("button").click();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("renders as a Link when to is given", () => {
    render(
      <MemoryRouter>
        <KpiStatCard label="Factoring res" value="$0.00" to="/factoring/reserve-tracker" />
      </MemoryRouter>,
    );
    expect(screen.getByRole("link")).toHaveAttribute("href", "/factoring/reserve-tracker");
  });

  it("renders disabled with a reason and no interactive role", () => {
    render(<KpiStatCard label="Submitted" value="0" disabled disabledReason="not wired yet" />);
    const el = screen.getByText("Submitted").closest("[data-kpi-disabled]");
    expect(el).toHaveAttribute("aria-disabled", "true");
    expect(el).toHaveAttribute("title", "not wired yet");
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("attention tone applies the slate tint Banking uses for virtual/needs-review tiles", () => {
    render(<KpiStatCard label="Escrow feed" value="$0.00" tone="attention" onClick={() => {}} />);
    expect(screen.getByRole("button").className).toMatch(/border-slate-300/);
    expect(screen.getByRole("button").className).toMatch(/bg-slate-100/);
  });
});
