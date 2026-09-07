import { useMemo } from "react";
import type { Customer } from "../../api/mdata";
import { customerQualityKind, customerQualityClass } from "../../lib/quality-badge";
import { ResizableTable } from "../../components/shared/ResizableTable";
import { CardLink } from "../../components/shared/CardLink";
import { SidebarPagination } from "../../components/shared/SidebarPagination";
import { SelectCombobox } from "../../components/Combobox";
import { useListState, type ListQueryStatus } from "../../components/list-state";
import { formatUsdCents } from "../../lib/money";

function fmtMoney(cents: number) {
  return formatUsdCents(cents);
}

function customerQualityRating(paymentScore: string | null | undefined, overallFlag: "preferred" | "standard" | "caution" | "avoid") {
  // CUST-2: rate only from real data; no score/flag → neutral "No history" (was defaulting to amber "Watch").
  const kind = customerQualityKind(paymentScore, overallFlag);
  const label = kind === "good" ? "Good" : kind === "watch" ? "Watch" : kind === "late" ? "Late-pay" : "No history";
  return { label, className: customerQualityClass(kind) };
}

type Props = {
  customers: Customer[];
  /** Roster query status so the empty state renders only once the fetch settles. */
  status: ListQueryStatus;
  totalCount: number;
  page: number;
  pageSize: number;
  search: string;
  sortByName: "name_asc" | "name_desc" | "balance_asc" | "balance_desc";
  selectedCustomerId: string;
  openByCustomerId: Map<string, number>;
  openBalancesAvailable: boolean;
  onSearchChange: (value: string) => void;
  onSortChange: (value: "name_asc" | "name_desc" | "balance_asc" | "balance_desc") => void;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  onSelectCustomer: (customerId: string) => void;
};

export function CustomerListSidebar({
  customers,
  status,
  totalCount,
  page,
  pageSize,
  search,
  sortByName,
  selectedCustomerId,
  openByCustomerId,
  openBalancesAvailable,
  onSearchChange,
  onSortChange,
  onPageChange,
  onPageSizeChange,
  onSelectCustomer,
}: Props) {
  const sortedCustomers = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = customers.filter((customer) => {
      if (!q) return true;
      return (
        customer.name.toLowerCase().includes(q) ||
        String(customer.customer_code ?? "").toLowerCase().includes(q) ||
        String(customer.email ?? "").toLowerCase().includes(q)
      );
    });
    // CUST-01 C4: default sidebar was name-only; balance sort existed only in the opt-in List
    // view. Reuses the same openByCustomerId map already fetched for the Open Balance column.
    if (sortByName === "balance_asc" || sortByName === "balance_desc") {
      rows.sort((a, b) => {
        const cmp = (openByCustomerId.get(a.id) ?? 0) - (openByCustomerId.get(b.id) ?? 0);
        return sortByName === "balance_asc" ? cmp : -cmp;
      });
    } else {
      rows.sort((a, b) => {
        const cmp = a.name.localeCompare(b.name);
        return sortByName === "name_asc" ? cmp : -cmp;
      });
    }
    return rows;
  }, [customers, search, sortByName, openByCustomerId]);

  // PAGER-SERVERTOTAL-01: the pager count/totalPages reflect the server roster total
  // (totalCount prop, e.g. "440 of 490"), NOT the current in-memory array length.
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const pageStart = (safePage - 1) * pageSize;
  const pagedCustomers = useMemo(
    () => sortedCustomers.slice(pageStart, pageStart + pageSize),
    [pageStart, pageSize, sortedCustomers]
  );

  // LIST-EMPTY-1: the empty message renders only after the roster settles.
  const listState = useListState(status, pagedCustomers.length === 0);

  // MD-WIDTH-0 (lead 2026-09-06, measured live: aside 1770px, main 0px at 1920 viewport) — the master list must have an
  // explicit width beside the detail pane; `w-full` + `shrink-0` alone swallowed the whole flex row and the detail never showed.
  return (
    <aside className="w-full shrink-0 rounded-sm border border-gray-200 bg-white p-2 xl:w-[440px] xl:min-w-[300px] xl:max-w-[560px]" data-customer-list-sidebar="true">
      <SidebarPagination
        page={safePage}
        pageSize={pageSize}
        totalCount={totalCount}
        onPageChange={onPageChange}
        onPageSizeChange={onPageSizeChange}
        allowAll
        loading={listState.isLoading}
      />
      <input
        value={search}
        onChange={(event) => onSearchChange(event.target.value)}
        placeholder="Search by name or details"
        className="mb-2 mt-2 w-full rounded-sm border border-gray-300 px-2 py-1 text-xs"
      />
      <SelectCombobox
        value={sortByName}
        onChange={(event) => onSortChange(event.target.value as "name_asc" | "name_desc" | "balance_asc" | "balance_desc")}
        className="mb-2 w-full rounded-sm border border-gray-300 px-2 py-1 text-xs"
      >
        <option value="name_asc">Sort by name</option>
        <option value="name_desc">Sort by name (Z-A)</option>
        <option value="balance_desc">Sort by balance (high-low)</option>
        <option value="balance_asc">Sort by balance (low-high)</option>
      </SelectCombobox>
      {/* QBO columnar list: resizable, per-user-persisted column widths (shared ResizableTable/ResizableTh). */}
      <div className="max-h-[760px] overflow-y-auto">
        <ResizableTable
          tableId="customers-master-list"
          columns={[
            { id: "name", label: "Name", defaultWidth: 170, align: "left" },
            { id: "open_balance", label: "Open Balance", defaultWidth: 100, align: "right" },
            // VC-DETAIL-01 (owner ROUND 14, 2026-09-06): Status is active/inactive (deactivated_at),
            // NOT the quality chip; the quality chip moves to its own column (sibling to VendorListSidebar).
            { id: "status", label: "Status", defaultWidth: 80, align: "left" },
            { id: "quality", label: "Quality", defaultWidth: 90, align: "left" },
          ]}
        >
          {(widths) => (
            <tbody>
              {pagedCustomers.map((customer) => {
                const rating = customerQualityRating(customer.quality_payment_score, customer.quality_overall_flag);
                const isInactive = customer.deactivated_at != null;
                const selected = selectedCustomerId === customer.id;
                return (
                  <tr
                    key={customer.id}
                    className={`border-b border-gray-100 ${selected ? "bg-slate-100" : "hover:bg-gray-50"}`}
                  >
                    <td style={{ width: widths.name }} className="max-w-0 truncate px-2 py-1.5">
                      {/* Anchor navigation (cmd-click / keyboard) via CardLink; also selects the master-detail row. */}
                      <CardLink href={`/customers/${customer.id}`} onNavigate={() => onSelectCustomer(customer.id)} className="block truncate text-xs font-medium text-gray-900 hover:underline">
                        {/* invariant #23 (§7 owner-locked): the canonical `single-line-name` token, plus the
                            title so the full name is still readable once ellipsised. The surrounding
                            `truncate` already prevented wrapping here — this page never rendered the name
                            through ParityTable — so this adds the CANONICAL treatment and the tooltip, it
                            does not repair a wrap. */}
                        <span title={customer.name} className="single-line-name">{customer.name}</span>
                      </CardLink>
                    </td>
                    <td style={{ width: widths.open_balance }} className="px-2 py-1.5 text-right text-xs tabular-nums text-gray-700">
                      {openBalancesAvailable ? fmtMoney(openByCustomerId.get(customer.id) ?? 0) : "Unavailable"}
                    </td>
                    <td style={{ width: widths.status }} className="px-2 py-1.5">
                      <span className={`inline-flex rounded-sm px-2 py-0.5 text-xs font-semibold ${isInactive ? "bg-gray-200 text-gray-700" : "bg-slate-100 text-slate-700"}`}>
                        {isInactive ? "Inactive" : "Active"}
                      </span>
                    </td>
                    <td style={{ width: widths.quality }} className="px-2 py-1.5">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${rating.className}`}>{rating.label}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          )}
        </ResizableTable>
        {listState.isLoading ? <p className="px-1 py-2 text-xs text-slate-500">Loading customers…</p> : null}
        {listState.isEmpty ? <p className="px-1 py-2 text-xs text-slate-500">No customers found.</p> : null}
      </div>
      <div className="mt-2">
        <SidebarPagination
          page={safePage}
          pageSize={pageSize}
          totalCount={totalCount}
          onPageChange={onPageChange}
          onPageSizeChange={onPageSizeChange}
          allowAll
          loading={listState.isLoading}
        />
      </div>
    </aside>
  );
}
