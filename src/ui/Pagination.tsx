import { Icon } from "./Icon";
import { ToolButton } from "./ToolButton";

export const PAGE_SIZES = [25, 50, 100, 250];

export function Pagination({
  page,
  totalPages,
  pageSize,
  onPage,
  onPageSize,
}: {
  page: number;
  totalPages: number;
  pageSize: number;
  onPage: (page: number) => void;
  onPageSize: (size: number) => void;
}) {
  return (
    <div className="seg">
      <label>
        Rows{" "}
        <select
          className="index-search"
          value={pageSize}
          onChange={(e) => {
            onPageSize(Number(e.target.value));
            onPage(1);
          }}
        >
          {PAGE_SIZES.map((size) => (
            <option key={size}>{size}</option>
          ))}
        </select>
      </label>
      <ToolButton iconOnly title="Previous page" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        <Icon name="arrow-left" />
      </ToolButton>
      <span>
        Page {page} / {totalPages}
      </span>
      <ToolButton iconOnly title="Next page" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>
        <Icon name="arrow-right" />
      </ToolButton>
    </div>
  );
}
