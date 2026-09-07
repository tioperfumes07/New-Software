import { useCallback, useState } from "react";

// VC-10 / VC-LIST-02 (owner "ALL PAGE SIZE", 2026-09-06): the master-detail sidebar page size is a
// user preference that must SURVIVE a reload — choosing "All" once should not silently revert to 50
// on the next visit. Persist it to localStorage per entity. The "All" sentinel (ALL_PAGE_SIZE from
// SidebarPagination) is just a large positive number, so it round-trips like any other page size.
const STORAGE_PREFIX = "ih35:list-page-size:";

function readLocal(key: string, fallback: number): number {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return fallback;
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) return n;
  } catch {
    // private mode / disabled storage
  }
  return fallback;
}

function writeLocal(key: string, value: number) {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    // private mode / disabled storage
  }
}

/**
 * Persisted list page-size preference. `All` is stored as ALL_PAGE_SIZE and round-trips like any
 * other numeric page size, so the sidebar's `value={pageSize}` select re-selects it after reload.
 */
export function useListPageSizePref(
  entity: "vendors" | "customers",
  defaultSize = 50,
): [number, (size: number) => void] {
  const storageKey = `${STORAGE_PREFIX}${entity}`;
  const [pageSize, setPageSizeState] = useState<number>(() => readLocal(storageKey, defaultSize));

  const setPageSize = useCallback(
    (size: number) => {
      setPageSizeState(size);
      writeLocal(storageKey, size);
    },
    [storageKey],
  );

  return [pageSize, setPageSize];
}
