import { useState } from "react";
import { Badge } from "../../ui/Badge";
import { SortTh } from "../../ui/SortTh";
import { useSortedRows } from "../../lib/useSort";
import { useApp } from "../../store";
import { useActiveConnection, useGroups } from "../../lib/queries";
import type { GroupInfo } from "../../lib/types";

export function GroupsView({ active }: { active: boolean }) {
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const conn = useActiveConnection();
  const groups = useGroups();
  const openGroupTab = useApp((s) => s.openGroupTab);

  const q = filter.trim().toLowerCase();
  const rows = (groups.data ?? []).filter((g) => !q || g.name.toLowerCase().includes(q));
  const { sorted, sort, cycleSort } = useSortedRows<GroupInfo>(rows, (r, col) =>
    col === "name" ? r.name : col === "state" ? r.state : r.members,
  );

  return (
    <section className={`content indexes-view ${active ? "active" : ""}`}>
      <div className="index-searchbar">
        <input
          className="index-search"
          placeholder="Filter consumer groups"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <span />
        <span />
        <Badge>{groups.data ? `${rows.length} groups` : conn ? "loading…" : "no connection"}</Badge>
      </div>
      <div className="index-table-wrap">
        {!conn && <div className="empty-note">Connect to a cluster to load consumer groups.</div>}
        {conn && (
          <table>
            <thead>
              <tr>
                <SortTh col="name" sort={sort} onSort={cycleSort}>Group</SortTh>
                <SortTh col="state" sort={sort} onSort={cycleSort} style={{ width: 140 }}>State</SortTh>
                <SortTh col="members" sort={sort} onSort={cycleSort} style={{ width: 120 }}>Members</SortTh>
              </tr>
            </thead>
            <tbody>
              {(sorted ?? []).map((g) => (
                <tr
                  key={g.name}
                  className={g.name === selected ? "selected" : ""}
                  onClick={() => setSelected(g.name)}
                  onDoubleClick={() => openGroupTab(g.name)}
                  title="Double-click to open members, offsets and lag"
                >
                  <td>{g.name}</td>
                  <td>{g.state || "—"}</td>
                  <td>{g.members}</td>
                </tr>
              ))}
              {groups.data && rows.length === 0 && (
                <tr><td colSpan={3}>No consumer groups found.</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
