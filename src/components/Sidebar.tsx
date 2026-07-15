import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Badge } from "../ui/Badge";
import { ContextMenu, type ContextMenuItem } from "../ui/ContextMenu";
import { useApp } from "../store";
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
  const conn = useActiveConnection();
  const meta = useClusterMeta();
  const groups = useGroups();
  const queryClient = useQueryClient();
  const {
    connections, activeConnId, setActiveConn, deleteConnection, setEditingConn,
    tabs, activeTabId, openTab, activeTopic, setActiveTopic, showToast,
    openMessagesTab, topicRecency,
  } = useApp();

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
        {
          icon: "pencil",
          label: "Edit connection",
          onClick: () => {
            setEditingConn(connMenu.id);
            openTab("connection");
          },
        },
        {
          icon: "trash",
          label: "Remove",
          onClick: () => {
            deleteConnection(connMenu.id);
            showToast("Connection removed", "Saved connection deleted from this workspace.");
          },
        },
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
          <div className="group-title"><span>Connections</span><span>{connections.length ? "saved" : ""}</span></div>
          <div
            className={`nav-item ${activeKind === "connection" ? "active" : ""}`}
            onClick={() => {
              setEditingConn(null);
              openTab("connection");
            }}
          >
            <Icon name="plus" className="soft-blue" /><span>New Connection</span><Badge>setup</Badge>
          </div>
          {connections.map((c) => (
            <div
              key={c.id}
              className={`nav-item ${c.id === activeConnId ? "active" : ""}`}
              onClick={() => {
                setActiveConn(c.id);
                void queryClient.invalidateQueries();
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                setConnMenu({ x: e.clientX, y: e.clientY, id: c.id });
              }}
            >
              <Icon name="status" className={c.id === activeConnId ? "soft-green" : undefined} />
              <span>{c.name}</span>
              <Badge tone={c.id === activeConnId ? (meta.isError ? "red" : meta.data ? "green" : "idle") : "idle"}>
                {c.id === activeConnId ? (meta.isError ? "error" : meta.data ? "up" : "connecting…") : "idle"}
              </Badge>
            </div>
          ))}
        </div>

        <div className="group">
          <div className="group-title"><span>Workspace</span><span /></div>
          {WORKSPACE_NAV.map((item) => (
            <div
              key={item.kind}
              className={`nav-item ${activeKind === item.kind ? "active" : ""}`}
              onClick={() => openTab(item.kind)}
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
          <div className="group-title">
            <span>Topics</span>
            <span>{meta.data ? topicList.length : conn ? "…" : ""}</span>
          </div>
          {!conn && <div className="empty-note">Connect to a cluster to load topics.</div>}
          {shownTopics.map((t) => (
            <div
              key={t.name}
              className={`index-item ${t.name === activeTopic ? "active" : ""}`}
              onClick={() => setActiveTopic(t.name)}
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
            <div className="nav-item" onClick={() => openTab("topics")}>
              <Icon name="more-horizontal" className="soft-orange" />
              <span>{hiddenTopicCount} more…</span>
            </div>
          )}
        </div>

        {conn && (
          <div className="group">
            <div className="group-title"><span>Cluster</span><span /></div>
            <div className="nav-item" onClick={() => openTab("groups")}>
              <Icon name="groups" /><span>Consumer groups</span><span>{groups.data?.length || ""}</span>
            </div>
            <div className="nav-item" onClick={() => openTab("cluster")}>
              <Icon name="cluster" /><span>Brokers</span><span>{meta.data?.brokers.length || ""}</span>
            </div>
          </div>
        )}
      </div>
      {connMenu && (
        <ContextMenu x={connMenu.x} y={connMenu.y} items={connMenuItems} onClose={() => setConnMenu(null)} />
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
