import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { useShallow } from "zustand/react/shallow";
import { useApp } from "../store";
import { connStyle } from "../lib/connColor";
import { ContextMenu } from "../ui/ContextMenu";
import { Icon } from "../ui/Icon";

export function TabsBar() {
  const { tabs, connections, activeTabId, activateTab, closeTab, openMessagesTab, renameTab, reorderTab } = useApp(
    useShallow((s) => ({
      tabs: s.tabs, connections: s.connections, activeTabId: s.activeTabId,
      activateTab: s.activateTab, closeTab: s.closeTab,
      openMessagesTab: s.openMessagesTab, renameTab: s.renameTab, reorderTab: s.reorderTab,
    })),
  );
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [menu, setMenu] = useState<{ x: number; y: number; id: string } | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const activeRef = useRef<HTMLButtonElement>(null);

  // the bar scrolls, so a tab reached by ⌘1-9 / the palette / a close can be off-screen
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeTabId]);

  useEffect(() => {
    if (editingId) inputRef.current?.select();
  }, [editingId]);

  const commit = () => {
    if (editingId) renameTab(editingId, draft);
    setEditingId(null);
  };

  const draggedTabId = (event: React.DragEvent) =>
    event.dataTransfer.getData("application/x-kafkamin-tab") || dragId;

  return (
    <nav className="tabs">
      <AnimatePresence initial={false} mode="popLayout">
      {tabs.map((tab) => {
        const conn = tab.connId ? connections.find((c) => c.id === tab.connId) : null;
        return (
        <motion.button
          key={tab.id}
          ref={tab.id === activeTabId ? activeRef : undefined}
          layout
          initial={{ opacity: 0, scale: 0.9, y: -4 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.9, y: 4 }}
          transition={{ type: "spring", stiffness: 500, damping: 35 }}
          type="button"
          draggable={!editingId}
          className={`tab ${tab.id === activeTabId ? "active" : ""} ${dragId === tab.id ? "dragging" : ""} ${overId === tab.id && dragId && dragId !== tab.id ? "drag-over" : ""}`}
          style={connStyle(conn?.color)}
          onClick={() => activateTab(tab.id)}
          onAuxClick={(e) => {
            // middle-click closes the tab
            if (e.button === 1) closeTab(tab.id);
          }}
          onDoubleClick={() => {
            if (tab.kind !== "messages") return;
            setEditingId(tab.id);
            setDraft(tab.title);
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            setMenu({ x: e.clientX, y: e.clientY, id: tab.id });
          }}
          onDragStart={(e: any) => {
            setDragId(tab.id);
            e.dataTransfer.effectAllowed = "move";
            e.dataTransfer.setData("application/x-kafkamin-tab", tab.id);
          }}
          onDragEnd={() => {
            setDragId(null);
            setOverId(null);
          }}
          onDragOver={(e: any) => {
            if (!dragId || dragId === tab.id) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            setOverId(tab.id);
          }}
          onDragLeave={() => setOverId((o) => (o === tab.id ? null : o))}
          onDrop={(e) => {
            e.preventDefault();
            const id = draggedTabId(e);
            if (id && id !== tab.id) reorderTab(id, tab.id);
            setDragId(null);
            setOverId(null);
          }}
          title={conn && conn.name !== tab.title ? `${tab.title} · ${conn.name}` : tab.kind === "messages" ? "Double-click to rename · right-click for menu" : undefined}
        >
          {conn && <span className="conn-dot" />}
          <Icon name={tab.icon} className={tab.iconClass} />
          {editingId === tab.id ? (
            <input
              ref={inputRef}
              className="tab-title-input"
              value={draft}
              spellCheck={false}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commit}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter") commit();
                if (e.key === "Escape") setEditingId(null);
              }}
            />
          ) : (
            <span>{tab.title}</span>
          )}
          {conn && !editingId && conn.name !== tab.title && (
            // a tab already titled after its owner would just repeat the name
            <span className="tab-conn">{conn.name}</span>
          )}
          <motion.span
            whileHover={{ scale: 1.15 }}
            whileTap={{ scale: 0.85 }}
            className="tab-close"
            title={`Close ${tab.title} (⌘W)`}
            aria-label={`Close ${tab.title}`}
            onClick={(e) => {
              e.stopPropagation();
              closeTab(tab.id);
            }}
          >
            <Icon name="x" size={13} />
          </motion.span>
        </motion.button>
        );
      })}
      </AnimatePresence>
      <motion.button
        type="button"
        layout
        whileHover={{ scale: 1.03 }}
        whileTap={{ scale: 0.96 }}
        className="tab-add"
        title="Open messages for active topic (⌘N)"
        onClick={() => openMessagesTab()}
        onDragOver={(e) => {
          if (!dragId) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
        }}
        onDrop={(e) => {
          e.preventDefault();
          const id = draggedTabId(e);
          if (id) reorderTab(id, null);
          setDragId(null);
          setOverId(null);
        }}
      >
        <Icon name="plus" /><span>Messages</span>
      </motion.button>
      <AnimatePresence>
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            ...(tabs.find((t) => t.id === menu.id)?.kind === "messages"
              ? [{
                  icon: "pencil" as const,
                  label: "Rename",
                  strong: true,
                  onClick: () => {
                    const tab = tabs.find((t) => t.id === menu.id);
                    setEditingId(menu.id);
                    setDraft(tab?.title ?? "");
                  },
                }]
              : []),
            { icon: "x" as const, label: "Close (⌘W)", onClick: () => closeTab(menu.id) },
            {
              icon: "rows" as const,
              label: "Close others",
              onClick: () => {
                for (const t of tabs.filter((t) => t.id !== menu.id)) closeTab(t.id);
                activateTab(menu.id);
              },
            },
          ]}
        />
      )}
      </AnimatePresence>
    </nav>
  );
}
