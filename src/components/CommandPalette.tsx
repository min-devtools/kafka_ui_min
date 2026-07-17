import { useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useApp } from "../store";
import { useClusterMeta, useGroups } from "../lib/queries";
import { Icon, type IconName } from "../ui/Icon";

interface Command {
  icon: IconName;
  label: string;
  kbd?: string;
  action: () => void;
}

export function CommandPalette() {
  const [input, setInput] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const meta = useClusterMeta();
  const groups = useGroups();
  const app = useApp(
    useShallow((s) => ({
      commandOpen: s.commandOpen, connections: s.connections, openTab: s.openTab,
      openMessagesTab: s.openMessagesTab, openGroupTab: s.openGroupTab, setEditingConn: s.setEditingConn, toggleLeft: s.toggleLeft,
      toggleRight: s.toggleRight, toggleTheme: s.toggleTheme, toggleCompact: s.toggleCompact,
      setActiveConn: s.setActiveConn, setActiveTopic: s.setActiveTopic, setCommandOpen: s.setCommandOpen,
    })),
  );

  useEffect(() => {
    if (app.commandOpen) {
      setInput("");
      setCursor(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [app.commandOpen]);

  const commands = useMemo<Command[]>(() => {
    const base: Command[] = [
      { icon: "topics", label: "Browse topics", kbd: "⌘T", action: () => app.openTab("topics") },
      { icon: "groups", label: "Consumer groups", kbd: "⌘G", action: () => app.openTab("groups") },
      { icon: "docs", label: "Open messages (active topic)", kbd: "⌘N", action: () => app.openMessagesTab() },
      { icon: "send", label: "Produce a message", action: () => app.openTab("produce") },
      { icon: "cluster", label: "Cluster overview", action: () => app.openTab("cluster") },
      { icon: "plug", label: "New Kafka connection", action: () => { app.setEditingConn(null); app.openTab("connection"); } },
      { icon: "panel-left", label: "Toggle left sidebar", kbd: "⌘B", action: () => app.toggleLeft() },
      { icon: "panel-right", label: "Toggle right inspector", kbd: "⌘R", action: () => app.toggleRight() },
      { icon: "settings", label: "Open Settings", kbd: "⌘,", action: () => app.openTab("settings") },
      { icon: "moon", label: "Toggle theme", action: () => app.toggleTheme() },
      { icon: "rows", label: "Toggle compact density", action: () => app.toggleCompact() },
    ];
    for (const c of app.connections) {
      base.push({
        icon: "plug",
        label: `Switch connection: ${c.name}`,
        action: () => app.setActiveConn(c.id),
      });
    }
    for (const t of meta.data?.topics ?? []) {
      if (t.internal) continue;
      base.push({
        icon: "topics",
        label: `Open topic: ${t.name}`,
        action: () => {
          app.setActiveTopic(t.name);
          app.openMessagesTab(t.name);
        },
      });
    }
    for (const g of groups.data ?? []) {
      base.push({
        icon: "groups",
        label: `Open group: ${g.name}`,
        action: () => app.openGroupTab(g.name),
      });
    }
    return base;
  }, [app, meta.data, groups.data]);

  const filtered = useMemo(() => {
    const q = input.trim().toLowerCase();
    return (q ? commands.filter((c) => c.label.toLowerCase().includes(q)) : commands).slice(0, 12);
  }, [commands, input]);

  if (!app.commandOpen) return null;

  const runCommand = (cmd: Command) => {
    app.setCommandOpen(false);
    cmd.action();
  };

  return (
    <div
      className="command"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) app.setCommandOpen(false);
      }}
    >
      <div className="palette">
        <input
          ref={inputRef}
          value={input}
          placeholder="Run command, open topic, switch connection..."
          onChange={(e) => {
            setInput(e.target.value);
            setCursor(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setCursor((c) => Math.min(filtered.length - 1, c + 1));
            }
            if (e.key === "ArrowUp") {
              e.preventDefault();
              setCursor((c) => Math.max(0, c - 1));
            }
            if (e.key === "Enter" && filtered[cursor]) runCommand(filtered[cursor]);
            if (e.key === "Escape") app.setCommandOpen(false);
          }}
        />
        <div className="cmd-list">
          {filtered.map((cmd, i) => (
            <div
              key={cmd.label}
              className={`cmd ${i === cursor ? "active" : ""}`}
              onMouseEnter={() => setCursor(i)}
              onClick={() => runCommand(cmd)}
            >
              <Icon name={cmd.icon} size={15} />
              <span>{cmd.label}</span>
              {cmd.kbd ? <span className="kbd">{cmd.kbd}</span> : <span />}
            </div>
          ))}
          {filtered.length === 0 && <div className="empty-note">No matching commands.</div>}
        </div>
      </div>
    </div>
  );
}
