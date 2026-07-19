import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useShallow } from "zustand/react/shallow";
import { useApp } from "../store";
import { useClusterMeta, useGroups } from "../lib/queries";
import { Icon, type IconName } from "../ui/Icon";
import { fuzzyMatch, highlight } from "../lib/fuzzy";

interface Command {
  icon: IconName;
  label: string;
  kbd?: string;
  action: () => void;
}

function renderHL(text: string, indices: number[]): ReactNode {
  if (!indices.length) return text;
  return highlight(text, indices).map((p, i) =>
    p.mark ? <mark key={i}>{p.text}</mark> : <Fragment key={i}>{p.text}</Fragment>,
  );
}

// ponytail: recents persisted in localStorage, max 3 shown.
const REC_KEY = "kafkamin:cmd-recents";
const REC_SHOW = 3;
const REC_KEEP = 8;
function readRecents(): string[] {
  try { return JSON.parse(localStorage.getItem(REC_KEY) ?? "[]") as string[]; } catch { return []; }
}
function pushRecent(label: string): void {
  const cur = readRecents().filter((l) => l !== label);
  cur.unshift(label);
  try { localStorage.setItem(REC_KEY, JSON.stringify(cur.slice(0, REC_KEEP))); } catch { /* ignore */ }
}

export function CommandPalette() {
  const [input, setInput] = useState("");
  const [cursor, setCursor] = useState(0);
  const [recents, setRecents] = useState<string[]>([]);
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
      setRecents(readRecents());
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

  const filtered = useMemo<Array<Command & { labelIdx: number[]; recent: boolean }>>(() => {
    const q = input.trim();
    const mFor = (c: Command) => (q ? fuzzyMatch(q, c.label) : ({ indices: [] as number[], score: 0 } as const));

    const recentResolved = recents
      .map((l) => commands.find((c) => c.label === l))
      .filter((c): c is Command => !!c)
      .slice(0, REC_SHOW);
    const recentMatches = recentResolved
      .map((c) => ({ cmd: c, m: mFor(c) }))
      .filter((x) => !!x.m)
      .sort((a, b) => (b.m?.score ?? 0) - (a.m?.score ?? 0));
    const recentLabels = new Set(recentMatches.map((x) => x.cmd.label));

    const restMatches = commands
      .filter((c) => !recentLabels.has(c.label))
      .map((c) => ({ cmd: c, m: mFor(c) }))
      .filter((x) => !!x.m)
      .sort((a, b) => (b.m?.score ?? 0) - (a.m?.score ?? 0));

    const out: Array<Command & { labelIdx: number[]; recent: boolean }> = [];
    for (const x of recentMatches) out.push({ ...x.cmd, labelIdx: x.m!.indices, recent: true });
    for (const x of restMatches) out.push({ ...x.cmd, labelIdx: x.m!.indices, recent: false });
    return out.slice(0, 12);
  }, [commands, input, recents]);

  if (!app.commandOpen) return null;

  const runCommand = (cmd: Command) => {
    app.setCommandOpen(false);
    pushRecent(cmd.label);
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
            <Fragment key={cmd.label}>
              {(i === 0 || filtered[i - 1].recent !== cmd.recent) && <div className="cmd-group">{cmd.recent ? "Recents" : "Commands"}</div>}
              <div
                className={`cmd ${i === cursor ? "active" : ""}`}
                onMouseEnter={() => setCursor(i)}
                onClick={() => runCommand(cmd)}
              >
                <Icon name={cmd.icon} size={15} />
                <span>{renderHL(cmd.label, cmd.labelIdx)}</span>
                {cmd.kbd ? <span className="kbd">{cmd.kbd}</span> : <span />}
              </div>
            </Fragment>
          ))}
          {filtered.length === 0 && <div className="empty-note">No matching commands.</div>}
        </div>
      </div>
    </div>
  );
}
