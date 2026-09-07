import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ParityTable, type ParityColumn } from "./ParityTable";

// LDT-EXPAND (owner 2026-09-06 03:5xZ "I DO NOT SEE THE APP LIKE THE PICTURES … THE BOXES"): the only expand
// target on the Load costs board was the 6px "▸" glyph. A click on the row must open the panel.
type Row = { id: string; name: string };
const columns: Array<ParityColumn<Row>> = [{ key: "name", label: "Name", render: (r) => r.name }];
const rows: Row[] = [{ id: "a", name: "Alpha" }, { id: "b", name: "Bravo" }];

describe("ParityTable expandOnRowClick", () => {
  it("clicking anywhere on the row opens the expanded panel; the caret has the B1 EXPAND-BOX hit target", () => {
    render(<ParityTable<Row> columns={columns} rows={rows} rowKey={(r) => r.id} expandMode="single" expandOnRowClick renderExpanded={(r) => <div data-testid={`panel-${r.id}`}>panel {r.name}</div>} />);
    expect(screen.queryByTestId("panel-a")).toBeNull();
    fireEvent.click(screen.getByText("Alpha"));
    expect(screen.getByTestId("panel-a")).toHaveTextContent("panel Alpha");
    fireEvent.click(screen.getByText("Bravo"));
    expect(screen.queryByTestId("panel-a")).toBeNull(); // single mode
    expect(screen.getByTestId("panel-b")).toBeInTheDocument();
    // B1 EXPAND-BOX (owner CONSOLIDATED 2026-09-06, item 4): 24x24/no-border was too small next to
    // the rest of the register chrome; the box is now 28x28 with a real border (.parity-expand-toggle-box
    // in tokens-load-detail.css), aria-expanded still reflects open/closed state.
    for (const b of screen.getAllByTestId("parity-expand-toggle")) {
      expect(b.className).toMatch(/parity-expand-toggle-box/);
      expect(b).toHaveAttribute("aria-expanded");
    }
  });
  it("without expandOnRowClick a row click does nothing (legacy behavior preserved)", () => {
    render(<ParityTable<Row> columns={columns} rows={rows} rowKey={(r) => r.id} renderExpanded={(r) => <div data-testid={`panel-${r.id}`}>x</div>} />);
    fireEvent.click(screen.getByText("Alpha"));
    expect(screen.queryByTestId("panel-a")).toBeNull();
  });
});
