import { openUrl } from "@tauri-apps/plugin-opener";
import { useApp } from "../store";
import { useActiveConnection, useClusterMeta } from "../lib/queries";

export function Statusbar() {
  const conn = useActiveConnection();
  const meta = useClusterMeta();
  const { tabs, activeTabId, activeTopic, openTab, setEditingConn, openMessagesTab } = useApp();

  const activeTab = tabs.find((t) => t.id === activeTabId);
  const statusColor = !conn
    ? "var(--orange)"
    : meta.isError
      ? "var(--red)"
      : meta.data
        ? "var(--green)"
        : "var(--orange)";

  return (
    <footer className="statusbar">
      <div>
        <span
          style={{ cursor: "pointer" }}
          title="Open connection settings"
          onClick={() => {
            setEditingConn(conn?.id ?? null);
            openTab("connection");
          }}
        >
          {conn ? conn.name : "no connection"}
        </span>
        <span style={{ color: statusColor }}>
          {!conn ? "setup required" : meta.isError ? "unreachable" : meta.data ? "connected" : "connecting…"}
        </span>
      </div>
      <div>
        <span
          style={{ cursor: activeTopic ? "pointer" : undefined }}
          title={activeTopic ? "Open Messages (⌘N)" : undefined}
          onClick={() => activeTopic && openMessagesTab(activeTopic)}
        >
          {activeTopic ?? "no topic selected"}
        </span>
        <span>{meta.data ? `${meta.data.topics.filter((t) => !t.internal).length} topics` : "0 topics"}</span>
      </div>
      <div className="right-status">
        <span>{meta.data ? `${meta.data.brokers.length} brokers` : ""}</span>
        <span>UTF-8</span>
        <span>{activeTab?.title ?? ""}</span>
        <span>v{__APP_VERSION__}</span>
        <span
          className="credit"
          style={{ cursor: "pointer" }}
          title="Created by @ngthminhdev — open LinkedIn"
          onClick={() => openUrl("https://www.linkedin.com/in/ngthminh-dev/")}
        >
          by @ngthminhdev
        </span>
      </div>
    </footer>
  );
}
