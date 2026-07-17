import { useMemo, useRef, useState } from "react";

export type SortDir = "desc" | "asc";
export type SortState = { col: string; dir: SortDir } | null;

// click cycle: desc -> asc -> none
export function useSort(initial: SortState = null) {
  const [sort, setSort] = useState<SortState>(initial);
  const cycleSort = (col: string) => {
    setSort((s) => {
      if (s?.col !== col) return { col, dir: "desc" };
      if (s.dir === "desc") return { col, dir: "asc" };
      return null;
    });
  };
  return { sort, setSort, cycleSort };
}

// generic client-side sort, mirrors the compare rules already used in ResultsPanel
export function sortRows<T>(rows: T[], sort: SortState, getValue: (row: T, col: string) => unknown): T[] {
  if (!sort) return rows;
  const dir = sort.dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const va = getValue(a, sort.col);
    const vb = getValue(b, sort.col);
    if (va == null && vb == null) return 0;
    if (va == null) return 1;
    if (vb == null) return -1;
    if (typeof va === "number" && typeof vb === "number") return (va - vb) * dir;
    return String(va).localeCompare(String(vb)) * dir;
  });
}

export function useSortedRows<T>(rows: T[] | null | undefined, getValue: (row: T, col: string) => unknown) {
  const { sort, cycleSort } = useSort();
  // callers pass inline closures — keep the latest in a ref so the memo keys on data, not identity
  const getValueRef = useRef(getValue);
  getValueRef.current = getValue;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const sorted = useMemo(() => (rows ? sortRows(rows, sort, (row, col) => getValueRef.current(row, col)) : rows), [rows, sort]);
  return { sorted, sort, cycleSort };
}
