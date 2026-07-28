import { Badge } from "../../ui/Badge";
import { Icon } from "../../ui/Icon";
import { ToolButton } from "../../ui/ToolButton";
import type { JsFilter } from "../../lib/messageFilter";

interface Props {
  filters: JsFilter[];
  onAdd: () => void;
  onToggle: (filter: JsFilter) => void;
  onEdit: (filter: JsFilter) => void;
  onRemove: (filter: JsFilter) => void;
  disabled?: boolean;
}

export function JsFilterBar({ filters, onAdd, onToggle, onEdit, onRemove, disabled = false }: Props) {
  const enabled = filters.filter((filter) => filter.enabled).length;

  return (
    <section className="js-filter-bar" aria-label="JavaScript message filters">
      <div className="js-filter-label">
        <Icon name="code" size={13} />
        <strong>JS filters</strong>
        <Badge>{enabled}/{filters.length} active</Badge>
      </div>
      <div className="js-filter-list">
        {filters.length === 0 && (
          <span className="js-filter-empty">
            {disabled ? "Pick a topic to manage filters." : "No filters — every message passes."}
          </span>
        )}
        {filters.map((filter) => (
          <div className={`js-filter-row ${filter.enabled ? "enabled" : "disabled"}`} key={filter.id}>
            <button
              type="button"
              className="js-filter-toggle"
              aria-pressed={filter.enabled}
              title={filter.enabled ? "Disable filter" : "Enable filter"}
              onClick={() => onToggle(filter)}
            >
              <span className="status-dot" />
              {filter.enabled ? "On" : "Off"}
            </button>
            <code title={filter.code}>{filter.code}</code>
            <ToolButton iconOnly title="Edit JS filter" onClick={() => onEdit(filter)}>
              <Icon name="pencil" size={13} />
            </ToolButton>
            <ToolButton iconOnly title="Remove JS filter" onClick={() => onRemove(filter)}>
              <Icon name="x" size={13} />
            </ToolButton>
          </div>
        ))}
      </div>
      <ToolButton title="Add a JavaScript message filter" disabled={disabled} onClick={onAdd}>
        <Icon name="plus" /> Add filter
      </ToolButton>
    </section>
  );
}
