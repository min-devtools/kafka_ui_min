import { Badge } from "../../ui/Badge";
import { useActiveConnection, useClusterMeta, useGroups } from "../../lib/queries";

export function ClusterView({ active }: { active: boolean }) {
  const conn = useActiveConnection();
  const meta = useClusterMeta();
  const groups = useGroups();

  const topics = (meta.data?.topics ?? []).filter((t) => !t.internal);
  const totalPartitions = topics.reduce((sum, t) => sum + t.partitions, 0);

  return (
    <section className={`content indexes-view ${active ? "active" : ""}`}>
      <div className="index-searchbar">
        <strong style={{ color: "var(--text)" }}>{conn ? conn.name : "no connection"}</strong>
        <span style={{ color: "var(--text-3)", font: "0.9231rem var(--font-mono)" }}>{conn?.brokers ?? ""}</span>
        <span />
        <Badge tone={!conn ? "idle" : meta.isError ? "red" : meta.data ? "green" : "idle"}>
          {!conn ? "setup required" : meta.isError ? "unreachable" : meta.data ? "connected" : "connecting…"}
        </Badge>
      </div>
      <div className="index-table-wrap">
        {!conn && <div className="empty-note">Connect to a cluster to inspect brokers.</div>}
        {conn && meta.isError && <div className="empty-note">Cluster unreachable: {String(meta.error)}</div>}
        {meta.data && (
          <>
            <div className="panel" style={{ margin: 12 }}>
              <h3>Overview</h3>
              <table>
                <tbody>
                  <tr><td>Brokers</td><td>{meta.data.brokers.length}</td></tr>
                  <tr><td>Topics</td><td>{topics.length}</td></tr>
                  <tr><td>Partitions (user topics)</td><td>{totalPartitions}</td></tr>
                  <tr><td>Consumer groups</td><td>{groups.data?.length ?? "…"}</td></tr>
                </tbody>
              </table>
            </div>
            <div className="panel" style={{ margin: 12 }}>
              <h3>Brokers</h3>
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 100 }}>ID</th>
                    <th>Host</th>
                    <th style={{ width: 120 }}>Port</th>
                  </tr>
                </thead>
                <tbody>
                  {meta.data.brokers.map((b) => (
                    <tr key={b.id}>
                      <td>{b.id}</td>
                      <td>{b.host}</td>
                      <td>{b.port}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
