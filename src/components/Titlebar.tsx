import { useQueryClient } from "@tanstack/react-query";
import { ToolButton } from "../ui/ToolButton";
import { Badge } from "../ui/Badge";
import { Icon } from "../ui/Icon";
import { useApp } from "../store";
import { useActiveConnection, useClusterMeta } from "../lib/queries";
import logo from "../assets/logo.png";
import { themeBase } from "../lib/themes";

export function Titlebar() {
  const conn = useActiveConnection();
  const meta = useClusterMeta();
  const { toggleTheme, toggleCompact, setCommandOpen, showToast, theme, openTab, openMessagesTab, runActive, tabs, activeTabId } = useApp();
  const queryClient = useQueryClient();
  const activeKind = tabs.find((t) => t.id === activeTabId)?.kind;
  const activeIsMessages = activeKind === "messages" || activeKind === "produce";

  const tone = !conn ? "idle" : meta.isError ? "red" : meta.data ? "green" : "idle";
  const label = !conn
    ? "no cluster"
    : meta.isError
      ? "unreachable"
      : meta.data
        ? `${meta.data.brokers.length} broker${meta.data.brokers.length === 1 ? "" : "s"}`
        : "connecting…";

  return (
    <header className="titlebar" data-tauri-drag-region>
      <div className="traffic">
        <img src={logo} alt="" className="app-logo" />
        <strong>KafkaMin</strong>
        <Badge tone={tone}>{label}</Badge>
      </div>
      <button type="button" className="search" title="Search everywhere (⌘K)" onClick={() => setCommandOpen(true)}>
        <Icon name="search" size={13} />
        <span>Search Everywhere</span>
        <span style={{ marginLeft: "auto" }} />
        <kbd>⌘K</kbd>
      </button>
      <div className="toolbar">
        <ToolButton
          iconOnly
          variant="primary"
          title={activeIsMessages ? "Load messages (⌘↵)" : "Open messages for active topic (⌘N)"}
          aria-label="Load messages"
          onClick={() => (activeIsMessages ? runActive() : openMessagesTab())}
        >
          <Icon name="play" />
        </ToolButton>
        <ToolButton iconOnly title="Browse topics (⌘T)" aria-label="Browse topics" onClick={() => openTab("topics")}>
          <Icon name="topics" />
        </ToolButton>
        <ToolButton iconOnly title="Consumer groups (⌘G)" aria-label="Consumer groups" onClick={() => openTab("groups")}>
          <Icon name="groups" />
        </ToolButton>
        <ToolButton
          iconOnly
          title="Reload cluster metadata, topics and groups"
          aria-label="Refresh cluster data"
          onClick={() => {
            void queryClient.invalidateQueries();
            showToast("Refreshed", "Cluster metadata, topics and consumer groups are being reloaded.");
          }}
        >
          <Icon name="refresh" />
        </ToolButton>
        <ToolButton iconOnly title="Toggle theme" aria-label="Toggle theme" onClick={toggleTheme}>
          <Icon name={themeBase(theme) === "dark" ? "sun" : "moon"} />
        </ToolButton>
        <ToolButton iconOnly title="Toggle compact density" aria-label="Toggle compact density" onClick={toggleCompact}>
          <Icon name="rows" />
        </ToolButton>
        <ToolButton iconOnly title="Settings (⌘,)" aria-label="Open settings" onClick={() => openTab("settings")}>
          <Icon name="settings" />
        </ToolButton>
      </div>
    </header>
  );
}
