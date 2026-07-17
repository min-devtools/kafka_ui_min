import { create } from "zustand";
import { isThemeId, themeBase } from "./lib/themes";
import { clampFontSize, DEFAULT_FONT_SIZE } from "./lib/fontScale";
import type { Connection, GroupTabState, MessageRec, MessagesTabState, TabDef, TabKind } from "./lib/types";

const TAB_META: Record<TabKind, { title: string; icon: TabDef["icon"]; iconClass: string }> = {
  welcome: { title: "Welcome", icon: "sparkles", iconClass: "soft-blue" },
  connection: { title: "New Connection", icon: "plug", iconClass: "soft-blue" },
  topics: { title: "Topics", icon: "topics", iconClass: "soft-orange" },
  groups: { title: "Consumer Groups", icon: "groups", iconClass: "soft-green" },
  group: { title: "Group", icon: "groups", iconClass: "soft-green" },
  messages: { title: "Messages", icon: "docs", iconClass: "soft-blue" },
  cluster: { title: "Cluster", icon: "cluster", iconClass: "soft-green" },
  produce: { title: "Produce", icon: "send", iconClass: "soft-green" },
  settings: { title: "Settings", icon: "settings", iconClass: "soft-orange" },
};

function msgTabTitle(topic: string): string {
  return topic || "Messages";
}

/** Restore last session's open tabs from localStorage (results are not persisted). */
function loadSession(): {
  tabs: TabDef[];
  activeTabId: string;
  msgTabs: Record<string, MessagesTabState>;
  groupTabs: Record<string, GroupTabState>;
  msgTabCounter: number;
  activeTopic: string | null;
  topicRecency: string[];
} | null {
  try {
    const raw = localStorage.getItem("kafkamin:session");
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (!Array.isArray(s.tabs) || s.tabs.length === 0) return null;
    const msgTabs: Record<string, MessagesTabState> = {};
    for (const [id, mt] of Object.entries<any>(s.msgTabs ?? {})) {
      msgTabs[id] = { topic: typeof mt.topic === "string" ? mt.topic : "" };
    }
    const groupTabs: Record<string, GroupTabState> = {};
    for (const [id, gt] of Object.entries<any>(s.groupTabs ?? {})) {
      if (typeof gt.group === "string" && gt.group) groupTabs[id] = { group: gt.group };
    }
    const tabs: TabDef[] = s.tabs
      .filter((t: TabDef) =>
        TAB_META[t.kind] && (t.kind !== "messages" || msgTabs[t.id]) && (t.kind !== "group" || groupTabs[t.id]))
      .map((t: TabDef) => ({
        ...t,
        icon: TAB_META[t.kind].icon,
        iconClass: TAB_META[t.kind].iconClass,
        // re-derive messages titles so stale "Messages · topic" prefixes from old sessions die
        title: t.kind === "messages" ? msgTabTitle(msgTabs[t.id].topic) : t.kind === "group" ? groupTabs[t.id].group : t.title,
      }));
    if (!tabs.length) return null;
    return {
      tabs,
      activeTabId: tabs.some((t) => t.id === s.activeTabId) ? s.activeTabId : tabs[0].id,
      msgTabs,
      groupTabs,
      msgTabCounter: Number(s.msgTabCounter) || 0,
      activeTopic: typeof s.activeTopic === "string" ? s.activeTopic : null,
      topicRecency: Array.isArray(s.topicRecency)
        ? s.topicRecency.filter((t: unknown) => typeof t === "string")
        : [],
    };
  } catch {
    return null;
  }
}

const session = loadSession();

export interface ToastMsg {
  title: string;
  body: string;
  kind?: "ok" | "warn" | "err";
}

export interface DialogRequest {
  kind: "prompt" | "confirm";
  title: string;
  message?: string;
  defaultValue?: string;
  confirmLabel?: string;
  danger?: boolean;
}

interface AppState {
  connections: Connection[];
  activeConnId: string | null;

  tabs: TabDef[];
  activeTabId: string;
  msgTabs: Record<string, MessagesTabState>;
  groupTabs: Record<string, GroupTabState>;
  msgTabCounter: number;

  activeTopic: string | null;
  /** topic names, most-recently-acted-on first — drives sidebar ordering */
  topicRecency: string[];
  /** message selected in a Messages tab — shown in the right-dock inspector */
  selectedMsg: MessageRec | null;
  /** connection being edited in the Connection tab (null = new draft) */
  editingConnId: string | null;

  theme: string;
  compact: boolean;
  /** vim keybindings in the JS filter editor (monaco-vim) */
  vimMode: boolean;
  /** app-wide UI font size in px (1rem base) */
  uiFontSize: number;
  /** UI font family ("" = design default) */
  uiFont: string;
  /** mono font family for payloads ("" = design default) */
  editorFont: string;
  leftCollapsed: boolean;
  rightCollapsed: boolean;
  commandOpen: boolean;
  /** bumped by ⌘↵ / titlebar play — the active Messages tab reacts by loading */
  runNonce: number;
  toast: ToastMsg | null;
  dialog: (DialogRequest & { resolve: (value: string | null) => void }) | null;

  // actions
  setConnections: (conns: Connection[]) => void;
  saveConnection: (conn: Connection) => void;
  deleteConnection: (id: string) => void;
  setActiveConn: (id: string | null) => void;

  openTab: (kind: TabKind) => void;
  openMessagesTab: (topic?: string) => string;
  openGroupTab: (group: string) => void;
  closeTab: (id: string) => void;
  activateTab: (id: string) => void;
  reorderTab: (id: string, beforeId: string | null) => void;
  renameTab: (id: string, title: string) => void;

  setActiveTopic: (topic: string | null) => void;
  bumpTopicRecency: (topic: string) => void;
  selectMsg: (msg: MessageRec | null) => void;
  setEditingConn: (id: string | null) => void;
  setTheme: (id: string) => void;

  toggleTheme: () => void;
  toggleCompact: () => void;
  toggleVim: () => void;
  setUiFontSize: (size: number) => void;
  setUiFont: (font: string) => void;
  setEditorFont: (font: string) => void;
  toggleLeft: () => void;
  toggleRight: () => void;
  setCommandOpen: (open: boolean) => void;
  runActive: () => void;
  showToast: (title: string, body: string, kind?: ToastMsg["kind"]) => void;
  clearToast: () => void;
  /** in-app replacement for window.prompt/confirm — those are unimplemented in the Tauri webview */
  openDialog: (req: DialogRequest) => Promise<string | null>;
}

let toastTimer: number | undefined;

export const activeConnection = (s: Pick<AppState, "connections" | "activeConnId">) =>
  s.connections.find((c) => c.id === s.activeConnId) ?? null;

export const inspectorAvailable = (s: Pick<AppState, "tabs" | "activeTabId">) => {
  const tab = s.tabs.find((t) => t.id === s.activeTabId);
  return tab?.kind === "messages";
};

export const useApp = create<AppState>((set, get) => ({
  connections: [],
  activeConnId: null,

  tabs: session?.tabs ?? [{ id: "welcome", kind: "welcome", ...TAB_META.welcome }],
  activeTabId: session?.activeTabId ?? "welcome",
  msgTabs: session?.msgTabs ?? {},
  groupTabs: session?.groupTabs ?? {},
  msgTabCounter: session?.msgTabCounter ?? 0,

  activeTopic: session?.activeTopic ?? null,
  topicRecency: session?.topicRecency ?? [],
  selectedMsg: null,
  editingConnId: null,

  // default = Bearded Arc (shared with elatic_min/requests_min); invalid stored themes fall back
  theme: (() => {
    const stored = localStorage.getItem("kafkamin:theme-v2");
    return stored && isThemeId(stored) ? stored : "default-dark";
  })(),
  compact: localStorage.getItem("kafkamin:compact") === "1",
  vimMode: localStorage.getItem("kafkamin:vim") === "1",
  uiFontSize: clampFontSize(Number(localStorage.getItem("kafkamin:ui-font-size")) || DEFAULT_FONT_SIZE),
  uiFont: localStorage.getItem("kafkamin:ui-font") ?? "",
  editorFont: localStorage.getItem("kafkamin:editor-font") ?? "",
  leftCollapsed: false,
  rightCollapsed: true,
  commandOpen: false,
  runNonce: 0,
  toast: null,
  dialog: null,

  setConnections: (conns) => set({ connections: conns }),
  saveConnection: (conn) =>
    set((s) => {
      const existing = s.connections.findIndex((c) => c.id === conn.id);
      const connections =
        existing >= 0
          ? s.connections.map((c) => (c.id === conn.id ? conn : c))
          : [...s.connections, conn];
      return { connections };
    }),
  deleteConnection: (id) =>
    set((s) => ({
      connections: s.connections.filter((c) => c.id !== id),
      activeConnId: s.activeConnId === id ? null : s.activeConnId,
    })),
  setActiveConn: (id) => set({ activeConnId: id, selectedMsg: null, activeTopic: null, topicRecency: [] }),

  openTab: (kind) => {
    const s = get();
    if (kind === "messages") {
      get().openMessagesTab();
      return;
    }
    const existing = s.tabs.find((t) => t.kind === kind);
    if (existing) return set({ activeTabId: existing.id });
    set({
      tabs: [...s.tabs, { id: kind, kind, ...TAB_META[kind] }],
      activeTabId: kind,
    });
  },

  openMessagesTab: (topic) => {
    const s = get();
    const tp = topic ?? s.activeTopic ?? "";
    if (tp) get().bumpTopicRecency(tp);
    const existingId = s.tabs.find((t) => t.kind === "messages" && s.msgTabs[t.id]?.topic === tp)?.id;
    if (existingId) {
      set({ activeTabId: existingId });
      return existingId;
    }
    const n = s.msgTabCounter + 1;
    const id = `messages-${n}`;
    set({
      msgTabCounter: n,
      tabs: [...s.tabs, { id, kind: "messages", ...TAB_META.messages, title: msgTabTitle(tp) }],
      activeTabId: id,
      msgTabs: { ...s.msgTabs, [id]: { topic: tp } },
    });
    return id;
  },

  openGroupTab: (group) => {
    const s = get();
    const id = `group:${group}`;
    if (s.tabs.some((t) => t.id === id)) return set({ activeTabId: id });
    set({
      tabs: [...s.tabs, { id, kind: "group", ...TAB_META.group, title: group }],
      activeTabId: id,
      groupTabs: { ...s.groupTabs, [id]: { group } },
    });
  },

  closeTab: (id) =>
    set((s) => {
      const idx = s.tabs.findIndex((t) => t.id === id);
      if (idx < 0) return s;
      const tabs = s.tabs.filter((t) => t.id !== id);
      const msgTabs = { ...s.msgTabs };
      delete msgTabs[id];
      const groupTabs = { ...s.groupTabs };
      delete groupTabs[id];
      // renumber from 1 again once the last messages tab closes, instead of counting up forever
      const msgTabCounter = tabs.some((t) => t.kind === "messages") ? s.msgTabCounter : 0;
      let activeTabId = s.activeTabId;
      if (activeTabId === id) {
        const next = tabs[Math.min(idx, tabs.length - 1)];
        activeTabId = next?.id ?? "";
      }
      if (tabs.length === 0) {
        return {
          tabs: [{ id: "welcome", kind: "welcome", ...TAB_META.welcome }],
          activeTabId: "welcome",
          msgTabs,
          groupTabs,
          msgTabCounter,
        };
      }
      return { tabs, activeTabId, msgTabs, groupTabs, msgTabCounter };
    }),

  activateTab: (id) => set({ activeTabId: id }),

  reorderTab: (id, beforeId) =>
    set((s) => {
      if (id === beforeId) return s;
      const dragged = s.tabs.find((t) => t.id === id);
      if (!dragged) return s;
      const rest = s.tabs.filter((t) => t.id !== id);
      const idx = beforeId ? rest.findIndex((t) => t.id === beforeId) : -1;
      const tabs = idx < 0 ? [...rest, dragged] : [...rest.slice(0, idx), dragged, ...rest.slice(idx)];
      return { tabs };
    }),

  renameTab: (id, title) =>
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === id ? { ...t, title: title.trim() || t.title } : t)),
    })),

  setActiveTopic: (topic) => set({ activeTopic: topic }),
  bumpTopicRecency: (topic) =>
    set((s) => ({ topicRecency: [topic, ...s.topicRecency.filter((t) => t !== topic)] })),
  // auto show/hide the right-dock inspector with what's selected — nothing selected, nothing to show
  selectMsg: (msg) => set({ selectedMsg: msg, rightCollapsed: msg === null }),
  setEditingConn: (id) => set({ editingConnId: id }),
  setTheme: (id) => {
    localStorage.setItem("kafkamin:theme-v2", id);
    set({ theme: id });
  },

  toggleTheme: () =>
    set((s) => {
      // flip between light/dark base regardless of the current custom theme
      const theme = themeBase(s.theme) === "dark" ? "light" : "dark";
      localStorage.setItem("kafkamin:theme-v2", theme);
      return { theme };
    }),
  toggleCompact: () =>
    set((s) => {
      localStorage.setItem("kafkamin:compact", s.compact ? "0" : "1");
      return { compact: !s.compact };
    }),
  toggleVim: () =>
    set((s) => {
      localStorage.setItem("kafkamin:vim", s.vimMode ? "0" : "1");
      return { vimMode: !s.vimMode };
    }),
  setUiFontSize: (size) => {
    const clamped = clampFontSize(size || DEFAULT_FONT_SIZE);
    localStorage.setItem("kafkamin:ui-font-size", String(clamped));
    set({ uiFontSize: clamped });
  },
  setUiFont: (font) => {
    localStorage.setItem("kafkamin:ui-font", font);
    set({ uiFont: font });
  },
  setEditorFont: (font) => {
    localStorage.setItem("kafkamin:editor-font", font);
    set({ editorFont: font });
  },
  toggleLeft: () => set((s) => ({ leftCollapsed: !s.leftCollapsed })),
  toggleRight: () => set((s) => ({ rightCollapsed: !s.rightCollapsed })),
  setCommandOpen: (open) => set({ commandOpen: open }),
  runActive: () => set((s) => ({ runNonce: s.runNonce + 1 })),

  showToast: (title, body, kind) => {
    window.clearTimeout(toastTimer);
    set({ toast: { title, body, kind } });
    toastTimer = window.setTimeout(() => set({ toast: null }), 2600);
  },
  clearToast: () => {
    window.clearTimeout(toastTimer);
    set({ toast: null });
  },

  openDialog: (req) =>
    new Promise<string | null>((resolve) => {
      set({
        dialog: {
          ...req,
          resolve: (value) => {
            resolve(value);
            set({ dialog: null });
          },
        },
      });
    }),
}));
