import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ToolButton } from "../../ui/ToolButton";
import { FormRow } from "../../ui/FormRow";
import { Combobox } from "../../ui/Combobox";
import { JsonEditor } from "../../ui/JsonEditor";
import { Icon } from "../../ui/Icon";
import { useApp } from "../../store";
import { useActiveConnection, useClusterMeta } from "../../lib/queries";
import { produceMessage } from "../../lib/kafka";

interface HeaderRow {
  id: string;
  key: string;
  value: string;
}

interface ProduceResult {
  topic: string;
  partition: number;
  offset: number;
}

export function ProduceView({ active }: { active: boolean }) {
  const conn = useActiveConnection();
  const meta = useClusterMeta();
  const queryClient = useQueryClient();
  const activeTopic = useApp((s) => s.activeTopic);
  const showToast = useApp((s) => s.showToast);

  const [topic, setTopic] = useState(activeTopic ?? "");
  const [partition, setPartition] = useState<number | null>(null);
  const [key, setKey] = useState("");
  const [headers, setHeaders] = useState<HeaderRow[]>([]);
  const [payload, setPayload] = useState("{\n  \n}");
  const [sending, setSending] = useState(false);
  const [lastResult, setLastResult] = useState<ProduceResult | null>(null);
  const vimStatusRef = useRef<HTMLSpanElement>(null);

  const partitions = meta.data?.topics.find((t) => t.name === topic)?.partitions ?? 0;
  const topicOptions = (meta.data?.topics ?? [])
    .filter((t) => !t.internal)
    .map((t) => ({ value: t.name, hint: `${t.partitions}p` }));

  const jsonValid = useMemo(() => {
    try {
      if (payload.trim()) JSON.parse(payload);
      return true;
    } catch {
      return false;
    }
  }, [payload]);

  const transform = (pretty: boolean) => {
    try {
      setPayload(JSON.stringify(JSON.parse(payload), null, pretty ? 2 : undefined));
    } catch (error) {
      showToast("Invalid JSON", String(error), "err");
    }
  };

  const validate = () => {
    try {
      JSON.parse(payload);
      showToast("JSON valid", "Ready to produce.");
    } catch (error) {
      showToast("Invalid JSON", String(error), "err");
    }
  };

  const send = useCallback(async () => {
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
      setLastResult({ topic, partition: res.partition, offset: res.offset });
      showToast("Message produced", `partition ${res.partition}, offset ${res.offset}.`);
      void queryClient.invalidateQueries({ queryKey: ["topic-stats"] });
      void queryClient.invalidateQueries({ queryKey: ["topic-offsets"] });
    } catch (err) {
      showToast("Produce failed", String(err), "err");
    } finally {
      setSending(false);
    }
  }, [conn, topic, key, payload, partition, headers, showToast, queryClient]);

  // ⌘↵ / titlebar play bump runNonce — send when this tab is active
  const runNonce = useApp((s) => s.runNonce);
  const prevNonce = useRef(runNonce);
  useEffect(() => {
    if (runNonce !== prevNonce.current) {
      prevNonce.current = runNonce;
      if (active && !sending) void send();
    }
  }, [runNonce, active, sending, send]);

  return (
    <section className={`content produce-view ${active ? "active" : ""}`}>
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
              <Combobox
                value={topic}
                options={topicOptions}
                placeholder="— topic —"
                onChange={(v) => {
                  setTopic(v);
                  setPartition(null);
                }}
              />
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
                Partition auto = broker assigns by key hash (or round-robin without key). Result lands here after send.
              </span>
            </div>
          </div>
        </div>
        <div className="create-card produce-payload-card">
          <h3>Payload</h3>
          <div className="create-form produce-payload-form">
            {lastResult && (
              <div className="produce-result">
                <Icon name="check" size={14} />
                <span>
                  Sent to <strong>{lastResult.topic}</strong> · partition <strong>{lastResult.partition}</strong> · offset <strong>{lastResult.offset}</strong>
                </span>
              </div>
            )}
            <div className="json-editor-shell has-json-tools" style={{ flex: 1, minHeight: 0 }}>
              <div className="json-editor-tools">
                <span className={jsonValid ? "valid" : "invalid"}>JSON {jsonValid ? "valid" : "invalid"}</span>
                <span />
                <button type="button" onClick={() => transform(true)} title="Format" aria-label="Format"><Icon name="wand" size={14} /></button>
                <button type="button" onClick={() => transform(false)} title="Minify" aria-label="Minify"><Icon name="minify" size={14} /></button>
                <button type="button" onClick={validate} title="Validate" aria-label="Validate"><Icon name="check" size={14} /></button>
              </div>
              <JsonEditor value={payload} onChange={setPayload} vimStatusRef={vimStatusRef} />
            </div>
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
