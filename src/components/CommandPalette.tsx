import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { motion, AnimatePresence } from "motion/react";
import { useShallow } from "zustand/react/shallow";
import { useApp } from "../store";
import { useClusterMeta, useGroups } from "../lib/queries";
import { Icon, type IconName } from "../ui/Icon";
import { ToolButton } from "../ui/ToolButton";
import { THEMES } from "../lib/themes";
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
  const [themePicker, setThemePicker] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const meta = useClusterMeta();
  const groups = useGroups();
  const app = useApp(
    useShallow((s) => ({
      commandOpen: s.commandOpen, connections: s.connections, openTab: s.openTab,
      openMessagesTab: s.openMessagesTab, openGroupTab: s.openGroupTab, setEditingConn: s.setEditingConn, toggleLeft: s.toggleLeft,
      toggleRight: s.toggleRight, toggleTheme: s.toggleTheme, toggleCompact: s.toggleCompact,
      setActiveConn: s.setActiveConn, setActiveTopic: s.setActiveTopic, setCommandOpen: s.setCommandOpen, vimMode: s.vimMode,
      theme: s.theme, setTheme: s.setTheme,
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
      { icon: "settings", label: "Theme picker", action: () => setThemePicker(true) },
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

  const runCommand = (cmd: Command) => {
    app.setCommandOpen(false);
    pushRecent(cmd.label);
    cmd.action();
  };

  return (
    <>
    <AnimatePresence>
      {app.commandOpen && (
    <motion.div
      key="command-palette-backdrop"
      className="command"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.16, ease: [0.32, 0.72, 0, 1] }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) app.setCommandOpen(false);
      }}
    >
      <motion.div
        key="command-palette-modal"
        className="palette"
        initial={{ opacity: 0, y: -12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -12, scale: 0.98 }}
        transition={{ type: "spring", stiffness: 450, damping: 32 }}
      >
        <input
          ref={inputRef}
          value={input}
          placeholder="Run command, open topic, switch connection..."
          onChange={(e) => {
            setInput(e.target.value);
            setCursor(0);
          }}
          onKeyDown={(e) => {
            const next = e.key === "Tab" || (app.vimMode && e.ctrlKey && e.key.toLowerCase() === "n");
            const previous = app.vimMode && e.ctrlKey && e.key.toLowerCase() === "p";
            if (e.key === "ArrowDown" || next) {
              e.preventDefault();
              setCursor((c) => Math.min(Math.max(0, filtered.length - 1), c + 1));
            }
            if (e.key === "ArrowUp" || previous) {
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
      </motion.div>
    </motion.div>
      )}
    </AnimatePresence>
    <AnimatePresence>
      {themePicker && (
        <motion.div
          key="theme-picker-backdrop"
          className="modal"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18, ease: [0.32, 0.72, 0, 1] }}
          onMouseDown={(e) => { if (e.target === e.currentTarget) setThemePicker(false); }}
        >
          <motion.div
            key="theme-picker-content"
            className="prompt-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Theme picker"
            initial={{ opacity: 0, scale: 0.95, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 8 }}
            transition={{ type: "spring", stiffness: 420, damping: 30 }}
          >
            <strong>Theme picker</strong>
            <p className="prompt-dialog-msg">Changes apply immediately and are saved for this device.</p>
            <select className="side-search" style={{ width: "100%" }} value={app.theme} autoFocus onChange={(event) => app.setTheme(event.target.value)}>
              <optgroup label="Dark">{THEMES.filter((item) => item.base === "dark").map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</optgroup>
              <optgroup label="Light">{THEMES.filter((item) => item.base === "light").map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</optgroup>
            </select>
            <div className="prompt-dialog-foot"><ToolButton variant="primary" onClick={() => setThemePicker(false)}>Done</ToolButton></div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
    </>
  );
}
