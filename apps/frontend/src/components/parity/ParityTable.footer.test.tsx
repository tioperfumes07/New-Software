import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ParityTable, type ParityColumn } from "./ParityTable";

// DSP-TBL (owner ruling 2026-09-05) — footerCells must be rendered from the SAME ordered
// visible-column list the header <th> loop iterates, so a footer cell can never drift from its
// header after a drag-reorder or a hide. These tests render the real component (not a mock) and
// assert on the actual DOM order/presence, mirroring scripts/verify-driver-pwa-vitest.mjs's
// pattern of a guard spawning a real vitest run for behavior that isn't statically provable.

type Row = { id: string; name: string; amount: string };

const columns: Array<ParityColumn<Row>> = [
  { key: "name", label: "Name", testId: "name" },
  { key: "amount", label: "Amount", testId: "amount", className: "text-right" },
];

const rows: Row[] = [
  { id: "1", name: "Alpha", amount: "$10" },
  { id: "2", name: "Bravo", amount: "$20" },
];

/** Header <th> keys, left→right, via each column's data-testid (no suffix). */
function headerOrder(): string[] {
  return [...document.querySelectorAll('thead th[data-testid]')].map((el) => el.getAttribute("data-testid") ?? "");
}

/** Footer <td> keys, left→right, via each column's data-testid (the "-footer" suffix stripped). */
function footerOrder(): string[] {
  return [...document.querySelectorAll('[data-testid="parity-table-footer"] td[data-testid]')].map((el) =>
    (el.getAttribute("data-testid") ?? "").replace(/-footer$/, ""),
  );
}

describe("ParityTable footerCells follows the columns (DSP-TBL)", () => {
  it("footer cell order matches header order on initial render", () => {
    render(
      <ParityTable<Row>
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        footerCells={{ name: "Totals", amount: "$30" }}
      />,
    );
    expect(headerOrder()).toEqual(["name", "amount"]);
    expect(footerOrder()).toEqual(headerOrder());
    expect(screen.getByTestId("amount-footer")).toHaveTextContent("$30");
  });

  it("dragging a header to reorder columns reorders the footer cells identically", () => {
    window.localStorage.clear();
    render(
      <ParityTable<Row>
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        storageKey="test-footer-reorder"
        footerCells={{ name: "Totals", amount: "$30" }}
      />,
    );
    expect(headerOrder()).toEqual(["name", "amount"]);
    expect(footerOrder()).toEqual(["name", "amount"]);

    const nameHeader = screen.getByTestId("name");
    const amountHeader = screen.getByTestId("amount");
    fireEvent.dragStart(nameHeader);
    fireEvent.dragOver(amountHeader);
    fireEvent.drop(amountHeader);
    fireEvent.dragEnd(nameHeader);

    // The header actually reordered (sanity on the drag itself)...
    expect(headerOrder()).toEqual(["amount", "name"]);
    // ...and the footer, built from the same visibleColumns list, tracked it automatically.
    expect(footerOrder()).toEqual(["amount", "name"]);
    window.localStorage.clear();
  });

  it("hiding a column via the gear removes its footer cell (not just its header)", () => {
    render(
      <ParityTable<Row>
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        footerCells={{ name: "Totals", amount: "$30" }}
      />,
    );
    expect(screen.getByTestId("amount-footer")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Table settings"));
    const amountCheckbox = screen
      .getAllByRole("checkbox")
      .find((cb) => cb.closest("label")?.textContent?.includes("Amount"));
    expect(amountCheckbox).toBeTruthy();
    fireEvent.click(amountCheckbox as HTMLElement);
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    // Header column gone...
    expect(screen.queryByTestId("amount")).toBeNull();
    // ...and its footer cell gone with it — no stray total for a column that no longer shows.
    expect(screen.queryByTestId("amount-footer")).toBeNull();
    expect(footerOrder()).toEqual(["name"]);
  });

  it("a callback footerCells entry receives the current sorted/filtered rows (not raw props.rows)", () => {
    render(
      <ParityTable<Row>
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        footerCells={{
          name: (visibleRows) => `Totals · ${visibleRows.length}`,
          amount: "—",
        }}
      />,
    );
    expect(screen.getByTestId("name-footer")).toHaveTextContent("Totals · 2");

    fireEvent.change(screen.getByRole("textbox", { name: "Search rows…" }), { target: { value: "bravo" } });
    // Search narrows sortedRows to 1 — the footer callback must recompute against that, not the
    // original 2-row prop, or a filtered board would show a stale total.
    expect(screen.getByTestId("name-footer")).toHaveTextContent("Totals · 1");
  });

  it("omitted footerCells: no <tfoot> at all (unchanged default for the ~130 non-footer callers)", () => {
    render(<ParityTable<Row> columns={columns} rows={rows} rowKey={(r) => r.id} />);
    expect(screen.queryByTestId("parity-table-footer")).toBeNull();
  });
});
