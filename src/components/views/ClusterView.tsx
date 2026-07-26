import { useState } from "react";
import { Badge } from "../../ui/Badge";
import { Metric } from "../../ui/MetricPanel";
import { ToolButton } from "../../ui/ToolButton";
import { Icon } from "../../ui/Icon";
import { useActiveConnection, useBrokerConfig, useClusterHealth, useGroups } from "../../lib/queries";
import type { PartitionDetail } from "../../lib/types";

/** hard cap on rendered partition rows — huge clusters scroll via the filter instead */
const MAX_PARTITION_ROWS = 400;

function partitionStatus(p: PartitionDetail): { label: string; tone: "green" | "yellow" | "red" } {
  if (p.leader < 0) return { label: "offline", tone: "red" };
  if (p.isr.length < p.replicas.length) return { label: "under-replicated", tone: "yellow" };
  return { label: "ok", tone: "green" };
}

function BrokerConfigPanel({ broker, onClose }: { broker: number; onClose: () => void }) {
  const [filter, setFilter] = useState("");
  const config = useBrokerConfig(broker);
  const q = filter.trim().toLowerCase();
  const rows = (config.data ?? []).filter((e) => !q || e.name.includes(q));
  return (
    <div className="panel" style={{ margin: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <h3 style={{ margin: 0 }}>Broker {broker} config</h3>
        <input
          className="index-search"
          style={{ width: 220 }}
          placeholder="Filter settings"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <span style={{ flex: 1 }} />
        <Badge>{config.data ? `${rows.length} settings` : "loading…"}</Badge>
        <ToolButton title="Close broker config" onClick={onClose}><Icon name="x" /></ToolButton>
      </div>
      {config.isError && <div className="empty-note">Unable to load broker config: {String(config.error)}</div>}
      {config.data && (
        <table style={{ marginTop: 8 }}>
          <thead>
            <tr>
              <th>Setting</th>
              <th>Value</th>
              <th style={{ width: 160 }}>Source</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e.name}>
                <td style={{ fontFamily: "var(--font-mono)", fontSize: "0.8462rem" }}>{e.name}</td>
                <td style={{ fontFamily: "var(--font-mono)", fontSize: "0.8462rem", wordBreak: "break-all" }}>
                  {e.isSensitive ? "•••" : e.value ?? "—"}
                </td>
                <td style={{ color: e.isDefault ? "var(--text-3)" : "var(--orange)" }}>{e.source}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export function ClusterView({ active }: { active: boolean }) {
  const conn = useActiveConnection();
  const health = useClusterHealth();
  const groups = useGroups();
  const [selBroker, setSelBroker] = useState<number | null>(null);
  const [pFilter, setPFilter] = useState("");
  const [problemsOnly, setProblemsOnly] = useState(false);
  const [showInternal, setShowInternal] = useState(false);

  const data = health.data;
  const userTopics = (data?.topics ?? []).filter((t) => !t.internal);
  const totalPartitions = userTopics.reduce((sum, t) => sum + t.partitions.length, 0);

  const q = pFilter.trim().toLowerCase();
  const partitionRows = (data?.topics ?? [])
    .filter((t) => showInternal || !t.internal)
    .filter((t) => !q || t.name.toLowerCase().includes(q))
    .flatMap((t) => t.partitions.map((p) => ({ topic: t.name, ...p, status: partitionStatus(p) })))
    .filter((r) => !problemsOnly || r.status.tone !== "green");
  const shownRows = partitionRows.slice(0, MAX_PARTITION_ROWS);

  return (
    <section className={`content indexes-view ${active ? "active" : ""}`}>
      <div className="index-searchbar">
        <strong style={{ color: "var(--text)" }}>{conn ? conn.name : "no connection"}</strong>
        <span style={{ color: "var(--text-3)", font: "0.9231rem var(--font-mono)" }}>{conn?.brokers ?? ""}</span>
        <span />
        <Badge tone={!conn ? "idle" : health.isError ? "red" : data ? "green" : "idle"}>
          {!conn ? "setup required" : health.isError ? "unreachable" : data ? "connected" : "connecting…"}
        </Badge>
      </div>
      <div className="index-table-wrap">
        {!conn && <div className="empty-note">Connect to a cluster to inspect brokers.</div>}
        {conn && health.isError && <div className="empty-note">Cluster unreachable: {String(health.error)}</div>}
        {data && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12, margin: 12 }}>
              <Metric label="Brokers" value={data.brokers.length} />
              <Metric label="Topics" value={userTopics.length} />
              <Metric label="Partitions" value={totalPartitions} />
              <Metric label="Consumer groups" value={groups.data?.length ?? "…"} />
              <Metric
                label="Under-replicated"
                value={data.underReplicated}
                color={data.underReplicated > 0 ? "var(--orange)" : "var(--green)"}
              />
              <Metric
                label="Offline partitions"
                value={data.offline}
                color={data.offline > 0 ? "var(--red)" : "var(--green)"}
              />
            </div>

            <div className="panel" style={{ margin: 12 }}>
              <h3>Brokers</h3>
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 90 }}>ID</th>
                    <th>Host</th>
                    <th style={{ width: 100 }}>Port</th>
                    <th style={{ width: 130 }} title="Partitions this broker leads">Leaders</th>
                    <th style={{ width: 130 }} title="Partition replicas hosted here, leaders included">Replicas</th>
                  </tr>
                </thead>
                <tbody>
                  {data.brokers.map((b) => (
                    <tr
                      key={b.id}
                      className={b.id === selBroker ? "selected" : ""}
                      title="Click to view this broker's config"
                      onClick={() => setSelBroker((cur) => (cur === b.id ? null : b.id))}
                    >
                      <td title={b.id === data.origBrokerId ? "Broker answering this app's requests" : undefined}>
                        {b.id}
                        {b.id === data.origBrokerId && <Badge tone="green" style={{ marginLeft: 8 }}>via</Badge>}
                      </td>
                      <td>{b.host}</td>
                      <td>{b.port}</td>
                      <td>{b.leaders}</td>
                      <td>{b.replicas}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {selBroker != null && <BrokerConfigPanel broker={selBroker} onClose={() => setSelBroker(null)} />}

            <div className="panel" style={{ margin: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <h3 style={{ margin: 0 }}>Partitions</h3>
                <input
                  className="index-search"
                  style={{ width: 220 }}
                  placeholder="Filter by topic"
                  value={pFilter}
                  onChange={(e) => setPFilter(e.target.value)}
                />
                <label style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--text-2)" }}>
                  <input type="checkbox" className="row-check" checked={problemsOnly} onChange={() => setProblemsOnly((v) => !v)} />
                  problems only
                </label>
                <label style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--text-2)" }}>
                  <input type="checkbox" className="row-check" checked={showInternal} onChange={() => setShowInternal((v) => !v)} />
                  internal
                </label>
                <span style={{ flex: 1 }} />
                <Badge tone={problemsOnly && partitionRows.length > 0 ? "yellow" : undefined}>
                  {partitionRows.length} partition{partitionRows.length === 1 ? "" : "s"}
                </Badge>
              </div>
              {partitionRows.length === 0 && (
                <div className="empty-note">{problemsOnly ? "No under-replicated or offline partitions. 🎉" : "No partitions match the filter."}</div>
              )}
              {shownRows.length > 0 && (
                <table style={{ marginTop: 8 }}>
                  <thead>
                    <tr>
                      <th>Topic</th>
                      <th style={{ width: 60 }}>P</th>
                      <th style={{ width: 90 }}>Leader</th>
                      <th style={{ width: 140 }}>Replicas</th>
                      <th style={{ width: 140 }}>ISR</th>
                      <th style={{ width: 150 }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shownRows.map((r) => (
                      <tr key={`${r.topic}-${r.id}`}>
                        <td>{r.topic}</td>
                        <td>{r.id}</td>
                        <td>{r.leader < 0 ? "—" : r.leader}</td>
                        <td style={{ fontFamily: "var(--font-mono)", fontSize: "0.8462rem" }}>[{r.replicas.join(", ")}]</td>
                        <td style={{ fontFamily: "var(--font-mono)", fontSize: "0.8462rem" }}>[{r.isr.join(", ")}]</td>
                        <td><Badge tone={r.status.tone}>{r.status.label}</Badge></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {partitionRows.length > MAX_PARTITION_ROWS && (
                <div className="empty-note">
                  Showing {MAX_PARTITION_ROWS} of {partitionRows.length} — narrow the topic filter to see the rest.
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
