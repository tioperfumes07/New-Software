// VC-10 / VC-LIST-02 (owner "ALL PAGE SIZE"): the sentinel page size that renders EVERY row.
// The vendor/customer rosters are fetched fully client-side (listAllVendors / listAllCustomers —
// no server paging), so "All" is a safe client-side slice with no unbounded refetch (no REG-400).
// 1_000_000 exceeds any real USMCA roster (vendors 619, customers 1,235), so slicing 0..ALL returns
// all rows and totalPages collapses to 1.
export const ALL_PAGE_SIZE = 1_000_000;

type Props = {
  page: number;
  pageSize: number;
  totalCount: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  pageSizeOptions?: number[];
  /** VC-10: append an "All" option (value ALL_PAGE_SIZE) that renders the whole roster. */
  allowAll?: boolean;
  /** When the roster query is still loading, suppress the "0-0 of 0" count so it never asserts an empty roster mid-fetch. */
  loading?: boolean;
};

export function SidebarPagination({
  page,
  pageSize,
  totalCount,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [25, 50, 100, 250],
  allowAll = false,
  loading = false,
}: Props) {
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const rangeStart = totalCount === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const rangeEnd = totalCount === 0 ? 0 : Math.min(safePage * pageSize, totalCount);

  return (
    <div className="space-y-2 text-xs text-gray-600" data-sidebar-pagination="true">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span>
          {loading ? "Loading…" : `${rangeStart}-${rangeEnd} of ${totalCount.toLocaleString()}`}
        </span>
        <label className="inline-flex items-center gap-1">
          <span>Page size</span>
          <select
            className="rounded-sm border border-gray-300 px-1 py-0.5 text-xs"
            value={pageSize}
            onChange={(event) => onPageSizeChange(Number(event.target.value))}
          >
            {pageSizeOptions.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
            {allowAll ? (
              <option key="all" value={ALL_PAGE_SIZE}>
                All
              </option>
            ) : null}
          </select>
        </label>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span>
          Page {safePage} of {totalPages}
        </span>
        <div className="flex items-center gap-1">
          <button type="button" className="rounded-sm border border-gray-300 px-2 py-0.5 hover:bg-gray-50 disabled:opacity-40" disabled={safePage <= 1} onClick={() => onPageChange(1)}>
            First
          </button>
          <button type="button" className="rounded-sm border border-gray-300 px-2 py-0.5 hover:bg-gray-50 disabled:opacity-40" disabled={safePage <= 1} onClick={() => onPageChange(safePage - 1)}>
            Previous
          </button>
          <button type="button" className="rounded-sm border border-gray-300 px-2 py-0.5 hover:bg-gray-50 disabled:opacity-40" disabled={safePage >= totalPages} onClick={() => onPageChange(safePage + 1)}>
            Next
          </button>
          <button type="button" className="rounded-sm border border-gray-300 px-2 py-0.5 hover:bg-gray-50 disabled:opacity-40" disabled={safePage >= totalPages} onClick={() => onPageChange(totalPages)}>
            Last
          </button>
        </div>
      </div>
      <label className="flex items-center gap-1">
        Jump to page
        <input
          type="number"
          min={1}
          max={totalPages}
          defaultValue={safePage}
          key={safePage}
          className="w-16 rounded-sm border border-gray-300 px-1 py-0.5"
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            const value = Number((event.target as HTMLInputElement).value);
            if (Number.isFinite(value) && value >= 1 && value <= totalPages) onPageChange(value);
          }}
        />
      </label>
    </div>
  );
}
