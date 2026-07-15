import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ToolButton } from "../../ui/ToolButton";
import { FormRow } from "../../ui/FormRow";
import { Combobox } from "../../ui/Combobox";
import { CodeInput } from "../../ui/CodeInput";
import { Icon } from "../../ui/Icon";
import { useApp } from "../../store";
import { useActiveConnection, useClusterMeta } from "../../lib/queries";
import { produceMessage } from "../../lib/kafka";

interface HeaderRow {
  id: string;
  key: string;
  value: string;
}

export function ProduceView({ active }: { active: boolean }) {
  const conn = useActiveConnection();
  const meta = useClusterMeta();
  const queryClient = useQueryClient();
  const { activeTopic, showToast } = useApp();

  const [topic, setTopic] = useState(activeTopic ?? "");
  const [partition, setPartition] = useState<number | null>(null);
  const [key, setKey] = useState("");
  const [headers, setHeaders] = useState<HeaderRow[]>([]);
  const [payload, setPayload] = useState('{\n  \n}');
  const [sending, setSending] = useState(false);
  const [lastResult, setLastResult] = useState<string | null>(null);
  const vimStatusRef = useRef<HTMLSpanElement>(null);

  const partitions = meta.data?.topics.find((t) => t.name === topic)?.partitions ?? 0;
  const topicOptions = (meta.data?.topics ?? [])
    .filter((t) => !t.internal)
    .map((t) => ({ value: t.name, hint: `${t.partitions}p` }));

  const send = async () => {
    if (!conn || !topic) {
      showToast("Pick a topic", "Choose a topic to produce to.", "warn");
      return;
    }
    setSending(true);
    try {
      const res = await produceMessage(conn, topic, {
        key: key.trim() || null,
        payload,
        partition,
        headers: headers.filter((h) => h.key.trim()).map((h) => [h.key.trim(), h.value] as [string, string]),
      });
      setLastResult(`${topic} · partition ${res.partition} · offset ${res.offset}`);
      showToast("Message produced", `partition ${res.partition}, offset ${res.offset}.`);
      void queryClient.invalidateQueries({ queryKey: ["topic-stats"] });
      void queryClient.invalidateQueries({ queryKey: ["topic-offsets"] });
    } catch (err) {
      showToast("Produce failed", String(err), "err");
    } finally {
      setSending(false);
    }
  };

  // ⌘↵ / titlebar play bump runNonce — send when this tab is active
  const runNonce = useApp((s) => s.runNonce);
  const prevNonce = useRef(runNonce);
  useEffect(() => {
    if (runNonce !== prevNonce.current) {
      prevNonce.current = runNonce;
      if (active && !sending) void send();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runNonce, active]);

  return (
    <section className={`content connection-view ${active ? "active" : ""}`}>
      <div className="create-head">
        <div>
          <div className="create-kicker">Produce</div>
          <strong>{topic ? `Produce to · ${topic}` : "Produce a message"}</strong>
        </div>
        <div className="seg">
          <ToolButton variant="primary" disabled={sending || !conn} onClick={() => void send()}>
            <Icon name="send" /> {sending ? "Sending…" : "Produce (⌘↵)"}
          </ToolButton>
        </div>
      </div>
      <div className="create-layout">
        <div className="create-card">
          <h3>Target and metadata</h3>
          <div className="create-form">
            <FormRow label="Topic">
              <Combobox value={topic} options={topicOptions} placeholder="— topic —" onChange={(v) => { setTopic(v); setPartition(null); }} />
            </FormRow>
            <FormRow label="Partition">
              <select
                value={partition ?? -1}
                onChange={(e) => setPartition(Number(e.target.value) < 0 ? null : Number(e.target.value))}
              >
                <option value={-1}>auto (by key)</option>
                {Array.from({ length: partitions }, (_, i) => (
                  <option key={i} value={i}>p{i}</option>
                ))}
              </select>
            </FormRow>
            <FormRow label="Key">
              <input value={key} placeholder="optional — drives partitioning" onChange={(e) => setKey(e.target.value)} />
            </FormRow>
            {headers.map((h) => (
              <FormRow key={h.id} label="Header">
                <div style={{ display: "flex", gap: 6 }}>
                  <input
                    placeholder="key"
                    value={h.key}
                    onChange={(e) => setHeaders((hs) => hs.map((x) => (x.id === h.id ? { ...x, key: e.target.value } : x)))}
                  />
                  <input
                    placeholder="value"
                    value={h.value}
                    onChange={(e) => setHeaders((hs) => hs.map((x) => (x.id === h.id ? { ...x, value: e.target.value } : x)))}
                  />
                  <ToolButton iconOnly title="Remove header" onClick={() => setHeaders((hs) => hs.filter((x) => x.id !== h.id))}>
                    <Icon name="x" />
                  </ToolButton>
                </div>
              </FormRow>
            ))}
            <div className="seg">
              <ToolButton onClick={() => setHeaders((hs) => [...hs, { id: crypto.randomUUID(), key: "", value: "" }])}>
                <Icon name="plus" /> Add header
              </ToolButton>
            </div>
            <div className="connection-note">
              <strong>Delivery</strong>
              <span>
                {lastResult
                  ? `Last produced: ${lastResult}`
                  : "Partition auto = broker assigns by key hash (or round-robin without key). Result lands here after send."}
              </span>
            </div>
          </div>
        </div>
        <div className="create-card">
          <h3>Payload</h3>
          <div className="create-form">
            <CodeInput value={payload} onChange={setPayload} vimStatusRef={vimStatusRef} height={320} language="json" />
            <div className="seg" style={{ justifyContent: "space-between" }}>
              <span ref={vimStatusRef} className="vim-status" />
              <span style={{ color: "var(--text-3)", fontSize: "0.9231rem" }}>
                Sent as UTF-8 bytes — JSON highlighted, but any text goes.
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
