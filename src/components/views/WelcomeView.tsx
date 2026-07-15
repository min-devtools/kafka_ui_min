import { ToolButton } from "../../ui/ToolButton";
import { Icon, type IconName } from "../../ui/Icon";
import { useApp } from "../../store";
import { useActiveConnection } from "../../lib/queries";

export function WelcomeView({ active }: { active: boolean }) {
  const conn = useActiveConnection();
  const { openTab, setEditingConn, openMessagesTab } = useApp();

  const newConnection = () => {
    setEditingConn(null);
    openTab("connection");
  };

  const actions: { icon: IconName; label: string; desc: string; onClick: () => void }[] = [
    { icon: "topics", label: "Browse topics", desc: "List topics, partitions and offsets.", onClick: () => openTab("topics") },
    { icon: "docs", label: "View messages", desc: "Tail and filter messages in a topic.", onClick: () => openMessagesTab() },
    { icon: "groups", label: "Consumer groups", desc: "States, members, lag and offsets.", onClick: () => openTab("groups") },
    { icon: "refresh", label: "Reset offsets", desc: "Rewind or fast-forward a group.", onClick: () => openTab("groups") },
    { icon: "plug", label: "New connection", desc: "Kafka or Redpanda, plaintext or SASL.", onClick: newConnection },
    { icon: "settings", label: "Settings", desc: "Theme, fonts and density.", onClick: () => openTab("settings") },
  ];

  return (
    <section className={`content welcome-view ${active ? "active" : ""}`}>
      <div className="welcome-shell">
        <div className="welcome-hero">
          <div className="welcome-copy">
            <div className="welcome-kicker">
              {conn ? `connected · ${conn.name}` : "no active connection"}
            </div>
            <h1 className="welcome-title">KafkaMin</h1>
            <p className="welcome-text">
              {conn
                ? "You're connected. Browse topics, tail messages or inspect consumer group lag."
                : "A tiny Kafka/Redpanda client. Connect to a cluster to load topics, messages and consumer groups."}
            </p>
            <div className="welcome-actions">
              <ToolButton variant="primary" onClick={conn ? () => openTab("topics") : newConnection}>
                <Icon name={conn ? "topics" : "zap"} /> {conn ? "Browse topics" : "New connection"}
              </ToolButton>
              <ToolButton onClick={conn ? newConnection : () => openTab("topics")}>
                <Icon name={conn ? "zap" : "topics"} /> {conn ? "Manage connection" : "Browse topics"}
              </ToolButton>
            </div>
          </div>
        </div>

        <div className="welcome-launch">
          {actions.map((a) => (
            <button type="button" className="welcome-card" key={a.label} onClick={a.onClick}>
              <span className="welcome-card-icon"><Icon name={a.icon} size={18} /></span>
              <strong>{a.label}</strong>
              <span className="welcome-card-desc">{a.desc}</span>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
