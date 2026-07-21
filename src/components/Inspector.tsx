import { useState } from "react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { Kv } from "../ui/Kv";
import { MiniTabs } from "../ui/MiniTabs";
import { PayloadPanel } from "./inspector/PayloadPanel";
import { formatTs } from "../lib/format";
import { useApp } from "../store";
import { useTopicConfig } from "../lib/queries";

export function Inspector() {
  const [pane, setPane] = useState("payload");
  const selectedMsg = useApp((s) => s.selectedMsg);
  const showToast = useApp((s) => s.showToast);
  const topicConfig = useTopicConfig(selectedMsg?.topic ?? null);

  return (
    <aside className="inspector">
      <div className="inspector-head">
        <div className="doc-title">
          <strong>{selectedMsg ? `offset ${selectedMsg.offset}` : "no message"}</strong>
          <span>
            {selectedMsg
              ? `${selectedMsg.topic} · partition ${selectedMsg.partition}`
              : "select a row to inspect"}
          </span>
        </div>
      </div>
      <MiniTabs
        tabs={[
          { id: "payload", label: "Payload" },
          { id: "meta", label: "Metadata" },
        ]}
        active={pane}
        onChange={setPane}
      />
      {pane === "payload" && (
        !selectedMsg ? (
          <div className="inspector-scroll">
            <div className="empty-note">Load messages and click a row — the payload shows here.</div>
          </div>
        ) : (
          <PayloadPanel
            payload={selectedMsg.payload}
            onCopy={async (text, label) => {
              await writeText(text);
              showToast("Copied", label);
            }}
          />
        )
      )}
      {pane === "meta" && (
        <div className="inspector-scroll">
          {!selectedMsg && <div className="empty-note">No message selected.</div>}
          {selectedMsg && (
            <div className="panel">
              <h3>Metadata</h3>
              <Kv label="topic">{selectedMsg.topic}</Kv>
              <Kv label="partition">{selectedMsg.partition}</Kv>
              <Kv label="offset">{selectedMsg.offset}</Kv>
              <Kv label="timestamp">
                {selectedMsg.timestamp
                  ? `${formatTs(selectedMsg.timestamp)} (local) · ${new Date(selectedMsg.timestamp).toISOString()}`
                  : "—"}
              </Kv>
              <Kv label="key">{selectedMsg.key ?? "—"}</Kv>
              {/* topic-level compression.type — rdkafka decompresses before delivery,
                  so the per-message codec is not observable; "producer" means the
                  broker keeps whatever codec the producer sent */}
              <Kv label="compression (topic)">
                {topicConfig.isPending
                  ? "loading…"
                  : topicConfig.data?.compression === "producer"
                    ? "producer (as sent by producer)"
                    : topicConfig.data?.compression ?? "—"}
              </Kv>
              {selectedMsg.headers.map(([k, v]) => (
                <Kv key={k} label={`header · ${k}`}>{v}</Kv>
              ))}
            </div>
          )}
        </div>
      )}
    </aside>
  );
}
