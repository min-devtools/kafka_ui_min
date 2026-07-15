import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Badge } from "../../ui/Badge";
import { ToolButton } from "../../ui/ToolButton";
import { Icon } from "../../ui/Icon";
import { SortTh } from "../../ui/SortTh";
import { useSortedRows } from "../../lib/useSort";
import { ContextMenu } from "../../ui/ContextMenu";
import { useApp } from "../../store";
import { useActiveConnection, useClusterMeta, useTopicStats } from "../../lib/queries";
import { createTopic, deleteTopic } from "../../lib/kafka";
import { formatDocCount } from "../../lib/format";
import type { TopicInfo } from "../../lib/types";

type TopicRow = TopicInfo & { messages: number | null; highTotal: number | null };

export function TopicsView({ active }: { active: boolean }) {
  const [filter, setFilter] = useState("");
  const [showInternal, setShowInternal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({ name: "", partitions: 1, replication: 1 });
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number; topic: string } | null>(null);
  const conn = useActiveConnection();
  const meta = useClusterMeta();
  const stats = useTopicStats();
  const queryClient = useQueryClient();
  const { openMessagesTab, setActiveTopic, activeTopic, showToast, openDialog, openTab } = useApp();

  const q = filter.trim().toLowerCase();
  const statsByName = new Map((stats.data ?? []).map((s) => [s.name, s]));
  const rows: TopicRow[] = (meta.data?.topics ?? [])
    .filter((t) => showInternal || !t.internal)
    .filter((t) => !q || t.name.includes(q))
    .map((t) => ({
      ...t,
      messages: statsByName.get(t.name)?.messages ?? null,
      highTotal: statsByName.get(t.name)?.highTotal ?? null,
    }));
  const { sorted, sort, cycleSort } = useSortedRows<TopicRow>(rows, (r, col) =>
    col === "name" ? r.name : r[col as "partitions" | "replicas" | "messages" | "highTotal"],
  );

  const submitCreate = async () => {
    if (!conn || !draft.name.trim()) return;
    setBusy(true);
    try {
      await createTopic(conn, draft.name.trim(), draft.partitions, draft.replication);
      showToast("Topic created", `${draft.name.trim()} · ${draft.partitions} partition(s).`);
      setCreating(false);
      setDraft({ name: "", partitions: 1, replication: 1 });
      void queryClient.invalidateQueries({ queryKey: ["cluster-meta"] });
    } catch (err) {
      showToast("Create failed", String(err), "err");
    } finally {
      setBusy(false);
    }
  };

  const removeTopic = async (name: string) => {
    if (!conn) return;
    const ok = await openDialog({
      kind: "confirm",
      title: `Delete topic "${name}"`,
      message: "All messages in this topic are permanently deleted from the cluster.",
      confirmLabel: "Delete topic",
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await deleteTopic(conn, name);
      showToast("Topic deleted", `${name} removed from the cluster.`);
      if (activeTopic === name) setActiveTopic(null);
      void queryClient.invalidateQueries({ queryKey: ["cluster-meta"] });
    } catch (err) {
      showToast("Delete failed", String(err), "err");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={`content indexes-view ${active ? "active" : ""}`}>
      <div className="index-searchbar">
        <input
          className="index-search"
          placeholder="Filter topics"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <label style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--text-2)" }}>
          <input type="checkbox" className="row-check" checked={showInternal} onChange={() => setShowInternal((v) => !v)} />
          internal
        </label>
        <span />
        <span className="seg" style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
          <ToolButton disabled={!conn} onClick={() => setCreating((v) => !v)}>
            <Icon name="plus" /> New topic
          </ToolButton>
          <Badge>{meta.data ? `${rows.length} topics` : conn ? "loading…" : "no connection"}</Badge>
        </span>
      </div>
      <div className="index-table-wrap">
        {creating && (
          <div className="panel" style={{ margin: 12 }}>
            <h3>Create topic</h3>
            <div style={{ display: "flex", gap: 8, alignItems: "center", padding: "10px 0", flexWrap: "wrap" }}>
              <input
                className="index-search"
                style={{ width: 240 }}
                placeholder="topic name"
                value={draft.name}
                onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                onKeyDown={(e) => e.key === "Enter" && void submitCreate()}
              />
              <label style={{ color: "var(--text-2)" }}>partitions</label>
              <input
                className="index-search"
                style={{ width: 70 }}
                type="number"
                min={1}
                value={draft.partitions}
                onChange={(e) => setDraft((d) => ({ ...d, partitions: Math.max(1, Number(e.target.value) || 1) }))}
              />
              <label style={{ color: "var(--text-2)" }}>replication</label>
              <input
                className="index-search"
                style={{ width: 70 }}
                type="number"
                min={1}
                value={draft.replication}
                onChange={(e) => setDraft((d) => ({ ...d, replication: Math.max(1, Number(e.target.value) || 1) }))}
              />
              <ToolButton variant="primary" disabled={busy || !draft.name.trim()} onClick={() => void submitCreate()}>
                <Icon name="check" /> Create
              </ToolButton>
              <ToolButton onClick={() => setCreating(false)}>Cancel</ToolButton>
            </div>
          </div>
        )}
        {!conn && <div className="empty-note">Connect to a cluster to load topics.</div>}
        {conn && (
          <table>
            <thead>
              <tr>
                <SortTh col="name" sort={sort} onSort={cycleSort}>Topic</SortTh>
                <SortTh col="partitions" sort={sort} onSort={cycleSort} style={{ width: 110 }}>Partitions</SortTh>
                <SortTh col="replicas" sort={sort} onSort={cycleSort} style={{ width: 100 }}>Replicas</SortTh>
                <SortTh col="messages" sort={sort} onSort={cycleSort} style={{ width: 120 }} title="Retained messages: Σ(high − low)">Messages</SortTh>
                <SortTh col="highTotal" sort={sort} onSort={cycleSort} style={{ width: 140 }} title="Σ high watermark — total ever produced">High watermark</SortTh>
              </tr>
            </thead>
            <tbody>
              {(sorted ?? []).map((t) => (
                <tr
                  key={t.name}
                  className={t.name === activeTopic ? "selected" : ""}
                  onClick={() => setActiveTopic(t.name)}
                  onDoubleClick={() => openMessagesTab(t.name)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setActiveTopic(t.name);
                    setMenu({ x: e.clientX, y: e.clientY, topic: t.name });
                  }}
                  title="Double-click to view messages · right-click for menu"
                >
                  <td>{t.name}</td>
                  <td>{t.partitions}</td>
                  <td>{t.replicas}</td>
                  <td>{t.messages == null ? "…" : formatDocCount(t.messages)}</td>
                  <td>{t.highTotal == null ? "…" : formatDocCount(t.highTotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            { icon: "docs", label: "View messages", strong: true, onClick: () => openMessagesTab(menu.topic) },
            { icon: "send", label: "Produce to topic", onClick: () => openTab("produce") },
            { icon: "trash", label: "Delete topic", onClick: () => void removeTopic(menu.topic) },
          ]}
        />
      )}
    </section>
  );
}
