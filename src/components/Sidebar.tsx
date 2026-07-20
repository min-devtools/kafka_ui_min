import { useEffect, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useQueryClient } from "@tanstack/react-query";
import { Badge } from "../ui/Badge";
import { ToolButton } from "../ui/ToolButton";
import { ContextMenu, type ContextMenuItem } from "../ui/ContextMenu";
import { activeConnId as activeConnIdOf, useApp } from "../store";
import { connStyle } from "../lib/connColor";
import { ColorPicker } from "../ui/ColorPicker";
import { useActiveConnection, useClusterMeta, useGroups } from "../lib/queries";
import { formatDocCount } from "../lib/format";
import type { TabKind } from "../lib/types";
import { Icon, type IconName } from "../ui/Icon";

const WORKSPACE_NAV: { kind: TabKind; icon: IconName; iconClass: string; label: string; meta?: string }[] = [
  { kind: "welcome", icon: "sparkles", iconClass: "soft-blue", label: "Welcome" },
  { kind: "topics", icon: "topics", iconClass: "soft-orange", label: "Topics", meta: "⌘T" },
  { kind: "groups", icon: "groups", iconClass: "soft-green", label: "Consumer Groups", meta: "⌘G" },
  { kind: "produce", icon: "send", iconClass: "soft-green", label: "Produce" },
  { kind: "settings", icon: "settings", iconClass: "soft-orange", label: "Settings", meta: "⌘," },
];

export function Sidebar() {
  const [filter, setFilter] = useState("");
  const [connMenu, setConnMenu] = useState<{ x: number; y: number; id: string } | null>(null);
  const [topicMenu, setTopicMenu] = useState<{ x: number; y: number; topic: string } | null>(null);
  const [pickingColor, setPickingColor] = useState<string | null>(null);
  const conn = useActiveConnection();
  const meta = useClusterMeta();
  const groups = useGroups();
  const queryClient = useQueryClient();
  const {
    connections, activeConnId, setActiveConn, deleteConnection, setEditingConn, setConnections,
    saveConnection, openDialog,
    tabs, activeTabId, openTab, activeTopic, setActiveTopic, showToast,
    openMessagesTab, topicRecency,
  } = useApp(
    useShallow((s) => ({
      connections: s.connections, activeConnId: activeConnIdOf(s), setActiveConn: s.setActiveConn,
      deleteConnection: s.deleteConnection, setEditingConn: s.setEditingConn, setConnections: s.setConnections,
      saveConnection: s.saveConnection, openDialog: s.openDialog,
      tabs: s.tabs, activeTabId: s.activeTabId, openTab: s.openTab, activeTopic: s.activeTopic,
      setActiveTopic: s.setActiveTopic, showToast: s.showToast,
      openMessagesTab: s.openMessagesTab, topicRecency: s.topicRecency,
    })),
  );
  // drag-reorder state for the Connections group — pattern matches redis_min Sidebar
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: string; before: boolean } | null>(null);
  const reorderConn = (from: string, beforeId: string | null) => {
    if (from === beforeId) return;
    const dragged = connections.find((c) => c.id === from);
    if (!dragged) return;
    const rest = connections.filter((c) => c.id !== from);
    const idx = beforeId ? rest.findIndex((c) => c.id === beforeId) : -1;
    setConnections(idx < 0 ? [...rest, dragged] : [...rest.slice(0, idx), dragged, ...rest.slice(idx)]);
  };
  const draggedConnId = (event: React.DragEvent) =>
    event.dataTransfer.getData("application/x-kafkamin-conn") || dragId;

  // keyboard/AT support for the clickable divs: Enter/Space activates
  const pressable = (onClick: () => void) => ({
    role: "button" as const,
    tabIndex: 0,
    onClick,
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onClick();
      }
    },
  });

  const activeKind = tabs.find((t) => t.id === activeTabId)?.kind;
  const q = filter.trim().toLowerCase();
  const topicList = (meta.data?.topics ?? [])
    .filter((t) => !t.internal)
    .filter((t) => !q || t.name.includes(q))
    .sort((a, b) => {
      const ai = topicRecency.indexOf(a.name);
      const bi = topicRecency.indexOf(b.name);
      if (ai === -1 && bi === -1) return 0;
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    });
  const SIDEBAR_CAP = 5;
  const shownTopics = q ? topicList.slice(0, 30) : topicList.slice(0, SIDEBAR_CAP);
  const hiddenTopicCount = q ? 0 : Math.max(0, topicList.length - SIDEBAR_CAP);

  // ⌘E / ⌘D / ⌘⌫ on the active connection — see design-systems/SHORTCUTS.md
  const editConn = (id: string) => {
    setEditingConn(id);
    openTab("connection");
  };
  const duplicateConn = (id: string) => {
    const c = connections.find((x) => x.id === id);
    if (!c) return;
    const copy = { ...c, id: crypto.randomUUID(), name: `${c.name} copy` };
    saveConnection(copy);
    showToast("Connection duplicated", copy.name);
  };
  const removeConn = async (id: string) => {
    const c = connections.find((x) => x.id === id);
    const ok = await openDialog({
      kind: "confirm",
      title: "Remove connection?",
      message: `"${c?.name ?? id}" and its stored credentials will be deleted.`,
      confirmLabel: "Remove",
      danger: true,
    });
    if (ok === null) return;
    deleteConnection(id);
    showToast("Connection removed", "Saved connection deleted from this workspace.");
  };

  // WebKit (Tauri macOS) doesn't focus rows on click, so per-node onKeyDown won't fire.
  // Listen globally and act on the active connection; stay out of inputs and open dialogs.
  useEffect(() => {
    if (!activeConnId) return;
    const onKey = (event: KeyboardEvent) => {
      if (useApp.getState().dialog) return;
      const el = document.activeElement as HTMLElement | null;
      const editable = !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
      if (editable) return;
      const mod = event.metaKey || event.ctrlKey;
      if (!mod || event.shiftKey) return;
      const key = event.key.toLowerCase();
      if (key === "d") { event.preventDefault(); duplicateConn(activeConnId); }
      else if (key === "e") { event.preventDefault(); editConn(activeConnId); }
      // ⌘⌫ only — a plain Backspace outside inputs is too easy to hit by accident
      else if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); void removeConn(activeConnId); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeConnId, connections]);

  const connMenuItems: ContextMenuItem[] = connMenu
    ? [
        {
          icon: "plug",
          label: "Connect",
          strong: true,
          onClick: () => {
            setActiveConn(connMenu.id);
            void queryClient.invalidateQueries();
          },
        },
        { icon: "pencil", label: "Edit connection", kbd: "⌘E", onClick: () => editConn(connMenu.id) },
        { icon: "status", label: "Set color…", onClick: () => setPickingColor(connMenu.id) },
        { icon: "copy", label: "Duplicate", kbd: "⌘D", onClick: () => duplicateConn(connMenu.id) },
        { icon: "trash", label: "Remove", kbd: "⌘⌫", onClick: () => void removeConn(connMenu.id) },
      ]
    : [];

  return (
    <aside className="sidebar">
      <div className="sidebar-top">
        <input
          className="side-search"
          placeholder="Search topics, groups, clusters"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>
      <div className="side-scroll">
        <div className="group">
          <div className="group-title"><span>Workspace</span><span /></div>
          {WORKSPACE_NAV.map((item) => (
            <div
              key={item.kind}
              className={`nav-item ${activeKind === item.kind ? "active" : ""}`}
              {...pressable(() => openTab(item.kind))}
            >
              <Icon name={item.icon} className={item.iconClass} />
              <span>{item.label}</span>
              <span>
                {item.meta?.startsWith("⌘") ? <span className="kbd">{item.meta}</span> : item.meta ?? ""}
              </span>
            </div>
          ))}
        </div>

        <div className="group">
          <div className="group-title"><span>Connections</span><span>{connections.length ? "saved" : ""}</span></div>
          <div
            className={`nav-item ${activeKind === "connection" ? "active" : ""}`}
            {...pressable(() => {
              setEditingConn(null);
              openTab("connection");
            })}
          >
            <Icon name="plus" className="soft-blue" /><span>New Connection</span><Badge>setup</Badge>
          </div>
          {connections.map((c) => (
            <div
              key={c.id}
              draggable
              className={`nav-item ${c.id === activeConnId ? "active" : ""} ${dragId === c.id ? "dragging" : ""} ${dropTarget?.id === c.id && dragId && dragId !== c.id ? (dropTarget.before ? "drop-before" : "drop-after") : ""}`}
              {...pressable(() => {
                setActiveConn(c.id);
                void queryClient.invalidateQueries();
              })}
              onContextMenu={(e) => {
                e.preventDefault();
                setConnMenu({ x: e.clientX, y: e.clientY, id: c.id });
              }}
              onDragStart={(e) => {
                setDragId(c.id);
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("application/x-kafkamin-conn", c.id);
              }}
              onDragEnd={() => { setDragId(null); setDropTarget(null); }}
              onDragOver={(e) => {
                if (!dragId || dragId === c.id) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                const rect = e.currentTarget.getBoundingClientRect();
                setDropTarget({ id: c.id, before: e.clientY < rect.top + rect.height / 2 });
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                  setDropTarget((t) => (t?.id === c.id ? null : t));
                }
              }}
              onDrop={(e) => {
                e.preventDefault();
                const id = draggedConnId(e);
                if (id && id !== c.id) {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const before = e.clientY < rect.top + rect.height / 2;
                  const nextId = before
                    ? c.id
                    : connections[connections.findIndex((cc) => cc.id === c.id) + 1]?.id ?? null;
                  reorderConn(id, nextId);
                }
                setDragId(null);
                setDropTarget(null);
              }}
            >
              <span
                className="conn-dot"
                style={connStyle(c.color)}
                title={c.color ? `Color: ${c.color}` : "No color — right-click to set one"}
              />
              <span>{c.name}</span>
              <Badge tone={c.id === activeConnId ? (meta.isError ? "red" : meta.data ? "green" : "idle") : "idle"}>
                {c.id === activeConnId ? (meta.isError ? "error" : meta.data ? "up" : "connecting…") : "idle"}
              </Badge>
            </div>
          ))}
        </div>

        <div className="group">
          <div className="group-title">
            <span>Topics</span>
            <span>{meta.data ? topicList.length : conn ? "…" : ""}</span>
          </div>
          {!conn && <div className="empty-note">Connect to a cluster to load topics.</div>}
          {conn && meta.isError && (
            <div className="empty-note">
              Cluster unreachable — {String(meta.error)}{" "}
              <ToolButton onClick={() => void meta.refetch()}><Icon name="refresh" /> Retry</ToolButton>
            </div>
          )}
          {shownTopics.map((t) => (
            <div
              key={t.name}
              className={`index-item ${t.name === activeTopic ? "active" : ""}`}
              {...pressable(() => setActiveTopic(t.name))}
              onDoubleClick={() => {
                setActiveTopic(t.name);
                openMessagesTab(t.name);
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                setActiveTopic(t.name);
                setTopicMenu({ x: e.clientX, y: e.clientY, topic: t.name });
              }}
            >
              <span className="index-dot" />
              <span>{t.name}</span>
              <span>{formatDocCount(t.partitions)}p</span>
            </div>
          ))}
          {hiddenTopicCount > 0 && (
            <div className="nav-item" {...pressable(() => openTab("topics"))}>
              <Icon name="more-horizontal" className="soft-orange" />
              <span>{hiddenTopicCount} more…</span>
            </div>
          )}
        </div>

        {conn && (
          <div className="group">
            <div className="group-title"><span>Cluster</span><span /></div>
            <div className="nav-item" {...pressable(() => openTab("groups"))}>
              <Icon name="groups" /><span>Consumer groups</span><span>{groups.data?.length || ""}</span>
            </div>
            <div className="nav-item" {...pressable(() => openTab("cluster"))}>
              <Icon name="cluster" /><span>Brokers</span><span>{meta.data?.brokers.length || ""}</span>
            </div>
          </div>
        )}
      </div>
      {connMenu && (
        <ContextMenu x={connMenu.x} y={connMenu.y} items={connMenuItems} onClose={() => setConnMenu(null)} />
      )}
      {pickingColor && (
        <ColorPicker
          value={connections.find((c) => c.id === pickingColor)?.color}
          onPick={(color) => {
            const c = connections.find((x) => x.id === pickingColor);
            if (c) saveConnection({ ...c, color: color ?? undefined });
          }}
          onClose={() => setPickingColor(null)}
        />
      )}
      {topicMenu && (
        <ContextMenu
          x={topicMenu.x}
          y={topicMenu.y}
          onClose={() => setTopicMenu(null)}
          items={[
            { icon: "docs", label: "View messages", strong: true, onClick: () => openMessagesTab(topicMenu.topic) },
            { icon: "send", label: "Produce to topic", onClick: () => openTab("produce") },
            { icon: "topics", label: "Open All Topics", onClick: () => openTab("topics") },
            { icon: "groups", label: "Consumer groups", onClick: () => openTab("groups") },
          ]}
        />
      )}
    </aside>
  );
}
