import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Badge } from "../ui/Badge";
import { ToolButton } from "../ui/ToolButton";
import { Icon } from "../ui/Icon";
import { useApp } from "../store";
import { useActiveConnection, useClusterMeta, useTopicConfig } from "../lib/queries";
import { addPartitions, alterTopicConfig } from "../lib/kafka";

/**
 * Per-topic admin: grow the partition count and inspect/edit the full broker-side
 * config. Edits go through legacy AlterConfigs — the backend resends the whole
 * override set so untouched overrides survive.
 */
export function TopicSettingsModal({ topic, onClose }: { topic: string; onClose: () => void }) {
  const conn = useActiveConnection();
  const meta = useClusterMeta();
  const config = useTopicConfig(topic);
  const queryClient = useQueryClient();
  const showToast = useApp((s) => s.showToast);

  const current = meta.data?.topics.find((t) => t.name === topic)?.partitions ?? 0;
  const [partitionsDraft, setPartitionsDraft] = useState("");
  const [filter, setFilter] = useState("");
  const [overridesOnly, setOverridesOnly] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [draftValue, setDraftValue] = useState("");
  const [busy, setBusy] = useState(false);

  // Capture-phase Esc, mirroring ResetModal — an open inline edit swallows the
  // first Esc (cancels the edit), the next one closes the modal.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      if (busy) return;
      if (editing != null) setEditing(null);
      else onClose();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [busy, editing, onClose]);

  const refreshConfig = () => void queryClient.invalidateQueries({ queryKey: ["topic-config"] });

  const growPartitions = async () => {
    const total = Math.floor(Number(partitionsDraft));
    if (!conn || !Number.isFinite(total) || total <= current) return;
    setBusy(true);
    try {
      await addPartitions(conn, topic, total);
      showToast("Partitions added", `${topic}: ${current} → ${total} partitions.`);
      setPartitionsDraft("");
      for (const key of ["cluster-meta", "cluster-health", "topic-offsets", "topic-stats"]) {
        void queryClient.invalidateQueries({ queryKey: [key] });
      }
    } catch (err) {
      showToast("Add partitions failed", String(err), "err");
    } finally {
      setBusy(false);
    }
  };

  const saveEdit = async (name: string) => {
    if (!conn) return;
    setBusy(true);
    try {
      await alterTopicConfig(conn, topic, { [name]: draftValue }, []);
      showToast("Config updated", `${topic} · ${name} = ${draftValue}`);
      setEditing(null);
      refreshConfig();
    } catch (err) {
      showToast("Config update failed", String(err), "err");
    } finally {
      setBusy(false);
    }
  };

  const resetOverride = async (name: string) => {
    if (!conn) return;
    setBusy(true);
    try {
      await alterTopicConfig(conn, topic, {}, [name]);
      showToast("Override cleared", `${topic} · ${name} back to broker default.`);
      refreshConfig();
    } catch (err) {
      showToast("Reset failed", String(err), "err");
    } finally {
      setBusy(false);
    }
  };

  const q = filter.trim().toLowerCase();
  const rows = (config.data ?? [])
    .filter((e) => !q || e.name.includes(q))
    .filter((e) => !overridesOnly || e.source === "dynamic-topic");
  const totalDraft = Math.floor(Number(partitionsDraft));
  const growValid = Number.isFinite(totalDraft) && totalDraft > current;

  return (
    <div className="modal" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="prompt-dialog" style={{ width: 680, maxHeight: "82vh", display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <strong>Topic settings · {topic}</strong>
          <span style={{ flex: 1 }} />
          <ToolButton disabled={busy} title="Close" onClick={onClose}><Icon name="x" /></ToolButton>
        </div>

        <div>
          <div style={{ color: "var(--text-3)", fontSize: "0.8462rem", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>
            Partitions
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <Badge>{meta.data ? `current ${current}` : "…"}</Badge>
            <input
              className="index-search"
              style={{ width: 120, font: "1rem var(--font-mono)" }}
              type="number"
              min={current + 1}
              placeholder={`> ${current}`}
              value={partitionsDraft}
              onChange={(e) => setPartitionsDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && growValid && !busy && void growPartitions()}
            />
            <ToolButton variant="primary" disabled={busy || !growValid} onClick={() => void growPartitions()}>
              <Icon name="plus" /> Grow
            </ToolButton>
            <span style={{ color: "var(--text-3)", fontSize: "0.8462rem" }}>
              Kafka only adds partitions — key→partition mapping changes for new writes.
            </span>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <span style={{ color: "var(--text-3)", fontSize: "0.8462rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Configuration
            </span>
            <input
              className="index-search"
              style={{ width: 200 }}
              placeholder="Filter settings"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
            <label style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--text-2)" }}>
              <input type="checkbox" className="row-check" checked={overridesOnly} onChange={() => setOverridesOnly((v) => !v)} />
              overrides only
            </label>
            <span style={{ flex: 1 }} />
            <Badge>{config.data ? `${rows.length} settings` : "loading…"}</Badge>
          </div>
          {config.isError && <div className="empty-note">Unable to load config: {String(config.error)}</div>}
          <div style={{ overflowY: "auto", minHeight: 0 }}>
            <table>
              <thead>
                <tr>
                  <th>Setting</th>
                  <th>Value</th>
                  <th style={{ width: 130 }}>Source</th>
                  <th style={{ width: 90 }} />
                </tr>
              </thead>
              <tbody>
                {rows.map((e) => (
                  <tr key={e.name}>
                    <td style={{ fontFamily: "var(--font-mono)", fontSize: "0.8462rem" }}>{e.name}</td>
                    <td style={{ fontFamily: "var(--font-mono)", fontSize: "0.8462rem", wordBreak: "break-all" }}>
                      {editing === e.name ? (
                        <input
                          className="index-search"
                          style={{ width: "100%", font: "0.8462rem var(--font-mono)" }}
                          autoFocus
                          value={draftValue}
                          onChange={(ev) => setDraftValue(ev.target.value)}
                          onKeyDown={(ev) => {
                            if (ev.key === "Enter" && !busy) void saveEdit(e.name);
                          }}
                        />
                      ) : e.isSensitive ? "•••" : e.value ?? "—"}
                    </td>
                    <td style={{ color: e.source === "dynamic-topic" ? "var(--orange)" : "var(--text-3)" }}>{e.source}</td>
                    <td>
                      <span style={{ display: "inline-flex", gap: 4 }}>
                        {editing === e.name ? (
                          <>
                            <ToolButton disabled={busy} title="Save" onClick={() => void saveEdit(e.name)}><Icon name="check" /></ToolButton>
                            <ToolButton disabled={busy} title="Cancel" onClick={() => setEditing(null)}><Icon name="x" /></ToolButton>
                          </>
                        ) : (
                          <>
                            {!e.isReadOnly && !e.isSensitive && (
                              <ToolButton
                                disabled={busy}
                                title="Edit value"
                                onClick={() => { setEditing(e.name); setDraftValue(e.value ?? ""); }}
                              >
                                <Icon name="pencil" />
                              </ToolButton>
                            )}
                            {e.source === "dynamic-topic" && (
                              <ToolButton disabled={busy} title="Clear override — back to broker default" onClick={() => void resetOverride(e.name)}>
                                <Icon name="history" />
                              </ToolButton>
                            )}
                          </>
                        )}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
