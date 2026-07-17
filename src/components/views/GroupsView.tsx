import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Badge } from "../../ui/Badge";
import { ToolButton } from "../../ui/ToolButton";
import { Icon } from "../../ui/Icon";
import { SortTh } from "../../ui/SortTh";
import { useSortedRows } from "../../lib/useSort";
import { useApp } from "../../store";
import { useActiveConnection, useGroupOffsets, useGroups } from "../../lib/queries";
import { deleteGroup, resetOffsets } from "../../lib/kafka";
import type { GroupInfo, GroupOffset } from "../../lib/types";

function OffsetTable({ rows }: { rows: GroupOffset[] }) {
  const { sorted, sort, cycleSort } = useSortedRows<GroupOffset>(rows, (r, col) =>
    r[col as "partition" | "committed" | "high" | "lag"],
  );
  return (
    <table>
      <thead>
        <tr>
          <SortTh col="partition" sort={sort} onSort={cycleSort} style={{ width: 100 }}>Partition</SortTh>
          <SortTh col="committed" sort={sort} onSort={cycleSort}>Committed</SortTh>
          <SortTh col="high" sort={sort} onSort={cycleSort}>High</SortTh>
          <SortTh col="lag" sort={sort} onSort={cycleSort}>Lag</SortTh>
        </tr>
      </thead>
      <tbody>
        {(sorted ?? []).map((o) => (
          <tr key={o.partition}>
            <td>{o.partition}</td>
            <td>{o.committed}</td>
            <td>{o.high}</td>
            <td style={{ color: o.lag > 0 ? "var(--orange)" : "var(--green)" }}>{o.lag}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function GroupsView({ active }: { active: boolean }) {
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  const conn = useActiveConnection();
  const groups = useGroups();
  const offsets = useGroupOffsets(selected);
  const queryClient = useQueryClient();
  const showToast = useApp((s) => s.showToast);
  const openDialog = useApp((s) => s.openDialog);

  const q = filter.trim().toLowerCase();
  const rows = (groups.data ?? []).filter((g) => !q || g.name.toLowerCase().includes(q));
  const { sorted, sort, cycleSort } = useSortedRows<GroupInfo>(rows, (r, col) =>
    col === "name" ? r.name : col === "state" ? r.state : r.members,
  );

  const doReset = async (topic: string, to: "earliest" | "latest") => {
    if (!conn || !selected) return;
    const confirmed = await openDialog({
      kind: "confirm",
      title: `Reset ${selected} → ${to}`,
      message: `Commit ${to} offsets for every partition of "${topic}". The group must have no active members.`,
      confirmLabel: `Reset to ${to}`,
      danger: true,
    });
    if (!confirmed) return;
    setResetting(true);
    try {
      await resetOffsets(conn, selected, topic, to);
      showToast("Offsets reset", `${selected} · ${topic} → ${to}.`);
      void queryClient.invalidateQueries({ queryKey: ["group-offsets"] });
    } catch (err) {
      showToast("Reset failed", String(err), "err");
    } finally {
      setResetting(false);
    }
  };

  const doResetCustom = async (topic: string) => {
    if (!conn || !selected) return;
    const raw = await openDialog({
      kind: "prompt",
      title: `Reset ${selected} · ${topic} to offset`,
      message: "Committed to every partition of the topic (clamped to each partition's low/high watermark).",
      defaultValue: "0",
      confirmLabel: "Reset",
      danger: true,
    });
    if (raw == null) return;
    const target = Number(raw);
    if (!Number.isFinite(target) || target < 0) {
      showToast("Invalid offset", "Enter a non-negative number.", "warn");
      return;
    }
    setResetting(true);
    try {
      await resetOffsets(conn, selected, topic, "offset", { offset: Math.floor(target) });
      showToast("Offsets reset", `${selected} · ${topic} → ${Math.floor(target)}.`);
      void queryClient.invalidateQueries({ queryKey: ["group-offsets"] });
    } catch (err) {
      showToast("Reset failed", String(err), "err");
    } finally {
      setResetting(false);
    }
  };

  const removeGroup = async () => {
    if (!conn || !selected) return;
    const ok = await openDialog({
      kind: "confirm",
      title: `Delete group "${selected}"`,
      message: "Removes the group and all its committed offsets. The group must have no active members.",
      confirmLabel: "Delete group",
      danger: true,
    });
    if (!ok) return;
    setResetting(true);
    try {
      await deleteGroup(conn, selected);
      showToast("Group deleted", `${selected} removed from the cluster.`);
      setSelected(null);
      void queryClient.invalidateQueries({ queryKey: ["groups"] });
    } catch (err) {
      showToast("Delete failed", String(err), "err");
    } finally {
      setResetting(false);
    }
  };

  const topics = [...new Set((offsets.data ?? []).map((o) => o.topic))];

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
                  onClick={() => setSelected(g.name === selected ? null : g.name)}
                  title="Click to inspect offsets and lag"
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
        {selected && (
          <div className="panel" style={{ margin: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <h3 style={{ flex: 1 }}>{selected} · offsets and lag</h3>
              <ToolButton variant="danger" disabled={resetting} title="Delete this consumer group" onClick={() => void removeGroup()}>
                <Icon name="trash" /> Delete group
              </ToolButton>
            </div>
            {offsets.isLoading && <div className="empty-note">Loading committed offsets…</div>}
            {offsets.data && offsets.data.length === 0 && (
              <div className="empty-note">No committed offsets for this group.</div>
            )}
            {topics.map((topic) => (
              <div key={topic} style={{ marginBottom: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0" }}>
                  <strong>{topic}</strong>
                  <span style={{ flex: 1 }} />
                  <ToolButton disabled={resetting} title="Rewind group to the beginning of this topic" onClick={() => void doReset(topic, "earliest")}>
                    <Icon name="chevrons-left" /> Earliest
                  </ToolButton>
                  <ToolButton disabled={resetting} title="Skip group to the end of this topic" onClick={() => void doReset(topic, "latest")}>
                    <Icon name="chevrons-right" /> Latest
                  </ToolButton>
                  <ToolButton disabled={resetting} title="Commit a specific offset to every partition" onClick={() => void doResetCustom(topic)}>
                    <Icon name="pencil" /> Custom…
                  </ToolButton>
                </div>
                <OffsetTable rows={(offsets.data ?? []).filter((o) => o.topic === topic)} />
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
