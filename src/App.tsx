import { useEffect } from "react";
import { useShallow } from "zustand/react/shallow";
import { useIsFetching } from "@tanstack/react-query";
import { LoadingBar } from "./ui/LoadingBar";
import { Titlebar } from "./components/Titlebar";
import { Sidebar } from "./components/Sidebar";
import { TabsBar } from "./components/TabsBar";
import { Inspector } from "./components/Inspector";
import { Statusbar } from "./components/Statusbar";
import { CommandPalette } from "./components/CommandPalette";
import { Toast } from "./components/Toast";
import { Dialog } from "./components/Dialog";
import { PanelResizeHandles } from "./components/ResizeHandles";
import { WelcomeView } from "./components/views/WelcomeView";
import { ConnectionView } from "./components/views/ConnectionView";
import { TopicsView } from "./components/views/TopicsView";
import { GroupsView } from "./components/views/GroupsView";
import { GroupDetailView } from "./components/views/GroupDetailView";
import { ClusterView } from "./components/views/ClusterView";
import { ProduceView } from "./components/views/ProduceView";
import { MessagesView } from "./components/views/MessagesView";
import { SettingsView } from "./components/views/SettingsView";
import { inspectorAvailable, useApp } from "./store";
import { themeBase } from "./lib/themes";
import { retintMonaco } from "./lib/monaco";
import { applyPalette, readBuiltinPalette } from "./lib/themeContract";
import type { TabDef } from "./lib/types";
import { Icon } from "./ui/Icon";

function renderView(tab: TabDef, active: boolean) {
  switch (tab.kind) {
    case "welcome": return <WelcomeView key={tab.id} active={active} />;
    case "connection": return <ConnectionView key={tab.id} active={active} />;
    case "topics": return <TopicsView key={tab.id} active={active} />;
    case "groups": return <GroupsView key={tab.id} active={active} />;
    case "group": return <GroupDetailView key={tab.id} tabId={tab.id} active={active} />;
    case "messages": return <MessagesView key={tab.id} tabId={tab.id} active={active} />;
    case "cluster": return <ClusterView key={tab.id} active={active} />;
    case "produce": return <ProduceView key={tab.id} active={active} />;
    case "settings": return <SettingsView key={tab.id} active={active} />;
  }
}

export default function App() {
  const {
    tabs, activeTabId, theme, compact, leftCollapsed, rightCollapsed,
    toggleLeft, toggleRight, setCommandOpen, openMessagesTab,
  } = useApp(
    useShallow((s) => ({
      tabs: s.tabs, activeTabId: s.activeTabId, theme: s.theme, compact: s.compact,
      leftCollapsed: s.leftCollapsed, rightCollapsed: s.rightCollapsed,
      toggleLeft: s.toggleLeft, toggleRight: s.toggleRight,
      setCommandOpen: s.setCommandOpen, openMessagesTab: s.openMessagesTab,
    })),
  );

  const inspectorOk = useApp((s) => inspectorAvailable(s));
  const fetching = useIsFetching() > 0;
  const uiFont = useApp((s) => s.uiFont);
  const editorFont = useApp((s) => s.editorFont);
  const uiFontSize = useApp((s) => s.uiFontSize);

  // custom fonts override the design token stacks
  useEffect(() => {
    const st = document.documentElement.style;
    st.setProperty("--font-body", uiFont ? `"${uiFont}", var(--font-body-default)` : "var(--font-body-default)");
    st.setProperty("--font-mono", editorFont ? `"${editorFont}", var(--font-mono-default)` : "var(--font-mono-default)");
  }, [uiFont, editorFont]);

  // app-wide UI scale — base.css html rule reads this as its font-size
  useEffect(() => {
    document.documentElement.style.setProperty("--ui-font-size", `${uiFontSize}px`);
  }, [uiFontSize]);

  // mirror UI state onto <body> so the ported design CSS keeps working
  useEffect(() => {
    const cls = document.body.classList;
    const base = themeBase(theme);
    document.body.dataset.theme = theme;
    cls.toggle("light", base === "light");
    requestAnimationFrame(() => {
      const cs = getComputedStyle(document.body);
      const v = (name: string) => cs.getPropertyValue(name).trim();
      const palette = readBuiltinPalette(cs);
      applyPalette(document.body.style, palette);
      // sync Monaco's own theme (bg + syntax colors) to the active app theme's palette
      retintMonaco(base, {
        accentPrimary: v("--accent-primary"),
        accentFocus: v("--accent-focus"),
        syntaxKey: v("--blue-2"),
        syntaxString: v("--syntax-string"),
        syntaxNumber: v("--syntax-number"),
        syntaxBoolean: v("--syntax-boolean"),
        textPrimary: v("--text-primary"),
        textMuted: v("--text-muted"),
        editorForeground: v("--editor-fg"),
        surfaceEditor: v("--surface-editor"),
        surfaceRaised: v("--surface-raised"),
        borderDefault: v("--border-default"),
        statusDanger: v("--status-danger"),
        statusWarning: v("--status-warning"),
      });
    });
    cls.toggle("compact", compact);
    cls.toggle("left-collapsed", leftCollapsed);
    cls.toggle("right-collapsed", rightCollapsed);
    cls.toggle("inspector-unavailable", !inspectorOk);
  }, [theme, compact, leftCollapsed, rightCollapsed, inspectorOk]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      if (mod && key === "k") {
        e.preventDefault();
        setCommandOpen(true);
      }
      if (mod && key === "n") {
        e.preventDefault();
        openMessagesTab();
      }
      if (mod && e.key === "Enter") {
        e.preventDefault();
        useApp.getState().runActive();
      }
      if (mod && key === "b") {
        e.preventDefault();
        toggleLeft();
      }
      if (mod && key === "r") {
        e.preventDefault();
        toggleRight();
      }
      if (mod && key === "t") {
        e.preventDefault();
        useApp.getState().openTab("topics");
      }
      if (mod && key === "g") {
        e.preventDefault();
        useApp.getState().openTab("groups");
      }
      if (mod && e.key === ",") {
        e.preventDefault();
        useApp.getState().openTab("settings");
      }
      if (mod && key === "w") {
        e.preventDefault();
        const s = useApp.getState();
        s.closeTab(s.activeTabId);
      }
      // ⌘1…⌘9 — jump to the Nth tab
      if (mod && key >= "1" && key <= "9") {
        const s = useApp.getState();
        const tab = s.tabs[Number(key) - 1];
        if (tab) {
          e.preventDefault();
          s.activateTab(tab.id);
        }
      }
      // ⌘+/⌘- — app-wide UI font size, 0.5px per press
      if (mod && (e.key === "=" || e.key === "+")) {
        e.preventDefault();
        const s = useApp.getState();
        s.setUiFontSize(s.uiFontSize + 0.5);
      }
      if (mod && (e.key === "-" || e.key === "_")) {
        e.preventDefault();
        const s = useApp.getState();
        s.setUiFontSize(s.uiFontSize - 0.5);
      }
      if (e.key === "Escape") setCommandOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [setCommandOpen, openMessagesTab, toggleLeft, toggleRight]);

  return (
    <div className="app-frame">
      <LoadingBar active={fetching} />
      <Titlebar />
      <main className="main">
        <Sidebar />
        <section className="workspace">
          <TabsBar />
          {tabs.map((tab) => renderView(tab, tab.id === activeTabId))}
        </section>
        <Inspector />
        <PanelResizeHandles />
      </main>
      <Statusbar />
      <button
        type="button"
        className={`tool-btn panel-toggle panel-corner left ${leftCollapsed ? "" : "active"}`}
        title="Toggle left sidebar (⌘B)"
        aria-label="Toggle left sidebar"
        onClick={toggleLeft}
      >
        <Icon name="panel-left" />
      </button>
      <button
        type="button"
        className={`tool-btn panel-toggle panel-corner right ${rightCollapsed || !inspectorOk ? "" : "active"}`}
        title="Toggle right inspector (⌘R)"
        aria-label="Toggle right inspector"
        onClick={toggleRight}
      >
        <Icon name="panel-right" />
      </button>
      <CommandPalette />
      <Toast />
      <Dialog />
    </div>
  );
}
