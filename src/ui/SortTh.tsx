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
  return (
    <th {...rest} onClick={() => onSort(col)} style={{ cursor: "pointer", ...rest.style }}>
      {children}
      {sort?.col === col && <span className="sort-arrow">{sort.dir === "desc" ? " ▼" : " ▲"}</span>}
    </th>
  );
}
