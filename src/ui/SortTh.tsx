import type { ReactNode } from "react";
import type { SortState } from "../lib/useSort";

export function SortTh({
  col, sort, onSort, children, ...rest
}: {
  col: string;
  sort: SortState;
  onSort: (col: string) => void;
  children: ReactNode;
} & React.ThHTMLAttributes<HTMLTableCellElement>) {
  const active = sort?.col === col;
  return (
    <th
      {...rest}
      aria-sort={active ? (sort.dir === "desc" ? "descending" : "ascending") : "none"}
      style={rest.style}
    >
      <button type="button" className="sort-btn" onClick={() => onSort(col)}>
        {children}
        {active && <span className="sort-arrow">{sort.dir === "desc" ? " ▼" : " ▲"}</span>}
      </button>
    </th>
  );
}
