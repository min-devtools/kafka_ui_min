import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ToolButton } from "../../ui/ToolButton";
import { FormRow } from "../../ui/FormRow";
import { StatusDot, type DotTone } from "../../ui/StatusDot";
import { Icon } from "../../ui/Icon";
import { JsonView } from "../../ui/JsonView";
import { useApp } from "../../store";
import { fetchGroups, fetchMetadata } from "../../lib/kafka";
import type { Connection, SaslMechanism, SecurityProtocol } from "../../lib/types";

type CheckState = "idle" | "pending" | "ok" | "fail";

const CHECKS: { key: string; label: string; code: string }[] = [
  { key: "metadata", label: "Brokers reachable", code: "Metadata request" },
  { key: "topics", label: "Topic listing", code: "Metadata · topics" },
  { key: "groups", label: "Consumer groups", code: "ListGroups" },
];

const toneFor: Record<CheckState, DotTone> = { idle: "idle", pending: "orange", ok: "green", fail: "red" };

function draftFrom(conn: Connection | null): Connection {
  return (
    conn ?? {
      id: crypto.randomUUID(),
      name: "local-redpanda",
      brokers: "localhost:9092",
      securityProtocol: "plaintext",
      saslMechanism: "PLAIN",
      username: "",
      password: "",
    }
  );
}

export function ConnectionView({ active }: { active: boolean }) {
  const queryClient = useQueryClient();
  const { connections, editingConnId, saveConnection, setActiveConn, openTab, closeTab, setEditingConn, showToast } = useApp();
  const editing = useMemo(
    () => connections.find((c) => c.id === editingConnId) ?? null,
    [connections, editingConnId],
  );
  const [draft, setDraft] = useState<Connection>(() => draftFrom(editing));
  const [checks, setChecks] = useState<Record<string, CheckState>>({});
  const [preview, setPreview] = useState<unknown>(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    setDraft(draftFrom(editing));
    setChecks({});
    setPreview(null);
  }, [editingConnId, editing]);

  const patch = (p: Partial<Connection>) => setDraft((d) => ({ ...d, ...p }));
  const sasl = draft.securityProtocol.startsWith("sasl");

  const runHandshake = async (): Promise<boolean> => {
    setTesting(true);
    setChecks({ metadata: "pending", topics: "pending", groups: "pending" });
    setPreview(null);
    let ok = true;
    const mark = (key: string, state: CheckState) => setChecks((c) => ({ ...c, [key]: state }));
    try {
      const meta = await fetchMetadata(draft);
      mark("metadata", "ok");
      mark("topics", "ok");
      let groupCount: number | null = null;
      try {
        const groups = await fetchGroups(draft);
        groupCount = groups.length;
        mark("groups", "ok");
      } catch {
        mark("groups", "fail");
        ok = false;
      }
      setPreview({
        brokers: meta.brokers.map((b) => `${b.host}:${b.port}`),
        topics: meta.topics.filter((t) => !t.internal).length,
        consumer_groups: groupCount,
        next: "browse topics",
      });
    } catch (err) {
      setChecks({ metadata: "fail", topics: "fail", groups: "fail" });
      setPreview({ error: String(err) });
      ok = false;
    } finally {
      setTesting(false);
    }
    return ok;
  };

  const save = async () => {
    const ok = await runHandshake();
    saveConnection(draft);
    setActiveConn(draft.id);
    void queryClient.invalidateQueries();
    showToast(
      ok ? "Connection saved" : "Saved with warnings",
      ok
        ? `${draft.name} is now the active connection.`
        : `${draft.name} saved, but some handshake checks failed.`,
      ok ? "ok" : "warn",
    );
    if (ok) {
      // done with setup — close this tab instead of leaving it around
      setEditingConn(null);
      closeTab("connection");
      openTab("topics");
    }
  };

  return (
    <section className={`content connection-view ${active ? "active" : ""}`}>
      <div className="create-head">
        <div>
          <div className="create-kicker">Connection setup</div>
          <strong>{editing ? `Edit connection · ${editing.name}` : "New Kafka/Redpanda connection"}</strong>
        </div>
        <div className="seg">
          <ToolButton disabled={testing} onClick={() => void runHandshake()}>
            <Icon name="zap" /> {testing ? "Testing…" : "Test handshake"}
          </ToolButton>
          <ToolButton variant="primary" disabled={testing} onClick={() => void save()}>
            <Icon name="save" /> Save connection
          </ToolButton>
        </div>
      </div>
      <div className="create-layout">
        <div className="create-card">
          <h3>Bootstrap servers and authentication</h3>
          <div className="create-form">
            <FormRow label="Name">
              <input value={draft.name} onChange={(e) => patch({ name: e.target.value })} />
            </FormRow>
            <FormRow label="Brokers">
              <input
                value={draft.brokers}
                placeholder="localhost:9092,localhost:9093"
                onChange={(e) => patch({ brokers: e.target.value })}
              />
            </FormRow>
            <FormRow label="Security">
              <select
                value={draft.securityProtocol}
                onChange={(e) => patch({ securityProtocol: e.target.value as SecurityProtocol })}
              >
                <option value="plaintext">Plaintext</option>
                <option value="ssl">SSL</option>
                <option value="sasl_plaintext">SASL plaintext</option>
                <option value="sasl_ssl">SASL SSL</option>
              </select>
            </FormRow>
            {sasl && (
              <>
                <FormRow label="Mechanism">
                  <select
                    value={draft.saslMechanism ?? "PLAIN"}
                    onChange={(e) => patch({ saslMechanism: e.target.value as SaslMechanism })}
                  >
                    <option value="PLAIN">PLAIN</option>
                    <option value="SCRAM-SHA-256">SCRAM-SHA-256</option>
                    <option value="SCRAM-SHA-512">SCRAM-SHA-512</option>
                  </select>
                </FormRow>
                <FormRow label="Username">
                  <input value={draft.username ?? ""} onChange={(e) => patch({ username: e.target.value })} />
                </FormRow>
                <FormRow label="Password">
                  <input
                    type="password"
                    value={draft.password ?? ""}
                    onChange={(e) => patch({ password: e.target.value })}
                  />
                </FormRow>
              </>
            )}
            <div className="connection-note">
              <strong>Redpanda works out of the box</strong>
              <span>
                Redpanda speaks the Kafka wire protocol — point the brokers field at its Kafka API
                port (default 9092) and everything here works unchanged.
              </span>
            </div>
          </div>
        </div>
        <div className="create-card">
          <h3>Handshake checks</h3>
          <div className="create-form">
            {CHECKS.map((c) => (
              <div className="check-row" key={c.key}>
                <StatusDot tone={toneFor[checks[c.key] ?? "idle"]} />
                <strong>{c.label}</strong>
                <code>{c.code}</code>
              </div>
            ))}
            {preview != null ? (
              <JsonView className="create-preview json-tree" value={preview} />
            ) : (
              <pre className="create-preview">Run “Test handshake” to check the brokers.</pre>
            )}
            <div className="seg">
              <ToolButton onClick={() => openTab("topics")}>Browse topics</ToolButton>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
